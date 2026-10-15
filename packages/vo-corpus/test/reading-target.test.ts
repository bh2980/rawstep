import assert from 'node:assert/strict';
import test from 'node:test';
import {compareReadingTarget,summarizeReadingTargets} from '../src/reading-target.js';
import type {AxDump,AxNode} from '../src/axdump.js';
import type {ModelCursorObservation} from '../src/cursor-model.js';

const sample={protocol:'visible-vo-overlay-v1',status:'observed',frame:{x:16,y:26,width:108,height:38},window:{id:11,ownerPID:99,layer:2997,x:0,y:0,width:1024,height:768}};
const text:AxNode={AXElementId:2,AXRole:'AXStaticText',AXValue:'Arrival guide',AXPosition:{x:20,y:30},AXSize:{width:100,height:30}};
const snapshot=(nodes:AxNode[]=[text]):AxDump=>({app:'Safari',pid:1,windowTitle:'',timestamp:'',nodeCount:2,truncated:false,focusedPath:null,root:{AXElementId:1,AXRole:'AXWebArea',children:nodes},visualCursor:{before:sample,after:sample,stable:true}});
const model=():ModelCursorObservation=>({protocol:'model-cursor-cdp-v1',status:'observed',requestedAt:'',endedAt:'',cursor:{protocol:'mock-reading-cursor-v1',windowId:'w',capturedAt:'',target:{identity:'dom:3',backendDOMNodeId:3,axId:'3',role:'StaticText',name:'Arrival guide',end:false}},axNodes:[{nodeId:'3',backendDOMNodeId:3,role:'StaticText',name:'Arrival guide',ignored:false}]});
test('reading-target comparison cannot pass by matching keyboard focus or speech',()=>{
  const d=snapshot(),m=model();assert.equal(compareReadingTarget(d,m).status,'matched');
  d.focusedPath=[9];assert.equal(compareReadingTarget(d,m).status,'matched');
  m.axNodes![0]!.nodeId='different-session';assert.equal(compareReadingTarget(d,m).status,'matched');
  m.axNodes![0]!.backendDOMNodeId=99;assert.equal(compareReadingTarget(d,m).status,'unmeasured');m.axNodes![0]!.backendDOMNodeId=3;
  m.cursor!.target!.name='Different section';m.axNodes![0]!.name='Different section';assert.equal(compareReadingTarget(d,m).status,'mismatch');
  assert.equal(summarizeReadingTargets([compareReadingTarget(d,m),compareReadingTarget(undefined,m)]).allPlanRate,0);
});
test('aliases are deduplicated, genuine duplicates and logical boundaries remain unknown',()=>{
  assert.equal(compareReadingTarget(snapshot([text,text]),model()).status,'matched');
  assert.equal(compareReadingTarget(snapshot([text,{...text,AXElementId:4,AXPosition:{x:400,y:30}}]),model()).status,'unmeasured');
  const m=model();m.axNodes!.push({...m.axNodes![0]!,nodeId:'4'});assert.equal(compareReadingTarget(snapshot(),m).status,'unmeasured');
  const end=model();end.cursor!.target!.end=true;assert.equal(compareReadingTarget(snapshot(),end).status,'unmeasured');
  const group=snapshot([{...text,AXRole:'AXGroup'}]);assert.equal(compareReadingTarget(group,model()).status,'unmeasured');
});
test('explicit unique DOM identity distinguishes same-name buttons without inferring identity from state',()=>{
  const n={...text,AXRole:'AXButton',AXTitle:'Continue',AXDOMIdentifier:'submit'};
  const m=model();m.cursor!.target!.role='button';m.cursor!.target!.name='Continue';m.axNodes![0]!.role='button';m.axNodes![0]!.name='Continue';m.domId='cancel';m.domIdCount=1;
  assert.equal(compareReadingTarget(snapshot([n]),m).status,'mismatch');
  m.domId='submit';assert.equal(compareReadingTarget(snapshot([n]),m).status,'matched');
  m.domIdCount=2;assert.equal(compareReadingTarget(snapshot([n]),m).status,'unmeasured');
});
test('a DOM ID cannot certify a compound projection as a plain atomic reading unit',()=>{
 const n={...text,AXRole:'AXHeading',AXTitle:'Arrival guide',AXDOMIdentifier:'heading'},m=model();
 m.cursor!.target!.role='heading';m.axNodes![0]!.role='link';m.domId='heading';m.domIdCount=1;
 assert.equal(compareReadingTarget(snapshot([n]),m).status,'unmeasured');
 m.axNodes![0]!.role='heading';assert.equal(compareReadingTarget(snapshot([n]),m).status,'matched');
});
test('Native toggle-button subroles keep atomic role identity independent of pressed state',()=>{
 const n={...text,AXRole:'AXCheckBox',AXSubrole:'AXToggleButton',AXTitle:'Use compact layout',AXDOMIdentifier:'compact'},m=model();
 m.cursor!.target!.role='button';m.cursor!.target!.name='Use compact layout';m.axNodes![0]!.role='button';m.axNodes![0]!.name='Use compact layout';m.domId='compact';m.domIdCount=1;
 assert.equal(compareReadingTarget(snapshot([n]),m).status,'matched');
 n.AXSubrole='AXToggle';assert.equal(compareReadingTarget(snapshot([n]),m).status,'matched');
 n.AXSubrole='';assert.equal(compareReadingTarget(snapshot([n]),m).status,'mismatch');
});
