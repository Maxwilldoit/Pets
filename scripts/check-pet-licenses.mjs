#!/usr/bin/env node
// Warn on ordinary checks and block a public release until every bundled asset
// has an explicit, reviewable license. This intentionally does not infer a
// license from a public repository or download URL.
import fs from 'node:fs';
import path from 'node:path';

const strict = process.argv.includes('--strict');
const root = path.resolve(import.meta.dirname, '..');
const unresolved = /未(?:单独)?声明|unknown|unlicensed|no license/i;
const failures = [];

for (const entry of fs.readdirSync(path.join(root, 'pets'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const filename = path.join(root, 'pets', entry.name, 'pet.json');
  try {
    const manifest = JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
    const license = typeof manifest.license === 'string' ? manifest.license.trim() : '';
    if (!license || unresolved.test(license)) failures.push(`pets/${entry.name}: ${license || '缺少 license'}`);
    if (typeof manifest.author !== 'string' || !manifest.author.trim()) {
      console.warn(`提示：pets/${entry.name} 未填写 author`);
    }
  } catch (error) {
    failures.push(`pets/${entry.name}: 无法读取或校验 pet.json（${error.message}）`);
  }
}

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'catalog.json'), 'utf8'));
for (const asset of catalog.assets ?? []) {
  const license = typeof asset.licenseStatus === 'string' ? asset.licenseStatus.trim() : '';
  if (!license || unresolved.test(license)) failures.push(`catalog/${asset.id}: ${license || '缺少 licenseStatus'}`);
}

if (failures.length) {
  const heading = strict ? '错误：素材许可未确认，禁止公开发行' : '提示：下列素材尚无可核实的许可';
  console.error(`${heading}\n${failures.map((item) => `- ${item}`).join('\n')}`);
  if (strict) process.exitCode = 1;
} else {
  console.log('所有内置与公开素材均已声明许可');
}
