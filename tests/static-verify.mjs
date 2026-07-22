import fs from 'node:fs';

const backendFiles = ['Code.gs', 'Auth.gs', 'Repository.gs', 'Inventory.gs', 'CatalogImport.gs', 'Export.gs'];
const backend = backendFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const index = fs.readFileSync('Index.html', 'utf8');
const app = fs.readFileSync('App.html', 'utf8');
const styles = fs.readFileSync('Styles.html', 'utf8');
const tokens = fs.readFileSync('tokens.css', 'utf8');

new Function(backend);
JSON.parse(fs.readFileSync('appsscript.json', 'utf8'));

const scriptMatch = app.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) throw new Error('App.html script block is missing.');
new Function(scriptMatch[1]);

const csvCellMatch = scriptMatch[1].match(/function csvCell\(value\)\s*\{([\s\S]*?)\n\s*\}/);
if (!csvCellMatch) throw new Error('csvCell() was not found.');
const csvCell = new Function(`return function csvCell(value) {${csvCellMatch[1]}\n}`)();
if (csvCell(-5) !== '"-5"') throw new Error('Negative report numbers must remain numeric in CSV.');
if (csvCell('=SUM(A1:A2)') !== '"\'=SUM(A1:A2)"') throw new Error('CSV formula-injection protection is missing for text.');

const ids = [...index.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const duplicateIds = [...new Set(ids.filter((id, position) => ids.indexOf(id) !== position))];
if (duplicateIds.length) throw new Error(`Duplicate HTML IDs: ${duplicateIds.join(', ')}`);

const cacheBlock = scriptMatch[1].match(/function cacheDom\(\)\s*\{([\s\S]*?)\n\s*\}/);
if (!cacheBlock) throw new Error('cacheDom() was not found.');
const cachedIds = [...cacheBlock[1].matchAll(/'([A-Za-z][A-Za-z0-9]+)'/g)].map((match) => match[1]);
const missingCachedIds = cachedIds.filter((id) => !ids.includes(id));
if (missingCachedIds.length) throw new Error(`Missing cached DOM IDs: ${missingCachedIds.join(', ')}`);

const symbols = new Set([...index.matchAll(/\bid="(icon-[^"]+)"/g)].map((match) => match[1]));
const iconUses = [...index.matchAll(/<use\s+href="#([^"]+)"/g)].map((match) => match[1]);
const missingIcons = [...new Set(iconUses.filter((id) => !symbols.has(id)))];
if (missingIcons.length) throw new Error(`Missing SVG symbols: ${missingIcons.join(', ')}`);

const backendFunctions = new Set([...backend.matchAll(/function\s+([A-Za-z0-9_$]+)\s*\(/g)].map((match) => match[1]));
const rpcNames = [...new Set([...scriptMatch[1].matchAll(/rpc\('([^']+)'/g)].map((match) => match[1]))];
const missingRpcFunctions = rpcNames.filter((name) => !backendFunctions.has(name));
if (missingRpcFunctions.length) throw new Error(`Missing backend RPC functions: ${missingRpcFunctions.join(', ')}`);

const unsafeChecks = [
  ['innerHTML assignment', /\.innerHTML\s*=/],
  ['outerHTML assignment', /\.outerHTML\s*=/],
  ['insertAdjacentHTML', /insertAdjacentHTML\s*\(/],
  ['eval', /\beval\s*\(/],
  ['document.write', /document\.write\s*\(/],
  ['transition all', /transition\s*:\s*all\b/]
];
const frontend = `${index}\n${app}\n${styles}`;
unsafeChecks.forEach(([label, pattern]) => {
  if (pattern.test(frontend)) throw new Error(`Unsafe frontend pattern: ${label}`);
});

const tokenValues = Object.fromEntries([...tokens.matchAll(/--([A-Za-z0-9-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
const styleValues = Object.fromEntries([...styles.matchAll(/--([A-Za-z0-9-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
const driftedTokens = Object.keys(tokenValues).filter((name) => styleValues[name] !== tokenValues[name]);
if (driftedTokens.length) throw new Error(`Styles.html token drift: ${driftedTokens.join(', ')}`);

console.log(`backend syntax: ok (${backendFunctions.size} functions)`);
console.log('manifest JSON: ok');
console.log(`frontend syntax: ok (${ids.length} unique IDs, ${cachedIds.length} cached)`);
console.log(`icons: ok (${iconUses.length} uses, ${symbols.size} symbols)`);
console.log(`RPC mappings: ok (${rpcNames.length})`);
console.log(`design tokens: aligned (${Object.keys(tokenValues).length})`);
console.log('unsafe-pattern scan: clean');
