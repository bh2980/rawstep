import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {replayCase} from '../src/replay.js';
import {nativePageState} from '../src/state.js';
import {evaluateTaskOutcome} from '../src/task-outcomes.js';
import {casesFingerprint,type Case,type CaseSet} from '../src/cases.js';
import type {AxNode} from '../src/axdump.js';

type Evidence={caseSetMetadata:Pick<CaseSet,'id'|'generatedAt'|'syntheticInputs'>;sourceCasesSha256:string;inputs:{case:Case;html:string;htmlSha256:string}[];nativeProfiles:{browser:'safari'|'chrome';sourceRecordsSha256:string;cases:{caseId:string;selectedFinalAXNodes:AxNode[];sourceFinalAXSha256:string}[]}[]};
const evidence=JSON.parse(await readFile(new URL('./native-practical-task-outcomes.json',import.meta.url),'utf8')) as Evidence;

test('supported practical workflows satisfy frozen native task outcomes through the public simulator runner',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'vo-practical-tasks-'));
  const set:CaseSet={...evidence.caseSetMetadata,cases:evidence.inputs.map(c=>c.case)};
  try{
    for(const item of evidence.inputs){
      assert.equal(createHash('sha256').update(item.html).digest('hex'),item.htmlSha256);
      const path=join(dir,item.case.page);await mkdir(dirname(path),{recursive:true});await writeFile(path,item.html);
    }
    await writeFile(join(dir,'cases.json'),JSON.stringify(set,null,2));
    assert.equal(await casesFingerprint(dir,set),evidence.sourceCasesSha256,'HTML, commands and outcome targets must match the pre-observation input fingerprint');
    for(const profile of evidence.nativeProfiles)for(const item of evidence.inputs){
      const native=profile.cases.find(c=>c.caseId===item.case.id)!;
      assert.match(profile.sourceRecordsSha256,/^[a-f0-9]{64}$/);assert.match(native.sourceFinalAXSha256,/^[a-f0-9]{64}$/);
      const nativeState=nativePageState({app:profile.browser,pid:0,windowTitle:'Derived final-state subset',timestamp:'',nodeCount:native.selectedFinalAXNodes.length,truncated:false,focusedPath:null,root:{children:native.selectedFinalAXNodes}});
      assert.equal(evaluateTaskOutcome(item.case.taskOutcome!,nativeState).status,'success','Original native outcome targets must remain independently satisfied');
      const replay=await replayCase(item.case,set,dir,undefined,profile.browser,process.env.RAWSTEP_TEST_BROWSER_PATH);
      assert.equal(replay.start.aligned,true);assert.equal(replay.error,undefined);assert.equal(replay.steps.length,item.case.chords.length);
      assert.equal(evaluateTaskOutcome(item.case.taskOutcome!,replay.steps.at(-1)?.state).status,'success',`${profile.browser} ${item.case.id}`);
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});
