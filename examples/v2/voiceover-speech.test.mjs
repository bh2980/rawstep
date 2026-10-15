import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatVoiceOverSpeech} from 'rawstep/mock-voiceover';

for(const referenceBrowser of ['safari','chrome'])test(`${referenceBrowser}: caller supplies target and prior context`,()=>{
  const target={
    identity:'save',
    semantic:{role:'button',name:'Save',protected:false,disabled:false,readonly:false,required:false,multiline:false,modal:false},
    containers:[{id:'settings',role:'region',name:'Preferences',items:2}],
  };
  const input={target,command:'next_focusable_item',referenceBrowser};
  const entry=formatVoiceOverSpeech(input);
  assert.equal(entry.speech,'Save button Preferences region');
  const within=formatVoiceOverSpeech(input,entry.context);
  assert.equal(within.speech,'Save button');
  const outside=formatVoiceOverSpeech({...input,target:{...target,identity:'outside',containers:[]}},within.context);
  const returning=formatVoiceOverSpeech(input,outside.context);
  assert.equal(returning.speech,entry.speech);
  assert.match(returning.usageHint,/on a button/);
});

for(const referenceBrowser of ['safari','chrome'])test(`${referenceBrowser}: caller distinguishes inline description from help`,()=>{
  const semantic={role:'button',name:'Print copies.',protected:false,disabled:false,readonly:false,required:false,multiline:false,modal:false};
  const input={target:{identity:'print',semantic},command:'next_focusable_item',referenceBrowser};
  const inline=formatVoiceOverSpeech({...input,target:{...input.target,semantic:{...semantic,description:'Copies, not originals.',hasMoreContent:true}}});
  assert.equal(inline.speech,'Print copies. Copies, not originals. button');
  assert.match(inline.usageHint,/bring up the more content menu/);
  const tooltip=formatVoiceOverSpeech({...input,target:{...input.target,semantic:{...semantic,help:'Copies, not originals.',hasMoreContent:false}}});
  assert.equal(tooltip.speech,'Print copies. button');
  assert.match(tooltip.usageHint,/^Copies, not originals\.  You are currently/);
  assert.doesNotMatch(tooltip.usageHint,/more content menu/);
});

for(const referenceBrowser of ['safari','chrome'])test(`${referenceBrowser}: VO activation uses the observed browser wording`,()=>{
  const semantic={role:'checkbox',name:'Backup reminders',checked:true,protected:false,disabled:false,readonly:false,required:false,multiline:false,modal:false};
  const result=formatVoiceOverSpeech({target:{identity:'backup',semantic},command:'activate_button',checkedStateChanged:true,referenceBrowser});
  assert.equal(result.speech,referenceBrowser==='chrome'?'checked':'checked Backup reminders checkbox');
  assert.equal(result.usageHint,undefined);
});
