/** Executed from the isolated installed-package project by smoke-package.mjs. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { AtDriverBackend, TraceRecorder, readTrace, runTask } from 'rawstep';
import { mockAtDriverServer } from './mock-at-driver-server.mjs';

const root = process.cwd();
const binary = join(root, 'node_modules/rawstep/dist/cli/bin.js');
const fakeBrowser = {page:{bringToFront:async()=>{},evaluate:async()=>true},browser:{version:()=> 'explicit-mock'},takeBlockedNavigations:()=>[],takeNavigationGuardWarnings:()=>[],close:async()=>{}};
const server = await mockAtDriverServer();
const original = TraceRecorder.prototype.append;
let failureResult;
try {
  TraceRecorder.prototype.append = function(type, data, options) {
    if (type === 'backend.command' && options?.commandId === '3') throw new Error('Injected installed-package journal failure');
    return original.call(this, type, data, options);
  };
  const trace = await runTask({url:'https://example.test',goal:'Enter provided text',input:{q:'ABCDE'},verify:{all:[{titleIncludes:'Done'}]}},{
    backend:new AtDriverBackend({url:server.url,profile:'voiceover',quietMs:5,maxWaitMs:30}),outDir:join(root,'installed-journal-failure'),
    browserSessionFactory:async()=>fakeBrowser,verifier:async()=>({passed:false,failures:['missing']}),policy:{decide:()=>({action:{kind:'typeText',input:'q'}})}
  });
  assert.equal(trace.outcome.reason,'trace-persistence-error');
  assert.equal(server.commands.filter(command=>command.method==='interaction.userIntent').length,1);
  failureResult = {status:'passed',dispatchedKeys:1,remainingKeysPrevented:4};
} finally { TraceRecorder.prototype.append = original; await server.close(); }

function launch(args) {
  const child=spawn(process.execPath,[binary,...args],{cwd:root,env:process.env,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',data=>{stdout+=data;});child.stderr.on('data',data=>{stderr+=data;});
  const ended=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal,stdout,stderr}));});
  return {child,ended};
}
const signals=[];
let failureCli={status:'not-requested'};
if (process.env.RAWSTEP_TEST_BROWSER_PATH) {
  for(const signal of ['SIGINT','SIGTERM']) {
    const readiness=join(root,`ready-${signal}`),policy=join(root,`policy-${signal}.mjs`),out=join(root,`installed-${signal}`);
    await writeFile(policy,`import { writeFile } from 'node:fs/promises'; export default { async decide() { await writeFile(${JSON.stringify(readiness)}, 'ready'); return new Promise(()=>{}); } };`);
    const launched=launch(['screenshot-run','node_modules/rawstep/examples/v2/task.json','--policy',policy,'--browser-executable',process.env.RAWSTEP_TEST_BROWSER_PATH,'--out',out]);
    let ready=false;
    try {
      const deadline=Date.now()+15000;
      while(Date.now()<deadline) {
        ready=await access(readiness).then(()=>true,()=>false);
        if(ready)break;
        assert.equal(launched.child.exitCode,null,'CLI exited before the policy began');
        await delay(25);
      }
      assert.ok(ready,'Policy readiness was not observed');
      const started=Date.now();assert.ok(launched.child.kill(signal));
      let timeout;
      const result=await Promise.race([launched.ended,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Graceful cancellation did not complete')),10000);})]).finally(()=>clearTimeout(timeout));
      assert.equal(result.code,signal==='SIGINT'?130:143,result.stderr);assert.equal(result.signal,null);
      const trace=await readTrace(out);
      assert.ok(trace.outcome && trace.endedAt, 'CLI must finalize cancellation before exit: ' + JSON.stringify(result));
      assert.equal(trace.outcome.status,'aborted');assert.equal(trace.outcome.reason,'aborted');
      assert.equal(trace.outcome.cancellation.signal,signal);assert.equal(trace.outcome.stage,'policy');assert.equal(trace.outcome.step,1);
      assert.ok(trace.endedAt);assert.ok(trace.events.some(event=>event.type==='run.aborted'));
      assert.match(result.stderr,/policy/);assert.match(result.stderr,/rawstep report/);
      signals.push({signal,status:'passed',exitCode:result.code,elapsedMs:Date.now()-started});
    } finally { if(launched.child.exitCode===null)launched.child.kill('SIGTERM'); }
  }
  const script=join(root,'invalid-installed-decision.json'),out=join(root,'installed-rejected-action');
  await writeFile(script,JSON.stringify([{action:{kind:'key',key:'F13'}}]));
  const result=await launch(['screenshot-run','node_modules/rawstep/examples/v2/task.json','--script',script,'--browser-executable',process.env.RAWSTEP_TEST_BROWSER_PATH,'--out',out]).ended;
  assert.equal(result.code,1,result.stderr);assert.match(result.stderr,/not allowed/);assert.match(result.stderr,/policy/);assert.match(result.stderr,/rawstep report/);
  const trace=await readTrace(out);assert.ok(trace.events.some(event=>event.type==='policy.rejected'));
  failureCli={status:'passed',stage:trace.outcome.stage};
}
console.log(JSON.stringify({journalFailure:failureResult,signals,failureCli,nativeScreenReaderTested:false}));
