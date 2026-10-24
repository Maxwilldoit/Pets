import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const tag = 'v0.1.1';
const groups = {
  'windows-x64': ['Pets-0.1.1-windows-x64-setup.exe', 'Pets-0.1.1-windows-x64-portable.exe'],
  'macos-x64': ['Pets-0.1.1-macos-x64.dmg', 'Pets-0.1.1-macos-x64.zip'],
  'macos-arm64': ['Pets-0.1.1-macos-arm64.dmg', 'Pets-0.1.1-macos-arm64.zip'],
  'linux-x64': ['Pets-0.1.1-linux-x86_64.AppImage', 'Pets-0.1.1-linux-amd64.deb'],
};

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pets-release-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('pets-release-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const input = path.join(dir, 'downloads');
  for (const [platform, files] of Object.entries(groups)) {
    const group = path.join(input, `pets-${tag}-${platform}`);
    fs.mkdirSync(group, { recursive: true });
    for (const file of files) fs.writeFileSync(path.join(group, file), `package payload: ${file}\n`);
  }
  const output = path.join(dir, 'packages');
  const aggregate = () => spawnSync(process.execPath, ['scripts/release-artifacts.mjs', 'aggregate', tag, input, output], { cwd: root, encoding: 'utf8', windowsHide: true });
  return { input, output, aggregate };
}

test('aggregate accepts native Linux architecture names and hashes all eight packages', (t) => {
  const { output, aggregate } = fixture(t);
  const result = aggregate();
  assert.equal(result.status, 0, result.stderr);
  const names = Object.values(groups).flat().sort();
  assert.deepEqual(fs.readdirSync(output).sort(), [...names, 'SHA256SUMS'].sort());
  const expected = names.map((name) => {
    const bytes = fs.readFileSync(path.join(output, name));
    return `${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`;
  }).join('');
  assert.equal(fs.readFileSync(path.join(output, 'SHA256SUMS'), 'utf8'), expected);
});

test('aggregate refuses an incomplete platform before preparing release files', (t) => {
  const { input, output, aggregate } = fixture(t);
  fs.unlinkSync(path.join(input, `pets-${tag}-linux-x64`, groups['linux-x64'][0]));
  const result = aggregate();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unexpected or missing entries/);
  assert.equal(fs.existsSync(output), false);
});
