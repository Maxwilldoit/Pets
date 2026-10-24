import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { installCodexPet, isPetsExport, listExports } from '../src/main/codex-install.js';
import { loadPet } from '../src/main/registry.js';
import { DEFAULT_SETTINGS, LANGUAGE_PREFERENCES, Settings } from '../src/main/settings.js';
import { createTranslator, localizeDiagnostic, resolveLanguage } from '../src/shared/i18n.js';
import { normalizeManifest } from '../src/shared/manifest.js';
import { localizePet } from '../src/shared/pet-locales.js';

function temporaryDirectory(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pets-settings-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('新设置和旧版设置使用 auto，不影响已有桌宠设置', (t) => {
  const file = path.join(temporaryDirectory(t), 'settings.json');
  assert.equal(new Settings(file).data.language, 'auto');
  fs.writeFileSync(file, JSON.stringify({ activePet: 'bundled/clawd', size: 1.5, position: { x: 10, y: 20 } }));
  const settings = new Settings(file);
  assert.equal(settings.data.language, 'auto');
  assert.equal(settings.data.activePet, 'bundled/clawd');
  assert.equal(settings.data.size, 1.5);
  assert.deepEqual(settings.data.position, { x: 10, y: 20 });
  fs.writeFileSync(file, '{ broken');
  assert.deepEqual(new Settings(file).data, DEFAULT_SETTINGS);
});

test('语言偏好可以保存及重新加载，只接受三个约定值', (t) => {
  const file = path.join(temporaryDirectory(t), 'nested', 'settings.json');
  const settings = new Settings(file);
  for (const language of LANGUAGE_PREFERENCES) {
    settings.set({ language });
    assert.equal(new Settings(file).data.language, language);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).language, language);
  }
  settings.set({ language: 'en' });
  for (const language of ['zh', 'en-US', 'EN', '', null, false, 0, [], {}, undefined]) {
    const patch = { language, size: 1.25 };
    settings.set(patch);
    assert.equal(settings.data.language, 'en');
    assert.equal(settings.data.size, 1.25);
    assert.equal(patch.language, language);
    fs.writeFileSync(file, JSON.stringify({ language, size: 2 }));
    assert.equal(new Settings(file).data.language, 'auto');
    assert.equal(new Settings(file).data.size, 2);
  }
  assert.ok(!fs.existsSync(`${file}.tmp`));
});

const MAIN_DIR = path.resolve(import.meta.dirname, '../src/main');
// 在 Node 中执行实际主进程入口，注入 Electron 替身，不启动或重启应用。
const mainScript = new vm.Script(fs.readFileSync(path.join(MAIN_DIR, 'index.js'), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replaceAll('import.meta.dirname', 'mainDir'), { filename: 'main/index.js' });

function mainHarness(t, { systemLocale = 'zh-CN', saved = {}, active = false } = {}) {
  const root = temporaryDirectory(t);
  const userData = path.join(root, 'userData');
  const codexDir = path.join(root, 'codex');
  fs.mkdirSync(userData);
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ ...saved, ...(active ? { activePet: 'bundled/clawd' } : {}) }));
  const pet = normalizeManifest({
    id: 'clawd', name: '小克', description: '自定义描述', tags: ['像素', '螃蟹'],
    animations: { idle: { src: 'idle.gif' }, wave: { src: 'wave.gif', label: '挥手' } },
  }).pet;
  const codexPet = normalizeManifest({ id: 'custom', displayName: '自定义名称', description: '用户描述', spritesheetPath: 'spritesheet.webp' }).pet;
  const record = (source, value) => ({ key: `${source}/${value.id}`, source, dirName: value.id, dir: path.join(root, source, value.id), pet: value, errors: [], warnings: [] });
  const fixtures = [record('bundled', pet), record('user', structuredClone(pet)), record('codex', codexPet), {
    key: 'user/broken', source: 'user', dirName: 'broken', dir: path.join(root, 'broken'), pet: null,
    errors: ['name 必填，且不能为空'], warnings: ['animations.idle.extra 是未知字段，已忽略'],
  }];
  const windows = [];
  const trays = [];
  const menus = [];
  const handlers = new Map();
  const ipcMain = Object.assign(new EventEmitter(), { handle: (name, callback) => handlers.set(name, callback) });
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = structuredClone(options);
      this.title = options.title;
      this.messages = [];
      this.bounds = { x: 300, y: 500, width: 100, height: 200 };
      this.webContents = Object.assign(new EventEmitter(), {
        send: (channel, ...args) => this.messages.push({ channel, args: structuredClone(args) }),
        setWindowOpenHandler() {}, isLoading: () => false,
      });
      this.loadCount = 0;
      this.destroyed = false;
      windows.push(this);
    }
    setTitle(title) { this.title = title; }
    loadURL(url) { this.url = url; this.loadCount++; }
    setBounds(bounds) { this.bounds = structuredClone(bounds); }
    setAlwaysOnTop(value) { this.alwaysOnTop = value; }
    destroy() { this.destroyed = true; this.emit('closed'); }
    isDestroyed() { return this.destroyed; }
    isMinimized() { return false; }
    removeMenu() {}
    setIgnoreMouseEvents() {}
    setTitleBarOverlay() {}
    show() {}
    showInactive() {}
    focus() {}
  }
  class FakeTray extends EventEmitter {
    constructor() { super(); trays.push(this); }
    setToolTip(value) { this.tooltip = value; }
    setContextMenu(menu) { this.menu = menu; }
  }
  const dialog = {
    result: { canceled: true, filePaths: [] },
    async showOpenDialog(_window, options) { this.options = options; return this.result; },
  };
  const app = Object.assign(new EventEmitter(), {
    isPackaged: false, getLocale: () => systemLocale, getPath: () => userData, getVersion: () => 'test',
    requestSingleInstanceLock: () => true, whenReady: () => ({ then: (start) => start() }),
    setAppUserModelId() {}, disableHardwareAcceleration() {}, setLoginItemSettings() {},
  });
  mainScript.runInNewContext({
    mainDir: MAIN_DIR, fs, path, app, BrowserWindow: FakeWindow, Tray: FakeTray, ipcMain, dialog,
    Menu: { buildFromTemplate: (items) => ({ items, popup: () => menus.push(items) }) },
    nativeImage: { createFromPath: () => ({}) }, nativeTheme: Object.assign(new EventEmitter(), { shouldUseDarkColors: false }),
    screen: Object.assign(new EventEmitter(), { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }], getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) }),
    shell: {}, process: { argv: [], env: {}, platform: 'win32' }, console: { error() {} },
    codexPetsDir: () => codexDir, installCodexPet: (options) => installCodexPet({ ...options, petsDir: codexDir }),
    isPetsExport, listExports: () => listExports(codexDir),
    ORIGIN: 'pets://app', assetBase: (r) => `pets://app/assets/${r.key}/`, handleProtocol() {}, registerScheme() {},
    loadPet, scanAll: () => fixtures, Settings, LANGUAGE_PREFERENCES, createTranslator, resolveLanguage, localizeDiagnostic, localizePet,
  });
  return {
    root, userData, codexDir, fixtures, windows, tray: trays[0], menus, ipcMain, dialog,
    invoke: (name, ...args) => handlers.get(name)({}, ...args),
    invokePet: (name, petWindow) => handlers.get(name)({ sender: petWindow.webContents }),
    get panel() { return windows.find((win) => win.url?.includes('/panel/')); },
    get petWindow() { return windows.findLast((win) => win.url?.includes('/pet/')); },
  };
}

test('主进程区分偏好与实际语言，启动时解析系统区域', (t) => {
  for (const [systemLocale, language, expected] of [
    ['zh-Hant-TW', 'auto', 'zh-CN'], ['en-US', 'auto', 'en'], ['zh-CN', 'en', 'en'], ['en-US', 'zh-CN', 'zh-CN'], ['zh-CN', 'fr', 'zh-CN'],
  ]) {
    const h = mainHarness(t, { systemLocale, saved: { language } });
    const state = h.invoke('app:state');
    assert.equal(state.locale, expected);
    assert.equal(state.settings.language, language === 'fr' ? 'auto' : language);
    assert.equal(h.panel.options.title, createTranslator(expected)('app.title'));
  }
});

test('语言切换先推送 app:state 再发 language 事件，保留窗口、位置及缩放', (t) => {
  const h = mainHarness(t, { active: true, saved: { size: 1.25, position: { x: 300, y: 700 } } });
  const petWindow = h.petWindow;
  h.tray.emit('click');
  const initialBounds = structuredClone(petWindow.bounds);
  const initialSettings = structuredClone(h.invoke('app:state').settings);
  for (const [language, name] of [['en', 'Clawd'], ['zh-CN', '小克'], ['auto', '小克']]) {
    h.panel.messages.length = 0;
    const updated = h.invoke('settings:set', { language });
    assert.deepEqual(h.panel.messages.map((message) => message.channel), ['app:state', 'pets:changed']);
    assert.equal(h.panel.messages[0].args[0].locale, language === 'en' ? 'en' : 'zh-CN');
    assert.deepEqual(h.panel.messages[1].args, [{ reason: 'language' }]);
    assert.equal(updated.activePet, initialSettings.activePet);
    assert.equal(updated.size, initialSettings.size);
    assert.deepEqual(updated.position, initialSettings.position);
    assert.equal(h.windows.length, 2);
    assert.equal(h.petWindow, petWindow);
    assert.equal(petWindow.destroyed, false);
    assert.equal(petWindow.loadCount, 1);
    assert.deepEqual(petWindow.bounds, initialBounds);
    assert.equal(petWindow.title, name);
    assert.equal(petWindow.messages.at(-1).args[0].title, name);
    assert.equal(h.invokePet('petwin:init', petWindow).locale, language === 'en' ? 'en' : 'zh-CN');
    assert.equal(h.tray.tooltip, createTranslator(language === 'en' ? 'en' : 'zh-CN')('tray.tooltip'));
  }
  h.panel.messages.length = 0;
  h.invoke('settings:set', { language: 'EN', size: 4, activePet: 'other', position: { x: 0, y: 0 }, wander: 'yes' });
  assert.equal(h.invoke('app:state').settings.language, 'auto');
  assert.deepEqual(h.panel.messages.map((message) => message.channel), ['app:state']);
  h.panel.messages.length = 0;
  h.invoke('pets:reload');
  assert.equal(h.panel.messages.at(-1).channel, 'pets:changed');
  assert.deepEqual(h.panel.messages.at(-1).args, []);
});

test('公开记录与原生菜单翻译显示元数据及技术诊断，保留用户数据', (t) => {
  const h = mainHarness(t, { active: true, saved: { language: 'en' } });
  const original = JSON.stringify(h.fixtures);
  const [bundled, user, codex, broken] = h.invoke('pets:list');
  assert.equal(bundled.pet.name, 'Clawd');
  assert.deepEqual(bundled.pet.tags, ['Pixel art', 'Crab']);
  assert.equal(bundled.pet.animations.wave.label, 'Wave');
  assert.equal(bundled.pet.animations.idle.src, 'idle.gif');
  assert.equal(bundled.key, 'bundled/clawd');
  assert.equal(user.pet.name, '小克');
  assert.equal(user.pet.description, '自定义描述');
  assert.equal(user.pet.animations.wave.label, '挥手');
  assert.equal(codex.pet.name, '自定义名称');
  assert.equal(codex.pet.description, '用户描述');
  assert.equal(codex.pet.animations.waving.label, 'Wave');
  assert.match(broken.errors[0], /name is required/);
  assert.match(broken.warnings[0], /not recognized/);
  const sourceLabels = [...h.invoke('app:state').sources].map((source) => source.label);
  assert.ok(sourceLabels.every((label) => !/[\u3400-\u9fff]/u.test(label)));
  h.invoke('pet:activate', 'codex/custom');
  h.ipcMain.emit('petwin:menu', { sender: h.petWindow.webContents });
  const actions = h.menus.at(-1).find((item) => item.label === 'Actions');
  assert.equal(actions.submenu[0].label, 'Wave');
  assert.equal(actions.submenu[1].label, 'Jump');
  assert.equal(h.petWindow.title, '自定义名称');
  assert.equal(JSON.stringify(h.fixtures), original);
});

test('导入对话框、校验错误和常见 Codex 错误随语言切换', async (t) => {
  const h = mainHarness(t, { saved: { language: 'en' } });
  const incoming = path.join(h.root, 'incoming');
  fs.mkdirSync(incoming);
  h.dialog.result = { canceled: false, filePaths: [incoming] };
  let imported = await h.invoke('pets:import');
  assert.equal(imported.errors[0], 'The selected folder does not contain pet.json.');
  assert.equal(h.dialog.options.title, 'Select a Pet Folder');
  fs.writeFileSync(path.join(incoming, 'pet.json'), JSON.stringify({ id: 'incoming', animations: { idle: { src: 'missing.gif' } } }));
  imported = await h.invoke('pets:import');
  assert.ok(imported.errors.some((error) => error.includes('name is required')));
  assert.ok(imported.errors.some((error) => error.includes('missing.gif')));
  assert.ok(imported.errors.every((error) => !/[\u3400-\u9fff]/u.test(error)));
  assert.equal(h.invoke('codex:install', 'missing').error, 'Pet not found.');
  assert.equal(h.invoke('codex:install', 'codex/custom').error, 'This pet is already installed in Codex.');
  const invalid = h.invoke('codex:install', 'bundled/clawd', new Uint8Array([1]));
  assert.equal(invalid.code, 'INVALID_ATLAS');
  assert.equal(invalid.error, 'Invalid sprite sheet data.');
  h.invoke('settings:set', { language: 'zh-CN' });
  fs.rmSync(path.join(incoming, 'pet.json'));
  imported = await h.invoke('pets:import');
  assert.equal(imported.errors[0], '所选文件夹中没有 pet.json。');
  assert.equal(h.dialog.options.title, '选择宠物文件夹');
});

test('Codex 导出使用当前显示语言，保持源清单、id 和导出位置', (t) => {
  const h = mainHarness(t, { saved: { language: 'en' } });
  const source = h.fixtures[0];
  const original = JSON.stringify(source.pet);
  fs.mkdirSync(source.dir, { recursive: true });
  const sourceManifest = path.join(source.dir, 'pet.json');
  fs.writeFileSync(sourceManifest, original);
  const bytes = new Uint8Array(Buffer.from(`RIFF\0\0\0\0WEBPVP8L${'A'.repeat(16)}`, 'latin1'));
  const first = h.invoke('codex:install', source.key, bytes);
  assert.equal(first.ok, true);
  let exported = JSON.parse(fs.readFileSync(path.join(first.dir, 'pet.json'), 'utf8'));
  assert.equal(exported.id, 'clawd');
  assert.equal(exported.displayName, 'Clawd');
  assert.match(exported.description, /pixel crab/);
  h.invoke('settings:set', { language: 'zh-CN' });
  const second = h.invoke('codex:install', source.key, bytes);
  assert.equal(second.dir, first.dir);
  exported = JSON.parse(fs.readFileSync(path.join(second.dir, 'pet.json'), 'utf8'));
  assert.equal(exported.displayName, '小克');
  assert.equal(exported.description, '自定义描述');
  assert.equal(fs.readFileSync(sourceManifest, 'utf8'), original);
  assert.equal(JSON.stringify(source.pet), original);
});
