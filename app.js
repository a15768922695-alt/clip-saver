(function () {
  'use strict';

  const $ = s => document.querySelector(s);

  // ---------- 分类配置（可在此增删分类与关键词） ----------
  const CATEGORIES = [
    { key: 'movie',   name: '电影/剧集', color: '#e17055', keywords: ['电影', '豆瓣', '评分', '导演', '主演', '观影', 'imdb', '票房', '电视剧', '综艺', '纪录片', '影院', '剧', '追剧'] },
    { key: 'book',    name: '书籍',      color: '#0984e3', keywords: ['书', '作者', '出版', '小说', '书单', '豆瓣读书', 'kindle', '阅读', '出版社', '文库', '读', '新书'] },
    { key: 'fashion', name: '穿搭好物',  color: '#e84393', keywords: ['穿搭', '同款', '衣服', '裙子', '外套', '淘宝', '好物', '购买', '拼多多', '京东', '小红书', '种草', '颜值', '链接', '搭配', '包', '鞋', '淘宝', '天猫'] },
    { key: 'food',    name: '美食',      color: '#00b894', keywords: ['美食', '菜谱', '餐厅', '好吃', '探店', '做法', '食谱', '料理', '甜品', '咖啡', '探店'] },
    { key: 'quote',   name: '文字摘抄',  color: '#6c5ce7', keywords: ['句子', '语录', '名言', '文案', '摘抄', '金句', '段落', '治愈', '诗词', '文案', '短句'] },
    { key: 'other',   name: '其他',      color: '#636e72', keywords: [] }
  ];
  const CAT_MAP = Object.fromEntries(CATEGORIES.map(c => [c.key, c]));
  const CAT_ORDER_KEY = 'clipSaverCatOrder';

  function getCatOrder() {
    try {
      const saved = JSON.parse(localStorage.getItem(CAT_ORDER_KEY) || 'null');
      if (Array.isArray(saved) && saved.length === CATEGORIES.length && saved.every(k => CAT_MAP[k])) return saved;
    } catch (_) {}
    return CATEGORIES.map(c => c.key);
  }
  function setCatOrder(keys) { localStorage.setItem(CAT_ORDER_KEY, JSON.stringify(keys)); }
  function orderedCats() { return getCatOrder().map(k => CAT_MAP[k]); }

  function classify(text) {
    const t = (text || '').toLowerCase();
    let best = { key: 'other', score: 0 };
    for (const c of CATEGORIES) {
      if (c.key === 'other') continue;
      let s = 0;
      for (const k of c.keywords) if (t.includes(k.toLowerCase())) s++;
      if (s > best.score) best = { key: c.key, score: s };
    }
    return best.score > 0 ? best.key : 'other';
  }

  // ---------- IndexedDB ----------
  let _db;
  function db() {
    if (_db) return Promise.resolve(_db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('clipSaver', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('items')) d.createObjectStore('items', { keyPath: 'id', autoIncrement: true });
      };
      r.onsuccess = () => { _db = r.result; res(_db); };
      r.onerror = () => rej(r.error);
    });
  }
  function reqP(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async function getAll() {
    const d = await db();
    return reqP(d.transaction('items', 'readonly').objectStore('items').getAll())
      .then(arr => (arr || []).sort((a, b) => b.created - a.created));
  }
  async function addItem(it) { const d = await db(); return reqP(d.transaction('items', 'readwrite').objectStore('items').add(it)); }
  async function putItem(it) { const d = await db(); return reqP(d.transaction('items', 'readwrite').objectStore('items').put(it)); }
  async function delItem(id) { const d = await db(); return reqP(d.transaction('items', 'readwrite').objectStore('items').delete(id)); }
  async function getById(id) { const d = await db(); return reqP(d.transaction('items', 'readonly').objectStore('items').get(id)); }

  // ---------- 状态 ----------
  const state = { filter: 'all', q: '', currentId: null };
  let draftImage = null;   // 当前草稿图片 dataURL
  let editingId = null;    // 编辑中的条目 id
  let confirmResolve = null; // 自定义确认弹窗的 resolve

  // ---------- 视图切换 ----------
  function showView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    $('#view-' + name).classList.add('active');
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
    window.scrollTo(0, 0);
  }

  // 压缩已由裁剪环节（confirmCrop）统一处理

  // ---------- 裁剪 ----------
  const cropModal = $('#cropModal');
  const cropImg = $('#cropImg');
  const cropStage = $('#cropStage');
  const cropFrame = $('#cropFrame');
  const cropBox = $('#cropBox');
  let cropScale = 1;
  let cropState = null;
  let drag = null;

  // 读取 JPEG 的 EXIF Orientation，修正从相册选的真实照片方向（截屏 PNG 不受影响）
  function getOrientation(buf) {
    try {
      const view = new DataView(buf);
      if (view.getUint16(0) !== 0xFFD8) return 1; // 非 JPEG（如 PNG 截屏）无需处理
      const len = view.byteLength;
      let off = 2;
      while (off < len) {
        const marker = view.getUint16(off); off += 2;
        if (marker === 0xFFE1) {
          const exif = off + 2;
          if (view.getUint32(exif) === 0x45786966) { // "Exif"
            const tiff = exif + 6;
            const little = view.getUint16(tiff) === 0x4949;
            const dir = tiff + view.getUint32(tiff + 4, little);
            const entries = view.getUint16(dir, little);
            for (let i = 0; i < entries; i++) {
              const eo = dir + 2 + i * 12;
              if (view.getUint16(eo, little) === 0x0112) return view.getUint16(eo + 8, little);
            }
          }
          return 1;
        }
        if ((marker & 0xFF00) !== 0xFF00) break;
        off += view.getUint16(off);
      }
    } catch (_) {}
    return 1;
  }
  function loadImg(src) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = src;
    });
  }
  async function fixOrientation(dataUrl) {
    try {
      const buf = await (await fetch(dataUrl)).arrayBuffer();
      const orient = getOrientation(buf);
      if (orient === 1 || !orient) return dataUrl;
      const img = await loadImg(dataUrl);
      const w = img.naturalWidth, h = img.naturalHeight;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (orient === 6 || orient === 8) { canvas.width = h; canvas.height = w; }
      else { canvas.width = w; canvas.height = h; }
      ctx.save();
      switch (orient) {
        case 2: ctx.translate(w, 0); ctx.scale(-1, 1); break;
        case 3: ctx.translate(w, h); ctx.rotate(Math.PI); break;
        case 4: ctx.translate(0, h); ctx.scale(1, -1); break;
        case 5: ctx.translate(h, 0); ctx.rotate(Math.PI / 2); ctx.scale(-1, 1); break;
        case 6: ctx.translate(h, 0); ctx.rotate(Math.PI / 2); break;
        case 7: ctx.translate(0, w); ctx.rotate(-Math.PI / 2); ctx.scale(-1, 1); break;
        case 8: ctx.translate(0, w); ctx.rotate(-Math.PI / 2); break;
      }
      ctx.drawImage(img, 0, 0);
      ctx.restore();
      return canvas.toDataURL('image/jpeg', 0.92);
    } catch (_) { return dataUrl; }
  }

  function openCropper(dataUrl) {
    cropModal.hidden = false;
    cropImg.onload = () => {
      const maxW = window.innerWidth - 28;
      const maxH = Math.min(window.innerHeight * 0.6, 520);
      const natW = cropImg.naturalWidth, natH = cropImg.naturalHeight;
      const scale = Math.min(maxW / natW, maxH / natH, 1);
      cropScale = scale;
      const dw = Math.round(natW * scale), dh = Math.round(natH * scale);
      // 关键：用内层 cropFrame 作为 img 与 cropBox 的统一定位基准，避免被 flex 居中造成原点错位（黑色/上移）
      cropFrame.style.width = dw + 'px';
      cropFrame.style.height = dh + 'px';
      const w = Math.round(dw * 0.92), h = Math.round(dh * 0.92);
      cropState = { left: Math.round((dw - w) / 2), top: Math.round((dh - h) / 2), w, h };
      applyCropBox();
    };
    cropImg.src = dataUrl;
  }

  function applyCropBox() {
    cropBox.style.left = cropState.left + 'px';
    cropBox.style.top = cropState.top + 'px';
    cropBox.style.width = cropState.w + 'px';
    cropBox.style.height = cropState.h + 'px';
  }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function onPointerDown(e) {
    e.preventDefault();
    const handle = e.target.dataset && e.target.dataset.h;
    drag = { mode: handle ? 'resize-' + handle : 'move', sx: e.clientX, sy: e.clientY, box: Object.assign({}, cropState) };
    try { cropBox.setPointerCapture(e.pointerId); } catch (_) {}
  }
  function onPointerMove(e) {
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    const b = drag.box, SW = cropFrame.clientWidth, SH = cropFrame.clientHeight, MIN = 30;
    if (drag.mode === 'move') {
      cropState = { left: clamp(b.left + dx, 0, SW - b.w), top: clamp(b.top + dy, 0, SH - b.h), w: b.w, h: b.h };
    } else {
      const right = b.left + b.w, bottom = b.top + b.h;
      let left = b.left, top = b.top, w = b.w, h = b.h;
      if (drag.mode.indexOf('e') >= 0) w = clamp(b.w + dx, MIN, SW - b.left);
      if (drag.mode.indexOf('s') >= 0) h = clamp(b.h + dy, MIN, SH - b.top);
      if (drag.mode.indexOf('w') >= 0) { left = clamp(b.left + dx, 0, right - MIN); w = right - left; }
      if (drag.mode.indexOf('n') >= 0) { top = clamp(b.top + dy, 0, bottom - MIN); h = bottom - top; }
      cropState = { left, top, w, h };
    }
    applyCropBox();
  }
  function onPointerUp() { drag = null; }

  function confirmCrop() {
    const natW = cropImg.naturalWidth, natH = cropImg.naturalHeight;
    let sx = cropState.left / cropScale, sy = cropState.top / cropScale;
    let sw = cropState.w / cropScale, sh = cropState.h / cropScale;
    // 防止源矩形超出原图 → 图外区域透明 → 转 JPEG 变黑
    if (sx < 0) { sw += sx; sx = 0; }
    if (sy < 0) { sh += sy; sy = 0; }
    if (sx + sw > natW) sw = natW - sx;
    if (sy + sh > natH) sh = natH - sy;
    if (!(sw > 0 && sh > 0)) { sx = 0; sy = 0; sw = natW; sh = natH; }
    const maxDim = 1600;
    let outW = Math.round(sw), outH = Math.round(sh);
    const sc = Math.min(1, maxDim / Math.max(outW, outH));
    outW = Math.round(outW * sc); outH = Math.round(outH * sc);
    const c = document.createElement('canvas');
    c.width = outW; c.height = outH;
    c.getContext('2d').drawImage(cropImg, sx, sy, sw, sh, 0, 0, outW, outH);
    draftImage = c.toDataURL('image/jpeg', 0.82);
    $('#preview').src = draftImage; $('#preview').hidden = false;
    document.querySelector('.drop-hint').style.display = 'none';
    updateSaveState();
    closeCropper();
  }
  function closeCropper() { cropModal.hidden = true; }

  // ---------- 分类标签（带序号小色圈，去长方形） ----------
  function chip(cat) {
    const c = CAT_MAP[cat] || CAT_MAP.other;
    const idx = orderedCats().findIndex(x => x.key === (cat || 'other')) + 1;
    return '<span class="cat"><span class="cat-num" style="background:' + c.color + '">' + idx + '</span>' + c.name + '</span>';
  }

  // ---------- 侧边栏 ----------
  function openSidebar() {
    $('#sidebar').classList.add('open');
    $('#sidebarOverlay').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeSidebar() {
    $('#sidebar').classList.remove('open');
    $('#sidebarOverlay').hidden = true;
    document.body.style.overflow = '';
    stopSorting();
  }
  let sorting = false;
  function toggleSorting() {
    sorting = !sorting;
    $('#sidebar').classList.toggle('sorting', sorting);
    $('#sortToggle').textContent = sorting ? '✓ 完成排序' : '⋮⋮ 调整顺序';
    $('#sortToggle').classList.toggle('primary', sorting);
  }
  function stopSorting() {
    sorting = false;
    $('#sidebar').classList.remove('sorting');
    $('#sortToggle').textContent = '⋮⋮ 调整顺序';
    $('#sortToggle').classList.remove('primary');
  }

  // ---------- 分类拖拽排序 ----------
  let dragEl = null, dragGhost = null, dragStartY = 0, dragOffsetY = 0, dragItems = [];
  function initSortDrag() {
    const list = $('#filters');
    list.addEventListener('pointerdown', e => {
      if (!sorting) return;
      const handle = e.target.closest('.filter-handle');
      if (!handle) return;
      const item = handle.closest('.filter-item');
      if (!item || item.dataset.f === 'all') return;
      e.preventDefault();
      dragEl = item;
      const rect = item.getBoundingClientRect();
      const listRect = list.getBoundingClientRect();
      dragOffsetY = e.clientY - rect.top;
      dragStartY = e.clientY;
      dragGhost = item.cloneNode(true);
      dragGhost.classList.add('dragging');
      dragGhost.style.position = 'fixed';
      dragGhost.style.left = rect.left + 'px';
      dragGhost.style.top = rect.top + 'px';
      dragGhost.style.width = rect.width + 'px';
      dragGhost.style.pointerEvents = 'none';
      dragGhost.style.opacity = '0.95';
      document.body.appendChild(dragGhost);
      item.style.opacity = '0.35';
      dragItems = Array.from(list.querySelectorAll('.filter-item')).filter(x => x !== dragEl);
      try { list.setPointerCapture(e.pointerId); } catch (_) {}
    });
    list.addEventListener('pointermove', e => {
      if (!dragEl || !dragGhost) return;
      e.preventDefault();
      const y = e.clientY - dragOffsetY;
      dragGhost.style.top = y + 'px';
      const listRect = list.getBoundingClientRect();
      const relY = e.clientY - listRect.top + list.scrollTop;
      let best = null, bestScore = Infinity;
      for (const it of dragItems) {
        const r = it.getBoundingClientRect();
        const cy = r.top + r.height / 2 - listRect.top + list.scrollTop;
        const score = Math.abs(cy - relY);
        if (score < bestScore) { bestScore = score; best = it; }
      }
      if (best) {
        const r = best.getBoundingClientRect();
        const cy = r.top + r.height / 2;
        if (e.clientY < cy) list.insertBefore(dragEl, best);
        else list.insertBefore(dragEl, best.nextSibling);
      }
    });
    const endDrag = () => {
      if (!dragEl) return;
      if (dragGhost) { dragGhost.remove(); dragGhost = null; }
      dragEl.style.opacity = '';
      const newOrder = Array.from($('#filters').querySelectorAll('.filter-item'))
        .map(x => x.dataset.f).filter(k => k && k !== 'all');
      if (newOrder.length === CATEGORIES.length) setCatOrder(newOrder);
      dragEl = null; dragItems = [];
      // 重新渲染以应用新序号/位置
      renderFilters().then(render);
      toggleSorting(); // 完成后自动退出排序模式
    };
    list.addEventListener('pointerup', endDrag);
    list.addEventListener('pointercancel', endDrag);
  }

  // ---------- 自定义确认弹窗（绕开 iOS 原生 confirm 不弹窗的问题） ----------
  function askConfirm(text) {
    return new Promise(res => {
      confirmResolve = res;
      $('#confirmText').textContent = text;
      $('#confirmModal').hidden = false;
    });
  }

  // ---------- 渲染列表（横排条目 + 序号 + 列表内删除） ----------
  async function render() {
    const items = await getAll();
    let view = items;
    if (state.filter && state.filter !== 'all') view = view.filter(i => i.category === state.filter);
    if (state.q) {
      const q = state.q.toLowerCase();
      view = view.filter(i =>
        (i.text || '').toLowerCase().includes(q) ||
        (i.title || '').toLowerCase().includes(q) ||
        (i.link || '').toLowerCase().includes(q) ||
        (i.tags || []).join(' ').toLowerCase().includes(q));
    }
    const list = $('#list');
    $('#empty').hidden = items.length > 0;
    if (!view.length) {
      list.innerHTML = '<div class="empty" style="width:100%">没有匹配的内容</div>';
      return;
    }
    list.innerHTML = view.map((it, i) => {
      const c = CAT_MAP[it.category] || CAT_MAP.other;
      const thumbSrc = it.image || (it.text ? generateTextThumb(it.text, c.color) : (it.thumb || ''));
      const thumb = thumbSrc ? '<img class="thumb" src="' + thumbSrc + '">' : '<div class="thumb empty">📝</div>';
      const sub = (it.text || '').replace(/\n/g, ' ').slice(0, 80) || (it.tags || []).join(' ') || (it.link ? '🔗 ' + it.link : '') || '';
      return '<div class="card" data-id="' + it.id + '">' + thumb +
        '<div class="body">' + chip(it.category) +
        '<div class="ttl">' + escapeHtml(titleOf(it)) + '</div>' +
        '<div class="sub">' + escapeHtml(sub) + '</div></div>' +
        '<button class="del" type="button" data-id="' + it.id + '" aria-label="删除">×</button>' +
      '</div>';
    }).join('');
  }

  async function renderFilters() {
    const f = $('#filters');
    const items = await getAll();
    const counts = {};
    items.forEach(it => { counts[it.category] = (counts[it.category] || 0) + 1; });
    const cats = orderedCats();
    const allBtn = '<button class="filter-item' + (state.filter === 'all' ? ' active' : '') + '" data-f="all">' +
      '<span class="filter-bar" style="background:var(--primary)"></span>' +
      '<span class="filter-num" style="background:var(--primary)">✦</span>' +
      '<span class="filter-name">全部</span>' +
      '<span class="filter-count">' + items.length + '</span>' +
      '<span class="filter-handle">⋮⋮</span></button>';
    const catBtns = cats.map((c, i) => {
      const active = state.filter === c.key ? ' active' : '';
      return '<button class="filter-item' + active + '" data-f="' + c.key + '">' +
        '<span class="filter-bar" style="background:' + c.color + '"></span>' +
        '<span class="filter-num" style="background:' + c.color + '">' + (i + 1) + '</span>' +
        '<span class="filter-name">' + escapeHtml(c.name) + '</span>' +
        '<span class="filter-count">' + (counts[c.key] || 0) + '</span>' +
        '<span class="filter-handle">⋮⋮</span></button>';
    }).join('');
    f.innerHTML = allBtn + catBtns;
  }

  function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }
  // 显示标题时自动回退：自定义标题 > 文字第一行 > 链接 > 柔和兜底
  function titleOf(it) {
    const t = (it.title || '').trim();
    if (t && t !== '未命名') return t.length > 42 ? t.slice(0, 42) + '…' : t;
    const line = (it.text || '').split('\n')[0].trim();
    if (line) return line.length > 42 ? line.slice(0, 42) + '…' : line;
    const link = (it.link || '').trim();
    if (link) return link.length > 42 ? link.slice(0, 42) + '…' : link;
    return '一条收藏';
  }

  // 从文字内容中提取标题候选
  function extractTitleCandidates(text) {
    const lines = text.split('\n').map(s => s.trim()).filter(s => s.length > 0);
    const out = [];
    for (const line of lines) {
      if (out.length >= 6) break;
      if (line.length <= 60) { out.push(line); continue; }
      const parts = line.split(/([。！？.!?]+)/);
      let buf = '';
      for (let i = 0; i < parts.length; i++) {
        buf += parts[i];
        if (/[。！？.!?]$/.test(parts[i]) || i === parts.length - 1) {
          const s = buf.trim();
          if (s) out.push(s);
          buf = '';
          if (out.length >= 6) break;
        }
      }
    }
    return out.slice(0, 6);
  }
  function openTitlePicker() {
    const text = $('#text').value.trim();
    if (!text) { alert('先输入文字内容'); return; }
    const candidates = extractTitleCandidates(text);
    if (!candidates.length) { alert('没有可提取的句子'); return; }
    const body = $('#titlePickerBody');
    body.innerHTML = candidates.map(c =>
      '<button class="sheet-item" type="button">' + escapeHtml(c.length > 60 ? c.slice(0, 60) + '…' : c) + '</button>'
    ).join('');
    $('#titlePicker').hidden = false;
  }
  function closeTitlePicker() { $('#titlePicker').hidden = true; }

  // 文字缩略图：无图时给列表一个统一的小图
  function hexToRgba(hex, alpha) {
    const m = hex.replace('#', '').match(/(.{2})(.{2})(.{2})/);
    if (!m) return 'rgba(241,240,254,' + alpha + ')';
    return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + alpha + ')';
  }
  function generateTextThumb(text, color) {
    const size = 112;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    // 纯白底（JPEG 导出前先铺白，避免透明区变黑）
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    // 顶部一道分类色细条，区分条目又保持白底清爽
    ctx.fillStyle = hexToRgba(color || '#6c5ce7', 0.9);
    ctx.fillRect(0, 0, size, 4);
    ctx.fillStyle = '#2d3436';
    ctx.font = '12px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    ctx.textBaseline = 'top';
    const sample = (text || '').replace(/\n/g, ' ').trim().slice(0, 40) + ((text || '').length > 40 ? '…' : '');
    const lineH = 17;
    const lines = [];
    let line = '';
    for (const ch of sample) {
      const test = line + ch;
      if (ctx.measureText(test).width > size - 16 && line) {
        lines.push(line);
        line = ch;
        if (lines.length >= 4) break;
      } else { line = test; }
    }
    if (line && lines.length < 4) lines.push(line);
    let y = 14;
    for (const l of lines) { ctx.fillText(l, 8, y); y += lineH; }
    return c.toDataURL('image/jpeg', 0.92);
  }

  // 仅允许 http/https 链接，避免 javascript: 等危险协议
  function safeUrl(u) {
    try { const p = new URL(u); if (p.protocol === 'http:' || p.protocol === 'https:') return p.href; } catch (e) {}
    return '';
  }

  // 有图 / 有链接 / 有标题 / 有文字 任一即可保存
  function updateSaveState() {
    const has = draftImage || $('#title').value.trim() || $('#link').value.trim() || $('#text').value.trim();
    $('#saveBtn').disabled = !has;
  }

  // ---------- 全屏看图 ----------
  function openLightbox(src) {
    if (!src) return;
    $('#lightboxImg').src = src;
    $('#lightbox').hidden = false;
  }
  function closeLightbox() { $('#lightbox').hidden = true; $('#lightboxImg').src = ''; }

  // ---------- 详情 ----------
  async function openDetail(id) {
    const it = await getById(id);
    if (!it) return;
    state.currentId = id;
    $('#detail').innerHTML =
      (it.image ? '<figure class="shot" id="detailShot"><img src="' + it.image + '"><figcaption>👆 点击图片看大图</figcaption></figure>' : '') +
      '<div class="meta">' +
      chip(it.category) +
      '<h3>' + escapeHtml(titleOf(it)) + '</h3>' +
      (it.tags && it.tags.length ? '<div class="tags">' + it.tags.map(t => '<span class="tag">#' + escapeHtml(t) + '</span>').join('') + '</div>' : '') +
      (it.text ? '<div class="text">' + escapeHtml(it.text) + '</div>' : '') +
      (it.link ? (function () { const u = safeUrl(it.link); return u ? '<a class="link" href="' + u + '" target="_blank" rel="noopener">🔗 ' + escapeHtml(it.link) + '</a>' : '<div class="link-text">🔗 ' + escapeHtml(it.link) + '</div>'; })() : '') +
      '<div class="time">创建：' + new Date(it.created).toLocaleString('zh-CN') +
      (it.updated && it.updated !== it.created ? '　·　更新：' + new Date(it.updated).toLocaleString('zh-CN') : '') + '</div>' +
      '</div>';
    showView('detail');
  }

  // ---------- 表单 ----------
  function resetForm() {
    editingId = null; draftImage = null;
    $('#title').value = ''; $('#tags').value = ''; $('#text').value = ''; $('#link').value = '';
    $('#category').value = 'other'; $('#autoHint').textContent = '';
    $('#preview').hidden = true; $('#preview').src = '';
    document.querySelector('.drop-hint').style.display = '';
    updateSaveState();
  }
  function loadToForm(it) {
    editingId = it.id; draftImage = it.image || null;
    $('#title').value = titleOf(it);
    $('#link').value = it.link || '';
    $('#category').value = it.category || 'other';
    $('#tags').value = (it.tags || []).join(', ');
    $('#text').value = it.text || '';
    if (it.image) { $('#preview').src = it.image; $('#preview').hidden = false; document.querySelector('.drop-hint').style.display = 'none'; }
    updateSaveState(); updateAutoHint();
    showView('add');
  }

  async function save() {
    const text = $('#text').value.trim();
    const link = $('#link').value.trim();
    const title = $('#title').value.trim() || (text.split('\n')[0].slice(0, 40)) || (link ? link : '未命名');
    const category = $('#category').value;
    const item = {
      title,
      link,
      category,
      tags: $('#tags').value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
      text,
      image: draftImage,
      created: editingId ? (await getById(editingId)).created : Date.now(),
      updated: Date.now()
    };
    if (editingId) { item.id = editingId; await putItem(item); }
    else await addItem(item);
    resetForm();
    state.filter = 'all'; state.q = ''; $('#search').value = '';
    await renderFilters(); render(); showView('library');
  }

  // ---------- 初始化 ----------
  async function init() {
    // 分类下拉
    $('#category').innerHTML = orderedCats().map(c => '<option value="' + c.key + '">' + c.name + '</option>').join('');
    await renderFilters(); render();

    // tab
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => showView(t.dataset.view)));

    // 筛选
    $('#filters').addEventListener('click', e => {
      const b = e.target.closest('.filter-item'); if (!b) return;
      if ($('#sidebar').classList.contains('sorting')) return; // 排序模式下点选无效
      state.filter = b.dataset.f;
      renderFilters(); render();
      if (window.innerWidth < 720) closeSidebar();
    });

    // 搜索
    let to;
    $('#search').addEventListener('input', e => {
      clearTimeout(to);
      to = setTimeout(() => { state.q = e.target.value.trim(); render(); }, 200);
    });

    // 列表点击（缩略图→看大图；其余→进详情；删除按钮→确认删除）
    $('#list').addEventListener('click', e => {
      const delBtn = e.target.closest('.del');
      if (delBtn) {
        e.stopPropagation();
        const id = Number(delBtn.dataset.id);
        askConfirm('确定删除这条收藏？').then(ok => { if (ok) delItem(id).then(render); });
        return;
      }
      const thumb = e.target.closest('.thumb');
      if (thumb) {
        const src = thumb.getAttribute('src');
        if (src) { openLightbox(src); return; }
      }
      const card = e.target.closest('.card'); if (card) openDetail(Number(card.dataset.id));
    });

    // 详情页：点击图片弹大图
    $('#detail').addEventListener('click', e => {
      const shot = e.target.closest('.shot');
      if (shot) {
        const img = shot.querySelector('img');
        if (img && img.src) openLightbox(img.src);
      }
    });

    // 全屏看图：关闭按钮 / 点背景 / 返回手势
    $('#lightboxClose').addEventListener('click', closeLightbox);
    $('#lightbox').addEventListener('click', e => { if (e.target === $('#lightbox')) closeLightbox(); });

    // 选图 → 进入裁剪
    $('#file').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      const reader = new FileReader();
      reader.onload = async () => {
        const fixed = await fixOrientation(reader.result); // 先摆正方向，再进入裁剪
        openCropper(fixed);
      };
      reader.readAsDataURL(f);
      e.target.value = '';
    });

    $('#cropCancel').addEventListener('click', closeCropper);
    $('#cropReset').addEventListener('click', () => {
      const dw = cropFrame.clientWidth, dh = cropFrame.clientHeight;
      cropState = { left: 0, top: 0, w: dw, h: dh };
      applyCropBox();
    });
    $('#cropConfirm').addEventListener('click', confirmCrop);
    cropBox.addEventListener('pointerdown', onPointerDown);
    cropBox.addEventListener('pointermove', onPointerMove);
    cropBox.addEventListener('pointerup', onPointerUp);
    cropBox.addEventListener('pointercancel', onPointerUp);
    $('#copyBtn').addEventListener('click', async () => {
      const t = $('#text').value;
      try { await navigator.clipboard.writeText(t); $('#copyBtn').textContent = '✓ 已复制'; setTimeout(() => $('#copyBtn').textContent = '📋 复制文字', 1500); }
      catch { alert('请手动长按文字选择复制'); }
    });
    $('#pickTitleBtn').addEventListener('click', openTitlePicker);
    $('#titlePickerClose').addEventListener('click', closeTitlePicker);
    $('#titlePickerBody').addEventListener('click', e => {
      const btn = e.target.closest('.sheet-item'); if (!btn) return;
      $('#title').value = btn.textContent;
      updateSaveState(); updateAutoHint();
      closeTitlePicker();
    });
    function updateAutoHint() {
      const text = $('#text').value.trim();
      const title = $('#title').value.trim();
      $('#autoHint').textContent = (text && !title) ? '可点「从文字选」挑标题' : '';
    }
    $('#saveBtn').addEventListener('click', save);
    // 链接/标题/文字任一有内容即可保存（支持只存链接不传图）
    ['#title', '#link', '#text'].forEach(sel => $(sel).addEventListener('input', () => { updateSaveState(); updateAutoHint(); }));

    // 详情操作
    $('#editBtn').addEventListener('click', () => { if (state.currentId != null) getById(state.currentId).then(loadToForm); });
    $('#delBtn').addEventListener('click', () => {
      if (state.currentId == null) return;
      askConfirm('确定删除这条收藏？').then(ok => {
        if (ok) delItem(state.currentId).then(() => { state.currentId = null; render(); showView('library'); });
      });
    });

    // 确认弹窗按钮
    $('#confirmOk').addEventListener('click', () => {
      $('#confirmModal').hidden = true;
      const r = confirmResolve; confirmResolve = null; if (r) r(true);
    });
    $('#confirmCancel').addEventListener('click', () => {
      $('#confirmModal').hidden = true;
      const r = confirmResolve; confirmResolve = null; if (r) r(false);
    });

    // 关于：导出 / 导入
    $('#exportBtn').addEventListener('click', async () => {
      const items = await getAll();
      const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'clip-saver-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
    });
    $('#importBtn').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const arr = JSON.parse(await f.text());
        for (const it of arr) { if (it.id) await putItem(it); else await addItem(it); }
        render(); alert('导入完成：' + arr.length + ' 条');
      } catch (err) { alert('导入失败：文件格式不正确'); }
      e.target.value = '';
    });

    // 侧边栏事件
    $('#sidebarOpen').addEventListener('click', openSidebar);
    $('#sidebarClose').addEventListener('click', closeSidebar);
    $('#sidebarOverlay').addEventListener('click', closeSidebar);
    $('#sortToggle').addEventListener('click', toggleSorting);
    initSortDrag();

    // Service Worker
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      let swReloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!swReloaded) { swReloaded = true; location.reload(); }
      });
      window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
