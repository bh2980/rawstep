import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {nativePressedState,type AxDump,type AxNode} from '../src/axdump.js';
import {nativePageState} from '../src/state.js';
const fixture=JSON.parse(readFileSync(new URL('../../../tests/fixtures/voiceover-evidence/native-button-state-speech-2026-10-15.json',import.meta.url),'utf8'));
test('both captured toggle subroles preserve false, true and mixed without inventing a checked state',()=>{
 for(const profile of fixture.profiles)for(const row of profile.rows){
  const node:AxNode=row.nativeTargetAx,expected=row.input.target.semantic.pressed;
  const state=nativePageState({truncated:false,focusedPath:null,root:{children:[node]}} as AxDump)!;
  if(expected===undefined){assert.equal(nativePressedState(node),undefined);continue;}
  assert.equal(nativePressedState(node),expected);
  assert.equal(state.controls.target!.pressed,expected);assert.equal(state.controls.target!.checked,undefined);
  assert.equal(state.objects![0]!.role,'button');
 }
 for(const subrole of ['AXToggle','AXToggleButton'])for(const value of [undefined,'',null,3]){
  const node={AXRole:'AXCheckBox',AXSubrole:subrole,AXValue:value,AXDOMIdentifier:'target'};
  assert.equal(nativePressedState(node),undefined);
  assert.equal(nativePageState({truncated:false,focusedPath:null,root:{children:[node]}} as AxDump)!.controls.target,undefined);
 }
});
