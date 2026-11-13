// 控制面板的纯逻辑：来源筛选是否显示、主按钮状态、hover/登场/离场的动作选择、
// 预览缩放与舞台的时段。不依赖 DOM / Electron，Node 里可直接单测。

export const SOURCE_ORDER = ['bundled', 'user', 'codex'];

// 这些动画由状态机驱动，不算「表演动作」
const LOCOMOTION = new Set(['idle', 'walk', 'walk-left', 'walk-right', 'drag', 'drag-left', 'drag-right', 'fall']);

/** 统计各来源的有效宠物数；两个以上来源有宠物时才显示来源筛选。 */
export function sourceFilters(records) {
  const counts = {};
  for (const r of records) if (r.pet) counts[r.source] = (counts[r.source] ?? 0) + 1;
  const present = SOURCE_ORDER.filter((id) => counts[id]);
  return { counts, present, visible: present.length >= 2 };
}

/** 唯一主按钮的状态：不在桌面 → 放到桌面；就在桌面 → 收回来；过渡中禁用。 */
export function mainButtonState({ selectedKey, activeKey, visible, busy = false }) {
  const live = !!selectedKey && !!visible && activeKey === selectedKey;
  const action = live ? 'recall' : 'activate';
  return { action, live, disabled: busy || !selectedKey };
}

/** hover 格子时播的动作：挥手优先，没有就用第一个非待机的表演动作，再没有就待机。 */
export function waveAnimation(pet) {
  for (const name of ['wave', 'waving']) if (pet.animations[name]) return name;
  return Object.keys(pet.animations).find((name) => name !== 'idle' && !LOCOMOTION.has(name)) ?? 'idle';
}

/** 登场动作：跳跃类优先；没有返回 null，由调用方用待机加一个小弹跳兜底。 */
export function entranceAnimation(pet) {
  return ['jumping', 'jump', 'jump-happy', 'dunk'].find((name) => pet.animations[name]) ?? null;
}

/** 走出舞台用的行走动作；没有返回 null。 */
export function walkOutAnimation(pet) {
  return ['walk-right', 'walk'].find((name) => pet.animations[name]) ?? null;
}

/** 单击舞台宠物时的动作循环，和 brain.js 的 buildActionCycle 保持一致。 */
export function clickCycle(pet) {
  const out = [];
  const add = (name) => {
    if (!name || LOCOMOTION.has(name) || !pet.animations[name] || out.includes(name)) return;
    out.push(name);
  };
  add(pet.behavior?.click);
  add(pet.behavior?.doubleClick);
  for (const [name, a] of Object.entries(pet.animations)) if (a.label) add(name);
  return out;
}

/**
 * 预览缩放：按不透明区域适配格子/舞台。像素图只允许整数倍放大（或整数分之一缩小）
 * 保持清晰，并封顶 3 倍，避免小像素图被放大成一大块色块。
 */
export function previewScale({ bw, bh, boxW, boxH, fill = 0.8, pixelated = false }) {
  const fit = Math.min((boxW * 0.86) / Math.max(1, bw), (boxH * fill) / Math.max(1, bh));
  if (!pixelated) return Math.min(fit, 1.5);
  if (fit >= 1) return Math.min(Math.floor(fit), 3);
  return 1 / Math.ceil(1 / fit);
}

/** 舞台背景随本地时间变化：早上偏暖、白天明亮、傍晚柔和、晚上偏暗偏蓝。 */
export function dayPhase(hour) {
  if (hour >= 5 && hour < 10) return 'morning';
  if (hour >= 10 && hour < 17) return 'day';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}
