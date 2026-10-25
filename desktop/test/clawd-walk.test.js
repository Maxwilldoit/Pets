import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PetBrain, TUNING } from '../src/shared/brain.js';
import { loadPet } from '../src/main/registry.js';
import { planCodexExport, sampleFrames } from '../src/shared/codex.js';
import { localizePet } from '../src/shared/pet-locales.js';

const MANIFEST_URL = new URL('../../pets/clawd/pet.json', import.meta.url);
const AREA = { x: 0, y: 0, width: 1000, height: 700 };
const BODY = { left: 32, right: 32, top: 96 };
const DIRECTIONS = [
  { name: 'walk-right', dir: 1, label: '向右行走', english: 'Walk right', state: 'running-right' },
  { name: 'walk-left', dir: -1, label: '向左行走', english: 'Walk left', state: 'running-left' },
];

function loadClawd() {
  const raw = JSON.parse(readFileSync(MANIFEST_URL, 'utf8'));
  const { pet, errors, warnings } = loadPet('bundled', fileURLToPath(new URL('../../pets/clawd/', import.meta.url)));
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  return { raw, pet };
}

function makeBrain(pet, overrides = {}) {
  const anims = Object.fromEntries(Object.entries(pet.animations).map(([name, animation]) => [
    name,
    {
      ...animation,
      // PNG 帧使用清单中的真实时长；旧 GIF 仅需占位时长，无需解码素材。
      durationMs: animation.frames?.reduce((sum, frame) => sum + frame.duration, 0) ?? 1000,
      moveX: (animation.moveX ?? 0) * pet.scale,
    },
  ]));
  return new PetBrain({
    anims,
    behavior: pet.behavior,
    speed: pet.speed * pet.scale,
    body: BODY,
    areas: [AREA],
    position: { x: 500, y: 700 },
    random: () => 0.5,
    ...overrides,
  });
}

test('Clawd 1.1.0 的左右行走各有八张有序 PNG，8 fps，共用脚底锚点且权重为零', () => {
  const { raw, pet } = loadClawd();
  assert.equal(pet.version, '1.1.0');
  assert.match(pet.description, /左右行走/);
  assert.deepEqual(raw.animations.walk, { src: 'gifs/clawd-crabwalk.gif', mirror: false });
  assert.deepEqual(pet.behavior, { click: 'jump-happy', doubleClick: 'dance' });

  for (const { name, label } of DIRECTIONS) {
    const paths = Array.from({ length: 8 }, (_, index) => `frames/${name}/${String(index).padStart(2, '0')}.png`);
    assert.deepEqual(raw.animations[name].frames, paths);
    assert.equal(raw.animations[name].fps, 8);
    const animation = pet.animations[name];
    assert.equal(animation.kind, 'frames');
    assert.deepEqual(animation.frames, paths.map((src) => ({ src, duration: 125, offset: [0, 0] })));
    assert.deepEqual(animation.anchor, [128, 192]);
    assert.equal(animation.label, label);
    assert.equal(animation.weight, 0);
  }
});

for (const { name, dir, label } of DIRECTIONS) {
  test(`Clawd ${label}时使用 ${name}，位置随时间移动且不镜像`, () => {
    const { pet } = loadClawd();
    const brain = makeBrain(pet);
    assert.equal(brain.play(name), true);
    assert.deepEqual([brain.view.mode, brain.view.anim, brain.view.flip], ['walk', name, false]);
    const view = brain.update(0.1);
    assert.equal(view.x, 500 + dir * pet.speed * pet.scale * 0.1);
    assert.equal(view.y, 700);
    assert.deepEqual([view.anim, view.flip], [name, false]);
  });

  test(`Clawd ${label}到屏幕边缘后切换另一方向的帧并掉头，不镜像`, () => {
    const { pet } = loadClawd();
    const edge = dir > 0 ? AREA.width - BODY.right : BODY.left;
    const brain = makeBrain(pet, { position: { x: edge - dir, y: 700 } });
    const opposite = dir > 0 ? 'walk-left' : 'walk-right';
    assert.equal(brain.play(name), true);
    const view = brain.update(0.1);
    assert.equal(view.x, edge);
    assert.deepEqual([view.mode, view.anim, view.flip], ['walk', opposite, false]);
    assert.equal(brain.update(0.1).x, edge - dir * pet.speed * pet.scale * 0.1);
  });

  test(`Clawd 向${dir > 0 ? '右' : '左'}拖动时使用 ${name}，停住后恢复待机`, () => {
    const { pet } = loadClawd();
    const brain = makeBrain(pet);
    brain.grab(500, 650);
    assert.deepEqual([brain.view.mode, brain.view.anim, brain.view.flip], ['drag', 'idle', false]);
    for (let step = 1; step <= 6; step++) {
      brain.update(0.05);
      brain.dragTo(500 + dir * step * 8, 650 - step * 2);
      assert.deepEqual([brain.view.mode, brain.view.anim, brain.view.flip], ['drag', name, false]);
      assert.equal(brain.view.x, 500 + dir * step * 8);
      assert.equal(brain.view.y, 700 - step * 2);
    }
    for (let elapsed = 0; elapsed <= TUNING.dragStill; elapsed += 0.1) brain.update(0.1);
    assert.deepEqual([brain.view.mode, brain.view.anim, brain.view.flip], ['drag', 'idle', false]);
  });
}

test('Clawd 保留原 walk 兜底：缺少方向动画时，两边仍使用原 GIF 且不镜像', () => {
  const { pet } = loadClawd();
  const fallback = structuredClone(pet);
  for (const { name } of DIRECTIONS) delete fallback.animations[name];
  const brain = makeBrain(fallback);
  for (const { name, dir } of DIRECTIONS) {
    const startX = brain.view.x;
    assert.equal(brain.play(name), true);
    assert.deepEqual([brain.view.anim, brain.view.flip], ['walk', false]);
    assert.equal(brain.update(0.1).x, startX + dir * pet.speed * pet.scale * 0.1);
  }
});

test('Clawd 单击完整循环保留原有动作，跳过左右行走', () => {
  const { pet } = loadClawd();
  const brain = makeBrain(pet);
  const expected = [
    'jump-happy', 'dance', 'sleep', 'think', 'type', 'type-keyboard', 'listening',
    'wave', 'wink', 'cheer', 'point', 'sweep', 'carry', 'build', 'error',
  ];
  assert.deepEqual(brain.actionCycle, expected);
  for (let cycle = 0; cycle < 2; cycle++) {
    for (const name of expected) {
      brain.click();
      assert.equal(brain.view.anim, name);
      assert.equal(brain.view.mode, name === 'sleep' ? 'sleep' : 'action');
    }
  }
});

test('Clawd 随机动作候选及实际随机决策均不会选择左右行走', () => {
  const { pet } = loadClawd();
  const brain = makeBrain(pet, { settings: { wander: false, randomActions: true } });
  const candidates = brain.actionCandidates().map(([name]) => name);
  assert.ok(candidates.includes('wave'));
  assert.ok(candidates.includes('error'));
  for (const name of ['walk', 'walk-left', 'walk-right']) assert.ok(!candidates.includes(name), name);

  const modes = new Set();
  for (let sample = 0; sample < 64; sample++) {
    brain.random = () => (sample + 0.5) / 64;
    brain.toIdle();
    brain.decideNext();
    modes.add(brain.view.mode);
    assert.ok(!['walk', 'walk-left', 'walk-right'].includes(brain.view.anim), brain.view.anim);
  }
  assert.deepEqual(modes, new Set(['idle', 'action', 'sleep']));
});

test('Clawd Codex 导出显式映射左右行走，按顺序使用八帧且不镜像，保留 listening 等状态', () => {
  const { pet } = loadClawd();
  assert.deepEqual(pet.codex, {
    waiting: 'listening',
    'running-right': 'walk-right',
    'running-left': 'walk-left',
  });
  const plan = planCodexExport(pet);
  assert.deepEqual(Object.fromEntries(plan.map(({ state, anim }) => [state, anim])), {
    idle: 'idle',
    'running-right': 'walk-right',
    'running-left': 'walk-left',
    waving: 'wave',
    jumping: 'jump-happy',
    failed: 'error',
    waiting: 'listening',
    running: 'type-keyboard',
    review: 'point',
  });
  for (const { name, state } of DIRECTIONS) {
    const row = plan.find((entry) => entry.state === state);
    assert.deepEqual([row.anim, row.flip, row.guessed, row.count], [name, false, false, 8]);
    const durations = pet.animations[name].frames.map((frame) => frame.duration);
    assert.deepEqual(sampleFrames(durations, row.count, row.durations, { cycle: true }), [0, 1, 2, 3, 4, 5, 6, 7]);
  }
  assert.equal(plan.find(({ state }) => state === 'waiting').guessed, false);
});

test('Clawd 原始及规范化清单的英文简介和左右行走标签完整，动作和导出映射不变', () => {
  const { raw, pet } = loadClawd();
  for (const original of [raw, pet]) {
    const before = structuredClone(original);
    const english = localizePet(original, 'en');
    assert.match(english.description, /left and right walking/);
    for (const { name, english: label } of DIRECTIONS) {
      assert.equal(english.animations[name].label, label);
      assert.equal(english.animations[name].frames, original.animations[name].frames);
      assert.equal(english.animations[name].anchor, original.animations[name].anchor);
      assert.equal(english.animations[name].weight, 0);
    }
    assert.deepEqual(planCodexExport(english), planCodexExport(original));
    assert.deepEqual(original, before);
  }
});
