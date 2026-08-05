/**
 * Atomic JSON file writer.
 * Writes to a temp file first, then renames over the target so a crash
 * mid-write never leaves the target file truncated or corrupted.
 */
import { writeFileSync, renameSync, mkdirSync } from 'fs';
import { dirname } from 'path';

/**
 * Atomically write `data` as pretty-printed JSON to `filePath`.
 * On POSIX systems rename() is atomic when src and dst are on the same
 * filesystem (the common case for a single-machine deployment).
 *
 * @param {string} filePath  Destination file path.
 * @param {unknown} data     Value to serialise.
 */
export function atomicWriteJSON(filePath, data) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  renameSync(tmp, filePath);
}
