import assert from 'node:assert/strict';
import test from 'node:test';
import {checkSpeechInput} from '../src/speech-input.js';
import type {AxDump,AxNode} from '../src/axdump.js';
import {generateSpeechContexts} from '../src/generate/speech-contexts.js';
const input=generateSpeechContexts().speechInputs['speech-contexts-v1.sibling-regions-flat']![0]!;
const sample={protocol:'visible-vo-overlay-v1',status:'observed',frame:{x:16,y:26,width:108,height:38},window:{id:11,ownerPID:99,layer:2997,x:0,y:0,width:1024,height:768}};
const button:AxNode={AXRole:'AXButton',AXTitle:'Prepare booking',AXDOMIdentifier:'first',AXElementId:4,AXEnabled:true,AXPosition:{x:20,y:30},AXSize:{width:100,height:30}};
const dump=():AxDump=>({app:'Safari',pid:1,windowTitle:'',timestamp:'',nodeCount:4,truncated:false,focusedPath:null,root:{AXRole:'AXWebArea',children:[{AXRole:'AXGroup',AXRoleDescription:'main',AXTitle:'Workspace console',children:[{AXRole:'AXGroup',AXRoleDescription:'region',AXTitle:'Booking tools',children:[{...button}]}]}]},visualCursor:{before:sample,after:sample,stable:true}});
test('speech input verification uses visible target and ancestors, never keyboard focus or speech',()=>{
  const d=dump();assert.equal(checkSpeechInput(input,d).status,'verified');
  d.focusedPath=[99];assert.equal(checkSpeechInput(input,d).status,'verified');
  const wrong=structuredClone(input);wrong.target.semantic.name='Wrong target';assert.equal(checkSpeechInput(wrong,d).status,'mismatch');
  const wrongContext=structuredClone(input);wrongContext.target.containers=[];assert.equal(checkSpeechInput(wrongContext,d).status,'mismatch');
  delete d.visualCursor;assert.equal(checkSpeechInput(input,d).status,'unmeasured');
});
test('ambiguous or incomplete native observations cannot become successful input equivalence',()=>{
  const d=dump();d.root.children!.push({...button,AXElementId:5});assert.equal(checkSpeechInput(input,d).status,'unmeasured');
  const incomplete=dump();incomplete.truncated=true;assert.equal(checkSpeechInput(input,incomplete).status,'unmeasured');
  const state=dump();delete state.root.children![0]!.children![0]!.children![0]!.AXEnabled;assert.equal(checkSpeechInput(input,state).status,'unmeasured');
});

test('table dimensions require identifiable native rows and columns',()=>{
  const input=generateSpeechContexts().speechInputs['speech-contexts-v1.nested-table-2-columns']![0]!;
  const table:AxNode={AXRole:'AXTable',AXTitle:'Equipment slots',children:[
    {AXRole:'AXRow',AXElementId:10},
    {AXRole:'AXRow',AXElementId:11,children:[{AXRole:'AXCell',children:[{...button,AXTitle:'Reserve camera'}]}]},
    {AXRole:'AXRow',AXElementId:12},{AXRole:'AXColumn',AXElementId:13},{AXRole:'AXColumn',AXElementId:14},
  ]};
  const d=dump();d.root.children=[{AXRole:'AXGroup',AXRoleDescription:'region',AXTitle:'Resource planner',children:[{AXRole:'AXGroup',AXRoleDescription:'article',AXTitle:'Loan request',children:[table]}]}];
  assert.equal(checkSpeechInput(input,d).status,'verified');
  delete table.children![0]!.AXElementId;
  assert.equal(checkSpeechInput(input,d).status,'unmeasured');
});

test('description, help and more-content availability require independent Native attributes',()=>{
 const d=dump(),node=d.root.children![0]!.children![0]!.children![0]!;
 const described=structuredClone(input);Object.assign(described.target.semantic,{description:'Independent note',hasMoreContent:true});
 assert.equal(checkSpeechInput(described,d).status,'unmeasured');
 node.AXCustomContent={status:'observed',byteCount:1,rawBase64:'eA==',entries:[{label:'description',value:'Independent note',importance:1}]};
 assert.equal(checkSpeechInput(described,d).status,'verified');
 described.target.semantic.description='Predicted but unobserved';assert.equal(checkSpeechInput(described,d).status,'mismatch');
 delete described.target.semantic.description;described.target.semantic.help='Observed help';
 assert.equal(checkSpeechInput(described,d).status,'unmeasured');node.AXHelp='Observed help';assert.equal(checkSpeechInput(described,d).status,'verified');
 node.AXHelp='Different help';assert.equal(checkSpeechInput(described,d).status,'mismatch');
});
