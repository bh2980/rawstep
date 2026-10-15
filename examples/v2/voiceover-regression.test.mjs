import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveTask,ScriptedPolicy} from 'rawstep';
import {runMockVoiceOverTask} from 'rawstep/mock-voiceover';
import {createBrowserSession} from 'rawstep/browser';

for(const referenceBrowser of ['safari','chrome'])for(const disabled of [false,true]){
  test(`${referenceBrowser}: keyboard workflow ${disabled?'detects an injected disabled-control regression':'saves twice'}`,async()=>{
    const directory=await mkdtemp(join(tmpdir(),'rawstep-voiceover-test-'));
    try{
      const task=resolveTask({url:new URL('../../fixtures/mock-voiceover-system.html',import.meta.url).href,
        goal:'Save twice using the keyboard.',maxSteps:5,timeoutMs:30000,
        verify:{all:[{titleIncludes:'Mock VoiceOver demo completed'}]}},process.cwd());
      const trace=await runMockVoiceOverTask(task,{outDir:join(directory,'run'),referenceBrowser,
        ...(process.env.RAWSTEP_TEST_BROWSER_PATH?{browserExecutablePath:process.env.RAWSTEP_TEST_BROWSER_PATH}:{}),
        policy:new ScriptedPolicy([
          {action:{kind:'key',key:'Tab'}},
          {action:{kind:'key',key:'Space'}},
          {action:{kind:'key',key:'Space'}},
          {stop:'success'},
        ]),
        ...(disabled?{browserSessionFactory:async(url,options)=>{
          const session=await createBrowserSession(url,options);
          try{await session.page.locator('#save').evaluate(button=>{button.disabled=true;});return session;}
          catch(error){await session.close();throw error;}
        }}:{}),
      });
      // A policy saying "success" must never override independently unmet page outcomes.
      assert.equal(trace.outcome.status,disabled?'failure':'success');
      assert.equal(trace.outcome.reason,disabled?'verification-failed':'verified');
      const heard=trace.events.filter(event=>event.type==='simulation.observation').flatMap(event=>event.data.speech);
      if(!disabled){assert.ok(heard.includes('Save button'));assert.ok(heard.some(text=>text.includes('Saved 2 times')));}
    }finally{await rm(directory,{recursive:true,force:true});}
  });
}
