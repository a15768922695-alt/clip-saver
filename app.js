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
  const cropBox = $('#cropBox');
  let cropScale = 1;
  let cropState = null;
  let drag = null;

  function openCropper(dataUrl) {
    cropModal.hidden = false;
    cropImg.onload = () => {
      const maxW = window.innerWidth - 28;
      const maxH = Math.min(window.innerHeight * 0.6, 520);
      const natW = cropImg.naturalWidth, natH = cropImg.naturalHeight;
      const scale = Math.min(maxW / natW, maxH / natH, 1);
      cropScale = scale;
      const dw = Math.round(natW * scale), dh = Math.round(natH * scale);
      cropImg.style.width = dw + 'px';
      cropImg.style.height = dh + 'px';
      cropStage.style.width = dw + 'px';
      cropStage.style.height = dh + 'px';
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
    const b = drag.box, SW = cropStage.clientWidth, SH = cropStage.clientHeight, MIN = 30;
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
    const sx = cropState.left / cropScale, sy = cropState.top / cropScale;
    const sw = cropState.w / cropScale, sh = cropState.h / cropScale;
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
    $('#saveBtn').disabled = false;
    closeCropper();
  }
  function closeCropper() { cropModal.hidden = true; }

  // ---------- 分类标签（带序号小色圈，去长方形） ----------
  function chip(cat) {
    const c = CAT_MAP[cat] || CAT_MAP.other;
    const idx = CATEGORIES.findIndex(x => x.key === (cat || 'other')) + 1;
    return '<span class="cat"><span class="cat-num" style="background:' + c.color + '">' + idx + '</span>' + c.name + '</span>';
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
        (i.tags || []).join(' ').toLowerCase().includes(q));
    }
    const list = $('#list');
    $('#empty').hidden = items.length > 0;
    if (!view.length) {
      list.innerHTML = '<div class="empty" style="width:100%">没有匹配的内容</div>';
      return;
    }
    list.innerHTML = view.map((it, i) => {
      const thumb = it.image ? '<img class="thumb" src="' + it.image + '">' : '<div class="thumb empty"></div>';
      const sub = (it.text || '').replace(/\n/g, ' ').slice(0, 50) || (it.tags || []).join(' ') || '（仅图片）';
      return '<div class="card" data-id="' + it.id + '">' +
        '<div class="seq">' + (i + 1) + '</div>' + thumb +
        '<div class="body">' + chip(it.category) +
        '<div class="ttl">' + escapeHtml(it.title || '未命名') + '</div>' +
        '<div class="sub">' + escapeHtml(sub) + '</div></div>' +
        '<button class="del" type="button" data-id="' + it.id + '" aria-label="删除">×</button>' +
      '</div>';
    }).join('');
  }

  function renderFilters() {
    const f = $('#filters');
    const all = [{ key: 'all', name: '全部', color: 'var(--primary)' }].concat(
      CATEGORIES.map((c, i) => Object.assign({}, c, { _n: i + 1 }))
    );
    f.innerHTML = all.map(c =>
      '<button class="chip' + (state.filter === c.key ? ' active' : '') + '" data-f="' + c.key + '">' +
      (c._n ? '<span class="chip-num">' + c._n + '</span>' : '') + c.name + '</button>'
    ).join('');
  }

  function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
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
    const c = CAT_MAP[it.category] || CAT_MAP.other;
    $('#detail').innerHTML =
      (it.image ? '<figure class="shot" id="detailShot"><img src="' + it.image + '"><figcaption>👆 点击图片看大图</figcaption></figure>' : '') +
      '<div class="meta">' +
      chip(it.category) +
      '<h3>' + escapeHtml(it.title || '未命名') + '</h3>' +
      (it.tags && it.tags.length ? '<div class="tags">' + it.tags.map(t => '<span class="tag">#' + escapeHtml(t) + '</span>').join('') + '</div>' : '') +
      (it.text ? '<div class="text">' + escapeHtml(it.text) + '</div>' : '') +
      '<div class="time">创建：' + new Date(it.created).toLocaleString('zh-CN') +
      (it.updated && it.updated !== it.created ? '　·　更新：' + new Date(it.updated).toLocaleString('zh-CN') : '') + '</div>' +
      '</div>';
    showView('detail');
  }

  // ---------- 表单 ----------
  function resetForm() {
    editingId = null; draftImage = null;
    $('#title').value = ''; $('#tags').value = ''; $('#text').value = '';
    $('#category').value = 'other'; $('#autoHint').textContent = '';
    $('#preview').hidden = true; $('#preview').src = '';
    document.querySelector('.drop-hint').style.display = '';
    $('#saveBtn').disabled = true;
  }
  function loadToForm(it) {
    editingId = it.id; draftImage = it.image || null;
    $('#title').value = it.title || '';
    $('#category').value = it.category || 'other';
    $('#tags').value = (it.tags || []).join(', ');
    $('#text').value = it.text || '';
    if (it.image) { $('#preview').src = it.image; $('#preview').hidden = false; document.querySelector('.drop-hint').style.display = 'none'; }
    $('#saveBtn').disabled = false;
    showView('add');
  }

  async function save() {
    const text = $('#text').value.trim();
    const title = $('#title').value.trim() || (text.split('\n')[0].slice(0, 40)) || '未命名';
    const item = {
      title,
      category: $('#category').value,
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
    renderFilters(); render(); showView('library');
  }

  // ---------- 初始化 ----------
  function init() {
    // 分类下拉
    $('#category').innerHTML = CATEGORIES.map(c => '<option value="' + c.key + '">' + c.name + '</option>').join('');
    renderFilters(); render();

    // tab
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => showView(t.dataset.view)));

    // 筛选
    $('#filters').addEventListener('click', e => {
      const b = e.target.closest('.chip'); if (!b) return;
      state.filter = b.dataset.f; renderFilters(); render();
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
    $('#file').addEventListener('change', e => {
      const f = e.target.files[0]; if (!f) return;
      const reader = new FileReader();
      reader.onload = () => openCropper(reader.result);
      reader.readAsDataURL(f);
      e.target.value = '';
    });

    $('#cropCancel').addEventListener('click', closeCropper);
    $('#cropReset').addEventListener('click', () => {
      const dw = cropStage.clientWidth, dh = cropStage.clientHeight;
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
    $('#saveBtn').addEventListener('click', save);

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
