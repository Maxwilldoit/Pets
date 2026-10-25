import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PetBrain, TUNING } from '../src/shared/brain.js';
import { loadPet } from '../src/main/registry.js';
import { planCodexExport, sampleFrames } from '../src/shared/codex.js';
import { localizePet } from '../src/shared/pet-locales.js';

const MANIFEST_URL = new URL('../../pets/clawd-xmas/pet.json', import.meta.url);
const AREA = { x: 0, y: 0, width: 1000, height: 700 };
const BODY = { left: 32, right: 32, top: 96 };
const DIRECTIONS = [
  { name: 'walk-left', dir: -1, label: '向左行走', state: 'running-left' },
  { name: 'walk-right', dir: 1, label: '向右行走', state: 'running-right' },
];

function loadClawdXmas() {
  const raw = JSON.parse(readFileSync(MANIFEST_URL, 'utf8'));
  const { pet, errors, warnings } = loadPet('bundled', fileURLToPath(new URL('../../pets/clawd-xmas/', import.meta.url)));
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  return { raw, pet };
}

function makeBrain(pet, overrides = {}) {
  return new PetBrain({
    anims: Object.fromEntries(Object.entries(pet.animations).map(([name, animation]) => [name, {
      ...animation,
      // 行走帧使用真实时长；旧 GIF 只需占位时长，无需解码素材。
      durationMs: animation.frames?.reduce((sum, frame) => sum + frame.duration, 0) ?? 1000,
      moveX: (animation.moveX ?? 0) * pet.scale,
    }])),
    behavior: pet.behavior,
    speed: pet.speed * pet.scale,
    body: BODY,
    areas: [AREA],
    position: { x: 500, y: 700 },
    random: () => 0.5,
    ...overrides,
  });
}

test('圣诞版 1.1.0 保留六项旧动画，新增两组八帧行走并更新中英文简介', () => {
  const { raw, pet } = loadClawdXmas();
  assert.equal(pet.version, '1.1.0');
  assert.equal(pet.speed, 45);
  assert.match(pet.description, /圣诞帽.*左右行走/);
  assert.match(localizePet(pet, 'en').description, /Santa hat.*left and right walking/);
  assert.deepEqual(pet.behavior, { click: 'jump-happy', doubleClick: 'dance' });
  const legacy = Object.fromEntries(Object.entries(raw.animations).filter(([name]) => !name.startsWith('walk-')));
  assert.deepEqual(legacy, {
    idle: { src: 'gifs/clawd-xmas-idle.gif' },
    sleep: { src: 'gifs/clawd-xmas-sleep.gif', label: '睡觉', weight: 0 },
    wave: { src: 'gifs/clawd-xmas-wave.gif', label: '挥手' },
    'jump-happy': { src: 'gifs/clawd-xmas-jump-happy.gif', label: '开心跳' },
    dance: { src: 'gifs/clawd-xmas-dance.gif', label: '跳舞', repeat: 3 },
    'type-keyboard': { src: 'gifs/clawd-xmas-type-keyboard.gif', label: '敲键盘', repeat: 3 },
  });
  assert.equal(Object.keys(raw.animations).length, 8);
  for (const { name, label } of DIRECTIONS) {
    const frames = Array.from({ length: 8 }, (_, i) => `frames/${name}/${String(i).padStart(2, '0')}.png`);
    assert.deepEqual(raw.animations[name], { frames, fps: 8, anchor: [128, 192], label, weight: 0 });
    assert.deepEqual(pet.animations[name].frames.map(({ src, duration }) => [src, duration]), frames.map((src) => [src, 125]));
  }
});

test('圣诞版左右行走按缩放后的速度移动，碰壁后换方向帧并继续走', () => {
  const { pet } = loadClawdXmas();
  const step = pet.speed * pet.scale * 0.1;
  for (const { name, dir } of DIRECTIONS) {
    const brain = makeBrain(pet);
    assert.equal(brain.play(name), true);
    const view = brain.update(0.1);
    assert.deepEqual([view.mode, view.anim, view.flip, view.x, view.y], ['walk', name, false, 500 + dir * step, 700]);

    const edge = dir < 0 ? BODY.left : AREA.width - BODY.right;
    const atWall = makeBrain(pet, { position: { x: edge - dir, y: 700 } });
    assert.equal(atWall.play(name), true);
    const turned = atWall.update(0.1);
    const opposite = dir < 0 ? 'walk-right' : 'walk-left';
    assert.deepEqual([turned.x, turned.mode, turned.anim, turned.flip], [edge, 'walk', opposite, false]);
    assert.equal(atWall.update(0.1).x, edge - dir * step);
  }
});

test('圣诞版左右拖动使用对应行走帧，停住后仍在拖动且恢复待机', () => {
  const { pet } = loadClawdXmas();
  for (const { name, dir } of DIRECTIONS) {
    const brain = makeBrain(pet);
    brain.grab(500, 650);
    assert.equal(brain.view.anim, 'idle');
    brain.update(0.05);
    brain.dragTo(500 + dir * 8, 646);
    const view = brain.view;
    assert.deepEqual([view.mode, view.anim, view.flip, view.x, view.y], ['drag', name, false, 500 + dir * 8, 696]);
    for (let elapsed = 0; elapsed <= TUNING.dragStill; elapsed += 0.1) brain.update(0.1);
    assert.deepEqual([brain.view.mode, brain.view.anim, brain.view.flip], ['drag', 'idle', false]);
  }
});

test('圣诞版单击循环和实际随机动作都跳过左右行走', () => {
  const { pet } = loadClawdXmas();
  const brain = makeBrain(pet, { settings: { wander: false, randomActions: true } });
  const cycle = ['jump-happy', 'dance', 'sleep', 'wave', 'type-keyboard'];
  assert.deepEqual(brain.actionCycle, cycle);
  for (let i = 0; i < cycle.length * 2; i++) {
    brain.click();
    assert.equal(brain.view.anim, cycle[i % cycle.length]);
  }
  const candidates = brain.actionCandidates().map(([name]) => name);
  for (const { name } of DIRECTIONS) assert.ok(!candidates.includes(name), name);
  const chosen = new Set();
  for (let sample = 0; sample < 64; sample++) {
    brain.random = () => (sample + 0.5) / 64;
    brain.toIdle();
    brain.decideNext();
    chosen.add(brain.view.anim);
  }
  assert.deepEqual(chosen, new Set(['idle', ...cycle]));
});

test('圣诞版 Codex 显式导出左右八帧且不镜像，review 保持 dance', () => {
  const { pet } = loadClawdXmas();
  const plan = planCodexExport(pet);
  for (const { name, state } of DIRECTIONS) {
    assert.equal(pet.codex[state], name);
    const row = plan.find((entry) => entry.state === state);
    assert.deepEqual([row.anim, row.flip, row.guessed, row.count], [name, false, false, 8]);
    assert.deepEqual(sampleFrames(pet.animations[name].frames.map(({ duration }) => duration), row.count, row.durations, { cycle: true }), [0, 1, 2, 3, 4, 5, 6, 7]);
  }
  assert.equal(pet.codex.review, 'dance');
  const review = plan.find(({ state }) => state === 'review');
  assert.deepEqual([review.anim, review.guessed], ['dance', false]);
});
