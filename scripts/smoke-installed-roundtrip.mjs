/** Executed from the isolated installed-package project by smoke-package.mjs; every rawstep import resolves to the tarball. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AtDriverBackend, AT_DRIVER_KEYS, ScriptedPolicy, readTrace, resolveTask } from "rawstep";
import { runTask } from "rawstep/runner";
import { runMockVoiceOverTask } from "rawstep/mock-voiceover";
import { runCli } from "rawstep/cli";
import { DecisionClient, SystemOneChoiceModel } from 'rawstep/systemone';
import { SpeechDecisionPolicy } from 'rawstep/policy';
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
  const wireTrace = await runTask(resolveTask(JSON.parse(await readFile("wire-task.json", "utf8")), process.cwd()), {
    backend: new AtDriverBackend({ profile: "voiceover", url: server.url, quietMs: 10, maxWaitMs: 100, commandTimeoutMs: 1000, connectTimeoutMs: 1000 }),
    policy: new ScriptedPolicy([{ action: { kind: "intent", intent: "activate" } }]), outDir: out,
    // This explicit fake browser/verifier proves packaging and the real wire path,
    // not native screen-reader accuracy, browser accessibility, or OS integration.
    browserSessionFactory: async () => fakeBrowser,
    verifier: async () => ({ passed: true, failures: [] }),
  });
  const result = wireTrace.outcome?.status === "success" ? 0 : 1;
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
  let simulatedVoiceOverBrowser = { status: "not-requested" };
  let speechModelBrowser = { status: "not-requested" };
  if (process.env.RAWSTEP_TEST_BROWSER_PATH) {
    await writeFile("browser-fixture.html", '<!doctype html><title>Before</title><button onclick="document.title=&quot;Completed&quot;">Start</button>');
    await writeFile("mock-decisions.json", JSON.stringify([{ action: { kind: "intent", intent: "activate" } }]));
    await writeFile("mock-task.json", JSON.stringify({ id: "installed-mock-browser", url: pathToFileURL(join(process.cwd(), "browser-fixture.html")).href, goal: "Activate Start", verify: { all: [{ titleIncludes: "Completed" }] } }));
    const mockOut = join(process.cwd(), "installed-mock-browser");
    await runMockVoiceOverTask(resolveTask(JSON.parse(await readFile("mock-task.json", "utf8")), process.cwd()), { policy: new ScriptedPolicy(JSON.parse(await readFile("mock-decisions.json", "utf8"))), outDir: mockOut, browserExecutablePath: process.env.RAWSTEP_TEST_BROWSER_PATH, warn: () => {} });
    const mockTrace = await readTrace(mockOut);
    assert.equal(mockTrace.schemaVersion, "3.0");
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
    // This HTTP endpoint is an explicitly labelled fixture adapter, not a real model claim.
    const { createServer } = await import('node:http');
    let modelRequests = 0;
    const httpModel = createServer(async (request, response) => {
      let body = ''; for await (const chunk of request) body += chunk;
      const modelInput = JSON.parse(body);
      assert.equal(request.url, '/v1/systemone');
      assert.ok(Array.isArray(modelInput.state.speech) && !('verify' in modelInput) && !('inputs' in modelInput));
      modelRequests++;
      const criteria = Object.keys(modelInput.questions.next.criteria), choice = 'intent:activate';
      assert.ok(criteria.includes(choice));
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ model: modelInput.model, answers: { next: { type: 'choice', choice, probabilities: Object.fromEntries(criteria.map(id => [id, id === choice ? 1 : 0])) } } }));
    });
    await new Promise(resolve => httpModel.listen(0, '127.0.0.1', resolve));
    try {
      const speechOut = join(process.cwd(), 'installed-speech-model');
      const client = new DecisionClient({ provider: 'custom', baseURL: 'http://127.0.0.1:' + httpModel.address().port + '/v1', modelId: 'package-smoke-fixture-adapter', capabilities: { maxChoices: 255 } });
      await runMockVoiceOverTask(resolveTask(JSON.parse(await readFile("mock-task.json", "utf8")), process.cwd()), { policy: new SpeechDecisionPolicy(new SystemOneChoiceModel(client)), outDir: speechOut, browserExecutablePath: process.env.RAWSTEP_TEST_BROWSER_PATH, warn: () => {} });
      const speechTrace = await readTrace(speechOut);
      assert.equal(speechTrace.outcome.status, 'success');
      assert.equal(speechTrace.events.filter(event => event.type === 'policy.evidence').length, modelRequests);
      assert.equal(await runCli(['analyze', speechOut], io), 0);
      assert.equal(await runCli(['report', speechOut, '--analysis', join(speechOut, 'analysis.json')], io), 0);
      speechModelBrowser = { status: 'passed', modelRequests, actualBrowser: true, adapter: 'HTTP fixture, not real inference' };
    } finally { await new Promise(resolve => httpModel.close(resolve)); }
  }
  console.log(JSON.stringify({ wireCommands: server.commands.length, traceEvents: recorded.events.length, observationWindows: observations.length, simulatedVoiceOverBrowser, speechModelBrowser, nativeScreenReaderTested: false }));
} finally {
  await server.close();
}
