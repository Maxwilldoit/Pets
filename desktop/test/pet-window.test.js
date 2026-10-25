import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { PetBrain } from '../src/shared/brain.js';
import { createTranslator, resolveLanguage } from '../src/shared/i18n.js';
import { computeLayout, drawFrame, frameIndex } from '../src/renderer/lib/player.js';

globalThis.OffscreenCanvas = class {
  constructor(width, height) { this.width = width; this.height = height; }
  getContext() {
    return {
      drawImage() {},
      getImageData(_x, _y, width, height) {
        const data = new Uint8ClampedArray(width * height * 4);
        for (let i = 3; i < data.length; i += 4) data[i] = 255;
        return { data };
      },
    };
  }
};

const initialSettings = { size: 1, wander: false, randomActions: false, gravity: true };

function makeHost(settings) {
  let command;
  const calls = { commands: [], ignores: [], bounds: [], dragStarts: 0, dragStops: 0 };
  const host = {
    init: async () => ({
      record: {
        pet: {
          name: 'Test Pet',
          animations: {
            idle: { repeat: 1, weight: 0, mirror: true, moveX: 0 },
            walk: { mirror: true },
            wave: { label: 'Wave' },
            bow: { label: 'Bow' },
          },
          behavior: { click: 'wave' }, scale: 1, speed: 50, pixelated: true,
        },
        assetBase: 'pets://app/assets/user/test/',
      },
      settings: { ...initialSettings, ...settings },
      locale: 'en',
      areas: [{ x: 0, y: 0, width: 1000, height: 700 }],
      position: { x: 500, y: 700 },
      debug: true,
    }),
    onCommand(callback) { command = callback; },
    send(message) { calls.commands.push({ type: message.type, delivered: !!command }); command?.(message); },
    setBounds(bounds) { calls.bounds.push({ ...bounds }); },
    setIgnoreMouse(ignore) { calls.ignores.push(ignore); },
    startDragPolling() { calls.dragStarts++; },
    stopDragPolling() { calls.dragStops++; },
    savePosition() {}, ready() {}, log() {}, showMenu() {},
  };
  return { host, calls };
}

async function startPetWindow({ settings, animatedIdle = false, captureFails = false, applyBoundsImmediately = true } = {}) {
  const { host, calls } = makeHost(settings);
  let resolveLoading;
  const loading = new Promise((resolve) => { resolveLoading = resolve; });
  let now = 1;
  let opaque = true;
  const captured = new Set();
  calls.captureRequests = [];
  calls.captureReleases = [];
  function eventTarget() {
    const listeners = new Map();
    return {
      addEventListener(type, callback, options = false) {
        const handlers = listeners.get(type) ?? [];
        handlers.push({ callback, capture: typeof options === 'boolean' ? options : !!options.capture });
        listeners.set(type, handlers);
      },
      dispatch(type, event, capture) {
        for (const listener of listeners.get(type) ?? []) {
          if (listener.capture === capture) listener.callback(event);
        }
      },
    };
  }
  const canvas = {
    ...eventTarget(),
    style: {}, width: 40, height: 100,
    setPointerCapture(pointerId) {
      calls.captureRequests.push(pointerId);
      if (captureFails) throw new Error('Native pointer capture unavailable');
      captured.add(pointerId);
    },
    hasPointerCapture: (pointerId) => captured.has(pointerId),
    releasePointerCapture(pointerId) {
      calls.captureReleases.push(pointerId);
      if (!captured.delete(pointerId)) return;
      // Dispatch synchronously to exercise cleanup when releasing capture re-enters a listener.
      input('lostpointercapture', { pointerId, buttons: 0 });
    },
    getContext: () => ({
      setTransform() {}, clearRect() {}, save() {}, restore() {},
      drawImage(image) { opaque = image.opaque !== false; },
      getImageData(_x, _y, width, height) {
        const data = new Uint8ClampedArray(width * height * 4);
        if (opaque) for (let i = 3; i < data.length; i += 4) data[i] = 255;
        return { data };
      },
    }),
  };
  const document = {
    ...eventTarget(),
    documentElement: {}, title: '',
    getElementById: () => canvas,
  };
  const window = {
    ...eventTarget(),
    petHost: host, devicePixelRatio: 1,
    screenX: 0, screenY: 0,
  };
  function applyBounds(bounds = calls.bounds.at(-1)) {
    window.screenX = bounds.x;
    window.screenY = bounds.y;
  }
  const recordBounds = host.setBounds;
  host.setBounds = (bounds) => {
    recordBounds(bounds);
    if (applyBoundsImmediately) applyBounds(bounds);
  };
  function input(type, attributes = {}, target = type.includes('pointer') ? canvas : window) {
    const isPointer = type.includes('pointer');
    const screenX = attributes.screenX ?? window.screenX + (attributes.clientX ?? 15);
    const screenY = attributes.screenY ?? window.screenY + (attributes.clientY ?? 15);
    const event = {
      button: 0,
      buttons: ['pointerdown', 'pointermove'].includes(type) ? 1 : 0,
      ...(isPointer ? { pointerId: 1, pointerType: 'mouse', isPrimary: true } : {}),
      ...attributes,
      type, target,
      screenX, screenY,
      clientX: attributes.clientX ?? screenX - window.screenX,
      clientY: attributes.clientY ?? screenY - window.screenY,
      preventDefault() {},
    };
    if (type === 'lostpointercapture') captured.delete(event.pointerId);
    const route = target === canvas ? [window, document, canvas] : target === document ? [window, document] : [window];
    for (const node of route) node.dispatch(type, event, true);
    for (const node of [...route].reverse()) {
      if (type !== 'mouseleave' || node === target) node.dispatch(type, event, false);
    }
    if (['pointerup', 'pointercancel'].includes(type) && captured.delete(event.pointerId)) {
      input('lostpointercapture', { ...event, buttons: 0 });
    }
    return event;
  }
  const frame = (delay, visible) => ({ duration: delay, w: 40, h: 100, x: 0, y: 0, img: { opaque: visible } });
  function animation(blinks = false) {
    const frames = blinks ? [frame(10, true), frame(10, false)] : [frame(1000, true)];
    return {
      def: {}, box: { w: 40, h: 100 }, totalMs: blinks ? 20 : 1000, frames,
      groundY: () => 100,
      indexAt: (time) => blinks && time >= 10 ? 1 : 0,
      source: (index) => ({ image: frames[index].img, sx: 0, sy: 0, exact: true }),
    };
  }
  const anims = { idle: animation(animatedIdle), walk: animation(), wave: animation(), bow: animation() };
  const source = fs.readFileSync(path.resolve(import.meta.dirname, '../src/renderer/pet/pet.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '');
  const running = new vm.Script(`(async () => { ${source}\n return { brain, get settings() { return settings; }, get layout() { return layout; }, get ignoring() { return ignoring; }, hit, tick }; })()`)
    .runInNewContext({
      window, document, console,
      PetBrain: class extends PetBrain {
        constructor(options) { super({ ...options, random: () => 0.5 }); }
      },
      createTranslator, resolveLanguage,
      computeLayout, drawFrame, frameIndex, loadPetAnimations: () => loading,
      performance: { now: () => now }, setInterval() {}, navigator: { language: 'en' },
    });
  await Promise.resolve();
  await Promise.resolve();
  return {
    host, calls, running, input, window, document, canvas, applyBounds,
    failCapture: () => { captureFails = true; },
    finishLoading: () => resolveLoading(anims),
    advance: (milliseconds) => { now += milliseconds; },
    move: (x, y) => input('mousemove', { clientX: x, clientY: y }),
  };
}

async function readyPetWindow(options) {
  const petWindow = await startPetWindow(options);
  petWindow.finishLoading();
  const page = await petWindow.running;
  return { ...petWindow, page };
}

function runFor(petWindow, milliseconds) {
  for (let remaining = milliseconds; remaining > 0;) {
    const step = Math.min(100, remaining);
    petWindow.advance(step);
    petWindow.page.tick();
    remaining -= step;
  }
}

async function walkingPetWindow(settings) {
  const petWindow = await readyPetWindow({ settings: { wander: true, gravity: false, ...settings } });
  const startX = petWindow.page.brain.view.x;
  runFor(petWindow, 6000);
  assert.equal(petWindow.page.brain.view.mode, 'walk');
  assert.ok(petWindow.page.brain.view.x > startX, 'fixture must have actually wandered before grabbing');
  return petWindow;
}

test('宠物窗口保留动画加载期间到达的设置和显示器更新', async () => {
  const petWindow = await startPetWindow();
  petWindow.host.send({ type: 'settings', settings: { ...initialSettings, size: 2, gravity: false }, locale: 'en' });
  petWindow.host.send({ type: 'areas', areas: [{ x: 0, y: 0, width: 800, height: 500 }] });
  petWindow.finishLoading();
  const page = await petWindow.running;
  assert.deepEqual(petWindow.calls.commands.map((command) => command.delivered), [true, true]);
  assert.equal(page.settings.size, 2);
  assert.deepEqual(page.brain.areas, [{ x: 0, y: 0, width: 800, height: 500 }]);
});

test('动画把静止指针下的区域变透明后，窗口会恢复点击穿透', async () => {
  const petWindow = await startPetWindow({ animatedIdle: true });
  petWindow.finishLoading();
  const page = await petWindow.running;
  petWindow.move(15, 15);
  assert.equal(page.ignoring, false);
  petWindow.advance(600);
  page.tick();
  assert.equal(page.hit(15, 15), false);
  assert.equal(page.ignoring, true);
});

test('自由走动后仅有 window mousemove 也能拖动，松手下落而不切动作', async (t) => {
  const petWindow = await walkingPetWindow({ gravity: true });
  const { page, input, window, calls, canvas } = petWindow;
  const release = t.mock.method(page.brain, 'release');
  const click = t.mock.method(page.brain, 'click');
  const before = page.brain.view;
  const down = input('pointerdown');
  input('mousemove', { screenX: down.screenX + 30, screenY: down.screenY - 20, buttons: 1 });
  assert.equal(page.brain.view.mode, 'drag');
  assert.equal(page.brain.view.x, before.x + 30);
  assert.equal(page.brain.view.y, before.y - 20);
  petWindow.advance(16);
  page.tick();
  const finish = { screenX: down.screenX + 50, screenY: down.screenY - 30 };
  input('mousemove', { ...finish, buttons: 1 });
  assert.equal(page.brain.view.x, before.x + 50, 'dragging must continue after the native window moves');
  input('pointerup', finish);
  input('mouseup', finish, window);
  assert.equal(page.brain.view.mode, 'fall');
  assert.equal(click.mock.callCount(), 0);
  assert.equal(release.mock.callCount(), 1);
  assert.equal(calls.captureReleases.length, 1);
  assert.equal(canvas.hasPointerCapture(down.pointerId), false);
});

test('候选按压暂停自由走动，阈值内松手仍只切换一次动作', async () => {
  const petWindow = await walkingPetWindow();
  const { page, input, calls, canvas } = petWindow;
  const before = page.brain.view;
  const boundsBefore = calls.bounds.length;
  const down = input('pointerdown');
  runFor(petWindow, 8000);
  assert.deepEqual(page.brain.view, before, 'holding below the threshold must pause movement and animation time');
  assert.equal(calls.bounds.length, boundsBefore);
  const finish = { screenX: down.screenX + 3, screenY: down.screenY };
  input('mousemove', { ...finish, buttons: 1 });
  assert.equal(page.brain.view.mode, 'walk');
  input('pointerup', finish);
  input('mouseup', finish);
  assert.deepEqual([page.brain.view.mode, page.brain.view.anim], ['action', 'wave']);
  assert.equal(canvas.hasPointerCapture(down.pointerId), false);
  input('pointerdown', { pointerId: 2 });
  input('pointerup', { pointerId: 2 });
  input('mouseup');
  assert.equal(page.brain.view.anim, 'bow', 'the next click must advance exactly one action');
});

test('pointer 拖动保留兼容事件去重、异指针隔离和非鼠标取消', async (t) => {
  const { page, input, window } = await readyPetWindow({ settings: { gravity: false } });
  const drag = t.mock.method(page.brain, 'dragTo');
  const release = t.mock.method(page.brain, 'release');
  const before = page.brain.view;
  const down = input('pointerdown', { pointerId: 7 });
  const first = { screenX: down.screenX + 10, screenY: down.screenY - 10, buttons: 1 };
  input('pointermove', { ...first, pointerId: 7 });
  input('mousemove', first);
  assert.equal(page.brain.view.mode, 'drag');
  assert.equal(drag.mock.callCount(), 1);
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) {
    input(type, { pointerId: 8, pointerType: 'touch', screenX: down.screenX + 200 });
    assert.equal(page.brain.view.mode, 'drag', type + ' from another pointer must not end the gesture');
    assert.equal(page.brain.view.x, before.x + 10, type + ' from another pointer must not move the pet');
  }
  const second = { screenX: down.screenX + 20, screenY: down.screenY - 20, buttons: 1 };
  input('mousemove', second);
  input('pointermove', { ...second, pointerId: 7 });
  assert.equal(drag.mock.callCount(), 2, 'compatibility events must deduplicate in either order');
  assert.equal(page.brain.view.x, before.x + 20);
  input('pointerup', { ...second, pointerId: 7, buttons: 0 }, window);
  input('mouseup', { ...second, buttons: 0 });
  assert.deepEqual([page.brain.view.mode, page.brain.view.anim], ['idle', 'idle']);
  assert.equal(release.mock.callCount(), 1);

  const pen = input('pointerdown', { pointerId: 9, pointerType: 'pen' });
  const penMove = { pointerId: 9, pointerType: 'pen', screenX: pen.screenX + 10, buttons: 1 };
  input('pointermove', penMove);
  assert.equal(page.brain.view.mode, 'drag');
  const penX = page.brain.view.x;
  input('mousemove', { screenX: pen.screenX + 100, buttons: 1 });
  assert.equal(page.brain.view.x, penX, 'mouse compatibility events must not drive a pen session');
  input('lostpointercapture', penMove);
  input('pointermove', { ...penMove, screenX: pen.screenX + 20 });
  assert.equal(page.brain.view.mode, 'idle');
  assert.equal(page.brain.view.x, penX);
  assert.equal(release.mock.callCount(), 2);
  input('pointerdown', { pointerId: 10, pointerType: 'pen' });
  input('pointercancel', { pointerId: 10, pointerType: 'pen' }, window);
  input('pointerup', { pointerId: 10, pointerType: 'pen' }, window);
  assert.deepEqual([page.brain.view.mode, page.brain.view.anim], ['idle', 'idle']);
});

test('捕获失败或鼠标丢失捕获后，window mousemove 和 mouseup 仍能完成拖动', async (t) => {
  for (const captureFails of [false, true]) {
    await t.test(captureFails ? '按下时捕获失败' : '按下时捕获成功', async (t) => {
      const petWindow = await readyPetWindow({ captureFails, settings: { gravity: false } });
      const { page, input, canvas, document, window } = petWindow;
      const release = t.mock.method(page.brain, 'release');
      assert.equal(page.ignoring, true);
      let down;
      assert.doesNotThrow(() => { down = input('pointerdown'); });
      assert.equal(page.ignoring, false, 'a valid press must turn off mouse passthrough even without a hover event');
      input('lostpointercapture', { pointerId: down.pointerId, buttons: 1 });
      assert.equal(canvas.hasPointerCapture(down.pointerId), !captureFails);
      input('mousemove', { screenX: down.screenX + 30, buttons: 1 });
      assert.equal(page.brain.view.mode, 'drag');
      const firstX = page.brain.view.x;
      input('mouseleave', {}, document);
      assert.equal(page.ignoring, false);
      petWindow.failCapture();
      assert.doesNotThrow(() => input('lostpointercapture', { pointerId: down.pointerId, buttons: 1 }));
      input('mousemove', { screenX: down.screenX + 60, buttons: 1 });
      assert.equal(page.brain.view.mode, 'drag');
      assert.equal(page.brain.view.x, firstX + 30);
      input('mouseup', { screenX: down.screenX + 90 }, window);
      input('pointerup', { pointerId: down.pointerId });
      assert.deepEqual([page.brain.view.mode, page.brain.view.anim], ['idle', 'idle']);
      assert.equal(release.mock.callCount(), 1);
      assert.equal(canvas.hasPointerCapture(down.pointerId), false);
    });
  }
});

test('鼠标移动即使只有 buttons=0 也能拖动，真实 mouseup 结束且不补点击', async (t) => {
  const { page, input, window } = await readyPetWindow({ settings: { gravity: false } });
  const release = t.mock.method(page.brain, 'release');
  const click = t.mock.method(page.brain, 'click');
  const beforeX = page.brain.view.x;
  const down = input('pointerdown');
  const moving = { screenX: down.screenX + 30, screenY: down.screenY - 10, buttons: 0 };
  input('mousemove', moving);
  assert.equal(page.brain.view.mode, 'drag');
  assert.equal(page.brain.view.x, beforeX + 30);
  input('mouseup', { ...moving, buttons: 0 }, window);
  assert.deepEqual([page.brain.view.mode, page.brain.view.anim], ['idle', 'idle']);
  assert.equal(release.mock.callCount(), 1);
  assert.equal(click.mock.callCount(), 0);
});

test('透明窗口只派发兼容 mousedown 时仍能开始拖动', async (t) => {
  const petWindow = await readyPetWindow({ settings: { gravity: false } });
  const { page, input, window, canvas } = petWindow;
  const release = t.mock.method(page.brain, 'release');
  const click = t.mock.method(page.brain, 'click');
  const beforeX = page.brain.view.x;
  const down = input('mousedown', {}, canvas);
  assert.equal(page.ignoring, false);
  input('mousemove', { screenX: down.screenX + 20, screenY: down.screenY - 8, buttons: 1 });
  assert.equal(page.brain.view.mode, 'drag');
  assert.equal(page.brain.view.x, beforeX + 20);
  input('mouseup', { screenX: down.screenX + 20, screenY: down.screenY - 8, buttons: 0 }, window);
  assert.deepEqual([page.brain.view.mode, page.brain.view.anim], ['idle', 'idle']);
  assert.equal(release.mock.callCount(), 1);
  assert.equal(click.mock.callCount(), 0);
});

test('捕获失败时 window pointermove 仍能驱动拖动，异指针事件不影响当前会话', async (t) => {
  const petWindow = await readyPetWindow({ captureFails: true, settings: { gravity: false } });
  const { page, input, window } = petWindow;
  const release = t.mock.method(page.brain, 'release');
  const beforeX = page.brain.view.x;
  const down = input('pointerdown', { pointerId: 7 });
  input('pointermove', { pointerId: 99, screenX: down.screenX + 200, buttons: 1 }, window);
  assert.equal(page.brain.view.mode, 'idle');
  input('pointermove', { pointerId: 7, screenX: down.screenX + 25, buttons: 1 }, window);
  assert.equal(page.brain.view.mode, 'drag');
  assert.equal(page.brain.view.x, beforeX + 25);
  input('mouseup', { screenX: down.screenX + 25, buttons: 0 }, window);
  input('pointerup', { pointerId: 7, buttons: 0 }, window);
  assert.deepEqual([page.brain.view.mode, page.brain.view.anim], ['idle', 'idle']);
  assert.equal(release.mock.callCount(), 1);
});

test('画布收不到任何移动事件时，主进程光标轮询仍能拖动并在松手后停止', async (t) => {
  const { page, host, calls, input, window } = await readyPetWindow({ settings: { gravity: false } });
  const release = t.mock.method(page.brain, 'release');
  const beforeX = page.brain.view.x;
  const down = input('pointerdown');
  assert.equal(calls.dragStarts, 1);
  host.send({ type: 'drag-cursor', x: down.screenX + 26, y: down.screenY - 12 });
  assert.equal(page.brain.view.mode, 'drag');
  assert.equal(page.brain.view.x, beforeX + 26);
  input('mouseup', { screenX: down.screenX + 26, screenY: down.screenY - 12, buttons: 0 }, window);
  assert.deepEqual([page.brain.view.mode, page.brain.view.anim], ['idle', 'idle']);
  assert.equal(release.mock.callCount(), 1);
  assert.equal(calls.dragStops, 1);
});

test('漏收 mouseup 后，下一次点击会替换旧手势并只推进一次动作', async (t) => {
  const { page, input } = await readyPetWindow({ settings: { gravity: false } });
  const release = t.mock.method(page.brain, 'release');
  const down = input('pointerdown', { pointerId: 2 });
  input('mousemove', { screenX: down.screenX + 20, buttons: 1 });
  assert.equal(page.brain.view.mode, 'drag');
  const next = input('pointerdown', { pointerId: 3 });
  assert.equal(release.mock.callCount(), 1, 'starting a new press must close the stale drag');
  input('pointerup', { ...next, pointerId: 3, buttons: 0 });
  input('mouseup', { ...next, buttons: 0 });
  assert.equal(page.brain.view.anim, 'wave');
});

test('静止指针按延迟生效的实际窗口原点重命中，无新帧或新 bounds 也能更新穿透', async () => {
  const petWindow = await readyPetWindow({ applyBoundsImmediately: false, settings: { gravity: false } });
  const { page, host, calls, applyBounds, move } = petWindow;
  const original = { ...calls.bounds.at(-1) };
  applyBounds(original);
  page.tick();
  move(15, 15);
  assert.equal(page.ignoring, false);
  host.send({ type: 'play', name: 'walk' });
  runFor(petWindow, 600);
  host.send({ type: 'play', name: 'idle' });
  page.tick();
  const requested = { ...calls.bounds.at(-1) };
  assert.ok(requested.x > original.x + 20, 'fixture must request enough movement to leave the stationary cursor');
  assert.equal(page.ignoring, false, 'requested bounds must not substitute for the native window origin');
  const requestCount = calls.bounds.length;
  page.tick();
  // No time, animation, cursor event or requested bounds changes while native movement catches up.
  applyBounds(requested);
  page.tick();
  assert.equal(calls.bounds.length, requestCount);
  assert.equal(page.ignoring, true);
  applyBounds(original);
  page.tick();
  assert.equal(calls.bounds.length, requestCount);
  assert.equal(page.ignoring, false, 'moving the actual window back must restore the hit without another cursor event');
});
