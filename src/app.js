import Cropper, { DEFAULT_TEMPLATE } from 'cropperjs';
import justifiedLayout from 'justified-layout';
import { getPaletteSync } from 'colorthief';
import { PageFlip } from 'page-flip';

const $ = id => document.getElementById(id);
const styleNames = { daily: '生活记录', voyage: '旅行特刊', duet: '双人故事' };
const clone = value => JSON.parse(JSON.stringify(value));
const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
let photos = [], model = null, flip = null, cropper = null, cropId = null, current = 0;
let busy = false, saveTimer, toastTimer, editIndex = 0, editBuffer, resumeDraft;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4000); }
function formState() { return { title: $('title').value.trim() || '我们的日常', story: $('story').value, style: document.querySelector('input[name=style]:checked').value }; }
function setForm(data) { $('title').value = data.title || '我们的日常'; $('story').value = data.story || ''; document.querySelector(`input[name=style][value="${styleNames[data.style] ? data.style : 'daily'}"]`).checked = true; }
function selectedPhotos() { return photos.filter(p => p.selected); }

const dbPromise = new Promise((resolve, reject) => {
  if (!globalThis.indexedDB) return reject(new Error('浏览器未开放本地存储'));
  const request = indexedDB.open('photo-edition-drafts', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('drafts');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
}).catch(() => null);
async function readDraft() {
  const db = await dbPromise; if (!db) return null;
  return new Promise(resolve => { const req = db.transaction('drafts').objectStore('drafts').get('latest'); req.onsuccess = () => resolve(req.result); req.onerror = () => resolve(null); });
}
async function readLegacyDraft() {
  try {
    const legacy = JSON.parse(localStorage.getItem('photo-edition-draft'));
    if (!legacy?.photos?.length || !Array.isArray(legacy.pages)) return null;
    const migrated = [];
    for (const p of legacy.photos.slice(0, 20)) {
      if (!/^data:image\/(jpeg|png|webp);base64,/.test(p.src)) return null;
      const canvas = scaledCanvas(await loadImage(p.src), 2000), metadata = imageMetadata(canvas);
      migrated.push({ id: p.id || uid(), name: p.alt || '照片', src: p.src, originalSrc: p.src, width: canvas.width, height: canvas.height, originalWidth: canvas.width, originalHeight: canvas.height, originalMetadata: metadata, fit: 'contain', selected: true, ...metadata });
    }
    const pages = legacy.pages.map(p => ({ type: ({ cover: 'cover', collage: 'pair', full: 'feature', letter: 'letter' })[p.layout] || 'feature', photoIds: (p.photos || []).filter(id => migrated.some(photo => photo.id === id)), heading: p.title || '', body: p.body || '', caption: p.caption || '', edited: true }));
    const form = { title: legacy.title || '我们的日常', style: styleNames[legacy.style] ? legacy.style : 'daily', story: pages.map(p => p.body).filter(Boolean).join('\n') };
    if (pages.length === 1) pages.push({ type: 'back', photoIds: [], heading: form.title, body: '', caption: '' });
    return { version: 2, photos: migrated, form, phase: 'reader', current: 0, model: { version: 2, id: legacy.id || uid(), ...form, coverId: migrated[0].id, pages, basePages: clone(pages) } };
  } catch { return null; }
}
async function saveDraft() {
  clearTimeout(saveTimer);
  if (!photos.length) return;
  const db = await dbPromise;
  if (!db) { $('draft-status').textContent = '本地存储不可用，请下载保存'; return; }
  const data = { version: 2, savedAt: Date.now(), phase: $('reader').hidden ? 'maker' : 'reader', photos: clone(photos), form: formState(), model: model ? clone(model) : null, current };
  await new Promise(resolve => {
    const tx = db.transaction('drafts', 'readwrite'); tx.objectStore('drafts').put(data, 'latest');
    tx.oncomplete = () => { $('draft-status').textContent = '草稿已保存在本机'; resolve(); };
    tx.onerror = tx.onabort = () => { $('draft-status').textContent = '保存失败，请下载网页备份'; resolve(); };
  });
}
function scheduleSave() { clearTimeout(saveTimer); $('draft-status').textContent = '正在保存…'; saveTimer = setTimeout(saveDraft, 650); }

function loadImage(src) { return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('无法读取这张照片')); image.src = src; }); }
function scaledCanvas(image, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.round((image.naturalWidth || image.width) * scale); canvas.height = Math.round((image.naturalHeight || image.height) * scale);
  const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height); return canvas;
}
function imageMetadata(canvas) {
  const thumbnail = scaledCanvas(canvas, 360);
  let colors = [];
  try { colors = (getPaletteSync(thumbnail, { colorCount: 5, quality: 5 }) || []).map(color => color.hex()); } catch { /* A plain white photo can have no extracted palette. */ }
  const hashCanvas = document.createElement('canvas'); hashCanvas.width = 9; hashCanvas.height = 8;
  const ctx = hashCanvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(canvas, 0, 0, 9, 8);
  const raw = ctx.getImageData(0, 0, 9, 8).data, greys = [];
  for (let i = 0; i < raw.length; i += 4) greys.push(raw[i] * .299 + raw[i + 1] * .587 + raw[i + 2] * .114);
  let hash = ''; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) hash += greys[y * 9 + x] > greys[y * 9 + x + 1] ? '1' : '0';
  return { thumb: thumbnail.toDataURL('image/jpeg', .8), colors, hash, luminance: greys.reduce((a, b) => a + b, 0) / greys.length };
}
async function addFiles(files) {
  if (busy) return;
  const candidates = [...files].filter(f => /^image\/(jpeg|png|webp)$/.test(f.type));
  if (candidates.length !== files.length) toast('支持 JPG、PNG 和 WebP；请先转换其他格式。');
  const available = 20 - photos.length;
  if (candidates.length > available) toast('每本最多 20 张，已按剩余数量添加。');
  busy = true; $('make').disabled = true; $('choose').disabled = true;
  let failures = 0;
  for (const file of candidates.slice(0, available)) {
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = await loadImage(objectUrl), canvas = scaledCanvas(image, 2000), src = canvas.toDataURL('image/jpeg', .9), metadata = imageMetadata(canvas);
      photos.push({ id: uid(), name: file.name, src, originalSrc: src, width: canvas.width, height: canvas.height, originalWidth: canvas.width, originalHeight: canvas.height, originalMetadata: metadata, fit: 'contain', selected: true, ...metadata });
      $('file-count').textContent = `正在整理 ${photos.length} / 20 张`;
    } catch { failures++; } finally { URL.revokeObjectURL(objectUrl); }
  }
  busy = false; $('choose').disabled = false; $('files').value = ''; renderBoard(); scheduleSave();
  if (failures) toast(`${failures} 张照片无法读取，其余照片已添加。`);
}
function movePhoto(id, delta) { const from = photos.findIndex(p => p.id === id), to = from + delta; if (to < 0 || to >= photos.length) return; const [p] = photos.splice(from, 1); photos.splice(to, 0, p); renderBoard(); scheduleSave(); }
function coverId() { return model?.coverId && photos.some(p => p.id === model.coverId && p.selected) ? model.coverId : selectedPhotos()[0]?.id; }
function renderBoard() {
  const board = $('photo-board'); board.replaceChildren(); $('photo-tools').hidden = !photos.length;
  $('file-count').textContent = `${photos.length} / 20 张 · 选用 ${selectedPhotos().length} 张`; $('make').disabled = busy || !selectedPhotos().length;
  if (!photos.length) { board.style.height = '0px'; return; }
  const width = board.clientWidth || 500, geometry = justifiedLayout(photos.map(p => p.width / p.height), { containerWidth: width, containerPadding: 0, boxSpacing: 8, targetRowHeight: width < 400 ? 160 : 175, targetRowHeightTolerance: .2 });
  board.style.height = `${geometry.containerHeight}px`;
  photos.forEach((photo, i) => {
    const box = geometry.boxes[i], card = el('div', `photo-card${photo.selected ? '' : ' excluded'}${photo.id === coverId() ? ' is-cover' : ''}`);
    card.dataset.photoId = photo.id; card.draggable = true; Object.assign(card.style, { left: box.left + 'px', top: box.top + 'px', width: box.width + 'px', height: box.height + 'px' });
    const open = el('button', 'photo-open'); open.type = 'button'; open.setAttribute('aria-label', `调整取景：${photo.name}`);
    const img = el('img'); img.src = photo.thumb; img.alt = photo.name; img.draggable = false; open.append(img); open.onclick = () => openCrop(photo.id);
    const top = el('div', 'photo-top'), label = el('label'), input = el('input'); input.type = 'checkbox'; input.checked = photo.selected; input.setAttribute('aria-label', `选用照片 ${i + 1}`);
    input.onchange = () => { photo.selected = input.checked; renderBoard(); scheduleSave(); }; label.append(input, document.createTextNode(String(i + 1).padStart(2, '0')));
    const remove = el('button', '', '移除'); remove.type = 'button'; remove.setAttribute('aria-label', `移除照片 ${i + 1}`); remove.onclick = () => { photos = photos.filter(p => p.id !== photo.id); renderBoard(); scheduleSave(); };
    top.append(label, remove);
    const bottom = el('div', 'photo-bottom'), cover = el('button', 'cover-button', photo.id === coverId() ? '封面' : '设为封面'); cover.type = 'button'; cover.onclick = () => { photo.selected = true; model = model || {}; model.coverId = photo.id; renderBoard(); scheduleSave(); };
    bottom.append(cover);
    for (const [delta, text] of [[-1, '←'], [1, '→']]) { const button = el('button', '', text); button.type = 'button'; button.disabled = i + delta < 0 || i + delta >= photos.length; button.setAttribute('aria-label', `${delta < 0 ? '前移' : '后移'}照片 ${i + 1}`); button.onclick = () => movePhoto(photo.id, delta); bottom.append(button); }
    card.append(open, top, bottom);
    card.ondragstart = event => { event.dataTransfer.setData('text/plain', photo.id); event.dataTransfer.effectAllowed = 'move'; };
    card.ondragover = event => { event.preventDefault(); card.classList.add('drag-target'); }; card.ondragleave = () => card.classList.remove('drag-target');
    card.ondrop = event => { event.preventDefault(); event.stopPropagation(); const from = photos.findIndex(p => p.id === event.dataTransfer.getData('text/plain')), to = photos.indexOf(photo); if (from < 0 || from === to) return; const [moved] = photos.splice(from, 1); photos.splice(to, 0, moved); renderBoard(); scheduleSave(); };
    board.append(card);
  });
}
function simplify() {
  const kept = []; let count = 0;
  for (const photo of photos) {
    if (!photo.selected) continue;
    const duplicate = kept.some(p => p.hash.split('').reduce((sum, bit, i) => sum + (bit !== photo.hash[i]), 0) <= 3 && Math.abs(p.luminance - photo.luminance) < 8 && Math.abs(p.width / p.height - photo.width / photo.height) < .05);
    if (duplicate && photo.id !== coverId()) { photo.selected = false; count++; } else kept.push(photo);
  }
  renderBoard(); scheduleSave(); toast(count ? `暂时取消了 ${count} 张近似照片，可随时重新勾选。` : '没有明显重复的照片，全部保留。');
}

const rgb = hex => { const h = hex.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
const hex = values => '#' + values.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
const mix = (a, b, ratio) => hex(rgb(a).map((v, i) => v * (1 - ratio) + rgb(b)[i] * ratio));
const luminance = color => rgb(color).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
function paletteForPhotos() {
  const colors = selectedPhotos().flatMap(p => p.colors || []).filter(c => /^#[\da-f]{6}$/i.test(c));
  const chroma = color => Math.max(...rgb(color)) - Math.min(...rgb(color));
  const ordered = colors.sort((a, b) => chroma(b) - chroma(a));
  const dominant = ordered[0] || '#a69579', paper = mix('#fffdf8', dominant, .065), desk = mix('#e8e4db', dominant, .1);
  let accent = dominant; for (let i = 0; i < 20 && contrast(accent, paper) < 4.5; i++) accent = mix(accent, '#171a18', .12);
  const ink = mix('#202521', dominant, .14), muted = mix(ink, paper, .32), tint = mix(paper, dominant, .12);
  return { paper, desk, ink, muted, accent, tint, line: ink + '25' };
}
function applyPalette() {
  const palette = model.palette || paletteForPhotos(); for (const [key, value] of Object.entries(palette)) document.documentElement.style.setProperty('--' + key, value);
  document.querySelector('meta[name=theme-color]').content = palette.desk;
}
function storyChunks(story) {
  const paragraphs = story.trim().split(/\n+/).filter(Boolean), chunks = [];
  for (const paragraph of paragraphs) {
    const sentences = paragraph.match(/[^。！？!?；;]+[。！？!?；;]?|[。！？!?；;]+/g) || [paragraph]; let part = '';
    for (let sentence of sentences) {
      if (part.length + sentence.length > 95 && part) { chunks.push(part); part = ''; }
      while (sentence.length > 95) { chunks.push(sentence.slice(0, 95)); sentence = sentence.slice(95); }
      part += sentence;
    }
    if (part) chunks.push(part);
  }
  return chunks;
}
function generatePages(state) {
  const chosen = selectedPhotos(), cover = chosen.find(p => p.id === coverId()) || chosen[0], remaining = chosen.filter(p => p.id !== cover.id);
  const pages = [{ type: 'cover', photoIds: [cover.id], heading: state.title, body: '', caption: '' }];
  let index = 0;
  while (remaining.length) {
    const first = remaining[0], second = remaining[1], landscape = first.width / first.height > 1.2;
    let type = 'feature', count = 1;
    if (state.style === 'voyage' && landscape) type = 'hero';
    else if (second && first.width / first.height < .95 && second.width / second.height < .95) { type = 'pair'; count = 2; }
    else if (remaining.length >= 3 && index % 3 === 2) { type = 'gallery'; count = 3; }
    else if (second && index % 3 === 1 && state.style !== 'voyage') { type = 'split'; count = 2; }
    else if (landscape && index % 2 === 0) type = 'hero';
    pages.push({ type, photoIds: remaining.splice(0, count).map(p => p.id), heading: '', body: '', caption: '' }); index++;
  }
  const chunks = storyChunks(state.story);
  // Give a single-photo edition a text page so the cover remains spacious.
  if (chunks.length && pages.length === 1) pages.push({ type: 'letter', photoIds: [], heading: '', body: '', caption: '' });
  for (let i = 0; i < chunks.length; i++) {
    const page = pages[i + 1];
    if (page) page.body = chunks[i]; else pages.push({ type: 'letter', photoIds: [], heading: '', body: chunks[i], caption: '' });
  }
  pages.push({ type: 'back', photoIds: [], heading: state.title, body: '', caption: '' });
  return pages;
}
function makeEdition() {
  if (!selectedPhotos().length) return;
  const state = formState(), old = model?.pages || [], pages = generatePages(state), chosenCover = coverId();
  const basePages = clone(pages);
  for (const page of pages) {
    const previous = old.find(p => p.edited && p.type === page.type && p.photoIds.join('|') === page.photoIds.join('|'));
    if (previous) Object.assign(page, { heading: previous.heading, body: previous.body, caption: previous.caption, edited: true });
  }
  model = { version: 2, id: model?.id || uid(), ...state, coverId: chosenCover, pages, basePages, palette: paletteForPhotos() };
  showReader(0); scheduleSave();
}
function photoFrame(id) {
  const photo = photos.find(p => p.id === id), figure = el('figure', 'image-frame' + (photo.fit === 'cover' ? ' is-fill' : ''));
  const image = el('img'); image.src = photo.src; image.alt = photo.name; image.draggable = false; image.decoding = 'async'; figure.dataset.photoId = id; figure.append(image); return figure;
}
function renderPage(page, index) {
  const article = el('article', 'magazine-page ' + page.type); article.dataset.pageIndex = index; article.setAttribute('aria-label', `第 ${index + 1} 页`);
  const shell = el('div', 'page-shell'), eyebrow = el('p', 'page-eyebrow', page.type === 'cover' || page.type === 'back' ? 'PHOTO EDITION' : styleNames[model.style]); shell.append(eyebrow);
  if (page.heading) { const title = el('h2', 'page-title', page.heading); if (page.heading.length > 12) title.style.fontSize = `${Math.max(4.6, (page.type === 'cover' ? 10.2 : 7.7) - (page.heading.length - 12) * .12)}cqw`; shell.append(title); }
  if (page.photoIds.length) { const area = el('div', 'photo-area'); page.photoIds.forEach(id => area.append(photoFrame(id))); shell.append(area); }
  if (page.body) shell.append(el('p', 'page-body', page.body));
  if (page.caption) shell.append(el('p', 'page-caption', page.caption));
  const folio = el('div', 'page-folio'); folio.append(el('span', '', model.title), el('span', '', String(index + 1).padStart(2, '0'))); shell.append(folio); article.append(shell); return article;
}
function layoutGalleries(root = $('book')) {
  root.querySelectorAll('.gallery .photo-area').forEach(area => {
    const w = area.clientWidth, h = area.clientHeight; if (!w || !h) return;
    const frames = [...area.children], ratios = frames.map(frame => { const p = photos.find(p => p.id === frame.dataset.photoId); return p.width / p.height; });
    const geometry = justifiedLayout(ratios, { containerWidth: w, containerPadding: 0, boxSpacing: w * .025, targetRowHeight: Math.min(w * .55, h * .6), targetRowHeightTolerance: .25 });
    const scale = Math.min(1, h / geometry.containerHeight), offset = (w - w * scale) / 2;
    frames.forEach((frame, i) => { const b = geometry.boxes[i]; Object.assign(frame.style, { left: `${offset + b.left * scale}px`, top: `${(h - geometry.containerHeight * scale) / 2 + b.top * scale}px`, width: `${b.width * scale}px`, height: `${b.height * scale}px` }); });
  });
}
function bookSize() {
  const parent = $('reader-main'), mobile = innerWidth <= 760, pageWidth = Math.max(100, Math.floor(Math.min(510, (parent.clientWidth - 12) / (mobile ? 1 : 2), (parent.clientHeight - (mobile ? 24 : 36)) / 1.4)));
  return { pageWidth, pageHeight: Math.round(pageWidth * 1.4), mobile };
}
function resizeBook() {
  if ($('reader').hidden || !flip) return;
  const { pageWidth, pageHeight, mobile } = bookSize(), book = $('book');
  Object.assign($('book-host').style, { width: `${pageWidth * (mobile ? 1 : 2)}px`, height: pageHeight + 'px' });
  Object.assign(flip.getSettings(), { width: pageWidth, height: pageHeight, minWidth: pageWidth, maxWidth: pageWidth, minHeight: pageHeight, maxHeight: pageHeight });
  book.style.minWidth = pageWidth + 'px'; book.style.minHeight = pageHeight + 'px'; flip.update(); layoutGalleries(); updateMeter();
}
function updateMeter() {
  if (!flip || !model?.pages) return;
  current = flip.getCurrentPageIndex();
  const last = model.pages.length - 1, double = flip.getOrientation() === 'landscape' && current > 0 && current < last;
  $('meter').textContent = `${current + 1}${double ? '–' + Math.min(current + 2, last + 1) : ''} / ${last + 1}`;
  $('prev').disabled = current === 0; $('next').disabled = current >= last || (double && current + 1 >= last);
  $('book').querySelectorAll('.magazine-page').forEach(page => { const index = Number(page.dataset.pageIndex), visible = index === current || (double && index === current + 1); page.setAttribute('aria-hidden', String(!visible)); });
  layoutGalleries();
}
function refreshPages(pageIndex = current) {
  $('brand-title').textContent = model.title; $('issue').textContent = `${selectedPhotos().length} 张照片`; document.title = `${model.title} · Photo Edition`; applyPalette();
  const pages = model.pages.map(renderPage);
  if (flip) { flip.updateFromHtml(pages); flip.turnToPage(Math.min(pageIndex, pages.length - 1)); resizeBook(); }
  else {
    const { pageWidth, pageHeight, mobile } = bookSize(); Object.assign($('book-host').style, { width: `${pageWidth * (mobile ? 1 : 2)}px`, height: pageHeight + 'px' });
    flip = new PageFlip($('book'), { width: pageWidth, height: pageHeight, size: 'fixed', usePortrait: true, showCover: true, autoSize: false, drawShadow: true, maxShadowOpacity: .23, flippingTime: reducedMotion.matches ? 1 : 480, mobileScrollSupport: true, swipeDistance: 35, clickEventForward: true, useMouseEvents: true, showPageCorners: !reducedMotion.matches, disableFlipByClick: true });
    flip.on('flip', () => { updateMeter(); scheduleSave(); }); flip.on('changeOrientation', () => { requestAnimationFrame(updateMeter); });
    flip.loadFromHTML(pages); flip.turnToPage(Math.min(pageIndex, pages.length - 1));
  }
  updateMeter(); requestAnimationFrame(() => { resizeBook(); layoutGalleries(); });
}
function showReader(pageIndex = 0) { $('landing').hidden = true; $('reader').hidden = false; current = pageIndex; scrollTo(0, 0); refreshPages(pageIndex); }
function navigate(direction) { if (!flip || document.querySelector('dialog[open]')) return; if (reducedMotion.matches) direction > 0 ? flip.turnToNextPage() : flip.turnToPrevPage(); else direction > 0 ? flip.flipNext('bottom') : flip.flipPrev('bottom'); }
function openEditor() {
  editBuffer = clone(model.pages); editIndex = current; $('edit-title').value = model.title;
  $('edit-page').replaceChildren(...model.pages.map((p, i) => { const option = el('option', '', `第 ${i + 1} 页${p.heading ? ' · ' + p.heading : ''}`); option.value = i; return option; }));
  $('edit-page').value = editIndex; fillEditor(); $('editor').showModal();
}
function fillEditor() { const p = editBuffer[editIndex]; $('edit-heading').value = p.heading; $('edit-body').value = p.body; $('edit-caption').value = p.caption; }
function stashEditor() { const p = editBuffer[editIndex]; Object.assign(p, { heading: $('edit-heading').value.trim(), body: $('edit-body').value, caption: $('edit-caption').value.trim(), edited: true }); }
function applyText() {
  stashEditor(); model.title = $('edit-title').value.trim() || '我们的日常'; model.pages = editBuffer;
  model.pages[0].heading = model.title; $('title').value = model.title; $('editor').close(); refreshPages(current); scheduleSave(); toast('文字已保存');
}
function renderPhotoEditor() {
  $('reader-photo-list').replaceChildren(...selectedPhotos().map(photo => {
    const row = el('div', 'photo-edit-row'), img = el('img'); img.src = photo.thumb; img.alt = photo.name;
    const info = el('div'), name = el('p', '', photo.name), label = el('label', '', '显示方式'), select = el('select'); select.setAttribute('aria-label', `显示方式：${photo.name}`);
    for (const [value, title] of [['contain', '保留完整画面'], ['cover', '铺满画框']]) { const option = el('option', '', title); option.value = value; select.append(option); } select.value = photo.fit;
    select.onchange = () => { photo.fit = select.value; refreshPages(current); scheduleSave(); };
    label.append(select); info.append(name, label); const edit = el('button', 'quiet', '裁剪 / 调色'); edit.onclick = () => openCrop(photo.id); edit.type = 'button'; row.append(img, info, edit); return row;
  }));
}

async function openCrop(id, reset = false) {
  const photo = photos.find(p => p.id === id); if (!photo) return;
  cropId = id; $('crop-title').textContent = '调整取景 · ' + photo.name;
  if (!$('crop-dialog').open) $('crop-dialog').showModal();
  cropper?.destroy(); $('crop-workspace').replaceChildren(); $('brightness').value = '100'; $('saturation').value = '100'; $('crop-ratio').value = '0';
  const image = el('img'); image.src = reset ? photo.originalSrc : photo.src; image.alt = photo.name; $('crop-workspace').append(image);
  cropper = new Cropper(image, { container: $('crop-workspace'), template: DEFAULT_TEMPLATE.replace('initial-coverage="0.5"', 'initial-coverage="0.8"') });
  try {
    await cropper.getCropperImage().$ready(); cropper.getCropperImage().$center('contain');
    const imageRect = cropper.getCropperImage().getBoundingClientRect(), canvasRect = cropper.getCropperCanvas().getBoundingClientRect();
    cropper.getCropperSelection().$change(imageRect.x - canvasRect.x, imageRect.y - canvasRect.y, imageRect.width, imageRect.height, NaN, true);
  } catch { toast('这张照片无法打开'); }
}
function closeCrop() { $('crop-dialog').close(); cropper?.destroy(); cropper = null; cropId = null; $('crop-workspace').replaceChildren(); }
function previewFilter() { if (!cropper) return; cropper.getCropperImage().style.filter = `brightness(${$('brightness').value}%) saturate(${$('saturation').value}%)`; }
function adjustPixels(canvas) {
  const brightness = Number($('brightness').value) / 100, saturation = Number($('saturation').value) / 100;
  if (brightness === 1 && saturation === 1) return;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }), image = ctx.getImageData(0, 0, canvas.width, canvas.height), data = image.data;
  // Pixel processing also works where the Canvas 2D filter property is unavailable.
  for (let i = 0; i < data.length; i += 4) {
    const grey = data[i] * .2126 + data[i + 1] * .7152 + data[i + 2] * .0722;
    for (let channel = 0; channel < 3; channel++) data[i + channel] = Math.max(0, Math.min(255, (grey + (data[i + channel] - grey) * saturation) * brightness));
  }
  ctx.putImageData(image, 0, 0);
}
async function applyCrop() {
  if (!cropper || !cropId) return;
  $('apply-crop').disabled = true;
  try {
    const selection = cropper.getCropperSelection(), photo = photos.find(p => p.id === cropId);
    if (selection.width < 2 || selection.height < 2) throw new Error('请先选取照片范围');
    const scale = Math.min(3, 1800 / Math.max(selection.width, selection.height)), width = Math.round(selection.width * scale), height = Math.round(selection.height * scale);
    const canvas = await selection.$toCanvas({ width, height }); adjustPixels(canvas);
    Object.assign(photo, { src: canvas.toDataURL('image/jpeg', .92), width: canvas.width, height: canvas.height, ...imageMetadata(canvas) });
    closeCrop(); renderBoard();
    if (!$('reader').hidden) { model.palette = paletteForPhotos(); refreshPages(current); renderPhotoEditor(); }
    scheduleSave(); toast('取景和调色已应用，原图仍保留。');
  } catch (error) { toast(error.message || '裁剪没有完成，请重试'); } finally { $('apply-crop').disabled = false; }
}
async function resetCrop() {
  const photo = photos.find(p => p.id === cropId); if (!photo) return;
  Object.assign(photo, { src: photo.originalSrc, width: photo.originalWidth, height: photo.originalHeight, ...(photo.originalMetadata || imageMetadata(scaledCanvas(await loadImage(photo.originalSrc), 2000))) });
  const id = cropId; closeCrop(); renderBoard(); if (!$('reader').hidden) { model.palette = paletteForPhotos(); refreshPages(current); renderPhotoEditor(); } scheduleSave(); toast('已恢复完整原图');
}

function downloadEdition() {
  const documentClone = document.documentElement.cloneNode(true);
  documentClone.querySelector('#edition-data').textContent = JSON.stringify({ model, photos, current }).replace(/</g, '\\u003c');
  documentClone.querySelector('#book-host').innerHTML = '<div id="book" tabindex="0" role="region" aria-label="杂志；用左右方向键、页角拖拽或下方按钮翻页"></div>';
  for (const selector of ['#photo-board', '#crop-workspace', '#reader-photo-list', '#print-pages']) documentClone.querySelector(selector).replaceChildren();
  documentClone.querySelectorAll('dialog,details').forEach(node => node.removeAttribute('open'));
  documentClone.querySelector('#landing').hidden = true; documentClone.querySelector('#reader').hidden = false; documentClone.querySelector('#toast').hidden = true;
  const blob = new Blob(['<!doctype html>\n', documentClone.outerHTML], { type: 'text/html;charset=utf-8' }), url = URL.createObjectURL(blob), link = el('a');
  link.href = url; link.download = (model.title.replace(/[<>:"/\\|?*]/g, '') || '照片杂志') + '.html'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); toast('网页已下载，照片、文字和翻页功能都包含在文件里。');
}
function preparePrint() {
  if (!model?.pages) return;
  const container = $('print-pages'), printable = [];
  for (const page of model.pages) {
    const chunks = page.body.length > 140 ? storyChunks(page.body) : [page.body];
    printable.push({ ...page, body: chunks.shift() || '' });
    for (const body of chunks) printable.push({ type: 'letter', photoIds: [], heading: '', body, caption: '' });
  }
  container.replaceChildren(...printable.map(renderPage));
  // Apply the same gallery geometry to the printable pages using their page width.
  layoutGalleries(container);
}

$('choose').onclick = () => $('files').click(); $('files').onchange = event => addFiles(event.target.files);
$('drop').ondragover = event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); $('drop').classList.add('drag'); } };
$('drop').ondragleave = () => $('drop').classList.remove('drag'); $('drop').ondrop = event => { event.preventDefault(); $('drop').classList.remove('drag'); if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files); };
$('simplify').onclick = simplify; $('maker').onsubmit = event => { event.preventDefault(); makeEdition(); };
$('title').oninput = $('story').oninput = scheduleSave; document.querySelectorAll('input[name=style]').forEach(input => input.onchange = scheduleSave);
$('prev').onclick = () => navigate(-1); $('next').onclick = () => navigate(1);
$('book').addEventListener('mousedown', event => {
  if (!flip || event.button !== 0) return;
  const rect = $('book').getBoundingClientRect(), size = bookSize(), corner = Math.min(size.pageWidth * .22, size.pageHeight * .18);
  const x = event.clientX - rect.left, y = event.clientY - rect.top;
  if (!((x < corner || x > rect.width - corner) && (y < corner || y > rect.height - corner))) event.stopPropagation();
}, true);
document.addEventListener('keydown', event => { if ($('reader').hidden || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || document.querySelector('dialog[open]')) return; if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); navigate(event.key === 'ArrowRight' ? 1 : -1); } });
$('edit').onclick = openEditor; $('edit-page').onchange = () => { stashEditor(); editIndex = Number($('edit-page').value); fillEditor(); };
$('restore-text').onclick = () => { const source = model.basePages?.[editIndex]; if (source) { editBuffer[editIndex] = clone(source); fillEditor(); } }; $('apply-text').onclick = applyText;
$('edit-photos').onclick = () => { renderPhotoEditor(); $('photo-editor').showModal(); };
document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => $(button.dataset.close).close());
$('cancel-crop').onclick = closeCrop; $('crop-dialog').addEventListener('cancel', event => { event.preventDefault(); closeCrop(); });
$('crop-ratio').onchange = () => { if (!cropper) return; const selection = cropper.getCropperSelection(), ratio = Number($('crop-ratio').value); selection.aspectRatio = ratio || NaN; selection.$change(selection.x, selection.y, selection.width, selection.height, ratio || NaN, true); selection.$center(); };
$('crop-rotate').onclick = () => cropper?.getCropperImage().$rotate('90deg'); $('brightness').oninput = $('saturation').oninput = previewFilter;
$('apply-crop').onclick = applyCrop; $('crop-reset').onclick = resetCrop;
$('restart').onclick = () => { $('reader').hidden = true; $('landing').hidden = false; document.querySelector('.reader-menu').open = false; setForm(model); renderBoard(); scheduleSave(); scrollTo(0, 0); };
$('download').onclick = downloadEdition; $('print').onclick = () => { document.querySelector('.reader-menu').open = false; preparePrint(); window.print(); };
window.addEventListener('beforeprint', preparePrint); window.addEventListener('afterprint', () => $('print-pages').replaceChildren());
let resizeTimer; window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { renderBoard(); resizeBook(); }, 100); });
new ResizeObserver(() => { if (!$('landing').hidden && photos.length) renderBoard(); }).observe($('photo-board'));
document.addEventListener('visibilitychange', () => { if (document.hidden && photos.length) saveDraft(); });
$('resume').onclick = () => { if (!resumeDraft) return; photos = resumeDraft.photos; model = resumeDraft.model; setForm(resumeDraft.form); $('resume-banner').hidden = true; renderBoard(); if (resumeDraft.phase === 'reader' && model?.pages) showReader(resumeDraft.current || 0); scheduleSave(); toast('上次的草稿已恢复'); };

async function boot() {
  let embedded;
  try { embedded = JSON.parse($('edition-data').textContent); } catch { embedded = null; }
  if (embedded?.model?.version === 2 && Array.isArray(embedded.photos)) { photos = embedded.photos; model = embedded.model; setForm(model); renderBoard(); showReader(embedded.current || 0); return; }
  resumeDraft = await readDraft() || await readLegacyDraft();
  if (resumeDraft?.version === 2 && resumeDraft.photos?.length) { $('resume-info').textContent = `上次的「${resumeDraft.form.title}」· ${resumeDraft.photos.length} 张照片`; $('resume-banner').hidden = false; }
}
boot();
