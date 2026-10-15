import assert from 'node:assert/strict';
import test from 'node:test';
import {evaluateTaskOutcome,summarizeTaskOutcomes,type TaskOutcome} from '../src/task-outcomes.js';
import {nativePageState,type PageState} from '../src/state.js';
import type {CaseRecord,CaseSet} from '../src/cases.js';

const oracle:TaskOutcome={controls:[{role:'textbox',name:'Contact',state:{value:'noa'}}],texts:['Registration saved']};
const state:PageState={focusId:null,controls:{},objects:[{id:'',role:'textbox',name:'Contact',state:{value:'noa'},focused:false}],texts:['Registration saved']};
test('task outcomes require independent control state and result text, not matching speech',()=>{
  assert.equal(evaluateTaskOutcome(oracle,state).status,'success');
  assert.equal(evaluateTaskOutcome(oracle,{...state,texts:[]}).status,'failed');
  assert.equal(evaluateTaskOutcome(oracle,{...state,objects:[{...state.objects![0]!,state:{value:'wrong'}}]}).status,'failed');
  assert.equal(evaluateTaskOutcome(oracle,{...state,objects:undefined}).status,'unmeasured');
  assert.equal(evaluateTaskOutcome(oracle,{...state,objects:[...state.objects!,...state.objects!]}).status,'unmeasured');
  assert.equal(evaluateTaskOutcome(oracle,{...state,objects:[{...state.objects![0]!,state:{}}]}).status,'unmeasured');
  assert.equal(evaluateTaskOutcome(oracle,{...state,texts:undefined}).status,'unmeasured');
  assert.throws(()=>evaluateTaskOutcome({controls:[],texts:[]},state),/nonempty/);
});
test('task scoring retains every planned workflow, and equal failures are not successes',()=>{
  const set:CaseSet={id:'tasks',generatedAt:'frozen',cases:[{id:'registration',page:'registration.html',chords:['Tab'],axes:{},taskOutcome:oracle}]};
  const record=(source:CaseRecord['source']):CaseRecord=>({caseSet:'tasks',caseId:'registration',source,start:{aligned:true,speech:[]},steps:[{chord:'Tab',utterances:[{t:1,text:'Registration saved'}],reason:'quiet',state}]});
  const native=new Map([['registration',record('voiceover')]]),model=new Map([['registration',record('simulator')]]);
  assert.equal(summarizeTaskOutcomes(set,native,model,new Map()).matched,0);
  assert.equal(summarizeTaskOutcomes(set,native,model,new Map([['registration',state]])).matched,1);
  const failed={...state,texts:[]};model.get('registration')!.steps[0]!.state=failed;
  const bothFailed=summarizeTaskOutcomes(set,native,model,new Map([['registration',failed]]));
  assert.equal(bothFailed.matched,0);assert.equal(bothFailed.native.failed,1);assert.equal(bothFailed.simulator.failed,1);
  model.get('registration')!.steps[0]!.reason='unsupported';
  assert.equal(summarizeTaskOutcomes(set,native,model,new Map([['registration',state]])).simulator.incomplete,1);
  const missing=summarizeTaskOutcomes(set,new Map(),new Map(),new Map());
  assert.equal(missing.planned,1);assert.equal(missing.native.incomplete,1);
});
test('native static text is preserved independently from accessible control names and speech',()=>{
  const native=nativePageState({app:'Safari',pid:1,windowTitle:'Fixture',timestamp:'frozen',nodeCount:3,truncated:false,focusedPath:null,root:{AXRole:'AXWebArea',children:[{AXRole:'AXStaticText',AXValue:'Registration saved'},{AXRole:'AXTextField',AXTitle:'Contact',AXValue:'noa'}]}})!;
  assert.deepEqual(native.texts,['Registration saved']);
  assert.equal(evaluateTaskOutcome(oracle,native).status,'success');
});

test('Chrome summary AX buttons retain disclosure semantics without changing ordinary buttons',()=>{
  const native=nativePageState({app:'Google Chrome',pid:1,windowTitle:'Fixture',timestamp:'frozen',nodeCount:3,truncated:false,focusedPath:null,root:{AXRole:'AXWebArea',children:[{AXRole:'AXButton',AXRoleDescription:'disclosure triangle',AXTitle:'More options',AXExpanded:true},{AXRole:'AXButton',AXRoleDescription:'button',AXTitle:'Save'}]}})!;
  assert.equal(evaluateTaskOutcome({controls:[{role:'disclosuretriangle',name:'More options',state:{expanded:true}}],texts:[]},native).status,'success');
  assert.equal(native.objects!.find(o=>o.name==='Save')!.role,'button');
});
