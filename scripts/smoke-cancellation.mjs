/** Executed from the isolated installed-package project by smoke-package.mjs. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { AtDriverBackend, TraceRecorder } from 'rawstep';
import { runTask } from 'rawstep/runner';
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

console.log(JSON.stringify({journalFailure:failureResult,nativeScreenReaderTested:false}));
