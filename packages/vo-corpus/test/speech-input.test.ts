import assert from 'node:assert/strict';
import test from 'node:test';
import {checkSpeechInput,observedSpeechInput,observedSpeechContext,nativeSpeechInput} from '../src/speech-input.js';
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

test('toggle and expansion inputs require their independently observed Native states',()=>{
 const d=dump(),node=d.root.children![0]!.children![0]!.children![0]!;
 const toggle=structuredClone(input);toggle.target.semantic.pressed='mixed';
 Object.assign(node,{AXRole:'AXCheckBox',AXSubrole:'AXToggleButton',AXValue:2});
 assert.equal(checkSpeechInput(toggle,d).status,'verified');
 assert.equal(checkSpeechInput(input,d).status,'mismatch');
 node.AXValue=0;assert.equal(checkSpeechInput(toggle,d).status,'mismatch');
 delete node.AXValue;assert.equal(checkSpeechInput(toggle,d).status,'unmeasured');
 Object.assign(node,{AXRole:'AXButton'});delete node.AXSubrole;
 const expanded=structuredClone(input);expanded.target.semantic.expanded=false;
 assert.equal(checkSpeechInput(expanded,d).status,'unmeasured');
 node.AXExpanded=false;assert.equal(checkSpeechInput(expanded,d).status,'verified');
 node.AXExpanded=true;assert.equal(checkSpeechInput(expanded,d).status,'mismatch');
});

test('link and heading input verification keeps role and level independent from speech',()=>{
 const d=dump(),node=d.root.children![0]!.children![0]!.children![0]!;
 const target=structuredClone(input);target.target.semantic.role='link';node.AXRole='AXLink';
 assert.equal(checkSpeechInput(target,d).status,'verified');
 node.AXRole='AXButton';assert.equal(checkSpeechInput(target,d).status,'mismatch');
 node.AXRole='AXHeading';target.target.semantic.role='heading';target.target.semantic.level=2;
 assert.equal(checkSpeechInput(target,d).status,'unmeasured');
 node.AXValue=2;assert.equal(checkSpeechInput(target,d).status,'verified');
 node.AXARIALevel=3;assert.equal(checkSpeechInput(target,d).status,'mismatch');
 node.AXARIALevel='2';assert.equal(checkSpeechInput(target,d).status,'unmeasured');
 delete node.AXARIALevel;node.AXValue=0;assert.equal(checkSpeechInput(target,d).status,'unmeasured');
 node.AXValue=2;delete target.target.semantic.level;assert.equal(checkSpeechInput(target,d).status,'unmeasured');
});

test('target-conditioned inputs use AX and visible geometry while withholding unsupported contexts',()=>{
 const d=dump(),node=d.root.children![0]!.children![0]!.children![0]!;
 node.AXCustomContent={status:'no-value',errorCode:-25212};
 const observed=observedSpeechInput(d,'next_focusable_item');assert.equal(observed.status,'observed');
 if(observed.status!=='observed')return;
 assert.equal(observed.input.target.semantic.name,'Prepare booking');assert.equal(observed.input.target.containers!.length,2);
 assert.equal(checkSpeechInput(observed.input,d).status,'verified');
 d.focusedPath=[99];assert.deepEqual(observedSpeechInput(d,'next_focusable_item'),observed);
 delete node.AXDOMIdentifier;assert.equal(observedSpeechInput(d,'next_focusable_item').status,'observed');
 d.root.children![0]!.children![0]!.AXRoleDescription='article';assert.equal(observedSpeechInput(d,'next_focusable_item').status,'unmeasured');
 d.root.children![0]!.children![0]!.AXRoleDescription='region';delete node.AXCustomContent;assert.equal(observedSpeechInput(d,'next_focusable_item').status,'unmeasured');
});

test('web dialogs and embedded web areas cannot pass as context-free button inputs',()=>{
 for(const attributes of [{AXRole:'AXGroup',AXRoleDescription:'web dialog',AXSubrole:'AXApplicationDialog'},{AXRole:'AXWebArea'},{AXRole:'AXDialog'}]){
  const d=dump();Object.assign(d.root.children![0]!,attributes);
  assert.equal(checkSpeechInput(input,d).status,'unmeasured');
 }
});

test('an exposed landmark without a name remains part of the independently checked speech input',()=>{
 const d=dump(),button=d.root.children![0]!.children![0]!.children![0]!;
 d.root.children=[{AXRole:'AXGroup',AXRoleDescription:'banner',children:[button]}];
 const expected=structuredClone(input);expected.target.containers=[];
 assert.equal(checkSpeechInput(expected,d).status,'mismatch');
 expected.target.containers=[{id:'header',role:'banner',name:'',items:1}];
 assert.equal(checkSpeechInput(expected,d).status,'verified');
 button.AXCustomContent={status:'no-value',errorCode:-25212};
 const observed=observedSpeechInput(d,'next_focusable_item');assert.equal(observed.status,'observed');
 if(observed.status==='observed')assert.equal(observed.input.target.containers![0]!.role,'banner');
});

test('Native footer subrole identifies common semantics without copying browser-specific wording into the input',()=>{
 for(const description of ['content information','footer']){
  const d=dump(),button=d.root.children![0]!.children![0]!.children![0]!;
  d.root.children=[{AXRole:'AXGroup',AXSubrole:'AXLandmarkContentInfo',AXRoleDescription:description,children:[button]}];
  const expected=structuredClone(input);expected.target.containers=[{id:'footer',role:'contentinfo',name:'',items:1}];
  assert.equal(checkSpeechInput(expected,d).status,'verified');
 }
});

test('previous context observation does not depend on support for that object speech role',()=>{
 const d=dump(),node=d.root.children![0]!.children![0]!.children![0]!;node.AXRole='AXTextField';
 assert.equal(observedSpeechInput(d,'previous_focusable_item').status,'unmeasured');
 const previous=observedSpeechContext(d);assert.equal(previous.status,'observed');
 if(previous.status==='observed')assert.equal(previous.context.containers.length,2);
 node.AXRole='AXGroup';node.AXRoleDescription='main';assert.equal(observedSpeechContext(d).status,'unmeasured');
});

test('unmapped Native landmarks cannot disappear into supposedly empty context',()=>{
 const d=dump();Object.assign(d.root.children![0]!,{AXSubrole:'AXLandmarkSearch',AXRoleDescription:'search'});
 assert.equal(checkSpeechInput(input,d).status,'unmeasured');
 assert.equal(observedSpeechContext(d).status,'unmeasured');
});

test('constructing an intended AX target is separate from verifying its actual VoiceOver position',()=>{
 const d=dump();d.root.children![0]!.children![0]!.children![0]!.AXCustomContent={status:'no-value',errorCode:-25212};delete d.visualCursor;
 const candidate=nativeSpeechInput(d,[0,0,0],'next_focusable_item');assert.equal(candidate.status,'constructed');
 if(candidate.status==='constructed')assert.equal(checkSpeechInput(candidate.input,d).status,'unmeasured');
 assert.equal(nativeSpeechInput(d,[0,-1],'next_focusable_item').status,'unmeasured');
 assert.equal(nativeSpeechInput({...d,truncated:true},[0,0,0],'next_focusable_item').status,'unmeasured');
});

test('link image/current-page and required inputs must agree with independent Native features',()=>{
 const d=dump(),node=d.root.children![0]!.children![0]!.children![0]!,expected=structuredClone(input);
 node.AXRole='AXLink';expected.target.semantic.role='link';
 node.children=[{AXRole:'AXGroup',children:[{AXRole:'AXImage'}]}];node.AXARIACurrent='page';
 assert.equal(checkSpeechInput(expected,d).status,'mismatch');
 Object.assign(expected.target.semantic,{containsImage:true,currentPage:true});assert.equal(checkSpeechInput(expected,d).status,'verified');
 expected.target.semantic.required=true;assert.equal(checkSpeechInput(expected,d).status,'unmeasured');
 node.AXRequired=false;assert.equal(checkSpeechInput(expected,d).status,'mismatch');
 node.AXRequired=true;assert.equal(checkSpeechInput(expected,d).status,'verified');
});

test('Native content-list context is preserved for links and list markers without treating a listbox as a list',()=>{
 const d=dump(),node=d.root.children![0]!.children![0]!.children![0]!;
 node.AXRole='AXLink';node.AXCustomContent={status:'no-value',errorCode:-25212};
 const list={AXRole:'AXList',AXSubrole:'AXContentList',children:[node]};d.root.children![0]!.children=[list];
 const candidate=nativeSpeechInput(d,[0,0,0],'next_item');assert.equal(candidate.status,'constructed');
 if(candidate.status==='constructed'){
  assert.deepEqual(candidate.input.target.containers!.map(c=>c.role),['main','list']);
  assert.equal(checkSpeechInput(candidate.input,d).status,'verified');
 }
 node.AXRole='AXListMarker';const previous=observedSpeechContext(d);assert.equal(previous.status,'observed');
 if(previous.status==='observed')assert.notEqual(previous.context.focusContext,previous.context.containers.at(-1));
 list.AXSubrole='AXListBox';assert.equal(observedSpeechContext(d).status,'unmeasured');
 if(candidate.status==='constructed')assert.equal(checkSpeechInput(candidate.input,d).status,'unmeasured');
});
