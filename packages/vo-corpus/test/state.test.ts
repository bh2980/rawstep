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
  const state = nativePageState(dump)!;
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
