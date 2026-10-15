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
