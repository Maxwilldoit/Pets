// 控制面板：浏览宠物仓库、预览动画、选择桌宠、导入到 Codex、调整设置。
import { planCodexExport } from '../../shared/codex.js';
import { createTranslator, localizeDiagnostic, resolveLanguage } from '../../shared/i18n.js';
import { renderCodexAtlas } from '../lib/codex-export.js';
import { drawFrame, loadAnimation, opaqueBounds } from '../lib/player.js';

const api = window.pets;
const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let locale = resolveLanguage('auto', navigator.language);
let t = createTranslator(locale);
const SLOTS = new Set(['idle', 'walk', 'walk-left', 'walk-right', 'drag', 'drag-left', 'drag-right', 'fall', 'sleep']);
const FILTERS = ['all', 'bundled', 'user', 'codex'];
const countText = (type, count) => t(`count.${type}.${count === 1 ? 'one' : 'other'}`, { count });
const diagnostic = (message) => localizeDiagnostic(message, locale);

const state = { app: null, records: [], filter: 'all', query: '', selected: null, anim: 'idle', view: 'library', exporting: null };
const els = {
  grid: $('#grid'),
  problems: $('#problems'),
  detail: $('#detail'),
  filters: $('#filters'),
  search: $('#search'),
  settings: $('#settings'),
  toast: $('#toast'),
};

const animLabel = (pet, name) => {
  if (pet.format === 'codex' && pet.animations[name]?.label) return t(`animation.${name}`);
  return pet.animations[name]?.label ?? (SLOTS.has(name) ? t(`animation.${name}`) : name);
};
// 单击能点出来的动作：带 label 的动作，去掉待机与移动（和 brain.js 的单击循环一致）
const NOT_AN_ACTION = new Set(['idle', 'walk', 'walk-left', 'walk-right', 'drag', 'drag-left', 'drag-right', 'fall']);
const clickableActions = (pet) => pet.actions.filter((n) => !NOT_AN_ACTION.has(n));
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

// ---------------------------------------------------------------- 动画预览

const animCache = new Map(); // `${key}|${动画名}` → Promise<Anim>
const fitCache = new Map(); // key → idle 第一帧的身体范围，用于统一缩放与对齐

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
        // 脚底基线：各动画自己「最低帧」的不透明底边，和桌宠窗口里 computeLayout 的算法一致，
        // 这样预览里切动画也不会上下跳。
        return { bw: b.x1 - b.x0, bh: b.y1 - b.y0, cx: (b.x0 + b.x1) / 2 - idle.box.w / 2 };
      }),
    );
  }
  return fitCache.get(record.key);
}

const previews = new Set();

class Preview {
  constructor(canvas, record, fill) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.record = record;
    this.fill = fill;
    this.visible = true;
    this.token = 0;
    previews.add(this);
  }

  async play(name) {
    const token = ++this.token;
    try {
      const [anim, fit] = await Promise.all([getAnim(this.record, name), petFit(this.record)]);
      if (token !== this.token) return;
      Object.assign(this, { anim, fit, name, start: performance.now(), lastIdx: -1, dirty: true });
    } catch (e) {
      if (token === this.token) toast(t('toast.previewFailed', { error: diagnostic(e.message) }), 'error');
    }
  }

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
    const a = this.anim;
    const t = now - this.start;
    // 按距离换帧的走路动画，在预览里按固定节奏播放
    const idx = a.def.stepDistance ? Math.floor(t / 200) % a.frames.length : a.indexAt(t);
    if (!this.dirty && idx === this.lastIdx) return;
    const pet = this.record.pet;
    const { fit } = this;
    const scale = Math.min((W * 0.86) / fit.bw, (H * this.fill) / fit.bh, pet.pixelated ? 4 : 1.5);
    const anchor = pet.animations[this.name].anchor ?? [a.box.w / 2, a.groundY()];
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = !pet.pixelated;
    ctx.imageSmoothingQuality = 'high';
    const src = drawFrame(ctx, a, idx, anchor, W / 2 - fit.cx * scale, H * 0.93, scale);
    this.dirty = !src?.exact;
    this.lastIdx = idx;
  }

  dispose() {
    this.token++;
    previews.delete(this);
  }
}

function loop(now) {
  for (const p of previews) p.draw(now);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---------------------------------------------------------------- 宠物网格

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
  const counts = { all: validRecords().length };
  for (const r of validRecords()) counts[r.source] = (counts[r.source] ?? 0) + 1;
  els.filters.innerHTML = FILTERS.map(
    (id) =>
      `<button data-filter="${id}" class="${state.filter === id ? 'is-active' : ''}">${t(`filter.${id}`)}<span>${counts[id] ?? 0}</span></button>`,
  ).join('');
}

function cardHtml(r) {
  const p = r.pet;
  const tags = p.tags
    .slice(0, 2)
    .map((t) => `<span class="tag">${esc(t)}</span>`)
    .join('');
  return `<article class="card" data-key="${esc(r.key)}" tabindex="0" aria-label="${esc(p.name)}">
    <div class="stage"><canvas></canvas><span class="badge-live">${t('card.active')}</span></div>
    <div class="card-body">
      <div class="card-title"><span class="name">${esc(p.name)}</span>${
        r.source === 'bundled' ? '' : `<span class="source">${t(`sourceShort.${r.source}`)}</span>`
      }</div>
      <p class="card-desc">${esc(p.description || t('common.noDescription'))}</p>
      <div class="card-meta">${tags}<span class="count">${p.actions.length ? countText('actions', p.actions.length) : ''}</span></div>
    </div>
  </article>`;
}

function renderGrid() {
  for (const p of cardPreviews.values()) p.dispose();
  cardPreviews.clear();
  io.disconnect();
  const list = validRecords().filter(matches);
  if (!list.length) {
    els.grid.innerHTML = validRecords().length
      ? `<div class="empty"><strong>${t('empty.searchTitle')}</strong>${t('empty.searchBody')}</div>`
      : `<div class="empty"><strong>${t('empty.libraryTitle')}</strong>${t('empty.libraryBody')}</div>`;
  } else {
    els.grid.innerHTML = list.map(cardHtml).join('');
    for (const card of els.grid.querySelectorAll('.card')) {
      const record = byKey(card.dataset.key);
      const preview = new Preview(card.querySelector('canvas'), record, 0.8);
      preview.play('idle');
      cardPreviews.set(record.key, preview);
      io.observe(card);
    }
  }
  updateCards();
}

function updateCards() {
  for (const card of els.grid.querySelectorAll('.card')) {
    card.classList.toggle('is-selected', card.dataset.key === state.selected);
    card.classList.toggle('is-live', isLive(card.dataset.key));
  }
}

function renderProblems() {
  const bad = state.records.filter((r) => !r.pet);
  els.problems.innerHTML = bad.length
    ? `<h3>${t('problems.title', { count: bad.length })}</h3>` +
      bad
        .map(
          (r) => `<div class="problem"><b>${esc(r.dirName)}</b> · ${t(`source.${r.source}`)}
            <ul>${r.errors
              .slice(0, 8)
              .map((e) => `<li>${esc(diagnostic(e))}</li>`)
              .join('')}</ul></div>`,
        )
        .join('')
    : '';
}

// ---------------------------------------------------------------- 详情

let detailPreview = null;

function interactionText(pet) {
  const acts = clickableActions(pet);
  if (pet.behavior.click) return t('detail.clickStart', { action: animLabel(pet, pet.behavior.click) });
  return t(acts.length ? 'detail.clickCycle' : 'detail.dragOnly');
}

function renderDetail() {
  detailPreview?.dispose();
  detailPreview = null;
  const r = byKey(state.selected);
  if (!r?.pet) {
    els.detail.innerHTML = `<div class="detail-empty">${t('detail.empty')}</div>`;
    return;
  }
  const p = r.pet;
  const names = Object.keys(p.animations);
  const chips = names
    .map((n) => {
      const cls = ['chip', p.animations[n].label ? '' : 'is-slot', n === state.anim ? 'is-active' : ''].join(' ');
      return `<button class="${cls}" data-anim="${esc(n)}" title="${esc(n)}">${esc(animLabel(p, n))}</button>`;
    })
    .join('');
  const sub = [
    t(`source.${r.source}`),
    p.version && `v${esc(p.version)}`,
    p.author && esc(t('detail.author', { author: p.author })),
    p.format === 'codex' && t('detail.codexFormat'),
  ]
    .filter(Boolean)
    .join(' · ');
  els.detail.innerHTML = `
    <div class="stage"><canvas></canvas><span class="detail-anim" id="detail-anim"></span></div>
    <div class="detail-body">
      <h2>${esc(p.name)}</h2>
      <div class="detail-sub">${sub}</div>
      <p class="detail-desc">${esc(p.description || t('common.noDescription'))}</p>
      <div class="detail-actions" id="detail-actions"></div>
      <div id="codex-box"></div>
      <h3>${t('detail.animations')} <small>${t('detail.preview')}</small></h3>
      <div class="chips">${chips}</div>
      <div id="play-live"></div>
      <h3>${t('detail.information')}</h3>
      <dl class="facts">
        <dt>${t('detail.animations')}</dt><dd>${countText('animations', names.length)}${p.actions.length ? ` · ${countText('actions', p.actions.length)}` : ''}</dd>
        <dt>${t('detail.interaction')}</dt><dd>${esc(interactionText(p))}</dd>
        ${
          r.source === 'codex'
            ? ''
            : `<dt>Codex</dt><dd title="${t('detail.mappingTitle')}">${esc(codexMappingText(p))}</dd>`
        }
        <dt>ID</dt><dd>${esc(p.id)}</dd>
        <dt>${t('detail.folder')}</dt><dd><button class="link" data-action="open-folder" title="${t('detail.openFolder')}">${esc(r.dir)}</button></dd>
      </dl>
      ${
        r.warnings.length
          ? `<div class="warnings"><b>${t('detail.notes')}</b><ul>${r.warnings.map((w) => `<li>${esc(diagnostic(w))}</li>`).join('')}</ul></div>`
          : ''
      }
    </div>`;
  detailPreview = new Preview(els.detail.querySelector('canvas'), r, 0.72);
  playDetail(state.anim in p.animations ? state.anim : 'idle');
  renderDetailActions();
  renderCodexBox();
}

/** 导出到 Codex 时每个状态用哪个动画，例如「挥手←打招呼 · 跳跃←跳跃」。 */
function codexMappingText(pet) {
  return planCodexExport(pet)
    .filter((row) => row.state !== 'idle')
    .map((row) => `${t(`codexState.${row.state}`)} ← ${animLabel(pet, row.anim)}${row.flip ? t('common.mirrored') : ''}`)
    .join(' · ');
}

function renderCodexBox() {
  const box = $('#codex-box');
  const r = byKey(state.selected);
  if (!box || !r?.pet) return;
  if (r.source === 'codex') {
    box.innerHTML = `<p class="hint-sm">${t('codex.alreadyInstalled')}</p>`;
    return;
  }
  const busy = state.exporting === r.key;
  const done = r.codexExport;
  const label = t(busy ? 'codex.converting' : done ? 'codex.update' : 'codex.export');
  box.innerHTML = `
    <button class="btn btn-block codex-btn" data-action="codex" ${busy ? 'disabled' : ''}>${label}</button>
    <p class="hint-sm">${
      done
        ? esc(t('codex.installedHint', { folder: done.folder, name: r.pet.name }))
        : t('codex.hint')
    }</p>`;
}

async function exportToCodex(key) {
  const r = byKey(key);
  if (!r?.pet || state.exporting) return;
  state.exporting = key;
  renderCodexBox();
  try {
    const { bytes } = await renderCodexAtlas(r.pet, (name) => getAnim(r, name));
    const res = await api.installToCodex(key, bytes);
    if (!res.ok) throw new Error(res.error);
    toast(t('toast.exported', { name: r.pet.name }));
  } catch (e) {
    toast(t('toast.exportFailed', { error: diagnostic(e.message) }), 'error');
  } finally {
    state.exporting = null;
    renderCodexBox();
  }
}

function playDetail(name) {
  const r = byKey(state.selected);
  if (!r?.pet) return;
  state.anim = name;
  detailPreview?.play(name);
  $('#detail-anim').textContent = animLabel(r.pet, name);
  for (const c of els.detail.querySelectorAll('.chip')) c.classList.toggle('is-active', c.dataset.anim === name);
  renderPlayLive();
}

function renderDetailActions() {
  const box = $('#detail-actions');
  if (!box) return;
  box.innerHTML = isLive(state.selected)
    ? `<button class="btn btn-lg btn-ok" disabled>✓ ${t('detail.active')}</button><button class="btn btn-lg btn-shrink" data-action="hide">${t('detail.hide')}</button>`
    : `<button class="btn btn-lg btn-primary" data-action="activate">${t('detail.activate')}</button>`;
  renderPlayLive();
}

function renderPlayLive() {
  const box = $('#play-live');
  if (!box) return;
  const r = byKey(state.selected);
  const a = r?.pet.animations[state.anim];
  box.innerHTML =
    isLive(state.selected) && a?.label
      ? `<button class="btn play-live" data-action="play-live">${esc(t('detail.playLive', { action: animLabel(r.pet, state.anim) }))}</button>`
      : '';
}

// ---------------------------------------------------------------- 设置

function renderSettings() {
  const s = state.app.settings;
  const toggle = (key, title) => `<div class="setting">
      <div class="setting-text"><div class="setting-title">${title}</div></div>
      <label class="switch"><input type="checkbox" data-setting="${key}" ${s[key] ? 'checked' : ''} aria-label="${title}"><span></span></label>
    </div>`;
  const folders = state.app.sources
    .map((src) => {
      const usable = src.exists || src.id === 'user';
      return `<div class="folder"><span class="folder-name">${t(`source.${src.id}`)}</span><code>${esc(src.dir)}</code>
        <button class="btn btn-ghost" data-open-folder="${src.id}" ${usable ? '' : 'disabled'}>${t(usable ? 'common.open' : 'common.unavailable')}</button></div>`;
    })
    .join('');
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
    ${state.app.supportsLoginItem
      ? `<section class="settings-group"><h2>${t('settings.startup')}</h2>
          ${toggle('launchAtLogin', t('settings.launchAtLogin'))}
        </section>`
      : ''}
    <section class="settings-group"><h2>${t('settings.folders')}</h2>
      ${folders}
    </section>
    <section class="settings-group"><h2>${t('settings.about')}</h2>
      <div class="about"><b>Pets</b> v${esc(state.app.version)} · <button class="link" data-action="repo">${esc(state.app.repoUrl)}</button></div>
    </section>
  </div>`;
}

/** 状态更新时只同步控件的值，避免拖动滑块时被重绘打断。 */
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

// ---------------------------------------------------------------- 提示

let toastTimer;
function toast(text, type = 'info', ms = type === 'error' ? 6000 : 2600) {
  els.toast.textContent = text;
  els.toast.className = `toast is-shown${type === 'error' ? ' is-error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.className = 'toast'), ms);
}

// ---------------------------------------------------------------- 交互

function select(key) {
  if (state.selected === key) return;
  state.selected = key;
  state.anim = 'idle';
  updateCards();
  renderDetail();
}

async function activate(key) {
  const r = byKey(key);
  if (!r?.pet) return;
  if (!(await api.activate(key))) return toast(t('toast.activateFailed', { name: r.pet.name }), 'error');
  toast(t('toast.activated', { name: r.pet.name }));
  select(key);
}

function setView(view) {
  state.view = view;
  for (const t of document.querySelectorAll('.tab')) {
    const on = t.dataset.view === view;
    t.classList.toggle('is-active', on);
    t.setAttribute('aria-selected', String(on));
  }
  $('#view-library').classList.toggle('is-active', view === 'library');
  $('#view-settings').classList.toggle('is-active', view === 'settings');
  if (view === 'settings') renderSettings();
}

els.grid.addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  select(card.dataset.key);
});
els.grid.addEventListener('dblclick', (e) => {
  const card = e.target.closest('.card');
  if (card && !e.target.closest('button')) activate(card.dataset.key);
});
els.grid.addEventListener('keydown', (e) => {
  const card = e.target.closest('.card');
  if (card && e.target === card && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    select(card.dataset.key);
  }
});

els.detail.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-anim]');
  if (chip) return playDetail(chip.dataset.anim);
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'activate') activate(state.selected);
  else if (action === 'hide') api.setVisible(false);
  else if (action === 'open-folder') api.openFolder(state.selected);
  else if (action === 'play-live') api.play(state.anim);
  else if (action === 'codex') exportToCodex(state.selected);
});

for (const tab of document.querySelectorAll('.tab')) tab.addEventListener('click', () => setView(tab.dataset.view));

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

$('#btn-import').addEventListener('click', async () => {
  const res = await api.importFolder();
  if (res.canceled) return;
  if (!res.ok) return toast(t('toast.importFailed', { error: diagnostic(res.errors?.[0] ?? t('common.unknownError')) }), 'error');
  await loadRecords();
  select(res.key);
  toast(t('toast.imported', { name: res.name }));
});
$('#btn-folder').addEventListener('click', () => api.openFolder('user'));
$('#btn-reload').addEventListener('click', async () => {
  await api.reload();
  toast(t('toast.refreshed'));
});

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
});

// ---------------------------------------------------------------- 启动

async function loadRecords(preserveAnimations = false) {
  state.records = await api.list();
  if (!preserveAnimations) {
    animCache.clear();
    fitCache.clear();
  }
  if (!byKey(state.selected)?.pet) {
    const active = byKey(state.app?.activeKey);
    state.selected = active?.pet ? active.key : (validRecords()[0]?.key ?? null);
    state.anim = 'idle';
  }
  renderFilters();
  renderGrid();
  renderProblems();
  renderDetail();
}

api.onState((s) => {
  const changedLanguage = s.locale && s.locale !== locale;
  state.app = s;
  if (changedLanguage) applyLanguage();
  updateCards();
  renderDetailActions();
  if (state.view === 'settings') {
    if (changedLanguage) {
      const focused = document.activeElement?.id;
      const scrollTop = els.settings.scrollTop;
      renderSettings();
      els.settings.scrollTop = scrollTop;
      if (focused === 'set-language') $('#set-language').focus();
    } else syncSettings();
  }
});
api.onPetsChanged((change) => loadRecords(change?.reason === 'language'));
api.onToast((t) => toast(t.text, t.type));

state.app = await api.state();
applyLanguage();
await loadRecords();
