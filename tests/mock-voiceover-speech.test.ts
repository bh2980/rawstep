import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {describe,expect,it} from 'vitest';
import {formatVoiceOverSpeech,type VoiceOverSpeechContext,type VoiceOverSpeechTarget,type SimulatedSemanticNode} from '@rawstep/screenreaders/mock-voiceover';
import {normalize,splitSpeech} from '../packages/vo-corpus/src/compare.js';

const semantic=(value:Partial<SimulatedSemanticNode>):SimulatedSemanticNode=>({role:'button',name:'',protected:false,disabled:false,readonly:false,required:false,multiline:false,modal:false,...value});
const fixture=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-context-return-2026-10-15.json',import.meta.url),'utf8')) as {
  inputs:{id:string;html:string;htmlSha256:string}[];
  nativeProfiles:{referenceBrowser:'safari'|'chrome';sourceRecordsSha256:string;cases:{id:string;assertFullSpeech:boolean;steps:{chord:string;keyboardFocusId:string;utterances:{text:string}[]}[]}[]}[];
};

// Supply the observed target and shared HTML context; no navigation or reference speech enters the formatter.
function targetFromInput(document:Document,id:string):VoiceOverSpeechTarget{
  const element=document.getElementById(id)!;
  expect(element?.tagName).toBe('BUTTON');
  const ancestors:Element[]=[];
  for(let parent=element.parentElement;parent;parent=parent.parentElement)ancestors.unshift(parent);
  const all=[...document.querySelectorAll('*')];
  const containers=ancestors.flatMap(parent=>{
    const role=parent.getAttribute('role')??({SECTION:'region',ARTICLE:'article',TABLE:'table'} as Record<string,string>)[parent.tagName];
    if(!role)return [];
    const label=parent.getAttribute('aria-label'),name=label??(role==='article'?parent.querySelector('h1,h2,h3,h4,h5,h6')?.textContent??'':role==='table'?parent.querySelector('caption')?.textContent??'':'');
    return [{id:String(all.indexOf(parent)),name,role,items:parent.querySelectorAll('button').length,
      ...(role==='article'&&!label?{inferredName:true}:{}),
      ...(role==='table'?{rows:parent.querySelectorAll('tr').length,columns:parent.querySelector('tr')?.children.length}:{}),
    }];
  });
  return {identity:id,semantic:semantic({name:element.textContent??''}),containers};
}

describe('speech engine with caller-owned target and history',()=>{
  it.each(fixture.nativeProfiles)('replays native $referenceBrowser context speech without launching a browser',profile=>{
    expect(profile.sourceRecordsSha256).toMatch(/^[a-f0-9]{64}$/);
    let matched=0,unresolved=0;
    for(const c of profile.cases){
      const input=fixture.inputs.find(input=>input.id===c.id)!;
      expect(createHash('sha256').update(input.html).digest('hex')).toBe(input.htmlSha256);
      const dom=new JSDOM(input.html);
      try{
        let context:VoiceOverSpeechContext={containers:[]};
        for(const [index,step]of c.steps.entries()){
          const result=formatVoiceOverSpeech({target:targetFromInput(dom.window.document,step.keyboardFocusId),command:step.chord==='Tab'?'next_focusable_item':'previous_focusable_item',referenceBrowser:profile.referenceBrowser},context);
          const actual=normalize(result.speech),expected=normalize(splitSpeech(step.utterances).main);
          if(c.assertFullSpeech)expect(actual,`${c.id} step ${index}`).toBe(expected);
          if(actual===expected)matched++;else unresolved++;
          context=result.context;
        }
      }finally{dom.window.close();}
    }
    // Preserve the known Chrome inferred-article naming gap instead of feeding its observed answer into input.
    expect({matched,unresolved}).toEqual(profile.referenceBrowser==='safari'?{matched:36,unresolved:0}:{matched:32,unresolved:4});
  });

  it('changes the same target wording with prior scope, without mutating caller history',()=>{
    const target:VoiceOverSpeechTarget={identity:'save',semantic:semantic({name:'Save'}),containers:[{id:'region',name:'Preferences',role:'region',items:2}]};
    const previous:VoiceOverSpeechContext={containers:['region'],focusContext:'region'};
    const snapshot=structuredClone(previous);
    expect(formatVoiceOverSpeech({target,command:'next_focusable_item'},previous).speech).toBe('Save button');
    expect(formatVoiceOverSpeech({target,command:'next_focusable_item'},{containers:['region','group'],focusContext:'group'}).speech).toBe('Save button Preferences region');
    expect(previous).toEqual(snapshot);
  });

  it('uses previous row and column rather than a fixed table suffix',()=>{
    const target:VoiceOverSpeechTarget={identity:'cell',semantic:semantic({role:'cell',name:'42'}),cell:{table:'table',row:1,column:1,rows:3,columns:2,header:'Amount',rowSpan:1,columnSpan:1}};
    const first=formatVoiceOverSpeech({target,command:'next_item'});
    expect(first.speech).toBe('row 2 of 3 Amount 42 column 2 of 2');
    expect(formatVoiceOverSpeech({target,command:'read_current'},first.context).speech).toBe('42');
    const next={...target,cell:{...target.cell!,row:2}};
    expect(formatVoiceOverSpeech({target:next,command:'next_item'},first.context).speech).toBe('row 3 of 3 42 column 2 of 2');
    target.cell!.row=99;
    expect(first.context.cell?.row).toBe(1);
  });

  it('uses actual edit selection and checked transition inputs, keeping protected values private',()=>{
    const target:VoiceOverSpeechTarget={identity:'field',semantic:semantic({role:'textbox',name:'Note',tagName:'input',value:'abc'})};
    expect(formatVoiceOverSpeech({target,command:'next_focusable_item',focused:true,focusEntry:true,edit:{value:'abc',start:0,end:3,multiline:false}}).speech).toBe('abc contents selected Note edit text');
    const protectedTarget={...target,semantic:{...target.semantic,protected:true,value:'secret'}};
    const secure=formatVoiceOverSpeech({target:protectedTarget,command:'next_focusable_item',focused:true,focusEntry:true,edit:{value:'secret',start:0,end:6,multiline:false}});
    expect(secure.speech).toBe('Note secure text field');expect(secure.usageHint).toBeUndefined();
    const checkbox={identity:'check',semantic:semantic({role:'checkbox',name:'Updates',checked:true})};
    expect(formatVoiceOverSpeech({target:checkbox,command:'next_item'}).speech).toBe('Updates checked checkbox');
    expect(formatVoiceOverSpeech({target:checkbox,command:'activate_form_control',checkedStateChanged:true}).speech).toBe('checked Updates checkbox');
  });
});
