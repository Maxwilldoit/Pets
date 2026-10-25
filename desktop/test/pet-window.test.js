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

function makeHost() {
  let command;
  const calls = { commands: [], ignores: [], bounds: [] };
  const host = {
    init: async () => ({
      record: {
        pet: {
          name: 'Test Pet', animations: { idle: { repeat: 1, weight: 0, mirror: true, moveX: 0 } },
          behavior: {}, scale: 1, speed: 50, pixelated: true,
        },
        assetBase: 'pets://app/assets/user/test/',
      },
      settings: initialSettings,
      locale: 'en',
      areas: [{ x: 0, y: 0, width: 1000, height: 700 }],
      position: { x: 500, y: 700 },
      debug: true,
    }),
    onCommand(callback) { command = callback; },
    send(message) { calls.commands.push({ type: message.type, delivered: !!command }); command?.(message); },
    setBounds(bounds) { calls.bounds.push(bounds); },
    setIgnoreMouse(ignore) { calls.ignores.push(ignore); },
    savePosition() {}, ready() {}, log() {}, showMenu() {},
  };
  return { host, calls };
}

async function startPetWindow() {
  const { host, calls } = makeHost();
  let resolveLoading;
  const loading = new Promise((resolve) => { resolveLoading = resolve; });
  let now = 1;
  let opaque = true;
  const listeners = new Map();
  const canvas = {
    style: {}, width: 40, height: 100,
    addEventListener(type, callback) { listeners.set(type, callback); },
    setPointerCapture() {},
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
    documentElement: {}, title: '',
    getElementById: () => canvas,
    addEventListener() {},
  };
  const window = {
    petHost: host, devicePixelRatio: 1,
    addEventListener(type, callback) { listeners.set(type, callback); },
  };
  const frame = (delay, visible) => ({ duration: delay, w: 40, h: 100, x: 0, y: 0, img: { opaque: visible } });
  const idle = {
    def: {}, box: { w: 40, h: 100 }, totalMs: 20,
    frames: [frame(10, true), frame(10, false)],
    groundY: () => 100,
    indexAt: (time) => time < 10 ? 0 : 1,
    source: (index) => ({ image: idle.frames[index].img, sx: 0, sy: 0, exact: true }),
  };
  const source = fs.readFileSync(path.resolve(import.meta.dirname, '../src/renderer/pet/pet.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '');
  const running = new vm.Script(`(async () => { ${source}\n return { brain, get settings() { return settings; }, get layout() { return layout; }, get ignoring() { return ignoring; }, hit, tick }; })()`)
    .runInNewContext({
      window, document, console, PetBrain, createTranslator, resolveLanguage,
      computeLayout, drawFrame, frameIndex, loadPetAnimations: () => loading,
      performance: { now: () => now }, setInterval() {}, navigator: { language: 'en' },
    });
  await Promise.resolve();
  await Promise.resolve();
  return {
    host, calls, running,
    finishLoading: () => resolveLoading({ idle }),
    advance: (milliseconds) => { now += milliseconds; },
    move: (x, y) => listeners.get('mousemove')({ clientX: x, clientY: y }),
  };
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
  const petWindow = await startPetWindow();
  petWindow.finishLoading();
  const page = await petWindow.running;
  petWindow.move(15, 15);
  assert.equal(page.ignoring, false);
  petWindow.advance(600);
  page.tick();
  assert.equal(page.hit(15, 15), false);
  assert.equal(page.ignoring, true);
});
