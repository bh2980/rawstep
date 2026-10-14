import assert from "node:assert/strict";
import test from "node:test";
import { comparePageState, nativePageState } from "../src/state.js";
import type { AxDump } from "../src/axdump.js";

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
