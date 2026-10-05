import { readFile, writeFile, rename, mkdir, realpath } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { resolveTask, type Task } from '@rawstep/core/contracts';
import { resolveEnvironmentProfile } from '@rawstep/browser/profiles';
import { modelBaseURL } from '@rawstep/policies/systemone';
import { CONFIG_FILE, configSchema, defaultConfig, parseConfig, type ProjectConfig } from './config.js';
import { ProjectError } from './errors.js';

export async function readOptional(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
}
export async function atomicJson(path: string, value: unknown, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = path + '.' + randomUUID() + '.tmp';
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode });
  await rename(temp, path);
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const NO_CONFIG = `${CONFIG_FILE} was not found. Create it with \`rawstep init\` or \`rawstep ui\`.`;

/** Writes a default rawstep.config.json into `root`; an existing file is never replaced. Returns its path. */
export async function initProject(root: string): Promise<string> {
  const path = resolve(root, CONFIG_FILE);
  await mkdir(root, { recursive: true });
  try { await writeFile(path, JSON.stringify(defaultConfig(), null, 2) + '\n', { flag: 'wx' }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new ProjectError('config-exists', `${CONFIG_FILE} already exists in ${root}; it was not overwritten.`, 409); throw e; }
  return path;
}

/** The project directory on disk: rawstep.config.json, the task files it lists and credentials in .env.local. */
export class ProjectStore {
  readonly path: string;
  private pending = Promise.resolve();
  constructor(readonly root: string) { this.path = resolve(root, CONFIG_FILE); }
  /** Reads the config, creating a default one when the project has none yet (the dashboard does this; the CLI does not). */
  async initialize() {
    await mkdir(this.root, { recursive: true });
    await this.file(CONFIG_FILE);
    if (await readOptional(this.path) === undefined) await atomicJson(this.path, defaultConfig(), 0o644);
    return this.read();
  }
  async read() {
    let raw: string;
    try { raw = await readFile(await this.file(CONFIG_FILE, true), 'utf8'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new ProjectError('no-config', NO_CONFIG, 404); throw e; }
    let config: ProjectConfig;
    try { config = parseConfig(JSON.parse(raw)); }
    catch (e) { throw new ProjectError('invalid-config', `${CONFIG_FILE} is not valid: ${e instanceof Error ? e.message : String(e)}`); }
    this.validateReferences(config);
    const files = await Promise.all(config.tasks.map(async t => [t.file, digest(await this.taskSource(t.file))]));
    return { config, revision: digest(JSON.stringify({ raw, files })) };
  }
  validateReferences(config: ProjectConfig) {
    for (const connection of config.connections) modelBaseURL(connection.baseURL);
    for (const group of [config.connections, config.models, config.tasks, config.profiles]) {
      if (new Set(group.map(x => x.id)).size !== group.length) throw new ProjectError('duplicate-id', 'IDs must be unique.');
    }
    for (const model of config.models) if (!config.connections.some(c => c.id === model.connectionId)) throw new ProjectError('model-connection-missing', 'A model refers to a connection that does not exist.');
    for (const model of config.models) if (model.family === 'SystemOne' && model.roles.includes('analysis')) throw new ProjectError('analysis-needs-llm', 'Post-run analysis needs an LLM model.');
    if (new Set(config.tasks.map(t => t.file)).size !== config.tasks.length) throw new ProjectError('duplicate-task-file', 'Task file paths must be unique.');
    for (const task of config.tasks) for (const mode of Object.values(task.modes)) if (new Set(mode.prompts.map(p => p.id)).size !== mode.prompts.length) throw new ProjectError('duplicate-prompt-id', 'Prompt IDs must be unique within a task mode.');
    for (const profile of config.profiles) resolveEnvironmentProfile(profile.environment);
    for (const task of config.tasks) if (task.profileId !== undefined && !config.profiles.some(p => p.id === task.profileId)) throw new ProjectError('task-profile-missing', 'A task refers to a run profile that does not exist.');
  }
  /** Resolves a project-relative path and refuses anything that leaves the project, including through symlinks. */
  async file(path: string, mustExist = false): Promise<string> {
    const target = resolve(this.root, path), rel = relative(this.root, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new ProjectError('path-outside-project', 'A file path inside the project is required.');
    const root = await realpath(this.root);
    let parent = mustExist ? target : dirname(target);
    for (;;) {
      try { parent = await realpath(parent); break; }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; const next = dirname(parent); if (next === parent) throw e; parent = next; }
    }
    const realRel = relative(root, parent);
    if (realRel.startsWith('..') || isAbsolute(realRel)) throw new ProjectError('symlink-outside-project', 'Symbolic links that leave the project are not allowed.');
    if (!mustExist) {
      try { const real = await realpath(target); if (relative(root, real).startsWith('..')) throw new ProjectError('symlink-outside-project', 'Files outside the project are not allowed.'); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    }
    return target;
  }
  private async taskSource(file: string): Promise<string> {
    try { return await readFile(await this.file(file, true), 'utf8'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new ProjectError('task-file-missing', `Task file ${file} was not found.`, 404); throw e; }
  }
  async task(file: string): Promise<Task> {
    const source = await this.taskSource(file), path = await this.file(file, true);
    return resolveTask(JSON.parse(source), dirname(path));
  }
  async tasks(config: ProjectConfig): Promise<Record<string, Task>> {
    return Object.fromEntries(await Promise.all(config.tasks.map(async t => [t.id, await this.task(t.file)])));
  }
  async save(value: unknown, revision: string, taskWrite?: { file: string; task: unknown }) {
    const work = this.pending.then(async () => {
      const current = await this.read();
      if (current.revision !== revision) throw new ProjectError('config-conflict', 'The configuration was changed outside this window. Reload it and apply your change again.', 409);
      const config = configSchema.parse(value); this.validateReferences(config);
      if (taskWrite) {
        if (['package.json', CONFIG_FILE].includes(taskWrite.file) || taskWrite.file.startsWith('.rawstep/')) throw new ProjectError('task-file-reserved', 'Configuration, package and run files cannot be used as a task.');
        if (!taskWrite.file.endsWith('.json') || !config.tasks.some(t => t.file === taskWrite.file)) throw new ProjectError('task-file-not-registered', 'A registered task JSON path is required.');
        const path = await this.file(taskWrite.file);
        resolveTask(taskWrite.task, dirname(path));
        await this.tasks({ ...config, tasks: config.tasks.filter(t => t.file !== taskWrite.file) });
        if (!current.config.tasks.some(t => t.file === taskWrite.file) && await readOptional(path) !== undefined) throw new ProjectError('task-file-exists', 'A file already exists at this path. Import the existing JSON or choose a new path.', 409);
        await atomicJson(path, taskWrite.task, 0o644);
      }
      await this.tasks(config);
      await atomicJson(this.path, config, 0o644);
      return this.read();
    });
    this.pending = work.then(() => {}, () => {});
    return work;
  }
  /** The key stored in .env.local under `name`, otherwise the process environment. Never part of any config response. */
  async credential(name?: string): Promise<string | undefined> {
    if (!name) return;
    const file = await readOptional(await this.file('.env.local')) ?? '';
    const line = file.split(/\r?\n/).find(v => v.startsWith(name + '='));
    if (line) { try { const value: unknown = JSON.parse(line.slice(name.length + 1)); if (typeof value === 'string') return value; } catch {} }
    return parseEnv(file)[name] ?? process.env[name];
  }
  async setCredential(name: string, value: string) {
    if (!/^[A-Z][A-Z0-9_]{0,100}$/.test(name) || !value.trim() || value.length > 16384 || /[\r\n]/.test(value)) throw new ProjectError('invalid-credential', 'The credential name or value is not valid.');
    const work = this.pending.then(async () => {
      const path = await this.file('.env.local');
      const lines = (await readOptional(path) ?? '').split(/\r?\n/).filter(l => !l.startsWith(name + '='));
      lines.push(name + '=' + JSON.stringify(value));
      const temp = path + '.' + randomUUID() + '.tmp';
      await writeFile(temp, lines.join('\n') + '\n', { mode: 0o600 }); await rename(temp, path);
    });
    this.pending = work.then(() => {}, () => {}); return work;
  }
}
