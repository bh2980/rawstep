#!/usr/bin/env node
/**
 * Pack the single `rawstep` package and install ONLY that tarball (with npm) into a clean project outside the checkout,
 * then exercise it the way a user would: CLI, dashboard, imports and a TypeScript consumer.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { access, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { packRawstep } from './pack-rawstep.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm', npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const directory = await mkdtemp(join(tmpdir(), 'rawstep-package-smoke-'));
const environment = { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1', npm_config_cache: process.env.RAWSTEP_SMOKE_NPM_CACHE ? resolve(process.env.RAWSTEP_SMOKE_NPM_CACHE) : join(directory, '.npm-cache') };
for (const key of Object.keys(environment)) if (/^(?:AI_|OPENAI_|ANTHROPIC_|AZURE_OPENAI_|GOOGLE_API_KEY$|GEMINI_API_KEY$)/.test(key)) delete environment[key];
const command = (bin, args, cwd = directory) => execFileSync(bin, args, { cwd, encoding: 'utf8', env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
const exists = async path => access(path).then(() => true, () => false);
const checks = [];
const check = (name) => checks.push(name);

/** Start `rawstep ui`, wait for its address, run `inspect`, then stop it (the process never outlives this call). */
async function freePort() {
  const probe = createServer();
  await new Promise(done => probe.listen(0, '127.0.0.1', done));
  const { port } = probe.address();
  await new Promise(done => probe.close(done));
  return port;
}
async function withDashboard(inspect) {
  const child = spawn(join(directory, 'node_modules/.bin/rawstep'), ['ui', '--port', String(await freePort())], { cwd: directory, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  const exited = new Promise(done => child.once('exit', done));
  try {
    const url = await new Promise((accept, reject) => {
      const timer = setTimeout(() => reject(new Error(`rawstep ui did not start in time.\n${output}${errors}`)), 20_000);
      child.stdout.on('data', chunk => { output += chunk; const match = output.match(/Rawstep dashboard: (http:\/\/\S+)/); if (match) { clearTimeout(timer); accept(match[1]); } });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`rawstep ui exited early (${code}).\n${output}${errors}`)); });
    });
    await inspect(url.replace(/\/$/, ''));
  } finally {
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    await exited; clearTimeout(timer);
  }
}

try {
  // 1. Build and pack: only the rawstep tarball exists.
  const pack = await packRawstep(directory, { environment });
  const unexpected = pack.files.filter(file => !/^(?:dist\/|native\/[^/]+\.py$|README(?:\.ko)?\.md$|LICENSE$|package\.json$|docs\/[^/]+\.md$|examples\/|fixtures\/)/.test(file.path) || /(?:node_modules|packages\/|\.safetensors$|\.gguf$|\.onnx$|\.node$|\.wasm$|__pycache__)/.test(file.path));
  assert.deepEqual(unexpected, [], 'unexpected files in the tarball');
  for (const required of ['dist/index.js', 'dist/index.d.ts', 'dist/cli/bin.js', 'dist/dashboard-web/index.html', 'native/orca_bridge.py', 'docs/cli.md', 'fixtures/simple-cta.html', 'examples/v2/mock-task.json']) assert.ok(pack.files.some(file => file.path === required), `tarball is missing ${required}`);
  assert.ok(pack.files.some(file => /^dist\/dashboard-web\/assets\/.+\.js$/.test(file.path)), 'tarball is missing the dashboard JS bundle');
  assert.deepEqual(Object.keys(pack.manifest.dependencies).sort(), ['@ai-sdk/openai-compatible', 'ai', 'playwright', 'zod']);
  check('tarball contents and third-party-only dependency list');

  // 2. Install only that tarball.
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'rawstep-isolated-smoke', private: true, type: 'module' }));
  const installArgs = ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--package-lock=false', pack.path];
  if (process.env.RAWSTEP_SMOKE_OFFLINE === '1') installArgs.push('--offline');
  command(npm, installArgs);
  assert.equal(await exists(join(directory, 'node_modules/@rawstep')), false, 'a @rawstep/* package was installed');
  for (const name of await readdir(join(directory, 'node_modules'))) assert.ok(!name.startsWith('@rawstep'), `@rawstep scope installed: ${name}`);
  const installed = JSON.parse(await readFile(join(directory, 'node_modules/rawstep/package.json'), 'utf8'));
  assert.equal(installed.name, 'rawstep');
  assert.doesNotMatch(JSON.stringify(installed), /@rawstep\//);
  // The bundle imports nothing but Node built-ins and the declared third-party dependencies.
  const sources = async (dir) => (await readdir(dir, { withFileTypes: true, recursive: true })).filter(entry => entry.isFile() && /\.(?:js|d\.ts)$/.test(entry.name) && !entry.parentPath.includes('dashboard-web')).map(entry => join(entry.parentPath, entry.name));
  const allowed = new Set(['ai', '@ai-sdk/openai-compatible', 'playwright', 'zod']);
  for (const file of await sources(join(directory, 'node_modules/rawstep/dist'))) {
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(/^(?:import|export)\b[^;\n]*?\bfrom\s*["']([^"']+)["']|^import\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/gm)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (specifier.startsWith('.') || specifier.startsWith('/')) continue;
      if (specifier.startsWith('node:')) continue;
      const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
      assert.ok(allowed.has(name), `${file} imports ${specifier}`);
    }
  }
  check('only the rawstep tarball installed; no @rawstep/* anywhere; bundle imports only declared dependencies');

  // 3. CLI: help, version, init.
  assert.match(command(npx, ['--no-install', 'rawstep', '--help']), /rawstep\.config\.json/);
  assert.equal(command(npx, ['--no-install', 'rawstep', '--version']).trim(), installed.version);
  assert.match(command(npx, ['--no-install', 'rawstep', 'init']), /Created .*rawstep\.config\.json/);
  assert.equal(JSON.parse(await readFile(join(directory, 'rawstep.config.json'), 'utf8')).version, 1);
  assert.throws(() => command(npx, ['--no-install', 'rawstep', 'init']), /already exists/);
  check('npx rawstep --help / --version / init');

  // 4. Dashboard: start, fetch index.html and an asset, stop.
  await withDashboard(async url => {
    const page = await fetch(url); assert.equal(page.status, 200);
    const html = await page.text(); assert.match(html, /<div id="root"/);
    const asset = html.match(/(?:src|href)="([^"]+\.(?:js|css))"/)?.[1]; assert.ok(asset, 'index.html references no asset');
    const response = await fetch(new URL(asset, url + '/')); assert.equal(response.status, 200);
    assert.ok((await response.text()).length > 500);
    assert.equal((await fetch(url + '/api/state')).status, 200);
  });
  check('rawstep ui serves index.html, an asset and /api/state, then stops');

  // 5. Imports (root, advanced subpaths and every export-map entry) resolve from the installed package.
  const exportedModules = Object.keys(installed.exports).filter(name => name !== './package.json');
  assert.deepEqual(['./project', './hints', './runner', './screenshot', './systemone', './trace', './cli'].filter(name => !exportedModules.includes(name)), []);
  command(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { runTask, aggregateHints, readTrace } from 'rawstep';
    import { runTask as lowLevelRunTask } from 'rawstep/runner';
    import { ProjectStore } from 'rawstep/project';
    import { extractHints } from 'rawstep/hints';
    import { runCli } from 'rawstep/cli';
    assert.equal(typeof runTask, 'function'); assert.equal(typeof aggregateHints, 'function'); assert.equal(typeof readTrace, 'function');
    assert.notEqual(runTask, lowLevelRunTask);
    assert.equal(typeof ProjectStore, 'function'); assert.equal(typeof extractHints, 'function'); assert.equal(typeof runCli, 'function');
    for (const name of ${JSON.stringify(exportedModules)}) await import(name === '.' ? 'rawstep' : 'rawstep/' + name.slice(2));
  `]);
  check(`import { runTask, aggregateHints } from 'rawstep'; ${exportedModules.length} export-map entries import`);

  // 6. A TypeScript consumer compiles against the bundled declarations.
  await writeFile(join(directory, 'consumer.ts'), [
    'import { ScriptedPolicy, runTask, aggregateHints, type DecisionPolicy, type Task, type TraceAnalyzer, type RunTaskOptions, type RunTaskResult, type HintReport, type RunTrace } from "rawstep";',
    'import { ScreenshotDecisionPolicy, type ScreenshotModelAdapter } from "rawstep/screenshot";',
    'import { DecisionClient, FakeSystemOneClient, SystemOneSpeechPolicy, SystemOneScreenshotAdapter, type SystemOneClient } from "rawstep/systemone";',
    'import { LlmTraceAnalyzer } from "rawstep/analyze";',
    'import { ProjectStore, type ProjectConfig } from "rawstep/project";',
    'import { extractHints, type Hint } from "rawstep/hints";',
    'const policy: DecisionPolicy = new ScriptedPolicy([{ stop: "stuck" }]);',
    'const task: Task = { url: "https://example.com", goal: "Read the page", verify: { all: [{ titleIncludes: "Example" }] } };',
    'const analyzer: TraceAnalyzer = { id: "example", analyze: async () => ({ summary: "Done", findings: [] }) };',
    'const model: ScreenshotModelAdapter = new SystemOneScreenshotAdapter(new DecisionClient({ provider: "custom", baseURL: "http://127.0.0.1:8000/v1", modelId: "fixture", capabilities: { inputs: ["text", "image"], maxChoices: 255, maxImages: 2 } }));',
    'const screenshotPolicy = new ScreenshotDecisionPolicy({ model });',
    'const client: SystemOneClient = new FakeSystemOneClient(["stop:uncertain"]);',
    'const speechPolicy = new SystemOneSpeechPolicy(client);',
    'const llm = new LlmTraceAnalyzer({ baseURL: "http://127.0.0.1:31415/v1", model: "auto" });',
    'const options: RunTaskOptions = { projectDir: ".", mode: "keyboard" };',
    'const run: Promise<RunTaskResult> = runTask("task", options);',
    'const hints = (trace: RunTrace): Hint[] => extractHints(trace).hints;',
    'const report = (reports: HintReport[]) => aggregateHints(reports);',
    'const store: ProjectStore = new ProjectStore(".");',
    'const config = async (): Promise<ProjectConfig> => (await store.read()).config;',
    'void [policy, task, analyzer, screenshotPolicy, speechPolicy, llm, run, hints, report, config];',
  ].join('\n'));
  command(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', '--skipLibCheck', '--typeRoots', join(root, 'node_modules/@types'), '--types', 'node', 'consumer.ts']);
  // The consumer file must also fail on a wrong type, proving the declarations are not just `any`.
  await writeFile(join(directory, 'wrong.ts'), 'import type { Task } from "rawstep"; const task: Task = { url: 1, goal: "x" }; void task;');
  const wrong = (() => { try { command(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', '--skipLibCheck', '--typeRoots', join(root, 'node_modules/@types'), '--types', 'node', 'wrong.ts']); return ''; } catch (error) { return String(error.stdout); } })();
  assert.match(wrong, /TS2322/);
  check('TypeScript consumer compiles against the bundled .d.ts (and rejects a wrong type)');

  // 7. Installed behaviour: one module instance across entry points (a spy on one entry is seen by another), AT-driver wire, cancellation, report/analyze, Orca assets.
  const fixture = await readFile(join(root, 'tests/helpers/mock-at-driver-server.ts'), 'utf8');
  const { outputText } = ts.transpileModule(fixture, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }, fileName: 'mock-at-driver-server.ts' });
  await writeFile(join(directory, 'mock-at-driver-server.mjs'), outputText);
  for (const script of ['smoke-installed-roundtrip.mjs', 'smoke-cancellation.mjs', 'smoke-orca-package.mjs']) await writeFile(join(directory, script), await readFile(join(root, 'scripts', script), 'utf8'));
  const roundtrip = JSON.parse(command(process.execPath, ['smoke-installed-roundtrip.mjs']));
  const cancellation = JSON.parse(command(process.execPath, ['smoke-cancellation.mjs']));
  const orca = JSON.parse(command(process.execPath, ['smoke-orca-package.mjs']));
  check('installed roundtrip (AT-driver wire, analyze, report), cancellation and Orca asset resolution');

  console.log(JSON.stringify({ package: pack.filename, packedBytes: pack.size, unpackedBytes: pack.unpackedSize, files: pack.files.length, exportsChecked: exportedModules.length, checks, roundtrip, cancellation, orca }, null, 2));
} catch (error) {
  if (error?.stdout) process.stderr.write(String(error.stdout));
  if (error?.stderr) process.stderr.write(String(error.stderr));
  throw error;
} finally {
  if (process.env.RAWSTEP_KEEP_PACKAGE_SMOKE === '1') console.log(`Package smoke retained: ${directory}`);
  else await rm(directory, { recursive: true, force: true });
}
