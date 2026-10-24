#!/usr/bin/env node
// Run from the repository root. Artifact names match desktop/electron-builder.yml.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const PLATFORMS = ['windows-x64', 'macos-x64', 'macos-arm64', 'linux-x64'];
const CHECKSUMS = 'SHA256SUMS';

function packageNames(tag, platform) {
  assert.match(tag ?? '', TAG_PATTERN, 'Use an existing tag in the form v0.1.0');
  const version = tag.slice(1);
  const names = {
    'windows-x64': [`Pets-${version}-windows-x64-setup.exe`, `Pets-${version}-windows-x64-portable.exe`],
    'macos-x64': [`Pets-${version}-macos-x64.dmg`, `Pets-${version}-macos-x64.zip`],
    'macos-arm64': [`Pets-${version}-macos-arm64.dmg`, `Pets-${version}-macos-arm64.zip`],
    // electron-builder expands ${arch} to each Linux target's native spelling.
    'linux-x64': [`Pets-${version}-linux-x86_64.AppImage`, `Pets-${version}-linux-amd64.deb`],
  };
  if (platform) {
    assert.ok(PLATFORMS.includes(platform), `Unknown platform: ${platform}`);
    return names[platform];
  }
  const all = PLATFORMS.flatMap((id) => names[id]).sort();
  assert.equal(all.length, 8);
  assert.equal(new Set(all.map((name) => name.toLowerCase())).size, 8, 'Package filenames must be unique');
  return all;
}

function regularFile(filename) {
  const stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && stat.size > 0, `Expected a nonempty regular file: ${filename}`);
  return stat;
}

function exactEntries(directory, names, kind = 'file') {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  assert.deepEqual(entries.map((entry) => entry.name).sort(), [...names].sort(), `Unexpected or missing entries in ${directory}`);
  for (const entry of entries) {
    assert.ok(kind === 'directory' ? entry.isDirectory() : entry.isFile(), `Unexpected entry type: ${path.join(directory, entry.name)}`);
    if (kind === 'file') regularFile(path.join(directory, entry.name));
  }
}

function emptyDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
  exactEntries(directory, []);
}

async function sha256(filename) {
  regularFile(filename);
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

function notesFile(tag) {
  const filename = path.join('docs', 'releases', `${tag}.md`);
  regularFile(filename);
  assert.ok(fs.readFileSync(filename, 'utf8').trim(), `Release notes are empty: ${filename}`);
  return filename;
}

function verifyTag(tag, expectedCommit) {
  packageNames(tag);
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const commit = git('rev-parse', 'HEAD');
  assert.equal(commit, git('rev-parse', `refs/tags/${tag}^{commit}`), 'HEAD must be the exact requested tag');
  if (expectedCommit) assert.equal(commit, expectedCommit, 'The tag moved after validation; refuse to release');
  const pkg = JSON.parse(fs.readFileSync('desktop/package.json', 'utf8'));
  assert.equal(pkg.version, tag.slice(1), 'desktop/package.json.version must match the release tag');
  notesFile(tag);
  console.log(`Verified ${tag} at ${commit} (desktop ${pkg.version})`);
  return commit;
}

async function verifyPackagedResources(tag, platform, dist) {
  packageNames(tag, platform);
  const resourceLocations = {
    'windows-x64': ['win-unpacked', 'resources'],
    'macos-x64': ['mac', 'Pets.app', 'Contents', 'Resources'],
    'macos-arm64': ['mac-arm64', 'Pets.app', 'Contents', 'Resources'],
    'linux-x64': ['linux-unpacked', 'resources'],
  };
  const resources = path.join(dist, ...resourceLocations[platform]);
  const archive = path.resolve(resources, 'app.asar');
  regularFile(archive);
  // Reuse electron-builder's locked dependency; no extra install or npx download.
  const require = createRequire(path.resolve('desktop/package.json'));
  const asar = require('@electron/asar');
  const main = 'src/main/index.js';
  // asar v3 resolves archive entries using the host's path separator.
  const mainEntry = path.join('src', 'main', 'index.js');
  assert.ok(asar.extractFile(archive, mainEntry).equals(fs.readFileSync(path.join('desktop', main))), `app.asar is missing the tagged ${main}`);
  const pkg = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
  assert.equal(pkg.version, tag.slice(1), 'Packaged app version must match the tag');
  assert.equal(pkg.main, main, 'Packaged app must use src/main/index.js');

  const petIds = fs.readdirSync('pets', { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  assert.ok(petIds.length > 0, 'The tagged source pet library is empty');
  if (tag === 'v0.1.1') assert.equal(petIds.length, 11, 'v0.1.1 must bundle all 11 pets');
  // extraResources also copies pets/README.md; compare pet directories only.
  const packagedPetIds = fs.readdirSync(path.join(resources, 'pets'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  assert.deepEqual(packagedPetIds, petIds, 'Packaged pet directories must match the tagged source library');
  const { referencedFiles } = await import('../desktop/src/shared/manifest.js');
  const { loadPet } = await import('../desktop/src/main/registry.js');
  for (const id of petIds) {
    const source = path.join('pets', id);
    const packaged = path.join(resources, 'pets', id);
    const manifest = fs.readFileSync(path.join(source, 'pet.json'));
    assert.ok(manifest.equals(fs.readFileSync(path.join(packaged, 'pet.json'))), `Packaged pet.json differs: ${id}`);
    // loadPet normalizes string frame paths into { src } objects and validates
    // every referenced file. referencedFiles expects that normalized manifest.
    const sourceRecord = loadPet('bundled', source);
    const packagedRecord = loadPet('bundled', packaged);
    assert.deepEqual(sourceRecord.errors, [], `Invalid source pet: ${id}`);
    assert.deepEqual(packagedRecord.errors, [], `Invalid packaged pet: ${id}`);
    assert.ok(sourceRecord.pet && packagedRecord.pet, `Pet could not be loaded: ${id}`);
    const pet = sourceRecord.pet;
    assert.equal(pet.id, id);
    for (const filename of new Set(referencedFiles(pet))) {
      assert.equal(await sha256(path.join(packaged, filename)), await sha256(path.join(source, filename)), `Missing or changed packaged animation: ${id}/${filename}`);
    }
  }
  console.log(`Verified app.asar, resources/pets, and all referenced animations for ${petIds.length} pets (${platform})`);
}

async function stage(tag, platform, dist, output) {
  const names = packageNames(tag, platform);
  // Sidecar YAML, blockmaps, unpacked apps, and builder debug files stay in dist.
  const packages = fs.readdirSync(dist, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(exe|dmg|zip|AppImage|deb)$/i.test(entry.name))
    .map((entry) => entry.name).sort();
  assert.deepEqual(packages, [...names].sort(), `Expected exactly two correctly named packages for ${platform}`);
  for (const name of names) regularFile(path.join(dist, name));
  await verifyPackagedResources(tag, platform, dist);
  emptyDirectory(output);
  for (const name of names) fs.copyFileSync(path.join(dist, name), path.join(output, name), fs.constants.COPYFILE_EXCL);
  console.log(`Staged ${names.length} checked packages for ${platform}`);
}

async function checksumText(directory, names) {
  const lines = [];
  for (const name of [...names].sort()) lines.push(`${await sha256(path.join(directory, name))}  ${name}\n`);
  return lines.join('');
}

async function aggregate(tag, input, output) {
  const names = packageNames(tag);
  const groups = PLATFORMS.map((platform) => `pets-${tag}-${platform}`);
  exactEntries(input, groups, 'directory');
  for (const platform of PLATFORMS) exactEntries(path.join(input, `pets-${tag}-${platform}`), packageNames(tag, platform));
  emptyDirectory(output);
  for (const platform of PLATFORMS) {
    for (const name of packageNames(tag, platform)) {
      fs.copyFileSync(path.join(input, `pets-${tag}-${platform}`, name), path.join(output, name), fs.constants.COPYFILE_EXCL);
    }
  }
  fs.writeFileSync(path.join(output, CHECKSUMS), await checksumText(output, names), { flag: 'wx' });
  exactEntries(output, [...names, CHECKSUMS]);
  console.log(`Verified four platform artifacts and eight packages; wrote ${CHECKSUMS}`);
}

function gh(...args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

function api(endpoint) {
  return JSON.parse(gh('api', endpoint));
}

function pages(endpoint) {
  return JSON.parse(gh('api', '--paginate', '--slurp', `${endpoint}?per_page=100`)).flat();
}

function findRelease(repository, tag) {
  // Listing with the authenticated token also finds drafts. Errors must fail,
  // rather than being mistaken for a release that does not yet exist.
  const matches = pages(`repos/${repository}/releases`).filter((release) => release.tag_name === tag);
  assert.ok(matches.length <= 1, `Multiple releases exist for ${tag}; refuse to choose one`);
  return matches[0];
}

function requireDraft(repository, tag, releaseId) {
  const release = api(`repos/${repository}/releases/${releaseId}`);
  assert.equal(release.tag_name, tag, 'Release tag changed');
  assert.equal(release.draft, true, 'Release is already published; refuse to modify it');
}

function verifyRemoteTag(repository, tag, commit) {
  let object = api(`repos/${repository}/git/ref/tags/${tag}`).object;
  // Support both lightweight and nested annotated tags.
  for (let depth = 0; object.type === 'tag' && depth < 16; depth++) object = api(`repos/${repository}/git/tags/${object.sha}`).object;
  assert.equal(object.type, 'commit', 'The remote tag must resolve to a commit');
  assert.equal(object.sha, commit, 'Remote tag moved since the build; refuse to publish');
}

async function remoteSha256(repository, asset) {
  if (/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? '')) return asset.digest.slice(7);
  // Older draft assets may lack digest metadata: hash the bytes without writing
  // or replacing any release asset, and without buffering an installer in RAM.
  const hash = createHash('sha256');
  const child = spawn('gh', ['api', `repos/${repository}/releases/assets/${asset.id}`, '-H', 'Accept: application/octet-stream'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Could not hash remote asset ${asset.name} (gh exit ${code})`)));
  });
  // Attach a rejection handler immediately while consuming the stream.
  await Promise.all([(async () => { for await (const chunk of child.stdout) hash.update(chunk); })(), done]);
  return hash.digest('hex');
}

async function checkRemoteAssets(repository, releaseId, local, complete) {
  const assets = pages(`repos/${repository}/releases/${releaseId}/assets`);
  const seen = new Set();
  for (const asset of assets) {
    assert.ok(local.has(asset.name) && !seen.has(asset.name), `Unexpected or duplicate draft asset: ${asset.name}`);
    seen.add(asset.name);
    const expected = local.get(asset.name);
    assert.equal(asset.state, 'uploaded', `Incomplete draft asset: ${asset.name}`);
    assert.equal(asset.size, expected.size, `Existing draft asset differs: ${asset.name}; refuse to overwrite`);
    assert.equal(await remoteSha256(repository, asset), expected.hash, `Existing draft asset differs: ${asset.name}; refuse to overwrite`);
  }
  if (complete) assert.equal(seen.size, 9, 'The draft must contain eight packages and SHA256SUMS before publishing');
  return seen;
}

async function publish(tag, directory, expectedCommit) {
  assert.match(expectedCommit ?? '', /^[a-f0-9]{40,64}$/, 'A validated commit SHA is required to publish');
  const commit = verifyTag(tag, expectedCommit);
  const names = packageNames(tag);
  exactEntries(directory, [...names, CHECKSUMS]);
  assert.equal(fs.readFileSync(path.join(directory, CHECKSUMS), 'utf8'), await checksumText(directory, names), 'SHA256SUMS does not match the eight packages');
  assert.ok(process.env.GH_TOKEN, 'GH_TOKEN must be supplied from secrets.GITHUB_TOKEN');
  const repository = process.env.GITHUB_REPOSITORY;
  assert.match(repository ?? '', /^[\w.-]+\/[\w.-]+$/, 'GITHUB_REPOSITORY is required');

  let release = findRelease(repository, tag);
  if (release && !release.draft) {
    console.log(`${tag} is already published; leaving it and all existing assets unchanged`);
    return;
  }
  verifyRemoteTag(repository, tag, commit);
  const local = new Map();
  for (const name of [...names, CHECKSUMS]) {
    const filename = path.join(directory, name);
    local.set(name, { filename, size: regularFile(filename).size, hash: await sha256(filename) });
  }
  if (!release) {
    // Use the create response directly: the releases list may lag behind a
    // successful creation and temporarily omit the new draft.
    const body = {
      tag_name: tag,
      target_commitish: commit,
      name: `Pets ${tag}`,
      body: fs.readFileSync(notesFile(tag), 'utf8'),
      draft: true,
      prerelease: false,
    };
    release = JSON.parse(execFileSync('gh', ['api', '--method', 'POST', `repos/${repository}/releases`, '--input', '-'], {
      input: JSON.stringify(body),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    }));
    assert.ok(release.id, 'Draft creation did not return a release ID');
    assert.equal(release.tag_name, tag, 'Created draft tag differs');
    assert.equal(release.draft, true, 'New release must remain a draft during uploads');
  }
  requireDraft(repository, tag, release.id);
  const existing = await checkRemoteAssets(repository, release.id, local, false);
  for (const [name, asset] of local) {
    if (existing.has(name)) continue;
    requireDraft(repository, tag, release.id);
    // Never use --clobber: a retry may only add missing assets to this draft.
    gh('release', 'upload', tag, asset.filename, '--repo', repository);
  }
  requireDraft(repository, tag, release.id);
  await checkRemoteAssets(repository, release.id, local, true);
  verifyRemoteTag(repository, tag, commit);
  requireDraft(repository, tag, release.id);
  gh('release', 'edit', tag, '--repo', repository, '--verify-tag', '--draft=false', '--title', `Pets ${tag}`, '--notes-file', notesFile(tag));
  console.log(`Published Pets ${tag} with all eight packages and ${CHECKSUMS}`);
}

async function main() {
  const [command, tag, ...args] = process.argv.slice(2);
  packageNames(tag);
  switch (command) {
    case 'verify-tag': {
      assert.ok(args.length <= 1, 'verify-tag <tag> [expected-commit]');
      const commit = verifyTag(tag, args[0]);
      if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `commit=${commit}\n`);
      break;
    }
    case 'stage':
      assert.equal(args.length, 3, 'stage <tag> <platform> <dist-directory> <output-directory>');
      await stage(tag, ...args);
      break;
    case 'verify-package':
      assert.equal(args.length, 2, 'verify-package <tag> <platform> <dist-directory>');
      await verifyPackagedResources(tag, ...args);
      break;
    case 'aggregate':
      assert.equal(args.length, 2, 'aggregate <tag> <download-directory> <output-directory>');
      await aggregate(tag, ...args);
      break;
    case 'publish':
      assert.equal(args.length, 2, 'publish <tag> <package-directory> <expected-commit>');
      await publish(tag, ...args);
      break;
    default:
      throw new Error('Expected verify-tag, verify-package, stage, aggregate, or publish');
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
