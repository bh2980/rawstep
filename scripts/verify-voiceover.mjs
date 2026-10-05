/** Opt-in real native slice. Does not install/start AT Driver, VoiceOver, or model services. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runCli } from '@rawstep/cli/cli';
import { runTask } from '@rawstep/browser/runner';
import { createBrowserSession } from '@rawstep/browser/browser';
import { readTrace, writeJsonAtomic } from '@rawstep/core/trace';

const [endpoint, destination, ...decisionFlags] = process.argv.slice(2);
assert.equal(process.platform, 'darwin', 'VoiceOver verification requires macOS.');
assert.ok(endpoint && destination, 'Usage: node scripts/verify-voiceover.mjs ws://127.0.0.1:PORT NEW_OUT_DIR [--decision-* overrides]');
const url = new URL(endpoint);
assert.ok(['ws:', 'wss:'].includes(url.protocol) && ['localhost','127.0.0.1','[::1]'].includes(url.hostname) && !url.username && !url.password, 'Native AT endpoint must be credential-free loopback.');
const out = resolve(destination); await mkdir(out, { recursive:false });
await writeJsonAtomic(join(out,'native-evidence.json'),{status:'incomplete',receipts:[],limitations:['No native success may be claimed until every required run completes.']});
const browserFlags = process.env.RAWSTEP_TEST_BROWSER_PATH ? ['--browser-executable', process.env.RAWSTEP_TEST_BROWSER_PATH] : [];
const task = { id:'native-voiceover-slice', url:pathToFileURL(resolve('fixtures/native-voiceover.html')).href,
  goal:'Find and activate the Finish check button', maxSteps:20, timeoutMs:120_000,
  verify:{all:[{titleIncludes:'Rawstep Native Done'},{textVisibleExact:'Native check finished'},{domEventSeen:{selector:'#finish',event:'click'}}]} };
await writeJsonAtomic(join(out,'task.json'),task);
await writeJsonAtomic(join(out,'script.json'),[{action:{kind:'key',key:'Tab'}},{action:{kind:'intent',intent:'activate'}}]);
let ownedBrowser = 0;
const receipts=[];
for (const mode of ['scripted','systemone']) {
  assert.equal(ownedBrowser,0,'Previous browser cleanup did not finish; refusing another launch.');
  const output = join(out,mode);
  const code = await runCli(['run',join(out,'task.json'),'--backend','voiceover','--endpoint',endpoint,'--out',output,...browserFlags,
    ...(mode==='scripted'?['--script',join(out,'script.json')]:['--decision','systemone',...decisionFlags])], {
    runTask:(task,options)=>runTask(task,{...options,browserSessionFactory:async(url,opts)=>{
      const browser=await createBrowserSession(url,{...opts,headless:false});ownedBrowser++;
      const close=browser.close.bind(browser);let closing;
      browser.close=()=>closing??=close().then(()=>{ownedBrowser--;});return browser;
    }}),
  });
  const trace=await readTrace(output);
  const nativeSpeech=trace.events.filter(e=>e.source==='screen-reader' && ['backend.output','screen-reader.output'].includes(e.type) && !e.redacted && typeof (e.data?.output?.text??e.data?.text)==='string' && (e.data?.output?.text??e.data?.text).trim());
  receipts.push({mode,runId:trace.runId,outcome:trace.outcome,nativeSpeechEventIds:nativeSpeech.map(e=>e.id),environment:trace.environment,browserCleanupCompleted:ownedBrowser===0});
  await writeJsonAtomic(join(out,'native-evidence.json'),{status:'incomplete',receipts});
  assert.equal(ownedBrowser,0,'Owned browser was not closed.');
  assert.equal(code,0,`${mode} native execution failed; inspect its saved trace.`);
  assert.equal(trace.environment.observationProvenance,'native');
  assert.ok(nativeSpeech.length,'No captured native speech; protocol success is insufficient.');
}
await writeJsonAtomic(join(out,'native-evidence.json'),{status:'passed',receipts,limitations:['Task slice only, not accessibility certification. Cancellation/connection-loss regressions are separately covered by transport tests.']});
console.log(`Native evidence: ${join(out,'native-evidence.json')}`);
