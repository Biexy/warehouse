/** Excel backup configuration and Drive v3 export. */

var XLSX_MIME_TYPE_ = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * configureBackupFolder(token,{folderId})
 * -> {folderId,folderName}; ADMIN only. The source Sheet is not shared.
 */
function configureBackupFolder(token, payload) {
  return apiResult_(function () {
    payload = requireObject_(payload, 'مجلد النسخ الاحتياطي');
    return withScriptLock_(function () {
      var session = requireSession_(token, ['ADMIN']);
      var folderId = normalizeDriveFolderId_(payload.folderId);
      var folder;
      try {
        folder = DriveApp.getFolderById(folderId);
        folder.getName();
      } catch (error) {
        throw new WarehouseError_('BACKUP_FOLDER_UNAVAILABLE', 'تعذر فتح مجلد النسخ الاحتياطي. تحقق من المعرف وصلاحيات مالك التطبيق.');
      }
      setSettingValue_('BACKUP_FOLDER_ID', folderId, 'DRIVE_FOLDER_ID', 'معرف مجلد نسخ Excel الاحتياطية', session.user.username);
      appendAuditRecord_({
        actor: session.user,
        action: 'BACKUP_FOLDER_CONFIGURE',
        entityType: 'SETTING',
        entityId: 'BACKUP_FOLDER_ID',
        status: 'SUCCESS',
        details: { folderId: folderId, folderName: folder.getName() }
      });
      return { folderId: folderId, folderName: folder.getName() };
    });
  });
}

/**
 * createBackup(token) -> {fileId,fileName,url,createdAt,sizeBytes,folderId}
 * Uses Drive API files.export via UrlFetchApp. OAuth credentials never leave
 * the server and are never included in either success or error responses.
 */
function createBackup(token) {
  return apiResult_(function () {
    return withScriptLock_(function () {
      var session = requireSession_(token, ['ADMIN']);
      var folderId = getSettingValue_('BACKUP_FOLDER_ID');
      if (!folderId) {
        throw new WarehouseError_('BACKUP_FOLDER_NOT_CONFIGURED', 'حدد مجلد النسخ الاحتياطي من الإعدادات أولاً.');
      }
      var spreadsheet = getBoundSpreadsheet_();
      SpreadsheetApp.flush();
      var timestamp = Utilities.formatDate(new Date(), WAREHOUSE_CONFIG_.TIME_ZONE, 'yyyyMMdd-HHmmss');
      var safeBaseName = spreadsheet.getName().replace(/[\\\/:*?"<>|\u0000-\u001F]/g, '-').substring(0, 100) || 'warehouse';
      var fileName = safeBaseName + '-backup-' + timestamp + '.xlsx';
      var exportUrl = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(spreadsheet.getId()) +
        '/export?mimeType=' + encodeURIComponent(XLSX_MIME_TYPE_);
      var response;
      try {
        response = UrlFetchApp.fetch(exportUrl, {
          method: 'get',
          headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
          muteHttpExceptions: true
        });
      } catch (error) {
        throw new WarehouseError_('BACKUP_EXPORT_FAILED', 'تعذر تصدير نسخة Excel.');
      }
      if (response.getResponseCode() !== 200) {
        console.error('Drive files.export failed with HTTP ' + response.getResponseCode());
        throw new WarehouseError_('BACKUP_EXPORT_FAILED', 'تعذر تصدير نسخة Excel.', { httpStatus: response.getResponseCode() });
      }
      var blob = response.getBlob().setContentType(XLSX_MIME_TYPE_).setName(fileName);

      if (getSettingValue_('BACKUP_FOLDER_ID') !== folderId) {
        throw new WarehouseError_('BACKUP_FOLDER_CHANGED', 'تغير مجلد النسخ أثناء التصدير. أعد المحاولة.');
      }
      var folder;
      try { folder = DriveApp.getFolderById(folderId); } catch (error) {
        throw new WarehouseError_('BACKUP_FOLDER_UNAVAILABLE', 'مجلد النسخ الاحتياطي غير متاح.');
      }
      var file;
      try {
        file = folder.createFile(blob);
      } catch (error) {
        throw new WarehouseError_('BACKUP_SAVE_FAILED', 'تم التصدير لكن تعذر حفظ الملف في مجلد Drive.');
      }
      try { file.setDescription('نسخة Excel احتياطية من ' + WAREHOUSE_CONFIG_.APP_NAME); } catch (descriptionError) {
        console.warn('Backup created but description could not be set: ' + descriptionError.message);
      }
      var createdAt = new Date();
      var metadata = {
        fileId: file.getId(),
        fileName: file.getName(),
        url: file.getUrl(),
        createdAt: createdAt.toISOString(),
        sizeBytes: blob.getBytes().length,
        folderId: folderId
      };
      try {
        appendAuditRecord_({
          actor: session.user,
          action: 'BACKUP_CREATE',
          entityType: 'DRIVE_FILE',
          entityId: metadata.fileId,
          status: 'SUCCESS',
          details: { fileName: metadata.fileName, sizeBytes: metadata.sizeBytes, folderId: folderId }
        });
      } catch (auditError) {
        // Never report backup failure after Drive has already persisted it;
        // that would encourage a retry and duplicate backup files.
        console.error('Backup audit append failed for ' + metadata.fileId + ': ' + auditError.message);
      }
      return metadata;
    });
  });
}

function normalizeDriveFolderId_(value) {
  var text = requireText_(value, 'معرف مجلد Drive', 300, false);
  var urlMatch = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(text);
  var id = urlMatch ? urlMatch[1] : text;
  if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) {
    throw new WarehouseError_('VALIDATION_ERROR', 'معرف مجلد Drive غير صالح.', { field: 'folderId' });
  }
  return id;
}
