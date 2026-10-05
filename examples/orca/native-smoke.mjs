#!/usr/bin/env node
/** Real native test only. Missing IPC/display is a blocker, never a mock fallback. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const command=promisify(execFile);
const here=dirname(fileURLToPath(import.meta.url));
const outDir=resolve(process.argv[2]??'orca-native-smoke');
await mkdir(outDir,{recursive:true});
const summary={schemaVersion:1,kind:'real-native-orca-smoke',liveSpeechVerified:false,audioVerified:false,status:'blocked'};
const save=()=>writeFile(resolve(outDir,'native-smoke-result.json'),JSON.stringify(summary,null,2)+'\n');
let session,backend;
try {
  if(process.platform!=='linux'||!process.env.DISPLAY||!process.env.DBUS_SESSION_BUS_ADDRESS)throw new Error('Run in an existing Linux X11 desktop with DISPLAY and DBUS_SESSION_BUS_ADDRESS. No service is auto-created.');
  await command('xdotool',['--version'],{timeout:5000});
  const {createBrowserSession}=await import('rawstep/browser');
  const {OrcaBackend}=await import('rawstep/orca');
  const {runTask}=await import('rawstep/runner');
  const url=new URL('./fixture.html',import.meta.url).href;
  const task={id:'orca-native-confirmation',mode:'screenreader',url,goal:'Choose Continue, then Confirm to complete the action.',maxSteps:6,timeoutMs:60000,verify:{all:[{textVisibleExact:'Action completed'},{titleIncludes:'Completed native Orca confirmation'}]}};
  session=await createBrowserSession(url,{headless:false,executablePath:process.env.RAWSTEP_NATIVE_BROWSER??'/usr/bin/chromium',verify:task.verify});
  // A setup-only unique title pairs the actual browser Page to one owned X11 window.
  // This is never a policy observation and is not used to generate speech.
  const title=`RawstepNativeOrca-${randomUUID()}`;
  await session.page.evaluate(value=>{document.title=value},title);
  await session.page.bringToFront();
  const {stdout}=await command('xdotool',['search','--sync','--onlyvisible','--name',title],{timeout:10000});
  const ids=[...new Set(stdout.trim().split(/\s+/).filter(Boolean).map(Number))];
  if(ids.length!==1||!Number.isSafeInteger(ids[0])||ids[0]<=1)throw new Error('Cannot uniquely bind the created browser page to its X11 window.');
  const targetWindowId=ids[0];
  session.nativeTargetWindowId=targetWindowId;
  // Activate only the newly-created, uniquely matched fixture window.
  await command('xdotool',['windowactivate','--sync',String(targetWindowId)],{timeout:5000});
  backend=new OrcaBackend({targetWindowId,quietMs:700,maxWaitMs:4000});
  let stage=0; const witnessed=[];
  const policy={decide({observation}){
    if(observation.kind!=='screenreader'||observation.provenance!=='native')return {stop:'stuck',rationale:'Expected real Orca observation'};
    const text=observation.speech.join(' '); witnessed.push(...observation.speech);
    if(stage===2&&/Action completed/i.test(text))return {stop:'success',rationale:'Orca announced completion'};
    if(stage===0&&/Continue/i.test(text)){stage=1;return {action:{kind:'key',key:'Enter'},rationale:'Activate the Continue control announced by Orca'}};
    if(stage===1&&/Confirm/i.test(text)){stage=2;return {action:{kind:'key',key:'Enter'},rationale:'Activate the Confirm control announced by Orca'}};
    return {stop:'stuck',rationale:'Required genuine Orca announcement was absent; no semantic fallback'};
  }};
  const trace=await runTask(task,{backend,policy,outDir:resolve(outDir,'trace'),headless:false,browserSessionFactory:async()=>session});
  summary.outcome=trace.outcome;
  summary.nativeSpeechCount=witnessed.length;
  summary.liveSpeechVerified=stage===2&&witnessed.some(s=>/Action completed/i.test(s));
  summary.status=summary.liveSpeechVerified&&trace.outcome.status==='success'?'passed':(['backend-start','browser-start'].includes(trace.outcome.stage)?'blocked':'failed');
  if(summary.status!=='passed')process.exitCode=1;
} catch(error) {
  summary.error=error instanceof Error?error.message:'Native smoke failed';
  process.exitCode=2;
} finally {
  await backend?.close().catch(()=>{});
  await session?.close().catch(()=>{});
  await save();
  console.log(JSON.stringify(summary,null,2));
}
