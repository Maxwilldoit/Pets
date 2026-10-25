import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loginItemOptions } from '../src/main/login-item.js';

const base = {
  packaged: true,
  platform: 'win32',
  execPath: 'C:\\Users\\me\\AppData\\Local\\Temp\\Pets.exe',
  appRoot: 'C:\\repo\\desktop',
  portableExecutableFile: 'C:\\Users\\me\\Downloads\\Pets.exe',
};

test('portable Windows build registers the downloaded launcher', () => {
  assert.deepEqual(loginItemOptions(base), { path: base.portableExecutableFile });
});

test('installed and macOS builds keep Electron defaults', () => {
  assert.deepEqual(loginItemOptions({ ...base, portableExecutableFile: undefined }), {});
  assert.deepEqual(loginItemOptions({ ...base, platform: 'darwin' }), {});
});

test('source runs still pass the Electron app directory', () => {
  assert.deepEqual(loginItemOptions({ ...base, packaged: false }), { path: base.execPath, args: [base.appRoot] });
});
