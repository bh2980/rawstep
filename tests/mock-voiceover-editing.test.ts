import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {expect,it} from 'vitest';
import {formatVoiceOverEditing,type VoiceOverEditingInput,type VoiceOverEditState} from 'rawstep/mock-voiceover';

const edit=(value:string,start=value.length,end=start):VoiceOverEditState=>({value,start,end,multiline:false});
const input:VoiceOverEditingInput={target:{identity:'note',semantic:{role:'textbox',tagName:'input',name:'Note',protected:false,disabled:false,readonly:false,required:false,multiline:false,modal:false}},command:'enter_text',text:'r',before:edit('sta'),after:edit('star'),beforeFocus:'note',focus:'note'};

it('formats an already performed edit without changing caller state or moving a target',()=>{
 const context={containers:['preferences'],focusContext:'preferences'},original=structuredClone({input,context});
 const result=formatVoiceOverEditing(input,context);
 expect(result).toMatchObject({status:'approximation',evidenceProvenance:'simulation',nativeParityEstablished:false,utterances:['r','star'],context});
 expect({input,context}).toEqual(original);result.context.containers=['changed'];expect(context.containers).toEqual(['preferences']);
});

it('uses the previous selection for replacement, deletion and caret receipts',()=>{
 const cases:[Partial<VoiceOverEditingInput>,string[]][]=[
  [{text:'e',before:edit('star',0,4),after:edit('e')},['selection replaced e']],
  [{command:'Backspace',before:edit('star'),after:edit('sta')},['r']],
  [{command:'ArrowLeft',before:edit('star',0,4),after:edit('star',0)},['s']],
  [{command:'ControlOrMeta+A',before:edit('star'),after:edit('star',0,4)},['Select All','star selected']],
  [{command:'Home',before:edit('star'),after:edit('star',0)},[]],
 ];
 for(const [changes,utterances]of cases)expect(formatVoiceOverEditing({...input,...changes})).toMatchObject({status:'approximation',utterances});
});

it('reports unsupported or unmeasured inputs without returning guessed utterances',()=>{
 for(const changes of [
  {before:undefined},{beforeFocus:'other'},{focus:'other'},{command:'Tab'},{command:'enter_text',text:'several'},
  {before:edit('star',-1)},{after:edit('star',0,99)},
  {target:{...input.target,semantic:{...input.target.semantic,protected:true}}},
 ]){const result=formatVoiceOverEditing({...input,...changes});expect(result.status).toBe('unsupported');expect(result).not.toHaveProperty('utterances');}
 expect(()=>formatVoiceOverEditing({...input,referenceBrowser:'other' as never})).toThrow(/browser/i);
});

it('does not pretend a redirected or rejected edit had the ordinary insertion/deletion receipt',()=>{
 for(const changes of [
  {after:edit('STA')},
  {after:edit('star',1)},
  {command:'Backspace',before:edit('star'),after:edit('star')},
  {command:'ArrowLeft',before:edit('star'),after:edit('changed',0)},
 ]){
  const result=formatVoiceOverEditing({...input,...changes});expect(result.status).toBe('unsupported');expect(result).not.toHaveProperty('utterances');
 }
});

const fixture=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/voiceover-evidence/native-practical-speech-tasks-2026-10-16.json.gz',import.meta.url))).toString()) as {profiles:{browser:'safari'|'chrome';rows:any[]}[]};
it.each(fixture.profiles)('$browser preserved task edits keep old predictions and expose literal Native differences',p=>{
 const rows=p.rows.filter((r:any)=>r.caseId.endsWith('support-search')&&[1,2,3,10,11].includes(r.step));let literalMatches=0;
 for(const row of rows){
  const state=(s:any)=>{const c=s.controls.query;return edit(c.value,c.selectionStart,c.selectionEnd);};
  const before=state(row.beforeState),after=state(row.afterState);
  // AX focus supplies the editing recipient, independently of the unmeasured VO caret/reading position.
  for(const [dump,s]of [[row.nativeInputObservation.before,before],[row.nativeInputObservation.dump,after]]){
   const fields:any[]=[];const visit=(n:any)=>{if(n.AXDOMIdentifier==='query')fields.push(n);for(const c of n.children??[])visit(c);};visit(dump.root);
   expect(fields).toHaveLength(1);expect(fields[0]).toMatchObject({AXFocused:true,AXValue:s.value,AXSelectedTextRange:{location:s.start,length:s.end-s.start}});
  }
  const result=formatVoiceOverEditing({...input,target:{...input.target,identity:'query'},beforeFocus:'query',focus:'query',referenceBrowser:p.browser,before,after,command:row.chord==='Left'?'ArrowLeft':row.chord==='Right'?'ArrowRight':'enter_text',text:row.chord.length===1?row.chord:undefined});
  expect(result.status).toBe('approximation');if(result.status!=='approximation')throw new Error(result.reason);
  expect(result.utterances).toEqual(row.prediction.utterances);
  if(JSON.stringify(result.utterances)===JSON.stringify(row.utterances.map((u:any)=>u.text)))literalMatches++;
  expect(row.evaluation.eligible).toBe(false);
 }
 expect(rows).toHaveLength(5);expect(literalMatches).toBe(p.browser==='safari'?4:2);
});
