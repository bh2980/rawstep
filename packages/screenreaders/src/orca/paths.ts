import { fileURLToPath } from 'node:url';
/** Resolve package-owned optional bridge source in both checkout and installed builds. */
export function orcaBridgePath(): string { return fileURLToPath(new URL('../../native/orca_bridge.py', import.meta.url)); }
