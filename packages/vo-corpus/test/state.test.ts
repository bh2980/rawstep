import assert from "node:assert/strict";
import test from "node:test";
import { comparePageState, nativePageState, summarizeState } from "../src/state.js";
import {nativeNodeName,type AxDump} from "../src/axdump.js";

test('native focus names support both browser mappings without treating field values as names',()=>{
  assert.equal(nativeNodeName({AXRole:'AXButton',AXTitle:'Before marker',AXDescription:''}),'Before marker');
  assert.equal(nativeNodeName({AXRole:'AXButton',AXTitle:'',AXDescription:'Before marker'}),'Before marker');
  assert.equal(nativeNodeName({AXRole:'AXTextField',AXSubrole:'AXSecureTextField',AXValue:'secret'}),'');
  assert.equal(nativeNodeName(undefined),'');
});

test("state validation compares focus and native values independently of speech", () => {
  const dump = { truncated: false, focusedPath: [0], root: { children: [
    { AXRole: "AXTextField", AXDOMIdentifier: "note", AXValue: "cu" },
    { AXRole: "AXCheckBox", AXDOMIdentifier: "check", AXValue: 1 },
    { AXRole: "AXRadioButton", AXDOMIdentifier: "tab", AXRoleDescription: "tab", AXValue: true, AXSelected: true },
    { AXRole: "AXTextField", AXSubrole: "AXSecureTextField", AXDOMIdentifier: "password", AXValue: "secret" },
    { AXRole: "AXCheckBox", AXSubrole: "AXToggle", AXDOMIdentifier: "favorite", AXValue: 1 },
  ] } } as AxDump;
  const observed = nativePageState(dump)!;
  const state = {focusId:observed.focusId,controls:observed.controls};
  assert.deepEqual(state, { focusId: "note", controls: { note: { value: "cu" }, check: { checked: true }, tab: { selected: true }, favorite: { pressed: true } } });
  assert.equal(comparePageState(state, state).matched, true);
  assert.equal(comparePageState(state, { ...state, focusId: "check" }).matched, false);
  assert.equal(comparePageState(state, { ...state, controls: { ...state.controls, note: { value: "c" } } }).matched, false);
  assert.equal(comparePageState(state, undefined).missing, true);
  assert.equal(nativePageState({ ...dump, truncated: true }), undefined);
});


test("anonymous native controls and null focus cannot turn empty evidence into state accuracy", () => {
  const dump = { truncated: false, focusedPath: [0], root: { children: [
    { AXRole: "AXCheckBox", AXValue: 1 },
  ] } } as AxDump;
  const native = nativePageState(dump)!;
  assert.equal(native.unidentifiedControls, 1);
  const result = comparePageState(native, {focusId:null, controls:{}});
  assert.equal(result.matched, false);
  assert.equal(result.missing, true);
  assert.equal(result.coverage.unidentifiedNativeControls, 1);
  const summary = summarizeState([result]);
  assert.equal(summary.matched, 0);
  assert.equal(summary.focusComparable, 0);
  assert.equal(summary.status, 'partial');
});

test("bounded state agreement exposes missing properties on both sides", () => {
  const native = {focusId:'check',controls:{check:{checked:true}}};
  const partial = comparePageState(native,{focusId:null,controls:{check:{checked:true},extra:{value:'unobserved'}}});
  assert.equal(partial.matched,true); // agreement only on the recorded checkbox property
  assert.equal(partial.coverage.focusComparable,false);
  assert.equal(partial.coverage.simulatorOnlyProperties,1);
  assert.equal(partial.coverage.comparedProperties,1);
  const absent = comparePageState(native,{focusId:'check',controls:{}});
  assert.equal(absent.matched,false);
  assert.equal(absent.coverage.nativeProperties,1);
  assert.equal(absent.coverage.comparedProperties,0);
});


test('unique AX identities join anonymous controls without inferring a VoiceOver cursor',()=>{
  const native=nativePageState({truncated:false,focusedPath:[0],root:{children:[{AXRole:'AXCheckBox',AXTitle:'Travel updates',AXValue:1}]}} as AxDump)!;
  const model={focusId:null,controls:{},objects:[{id:'',role:'checkbox',name:'Travel updates',focused:true,state:{checked:true}}]};
  const result=comparePageState(native,model);
  assert.equal(result.matched,true);
  assert.equal(result.coverage.focusComparable,true);
  assert.equal(result.coverage.comparedProperties,1);
  assert.equal(result.coverage.roleNameJoins,1);
  assert.equal(result.coverage.identityMethod,'unique-ax-identity');
  assert.equal(comparePageState(native,{...model,objects:[{...model.objects[0]!,state:{checked:false}}]}).matched,false);
  assert.equal(comparePageState(native,{...model,objectErrors:['failed read']}).matched,false);
});

test('anonymous duplicate names cannot be paired by reading order or convenient values',()=>{
  const native=nativePageState({truncated:false,focusedPath:[0],root:{children:[{AXRole:'AXCheckBox',AXTitle:'Same',AXValue:1},{AXRole:'AXCheckBox',AXTitle:'Same',AXValue:0}]}} as AxDump)!;
  const object={id:'',role:'checkbox',name:'Same',focused:true,state:{checked:true}};
  const result=comparePageState(native,{focusId:null,controls:{},objects:[object,{...object,focused:false,state:{checked:false}}]});
  assert.equal(result.matched,false);
  assert.equal(result.coverage.comparedProperties,0);
  assert.equal(result.coverage.ambiguousObjects,2);
  assert.equal(result.coverage.focusComparable,false);
});

test('a model-only state property remains unobserved and missing legacy evidence stays missing',()=>{
  const native=nativePageState({truncated:false,focusedPath:null,root:{children:[{AXRole:'AXCheckBox',AXTitle:'Updates',AXValue:1}]}} as AxDump)!;
  const model={focusId:null,controls:{},objects:[{id:'',role:'checkbox',name:'Updates',focused:false,state:{checked:true,expanded:true}}]};
  const result=comparePageState(native,model);
  assert.equal(result.matched,true);
  assert.equal(result.coverage.focusComparable,false);
  assert.equal(result.coverage.simulatorOnlyProperties,1);
  assert.equal(comparePageState(native,{focusId:null,controls:{}}).matched,false);
});


test('native aliases merge only when captured AX object IDs prove identity, and non-atomic changes fail',()=>{
  const node={AXRole:'AXTextField',AXTitle:'Note',AXValue:'Dock',AXElementId:7};
  const dump={truncated:false,focusedPath:[1,0],root:{children:[{children:[node]},{children:[{...node}]}]}} as AxDump;
  const native=nativePageState(dump)!;
  assert.equal(native.objects!.length,1);
  assert.equal(native.objects![0]!.focused,true);
  assert.equal(native.unidentifiedControls,1);
  const model={focusId:null,controls:{},objects:[{id:'',role:'textbox',name:'Note',focused:true,state:{value:'Dock'}}]};
  assert.equal(comparePageState(native,model).matched,true);
  const changed=structuredClone(dump);changed.root.children![1]!.children![0]!.AXValue='Changed';
  assert.equal(comparePageState(nativePageState(changed),model).matched,false);
  assert.ok(nativePageState(changed)!.objectErrors!.length>0);
});


test('static AX text selection is not treated as an editable caret and invalid ranges remain unmeasured',()=>{
  const dump={truncated:false,focusedPath:[1],root:{children:[{AXRole:'AXStaticText',AXTitle:'Label',AXSelectedTextRange:{location:0,length:0}},{AXRole:'AXTextField',AXTitle:'Note',AXValue:'Dock',AXSelectedTextRange:{location:1,length:2}}]}} as AxDump;
  const state=nativePageState(dump)!;
  assert.equal(state.objects!.length,1);
  assert.equal(state.objects![0]!.state.selectionStart,1);
  assert.equal(state.objects![0]!.state.selectionEnd,3);
  dump.root.children![1]!.AXSelectedTextRange={location:Number.MAX_VALUE,length:0};
  assert.equal(nativePageState(dump)!.objects![0]!.state.selectionStart,undefined);
});
