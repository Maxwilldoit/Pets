// 设置持久化：userData/settings.json
import fs from 'node:fs';
import path from 'node:path';

export const LANGUAGE_PREFERENCES = ['auto', 'zh-CN', 'en'];

export const DEFAULT_SETTINGS = {
  language: 'auto',
  activePet: null, // 当前桌宠的 key，如 "bundled/my-cat"
  petVisible: true,
  size: 1, // 在宠物自身 scale 之上的整体缩放
  wander: false, // 自由走动（默认关：无交互时保持待机）
  randomActions: false, // 空闲时随机做动作（默认关：无交互时保持待机）
  gravity: true, // 松手后落到任务栏上
  alwaysOnTop: true,
  launchAtLogin: false,
  position: null, // 上次的脚底位置 {x, y}
};

const isRecord = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

function sanitize(source, fallback) {
  const data = { ...fallback };
  if (!isRecord(source)) return data;

  if (LANGUAGE_PREFERENCES.includes(source.language)) data.language = source.language;
  if (source.activePet === null || typeof source.activePet === 'string') data.activePet = source.activePet;
  for (const key of ['petVisible', 'wander', 'randomActions', 'gravity', 'alwaysOnTop', 'launchAtLogin']) {
    if (typeof source[key] === 'boolean') data[key] = source[key];
  }
  if (isNumber(source.size) && source.size >= 0.25 && source.size <= 3) data.size = source.size;
  if (source.position === null) data.position = null;
  else if (isRecord(source.position) && isNumber(source.position.x) && isNumber(source.position.y)) {
    data.position = { x: source.position.x, y: source.position.y };
  }
  return data;
}

export class Settings {
  constructor(file) {
    this.file = file;
    let saved = {};
    try {
      saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      // 首次启动或文件损坏：使用默认值
    }
    this.data = sanitize(saved, DEFAULT_SETTINGS);
  }

  set(patch) {
    const clean = isRecord(patch) ? patch : {};
    this.data = sanitize({ ...this.data, ...clean }, this.data);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
    return this.data;
  }
}
