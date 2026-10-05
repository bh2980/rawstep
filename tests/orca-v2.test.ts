import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrcaBackend, ORCA_NATIVE_PROTOCOL, mapOrcaAction, type OrcaBackendOptions, type OrcaEvent } from '@rawstep/screenreaders/orca';
import { runTask } from '@rawstep/browser/runner';
import { ScriptedPolicy } from '@rawstep/policies/policy';
import { TraceRecorder } from '@rawstep/core/trace';
import type { BrowserSession } from '@rawstep/browser/browser';
import type { Backend } from '@rawstep/core/contracts';

// This is a deterministic transport fixture, not native Orca evidence.
const childProgram = `
const {createInterface}=require('node:readline');
const {appendFileSync}=require('node:fs');
const config=JSON.parse(process.argv[1]);
if(config.pidLog)appendFileSync(config.pidLog,String(process.pid));
if(config.ignoreTerm)process.on('SIGTERM',()=>{});
let session, interval;
const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');
const response=(id,result)=>send({type:'response',id,result});
const speech=text=>send({type:'speech',source:'orca-speech',sessionId:session,text});
const keepAlive=setInterval(()=>{},1000);
process.stderr.write('PRIVATE DESKTOP DIAGNOSTIC DO NOT SAVE\\n');
const reader=createInterface({input:process.stdin});
reader.on('line',line=>{
 const request=JSON.parse(line);
 if(config.log)appendFileSync(config.log,JSON.stringify(request)+'\\n');
 if(request.method==='session.stop'){
   if(config.ignoreStop)return;
   response(request.id,{});process.exit(0);
 }
 if(request.method==='session.start'){
   session=request.params.sessionId;
   if(config.hangStart)return;
   if(config.exitStart){process.exit(7);return;}
   if(config.invalidJson){process.stdout.write('not-json SECRET\\n');return;}
   if(config.oversized){process.stdout.write('x'.repeat(1048577));return;}
   if(config.startError){send({type:'response',id:request.id,error:{code:'missing runtime',message:'Orca runtime unavailable'}});return;}
   if(config.stale)speech('Startup speech');
   if(config.beforeAck)speech('Before startup ACK');
   response(request.id,{protocol:'rawstep-orca-native-v1',sessionId:session,atName:'Orca',atVersion:'transport-fixture',platformName:'linux',speechSource:'orca-speech',captureStage:'speech-dispatcher-submission',audioVerified:false,targetWindowId:request.params.targetWindowId??12345,targetClass:'Chromium',targetProcessId:4321,...config.handshake});
   if(config.stale)send({type:'speech',source:'orca-speech',sessionId:'old-session',text:'NEVER INCLUDE'});
   if(config.continuous)interval=setInterval(()=>speech('Still speaking'),4);
   if(config.splitUnicode){const b=Buffer.from(JSON.stringify({type:'speech',source:'orca-speech',sessionId:session,text:'한글'})+'\\n'); const n=b.indexOf(Buffer.from('한'))+1;process.stdout.write(b.subarray(0,n));setTimeout(()=>process.stdout.write(b.subarray(n)),3);}
   return;
 }
 if(request.method==='input.pressKeys'){
   if(config.actionError){send({type:'response',id:request.id,error:{code:'TARGET_NOT_FOCUSED',message:'The configured browser window lost focus'}});return;}
   if(config.exitAction){process.exit(8);return;}
   if(config.hangAction)return;
   if(config.outputBeforeAck)speech('Before key ACK');
   if(config.wrongSource)send({type:'speech',source:'ax-tree',sessionId:session,text:'NOT NATIVE'});
   if(config.wrongResponse){response(987654,{});return;}
   if(config.ambiguousResponse){send({type:'response',id:request.id,result:{},error:{code:'x',message:'x'}});return;}
   if(config.invalidAck){response(request.id,{value:true});return;}
   const ack=()=>response(request.id,{});
   if(config.ackDelay)setTimeout(ack,config.ackDelay);else ack();
   if(config.outputAfterAck)setTimeout(()=>speech('After key ACK'),config.outputAfterAck);
   if(config.echo)speech(request.params.keys.join(' '));
 }
});
`;
const backends: OrcaBackend[] = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(backends.splice(0).map(backend => backend.close()));
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
function backend(config: Record<string, unknown> = {}, options: OrcaBackendOptions = {}) {
  const result = new OrcaBackend({ bridgeCommand: [process.execPath, '-e', childProgram, JSON.stringify(config)], quietMs: 20, maxWaitMs: 150, closeTimeoutMs: 40, commandTimeoutMs: 200, startupTimeoutMs: 1_000, ...options });
  backends.push(result); return result;
}
async function directory() { const path = await mkdtemp(join(tmpdir(), 'rawstep-orca-unit-')); directories.push(path); return path; }
function pairedBrowser() {
  return { nativeTargetWindowId: 12345, page: { bringToFront: vi.fn(async () => {}), evaluate: vi.fn(async () => true) }, browser: { version: () => 'transport-test-browser' }, takeBlockedNavigations: () => [], takeNavigationGuardWarnings: () => [], close: vi.fn(async () => {}) } as unknown as BrowserSession;
}

describe('Orca native profile', () => {
  it('maps real X11 keys without pretending they are AT Driver key codes', () => {
    expect(mapOrcaAction({ kind: 'intent', intent: 'heading.previous' })).toEqual([['Shift_L', 'h']]);
    expect(mapOrcaAction({ kind: 'intent', intent: 'next' })).toEqual([['Down']]);
    expect(mapOrcaAction({ kind: 'key', key: 'Shift+Tab' })).toEqual([['Shift_L', 'Tab']]);
    expect(mapOrcaAction({ kind: 'key', key: 'Mod+A' })).toEqual([['Control_L', 'a']]);
  });
  it('prevalidates complete printable ASCII replacement and rejects unsupported semantics', () => {
    expect(mapOrcaAction({ kind: 'replaceText', text: 'A@z.test' })).toEqual([['Control_L', 'a'], ['BackSpace'], ['Shift_L', 'a'], ['Shift_L', '2'], ['z'], ['period'], ['t'], ['e'], ['s'], ['t']]);
    expect(() => mapOrcaAction({ kind: 'replaceText', text: 'valid then 한' })).toThrow(/printable ASCII/);
    expect(() => mapOrcaAction({ kind: 'typeText', text: 'line\n' })).toThrow(/printable ASCII/);
    expect(() => mapOrcaAction({ kind: 'intent', intent: 'interact' })).toThrow(/Unsupported/);
    expect(() => mapOrcaAction({ kind: 'key', key: 'Control+L' })).toThrow(/Unsupported/);
  });
  it('rejects unsafe or invalid configuration before launching a child', () => {
    expect(() => new OrcaBackend({ quietMs: 0 })).toThrow(/positive/);
    expect(() => new OrcaBackend({ commandTimeoutMs: NaN })).toThrow(/positive/);
    expect(() => new OrcaBackend({ targetWindowId: -1 })).toThrow(/window ID/);
    expect(() => new OrcaBackend({ bridgeCommand: ['\0'] })).toThrow(/NUL/);
  });
});

describe('Orca NDJSON backend (transport fixture, not native evidence)', () => {
  it('negotiates a distinct native backend and includes pre-ACK startup speech exactly once', async () => {
    const b = backend({ beforeAck: true });
    const events: OrcaEvent[] = []; b.subscribe(event => events.push(event));
    const metadata = await b.start();
    expect(metadata).toMatchObject({ backend: 'orca-native', profile: 'orca', protocol: ORCA_NATIVE_PROTOCOL, capture: { source: 'orca-speech', kind: 'speech-pipeline-text' }, collection: { speechCompletionSignal: false } });
    const first = await b.observe();
    expect(first.speech).toEqual(['Before startup ACK']);
    expect(first).toMatchObject({ attribution: 'temporal-only', speechComplete: 'unknown', reason: 'quiet', commandIds: [1] });
    expect(first.outputs[0]?.windowId).toBe(first.windowId);
    expect((await b.observe()).speech).toEqual([]);
    expect(events.some(event => event.type === 'output')).toBe(true);
    expect(JSON.stringify(events)).not.toContain('PRIVATE DESKTOP');
  });
  it('owns its host and pairing rules: a visible Linux browser from a paired factory, matching the verified target window', async () => {
    const b = backend(); const metadata = await b.start(); const target = metadata.target.windowId;
    const ok = { platform: 'linux', headless: false, customBrowserSession: true };
    expect(() => b.preflight(ok)).not.toThrow();
    for (const context of [{ ...ok, platform: 'darwin' }, { ...ok, headless: true }, { ...ok, customBrowserSession: false }]) expect(() => b.preflight(context)).toThrow(/visible Linux browser/);
    expect(b.cleanupTimeoutMs).toBe(5_000);
    expect(() => b.attachSession({ page: {}, nativeTargetWindowId: target })).not.toThrow();
    expect(() => b.attachSession({ page: {}, nativeTargetWindowId: target + 1 })).toThrow(expect.objectContaining({ code: 'backend-precondition', message: expect.stringMatching(/does not match/) }));
  });
  it('filters stale-session speech and handles split UTF-8 lines', async () => {
    const b = backend({ stale: true, splitUnicode: true });
    const events: OrcaEvent[] = []; b.subscribe(event => events.push(event));
    await b.start(); const observation = await b.observe();
    expect(observation.speech).toEqual(['Startup speech', '한글']);
    expect(JSON.stringify(events)).not.toContain('NEVER INCLUDE');
    expect(events.some(event => event.type === 'ignoredSpeech')).toBe(true);
  });
  it('collects key output before and after ACK with receipt-time-only attribution', async () => {
    const b = backend({ outputBeforeAck: true, outputAfterAck: 12 });
    await b.start(); await b.observe();
    const receipt = await b.execute({ kind: 'intent', intent: 'next' });
    const observation = await b.observe();
    expect(observation.speech).toEqual(['Before key ACK', 'After key ACK']);
    expect(observation.commandIds).toEqual(receipt.commandIds);
    expect(observation.windowId).toBe(receipt.windowId);
    expect(observation.outputs.every(output => !('commandId' in output))).toBe(true);
  });
  it('waits the quiet interval after ACK and bounds continuing output by the deadline', async () => {
    const b = backend({ continuous: true }, { quietMs: 20, maxWaitMs: 55 });
    await b.start(); const observation = await b.observe();
    expect(observation.reason).toBe('deadline'); expect(observation.speech.length).toBeGreaterThan(1);
    expect(Date.parse(observation.endedAt) - Date.parse(observation.collectionStartedAt)).toBeGreaterThanOrEqual(50);
  });
  it('forwards explicit target binding without placing process arguments or environment in metadata', async () => {
    const log = join(await directory(), 'commands.jsonl'); const b = backend({ log }, { targetWindowId: 12345 });
    const metadata = await b.start(); await b.close();
    expect(metadata.target).toEqual({ windowId: 12345, windowClass: 'Chromium', processId: 4321, browserSessionAssociation: 'caller-responsibility' });
    const commands = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(commands[0].params.targetWindowId).toBe(12345);
    expect(commands.at(-1).method).toBe('session.stop');
    expect(JSON.stringify(metadata)).not.toMatch(/bridgeCommand|DBUS_SESSION_BUS_ADDRESS|PRIVATE DESKTOP/);
  });
  it.each([
    { handshake: { speechSource: 'ax-tree' } }, { handshake: { sessionId: 'other' } },
    { handshake: { protocol: 'at-driver' } }, { handshake: { atName: 'Simulator' } },
    { handshake: { platformName: 'darwin' } }, { handshake: { atVersion: '' } },
    { handshake: { captureStage: 'ax-to-text' } }, { handshake: { audioVerified: true } },
  ])('rejects a false native handshake: %j', async config => {
    const b = backend(config); await expect(b.start()).rejects.toThrow(/native speech capture/);
    await expect(b.execute({ kind: 'key', key: 'Tab' })).rejects.toThrow();
  });
  it.each([
    { targetWindowId: 999 }, { targetWindowId: 1 }, { targetProcessId: 0 }, { targetClass: '' },
  ])('rejects missing or mismatched target identity: %j', async handshake => {
    const b = backend({ handshake }, { targetWindowId: 12345 });
    await expect(b.start()).rejects.toThrow(/browser window was not verified/);
  });
  it.each([
    [{ invalidJson: true }, /invalid NDJSON/], [{ oversized: true }, /size limit/],
    [{ exitStart: true }, /exited/], [{ startError: true }, /runtime unavailable/],
  ] as const)('fails startup closed for %j', async (config, message) => {
    const b = backend(config); await expect(b.start()).rejects.toThrow(message);
  });
  it('reports missing executable without leaking stderr or native exception payloads', async () => {
    const b = backend({}, { bridgeCommand: ['/nonexistent/rawstep-orca-python'] });
    await expect(b.start()).rejects.toThrow(/Could not launch Orca bridge/);
  });
  it('times out a hung native startup and bounds shutdown of an uncooperative child', async () => {
    const b = backend({ hangStart: true, ignoreStop: true }, { startupTimeoutMs: 80 });
    await expect(b.start()).rejects.toThrow(/timed out/);
    await b.close(); await expect(b.start()).rejects.toThrow(/already started or closed/);
  });
  it('forces termination if the owned child ignores stop and SIGTERM', async () => {
    const pidLog = join(await directory(), 'pid');
    const b = backend({ pidLog, ignoreStop: true, ignoreTerm: true });
    await b.start(); const pid = Number(await readFile(pidLog, 'utf8'));
    await b.close();
    expect(() => process.kill(pid, 0)).toThrow();
  });
  it.each([
    [{ invalidAck: true }, /keyboard acknowledgement/], [{ wrongSource: true }, /speech provenance/],
    [{ wrongResponse: true }, /unexpected response ID/], [{ ambiguousResponse: true }, /exactly one/],
    [{ exitAction: true }, /exited/], [{ hangAction: true }, /timed out/],
  ] as const)('fails uncertain physical actions closed: %j', async (config, message) => {
    const b = backend(config); await b.start();
    await expect(b.execute({ kind: 'key', key: 'Tab' })).rejects.toThrow(message);
    await expect(b.execute({ kind: 'key', key: 'Tab' })).rejects.toThrow();
  });
  it('does not send any prefix of an unsupported destructive replacement', async () => {
    const log = join(await directory(), 'commands.jsonl'); const b = backend({ log });
    await b.start();
    await expect(b.execute({ kind: 'replaceText', text: 'safe prefix\nunsafe' })).rejects.toThrow(/printable ASCII/);
    await b.execute({ kind: 'key', key: 'Tab' }); await b.close();
    const commands = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(commands.filter(command => command.method === 'input.pressKeys').map(command => command.params.keys)).toEqual([['Tab']]);
  });
  it('serializes execution/observation and rejects overlapping operations', async () => {
    const b = backend({ ackDelay: 40 }); await b.start();
    const execution = b.execute({ kind: 'key', key: 'Tab' });
    await expect(b.observe()).rejects.toThrow(/Concurrent/);
    await expect(b.execute({ kind: 'key', key: 'Tab' })).rejects.toThrow(/Concurrent/);
    await execution;
    const observation = b.observe();
    await expect(b.execute({ kind: 'key', key: 'Tab' })).rejects.toThrow(/Concurrent/);
    await observation;
  });
  it('cancels a command before native dispatch when a command journal subscriber aborts', async () => {
    const log = join(await directory(), 'commands.jsonl'); const b = backend({ log });
    const controller = new AbortController(); await b.start();
    b.subscribe(event => { if (event.type === 'command' && event.method === 'input.pressKeys') controller.abort(new Error('user cancelled')); });
    await expect(b.execute({ kind: 'typeText', text: 'Never type' }, { signal: controller.signal })).rejects.toThrow(/user cancelled/);
    expect(await readFile(log, 'utf8')).not.toContain('input.pressKeys');
  });
  it('aborts a pending command, stops the session and never sends the remaining text', async () => {
    const log = join(await directory(), 'commands.jsonl'); const b = backend({ log, hangAction: true });
    const controller = new AbortController(); await b.start();
    const pending = b.execute({ kind: 'typeText', text: 'abc' }, { signal: controller.signal });
    setTimeout(() => controller.abort(new Error('cancel pending')), 20);
    await expect(pending).rejects.toThrow(/cancel pending/);
    const commands = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(commands.filter(command => command.method === 'input.pressKeys')).toHaveLength(1);
    expect(commands.at(-1).method).toBe('session.stop');
    await expect(b.execute({ kind: 'key', key: 'Tab' })).rejects.toThrow();
  });
  it('does not accept a late ACK or speech after a cancelled command begins shutdown', async () => {
    const log = join(await directory(), 'commands.jsonl');
    const b = backend({ log, ackDelay: 45, outputAfterAck: 50, ignoreStop: true }, { closeTimeoutMs: 100 });
    const events: OrcaEvent[] = []; b.subscribe(event => events.push(event));
    const controller = new AbortController(); await b.start(); await b.observe();
    const pending = b.execute({ kind: 'typeText', text: 'abc' }, { signal: controller.signal });
    setTimeout(() => controller.abort(new Error('cancel before ACK')), 15);
    await expect(pending).rejects.toThrow(/cancel before ACK/);
    expect(events.filter(event => event.type === 'response' && event.commandId === 2)).toEqual([]);
    expect(events.filter(event => event.type === 'output')).toEqual([]);
    const commands = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(commands.filter(command => command.method === 'input.pressKeys')).toHaveLength(1);
    await expect(b.observe()).rejects.toThrow();
  });
  it('closes on a stale native target instead of dispatching remaining text to another window', async () => {
    const log = join(await directory(), 'commands.jsonl'); const b = backend({ log, actionError: true });
    await b.start();
    await expect(b.execute({ kind: 'typeText', text: 'abc' })).rejects.toThrow(/lost focus/);
    const commands = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(commands.filter(command => command.method === 'input.pressKeys')).toHaveLength(1);
    expect(commands.at(-1).method).toBe('session.stop');
    await expect(b.execute({ kind: 'key', key: 'Tab' })).rejects.toThrow();
  });
  it('cancels observation and supports idempotent close', async () => {
    const b = backend({}, { quietMs: 500 }); const controller = new AbortController(); await b.start();
    const pending = b.observe({ signal: controller.signal }); controller.abort(new Error('cancel observation'));
    await expect(pending).rejects.toThrow(/cancel observation/);
    await Promise.all([b.close(), b.close()]);
    await expect(b.observe()).rejects.toThrow();
  });
  it('rejects already-aborted operations without launching or executing', async () => {
    const b = backend(); const controller = new AbortController(); controller.abort(new Error('already cancelled'));
    await expect(b.start({ signal: controller.signal })).rejects.toThrow(/already cancelled/);
    await b.start();
    await expect(b.execute({ kind: 'key', key: 'Tab' }, { signal: controller.signal })).rejects.toThrow(/already cancelled/);
  });
  it('does not resurrect a session closed by a startup-response subscriber', async () => {
    const b = backend();
    b.subscribe(event => { if (event.type === 'response') void b.close(); });
    await expect(b.start()).rejects.toThrow(/closed during startup/);
    await expect(b.observe()).rejects.toThrow(/not ready/);
  });
  it.skipIf(process.platform !== 'linux')('runs the real Python bridge and fails closed without DISPLAY before claiming native readiness', async () => {
    const b = backend({}, { bridgeCommand: ['/usr/bin/env', 'DISPLAY=', 'DBUS_SESSION_BUS_ADDRESS=', '/usr/bin/python3', fileURLToPath(new URL('../packages/screenreaders/native/orca_bridge.py', import.meta.url))] });
    const events: OrcaEvent[] = []; b.subscribe(event => events.push(event));
    await expect(b.start()).rejects.toThrow(/real X11 DISPLAY/);
    expect(events.filter(event => event.type === 'output')).toEqual([]);
    expect(events.some(event => event.type === 'response' && event.error?.includes('DISPLAY'))).toBe(true);
    await expect(b.execute({ kind: 'key', key: 'Tab' })).rejects.toThrow();
  });
  it('inherits runner privacy taint for raw key events and delayed speech echoes', async () => {
    const b = backend({ echo: true }); const outDir = await directory();
    // This is a Node transport fixture, not Linux native runtime evidence.
    // The Linux-only host rule lives in OrcaBackend.preflight; this transport fixture runs on any host.
    vi.spyOn(b, 'preflight').mockImplementation(() => {});
    const browser = pairedBrowser();
    const trace = await runTask({ url: 'https://example.test', goal: 'Enter named input', input: { q: 'z' }, maxSteps: 2, timeoutMs: 3_000, verify: { all: [{ titleIncludes: 'Done' }] } }, {
      backend: b, outDir, policy: new ScriptedPolicy([{ action: { kind: 'typeText', input: 'q' } }]), browserSessionFactory: async () => browser, verifier: async () => ({ passed: true, failures: [] }),
    });
    expect(trace.outcome?.status).toBe('success');
    const inputCommands = trace.events.filter(event => event.type === 'backend.command' && JSON.stringify(event.data).includes('input.pressKeys'));
    expect(inputCommands).toHaveLength(1); expect(inputCommands[0]?.redacted).toBe(true);
    expect(trace.events.filter(event => event.type === 'backend.output').every(event => event.redacted)).toBe(true);
    expect(await readFile(join(outDir, 'trace.json'), 'utf8')).not.toContain('"text": "z"');
  });
  it('synchronously aborts real adapter dispatch when the common runner cannot persist its command journal', async () => {
    const outDir = await directory(); const log = join(outDir, 'native-requests.jsonl');
    const b = backend({ log }); const browser = pairedBrowser();
    // The Linux-only host rule lives in OrcaBackend.preflight; this transport fixture runs on any host.
    vi.spyOn(b, 'preflight').mockImplementation(() => {});
    const policy = new ScriptedPolicy([
      { action: { kind: 'typeText', input: 'q' } },
      { action: { kind: 'key', key: 'Tab' } },
    ]);
    const decide = vi.spyOn(policy, 'decide');
    const verifier = vi.fn(async () => ({ passed: false, failures: ['not complete'] }));
    const append = TraceRecorder.prototype.append;
    let failedCommandWrites = 0;
    const failing = vi.spyOn(TraceRecorder.prototype, 'append').mockImplementation(function (this: TraceRecorder, ...args: Parameters<TraceRecorder['append']>) {
      if (args[0] === 'backend.command' && (args[1] as { method?: string })?.method === 'input.pressKeys') {
        failedCommandWrites += 1;
        throw new Error('Disk unavailable while journaling native input');
      }
      return append.call(this, ...args);
    });
    try {
      const trace = await runTask({ url: 'https://example.test', goal: 'Enter named input', input: { q: 'never type this' }, maxSteps: 3, timeoutMs: 3_000, verify: { all: [{ titleIncludes: 'Done' }] } }, {
        backend: b, outDir, policy, headless: false, browserSessionFactory: async () => browser, verifier,
      });
      expect(trace.outcome).toMatchObject({ status: 'failure', reason: 'trace-persistence-error', stage: 'action', step: 1 });
      expect(failedCommandWrites).toBe(1);
      expect(decide).toHaveBeenCalledTimes(1); expect(verifier).not.toHaveBeenCalled();
      const commands = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      expect(commands.map(command => command.method)).toEqual(['session.start', 'session.stop']);
      expect(browser.close).toHaveBeenCalledTimes(1);
      expect((JSON.parse(await readFile(join(outDir, 'trace.json'), 'utf8'))).outcome.reason).toBe('trace-persistence-error');
      await expect(b.execute({ kind: 'key', key: 'Tab' })).rejects.toThrow();
    } finally { failing.mockRestore(); decide.mockRestore(); }
  });
});
