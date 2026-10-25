import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadPet } from '../src/main/registry.js';
import { planCodexExport } from '../src/shared/codex.js';
import { referencedFiles } from '../src/shared/manifest.js';
import { localizePet } from '../src/shared/pet-locales.js';

const REPO_PETS = path.resolve(import.meta.dirname, '..', '..', 'pets');
const EXPECTED = {
  clawd: { name: 'Clawd', tags: ['Pixel art', 'Crab'] },
  'clawd-xmas': { name: 'Clawd (Christmas)', tags: ['Pixel art', 'Crab', 'Holiday'] },
  'hoop-23': { name: 'High Flyer 23', tags: ['Character', 'Basketball'] },
  'kuro-blade': { name: 'Black Feather', tags: ['Character', 'Swordfighter'] },
  makima: { name: 'Makima', tags: ['Pixel art', 'Character'] },
  momo: { name: 'Momo', tags: ['Pixel art', 'Animal', 'Codex', 'In progress'] },
  nashor: { name: 'Baron Nashor', tags: ['Monster', 'Action'] },
  yamada: { name: 'Yamada', tags: ['Pixel art', 'Character'] },
  'yamada-clerk': { name: 'Yamada (Clerk)', tags: ['Pixel art', 'Character'] },
  'yamada-q': { name: 'Yamada (Chibi)', tags: ['Chibi', 'Character', 'Codex'] },
};
const bundled = fs.readdirSync(REPO_PETS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(REPO_PETS, entry.name, 'pet.json')))
  .map((entry) => {
    const dir = path.join(REPO_PETS, entry.name);
    const manifestPath = path.join(dir, 'pet.json');
    const contents = fs.readFileSync(manifestPath, 'utf8');
    return { dir, manifestPath, contents, raw: JSON.parse(contents.replace(/^\uFEFF/, '')) };
  });

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function assertEnglish(text, at) {
  assert.equal(typeof text, 'string', at);
  assert.match(text, /[a-z]/i, at);
  assert.doesNotMatch(text, /\p{Script=Han}/u, at);
}

function assertDisplayOnly(original, english) {
  assert.notEqual(english, original);
  assert.deepEqual(Object.keys(english), Object.keys(original));
  for (const key of Object.keys(original)) {
    if (!['name', 'description', 'tags', 'animations'].includes(key)) {
      assert.equal(english[key], original[key], `${original.id}.${key}`);
    }
  }

  assert.notEqual(english.tags, original.tags);
  assert.notEqual(english.animations, original.animations);
  assert.deepEqual(Object.keys(english.animations), Object.keys(original.animations));
  for (const [name, animation] of Object.entries(original.animations)) {
    const translated = english.animations[name];
    assert.deepEqual(Object.keys(translated), Object.keys(animation), `${original.id}.${name}`);
    if (Object.hasOwn(animation, 'label')) {
      assert.notEqual(translated, animation, `${original.id}.${name}`);
      assertEnglish(translated.label, `${original.id}.${name}.label`);
    } else {
      assert.equal(translated, animation, `${original.id}.${name}`);
    }
    for (const key of Object.keys(animation)) {
      if (key !== 'label') assert.equal(translated[key], animation[key], `${original.id}.${name}.${key}`);
    }
  }
}

test('覆盖真实 pets/ 中的全部 10 只内置宠物', () => {
  assert.equal(Object.keys(EXPECTED).length, 10);
  assert.deepEqual(bundled.map(({ raw }) => raw.id).sort(), Object.keys(EXPECTED).sort());
});

for (const { dir, manifestPath, contents, raw } of bundled) {
  test(`${raw.id}：原始清单和 loadPet 数据的英文元数据完整，资源与动作结构不变`, () => {
    const { pet, errors } = loadPet('bundled', dir);
    assert.deepEqual(errors, [], raw.id);
    assert.ok(pet, raw.id);

    for (const original of [raw, pet]) {
      const before = structuredClone(original);
      deepFreeze(original);
      const english = localizePet(original, 'en');

      assertDisplayOnly(original, english);
      assert.equal(english.name, EXPECTED[original.id].name);
      assert.deepEqual(english.tags, EXPECTED[original.id].tags);
      assertEnglish(english.name, `${original.id}.name`);
      assertEnglish(english.description, `${original.id}.description`);
      english.tags.forEach((tag) => assertEnglish(tag, `${original.id}.tags`));
      assert.notEqual(english.description, original.description);
      assert.deepEqual(original, before, `${original.id} 未被修改`);
    }

    const english = localizePet(pet, 'en', 'bundled');
    assert.equal(english.id, pet.id);
    assert.equal(english.behavior, pet.behavior);
    assert.equal(english.actions, pet.actions);
    assert.equal(english.codex, pet.codex);
    assert.deepEqual(referencedFiles(english), referencedFiles(pet));
    assert.deepEqual(planCodexExport(english), planCodexExport(pet));
    assert.equal(fs.readFileSync(manifestPath, 'utf8'), contents);
  });
}

test('动作名称忠实于 manifest label，保留姿态、组合动作和方向语义', () => {
  const cases = [
    ['clawd', 'wink', 'Blink'],
    ['clawd', 'listening', 'Listen with headphones'],
    ['clawd', 'type-keyboard', 'Type on keyboard'],
    ['yamada', 'wave', 'Say hello'],
    ['makima', 'wave', 'Wave'],
    ['yamada', 'peek-cute', 'Rest chin in hands'],
    ['yamada-clerk', 'peek-cute', 'Rest chin in hands'],
    ['yamada', 'smoke', 'Smoke while standing'],
    ['yamada', 'smoke-sit', 'Sit down and smoke'],
    ['hoop-23', 'drive-dunk', 'Dribble and dunk'],
    ['nashor', 'sway', 'Sway with hands tucked in'],
    ['nashor', 'starup', 'Star upgrade'],
    ['nashor', 'attack', 'Basic attack'],
    ['nashor', 'ultimate-acid', 'Spit acid'],
    ['nashor', 'ultimate-combo', 'Basic attack, then spit acid'],
    ['nashor', 'burrow-left', 'Burrow left'],
    ['nashor', 'burrow-right', 'Burrow right'],
    ['yamada-q', 'running', 'Busy'],
  ];
  for (const [id, animation, expected] of cases) {
    const { raw } = bundled.find((entry) => entry.raw.id === id);
    assert.equal(localizePet(raw, 'en').animations[animation].label, expected, `${id}.${animation}`);
  }
});

test('仅精确 en 和 bundled 生效；中文及自定义来源即使 id 相同也返回原对象', () => {
  for (const { raw, dir } of bundled) {
    const { pet, errors } = loadPet('bundled', dir);
    assert.deepEqual(errors, []);
    for (const original of [raw, pet]) {
      for (const locale of ['zh', 'zh-CN', 'zh-TW', 'en-US', 'en-GB', 'EN', 'fr', '', null, undefined]) {
        assert.equal(localizePet(original, locale), original, `${original.id}/${locale}`);
      }
      for (const source of ['user', 'codex', 'custom', 'Bundled', '', null]) {
        assert.equal(localizePet(original, 'en', source), original, `${original.id}/${source}`);
      }
      assert.deepEqual(localizePet(original, 'en'), localizePet(original, 'en', 'bundled'));
    }
  }
});

test('自定义或未知 id（包括原型属性名称）以及 null/undefined 保持原值', () => {
  const { raw } = bundled.find((entry) => entry.raw.id === 'clawd');
  for (const id of ['my-pet', 'clawd-custom', 'Clawd', 'constructor', 'toString', '__proto__', '', null, undefined]) {
    const custom = { ...raw, id };
    const before = structuredClone(custom);
    assert.equal(localizePet(custom, 'en'), custom, String(id));
    assert.equal(localizePet(custom, 'zh'), custom, String(id));
    assert.deepEqual(custom, before);
  }
  for (const empty of [null, undefined]) {
    assert.equal(localizePet(empty, 'en'), empty);
    assert.equal(localizePet(empty, 'zh'), empty);
    assert.equal(localizePet(empty, 'en', 'user'), empty);
  }
});

test('修改返回的显示字段不会影响原宠物或后续调用', () => {
  const { raw } = bundled.find((entry) => entry.raw.id === 'clawd');
  const original = structuredClone(raw);
  const before = structuredClone(original);
  const english = localizePet(original, 'en');
  english.name = 'Changed';
  english.description = 'Changed';
  english.tags[0] = 'Changed';
  english.animations.wave.label = 'Changed';

  assert.deepEqual(original, before);
  const again = localizePet(original, 'en');
  assert.equal(again.name, 'Clawd');
  assert.notEqual(again.description, 'Changed');
  assert.equal(again.tags[0], 'Pixel art');
  assert.equal(again.animations.wave.label, 'Wave');
});
