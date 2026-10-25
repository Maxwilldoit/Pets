// 桌宠窗口：加载动画 → 行为状态机驱动 → 移动透明窗口并绘制当前帧。
// 窗口大小 = 舞台（能装下所有动画），宠物脚底锚点固定在舞台的 (ax, ay)，移动窗口就是移动宠物。
import { PetBrain } from '../../shared/brain.js';
import { createTranslator, resolveLanguage } from '../../shared/i18n.js';
import { computeLayout, drawFrame, frameIndex, loadPetAnimations } from '../lib/player.js';

const host = window.petHost;
const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const ALPHA_HIT = 40;

// Register before the asynchronous init/asset loading so settings changes made
// while a pet is starting are not silently lost.
const pendingCommands = [];
let commandHandler = null;
host.onCommand((cmd) => {
  if (commandHandler) commandHandler(cmd);
  else pendingCommands.push(cmd);
});

const init = await host.init();
if (!init) throw new Error(createTranslator(resolveLanguage('auto', navigator.language))('error.petWindowInit'));
const pet = init.record.pet;
document.documentElement.lang = init.locale;
document.title = pet.name;
let settings = init.settings;

let anims;
try {
  anims = await loadPetAnimations(pet, init.record.assetBase, (msg) => host.log('error', msg));
} catch (e) {
  host.log('fatal', e.message);
  throw e;
}

let layout;
let dpr = window.devicePixelRatio || 1;
let dirty = true;
let shown = { anim: null, idx: -1, flip: false };
let lastBounds = null;
let lastPointerOrigin = null;

const brainSettings = (s) => ({ wander: s.wander, randomActions: s.randomActions, gravity: s.gravity });

function brainMetrics() {
  const s = layout.scale;
  const meta = {};
  for (const [name, a] of Object.entries(anims)) {
    const def = pet.animations[name];
    meta[name] = { durationMs: a.totalMs, repeat: def.repeat, weight: def.weight, label: def.label, moveX: (def.moveX ?? 0) * s, mirror: def.mirror };
  }
  return { anims: meta, speed: pet.speed * s, body: layout.body };
}

function relayout() {
  layout = computeLayout(pet, anims, pet.scale * settings.size);
  dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${layout.stage.w}px`;
  canvas.style.height = `${layout.stage.h}px`;
  canvas.width = Math.max(1, Math.round(layout.stage.w * dpr));
  canvas.height = Math.max(1, Math.round(layout.stage.h * dpr));
  dirty = true;
  lastBounds = null;
}

relayout();
const brain = new PetBrain({
  ...brainMetrics(),
  behavior: pet.behavior,
  areas: init.areas,
  settings: brainSettings(settings),
  position: init.position,
});

// ---------------------------------------------------------------- 绘制与移动

function draw(v) {
  const name = anims[v.anim] ? v.anim : 'idle';
  const anim = anims[name];
  const idx = frameIndex(anim, v.animTime, v.distance / layout.scale);
  if (!dirty && idx === shown.idx && name === shown.anim && v.flip === shown.flip) return false;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = !pet.pixelated;
  ctx.imageSmoothingQuality = 'high';
  const src = drawFrame(ctx, anim, idx, layout.anchors[name], layout.stage.ax, layout.stage.ay, layout.scale, v.flip);
  dirty = !src?.exact; // 帧还在解码：下一拍再画
  shown = { anim: name, idx, flip: v.flip };
  return true;
}

let prev = performance.now();
let lastSave = 0;
let saved = null;
let readySent = false;

function tick() {
  const now = performance.now();
  // 按下后先稳住窗口，越过拖拽阈值或松手后再继续推进。
  const v = brain.update(press && !press.dragging ? 0 : (now - prev) / 1000);
  prev = now;
  if ((window.devicePixelRatio || 1) !== dpr) relayout();

  const b = { x: Math.round(v.x - layout.stage.ax), y: Math.round(v.y - layout.stage.ay), width: layout.stage.w, height: layout.stage.h };
  if (!lastBounds || b.x !== lastBounds.x || b.y !== lastBounds.y || b.width !== lastBounds.width || b.height !== lastBounds.height) {
    host.setBounds(b);
    lastBounds = b;
    hitTestPending = true;
  }
  const frameChanged = draw(v);
  // setBounds 是异步提交的；按原生窗口实际到达的位置重算静止鼠标的命中。
  const origin = { x: window.screenX ?? 0, y: window.screenY ?? 0 };
  const originChanged = !lastPointerOrigin || origin.x !== lastPointerOrigin.x || origin.y !== lastPointerOrigin.y;
  lastPointerOrigin = origin;
  if (pointer && !press && (frameChanged || hitTestPending || originChanged)) {
    setIgnore(!hit(pointer.x - origin.x, pointer.y - origin.y));
    hitTestPending = false;
  }
  if (!readySent) {
    host.ready();
    readySent = true;
  }
  if (now - lastSave > 3000 && v.mode !== 'drag' && v.mode !== 'fall') {
    lastSave = now;
    if (!saved || Math.abs(saved.x - v.x) > 2 || Math.abs(saved.y - v.y) > 2) {
      saved = { x: v.x, y: v.y };
      host.savePosition(saved);
    }
  }
}

// ---------------------------------------------------------------- 鼠标：像素级点击穿透、拖动、单击切换动作

function hit(clientX, clientY) {
  const r = Math.max(1, Math.round(2 * dpr)); // 边缘放宽几像素，细小部位也好抓
  const x = Math.floor(clientX * dpr);
  const y = Math.floor(clientY * dpr);
  const sx = Math.max(0, x - r);
  const sy = Math.max(0, y - r);
  const w = Math.min(canvas.width, x + r + 1) - sx;
  const h = Math.min(canvas.height, y + r + 1) - sy;
  if (w <= 0 || h <= 0) return false;
  const data = ctx.getImageData(sx, sy, w, h).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] > ALPHA_HIT) return true;
  return false;
}

let ignoring = true; // 主进程创建窗口时已设为穿透
let pointer = null;
let hitTestPending = true;
function setIgnore(value) {
  if (value !== ignoring) {
    ignoring = value;
    host.setIgnoreMouse(value);
  }
}

let press = null;

function rememberPointer(e) {
  pointer = {
    x: Number.isFinite(e.screenX) ? e.screenX : (window.screenX ?? 0) + e.clientX,
    y: Number.isFinite(e.screenY) ? e.screenY : (window.screenY ?? 0) + e.clientY,
  };
}

// 单击：立刻切到下一个动作。不做双击判定——等待 280ms 会让每次切换都发涩；
// brain 里的双击本来也只是「再切一个」。
function onClick() {
  brain.click();
}

function endPress(cancelled) {
  const p = press;
  press = null;
  if (!p) return;
  host.stopDragPolling?.();
  // 先清会话，再释放捕获，避免 lostpointercapture 把松手重复处理。
  try {
    if (canvas.hasPointerCapture?.(p.pointerId)) canvas.releasePointerCapture(p.pointerId);
  } catch { /* 原生窗口移动时捕获可能已经失效。 */ }
  if (p.dragging) brain.release();
  else if (!cancelled) onClick();
  hitTestPending = true;
}

function movePress(e) {
  if (!press) return;
  if (press.pointerId !== null && e.pointerId !== undefined && e.pointerId !== press.pointerId) return;
  // 穿透窗口转发移动事件时，部分设备/平台不会带上左键位；不能据此结束拖动。
  // 释放由 window 的 pointerup / mouseup（以及下一次 press 替换和 blur）负责。
  if (!press.dragging) {
    if (Math.hypot(e.screenX - press.x, e.screenY - press.y) < 4) return;
    press.dragging = true;
    brain.grab(press.x, press.y);
  }
  // 同一物理移动可能同时产生 pointermove 与兼容 mousemove，只推进一次。
  if (e.screenX === press.lastX && e.screenY === press.lastY) return;
  press.lastX = e.screenX;
  press.lastY = e.screenY;
  brain.dragTo(e.screenX, e.screenY);
}

window.addEventListener('mousemove', (e) => {
  rememberPointer(e);
  // Electron 穿透窗口转发的 mousemove 也必须能驱动拖拽。
  if (press?.pointerType === 'mouse') movePress(e);
  if (!press) setIgnore(!hit(e.clientX, e.clientY));
}, true);
document.addEventListener('mouseleave', () => {
  if (!press) {
    // 保留最后的屏幕坐标：自由走动把窗口挪回静止鼠标下方时，tick 仍可恢复命中。
    setIgnore(true);
  }
});
function startPress(e) {
  if (e.button !== 0 || !hit(e.clientX, e.clientY)) return;
  const pointerType = e.pointerType || 'mouse';
  if (press) {
    if (pointerType !== 'mouse' || press.pointerType !== 'mouse') return;
    endPress(true);
  }
  rememberPointer(e);
  press = { pointerId: Number.isFinite(e.pointerId) ? e.pointerId : null, pointerType, x: e.screenX, y: e.screenY, dragging: false };
  // 每次有效按下都强制恢复原生交互，避免缓存值与窗口实际穿透状态不同步。
  ignoring = false;
  host.setIgnoreMouse(false);
  if (pointerType === 'mouse') host.startDragPolling?.();
  if (press.pointerId !== null) {
    try { canvas.setPointerCapture(press.pointerId); } catch { /* mousemove 路径仍可继续拖动。 */ }
  }
}

canvas.addEventListener('pointerdown', startPress);
// 部分透明窗口/输入设备只派发兼容 mouse 事件；mousedown 作为起点兜底。
canvas.addEventListener('mousedown', (e) => {
  if (!press) startPress(e);
});
window.addEventListener('pointermove', (e) => {
  if (!press || (press.pointerId !== null && e.pointerId !== press.pointerId)) return;
  rememberPointer(e);
  movePress(e);
}, true);
window.addEventListener('pointerup', (e) => {
  if (press?.pointerId === e.pointerId && e.button === 0) endPress(false);
}, true);
window.addEventListener('mouseup', (e) => {
  if (e.button === 0 && press?.pointerType === 'mouse') endPress(false);
}, true);
window.addEventListener('pointercancel', (e) => {
  if (press?.pointerId === e.pointerId) endPress(true);
}, true);
window.addEventListener('lostpointercapture', (e) => {
  if (!press || press.pointerId !== e.pointerId) return;
  if (press.pointerType !== 'mouse') {
    endPress(true);
    return;
  }
  // 搬动原生窗口时可能丢捕获；尝试恢复，鼠标事件路径继续兜底。
  try { canvas.setPointerCapture(press.pointerId); } catch { /* 指针已释放时由 mouseup/buttons 清理。 */ }
}, true);
window.addEventListener('blur', () => endPress(true));
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (hit(e.clientX, e.clientY)) host.showMenu();
});

// ---------------------------------------------------------------- 主进程指令

function applyCommand(cmd) {
  if (cmd.type === 'play') brain.play(cmd.name);
  else if (cmd.type === 'areas') brain.setAreas(cmd.areas);
  else if (cmd.type === 'drag-cursor' && press?.pointerType === 'mouse') {
    movePress({ screenX: cmd.x, screenY: cmd.y, buttons: 1 });
  }
  else if (cmd.type === 'settings') {
    document.documentElement.lang = cmd.locale;
    document.title = cmd.title ?? document.title;
    const resized = cmd.settings.size !== settings.size;
    const behaviorChanged = ['wander', 'randomActions', 'gravity'].some((key) => cmd.settings[key] !== settings[key]);
    settings = cmd.settings;
    if (behaviorChanged) brain.setSettings(brainSettings(settings));
    if (resized) {
      relayout();
      brain.setMetrics(brainMetrics());
    }
  }
}

commandHandler = applyCommand;
for (const cmd of pendingCommands.splice(0)) applyCommand(cmd);

// 调试（--pets-debug）：暴露内部状态，方便自动化测试
if (init.debug) {
  window.__pet = { brain, anims, hit, get layout() { return layout; }, get ignoring() { return ignoring; } };
}

tick();
setInterval(tick, 16);
