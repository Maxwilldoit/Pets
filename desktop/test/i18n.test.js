import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SUPPORTED_LANGUAGES, TRANSLATIONS, createTranslator, localizeDiagnostic, resolveLanguage } from '../src/shared/i18n.js';
import { normalizeManifest } from '../src/shared/manifest.js';

test('system locale selects Chinese or English while an explicit preference takes precedence', () => {
  for (const system of ['zh', 'zh-CN', 'zh_TW', 'zh-Hant-HK']) assert.equal(resolveLanguage('auto', system), 'zh-CN');
  for (const system of ['en-US', 'en-GB', 'de-DE', 'ja-JP', '']) assert.equal(resolveLanguage('auto', system), 'en');
  assert.equal(resolveLanguage('en', 'zh-CN'), 'en');
  assert.equal(resolveLanguage('zh-CN', 'en-US'), 'zh-CN');
  assert.equal(resolveLanguage('invalid', 'zh-CN'), 'zh-CN');
});

test('both dictionaries provide complete text with matching interpolation parameters', () => {
  assert.deepEqual([...SUPPORTED_LANGUAGES], ['zh-CN', 'en']);
  for (const key of Object.keys(TRANSLATIONS.en)) {
    const parameters = (text) => [...text.matchAll(/\{\w+\}/g)].map(([name]) => name).sort();
    for (const locale of SUPPORTED_LANGUAGES) {
      assert.equal(typeof TRANSLATIONS[locale][key], 'string', `${locale}: ${key}`);
      assert.ok(TRANSLATIONS[locale][key].trim(), `${locale}: ${key}`);
    }
    assert.deepEqual(parameters(TRANSLATIONS.en[key]), parameters(TRANSLATIONS['zh-CN'][key]), key);
  }
});

test('translation substitutes values literally and preserves unknown keys', () => {
  assert.equal(createTranslator('en')('toast.activated', { name: '$& {name}' }), 'Desktop pet set to $& {name}.');
  assert.equal(createTranslator('en')('count.actions.one', { count: 1 }), '1 action');
  assert.equal(createTranslator('en')('count.actions.other', { count: 2 }), '2 actions');
  assert.equal(createTranslator('zh-CN')('count.actions.other', { count: 2 }), '2 个动作');
  assert.equal(createTranslator('invalid')('nav.settings'), 'Settings');
  assert.equal(createTranslator('en')('unknown.key'), 'unknown.key');
});

test('UI, accessibility labels, and native menu translation keys are defined', () => {
  const files = ['main/index.js', 'renderer/panel/panel.js', 'renderer/panel/index.html', 'renderer/pet/pet.js'];
  for (const file of files) {
    const source = fs.readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    const keys = [
      ...[...source.matchAll(/\bt\(['"]([^'"]+)['"]/g)].map((match) => match[1]),
      ...[...source.matchAll(/data-i18n(?:-title|-aria|-placeholder)?="([^"]+)"/g)].map((match) => match[1]),
      ...[...source.matchAll(/['"](error\.[\w.]+)['"]/g)].map((match) => match[1]),
    ];
    for (const key of keys) assert.ok(Object.hasOwn(TRANSLATIONS.en, key), `${file}: ${key}`);
  }
  for (const key of [
    ...['all', 'bundled', 'user', 'codex'].map((value) => `filter.${value}`),
    ...['auto', 'zh-CN', 'en'].map((value) => `language.${value}`),
    ...['bundled', 'user', 'codex'].flatMap((value) => [`source.${value}`, `sourceShort.${value}`]),
    ...['idle', 'walk', 'walk-left', 'walk-right', 'drag', 'drag-left', 'drag-right', 'fall', 'sleep', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review'].map((value) => `animation.${value}`),
    ...['running-right', 'running-left', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review'].map((value) => `codexState.${value}`),
  ]) assert.ok(Object.hasOwn(TRANSLATIONS.en, key), `dynamic key: ${key}`);
});

test('invalid pet diagnostics are translated without changing validation or file paths', () => {
  const cases = [
    null,
    {},
    { id: 'INVALID ID', name: '', scale: -1, speed: -1, tags: 2, behavior: [], animations: {} },
    { id: 'cat', name: 'Cat', animations: { idle: { frames: ['missing.png'], fps: 0, repeat: 0, weight: -1, mirror: 5, label: '', anchor: [], stepDistance: 0 } } },
    { id: 'cat', name: 'Cat', animations: { idle: { sheet: { src: '../outside.png', cell: [], row: -1, col: -1, count: 0 } } } },
    { id: 'cat', name: 'Cat', animations: { idle: { frames: [{ src: 'missing.png', duration: -1, offset: [] }] }, other: { src: 'missing.png', frames: [] } }, behavior: { click: 'missing' }, codex: { unknown: 'idle', review: 'missing' } },
    { id: 'cat', name: 'Cat', animations: { idle: { src: 'missing.png', unused: 1 }, 'walk-left': { src: 'missing.png' } } },
  ];
  let count = 0;
  for (const raw of cases) {
    const result = normalizeManifest(raw, { dirName: 'cat', fileExists: () => false });
    for (const message of [...result.errors, ...result.warnings]) {
      assert.equal(localizeDiagnostic(message, 'zh-CN'), message);
      const english = localizeDiagnostic(message, 'en');
      assert.doesNotMatch(english, /\p{Script=Han}/u, english);
      count++;
    }
  }
  assert.ok(count >= 25);
  const message = 'animations.idle.src 文件不存在：images/中文.png';
  assert.equal(localizeDiagnostic(message, 'en'), 'animations.idle.src references a missing file: images/中文.png');
  assert.equal(localizeDiagnostic('Unexpected decoder error', 'en'), 'Unexpected decoder error');
  assert.equal(localizeDiagnostic('动画「wave」加载失败：图片加载失败：images/wave.png', 'en'), 'Could not load animation "wave": Could not load image: images/wave.png');
});
