// Pets 桌面端主进程：托盘、控制面板窗口、透明桌宠窗口、菜单与 IPC。
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, screen, shell, Tray } from 'electron';
import { codexPetsDir, installCodexPet, isPetsExport, listExports } from './codex-install.js';
import { loginItemOptions } from './login-item.js';
import { ORIGIN, assetBase, handleProtocol, registerScheme } from './protocol.js';
import { loadPet, scanAll } from './registry.js';
import { LANGUAGE_PREFERENCES, Settings } from './settings.js';
import { createTranslator, localizeDiagnostic, resolveLanguage } from '../shared/i18n.js';
import { localizePet } from '../shared/pet-locales.js';

const DESKTOP_ROOT = path.resolve(import.meta.dirname, '..', '..');
const SRC = path.join(DESKTOP_ROOT, 'src');
const ICON = path.join(DESKTOP_ROOT, 'assets', 'icon.png');
const TRAY_ICON = path.join(DESKTOP_ROOT, 'assets', 'tray.png');
const REPO_URL = 'https://github.com/Maxwilldoit/Pets';
const SIZES = [0.5, 0.75, 1, 1.25, 1.5, 2];
const DEBUG = process.argv.includes('--pets-debug');
const log = (...args) => DEBUG && console.log('[pets]', ...args);

// 测试时可以用独立的用户目录，不影响真实设置
if (process.env.PETS_USER_DATA) app.setPath('userData', path.resolve(process.env.PETS_USER_DATA));
// 桌宠常驻后台，画面很小：软件渲染足够流畅，GPU 进程内存从 300MB+ 降到 20MB 左右。
// 需要时可用 --pets-gpu 打开硬件加速。
if (!process.argv.includes('--pets-gpu')) app.disableHardwareAcceleration();
registerScheme();

let settings;
let records = new Map();
let tray = null;
let panelWin = null;
let petWin = null;
let petKey = null;
let resolvedLocale = 'en';
let t = createTranslator(resolvedLocale);

function updateLocale() {
  resolvedLocale = resolveLanguage(settings.data.language, app.getLocale());
  t = createTranslator(resolvedLocale);
}

function displayPet(record) {
  if (!record?.pet) return null;
  const pet = localizePet(record.pet, resolvedLocale, record.source);
  if (pet.format !== 'codex') return pet;
  // Codex 格式的动作标签由 manifest 生成；名称、描述等用户数据保持原样。
  return {
    ...pet,
    animations: Object.fromEntries(Object.entries(pet.animations).map(([name, animation]) => [
      name, animation.label ? { ...animation, label: t(`animation.${name}`) } : animation,
    ])),
  };
}

// ---------------------------------------------------------------- 宠物来源

function sources() {
  return [
    {
      id: 'bundled',
      label: t('source.bundled'),
      dir: app.isPackaged ? path.join(process.resourcesPath, 'pets') : path.resolve(DESKTOP_ROOT, '..', 'pets'),
    },
    { id: 'user', label: t('source.user'), dir: path.join(app.getPath('userData'), 'pets') },
    { id: 'codex', label: t('source.codex'), dir: codexPetsDir() },
  ];
}

const sourceDir = (id) => sources().find((s) => s.id === id)?.dir;
let codexExports = new Map();

function rescan() {
  // 自己导出到 Codex 的宠物不再作为「Codex 宠物」重复出现
  const all = scanAll(sources()).filter((r) => r.source !== 'codex' || !isPetsExport(r.dir));
  records = new Map(all.map((r) => [r.key, r]));
  codexExports = listExports();
  log('pets:', [...records.values()].map((r) => (r.pet ? r.key : `${r.key}(无效)`)).join(', '));
}

const publicRecord = (r) => ({
  ...r,
  pet: displayPet(r),
  errors: r.errors.map((message) => localizeDiagnostic(message, resolvedLocale)),
  warnings: r.warnings.map((message) => localizeDiagnostic(message, resolvedLocale)),
  assetBase: assetBase(r),
  codexExport: codexExports.get(r.key) ?? null,
});

function appState() {
  return {
    locale: resolvedLocale,
    supportsLoginItem: process.platform === 'win32' || process.platform === 'darwin',
    activeKey: settings.data.activePet,
    visible: !!petWin,
    settings: settings.data,
    sources: sources().map((s) => ({ ...s, exists: fs.existsSync(s.dir) })),
    version: app.getVersion(),
    repoUrl: REPO_URL,
  };
}

function broadcast() {
  panelWin?.webContents.send('app:state', appState());
  refreshTrayMenu();
}

function petsChanged() {
  if (petKey && !records.get(petKey)?.pet) closePet();
  broadcast();
  panelWin?.webContents.send('pets:changed');
}

// ---------------------------------------------------------------- 桌宠窗口

const workAreas = () => screen.getAllDisplays().map((d) => d.workArea);

function initialPosition() {
  const p = settings.data.position;
  if (p && workAreas().some((a) => p.x >= a.x && p.x <= a.x + a.width && p.y >= a.y && p.y <= a.y + a.height + 1)) return p;
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - 180, y: wa.y + wa.height };
}

function lockDown(win) {
  // 原生窗口标题由主进程本地化，避免被 HTML 的初始标题覆盖。
  win.on('page-title-updated', (e) => e.preventDefault());
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function openPet(key) {
  const record = records.get(key);
  if (!record?.pet) return false;
  closePet();
  petKey = key;
  settings.set({ activePet: key, petVisible: true });
  const win = new BrowserWindow({
    width: 64,
    height: 64,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    alwaysOnTop: settings.data.alwaysOnTop,
    backgroundColor: '#00000000',
    title: displayPet(record).name,
    webPreferences: {
      preload: path.join(SRC, 'preload', 'pet.cjs'),
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  petWin = win;
  win.setIgnoreMouseEvents(true, { forward: true });
  lockDown(win);
  win.on('closed', () => {
    if (petWin !== win) return;
    petWin = null;
    petKey = null;
    broadcast();
  });
  win.loadURL(`${ORIGIN}/renderer/pet/index.html`);
  log('open pet', key);
  broadcast();
  return true;
}

function closePet() {
  const win = petWin;
  petWin = null;
  petKey = null;
  win?.destroy();
}

function hidePet() {
  closePet();
  settings.set({ petVisible: false });
  broadcast();
}

const sendPet = (cmd) => petWin?.webContents.send('petwin:command', cmd);

function applySettings(patch) {
  const clean = {};
  if (LANGUAGE_PREFERENCES.includes(patch.language)) clean.language = patch.language;
  if (typeof patch.size === 'number' && patch.size >= 0.25 && patch.size <= 3) clean.size = patch.size;
  for (const k of ['wander', 'randomActions', 'gravity', 'alwaysOnTop', 'launchAtLogin']) {
    if (typeof patch[k] === 'boolean') clean[k] = patch[k];
  }
  const languageChanged = 'language' in clean && clean.language !== settings.data.language;
  const previousLocale = resolvedLocale;
  settings.set(clean);
  if ('language' in clean) {
    updateLocale();
    panelWin?.setTitle(t('app.title'));
    petWin?.setTitle(displayPet(records.get(petKey))?.name ?? t('app.title'));
  }
  if ('alwaysOnTop' in clean) petWin?.setAlwaysOnTop(clean.alwaysOnTop);
  if ('launchAtLogin' in clean && (process.platform === 'win32' || process.platform === 'darwin')) {
    const opts = loginItemOptions({
      packaged: app.isPackaged,
      platform: process.platform,
      execPath: process.execPath,
      appRoot: DESKTOP_ROOT,
      portableExecutableFile: process.env.PORTABLE_EXECUTABLE_FILE,
    });
    app.setLoginItemSettings({ openAtLogin: clean.launchAtLogin, ...opts });
  }
  sendPet({ type: 'settings', settings: settings.data, locale: resolvedLocale, title: displayPet(records.get(petKey))?.name });
  broadcast();
  if (languageChanged || resolvedLocale !== previousLocale) panelWin?.webContents.send('pets:changed', { reason: 'language' });
}

// ---------------------------------------------------------------- 菜单

function switchItems() {
  const valid = [...records.values()].filter((r) => r.pet);
  if (!valid.length) return [{ label: t('menu.noPets'), enabled: false }];
  return valid.map((r) => ({
    label: r.source === 'bundled' ? displayPet(r).name : t('menu.petSource', { name: displayPet(r).name, source: t(`sourceShort.${r.source}`) }),
    type: 'radio',
    checked: r.key === petKey,
    click: () => openPet(r.key),
  }));
}

function petMenu() {
  const pet = displayPet(records.get(petKey));
  const s = settings.data;
  const actions = pet?.actions ?? [];
  return Menu.buildFromTemplate([
    { label: pet?.name ?? t('app.title'), enabled: false },
    { type: 'separator' },
    ...(actions.length
      ? [{ label: t('menu.actions'), submenu: actions.map((n) => ({ label: pet.animations[n].label, click: () => sendPet({ type: 'play', name: n }) })) }]
      : []),
    { label: t('menu.switchPet'), submenu: switchItems() },
    {
      label: t('menu.size'),
      submenu: SIZES.map((v) => ({
        label: `${Math.round(v * 100)}%`,
        type: 'radio',
        checked: Math.abs(s.size - v) < 0.001,
        click: () => applySettings({ size: v }),
      })),
    },
    { label: t('menu.wander'), type: 'checkbox', checked: s.wander, click: (item) => applySettings({ wander: item.checked }) },
    { label: t('menu.randomActions'), type: 'checkbox', checked: s.randomActions, click: (item) => applySettings({ randomActions: item.checked }) },
    { type: 'separator' },
    { label: t('menu.openPanel'), click: showPanel },
    { label: t('menu.hidePet'), click: hidePet },
    { label: t('menu.quit'), click: () => app.quit() },
  ]);
}

function createTray() {
  const icon = nativeImage.createFromPath(TRAY_ICON);
  tray = new Tray(icon);
  tray.on('click', showPanel);
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setToolTip(t('tray.tooltip'));
  const active = records.get(settings.data.activePet);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: t('menu.openPanel'), click: showPanel },
      petWin
        ? { label: t('menu.hidePet'), click: hidePet }
        : { label: t('menu.showPet'), enabled: !!active?.pet, click: () => openPet(active.key) },
      { label: t('menu.switchPet'), submenu: switchItems() },
      { type: 'separator' },
      { label: t('menu.quit'), click: () => app.quit() },
    ]),
  );
}

// ---------------------------------------------------------------- 控制面板

function showPanel() {
  if (panelWin) {
    if (panelWin.isMinimized()) panelWin.restore();
    panelWin.show();
    panelWin.focus();
    return;
  }
  const supportsOverlayColors = process.platform === 'win32' || process.platform === 'linux';
  const titleBarOverlay = () => ({
    color: nativeTheme.shouldUseDarkColors ? '#1f1c24' : '#fffdf9',
    symbolColor: nativeTheme.shouldUseDarkColors ? '#f1ebe4' : '#2d2620',
    height: 60,
  });
  const win = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 820,
    minHeight: 560,
    show: false,
    title: t('app.title'),
    // 隐藏视觉标题，保留原生窗口按钮和任务栏/可访问性标题。
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: supportsOverlayColors ? titleBarOverlay() : { height: 60 },
    icon: ICON,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#17151b' : '#f6f1ea',
    webPreferences: { preload: path.join(SRC, 'preload', 'panel.cjs'), sandbox: true, contextIsolation: true },
  });
  panelWin = win;
  const updateTitleBar = () => {
    // macOS 使用系统交通灯按钮；动态设置覆盖区颜色仅支持 Windows/Linux。
    if (supportsOverlayColors && !win.isDestroyed()) win.setTitleBarOverlay(titleBarOverlay());
  };
  nativeTheme.on('updated', updateTitleBar);
  win.removeMenu();
  lockDown(win);
  win.once('ready-to-show', () => win.show());
  win.once('closed', () => {
    nativeTheme.removeListener('updated', updateTitleBar);
    if (panelWin === win) panelWin = null;
  });
  win.loadURL(`${ORIGIN}/renderer/panel/index.html`);
}

/** 给控制面板发一条提示；面板没开就先打开，等页面加载完再发。 */
function notifyPanel(toast) {
  if (panelWin && !panelWin.webContents.isLoading()) {
    panelWin.webContents.send('app:toast', toast);
    return;
  }
  showPanel();
  panelWin.webContents.once('did-finish-load', () => panelWin?.webContents.send('app:toast', toast));
}

async function importPet() {
  try {
    const res = await dialog.showOpenDialog(panelWin ?? undefined, {
      title: t('dialog.importPet'),
      properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
    const src = res.filePaths[0];
    if (!fs.existsSync(path.join(src, 'pet.json'))) return { ok: false, errors: [t('error.noManifest')] };
    const check = loadPet('user', src);
    if (!check.pet) return { ok: false, errors: check.errors.map((message) => localizeDiagnostic(message, resolvedLocale)) };
    const userDir = sourceDir('user');
    const base = path.basename(src);
    let dest = path.join(userDir, base);
    for (let i = 2; fs.existsSync(dest); i++) dest = path.join(userDir, `${base}-${i}`);
    fs.cpSync(src, dest, { recursive: true });
    rescan();
    petsChanged();
    return { ok: true, key: `user/${path.basename(dest)}`, name: check.pet.name };
  } catch (error) {
    return { ok: false, errors: [t('error.importPet', { error: localizeDiagnostic(error.message, resolvedLocale) })] };
  }
}

// ---------------------------------------------------------------- IPC

function registerIpc() {
  const fromPet = (e) => petWin && e.sender === petWin.webContents;

  // 桌宠窗口
  ipcMain.handle('petwin:init', (e) => {
    const record = records.get(petKey);
    if (!fromPet(e) || !record) return null;
    return { record: publicRecord(record), locale: resolvedLocale, settings: settings.data, areas: workAreas(), position: initialPosition(), debug: DEBUG };
  });
  ipcMain.on('petwin:ready', (e) => fromPet(e) && petWin.showInactive());
  ipcMain.on('petwin:bounds', (e, b) => {
    if (!fromPet(e) || !b) return;
    const r = { x: Math.round(b.x), y: Math.round(b.y), width: Math.max(1, Math.round(b.width)), height: Math.max(1, Math.round(b.height)) };
    if (Object.values(r).every(Number.isFinite)) petWin.setBounds(r);
  });
  ipcMain.on('petwin:ignore-mouse', (e, ignore) => fromPet(e) && petWin.setIgnoreMouseEvents(!!ignore, { forward: true }));
  ipcMain.on('petwin:menu', (e) => {
    if (!fromPet(e)) return;
    const menu = petMenu();
    if (DEBUG) globalThis.__petsDebug = { menu }; // 自动化测试用：读取/关闭右键菜单
    menu.popup({ window: petWin });
  });
  ipcMain.on('petwin:position', (e, p) => {
    if (fromPet(e) && Number.isFinite(p?.x) && Number.isFinite(p?.y)) settings.set({ position: { x: Math.round(p.x), y: Math.round(p.y) } });
  });
  ipcMain.on('petwin:log', (e, level, msg) => {
    if (level === 'info') return log('[pet]', msg);
    console.error('[pet]', msg);
    if (level === 'fatal' && fromPet(e)) {
      const name = displayPet(records.get(petKey))?.name ?? t('app.title');
      const error = localizeDiagnostic(msg, resolvedLocale);
      closePet();
      broadcast();
      notifyPanel({ type: 'error', text: t('error.petLoad', { name, error }) });
    }
  });

  // 控制面板
  ipcMain.handle('pets:list', () => [...records.values()].map(publicRecord));
  ipcMain.handle('app:state', () => appState());
  ipcMain.handle('pet:activate', (_e, key) => openPet(key));
  ipcMain.handle('pet:visible', (_e, visible) => {
    if (visible) return openPet(settings.data.activePet);
    hidePet();
    return true;
  });
  ipcMain.handle('pet:play', (_e, name) => {
    sendPet({ type: 'play', name });
    return !!petWin;
  });
  ipcMain.handle('settings:set', (_e, patch) => {
    applySettings(patch ?? {});
    return settings.data;
  });
  ipcMain.handle('folder:open', (_e, target) => {
    const dir = sourceDir(target) ?? records.get(target)?.dir;
    if (!dir) return false;
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
    return true;
  });
  ipcMain.handle('pets:reload', () => {
    rescan();
    petsChanged();
    return true;
  });
  ipcMain.handle('pets:import', importPet);
  ipcMain.handle('codex:install', (_e, key, bytes) => {
    const record = records.get(key);
    if (!record?.pet) return { ok: false, error: t('error.petNotFound') };
    if (record.source === 'codex') return { ok: false, error: t('error.alreadyInCodex') };
    let res;
    try {
      res = installCodexPet({ sourceKey: key, pet: displayPet(record), bytes });
    } catch (error) {
      res = { ok: false, code: 'INSTALL_FAILED', error: error.message };
    }
    if (!res.ok) {
      const key = { INVALID_ATLAS: 'error.invalidAtlas', FOREIGN_EXPORT: 'error.foreignExport' }[res.code] ?? 'error.installCodex';
      return { ...res, error: t(key, { path: res.path, error: localizeDiagnostic(res.error, resolvedLocale) }) };
    }
    log('codex install', key, JSON.stringify(res));
    if (res.ok) {
      rescan();
      petsChanged();
    }
    return res;
  });
  ipcMain.handle('app:open-external', (_e, url) => {
    if (typeof url === 'string' && url.startsWith(REPO_URL)) shell.openExternal(url);
  });
}

// ---------------------------------------------------------------- 启动

function start() {
  app.setAppUserModelId('com.maxworkinghard.pets');
  settings = new Settings(path.join(app.getPath('userData'), 'settings.json'));
  updateLocale();
  fs.mkdirSync(sourceDir('user'), { recursive: true });
  handleProtocol(SRC, (key) => records.get(key));
  rescan();
  registerIpc();
  createTray();

  const pushAreas = () => sendPet({ type: 'areas', areas: workAreas() });
  screen.on('display-added', pushAreas);
  screen.on('display-removed', pushAreas);
  screen.on('display-metrics-changed', pushAreas);

  // --pet=<key> 可在启动时直接显示指定宠物（调试用）
  const forced = process.argv.find((a) => a.startsWith('--pet='))?.slice(6);
  const key = forced ?? (settings.data.petVisible ? settings.data.activePet : null);
  const shown = key ? openPet(key) : false;
  if (!shown || process.argv.includes('--panel')) showPanel();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => app.isReady() && showPanel());
  app.on('window-all-closed', () => {
    // 托盘常驻：关掉所有窗口也不退出，从托盘菜单退出
  });
  app.whenReady().then(start);
}
