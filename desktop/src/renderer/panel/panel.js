// 控制面板：单一主界面。左侧宠物网格 + 右侧舞台；设置收进右上角齿轮抽屉。
// 可爱感来自宠物本身：格子默认静止、hover 挥手、桌面那只在网格里轻轻待机；
// 切换/放到桌面/收回来都用宠物自己的动作做过渡。
import { planCodexExport } from '../../shared/codex.js';
import { createTranslator, localizeDiagnostic, resolveLanguage } from '../../shared/i18n.js';
import { renderCodexAtlas } from '../lib/codex-export.js';
import { drawFrame, loadAnimation, opaqueBounds } from '../lib/player.js';
import {
  clickCycle, dayPhase, entranceAnimation, mainButtonState, previewScale, sourceFilters, walkOutAnimation, waveAnimation,
} from '../lib/panel-model.js';
import { dominantColor } from '../lib/tint.js';

const api = window.pets;
const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let locale = resolveLanguage('auto', navigator.language);
let t = createTranslator(locale);
const SLOTS = new Set(['idle', 'walk', 'walk-left', 'walk-right', 'drag', 'drag-left', 'drag-right', 'fall', 'sleep']);
const countText = (type, count) => t(`count.${type}.${count === 1 ? 'one' : 'other'}`, { count });
const diagnostic = (message) => localizeDiagnostic(message, locale);
const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const reduced = () => motionQuery.matches;

const state = { app: null, records: [], filter: 'all', query: '', selected: null, anim: 'idle', cycle: -1, exporting: null, phase: null, drawer: false };
const els = {
  grid: $('#grid'),
  problems: $('#problems'),
  filters: $('#filters'),
  search: $('#search'),
  settings: $('#settings'),
  toast: $('#toast'),
  toastText: $('#toast-text'),
  toastAvatar: $('#toast-avatar'),
  stage: $('#stage'),
  stagePanel: $('#stage-panel'),
  stageCanvas: $('#stage-canvas'),
  stageAnim: $('#stage-anim'),
  away: $('#away'),
  awayTitle: $('#away-title'),
  petName: $('#pet-name'),
  petSub: $('#pet-sub'),
  btnMain: $('#btn-main'),
  btnMore: $('#btn-more'),
  menu: $('#more-menu'),
  stageBody: $('#stage-body'),
  drawer: $('#drawer'),
  scrim: $('#scrim'),
  btnSettings: $('#btn-settings'),
};

const animLabel = (pet, name) => {
  if (pet.format === 'codex' && pet.animations[name]?.label) return t(`animation.${name}`);
  return pet.animations[name]?.label ?? (SLOTS.has(name) ? t(`animation.${name}`) : name);
};
const validRecords = () => state.records.filter((r) => r.pet);
const byKey = (key) => state.records.find((r) => r.key === key);
const isLive = (key) => !!state.app?.visible && state.app.activeKey === key;

function applyLanguage() {
  locale = state.app?.locale ?? resolveLanguage('auto', navigator.language);
  t = createTranslator(locale);
  document.documentElement.lang = locale;
  document.title = t('app.title');
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const [attribute, dataKey] of [['title', 'i18nTitle'], ['aria-label', 'i18nAria'], ['placeholder', 'i18nPlaceholder']]) {
    const selector = `[data-${dataKey.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}]`;
    for (const node of document.querySelectorAll(selector)) node.setAttribute(attribute, t(node.dataset[dataKey]));
  }
}

// ---------------------------------------------------------------- 动画 / 取色缓存

const animCache = new Map();
const fitCache = new Map();
const tintCache = new Map();

function getAnim(record, name) {
  const k = `${record.key}|${name}`;
  if (!animCache.has(k)) animCache.set(k, loadAnimation(record.pet.animations[name], record.assetBase));
  return animCache.get(k);
}

function petFit(record) {
  if (!fitCache.has(record.key)) {
    fitCache.set(
      record.key,
      getAnim(record, 'idle').then((idle) => {
        const b = opaqueBounds(idle, 0) ?? { x0: 0, y0: 0, x1: idle.box.w, y1: idle.box.h };
        return { bw: b.x1 - b.x0, bh: b.y1 - b.y0, cx: (b.x0 + b.x1) / 2 - idle.box.w / 2 };
      }),
    );
  }
  return fitCache.get(record.key);
}

/** 立绘主色 → 淡色底。运行时 canvas 采样并缓存，不改 pet.json。 */
function petTint(record) {
  if (!tintCache.has(record.key)) {
    tintCache.set(record.key, (async () => {
      try {
        const idle = await getAnim(record, 'idle');
        const src = idle.source(0);
        if (!src) return null;
        const f = idle.frames[0];
        const k = Math.min(1, 64 / Math.max(f.w, f.h));
        const w = Math.max(1, Math.round(f.w * k));
        const h = Math.max(1, Math.round(f.h * k));
        const canvas = new OffscreenCanvas(w, h);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(src.image, src.sx, src.sy, f.w, f.h, 0, 0, w, h);
        return dominantColor(ctx.getImageData(0, 0, w, h).data);
      } catch {
        return null;
      }
    })());
  }
  return tintCache.get(record.key);
}

function applyTint(el, record) {
  petTint(record).then((c) => {
    if (c) el.style.setProperty('--pet-tint', `${c.r} ${c.g} ${c.b}`);
    else el.style.removeProperty('--pet-tint');
  });
}

/** 给 toast / 空状态画一个当前宠物的小头像。 */
async function paintAvatar(canvas, record) {
  try {
    const [idle, fit] = await Promise.all([getAnim(record, 'idle'), petFit(record)]);
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const scale = Math.min(W / fit.bw, H / fit.bh) * 0.92;
    ctx.imageSmoothingEnabled = !record.pet.pixelated;
    const anchor = record.pet.animations.idle.anchor ?? [idle.box.w / 2, idle.groundY()];
    drawFrame(ctx, idle, 0, anchor, W / 2 - fit.cx * scale, H * 0.98, scale);
  } catch { /* 头像失败不影响提示 */ }
}

// ---------------------------------------------------------------- 预览绘制

const previews = new Set();

class Preview {
  constructor(canvas, record, fill) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.record = record;
    this.fill = fill;
    this.visible = true;
    this.token = 0;
    this.opts = {};
    previews.add(this);
  }

  async play(name, opts = {}) {
    const token = ++this.token;
    try {
      const [anim, fit] = await Promise.all([getAnim(this.record, name), petFit(this.record)]);
      if (token !== this.token) return;
      Object.assign(this, { anim, fit, name, start: performance.now(), lastIdx: -1, dirty: true, finished: false, opts });
    } catch (e) {
      if (token === this.token) toast(t('toast.previewFailed', { error: diagnostic(e.message) }), 'error');
    }
  }

  still() { this.play('idle', { frozen: true }); }
  hide() { this.token++; this.anim = null; this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height); }
  dispose() { this.token++; previews.delete(this); }

  draw(now) {
    if (!this.visible || !this.anim) return;
    const c = this.canvas;
    const W = c.clientWidth;
    const H = c.clientHeight;
    if (!W || !H) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
      this.dirty = true;
    }
    const o = this.opts;
    const a = this.anim;
    const elapsed = (now - this.start) * (o.speed ?? 1);
    const pet = this.record.pet;
    const scale = previewScale({ bw: this.fit.bw, bh: this.fit.bh, boxW: W, boxH: H, fill: this.fill, pixelated: pet.pixelated });
    let ox = W / 2 - this.fit.cx * scale;
    const ctx = this.ctx;

    if (o.travel) {
      const p = Math.min(1, elapsed / (o.travelMs ?? 700));
      const off = W / 2 + this.fit.bw * scale;
      ox += o.travel === 'out' ? p * off : (1 - p) * off;
      if (p >= 1 && !this.finished) {
        this.finished = true;
        if (o.travel === 'out') { ctx.clearRect(0, 0, c.width, c.height); o.onEnd?.(); return; }
        o.onEnd?.();
      }
    }
    if (o.once && elapsed >= a.totalMs && !this.finished) { this.finished = true; o.onEnd?.(); }

    let idx = a.def.stepDistance ? Math.floor(elapsed / 200) % a.frames.length : a.indexAt(elapsed);
    if (o.frozen) idx = 0;
    if (!this.dirty && idx === this.lastIdx && !o.travel) return;

    const anchor = pet.animations[this.name].anchor ?? [a.box.w / 2, a.groundY()];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = !pet.pixelated;
    ctx.imageSmoothingQuality = 'high';
    const src = drawFrame(ctx, a, idx, anchor, ox, H * 0.93, scale);
    this.dirty = !src?.exact;
    this.lastIdx = idx;
  }
}

function loop(now) {
  for (const p of previews) p.draw(now);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---------------------------------------------------------------- 网格

const cardPreviews = new Map();
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      const p = cardPreviews.get(e.target.dataset.key);
      if (p) p.visible = e.isIntersecting;
    }
  },
  { root: $('.library-main') },
);

function matches(r) {
  if (state.filter !== 'all' && r.source !== state.filter) return false;
  const q = state.query.trim().toLowerCase();
  if (!q) return true;
  const p = r.pet;
  return [p.name, p.id, p.description, ...p.tags].some((s) => s?.toLowerCase().includes(q));
}

function renderFilters() {
  const f = sourceFilters(state.records);
  els.filters.hidden = !f.visible;
  if (!f.visible) return;
  const counts = { all: validRecords().length, ...f.counts };
  els.filters.innerHTML = ['all', ...f.present].map(
    (id) => `<button data-filter="${id}" class="${state.filter === id ? 'is-active' : ''}">${t(`filter.${id}`)}<span>${counts[id] ?? 0}</span></button>`,
  ).join('');
}

function cardHtml(r) {
  const p = r.pet;
  return `<article class="card" data-key="${esc(r.key)}" tabindex="0" role="button" aria-label="${esc(p.name)}">
    <div class="stage"><canvas></canvas><span class="live-dot" title="${t('card.active')}"></span></div>
    <div class="card-name">${esc(p.name)}</div>
  </article>`;
}

function renderGrid() {
  for (const p of cardPreviews.values()) p.dispose();
  cardPreviews.clear();
  io.disconnect();
  const list = validRecords().filter(matches);
  if (!list.length) {
    const has = validRecords().length > 0;
    els.grid.innerHTML = `<div class="empty"><canvas class="empty-avatar" width="72" height="72"></canvas>
      <strong>${t(has ? 'empty.searchTitle' : 'empty.libraryTitle')}</strong>
      <span>${t(has ? 'empty.searchBody' : 'empty.libraryBody')}</span></div>`;
    const avatar = els.grid.querySelector('.empty-avatar');
    const cur = byKey(state.selected) ?? validRecords()[0];
    if (avatar && cur) paintAvatar(avatar, cur);
  } else {
    els.grid.innerHTML =
      list.map(cardHtml).join('') +
      `<button class="card adopt" id="adopt" type="button">
        <span class="adopt-plus" aria-hidden="true">＋</span>
        <span class="adopt-title">${t('adopt.title')}</span>
        <span class="adopt-hint">${t('adopt.hint')}</span>
      </button>`;
    for (const card of els.grid.querySelectorAll('.card:not(.adopt)')) {
      const record = byKey(card.dataset.key);
      const preview = new Preview(card.querySelector('canvas'), record, 0.8);
      cardPreviews.set(record.key, preview);
      io.observe(card);
      applyTint(card, record);
    }
  }
  updateCards();
}

/** 格子默认静止；桌面那只轻轻待机；其余 hover 才挥手。 */
function updateCards() {
  for (const card of els.grid.querySelectorAll('.card:not(.adopt)')) {
    const key = card.dataset.key;
    const preview = cardPreviews.get(key);
    card.classList.toggle('is-selected', key === state.selected);
    const live = isLive(key);
    card.classList.toggle('is-live', live);
    if (!preview) continue;
    if (card.matches(':hover')) continue; // hover 状态由鼠标事件管理
    if (live && !reduced()) preview.play('idle', { speed: 0.6 });
    else preview.still();
  }
}

function renderProblems() {
  const bad = state.records.filter((r) => !r.pet);
  els.problems.innerHTML = bad.length
    ? `<h3>${t('problems.title', { count: bad.length })}</h3>` +
      bad.map((r) => `<div class="problem"><b>${esc(r.dirName)}</b> · ${t(`source.${r.source}`)}
        <ul>${r.errors.slice(0, 8).map((e) => `<li>${esc(diagnostic(e))}</li>`).join('')}</ul></div>`).join('')
    : '';
}

// ---------------------------------------------------------------- 舞台

let stagePreview = null;
let walkInDone = true;

function stageRecord() { return byKey(state.selected); }

function setPhaseLabel() {
  if (state.phase === 'leaving') els.stageAnim.textContent = t('stage.leaving');
  else if (state.phase === 'returning') els.stageAnim.textContent = t('stage.returning');
}

function showAway(r) {
  stagePreview?.hide();
  els.awayTitle.textContent = t('stage.away', { name: r.pet.name });
  els.away.hidden = false;
  els.stage.classList.add('is-away');
  els.stageAnim.textContent = '';
}

function hideAway() {
  els.away.hidden = true;
  els.stage.classList.remove('is-away');
}

function playStageIdle(r) {
  els.stageAnim.textContent = animLabel(r.pet, 'idle');
  stagePreview?.play('idle');
}

/** 切换选中：用跳跃/登场类动作出现，没有就待机加一个小弹跳。 */
function enterStage(r) {
  hideAway();
  if (!stagePreview || stagePreview.record.key !== r.key) {
    stagePreview?.dispose();
    stagePreview = new Preview(els.stageCanvas, r, 0.72);
  }
  applyTint(els.stagePanel, r);
  const entrance = entranceAnimation(r.pet);
  if (reduced()) { playStageIdle(r); return; }
  if (entrance) {
    els.stageAnim.textContent = animLabel(r.pet, entrance);
    // 登场动作可能很长；若期间已开始放到桌面/收回来，别用过场待机盖掉行走过渡。
    stagePreview.play(entrance, { once: true, onEnd: () => { if (!state.phase && stagePreview?.name === entrance) playStageIdle(r); } });
  } else {
    els.stage.classList.remove('bounce');
    void els.stage.offsetWidth;
    els.stage.classList.add('bounce');
    playStageIdle(r);
  }
}

function renderStage() {
  els.stage.dataset.phase = dayPhase(new Date().getHours());
  const r = stageRecord();
  if (!r?.pet) {
    stagePreview?.dispose();
    stagePreview = null;
    hideAway();
    els.stageAnim.textContent = '';
    els.stage.classList.add('is-empty');
    return;
  }
  els.stage.classList.remove('is-empty');
  if (state.phase) { setPhaseLabel(); return; }
  if (isLive(r.key)) showAway(r);
  else if (els.away.hidden === false) { hideAway(); playStageIdle(r); }
  else if (!stagePreview || stagePreview.record.key !== r.key) enterStage(r);
}

function interactionText(pet) {
  const acts = clickCycle(pet);
  if (pet.behavior.click) return t('detail.clickStart', { action: animLabel(pet, pet.behavior.click) });
  return t(acts.length ? 'detail.clickCycle' : 'detail.dragOnly');
}

function codexMappingText(pet) {
  return planCodexExport(pet)
    .filter((row) => row.state !== 'idle')
    .map((row) => `${t(`codexState.${row.state}`)} ← ${animLabel(pet, row.anim)}${row.flip ? t('common.mirrored') : ''}`)
    .join(' · ');
}

function renderStageBar() {
  const r = stageRecord();
  const btn = mainButtonState({ selectedKey: state.selected, activeKey: state.app?.activeKey, visible: state.app?.visible, busy: !!state.phase });
  els.btnMain.disabled = btn.disabled;
  els.btnMain.textContent = t(btn.action === 'recall' ? 'stage.recall' : 'stage.activate');
  els.btnMain.dataset.action = btn.action;
  els.btnMore.disabled = !r?.pet;
  if (!r?.pet) { els.petName.textContent = ''; els.petSub.textContent = ''; return; }
  const p = r.pet;
  els.petName.textContent = p.name;
  els.petSub.textContent = [
    t(`source.${r.source}`),
    p.version && `v${p.version}`,
    p.author && t('detail.author', { author: p.author }),
  ].filter(Boolean).join(' · ');
}

function renderStageBody() {
  const r = stageRecord();
  if (!r?.pet) {
    els.stageBody.innerHTML = `<div class="stage-empty">${t('stage.empty')}</div>`;
    return;
  }
  const p = r.pet;
  const names = Object.keys(p.animations);
  const chips = names.map((n) => {
    const cls = ['chip', p.animations[n].label ? '' : 'is-slot', n === state.anim ? 'is-active' : ''].join(' ');
    return `<button class="${cls}" data-anim="${esc(n)}" title="${esc(n)}">${esc(animLabel(p, n))}</button>`;
  }).join('');
  const tags = p.tags.map((tag) => `<span class="tag">${esc(tag)}</span>`).join('');
  els.stageBody.innerHTML = `
    <p class="stage-desc">${esc(p.description || t('common.noDescription'))}</p>
    <div class="stage-meta">${tags}<span class="count">${p.actions.length ? countText('actions', p.actions.length) : ''}</span></div>
    <h3>${t('stage.actions')} <small>${t('stage.clickHint')}</small></h3>
    <div class="chips">${chips}</div>
    <h3>${t('detail.information')}</h3>
    <dl class="facts">
      <dt>${t('detail.animations')}</dt><dd>${countText('animations', names.length)}</dd>
      <dt>${t('detail.interaction')}</dt><dd>${esc(interactionText(p))}</dd>
      ${r.source === 'codex' ? '' : `<dt>Codex</dt><dd title="${t('detail.mappingTitle')}">${esc(codexMappingText(p))}</dd>`}
      <dt>ID</dt><dd>${esc(p.id)}</dd>
      <dt>${t('detail.folder')}</dt><dd><button class="link" data-action="open-folder" title="${t('detail.openFolder')}">${esc(r.dir)}</button></dd>
    </dl>
    ${r.warnings.length ? `<div class="warnings"><b>${t('detail.notes')}</b><ul>${r.warnings.map((w) => `<li>${esc(diagnostic(w))}</li>`).join('')}</ul></div>` : ''}
    <p class="hint-sm" id="codex-hint"></p>`;
  renderCodexHint();
}

function renderCodexHint() {
  const box = $('#codex-hint');
  const r = stageRecord();
  if (!box || !r?.pet) return;
  if (r.source === 'codex') box.textContent = t('codex.alreadyInstalled');
  else if (r.codexExport) box.textContent = t('codex.installedHint', { folder: r.codexExport.folder, name: r.pet.name });
  else box.textContent = t('codex.hint');
}

function playDetail(name) {
  const r = stageRecord();
  if (!r?.pet) return;
  state.anim = name;
  els.stageAnim.textContent = animLabel(r.pet, name);
  for (const c of els.stageBody.querySelectorAll('.chip')) c.classList.toggle('is-active', c.dataset.anim === name);
  if (isLive(r.key) && !state.phase) api.play(name);
  else stagePreview?.play(name);
}

// ---------------------------------------------------------------- 更多菜单

function renderMenu() {
  const r = stageRecord();
  if (!r?.pet) { els.menu.hidden = true; return; }
  const items = [];
  if (r.source !== 'codex') {
    items.push({ action: 'codex', label: t(state.exporting === r.key ? 'codex.converting' : r.codexExport ? 'codex.update' : 'codex.export'), disabled: !!state.exporting });
  }
  items.push({ action: 'open-folder', label: t('detail.openFolder') });
  const a = r.pet.animations[state.anim];
  if (isLive(r.key) && a?.label) items.push({ action: 'play-live', label: t('detail.playLive', { action: animLabel(r.pet, state.anim) }) });
  els.menu.innerHTML = items.map((i) => `<button role="menuitem" data-action="${i.action}" ${i.disabled ? 'disabled' : ''}>${esc(i.label)}</button>`).join('');
}

function openMenu() { renderMenu(); els.menu.hidden = false; els.btnMore.setAttribute('aria-expanded', 'true'); }
function closeMenu() { els.menu.hidden = true; els.btnMore.setAttribute('aria-expanded', 'false'); }

async function exportToCodex(key) {
  const r = byKey(key);
  if (!r?.pet || state.exporting) return;
  state.exporting = key;
  renderMenu();
  try {
    const { bytes } = await renderCodexAtlas(r.pet, (name) => getAnim(r, name));
    const res = await api.installToCodex(key, bytes);
    if (!res.ok) throw new Error(res.error);
    toast(t('toast.exported', { name: r.pet.name }));
  } catch (e) {
    toast(t('toast.exportFailed', { error: diagnostic(e.message) }), 'error');
  } finally {
    state.exporting = null;
    renderMenu();
    renderCodexHint();
  }
}

// ---------------------------------------------------------------- 放到桌面 / 收回来

async function sendToDesktop() {
  const r = stageRecord();
  if (!r?.pet || state.phase) return;
  closeMenu();
  if (reduced()) {
    const ok = await api.activate(r.key);
    toast(ok ? t('toast.sent', { name: r.pet.name }) : t('toast.activateFailed', { name: r.pet.name }), ok ? 'info' : 'error');
    return;
  }
  state.phase = 'leaving';
  renderStageBar();
  setPhaseLabel();
  hideAway();
  const walk = walkOutAnimation(r.pet);
  const name = walk ?? entranceAnimation(r.pet) ?? 'idle';
  const walked = new Promise((res) => stagePreview.play(name, { travel: 'out', travelMs: 700, onEnd: res }));
  const ok = await api.activate(r.key);
  if (!ok) {
    state.phase = null;
    toast(t('toast.activateFailed', { name: r.pet.name }), 'error');
    stagePreview.play('idle', { travel: 'in', travelMs: 500 });
    renderStageBar();
    renderStage();
    return;
  }
  await walked;
  state.phase = null;
  showAway(r);
  toast(t('toast.sent', { name: r.pet.name }));
  renderStageBar();
}

async function recall() {
  const r = stageRecord();
  if (!r?.pet || state.phase) return;
  closeMenu();
  if (reduced()) { await api.recall(); return; }
  state.phase = 'returning';
  walkInDone = false;
  renderStageBar();
  setPhaseLabel();
  hideAway();
  const walk = walkOutAnimation(r.pet);
  stagePreview.play(walk ?? 'idle', {
    travel: 'in', travelMs: 700,
    onEnd: () => { walkInDone = true; if (!state.phase && !isLive(r.key)) playStageIdle(r); },
  });
  await api.recall();
}

// ---------------------------------------------------------------- 设置抽屉

function renderSettings() {
  const s = state.app.settings;
  const toggle = (key, title) => `<div class="setting">
      <div class="setting-text"><div class="setting-title">${title}</div></div>
      <label class="switch"><input type="checkbox" data-setting="${key}" ${s[key] ? 'checked' : ''} aria-label="${title}"><span></span></label>
    </div>`;
  const folders = state.app.sources.map((src) => {
    const usable = src.exists || src.id === 'user';
    return `<div class="folder"><span class="folder-name">${t(`source.${src.id}`)}</span><code>${esc(src.dir)}</code>
      <button class="btn btn-ghost" data-open-folder="${src.id}" ${usable ? '' : 'disabled'}>${t(usable ? 'common.open' : 'common.unavailable')}</button></div>`;
  }).join('');
  els.settings.innerHTML = `<div class="settings-inner">
    <section class="settings-group"><h2>${t('settings.application')}</h2>
      <div class="setting">
        <label class="setting-text setting-title" for="set-language">${t('settings.language')}</label>
        <select class="language-select" id="set-language" aria-label="${t('settings.language')}">
          ${['auto', 'zh-CN', 'en'].map((language) => `<option value="${language}" ${(s.language ?? 'auto') === language ? 'selected' : ''}>${t(`language.${language}`)}</option>`).join('')}
        </select>
      </div>
    </section>
    <section class="settings-group"><h2>${t('settings.pet')}</h2>
      <div class="setting">
        <div class="setting-text"><div class="setting-title">${t('settings.size')}</div></div>
        <div class="range"><input type="range" id="set-size" min="0.5" max="2" step="0.05" value="${s.size}" aria-label="${t('settings.petSize')}"><output id="size-out">${Math.round(s.size * 100)}%</output></div>
      </div>
      ${toggle('wander', t('settings.wander'))}
      ${toggle('randomActions', t('settings.randomActions'))}
      ${toggle('gravity', t('settings.gravity'))}
      ${toggle('alwaysOnTop', t('settings.alwaysOnTop'))}
    </section>
    ${state.app.supportsLoginItem ? `<section class="settings-group"><h2>${t('settings.startup')}</h2>${toggle('launchAtLogin', t('settings.launchAtLogin'))}</section>` : ''}
    <section class="settings-group"><h2>${t('settings.folders')}</h2>
      ${folders}
      <div class="setting"><div class="setting-text"><div class="setting-title">${t('toolbar.refresh')}</div></div>
        <button class="btn" data-action="refresh">${t('toolbar.refresh')}</button></div>
    </section>
    <section class="settings-group"><h2>${t('settings.about')}</h2>
      <div class="about"><b>Pets</b> v${esc(state.app.version)} · <button class="link" data-action="repo">${esc(state.app.repoUrl)}</button></div>
    </section>
  </div>`;
}

function syncSettings() {
  const s = state.app.settings;
  for (const input of els.settings.querySelectorAll('[data-setting]')) input.checked = !!s[input.dataset.setting];
  const language = $('#set-language');
  if (language && document.activeElement !== language) language.value = s.language ?? 'auto';
  const size = $('#set-size');
  if (size && document.activeElement !== size) {
    size.value = s.size;
    $('#size-out').textContent = `${Math.round(s.size * 100)}%`;
  }
}

function openDrawer() {
  state.drawer = true;
  renderSettings();
  els.drawer.inert = false;
  els.drawer.classList.add('is-open');
  els.scrim.classList.add('is-open');
  els.btnSettings.setAttribute('aria-expanded', 'true');
  $('#btn-drawer-close').focus();
}
function closeDrawer() {
  state.drawer = false;
  els.drawer.classList.remove('is-open');
  els.scrim.classList.remove('is-open');
  els.drawer.inert = true;
  els.btnSettings.setAttribute('aria-expanded', 'false');
  els.btnSettings.focus();
}

// ---------------------------------------------------------------- 提示

let toastTimer;
function toast(text, type = 'info', ms = type === 'error' ? 6000 : 2600) {
  els.toastText.textContent = text;
  els.toast.className = `toast is-shown${type === 'error' ? ' is-error' : ''}`;
  const cur = byKey(state.selected) ?? validRecords()[0];
  if (cur) paintAvatar(els.toastAvatar, cur);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.className = 'toast'), ms);
}

// ---------------------------------------------------------------- 交互

function select(key) {
  if (state.selected === key) return;
  state.selected = key;
  state.anim = 'idle';
  state.cycle = -1;
  updateCards();
  renderStageBar();
  renderStageBody();
  renderStage();
  const r = byKey(key);
  if (r?.pet && !isLive(key) && !state.phase) enterStage(r);
}

els.grid.addEventListener('click', (e) => {
  if (e.target.closest('.adopt')) return importPet();
  const card = e.target.closest('.card');
  if (card) select(card.dataset.key);
});
els.grid.addEventListener('dblclick', (e) => {
  const card = e.target.closest('.card:not(.adopt)');
  if (card) sendToDesktop();
});
els.grid.addEventListener('mouseover', (e) => {
  const card = e.target.closest('.card:not(.adopt)');
  if (!card || card.contains(e.relatedTarget)) return;
  const preview = cardPreviews.get(card.dataset.key);
  const r = byKey(card.dataset.key);
  if (preview && r?.pet && !reduced()) preview.play(waveAnimation(r.pet));
});
els.grid.addEventListener('mouseout', (e) => {
  const card = e.target.closest('.card:not(.adopt)');
  if (!card || card.contains(e.relatedTarget)) return;
  const preview = cardPreviews.get(card.dataset.key);
  if (!preview) return;
  if (isLive(card.dataset.key) && !reduced()) preview.play('idle', { speed: 0.6 });
  else preview.still();
});

els.grid.addEventListener('keydown', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const cards = [...els.grid.querySelectorAll('.card')];
  const i = cards.indexOf(card);
  const cols = (() => {
    const top = card.offsetTop;
    return cards.filter((c) => c.offsetTop === top).length || 1;
  })();
  let next = null;
  if (e.key === 'ArrowRight') next = cards[i + 1];
  else if (e.key === 'ArrowLeft') next = cards[i - 1];
  else if (e.key === 'ArrowDown') next = cards[i + cols];
  else if (e.key === 'ArrowUp') next = cards[i - cols];
  else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    if (card.classList.contains('adopt')) return importPet();
    if (state.selected !== card.dataset.key) select(card.dataset.key);
    else if (isLive(card.dataset.key)) recall();
    else sendToDesktop();
    return;
  }
  if (next) { e.preventDefault(); next.focus(); }
});

els.stageCanvas.addEventListener('click', () => {
  const r = stageRecord();
  if (!r?.pet || state.phase) return;
  if (isLive(r.key)) return recall();
  const cycle = clickCycle(r.pet);
  if (!cycle.length) return;
  state.cycle = (state.cycle + 1) % cycle.length;
  playDetail(cycle[state.cycle]);
});
els.away.addEventListener('click', () => recall());

els.btnMain.addEventListener('click', () => (els.btnMain.dataset.action === 'recall' ? recall() : sendToDesktop()));
els.btnMore.addEventListener('click', () => (els.menu.hidden ? openMenu() : closeMenu()));
els.menu.addEventListener('click', (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  closeMenu();
  if (action === 'codex') exportToCodex(state.selected);
  else if (action === 'open-folder') api.openFolder(state.selected);
  else if (action === 'play-live') api.play(state.anim);
});

els.stageBody.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-anim]');
  if (chip) return playDetail(chip.dataset.anim);
  if (e.target.closest('[data-action="open-folder"]')) api.openFolder(state.selected);
});

els.btnSettings.addEventListener('click', () => (state.drawer ? closeDrawer() : openDrawer()));
$('#btn-drawer-close').addEventListener('click', closeDrawer);
els.scrim.addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!els.menu.hidden) closeMenu();
    else if (state.drawer) closeDrawer();
  }
});
document.addEventListener('click', (e) => {
  if (!els.menu.hidden && !e.target.closest('.stage-cta')) closeMenu();
});

els.search.addEventListener('input', () => {
  state.query = els.search.value;
  renderGrid();
});
els.filters.addEventListener('click', (e) => {
  const b = e.target.closest('[data-filter]');
  if (!b) return;
  state.filter = b.dataset.filter;
  renderFilters();
  renderGrid();
});

async function importPet() {
  const res = await api.importFolder();
  if (res.canceled) return;
  if (!res.ok) return toast(t('toast.importFailed', { error: diagnostic(res.errors?.[0] ?? t('common.unknownError')) }), 'error');
  await loadRecords();
  select(res.key);
  toast(t('toast.imported', { name: res.name }));
}

els.settings.addEventListener('input', (e) => {
  if (e.target.id === 'set-size') $('#size-out').textContent = `${Math.round(Number(e.target.value) * 100)}%`;
});
els.settings.addEventListener('change', (e) => {
  const target = e.target;
  if (target.id === 'set-language') api.setSettings({ language: target.value });
  else if (target.dataset.setting) api.setSettings({ [target.dataset.setting]: target.checked });
  else if (target.id === 'set-size') api.setSettings({ size: Number(target.value) });
});
els.settings.addEventListener('click', (e) => {
  const folder = e.target.closest('[data-open-folder]');
  if (folder) api.openFolder(folder.dataset.openFolder);
  else if (e.target.closest('[data-action="repo"]')) api.openExternal(state.app.repoUrl);
  else if (e.target.closest('[data-action="refresh"]')) api.reload().then(() => toast(t('toast.refreshed')));
});

// ---------------------------------------------------------------- 启动

async function loadRecords(preserveAnimations = false) {
  state.records = await api.list();
  if (!preserveAnimations) {
    animCache.clear();
    fitCache.clear();
    tintCache.clear();
  }
  if (!byKey(state.selected)?.pet) {
    const active = byKey(state.app?.activeKey);
    state.selected = active?.pet ? active.key : (validRecords()[0]?.key ?? null);
    state.anim = 'idle';
  }
  renderFilters();
  renderGrid();
  renderProblems();
  renderStageBar();
  renderStageBody();
  renderStage();
}

api.onState((s) => {
  const changedLanguage = s.locale && s.locale !== locale;
  const wasReturning = state.phase === 'returning';
  state.app = s;
  if (changedLanguage) {
    applyLanguage();
    renderStageBody();
    if (state.drawer) renderSettings();
  }
  updateCards();
  renderStageBar();
  if (wasReturning && !s.visible) {
    state.phase = null;
    toast(t('toast.recalled', { name: stageRecord()?.pet.name ?? '' }));
    hideAway();
    if (walkInDone) playStageIdle(stageRecord());
    renderStageBar();
  } else if (!state.phase) {
    renderStage();
  }
  if (state.drawer) syncSettings();
});
api.onPetsChanged((change) => loadRecords(change?.reason === 'language'));
api.onToast((msg) => toast(msg.text, msg.type));

setInterval(() => { els.stage.dataset.phase = dayPhase(new Date().getHours()); }, 60000);

state.app = await api.state();
applyLanguage();
await loadRecords();
document.body.classList.add('is-ready');
