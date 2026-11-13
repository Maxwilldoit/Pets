import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clickCycle,
  dayPhase,
  entranceAnimation,
  mainButtonState,
  previewScale,
  sourceFilters,
  walkOutAnimation,
  waveAnimation,
} from '../src/renderer/lib/panel-model.js';

const rec = (source, ok = true) => ({ source, pet: ok ? {} : null });

test('只有一个来源有宠物时不显示来源筛选', () => {
  assert.equal(sourceFilters([]).visible, false);
  assert.equal(sourceFilters([rec('bundled'), rec('bundled'), rec('user', false)]).visible, false);
  const f = sourceFilters([rec('bundled'), rec('user'), rec('codex', false)]);
  assert.equal(f.visible, true);
  assert.deepEqual(f.present, ['bundled', 'user']);
  assert.deepEqual(f.counts, { bundled: 1, user: 1 });
});

test('来源筛选按固定顺序统计，无效宠物不计入', () => {
  const f = sourceFilters([rec('codex'), rec('user'), rec('bundled'), rec('bundled'), rec('user', false)]);
  assert.deepEqual(f.present, ['bundled', 'user', 'codex']);
  assert.equal(f.counts.bundled, 2);
  assert.equal(f.counts.user, 1);
  assert.equal(f.counts.codex, 1);
});

test('主按钮：选中且在桌面 → 收回来；否则 → 放到桌面', () => {
  assert.deepEqual(mainButtonState({ selectedKey: 'bundled/a', activeKey: 'bundled/a', visible: true }), { action: 'recall', live: true, disabled: false });
  assert.deepEqual(mainButtonState({ selectedKey: 'bundled/b', activeKey: 'bundled/a', visible: true }), { action: 'activate', live: false, disabled: false });
  assert.deepEqual(mainButtonState({ selectedKey: 'bundled/a', activeKey: 'bundled/a', visible: false }), { action: 'activate', live: false, disabled: false });
});

test('主按钮：过渡中禁用，未选中禁用', () => {
  assert.equal(mainButtonState({ selectedKey: 'bundled/a', activeKey: null, visible: false, busy: true }).disabled, true);
  assert.equal(mainButtonState({ selectedKey: null, activeKey: null, visible: false }).disabled, true);
  assert.equal(mainButtonState({ selectedKey: 'bundled/a', activeKey: 'bundled/a', visible: true, busy: true }).action, 'recall');
});

const pet = (animations, behavior = {}) => ({ animations, behavior });

test('hover 动作：挥手优先，其次第一个非待机表演动作，最后待机', () => {
  assert.equal(waveAnimation(pet({ idle: {}, wave: {}, waving: {} })), 'wave');
  assert.equal(waveAnimation(pet({ idle: {}, waving: {} })), 'waving');
  assert.equal(waveAnimation(pet({ idle: {}, drag: {}, sway: {}, attack: {} })), 'sway');
  assert.equal(waveAnimation(pet({ idle: {}, walk: {} })), 'idle');
  assert.equal(waveAnimation(pet({ idle: {} })), 'idle');
});

test('登场动作取跳跃类，没有则 null', () => {
  assert.equal(entranceAnimation(pet({ idle: {}, jumping: {} })), 'jumping');
  assert.equal(entranceAnimation(pet({ idle: {}, jump: {} })), 'jump');
  assert.equal(entranceAnimation(pet({ idle: {}, 'jump-happy': {} })), 'jump-happy');
  assert.equal(entranceAnimation(pet({ idle: {}, sway: {} })), null);
});

test('走出舞台优先向右走，没有就用通用行走', () => {
  assert.equal(walkOutAnimation(pet({ idle: {}, 'walk-right': {}, walk: {} })), 'walk-right');
  assert.equal(walkOutAnimation(pet({ idle: {}, walk: {} })), 'walk');
  assert.equal(walkOutAnimation(pet({ idle: {} })), null);
});

test('单击循环与 brain 一致：behavior 优先，再补带 label 的动作', () => {
  const p = pet(
    { idle: {}, walk: {}, wave: { label: '挥手' }, jump: { label: '跳跃' }, think: { label: '思考' } },
    { click: 'jump', doubleClick: 'wave' },
  );
  assert.deepEqual(clickCycle(p), ['jump', 'wave', 'think']);
  assert.deepEqual(clickCycle(pet({ idle: {}, walk: {} })), []);
});

test('像素图整数倍放大并封顶，避免放大成色块', () => {
  // 小像素螃蟹：适配值约 4.3 倍 → 封顶 3 倍
  assert.equal(previewScale({ bw: 44, bh: 29, boxW: 300, boxH: 240, fill: 0.72, pixelated: true }), 3);
  // 适配值 2.5 → 向下取整 2
  assert.equal(previewScale({ bw: 44, bh: 29, boxW: 130, boxH: 120, pixelated: true }), 2);
  // 适配值 3.9 → 3（封顶内的整数）
  assert.equal(previewScale({ bw: 40, bh: 40, boxW: 180, boxH: 180, pixelated: true }), 3);
  // 大图需要缩小：用整数分之一（适配 0.24 → 1/5）
  assert.equal(previewScale({ bw: 400, bh: 400, boxW: 130, boxH: 120, pixelated: true }), 0.2);
  // 非像素图保持原来的上限
  assert.equal(previewScale({ bw: 40, bh: 40, boxW: 400, boxH: 400 }), 1.5);
  assert.ok(previewScale({ bw: 120, bh: 340, boxW: 130, boxH: 120 }) < 0.4);
});

test('时段划分覆盖一天且边界正确', () => {
  assert.equal(dayPhase(5), 'morning');
  assert.equal(dayPhase(9), 'morning');
  assert.equal(dayPhase(10), 'day');
  assert.equal(dayPhase(16), 'day');
  assert.equal(dayPhase(17), 'evening');
  assert.equal(dayPhase(20), 'evening');
  assert.equal(dayPhase(21), 'night');
  assert.equal(dayPhase(0), 'night');
  assert.equal(dayPhase(4), 'night');
});
