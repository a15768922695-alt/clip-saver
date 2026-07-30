// 生成本地可用的单文件版（file:// 打开，无外部依赖，用 localStorage 存数据）
const fs = require('fs');
const path = require('path');

const root = __dirname;
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
let js = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

// 1. 内联 CSS
html = html.replace(
  /<link rel="stylesheet" href="styles\.css">/,
  '<style>\n' + css + '\n</style>'
);

// 2. 内联 JS：并把 IndexedDB 存储替换成 localStorage，移除 Service Worker 注册
const storageReplacement = `
  // ---------- localStorage 存储（单文件版 file:// 兼容） ----------
  const LS_KEY = 'clipSaverStandalone';
  function lsRead() {
    try { const raw = localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : []; }
    catch (e) { return []; }
  }
  function lsWrite(arr) { try { localStorage.setItem(LS_KEY, JSON.stringify(arr)); } catch (e) {} }
  function getAll() {
    return Promise.resolve(lsRead().sort((a, b) => (b.created || 0) - (a.created || 0)));
  }
  async function addItem(it) {
    const arr = lsRead();
    it.id = Date.now() + Math.floor(Math.random() * 1000);
    arr.push(it);
    lsWrite(arr);
    return it.id;
  }
  async function putItem(it) {
    const arr = lsRead();
    const idx = arr.findIndex(x => x.id === it.id);
    if (idx >= 0) arr[idx] = it; else arr.push(it);
    lsWrite(arr);
  }
  async function delItem(id) {
    const arr = lsRead().filter(x => x.id !== id);
    lsWrite(arr);
  }
  async function getById(id) {
    return lsRead().find(x => x.id === id) || null;
  }
`;

// 替换整个 IndexedDB 块
js = js.replace(
  /\/\/ ---------- IndexedDB ----------[\s\S]*?async function getById\(id\) \{[\s\S]*?\}/,
  storageReplacement.trim()
);

// 移除 Service Worker 注册
js = js.replace(
  /\/\/ Service Worker[\s\S]*?\}\s*\}\s*$/,
  '  // 单文件版不注册 Service Worker（file:// 不支持）\n'
);

html = html.replace(
  /<script src="app\.js"><\/script>/,
  '<script>\n' + js + '\n</script>'
);

// 3. 移除 manifest 和 apple-touch-icon（本地文件无法加载）
html = html.replace(/<link rel="manifest" href="manifest\.webmanifest">\n/, '');
html = html.replace(/<link rel="apple-touch-icon" href="icon-apple\.png">\n/, '');

// 4. 版本号提示改为 standalone
html = html.replace(/<div class="ver">v\d+<\/div>/, '<div class="ver">v11-standalone</div>');

fs.writeFileSync(path.join(root, 'clip-saver-standalone.html'), html, 'utf8');
console.log('clip-saver-standalone.html generated:', html.length, 'chars');

// 语法校验
try {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (m) new Function(m[1]);
  console.log('JS syntax OK');
} catch (e) {
  console.error('JS syntax error:', e.message);
  process.exit(1);
}
