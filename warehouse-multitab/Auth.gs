/** Manual authentication, authorization, session handling, and user APIs. */

var AUTH_CONFIG_ = Object.freeze({
  // Deliberately bounded for Apps Script execution limits. Each round is a
  // server-peppered HMAC-SHA256; salts remain unique per user.
  PASSWORD_KDF_ITERATIONS: 2400,
  PASSWORD_MIN_LENGTH: 6,
  PASSWORD_MAX_LENGTH: 256,
  SESSION_TTL_SECONDS: 21600,
  LOCK_AFTER_FAILURES: 5,
  LOCK_DURATION_MS: 15 * 60 * 1000,
  RATE_LIMIT_ATTEMPTS: 12,
  RATE_LIMIT_WINDOW_SECONDS: 15 * 60,
  GLOBAL_RATE_LIMIT_ATTEMPTS: 120,
  GLOBAL_RATE_LIMIT_WINDOW_SECONDS: 60,
  PEPPER_PROPERTY: 'WAREHOUSE_PASSWORD_PEPPER_V1',
  EPOCH_PROPERTY: 'WAREHOUSE_AUTH_EPOCH_V1'
});

var WAREHOUSE_ROLES_ = Object.freeze(['ADMIN', 'STOREKEEPER', 'AUDITOR']);

// Authentication mutations are not transactional across the USERS and AUDIT
// sheets. Validate the audit schema before changing credentials, then retain a
// bounded Script Properties outbox if the post-commit audit append still fails
// because of a transient Sheets error or quota.
var AUTH_AUDIT_OUTBOX_PROPERTY_ = 'WAREHOUSE_AUTH_AUDIT_OUTBOX_V1';
var AUTH_AUDIT_OUTBOX_MAX_EVENTS_ = 12;
var AUTH_AUDIT_OUTBOX_MAX_CHARS_ = 8000;

/**
 * authenticate({username,password}) -> {token,expiresAt,user}
 * The raw opaque token is returned once; only its SHA-256 digest is cached.
 */
function authenticate(credentials) {
  return apiResult_(function () {
    credentials = requireObject_(credentials, 'تسجيل الدخول');
    var input = prepareAuthenticationInput_(credentials.username, credentials.password);
    // Rate-bucket consumption and the salt observation are atomic, while the
    // expensive KDF remains outside the mutation lock.
    var observation = withScriptLock_(function () {
      enforceLoginRateLimit_(input.normalized);
      var observedUser = findUserByNormalizedUsername_(input.normalized);
      return {
        userId: observedUser ? observedUser.id : '',
        salt: observedUser ? observedUser.passwordSalt : 'unknown-user-dummy-salt-v1',
        sessionVersion: observedUser ? observedUser.sessionVersion : 0
      };
    });
    var prepared = {
      normalized: input.normalized,
      observedUserId: observation.userId,
      observedSalt: observation.salt,
      observedSessionVersion: observation.sessionVersion,
      candidateHash: derivePasswordHash_(input.normalized || 'unknown', input.password, observation.salt)
    };
    return withScriptLock_(function () {
      return authenticateInternal_(prepared);
    });
  });
}

/** Compatibility alias: login(username,password) or login({username,password}). */
function login(username, password) {
  var credentials = username && typeof username === 'object' ? username : { username: username, password: password };
  return authenticate(credentials);
}

/** logout(token) -> {loggedOut:true}; invalidates the presented session. */
function logout(token) {
  return apiResult_(function () {
    return withScriptLock_(function () {
      var session = requireSession_(token, null, { allowPasswordChange: true });
      CacheService.getScriptCache().remove(session.cacheKey);
      var auditWarning = appendCommittedAuthAudit_({
        actor: session.user,
        action: 'LOGOUT',
        entityType: 'SESSION',
        entityId: session.user.id,
        status: 'SUCCESS',
        details: {}
      });
      var result = { loggedOut: true };
      if (auditWarning) result.auditWarning = auditWarning;
      return result;
    });
  });
}

/** listUsers(token,{query,status,page,pageSize}) -> paginated non-secret users. */
function listUsers(token, params) {
  return apiResult_(function () {
    requireSession_(token, ['ADMIN']);
    params = params || {};
    var query = requireText_(params.query, 'البحث', 200, true).toLowerCase();
    var status = String(params.status || 'ALL').toUpperCase();
    var paging = clampPage_(params);
    var users = allUserRecords_().filter(function (user) {
      if (status === 'ACTIVE' && !user.active) return false;
      if (status === 'INACTIVE' && user.active) return false;
      if (query && (user.username + ' ' + user.displayName + ' ' + user.role).toLowerCase().indexOf(query) === -1) return false;
      return true;
    }).sort(function (a, b) {
      return a.username.localeCompare(b.username);
    });
    var total = users.length;
    var start = (paging.page - 1) * paging.pageSize;
    return {
      users: users.slice(start, start + paging.pageSize).map(publicUser_),
      page: paging.page,
      pageSize: paging.pageSize,
      total: total,
      hasMore: start + paging.pageSize < total
    };
  });
}

/**
 * saveUser(token,payload) -> {user,temporaryPassword?}
 * payload.id updates; without id a strong one-time password is generated.
 */
function saveUser(token, payload) {
  return apiResult_(function () {
    payload = requireObject_(payload, 'المستخدم');
    if (!payload.id) {
      var observedSession = requireSession_(token, ['ADMIN']);
      var username = validateUsername_(payload.username);
      var temporaryPassword = generateTemporaryPassword_(username);
      var salt = generatePasswordSalt_();
      var passwordHash = derivePasswordHash_(username, temporaryPassword, salt);

      return withScriptLock_(function () {
        var session = requireSession_(token, ['ADMIN']);
        if (session.user.id !== observedSession.user.id) {
          throw new WarehouseError_('SESSION_INVALIDATED', 'تغيّرت جلسة المدير أثناء الطلب. سجّل الدخول مجددًا.');
        }
        preflightAuthAudit_();
        var created = createUserRecord_({
          username: username,
          displayName: payload.displayName,
          passwordSalt: salt,
          passwordHash: passwordHash,
          role: payload.role,
          active: parseBoolean_(payload.active, true),
          forcePasswordChange: true,
          actor: session.user.username
        });
        var createAuditWarning = appendCommittedAuthAudit_({
          actor: session.user,
          action: 'USER_CREATE',
          entityType: 'USER',
          entityId: created.id,
          status: 'SUCCESS',
          details: { username: created.username, role: created.role, active: created.active }
        });
        var createResult = { user: publicUser_(created), temporaryPassword: temporaryPassword };
        if (createAuditWarning) createResult.auditWarning = createAuditWarning;
        return createResult;
      });
    }

    return withScriptLock_(function () {
      var session = requireSession_(token, ['ADMIN']);
      var user = findUserById_(requireText_(payload.id, 'معرف المستخدم', 100, false));
      if (!user) throw new WarehouseError_('USER_NOT_FOUND', 'المستخدم غير موجود.');
      if (payload.username !== undefined && validateUsername_(payload.username) !== user.username) {
        throw new WarehouseError_('USERNAME_IMMUTABLE', 'لا يمكن تغيير اسم المستخدم بعد الإنشاء.');
      }
      var displayName = payload.displayName === undefined ? user.displayName : requireText_(payload.displayName, 'الاسم المعروض', 100, false);
      var role = payload.role === undefined ? user.role : validateRole_(payload.role);
      var active = payload.active === undefined ? user.active : parseBoolean_(payload.active, user.active);

      if (user.id === session.user.id && (!active || role !== 'ADMIN')) {
        throw new WarehouseError_('SELF_LOCKOUT', 'لا يمكنك تعطيل حسابك أو إزالة صلاحية المدير عنه.');
      }
      ensureAnActiveAdminRemains_(user, role, active);

      preflightAuthAudit_();
      var updated = updateUserFields_(user, {
        displayName: displayName,
        role: role,
        active: active,
        sessionVersion: user.sessionVersion + 1
      });
      var updateAuditWarning = appendCommittedAuthAudit_({
        actor: session.user,
        action: 'USER_UPDATE',
        entityType: 'USER',
        entityId: updated.id,
        status: 'SUCCESS',
        details: { username: updated.username, role: updated.role, active: updated.active }
      });
      var updateResult = { user: publicUser_(updated) };
      if (updateAuditWarning) updateResult.auditWarning = updateAuditWarning;
      return updateResult;
    });
  });
}

/** resetUserPassword(token,{userId}) -> one-time temporaryPassword. */
function resetUserPassword(token, payload) {
  return apiResult_(function () {
    payload = requireObject_(payload, 'إعادة كلمة المرور');
    var observedSession = requireSession_(token, ['ADMIN']);
    var userId = requireText_(payload.userId || payload.id, 'معرف المستخدم', 100, false);
    var observedUser = findUserById_(userId);
    if (!observedUser) throw new WarehouseError_('USER_NOT_FOUND', 'المستخدم غير موجود.');
    var temporaryPassword = generateTemporaryPassword_(observedUser.username);
    var salt = generatePasswordSalt_();
    var passwordHash = derivePasswordHash_(observedUser.username, temporaryPassword, salt);

    return withScriptLock_(function () {
      var session = requireSession_(token, ['ADMIN']);
      var user = findUserById_(userId);
      if (!user) throw new WarehouseError_('USER_NOT_FOUND', 'المستخدم غير موجود.');
      if (session.user.id !== observedSession.user.id || user.username !== observedUser.username || user.passwordHash !== observedUser.passwordHash || user.sessionVersion !== observedUser.sessionVersion) {
        throw new WarehouseError_('USER_STATE_CHANGED', 'تغيّرت بيانات الحساب أثناء الطلب. أعد المحاولة.');
      }
      preflightAuthAudit_();
      var updated = updateUserFields_(user, {
        passwordSalt: salt,
        passwordHash: passwordHash,
        failedAttempts: 0,
        lockedUntil: '',
        forcePasswordChange: true,
        sessionVersion: user.sessionVersion + 1
      });
      clearUserLoginRateLimit_(updated.username);
      var auditWarning = appendCommittedAuthAudit_({
        actor: session.user,
        action: 'USER_PASSWORD_RESET',
        entityType: 'USER',
        entityId: updated.id,
        status: 'SUCCESS',
        details: { username: updated.username }
      });
      var result = { user: publicUser_(updated), temporaryPassword: temporaryPassword };
      if (auditWarning) result.auditWarning = auditWarning;
      return result;
    });
  });
}

/**
 * changeMyPassword(token,{currentPassword,newPassword})
 * -> {changed:true,requiresLogin:true}; all existing sessions are invalidated.
 */
function changeMyPassword(token, payload) {
  return apiResult_(function () {
    payload = requireObject_(payload, 'تغيير كلمة المرور');
    var observedSession = requireSession_(token, null, { allowPasswordChange: true });
    var observedUser = findUserById_(observedSession.user.id);
    if (!observedUser) throw new WarehouseError_('USER_NOT_FOUND', 'المستخدم غير موجود.');

    var currentPassword = String(payload.currentPassword || '');
    var newPassword = String(payload.newPassword || '');
    validateStrongPassword_(newPassword, observedUser.username);

    // All expensive derivations run before requesting the global mutation
    // lock. The snapshot is revalidated under the lock before the write.
    var currentCandidateHash = derivePasswordHash_(observedUser.username, currentPassword, observedUser.passwordSalt);
    if (!constantTimeEqual_(currentCandidateHash, observedUser.passwordHash)) {
      throw new WarehouseError_('INVALID_CURRENT_PASSWORD', 'كلمة المرور الحالية غير صحيحة.');
    }
    var reusedCandidateHash = derivePasswordHash_(observedUser.username, newPassword, observedUser.passwordSalt);
    if (constantTimeEqual_(reusedCandidateHash, observedUser.passwordHash)) {
      throw new WarehouseError_('PASSWORD_REUSED', 'اختر كلمة مرور جديدة.');
    }
    var newSalt = generatePasswordSalt_();
    var newPasswordHash = derivePasswordHash_(observedUser.username, newPassword, newSalt);

    return withScriptLock_(function () {
      var session = requireSession_(token, null, { allowPasswordChange: true });
      var user = findUserById_(session.user.id);
      if (!user || user.passwordSalt !== observedUser.passwordSalt || user.passwordHash !== observedUser.passwordHash || user.sessionVersion !== observedUser.sessionVersion) {
        throw new WarehouseError_('SESSION_INVALIDATED', 'تغيرت بيانات الحساب أثناء الطلب. سجّل الدخول مجدداً.');
      }
      preflightAuthAudit_();
      updateUserFields_(user, {
        passwordSalt: newSalt,
        passwordHash: newPasswordHash,
        failedAttempts: 0,
        lockedUntil: '',
        forcePasswordChange: false,
        sessionVersion: user.sessionVersion + 1
      });
      CacheService.getScriptCache().remove(session.cacheKey);
      var auditWarning = appendCommittedAuthAudit_({
        actor: session.user,
        action: 'PASSWORD_CHANGE',
        entityType: 'USER',
        entityId: user.id,
        status: 'SUCCESS',
        details: {}
      });
      var result = { changed: true, requiresLogin: true };
      if (auditWarning) result.auditWarning = auditWarning;
      return result;
    });
  });
}

function prepareAuthenticationInput_(usernameInput, passwordInput) {
  var normalized;
  try { normalized = validateUsername_(usernameInput); } catch (ignored) { normalized = normalizeUsername_(usernameInput).substring(0, 64); }
  var password = passwordInput === null || passwordInput === undefined ? '' : String(passwordInput);
  if (!normalized || password.length > AUTH_CONFIG_.PASSWORD_MAX_LENGTH) {
    throw new WarehouseError_('INVALID_CREDENTIALS', 'اسم المستخدم أو كلمة المرور غير صحيحة.');
  }
  return { normalized: normalized, password: password };
}

function authenticateInternal_(prepared) {
  var normalized = prepared.normalized;
  var user = findUserByNormalizedUsername_(normalized);
  var now = new Date();

  var currentUserId = user ? user.id : '';
  var currentSalt = user ? user.passwordSalt : 'unknown-user-dummy-salt-v1';
  var currentSessionVersion = user ? user.sessionVersion : 0;
  if (currentUserId !== prepared.observedUserId || currentSalt !== prepared.observedSalt || currentSessionVersion !== prepared.observedSessionVersion) {
    throw new WarehouseError_('AUTH_RETRY_REQUIRED', 'تغيّرت بيانات الدخول أثناء التحقق. أعد المحاولة دون احتسابها محاولة فاشلة.');
  }

  // A pending audit must be durably replayed before another authentication
  // state change is allowed. This prevents an audit outage from silently
  // overflowing the bounded Script Properties outbox.
  preflightSessionAudit_();

  if (user && user.lockedUntil && new Date(user.lockedUntil).getTime() > now.getTime()) {
    throw new WarehouseError_('ACCOUNT_LOCKED', 'الحساب مقفل مؤقتاً بعد محاولات فاشلة.', { lockedUntil: isoDate_(user.lockedUntil) });
  }
  if (user && user.lockedUntil && new Date(user.lockedUntil).getTime() <= now.getTime()) {
    user = updateUserFields_(user, { failedAttempts: 0, lockedUntil: '' });
  }

  // A real KDF is also performed for unknown usernames to reduce enumeration
  // through response timing. The dummy salt is not a credential.
  var valid = !!user && user.passwordSalt === prepared.observedSalt && constantTimeEqual_(prepared.candidateHash, user.passwordHash);
  if (!valid) {
    if (user) {
      var failures = user.failedAttempts + 1;
      var lockedUntil = failures >= AUTH_CONFIG_.LOCK_AFTER_FAILURES ? new Date(now.getTime() + AUTH_CONFIG_.LOCK_DURATION_MS) : '';
      updateUserFields_(user, { failedAttempts: failures, lockedUntil: lockedUntil });
      appendCommittedAuthAudit_({
        actor: { id: user.id, username: user.username, displayName: user.displayName },
        action: 'LOGIN_FAILED',
        entityType: 'SESSION',
        entityId: user.id,
        status: 'FAILED',
        details: { failedAttempts: failures, lockedUntil: isoDate_(lockedUntil) }
      });
      if (lockedUntil) {
        throw new WarehouseError_('ACCOUNT_LOCKED', 'تم قفل الحساب مؤقتاً بعد محاولات فاشلة.', { lockedUntil: isoDate_(lockedUntil) });
      }
    }
    throw new WarehouseError_('INVALID_CREDENTIALS', 'اسم المستخدم أو كلمة المرور غير صحيحة.');
  }
  if (!user.active) throw new WarehouseError_('ACCOUNT_DISABLED', 'الحساب معطل. راجع مدير النظام.');

  clearLoginRateLimit_(normalized);
  user = updateUserFields_(user, { failedAttempts: 0, lockedUntil: '', lastLoginAt: now });
  var issued = issueSession_(user);
  var auditWarning = appendCommittedAuthAudit_({
    actor: user,
    action: 'LOGIN_SUCCESS',
    entityType: 'SESSION',
    entityId: user.id,
    status: 'SUCCESS',
    details: { expiresAt: issued.expiresAt }
  });
  var result = { token: issued.token, expiresAt: issued.expiresAt, user: publicUser_(user) };
  if (auditWarning) result.auditWarning = auditWarning;
  return result;
}

function issueSession_(user) {
  var token = 'wms_' + randomMaterial_(4).replace(/[^A-Za-z0-9_-]/g, '');
  var cacheKey = sessionCacheKey_(token);
  var issuedAt = new Date();
  var expiresAt = new Date(issuedAt.getTime() + AUTH_CONFIG_.SESSION_TTL_SECONDS * 1000);
  var session = {
    userId: user.id,
    sessionVersion: user.sessionVersion,
    authEpoch: getAuthEpoch_(),
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString()
  };
  var encodedSession = JSON.stringify(session);
  var sessionCache = CacheService.getScriptCache();
  sessionCache.put(cacheKey, encodedSession, AUTH_CONFIG_.SESSION_TTL_SECONDS);
  if (sessionCache.get(cacheKey) !== encodedSession) {
    sessionCache.remove(cacheKey);
    throw new WarehouseError_('SESSION_STORE_UNAVAILABLE', 'تعذر تثبيت جلسة الدخول. أعد المحاولة بعد لحظات.');
  }
  return { token: token, expiresAt: expiresAt.toISOString() };
}

function requireSession_(token, allowedRoles, options) {
  options = options || {};
  if (typeof token !== 'string' || token.length < 40 || token.length > 500) {
    throw new WarehouseError_('AUTH_REQUIRED', 'يجب تسجيل الدخول أولاً.');
  }
  var cacheKey = sessionCacheKey_(token);
  var raw = CacheService.getScriptCache().get(cacheKey);
  if (!raw) throw new WarehouseError_('SESSION_EXPIRED', 'انتهت الجلسة. سجل الدخول مرة أخرى.');
  var cached;
  try { cached = JSON.parse(raw); } catch (ignored) { cached = null; }
  if (!cached || !cached.userId || new Date(cached.expiresAt).getTime() <= Date.now()) {
    CacheService.getScriptCache().remove(cacheKey);
    throw new WarehouseError_('SESSION_EXPIRED', 'انتهت الجلسة. سجل الدخول مرة أخرى.');
  }
  if (Number(cached.authEpoch) !== getAuthEpoch_()) {
    CacheService.getScriptCache().remove(cacheKey);
    throw new WarehouseError_('SESSION_INVALIDATED', 'تم إلغاء الجلسة. سجل الدخول مرة أخرى.');
  }
  var user = findUserById_(cached.userId);
  if (!user || !user.active || user.sessionVersion !== Number(cached.sessionVersion)) {
    CacheService.getScriptCache().remove(cacheKey);
    throw new WarehouseError_('SESSION_INVALIDATED', 'تم إلغاء الجلسة. سجل الدخول مرة أخرى.');
  }
  if (allowedRoles && allowedRoles.indexOf(user.role) === -1) {
    throw new WarehouseError_('FORBIDDEN', 'ليس لديك صلاحية لتنفيذ هذا الإجراء.');
  }
  if (user.forcePasswordChange && !options.allowPasswordChange) {
    throw new WarehouseError_('PASSWORD_CHANGE_REQUIRED', 'يجب تغيير كلمة المرور المؤقتة قبل المتابعة.');
  }
  return { user: user, cacheKey: cacheKey, expiresAt: cached.expiresAt };
}

function normalizeUsername_(value) {
  var text = value === null || value === undefined ? '' : String(value).trim().toLowerCase();
  try { text = text.normalize('NFKC'); } catch (ignored) { /* V8 normally supports normalize. */ }
  return text;
}

function validateUsername_(value) {
  var username = normalizeUsername_(value);
  if (username.length < 3 || username.length > 64 || /[\s\u0000-\u001F\u007F"'<>\\\/:;={}\[\]()+]/.test(username)) {
    throw new WarehouseError_('VALIDATION_ERROR', 'اسم المستخدم يجب أن يكون من 3 إلى 64 محرفاً بدون مسافات.', { field: 'username' });
  }
  return username;
}

function validateRole_(role) {
  var normalized = String(role || '').toUpperCase();
  if (WAREHOUSE_ROLES_.indexOf(normalized) === -1) {
    throw new WarehouseError_('VALIDATION_ERROR', 'الدور غير صالح.', { field: 'role' });
  }
  return normalized;
}

function validateStrongPassword_(passwordInput, username) {
  var password = passwordInput === null || passwordInput === undefined ? '' : String(passwordInput);
  var validLength = password.length >= AUTH_CONFIG_.PASSWORD_MIN_LENGTH && password.length <= AUTH_CONFIG_.PASSWORD_MAX_LENGTH;
  if (!validLength) {
    throw new WarehouseError_(
      'WEAK_PASSWORD',
      'كلمة المرور يجب أن تتكون من 6 محارف على الأقل.',
      { field: 'newPassword' }
    );
  }
  return password;
}

function ensurePasswordPepper_() {
  var properties = PropertiesService.getScriptProperties();
  var pepper = properties.getProperty(AUTH_CONFIG_.PEPPER_PROPERTY);
  if (!pepper) {
    pepper = randomMaterial_(8);
    properties.setProperty(AUTH_CONFIG_.PEPPER_PROPERTY, pepper);
  }
  return pepper;
}

function ensureAuthEpoch_() {
  var properties = PropertiesService.getScriptProperties();
  var raw = properties.getProperty(AUTH_CONFIG_.EPOCH_PROPERTY);
  var epoch = Number(raw);
  if (!isFinite(epoch) || epoch < 1 || Math.floor(epoch) !== epoch) {
    epoch = 1;
    properties.setProperty(AUTH_CONFIG_.EPOCH_PROPERTY, String(epoch));
  }
  return epoch;
}

function getAuthEpoch_() {
  return ensureAuthEpoch_();
}

function incrementAuthEpoch_() {
  var properties = PropertiesService.getScriptProperties();
  var next = ensureAuthEpoch_() + 1;
  properties.setProperty(AUTH_CONFIG_.EPOCH_PROPERTY, String(next));
  return next;
}

function getPasswordPepper_() {
  var pepper = PropertiesService.getScriptProperties().getProperty(AUTH_CONFIG_.PEPPER_PROPERTY);
  if (!pepper) throw new WarehouseError_('SYSTEM_NOT_INITIALIZED', 'هيئ النظام من قائمة «نظام المخزون» داخل Google Sheets أولاً.');
  return pepper;
}

function generatePasswordSalt_() {
  return randomMaterial_(3);
}

function generateTemporaryPassword_(username) {
  // A base64url SHA-256 digest supplies mixed random material. Regenerate
  // until the exact password policy passes, including the username exclusion.
  for (var attempt = 0; attempt < 32; attempt += 1) {
    var candidate = randomMaterial_(3).substring(0, 24) + '!';
    try {
      return validateStrongPassword_(candidate, username || '');
    } catch (error) {
      if (!error || error.code !== 'WEAK_PASSWORD') throw error;
    }
  }
  throw new WarehouseError_('PASSWORD_GENERATION_FAILED', 'تعذر إنشاء كلمة مرور مؤقتة آمنة. أعد المحاولة.');
}

function randomMaterial_(uuidCount) {
  var pieces = [];
  for (var i = 0; i < uuidCount; i += 1) pieces.push(Utilities.getUuid());
  pieces.push(String(new Date().getTime()));
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pieces.join('|'), Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '');
}

function derivePasswordHash_(username, password, salt) {
  return derivePasswordHashWithPepper_(username, password, salt, getPasswordPepper_());
}

function derivePasswordHashWithPepper_(username, password, salt, pepper) {
  pepper = requireText_(pepper, 'مفتاح حماية كلمات المرور', 512, false);
  var state = Utilities.computeHmacSha256Signature(
    'warehouse-password-v1\u0000' + username + '\u0000' + salt + '\u0000' + String(password),
    pepper,
    Utilities.Charset.UTF_8
  );
  for (var i = 1; i < AUTH_CONFIG_.PASSWORD_KDF_ITERATIONS; i += 1) {
    state = Utilities.computeHmacSha256Signature(
      Utilities.base64EncodeWebSafe(state) + '|' + username + '|' + salt + '|' + i,
      pepper,
      Utilities.Charset.UTF_8
    );
  }
  return 'hmac-sha256$' + AUTH_CONFIG_.PASSWORD_KDF_ITERATIONS + '$' + Utilities.base64EncodeWebSafe(state).replace(/=+$/g, '');
}

function constantTimeEqual_(left, right) {
  left = String(left || '');
  right = String(right || '');
  var mismatch = left.length ^ right.length;
  var length = Math.max(left.length, right.length);
  for (var i = 0; i < length; i += 1) mismatch |= (left.charCodeAt(i % (left.length || 1)) || 0) ^ (right.charCodeAt(i % (right.length || 1)) || 0);
  return mismatch === 0;
}

/** Fail before a mutation if audit storage is unusable or a replay is blocked. */
function preflightAuthAudit_() {
  schemaMetadata_('AUDIT');
  var pending = readPendingAuthAudits_();
  if (!pending.length) return;
  try {
    flushPendingAuthAudits_();
  } catch (error) {
    throw new WarehouseError_(
      'AUDIT_BACKLOG_UNAVAILABLE',
      'تعذر ترحيل سجل تدقيق مؤجل. لم تُنفذ العملية لحماية اكتمال سجل الرقابة؛ حاول مرة أخرى لاحقاً.',
      { pendingEvents: readPendingAuthAudits_().length }
    );
  }
}

/**
 * Login/logout remain available during a short audit outage. Pending session
 * events may accumulate only up to the durable bound; once full, the next
 * session mutation is rejected before state changes and no old event is lost.
 */
function preflightSessionAudit_() {
  var pending = readPendingAuthAudits_();
  if (!pending.length) return;
  try {
    schemaMetadata_('AUDIT');
    flushPendingAuthAudits_();
  } catch (error) {
    pending = readPendingAuthAudits_();
    if (pending.length >= AUTH_AUDIT_OUTBOX_MAX_EVENTS_) {
      throw new WarehouseError_(
        'AUDIT_BACKLOG_FULL',
        'تعذر ترحيل سجل التدقيق المؤجل، لذلك أُوقف طلب الجلسة قبل التنفيذ. حاول مرة أخرى لاحقاً.',
        { pendingEvents: pending.length }
      );
    }
  }
}

/**
 * Append an audit record after a mutation that has already committed.
 *
 * Sheets has no cross-sheet transaction. A transient audit failure must not
 * turn a successful password change/reset into an API failure that hides the
 * new credential. The sanitized event is retained in a bounded Script
 * Properties outbox and replayed on the next successful authentication audit.
 */
function appendCommittedAuthAudit_(input) {
  try {
    flushPendingAuthAudits_();
    appendAuditRecord_(input);
    return null;
  } catch (error) {
    var event = pendingAuthAuditEvent_(input, error);
    var queued = false;
    try {
      var pending = readPendingAuthAudits_();
      pending.push(event);
      writePendingAuthAudits_(pending);
      queued = true;
    } catch (queueError) {
      try {
        Logger.log(JSON.stringify({
          level: 'ERROR',
          action: 'AUTH_AUDIT_OUTBOX_WRITE_FAILED',
          incidentId: event.incidentId,
          message: queueError && queueError.message ? queueError.message : String(queueError)
        }));
      } catch (ignored) { /* Execution logging is best effort. */ }
    }
    try {
      Logger.log(JSON.stringify({
        level: 'ERROR',
        action: 'AUTH_AUDIT_DEFERRED',
        incidentId: event.incidentId,
        queued: queued,
        originalAction: event.record.action,
        message: event.failureMessage
      }));
    } catch (ignoredLog) { /* The truthful API result still survives logging failure. */ }
    return {
      code: queued ? 'AUDIT_DEFERRED' : 'AUDIT_LOG_FAILED',
      incidentId: event.incidentId,
      queued: queued,
      message: queued ?
        'تمت العملية، وسيعاد تسجيل التدقيق تلقائياً عند عودة الخدمة.' :
        'تمت العملية، لكن تعذر حفظ سجل التدقيق الاحتياطي. راجع سجل التنفيذ.'
    };
  }
}

function pendingAuthAuditEvent_(input, error) {
  input = input || {};
  var actor = input.actor || {};
  var details = input.details === undefined ? {} : input.details;
  var serializedDetails;
  try { serializedDetails = JSON.stringify(details); } catch (ignored) { serializedDetails = '{}'; }
  if (serializedDetails.length > 1200) {
    details = { truncated: true, preview: serializedDetails.substring(0, 1000) };
  } else {
    try { details = JSON.parse(serializedDetails); } catch (ignoredParse) { details = {}; }
  }
  return {
    incidentId: 'AUTH-AUDIT-' + Utilities.getUuid(),
    occurredAt: new Date().toISOString(),
    failureMessage: error && error.message ? String(error.message).substring(0, 500) : String(error).substring(0, 500),
    record: {
      actor: {
        id: actor.id || '',
        username: actor.username || '',
        displayName: actor.displayName || ''
      },
      action: input.action || 'UNKNOWN',
      entityType: input.entityType || '',
      entityId: input.entityId || '',
      status: input.status || 'SUCCESS',
      details: details
    }
  };
}

function readPendingAuthAudits_() {
  var raw = PropertiesService.getScriptProperties().getProperty(AUTH_AUDIT_OUTBOX_PROPERTY_);
  if (!raw) return [];
  var parsed;
  try { parsed = JSON.parse(raw); } catch (ignored) { parsed = []; }
  if (Object.prototype.toString.call(parsed) !== '[object Array]') return [];
  return parsed.filter(function (event) {
    return !!(event && event.record && event.incidentId);
  });
}

function writePendingAuthAudits_(pending) {
  var properties = PropertiesService.getScriptProperties();
  pending = Array.isArray(pending) ? pending.slice() : [];
  if (pending.length > AUTH_AUDIT_OUTBOX_MAX_EVENTS_) {
    throw new Error('Audit outbox capacity reached; no event was discarded.');
  }
  var serialized = JSON.stringify(pending);
  if (serialized.length > AUTH_AUDIT_OUTBOX_MAX_CHARS_) {
    // Retain every event identity/action while compacting optional diagnostics.
    pending = pending.map(function (event) {
      event = event || {};
      var record = event.record || {};
      return {
        incidentId: event.incidentId || '',
        occurredAt: event.occurredAt || '',
        failureMessage: String(event.failureMessage || '').substring(0, 120),
        record: {
          actor: record.actor || {},
          action: record.action || 'UNKNOWN',
          entityType: record.entityType || '',
          entityId: record.entityId || '',
          status: record.status || 'SUCCESS',
          details: { compacted: true }
        }
      };
    });
    serialized = JSON.stringify(pending);
  }
  if (serialized.length > AUTH_AUDIT_OUTBOX_MAX_CHARS_) {
    throw new Error('Audit outbox exceeds durable property capacity; no event was discarded.');
  }
  if (!pending.length) properties.deleteProperty(AUTH_AUDIT_OUTBOX_PROPERTY_);
  else properties.setProperty(AUTH_AUDIT_OUTBOX_PROPERTY_, serialized);
}

function flushPendingAuthAudits_() {
  var pending = readPendingAuthAudits_();
  while (pending.length) {
    var event = pending[0];
    var record = event.record || {};
    var details = record.details;
    if (!details || Object.prototype.toString.call(details) !== '[object Object]') {
      details = { originalDetails: details === undefined ? null : details };
    }
    details.deferredAudit = {
      incidentId: event.incidentId || '',
      occurredAt: event.occurredAt || ''
    };
    appendAuditRecord_({
      actor: record.actor || {},
      action: record.action || 'UNKNOWN',
      entityType: record.entityType || '',
      entityId: record.entityId || '',
      status: record.status || 'SUCCESS',
      details: details
    });
    pending.shift();
    writePendingAuthAudits_(pending);
  }
}

function sessionCacheKey_(token) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(token), Utilities.Charset.UTF_8);
  return 'session:' + bytesToHex_(digest);
}

function loginRateKey_(username) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'login-rate|' + username, Utilities.Charset.UTF_8);
  return 'login-rate:' + bytesToHex_(digest);
}

function bytesToHex_(bytes) {
  return bytes.map(function (byte) {
    var value = byte < 0 ? byte + 256 : byte;
    return ('0' + value.toString(16)).slice(-2);
  }).join('');
}

function enforceLoginRateLimit_(username) {
  var cache = CacheService.getScriptCache();
  consumeRateBucket_(cache, 'login-rate:global', AUTH_CONFIG_.GLOBAL_RATE_LIMIT_ATTEMPTS, AUTH_CONFIG_.GLOBAL_RATE_LIMIT_WINDOW_SECONDS, 'خدمة الدخول مشغولة مؤقتاً. حاول بعد قليل.');
  consumeRateBucket_(cache, loginRateKey_(username), AUTH_CONFIG_.RATE_LIMIT_ATTEMPTS, AUTH_CONFIG_.RATE_LIMIT_WINDOW_SECONDS, 'محاولات كثيرة. انتظر 15 دقيقة ثم حاول مرة أخرى.');
}

function clearLoginRateLimit_(username) {
  var cache = CacheService.getScriptCache();
  clearUserLoginRateLimit_(username);
  decrementRateBucket_(cache, 'login-rate:global');
}

function clearUserLoginRateLimit_(username) {
  CacheService.getScriptCache().remove(loginRateKey_(normalizeUsername_(username)));
}

function clearRecoveryRateLimits_(username) {
  var cache = CacheService.getScriptCache();
  clearUserLoginRateLimit_(username);
  cache.remove('login-rate:global');
}

function consumeRateBucket_(cache, key, limit, windowSeconds, message) {
  var now = Date.now();
  var bucket;
  try { bucket = JSON.parse(cache.get(key) || 'null'); } catch (ignored) { bucket = null; }
  if (!bucket || !isFinite(bucket.startedAt) || now >= bucket.startedAt + windowSeconds * 1000) {
    bucket = { count: 0, startedAt: now };
  }
  if (bucket.count >= limit) throw new WarehouseError_('RATE_LIMITED', message);
  bucket.count += 1;
  var ttl = Math.max(1, Math.ceil((bucket.startedAt + windowSeconds * 1000 - now) / 1000));
  cache.put(key, JSON.stringify(bucket), ttl);
}

function decrementRateBucket_(cache, key) {
  var bucket;
  try { bucket = JSON.parse(cache.get(key) || 'null'); } catch (ignored) { bucket = null; }
  if (!bucket || !isFinite(bucket.startedAt)) return;
  var remainingMs = bucket.startedAt + AUTH_CONFIG_.GLOBAL_RATE_LIMIT_WINDOW_SECONDS * 1000 - Date.now();
  if (remainingMs <= 0 || bucket.count <= 1) {
    cache.remove(key);
    return;
  }
  bucket.count -= 1;
  cache.put(key, JSON.stringify(bucket), Math.max(1, Math.ceil(remainingMs / 1000)));
}

function ensureAnActiveAdminRemains_(target, newRole, newActive) {
  if (target.role !== 'ADMIN' || !target.active || (newRole === 'ADMIN' && newActive)) return;
  var activeAdmins = allUserRecords_().filter(function (user) { return user.active && user.role === 'ADMIN'; }).length;
  if (activeAdmins <= 1) throw new WarehouseError_('LAST_ADMIN', 'لا يمكن تعطيل آخر مدير نشط أو تغيير دوره.');
}
