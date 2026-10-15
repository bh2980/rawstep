import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,writeFile,readFile,rm,appendFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {archiveCaseInputs} from '../src/archive.js';
import {casesFingerprint,type CaseSet,type CaseRecord} from '../src/cases.js';

const run=promisify(execFile);
test('analysis honors the pre-capture plan, retains missing planned actions and rejects recorded unplanned cases',async()=>{
  const root=await mkdtemp(join(tmpdir(),'vo-plan-')),casesDir=join(root,'cases'),native=join(root,'native'),model=join(root,'model');
  try{
    await mkdir(casesDir);
    const set:CaseSet={id:'frozen',generatedAt:'fixed',syntheticInputs:true,cases:['a','b','c'].map(id=>({id,page:id+'.html',chords:['Tab'],axes:{partition:'train'}}))};
    await writeFile(join(casesDir,'cases.json'),JSON.stringify(set));
    for(const c of set.cases)await writeFile(join(casesDir,c.page),'<button>Public fixture</button>');
    const hash=await casesFingerprint(casesDir,set);
    const record=(id:string,source:CaseRecord['source']):CaseRecord=>({caseSet:set.id,caseId:id,source,start:{aligned:true,speech:[]},steps:[{chord:'Tab',utterances:[{t:1,text:'Public fixture button'}],reason:'quiet'}]});
    for(const [dir,source,ids] of [[native,'voiceover',['a','b']],[model,'simulator',['a','b','c']]] as const){
      const inputArchive=await archiveCaseInputs(casesDir,dir,set,hash);
      await writeFile(join(dir,'meta.json'),JSON.stringify({caseSet:set.id,casesGeneratedAt:set.generatedAt,casesSha256:hash,inputArchive,plannedCaseIds:ids,machine:{browser:{name:'chrome'}},referenceBrowser:'chrome'}));
      await writeFile(join(dir,'records.jsonl'),(source==='voiceover'?['a']:ids).map(id=>JSON.stringify(record(id,source))).join('\n')+'\n');
    }
    const cli=fileURLToPath(new URL('../src/analyze.ts',import.meta.url));
    await run(process.execPath,['--import','tsx',cli,casesDir,native,model,join(root,'analysis'),'train']);
    const report=JSON.parse(await readFile(join(root,'analysis/summary.json'),'utf8'));
    assert.equal(report.capturePlan.caseSetCases,3);
    assert.deepEqual(report.capturePlan.nativePlannedCaseIds,['a','b']);
    assert.equal(report.metrics.all.planned,2);
    assert.equal(report.metrics.all.matched,1);
    assert.equal(report.metrics.verdicts.missing,1);
    assert.match(report.evaluatorSourceHashes['state.ts'],/^[a-f0-9]{64}$/);
    const validator=fileURLToPath(new URL('../src/validate.ts',import.meta.url));
    await run(process.execPath,['--import','tsx',validator,casesDir,native,model,join(root,'validation')]);
    const validation=await readFile(join(root,'validation/validation.json'),'utf8');
    assert.equal(JSON.parse(validation).all.planned,2);
    await assert.rejects(run(process.execPath,['--import','tsx',validator,casesDir,native,model,join(root,'validation')]),/EEXIST/);
    assert.equal(await readFile(join(root,'validation/validation.json'),'utf8'),validation);
    await appendFile(join(native,'records.jsonl'),JSON.stringify(record('c','voiceover'))+'\n');
    await assert.rejects(run(process.execPath,['--import','tsx',cli,casesDir,native,model,join(root,'invalid'),'train']),/unplanned case/);
  }finally{await rm(root,{recursive:true,force:true});}
});
