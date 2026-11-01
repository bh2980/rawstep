import { readFile, readdir, stat, writeFile, rename, mkdir, realpath, unlink } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { resolveTask, type Task } from '@rawstep/core/contracts';
import { resolveEnvironmentProfile } from '@rawstep/browser/profiles';
import { modelBaseURL } from '@rawstep/policies/llm';
import { CONFIG_FILE, KEYED_PROVIDERS, configProblems, configSchema, credentialId, defaultConfig, modelKeyEnvNames, parseConfig, type Connection, type ProjectConfig, type ProviderId } from './config.js';
import { DEMO_FILES, demoConfig } from './demo.js';
export { DEMO_DIR, demoConfig, findAgentCli } from './demo.js';
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
/** Why one registered task cannot be used: a problem of that task alone, which never keeps the rest of the project from working. */
export type TaskProblem = { code: string; message: string };

/**
 * Writes rawstep.config.json into `root` with the demo task and its files (see `demoConfig`); an existing config is never replaced,
 * and demo files already there are kept. Returns the config's path.
 */
export async function initProject(root: string): Promise<string> {
  const path = resolve(root, CONFIG_FILE);
  await mkdir(root, { recursive: true });
  try { await writeFile(path, JSON.stringify(demoConfig(), null, 2) + '\n', { flag: 'wx' }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new ProjectError('config-exists', `${CONFIG_FILE} already exists in ${root}; it was not overwritten.`, 409); throw e; }
  for (const [file, content] of Object.entries(DEMO_FILES)) {
    const target = resolve(root, file);
    await mkdir(dirname(target), { recursive: true });
    try { await writeFile(target, content, { flag: 'wx' }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  }
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
    let json: unknown;
    try { json = JSON.parse(raw); } catch (e) { throw new ProjectError('invalid-config', `${CONFIG_FILE} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`); }
    const version = json && typeof json === 'object' ? (json as { version?: unknown }).version : undefined;
    if (typeof version === 'number' && Number.isInteger(version) && version >= 1 && version <= 6) throw new ProjectError('old-config', `${CONFIG_FILE} is version ${version}, which this Rawstep does not read. Start a new project with \`rawstep init\` and copy the tasks over.`);
    try { config = parseConfig(json); }
    catch (e) { throw new ProjectError('invalid-config', e instanceof ZodError ? configProblems(e, json).join('\n') : `${CONFIG_FILE} is not valid: ${e instanceof Error ? e.message : String(e)}`); }
    this.validateReferences(config);
    // The revision changes when a task file does. A file that cannot be read is a problem of its task only, and the revision still
    // moves when it appears or breaks differently.
    const taskProblems: Record<string, TaskProblem> = {};
    const files = await Promise.all(config.tasks.map(async t => {
      try { return [t.file, digest(await this.taskSource(t.file))]; }
      catch (e) {
        const problem = { code: (e as ProjectError).code, message: (e as ProjectError).message };
        taskProblems[t.id] = problem;
        return [t.file, digest('problem:' + problem.code)];
      }
    }));
    return { config, revision: digest(JSON.stringify({ raw, files })), taskProblems };
  }
  validateReferences(config: ProjectConfig) {
    for (const connection of config.connections) if (connection.baseURL) modelBaseURL(connection.baseURL);
    for (const group of [config.connections, config.tasks, config.profiles]) {
      if (new Set(group.map(x => x.id)).size !== group.length) throw new ProjectError('duplicate-id', 'IDs must be unique.');
    }
    const known = (connectionId: string) => config.connections.some(c => c.id === connectionId);
    for (const profile of config.profiles) {
      if (profile.planner && !('planFile' in profile.planner) && !known(profile.planner.connectionId)) throw new ProjectError('profile-connection-missing', 'A profile plans with a connection that does not exist.');
      resolveEnvironmentProfile(profile.page);
    }
    if (config.project.analysis.model && !known(config.project.analysis.model.connectionId)) throw new ProjectError('analysis-connection-missing', 'Post-run analysis uses a connection that does not exist.');
    if (new Set(config.tasks.map(t => t.file)).size !== config.tasks.length) throw new ProjectError('duplicate-task-file', 'Task file paths must be unique.');
    const byId = new Map(config.tasks.map(t => [t.id, t]));
    for (const task of config.tasks) if (task.variantOf !== undefined) {
      const base = byId.get(task.variantOf);
      if (!base || base.id === task.id || base.variantOf !== undefined) throw new ProjectError('task-variant-invalid', 'A variant must point at another task that is not a variant itself.');
    }
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
    catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new ProjectError('task-file-missing', `Task file ${file} was not found.`, 404);
      if (e instanceof ProjectError) throw new ProjectError(e.code, `Task file ${file}: ${e.message}`, e.status);
      throw new ProjectError('task-file-unreadable', `Task file ${file} could not be read: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  /** A task file's JSON, or the reason it is not valid JSON. */
  private async taskJson(file: string): Promise<unknown> {
    const source = await this.taskSource(file);
    try { return JSON.parse(source); } catch (e) { throw new ProjectError('invalid-task', `Task file ${file} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`); }
  }
  /** Registered tasks resolve relative start URLs (project HTML files) against the project root, as the dashboard describes them. */
  async task(file: string): Promise<Task> {
    return resolveTask(await this.taskJson(file), this.root);
  }
  /**
   * Task JSON files already in the project that are not registered yet, so a person can pick one instead of typing its path.
   * A file counts when it parses as a task; dependency, build and run-output folders are skipped, and the walk is bounded.
   */
  async findTaskFiles(config: ProjectConfig): Promise<{ file: string; goal: string; url: string }[]> {
    const registered = new Set(config.tasks.map(t => t.file)), found: { file: string; goal: string; url: string }[] = [];
    const skip = new Set(['node_modules', '.git', '.rawstep', 'dist', 'build', 'coverage', '.next', '.turbo', '.cache']);
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 5 || found.length >= 200) return;
      let entries; try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('.')) continue;
        const path = resolve(dir, entry.name), rel = relative(this.root, path).split('\\').join('/');
        if (entry.isDirectory()) { if (!skip.has(entry.name)) await walk(path, depth + 1); continue; }
        if (!entry.isFile() || !entry.name.endsWith('.json') || registered.has(rel) || /^(package(-lock)?|tsconfig.*|rawstep\.config)\.json$/.test(entry.name)) continue;
        try {
          if ((await stat(path)).size > 256 * 1024) continue;
          const json: unknown = JSON.parse(await readFile(path, 'utf8'));
          const task = resolveTask(json, this.root), raw = json as { url?: unknown };
          found.push({ file: rel, goal: task.goal, url: typeof raw.url === 'string' ? raw.url : task.url });
        } catch { /* not a task file */ }
      }
    };
    await walk(this.root, 0);
    return found.sort((a, b) => a.file.localeCompare(b.file));
  }
  /**
   * Each registered task's JSON as written in its file, for editing: relative URLs and omitted defaults stay as
   * they are, so saving an edit never bakes machine paths or defaults into the file. A task whose file is missing or
   * not a valid task is left out (see `read().taskProblems`): one broken task does not hide the others.
   */
  async taskFiles(config: ProjectConfig): Promise<Record<string, unknown>> {
    return Object.fromEntries((await Promise.all(config.tasks.map(async t => {
      try { const json = await this.taskJson(t.file); resolveTask(json, this.root); return [t.id, json] as const; } catch { return undefined; }
    }))).filter((entry): entry is readonly [string, unknown] => !!entry));
  }
  /** The resolved task of each registered task id; a task that cannot be read or resolved is left out, and `task(file)` says why. */
  async tasks(config: ProjectConfig): Promise<Record<string, Task>> {
    return Object.fromEntries((await Promise.all(config.tasks.map(async t => {
      try { return [t.id, await this.task(t.file)] as const; } catch { return undefined; }
    }))).filter((entry): entry is readonly [string, Task] => !!entry));
  }
  async save(value: unknown, revision: string, taskWrite?: { file: string; task: unknown }) {
    const work = this.pending.then(async () => {
      const current = await this.read();
      if (current.revision !== revision) throw new ProjectError('config-conflict', 'The configuration was changed outside this window. Reload it and apply your change again.', 409);
      const config = configSchema.parse(value); this.validateReferences(config);
      // A task being added needs a usable file; tasks that were already registered are not this save's business.
      const checkAdded = async () => { for (const added of config.tasks) if (added.file !== taskWrite?.file && !current.config.tasks.some(t => t.file === added.file)) await this.task(added.file); };
      if (!taskWrite) await checkAdded();
      else {
        if (['package.json', CONFIG_FILE].includes(taskWrite.file) || taskWrite.file.startsWith('.rawstep/')) throw new ProjectError('task-file-reserved', 'Configuration, package and run files cannot be used as a task.');
        if (!taskWrite.file.endsWith('.json') || !config.tasks.some(t => t.file === taskWrite.file)) throw new ProjectError('task-file-not-registered', 'A registered task JSON path is required.');
        const path = await this.file(taskWrite.file);
        resolveTask(taskWrite.task, this.root);
        await checkAdded();
        if (!current.config.tasks.some(t => t.file === taskWrite.file) && await readOptional(path) !== undefined) throw new ProjectError('task-file-exists', 'A file already exists at this path. Import the existing JSON or choose a new path.', 409);
        await atomicJson(path, taskWrite.task, 0o644);
      }
      await atomicJson(this.path, config, 0o644);
      return this.read();
    });
    this.pending = work.then(() => {}, () => {});
    return work;
  }
  /**
   * Removes a task from rawstep.config.json and deletes its Task JSON when that file is inside `tasks/`, where Rawstep puts the files
   * it writes. A task linked from another project path is only unregistered: that file is the person's own. Run records under
   * `.rawstep/` are never touched. Fails with `config-conflict` when the revision is stale.
   */
  async deleteTask(taskId: string, revision: string): Promise<{ state: Awaited<ReturnType<ProjectStore['read']>>; file: string; fileRemoved: boolean }> {
    const work = this.pending.then(async () => {
      const current = await this.read();
      if (current.revision !== revision) throw new ProjectError('config-conflict', 'The configuration was changed outside this window. Reload it and apply your change again.', 409);
      const task = current.config.tasks.find(t => t.id === taskId);
      if (!task) throw new ProjectError('task-not-found', `There is no task "${taskId}" in ${CONFIG_FILE}.`, 404);
      // Its variants stay as tasks of their own.
      const tasks = current.config.tasks.filter(t => t.id !== taskId).map(({ variantOf, ...rest }) => variantOf === taskId ? rest : { ...rest, ...(variantOf ? { variantOf } : {}) });
      const config = { ...current.config, tasks };
      this.validateReferences(config);
      await atomicJson(this.path, config, 0o644);
      let fileRemoved = false;
      if (task.file.startsWith('tasks/') && task.file.endsWith('.json') && !current.config.tasks.some(t => t.id !== taskId && t.file === task.file)) {
        // The task is already gone from the config; a file that cannot be removed simply stays.
        try { await unlink(await this.file(task.file, true)); fileRemoved = true; } catch { /* kept */ }
      }
      return { state: await this.read(), file: task.file, fileRemoved };
    });
    this.pending = work.then(() => {}, () => {});
    return work;
  }
  /**
   * The environment variables a credential target reads, in order: a preset provider's own `RAWSTEP_*` one, then the provider's standard
   * ones (`OPENAI_API_KEY`, ...), or the one variable a custom connection names. The first is where a key is written.
   */
  private envNames(target: ProviderId | Pick<Connection, 'provider' | 'apiKeyEnv'>): string[] {
    if (typeof target !== 'string') return modelKeyEnvNames(target);
    const preset = KEYED_PROVIDERS.find(p => p.provider === target);
    return preset ? [preset.keyEnv, ...preset.keyEnvAliases] : [];
  }
  /**
   * The key of a provider (`'openai'`, `'anthropic'`, ...) or of one connection (a custom connection has its own variable) with the
   * variable it came from: the value stored in .env.local, otherwise the process environment, for the provider's `RAWSTEP_*` variable
   * first and its standard one after. Never part of any config response.
   */
  async credentialSource(target: ProviderId | Pick<Connection, 'provider' | 'apiKeyEnv'>): Promise<{ env: string; value: string } | undefined> {
    for (const env of this.envNames(target)) { const value = await this.localValue(env); if (value) return { env, value }; }
    return undefined;
  }
  /** The key of a provider or connection (see `credentialSource`). */
  async credential(target: ProviderId | Pick<Connection, 'provider' | 'apiKeyEnv'>): Promise<string | undefined> {
    return (await this.credentialSource(target))?.value;
  }
  /** A value this computer keeps out of the shared config: .env.local first, then the process environment. */
  async localValue(name: string): Promise<string | undefined> {
    const file = await readOptional(await this.file('.env.local')) ?? '';
    const line = file.split(/\r?\n/).find(v => v.startsWith(name + '='));
    if (line) { try { const value: unknown = JSON.parse(line.slice(name.length + 1)); if (typeof value === 'string') return value; } catch {} }
    return parseEnv(file)[name] ?? process.env[name];
  }
  /** Whether each key the config can use is set, by `credentialId`: one entry per preset provider, one per custom connection with a key variable. */
  async credentialStatus(config: Pick<ProjectConfig, 'connections'>): Promise<Record<string, boolean>> {
    const entries: [string, Promise<string | undefined>][] = KEYED_PROVIDERS.map(p => [`provider:${p.provider}`, this.credential(p.provider)]);
    for (const connection of config.connections) if (connection.provider === 'custom' && connection.apiKeyEnv) entries.push([credentialId(connection), this.credential(connection)]);
    return Object.fromEntries(await Promise.all(entries.map(async ([id, value]) => [id, !!await value])));
  }
  async setCredential(target: ProviderId | Pick<Connection, 'provider' | 'apiKeyEnv'>, value: string) {
    const name = this.envNames(target)[0];
    if (!name) throw new ProjectError('credential-target', 'This provider or model has no key variable to store a key in. Give the custom connection an environment variable name first.');
    if (!value.trim()) throw new ProjectError('invalid-credential', 'The credential name or value is not valid.');
    return this.setLocalValue(name, value);
  }
  /** Writes (or, with an empty value, removes) a value in .env.local, which is never committed. */
  async setLocalValue(name: string, value: string) {
    if (!/^[A-Z][A-Z0-9_]{0,100}$/.test(name) || value.length > 16384 || /[\r\n]/.test(value)) throw new ProjectError('invalid-credential', 'The credential name or value is not valid.');
    const work = this.pending.then(async () => {
      const path = await this.file('.env.local');
      const lines = (await readOptional(path) ?? '').split(/\r?\n/).filter(l => l && !l.startsWith(name + '='));
      if (value.trim()) lines.push(name + '=' + JSON.stringify(value));
      const temp = path + '.' + randomUUID() + '.tmp';
      await writeFile(temp, lines.join('\n') + '\n', { mode: 0o600 }); await rename(temp, path);
    });
    this.pending = work.then(() => {}, () => {}); return work;
  }
}
