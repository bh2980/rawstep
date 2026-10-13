import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectFiles } from '../shared/api.js';

/** Folders that never hold a file a person points a task or plan at: run records, dependencies, version control. */
const SKIPPED = new Set(['.rawstep', 'node_modules', '.git']);
const MAX_FILES = 5000;

/**
 * The project's files, as paths relative to the project folder with forward slashes, sorted. Hidden entries and the skipped folders are
 * left out, symlinks are not followed (so nothing outside the project is listed), and the walk stops at a few thousand files.
 */
export async function listProjectFiles(root: string): Promise<ProjectFiles> {
  const files: string[] = [];
  let truncated = false;
  async function walk(dir: string, prefix: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (files.length >= MAX_FILES) { truncated = true; return; }
      if (entry.name.startsWith('.') || SKIPPED.has(entry.name)) continue;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(dir, entry.name), path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await walk(root, '');
  return { root, files, truncated };
}
