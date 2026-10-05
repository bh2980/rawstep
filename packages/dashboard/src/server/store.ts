import { readFile, writeFile, rename, mkdir, realpath } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { resolveTask, type Task } from '@rawstep/core/contracts';
import { resolveEnvironmentProfile } from '@rawstep/browser/profiles';
import { modelBaseURL } from '@rawstep/policies/systemone';
import { configSchema, defaultConfig, parseConfig, type DashboardConfig } from '../shared/config.js';

export class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
export async function readOptional(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
}
export async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = path + '.' + randomUUID() + '.tmp';
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(temp, path);
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export class ProjectStore {
  readonly path: string;
  private pending = Promise.resolve();
  constructor(readonly root: string) { this.path = resolve(root, 'rawstep.dashboard.json'); }
  async initialize() {
    await mkdir(this.root, { recursive: true });
    await this.file('rawstep.dashboard.json');
    if (await readOptional(this.path) === undefined) await atomicJson(this.path, defaultConfig());
    return this.read();
  }
  async read() {
    const raw = await readFile(await this.file('rawstep.dashboard.json', true), 'utf8');
    const config = parseConfig(JSON.parse(raw));
    this.validateReferences(config);
    const files = await Promise.all(config.tasks.map(async t => [t.file, digest(await readFile(await this.file(t.file, true), 'utf8'))]));
    return { config, revision: digest(JSON.stringify({ raw, files })) };
  }
  validateReferences(config: DashboardConfig) {
    for (const connection of config.connections) modelBaseURL(connection.baseURL);
    for (const group of [config.connections, config.models, config.tasks, config.profiles]) {
      if (new Set(group.map(x => x.id)).size !== group.length) throw new HttpError(400, 'ID가 중복되었습니다.');
    }
    for (const model of config.models) if (!config.connections.some(c => c.id === model.connectionId)) throw new HttpError(400, '모델의 연결을 찾을 수 없습니다.');
    for (const model of config.models) if (model.family === 'SystemOne' && model.roles.includes('analysis')) throw new HttpError(400, '사후 분석에는 LLM 모델을 선택하세요.');
    if (new Set(config.tasks.map(t => t.file)).size !== config.tasks.length) throw new HttpError(400, '작업 파일 경로가 중복되었습니다.');
    for (const task of config.tasks) for (const mode of Object.values(task.modes)) if (new Set(mode.prompts.map(p => p.id)).size !== mode.prompts.length) throw new HttpError(400, '프롬프트 ID가 중복되었습니다.');
    for (const profile of config.profiles) resolveEnvironmentProfile(profile.environment);
    for (const task of config.tasks) if (task.profileId !== undefined && !config.profiles.some(p => p.id === task.profileId)) throw new HttpError(400, '작업의 실행 프로필을 찾을 수 없습니다.');
  }
  async file(path: string, mustExist = false): Promise<string> {
    const target = resolve(this.root, path), rel = relative(this.root, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new HttpError(400, '프로젝트 내부의 파일 경로가 필요합니다.');
    const root = await realpath(this.root);
    let parent = mustExist ? target : dirname(target);
    for (;;) {
      try { parent = await realpath(parent); break; }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; const next = dirname(parent); if (next === parent) throw e; parent = next; }
    }
    const realRel = relative(root, parent);
    if (realRel.startsWith('..') || isAbsolute(realRel)) throw new HttpError(400, '프로젝트 밖의 심볼릭 링크는 사용할 수 없습니다.');
    if (!mustExist) {
      try { const real = await realpath(target); if (relative(root, real).startsWith('..')) throw new HttpError(400, '외부 파일은 사용할 수 없습니다.'); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    }
    return target;
  }
  async task(file: string): Promise<Task> {
    const path = await this.file(file, true);
    return resolveTask(JSON.parse(await readFile(path, 'utf8')), dirname(path));
  }
  async tasks(config: DashboardConfig): Promise<Record<string, Task>> {
    return Object.fromEntries(await Promise.all(config.tasks.map(async t => [t.id, await this.task(t.file)])));
  }
  async save(value: unknown, revision: string, taskWrite?: { file: string; task: unknown }) {
    const work = this.pending.then(async () => {
      const current = await this.read();
      if (current.revision !== revision) throw new HttpError(409, '설정이 외부 또는 다른 창에서 변경되었습니다. 다시 불러온 뒤 변경을 적용하세요.');
      const config = configSchema.parse(value); this.validateReferences(config);
      if (taskWrite) {
        if (['package.json', 'rawstep.dashboard.json'].includes(taskWrite.file) || taskWrite.file.startsWith('.rawstep/')) throw new HttpError(400, '설정·패키지·실행 기록 파일을 Task로 사용할 수 없습니다.');
        if (!taskWrite.file.endsWith('.json') || !config.tasks.some(t => t.file === taskWrite.file)) throw new HttpError(400, '등록한 Task JSON 경로가 필요합니다.');
        const path = await this.file(taskWrite.file);
        resolveTask(taskWrite.task, dirname(path));
        await this.tasks({ ...config, tasks: config.tasks.filter(t => t.file !== taskWrite.file) });
        if (!current.config.tasks.some(t => t.file === taskWrite.file) && await readOptional(path) !== undefined) throw new HttpError(409, '이 경로의 파일이 이미 있습니다. 기존 JSON 가져오기를 사용하거나 새 경로를 지정하세요.');
        await atomicJson(path, taskWrite.task);
      }
      await this.tasks(config);
      await atomicJson(this.path, config);
      return this.read();
    });
    this.pending = work.then(() => {}, () => {});
    return work;
  }
  async credential(name?: string): Promise<string | undefined> {
    if (!name) return;
    const file = await readOptional(await this.file('.env.local')) ?? '';
    const line = file.split(/\r?\n/).find(v => v.startsWith(name + '='));
    if (line) { try { const value: unknown = JSON.parse(line.slice(name.length + 1)); if (typeof value === 'string') return value; } catch {} }
    return parseEnv(file)[name] ?? process.env[name];
  }
  async setCredential(name: string, value: string) {
    if (!/^[A-Z][A-Z0-9_]{0,100}$/.test(name) || !value.trim() || value.length > 16384 || /[\r\n]/.test(value)) throw new HttpError(400, '인증키 형식이 잘못되었습니다.');
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
