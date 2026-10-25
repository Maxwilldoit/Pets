// 把导出的 Codex 宠物装进 Codex 的宠物目录（${CODEX_HOME:-~/.codex}/pets/<文件夹>/）。
// 不依赖 Electron，方便单元测试。Codex 通过 `custom:<文件夹名>` 引用自定义宠物。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const EXPORT_MARKER = '.pets-export.json';
const MAX_BYTES = 30 * 1024 * 1024;

export function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

export function codexPetsDir() {
  return path.join(codexHome(), 'pets');
}

/** 目录是不是由 Pets 导出的（带标记文件）。 */
export function isPetsExport(dir) {
  return fs.existsSync(path.join(dir, EXPORT_MARKER));
}

/** 已导出到 Codex 的宠物：来源 key → { folder, exportedAt }。 */
export function listExports(petsDir = codexPetsDir()) {
  const out = new Map();
  if (!fs.existsSync(petsDir)) return out;
  for (const d of fs.readdirSync(petsDir, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('.')) continue;
    try {
      const marker = JSON.parse(fs.readFileSync(path.join(petsDir, d.name, EXPORT_MARKER), 'utf8'));
      if (typeof marker.sourceKey === 'string') out.set(marker.sourceKey, { folder: d.name, exportedAt: marker.exportedAt });
    } catch {
      // 不是我们导出的
    }
  }
  return out;
}

const isWebp = (b) =>
  b.length > 16 && String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP';

/**
 * 写入（或更新）Codex 宠物。只会覆盖 Pets 自己导出过的文件夹；
 * 同名但不是我们导出的文件夹会被保留，改用 <id>-2、<id>-3…
 * @returns {{ok: true, folder: string, dir: string, avatarId: string} | {ok: false, error: string, code: string, path?: string}}
 */
export function installCodexPet({ petsDir = codexPetsDir(), sourceKey, pet, bytes, fsOps = fs }) {
  if (!(bytes instanceof Uint8Array) || !isWebp(bytes) || bytes.length > MAX_BYTES) {
    return { ok: false, code: 'INVALID_ATLAS', error: '精灵图数据无效' };
  }
  fsOps.mkdirSync(petsDir, { recursive: true });
  let folder = listExports(petsDir).get(sourceKey)?.folder;
  if (!folder) {
    folder = pet.id;
    for (let i = 2; fsOps.existsSync(path.join(petsDir, folder)); i++) folder = `${pet.id}-${i}`;
  }
  const dest = path.join(petsDir, folder);
  // 先写到临时文件夹（pet.json 最后写），再整体改名，Codex 不会读到写了一半的宠物
  const suffix = `${process.pid}-${Date.now()}`;
  const tmp = path.join(petsDir, `.${folder}.tmp-${suffix}`);
  const backup = path.join(petsDir, `.${folder}.backup-${suffix}`);
  let movedOld = false;
  fsOps.mkdirSync(tmp);
  try {
    fsOps.writeFileSync(path.join(tmp, 'spritesheet.webp'), bytes);
    const marker = { exportedBy: 'Pets', sourceKey, sourceId: pet.id, exportedAt: new Date().toISOString() };
    fsOps.writeFileSync(path.join(tmp, EXPORT_MARKER), JSON.stringify(marker, null, 2));
    const manifest = { id: folder, displayName: pet.name, description: pet.description || pet.name, spritesheetPath: 'spritesheet.webp' };
    fsOps.writeFileSync(path.join(tmp, 'pet.json'), JSON.stringify(manifest, null, 2));
    if (fsOps.existsSync(dest)) {
      if (!isPetsExport(dest)) throw Object.assign(new Error(`目标文件夹不是 Pets 导出的：${dest}`), { code: 'FOREIGN_EXPORT', path: dest });
      // Move the old export aside first. If installing the new export fails,
      // put the old one back instead of leaving the user with neither version.
      fsOps.renameSync(dest, backup);
      movedOld = true;
    }
    try {
      fsOps.renameSync(tmp, dest);
    } catch (error) {
      if (movedOld) {
        try {
          fsOps.renameSync(backup, dest);
          movedOld = false;
        } catch (rollbackError) {
          error.message = `${error.message}；旧版本保留在 ${backup}，恢复失败：${rollbackError.message}`;
          error.backupPath = backup;
        }
      }
      throw error;
    }
    if (movedOld) {
      try {
        fsOps.rmSync(backup, { recursive: true, force: true });
      } catch {
        // The new export is already complete; an old backup is safer than a
        // failed-looking install and can be removed by a later update.
      }
    }
  } catch (e) {
    try { fsOps.rmSync(tmp, { recursive: true, force: true }); } catch {}
    return {
      ok: false,
      code: e.code === 'FOREIGN_EXPORT' ? e.code : 'INSTALL_FAILED',
      error: e.message,
      ...(e.code === 'FOREIGN_EXPORT' ? { path: e.path } : {}),
      ...(e.backupPath ? { backupPath: e.backupPath } : {}),
    };
  }
  return { ok: true, folder, dir: dest, avatarId: `custom:${folder}` };
}
