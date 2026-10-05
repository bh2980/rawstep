#!/usr/bin/env node
/** Build and install the packed release into a clean project outside the checkout. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { packWorkspace } from "./pack-workspace.mjs";
import { smokePackageClosures } from "./smoke-workspaces.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const directory = await mkdtemp(join(tmpdir(), "rawstep-package-smoke-"));
const environment = { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1", npm_config_cache: process.env.RAWSTEP_SMOKE_NPM_CACHE ? resolve(process.env.RAWSTEP_SMOKE_NPM_CACHE) : join(directory, ".npm-cache") };
for (const key of Object.keys(environment)) {
  if (/^(?:RAWSTEP_DECISION_|RAWSTEP_ANALYSIS_|AI_|OPENAI_|ANTHROPIC_|AZURE_OPENAI_|GOOGLE_API_KEY$|GEMINI_API_KEY$)/.test(key)) delete environment[key];
}
const command = (bin, args, cwd = root) => execFileSync(bin, args, { cwd, encoding: "utf8", env: environment, stdio: ["ignore", "pipe", "pipe"] });
try {
  command(npm, ["run", "build"]);
  const packs = await packWorkspace(directory, { build: false, environment });
  const pack = packs.find(p => p.name === "rawstep");
  const workspaceChecks = await smokePackageClosures(packs, directory, environment);
  for (const file of pack.files) {
    assert.match(file.path, /^(?:dist\/|README(?:\.ko)?\.md$|LICENSE$|package\.json$|docs\/[^/]+\.md$|examples\/(?:v2|screenshot|profiles|orca)\/[^/]+\.(?:json|mjs|md|py|txt|html)$|native\/[^/]+\.py$|fixtures\/(?:(?:simple-cta|native-voiceover|mock-voiceover-system|screenshot-keyboard|screenshot-workflow|environment-lab)\.html|visual-study\/controls\.html)$)/);
    assert.doesNotMatch(file.path, /(?:node_modules|packages\/|apps\/|\.node$|\.wasm$|\.safetensors$|\.gguf$)/);
  }
  await writeFile(join(directory, "package.json"), JSON.stringify({ name: "rawstep-isolated-smoke", private: true, type: "module" }));
  const installArgs = ["install", "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund", "--package-lock=false", ...packs.map(p => join(directory, p.filename))];
  if (process.env.RAWSTEP_SMOKE_OFFLINE === "1") installArgs.push("--offline");
  command(npm, installArgs, directory);
  const manifest = JSON.parse(await readFile(join(directory, "node_modules/rawstep/package.json"), "utf8"));
  assert.equal(manifest.name, "rawstep");
  assert.match(await readFile(join(directory, "node_modules/rawstep/fixtures/visual-study/controls.html"), "utf8"), /Reading preferences/);
  assert.match(await readFile(join(directory, "node_modules/rawstep/fixtures/simple-cta.html"), "utf8"), /Get started/);
  assert.match(await readFile(join(directory, "node_modules/rawstep/fixtures/mock-voiceover-system.html"), "utf8"), /Save again/);
  assert.match(await readFile(join(directory, "node_modules/rawstep/examples/v2/mock-task.json"), "utf8"), /mock-voiceover-system/);
  assert.match(await readFile(join(directory, "node_modules/rawstep/docs/cli.md"), "utf8"), /DecisionPolicy/);
  assert.match(await readFile(join(directory, "node_modules/rawstep/examples/v2/policy.mjs"), "utf8"), /decide/);
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), ["@rawstep/core", "@rawstep/policies", "@rawstep/browser", "@rawstep/screenreaders", "@rawstep/reports", "@rawstep/cli"].sort());
  const exportedModules = Object.keys(manifest.exports).filter((name) => name !== "./package.json");
  command(process.execPath, ["--input-type=module", "-e", `for (const name of ${JSON.stringify(exportedModules)}) await import(name === '.' ? 'rawstep' : 'rawstep/' + name.slice(2));`], directory);
  const binary = join(directory, "node_modules/rawstep/dist/cli/bin.js");
  assert.match(command(process.execPath, [binary, "--help"], directory), /No model or API key is required/);
  if (process.platform !== "win32") assert.match(command(join(directory, "node_modules/.bin/rawstep"), ["--help"], directory), /No model or API key is required/);
  assert.equal(command(process.execPath, [binary, "--version"], directory).trim(), manifest.version);
  assert.match(command(process.execPath, [binary, "doctor", "--backend", "nvda"], directory), /Native readiness is unverified/);
  const trace = {
    schemaVersion: "2.2", runId: "package-smoke", task: { id: "task" },
    environment: { platform: "test", platformVersion: "unknown", browser: "test", browserVersion: "unknown", screenReader: "not-used", screenReaderVersion: "unknown", backend: "screenshot-keyboard" },
    startedAt: "2026-01-01T00:00:00.000Z", endedAt: "2026-01-01T00:00:01.000Z",
    events: [], outcome: { status: "inconclusive", reason: "package smoke" },
    privacy: { inputValues: "redacted", redactionApplied: false },
  };
  await writeFile(join(directory, "trace.json"), JSON.stringify(trace));
  command(process.execPath, [binary, "analyze", "trace.json"], directory);
  command(process.execPath, [binary, "report", "trace.json", "--analysis", "analysis.json"], directory);
  assert.match(await readFile(join(directory, "report.html"), "utf8"), /package-smoke/);
  assert.deepEqual(JSON.parse(await readFile(join(directory, "trace.json"), "utf8")), trace);
  // Only the socket fixture is compiled from the checkout; every Rawstep import
  // in this child resolves to the tarball installed in the isolated project.
  const fixture = await readFile(join(root, "tests/helpers/mock-at-driver-server.ts"), "utf8");
  const { outputText } = ts.transpileModule(fixture, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    fileName: "mock-at-driver-server.ts",
  });
  await writeFile(join(directory, "mock-at-driver-server.mjs"), outputText);
  await writeFile(join(directory, "installed-roundtrip.mjs"), String.raw`
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AtDriverBackend, AT_DRIVER_KEYS, readTrace, runTask } from "rawstep";
import { runCli } from "rawstep/cli";
import { FakeSystemOneClient, SystemOneScreenshotAdapter } from 'rawstep/systemone';
import { ScreenshotDecisionPolicy, runScreenshotTask } from 'rawstep/screenshot';
import { mockAtDriverServer } from "./mock-at-driver-server.mjs";

assert.equal(fileURLToPath(import.meta.resolve("rawstep")), join(process.cwd(), "node_modules", "rawstep", "dist", "index.js"));
const server = await mockAtDriverServer({ onCommand(command, output) {
  assert.equal(command.method, "interaction.userIntent");
  assert.equal(command.params.name, "pressKeys");
  output("Installed package activation acknowledged");
} });
const fakeBrowser = {
  page: { bringToFront: async () => {}, evaluate: async () => true },
  browser: { version: () => "mock-browser-not-native" },
  takeBlockedNavigations: () => [], takeNavigationGuardWarnings: () => [], close: async () => {},
};
const stdout = [], stderr = [];
const io = { stdout: text => stdout.push(text), stderr: text => stderr.push(text) };
const out = join(process.cwd(), "installed-roundtrip");
try {
  await writeFile("wire-task.json", JSON.stringify({
    id: "installed-websocket-roundtrip", url: "https://example.test", goal: "Activate the fixture control",
    verify: { all: [{ titleIncludes: "Done" }] }, timeoutMs: 5000,
  }));
  await writeFile("wire-decisions.json", JSON.stringify([{ action: { kind: "intent", intent: "activate" } }]));
  const result = await runCli(["run", "wire-task.json", "--script", "wire-decisions.json", "--backend", "voiceover", "--endpoint", server.url, "--out", out], {
    ...io,
    createBackend: options => new AtDriverBackend({ ...options, quietMs: 10, maxWaitMs: 100, commandTimeoutMs: 1000, connectTimeoutMs: 1000 }),
    // This explicit fake browser/verifier proves packaging and the real wire path,
    // not native screen-reader accuracy, browser accessibility, or OS integration.
    runTask: (task, options) => runTask(task, {
      ...options,
      browserSessionFactory: async () => fakeBrowser,
      verifier: async () => ({ passed: true, failures: [] }),
    }),
  });
  assert.equal(result, 0, stderr.join("\n"));
  assert.deepEqual(stderr, []);
  assert.deepEqual(server.commands.map(command => command.method), ["session.new", "interaction.userIntent"]);
  assert.equal(server.commands[0].params.capabilities.alwaysMatch.atName, "VoiceOver");
  assert.deepEqual(server.commands[1].params.keys, [AT_DRIVER_KEYS.Control, AT_DRIVER_KEYS.Alt, AT_DRIVER_KEYS.Space]);
  const recorded = await readTrace(out);
  assert.equal(recorded.outcome.status, "success");
  assert.equal(recorded.task.id, "installed-websocket-roundtrip");
  assert.ok(recorded.runId.length > 0);
  assert.equal(new Set(recorded.events.map(event => event.id)).size, recorded.events.length);
  assert.deepEqual(recorded.events.map(event => event.seq), recorded.events.map((_, index) => index + 1));
  const commands = recorded.events.filter(event => event.type === "backend.command");
  assert.deepEqual(commands.map(event => event.commandId), server.commands.map(command => String(command.id)));
  assert.match(JSON.stringify(recorded), /Installed package activation acknowledged/);
  const ids = new Set(recorded.events.map(event => event.id));
  const observations = recorded.events.filter(event => event.type === "screen-reader.observation");
  assert.ok(observations.length >= 2);
  for (const event of observations) {
    assert.ok(event.data.outputEventIds.length > 0);
    assert.ok(event.data.outputEventIds.every(id => ids.has(id)));
  }
  const original = await readFile(join(out, "trace.json"), "utf8");
  assert.equal(await runCli(["analyze", out], io), 0, stderr.join("\n"));
  assert.equal(await runCli(["report", out, "--analysis", join(out, "analysis.json")], io), 0, stderr.join("\n"));
  assert.equal(await runCli(["analyze", out], io), 0, stderr.join("\n"));
  assert.equal(await readFile(join(out, "trace.json"), "utf8"), original);
  const analysis = JSON.parse(await readFile(join(out, "analysis.json"), "utf8"));
  assert.equal(analysis.runId, recorded.runId);
  assert.equal(analysis.status, "completed");
  assert.deepEqual(analysis.runOutcome, recorded.outcome);
  assert.match(await readFile(join(out, "report.html"), "utf8"), /installed-websocket-roundtrip/);
  assert.deepEqual(stderr, []);
  const fakeVisualClient = new FakeSystemOneClient(['key:Enter']);
  const imageFixture = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nV8AAAAASUVORK5CYII=';
  const fakeVisualBrowser = { ...fakeBrowser, page: { ...fakeBrowser.page, screenshot: async () => Buffer.from(imageFixture, 'base64'), viewportSize: () => ({width:1,height:1}), keyboard: {press:async()=>{},type:async()=>{}} } };
  const fakeVisualTrace = await runScreenshotTask({mode:'keyboard',url:'https://example.test',goal:'Activate',verify:{all:[{titleIncludes:'Done'}]}}, {
    outDir:join(process.cwd(),'installed-fake-systemone'), policy:new ScreenshotDecisionPolicy({model:new SystemOneScreenshotAdapter(fakeVisualClient)}),
    browserSessionFactory:async()=>fakeVisualBrowser, verifier:async()=>({passed:true,failures:[]}),
  });
  assert.equal(fakeVisualTrace.outcome.status,'success');
  assert.equal(fakeVisualClient.requests[0].images[0].pngBase64,imageFixture);
  assert.ok(fakeVisualTrace.events.some(event=>event.type==='policy.evidence'));
  let nativeBrowser = { status: "not-requested" };
  let simulatedVoiceOverBrowser = { status: "not-requested" };
  let screenshotModelBrowser = { status: "not-requested" };
  if (process.env.RAWSTEP_TEST_BROWSER_PATH) {
    await writeFile("browser-fixture.html", '<!doctype html><title>Before</title><button onclick="document.title=&quot;Completed&quot;">Start</button>');
    await writeFile("browser-task.json", JSON.stringify({ id: "installed-real-browser", mode: "keyboard", url: pathToFileURL(join(process.cwd(), "browser-fixture.html")).href, goal: "Activate Start", verify: { all: [{ titleIncludes: "Completed" }] } }));
    await writeFile("browser-decisions.json", JSON.stringify([{ action: { kind: "key", key: "Tab" } }, { action: { kind: "key", key: "Enter" } }]));
    const browserOut = join(process.cwd(), "installed-real-browser");
    assert.equal(await runCli(["screenshot-run", "browser-task.json", "--script", "browser-decisions.json", "--browser-executable", process.env.RAWSTEP_TEST_BROWSER_PATH, "--out", browserOut], io), 0, stderr.join("\n"));
    assert.doesNotMatch(stderr.join("\n"), /deprecated/);
    const browserTrace = await readTrace(browserOut);
    assert.equal(browserTrace.outcome.status, "success");
    assert.equal(browserTrace.task.mode, "keyboard");
    const witness = browserTrace.events.find(event => event.type === "verifier.evidence" && event.data.witness.title === "Completed");
    assert.ok(witness, "Installed verifier should persist its observed title");
    assert.ok(browserTrace.events.some(event => event.type === "verifier.result" && event.data.rules?.some(rule => rule.evidenceEventIds.includes(witness.id))));
    const screenshots = browserTrace.events.filter(event => event.type === "keyboard.observation");
    assert.equal(screenshots.length, 3);
    assert.equal(Buffer.from(screenshots[0].data.screenshot.pngBase64, "base64").subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(await runCli(["report", browserOut], io), 0);
    assert.match(await readFile(join(browserOut, "report.html"), "utf8"), /data:image\/png;base64,/);
    nativeBrowser = { status: "passed", screenshotObservations: screenshots.length, keyboardActions: 2 };
    // This HTTP endpoint is an explicitly labelled fixture adapter, not a real model claim.
    const { createServer } = await import('node:http');
    let modelRequests = 0;
    const httpModel = createServer(async (request, response) => {
      let body = ''; for await (const chunk of request) body += chunk;
      const modelInput = JSON.parse(body);
      assert.equal(modelInput.protocol, 'rawstep-screenshot-choice-v1');
      assert.match(modelInput.screenshot.pngBase64, /^iVBOR/);
      assert.ok(!('verify' in modelInput) && !('inputs' in modelInput));
      assert.ok(modelInput.history.every(item => !('execution' in item)));
      const choiceId = ['key:Tab', 'key:Enter'][modelRequests++];
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ choiceId, model: { id: 'package-smoke-fixture-adapter', runtime: 'not-real-inference' } }));
    });
    await new Promise(resolve => httpModel.listen(0, '127.0.0.1', resolve));
    try {
      const visualOut = join(process.cwd(), 'installed-screenshot-model');
      assert.equal(await runCli(['screenshot-run', 'browser-task.json', '--model-endpoint', 'http://127.0.0.1:' + httpModel.address().port + '/choose', '--browser-executable', process.env.RAWSTEP_TEST_BROWSER_PATH, '--out', visualOut], io), 0, stderr.join('\\n'));
      const visualTrace = await readTrace(visualOut);
      assert.equal(visualTrace.outcome.status, 'success');
      assert.equal(visualTrace.events.filter(event => event.type === 'policy.evidence').length, 2);
      assert.equal(await runCli(['analyze', visualOut], io), 0);
      assert.equal(await runCli(['report', visualOut, '--analysis', join(visualOut, 'analysis.json')], io), 0);
      assert.match(await readFile(join(visualOut, 'report.html'), 'utf8'), /Visited visual states/);
      screenshotModelBrowser = { status: 'passed', modelRequests, actualBrowser: true, adapter: 'HTTP fixture, not real inference' };
    } finally { await new Promise(resolve => httpModel.close(resolve)); }
    await writeFile("mock-decisions.json", JSON.stringify([{ action: { kind: "intent", intent: "activate" } }]));
    await writeFile("mock-task.json", JSON.stringify({ id: "installed-mock-browser", url: pathToFileURL(join(process.cwd(), "browser-fixture.html")).href, goal: "Activate Start", verify: { all: [{ titleIncludes: "Completed" }] } }));
    const mockOut = join(process.cwd(), "installed-mock-browser");
    assert.equal(await runCli(["mock-run", "mock-task.json", "--script", "mock-decisions.json", "--browser-executable", process.env.RAWSTEP_TEST_BROWSER_PATH, "--out", mockOut], io), 0, stderr.join("\n"));
    const mockTrace = await readTrace(mockOut);
    assert.equal(mockTrace.schemaVersion, "2.2");
    assert.equal(mockTrace.outcome.status, "success");
    assert.equal(mockTrace.environment.observationProvenance, "simulation");
    assert.equal(mockTrace.events.filter(event => event.source === "screen-reader").length, 0);
    const simulatedObservations = mockTrace.events.filter(event => event.type === "simulation.observation");
    assert.equal(simulatedObservations.length, 2);
    assert.ok(simulatedObservations.every(event => event.data.provenance === "simulation"));
    assert.equal(await runCli(["analyze", mockOut], io), 0);
    assert.equal(await runCli(["report", mockOut, "--analysis", join(mockOut, "analysis.json")], io), 0);
    assert.match(await readFile(join(mockOut, "report.html"), "utf8"), /[Ss]imulat/);
    simulatedVoiceOverBrowser = { status: "passed", observations: simulatedObservations.length, actualBrowser: true, nativeVoiceOverTested: false };

  }
  console.log(JSON.stringify({ wireCommands: server.commands.length, traceEvents: recorded.events.length, observationWindows: observations.length, fakeSystemOneVisual:'passed', nativeBrowser, simulatedVoiceOverBrowser, screenshotModelBrowser, nativeScreenReaderTested: false }));
} finally {
  await server.close();
}
`);
  const installedRoundtrip = JSON.parse(command(process.execPath, ["installed-roundtrip.mjs"], directory));
  await writeFile(join(directory, "smoke-cancellation.mjs"), await readFile(join(root, "scripts/smoke-cancellation.mjs"), "utf8"));
  const installedCancellation = JSON.parse(command(process.execPath, ["smoke-cancellation.mjs"], directory));
  await writeFile(join(directory, "smoke-orca-package.mjs"), await readFile(join(root, "scripts/smoke-orca-package.mjs"), "utf8"));
  const installedOrca = JSON.parse(command(process.execPath, ["smoke-orca-package.mjs"], directory));
  await writeFile(join(directory, "consumer.ts"), [
    'import { ScriptedPolicy, type DecisionPolicy, type Task, type TraceAnalyzer } from "rawstep";',
    'const policy: DecisionPolicy = new ScriptedPolicy([{ stop: "stuck" }]);',
    'const task: Task = { url: "https://example.com", goal: "Read the page", verify: { all: [{ titleIncludes: "Example" }] } };',
    'const analyzer: TraceAnalyzer = { id: "example", analyze: async () => ({ summary: "Done", findings: [] }) };',
    'import { ScreenshotDecisionPolicy, HttpScreenshotModel, type ScreenshotModelAdapter } from "rawstep/screenshot";',
    'const model: ScreenshotModelAdapter = new HttpScreenshotModel({ endpoint: "http://127.0.0.1:8766/choose" });',
    'const screenshotPolicy = new ScreenshotDecisionPolicy({ model });',
    'import { FakeSystemOneClient, SystemOneSpeechPolicy, SystemOneScreenshotAdapter, type SystemOneClient } from "rawstep/systemone";',
    'import { LlmTraceAnalyzer } from "@rawstep/reports/analyze/llm";',
    'const client: SystemOneClient = new FakeSystemOneClient(["stop:uncertain"]);',
    'const speechPolicy = new SystemOneSpeechPolicy(client);',
    'const imageAdapter = new SystemOneScreenshotAdapter(client);',
    'const llm = new LlmTraceAnalyzer({baseURL:"http://127.0.0.1:31415/v1",model:"auto"});',
    'void [policy, task, analyzer, screenshotPolicy, speechPolicy, imageAdapter, llm];',
  ].join("\n"));
  command(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "--noEmit", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2022", "--skipLibCheck", "consumer.ts"], directory);
  console.log(JSON.stringify({ package: pack.filename, workspaceChecks, packedBytes: pack.size, unpackedBytes: pack.unpackedSize, files: pack.files.length, exportsChecked: exportedModules.length, installedRoundtrip, installedCancellation, installedOrca, result: "passed", checks: ["isolated npm install", "all exported JS modules", "CLI help/version/doctor", "offline analysis/report", "consumer TypeScript declarations", "release allowlist", "installed-package real WebSocket adapter/runner/trace/analyze/report"] }, null, 2));
} catch (error) {
  if (error?.stdout) process.stderr.write(String(error.stdout));
  if (error?.stderr) process.stderr.write(String(error.stderr));
  throw error;
} finally {
  if (process.env.RAWSTEP_KEEP_PACKAGE_SMOKE === '1') console.log(`Package smoke retained: ${directory}`);
  else await rm(directory, { recursive: true, force: true });
}
