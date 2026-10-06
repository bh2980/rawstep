import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * Resolve the bundled bridge source in a checkout (`packages/screenreaders/native`) and in the single `rawstep`
 * package (`native/` next to `dist/`, whichever chunk this code was bundled into).
 */
export function orcaBridgePath(): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 4; depth++, directory = dirname(directory)) {
    const candidate = join(directory, 'native', 'orca_bridge.py');
    if (existsSync(candidate)) return candidate;
  }
  return fileURLToPath(new URL('../../native/orca_bridge.py', import.meta.url));
}
