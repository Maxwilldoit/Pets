import path from 'node:path';

/** Build the same login-item options for registration and removal. */
export function loginItemOptions({
  packaged,
  platform,
  execPath,
  appRoot,
  portableExecutableFile,
}) {
  if (!packaged) return { path: execPath, args: [appRoot] };
  // electron-builder's portable launcher extracts the app into a temporary
  // directory and deletes it on exit. Register the downloaded launcher instead.
  if (platform === 'win32' && typeof portableExecutableFile === 'string' && path.win32.isAbsolute(portableExecutableFile)) {
    return { path: portableExecutableFile };
  }
  return {};
}
