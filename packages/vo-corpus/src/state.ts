/** Independent evidence channel: state is recorded after actions and never used to choose the next command. */
import { focusedAxNode, nativeNodeName, type AxDump, type AxNode } from "./axdump.js";
import type { Page } from "playwright";
type ControlState = { value?: string; checked?: boolean | "mixed"; selected?: boolean; expanded?: boolean; pressed?: boolean; disabled?: boolean; selectionStart?: number; selectionEnd?: number };
export interface StateObject { id: string; role: string; name: string; state: ControlState; focused: boolean; sourceId?: string }
export interface PageState {
  focusId: string | null;
  controls: Record<string, ControlState>;
  /** Independently captured AX identity plus actual DOM/native state; not a simulator prediction or VO cursor. */
  objects?: StateObject[];
  objectErrors?: string[];
  /** Native state-bearing objects lacking DOM IDs; a unique AX identity may still join them in newer observations. */
  unidentifiedControls?: number;
}

const domStateFunction = `function() {
          if (!(this instanceof Element)) return null;
          const state = {};
          if ((this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement) && this.type !== 'password' && !['checkbox','radio','button','submit'].includes(this.type)) state.value = this.value;
          if ((this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement) && this.type !== 'password' && this.selectionStart !== null) { state.selectionStart=this.selectionStart; state.selectionEnd=this.selectionEnd; }
          state.disabled = this.matches(':disabled') || this.getAttribute('aria-disabled') === 'true';
          if (this instanceof HTMLInputElement && ['checkbox','radio'].includes(this.type)) state.checked = this.indeterminate ? 'mixed' : this.checked;
          for (const a of ['checked','selected','expanded','pressed']) if (this.hasAttribute('aria-'+a)) state[a] = this.getAttribute('aria-'+a) === 'mixed' ? 'mixed' : this.getAttribute('aria-'+a) === 'true';
          if (this instanceof HTMLDetailsElement) state.expanded = this.open;
          if (this.tagName === 'SUMMARY' && this.parentElement instanceof HTMLDetailsElement) state.expanded = this.parentElement.open;
          return {id:this.id || '',state,focused:document.activeElement === this};
        }`;

export const fixtureStateScript = `(() => {
  const controls={}, stateOf = ${domStateFunction};
  for(const e of document.querySelectorAll('[id]')) {
    if(e.closest('[hidden],[inert]') || getComputedStyle(e).display==='none' || (e.closest('dialog') && !e.closest('dialog').open))continue;
    const {state}=stateOf.call(e);
    // The legacy oracle only has state-bearing controls, not every element carrying an ID.
    if(Object.keys(state).some(k=>k!=='disabled'))controls[e.id]=state;
  }
  return {focusId:document.activeElement?.id||null,controls};
})()`;

export function nativePageState(dump: AxDump): PageState | undefined {
  if (dump.truncated || dump.stringTruncations) return undefined;
  const controls: PageState["controls"] = {};
  const objects: StateObject[] = [], objectErrors: string[] = [], sourceObjects = new Map<string,StateObject>(), focus = focusedAxNode(dump);
  function visit(n: AxNode) {
    const id = n.AXDOMIdentifier, role = nativeStateRole(n);
    const s: PageState["controls"][string] = {};
    if (["AXTextField", "AXTextArea", "AXSlider", "AXComboBox", "AXIncrementor"].includes(n.AXRole ?? "") && n.AXSubrole !== "AXSecureTextField" && ["string", "number"].includes(typeof n.AXValue)) s.value = String(n.AXValue);
    if (["AXCheckBox", "AXRadioButton", "AXSwitch"].includes(n.AXRole ?? "")) {
      if (n.AXSubrole === "AXToggle") s.pressed = n.AXValue === 1 || n.AXValue === true;
      else if (n.AXRoleDescription === "tab") s.selected = n.AXSelected === true;
      else if (n.AXValue === 2 || n.AXValue === "mixed") s.checked = "mixed";
      else if ([0, 1, false, true].some(v => n.AXValue === v)) s.checked = n.AXValue === 1 || n.AXValue === true;
    }
    if (typeof n.AXExpanded === "boolean") s.expanded = n.AXExpanded;
    if (n.AXRole === "AXButton" && n.AXRoleDescription === "toggle button" && typeof n.AXValue === "boolean") s.pressed = n.AXValue;
    if (stateRoles.has(role) && typeof n.AXEnabled === "boolean") s.disabled = !n.AXEnabled;
    const range = n.AXSelectedTextRange as {location?:unknown;length?:unknown} | undefined;
    if (["AXTextField", "AXTextArea"].includes(n.AXRole ?? "") && n.AXSubrole !== "AXSecureTextField" && range && Number.isSafeInteger(range.location) && Number.isSafeInteger(range.length) && Number.isSafeInteger(Number(range.location) + Number(range.length)) && Number(range.location) >= 0 && Number(range.length) >= 0) {
      s.selectionStart = Number(range.location); s.selectionEnd = Number(range.location) + Number(range.length);
    }
    if (Object.keys(s).length) {
      if (typeof id === "string" && id) controls[id] = s;
    }
    if (Object.keys(s).length || stateRoles.has(role) || n === focus) {
      const sourceId = Number.isInteger(n.AXElementId) ? `native-ax:${n.AXElementId}` : undefined;
      const object: StateObject = { id: typeof id === "string" ? id : "", role, name: nativeNodeName(n), state: s, focused: n === focus, ...(sourceId?{sourceId}:{}) };
      const previous = sourceId ? sourceObjects.get(sourceId) : undefined;
      if (previous) {
        if (JSON.stringify([previous.id,previous.role,previous.name,previous.state]) !== JSON.stringify([object.id,object.role,object.name,object.state])) objectErrors.push("Native AX object changed during snapshot");
        previous.focused ||= object.focused;
      } else { objects.push(object); if(sourceId)sourceObjects.set(sourceId,object); }
    }
    for (const c of n.children ?? []) visit(c);
  }
  visit(dump.root);
  const unidentifiedControls=objects.filter(o=>!o.id&&Object.keys(o.state).length).length;
  return { focusId: String(focus?.AXDOMIdentifier || "") || null, controls, objects, ...(unidentifiedControls ? { unidentifiedControls } : {}), ...(objectErrors.length?{objectErrors}:{}) };
}

const stateRoles = new Set(["button", "link", "checkbox", "radio", "switch", "textbox", "combobox", "spinbutton", "slider", "tab", "option", "popupbutton", "disclosuretriangle"]);
function nativeStateRole(n: AxNode) {
  if (n.AXRoleDescription === "tab") return "tab";
  if (n.AXSubrole === "AXToggle") return "button";
  return ({ AXTextField: "textbox", AXTextArea: "textbox", AXRadioButton: "radio", AXIncrementor: "spinbutton" } as Record<string,string>)[n.AXRole ?? ""] ?? (n.AXRole ?? "").replace(/^AX/, "").toLowerCase();
}

/** Read fixture state through a separate CDP session; never expose this channel to the policy. */
export async function fixturePageState(page: Page): Promise<PageState> {
  const legacy = await page.evaluate(fixtureStateScript) as PageState;
  const cdp = await page.context().newCDPSession(page), objects: StateObject[] = [], objectErrors: string[] = [];
  const objectGroup = "vo-corpus-state";
  try {
    await cdp.send("Accessibility.enable");
    const tree = await cdp.send("Accessibility.getFullAXTree");
    for (const node of tree.nodes) {
      const role = String(node.role?.value ?? "").toLowerCase();
      if (node.ignored || (!stateRoles.has(role) && !node.properties?.some(p=>['checked','expanded','selected','pressed'].includes(p.name))) || !node.backendDOMNodeId) continue;
      try {
        const { object } = await cdp.send("DOM.resolveNode", { backendNodeId: node.backendDOMNodeId, objectGroup });
        if (!object.objectId) throw new Error("AX object has no DOM receiver");
        const { result, exceptionDetails } = await cdp.send("Runtime.callFunctionOn", { objectId: object.objectId, returnByValue: true, functionDeclaration: domStateFunction });
        if (exceptionDetails || !result.value) throw new Error("DOM state observation failed");
        const observed = result.value as {id:string;state:ControlState;focused:boolean};
        observed.state.disabled = node.properties?.some(p => p.name === "disabled" && p.value.value === true) ?? false;
        objects.push({ ...observed, role, name: String(node.name?.value ?? "").trim(), sourceId:`chromium-ax:${node.nodeId}` });
      } catch { objectErrors.push(`Unresolved ${role} DOM state`); }
    }
    return { ...legacy, objects, ...(objectErrors.length ? { objectErrors } : {}) };
  } finally {
    await cdp.send("Runtime.releaseObjectGroup", { objectGroup }).catch(() => {});
    await cdp.detach();
  }
}

function compareStateObjects(native: PageState, simulator: PageState) {
  const a = native.objects!, b = simulator.objects!, differences: string[] = [];
  const coverage = {
    focusComparable: false, nativeProperties: a.reduce((n, o) => n + Object.keys(o.state).length, 0), comparedProperties: 0,
    simulatorOnlyProperties: 0, unidentifiedNativeControls: native.unidentifiedControls ?? 0,
    identityMethod: "unique-ax-identity" as "dom-id" | "unique-ax-identity", ambiguousObjects: 0, roleNameJoins: 0,
  };
  const pairs = new Map<StateObject, StateObject>();
  const identity = (o: StateObject) => JSON.stringify([o.role, o.name]);
  for (const object of a) {
    let candidates = object.id ? b.filter(o => o.id === object.id) : [];
    if (candidates.length === 1 && a.filter(o => o.id === object.id).length === 1) {
      pairs.set(object, candidates[0]!); continue;
    }
    // Never disambiguate repeated accessible names with DOM order or observed speech.
    const sameNative = a.filter(o => identity(o) === identity(object));
    candidates = b.filter(o => identity(o) === identity(object) && (!object.id || !o.id));
    if (object.name && sameNative.length === 1 && candidates.length === 1) {
      pairs.set(object, candidates[0]!); coverage.roleNameJoins++;
    } else if (Object.keys(object.state).length || object.focused) {
      if (sameNative.length > 1 || candidates.length > 1) coverage.ambiguousObjects++;
      differences.push(`unjoinable state identity: ${object.role} ${JSON.stringify(object.name)}`);
    }
  }
  // A fallback must also be one-to-one when one side exposes an ID and the other does not.
  const duplicateTargets = [...pairs.values()].filter(target => [...pairs.values()].filter(o => o === target).length > 1);
  for (const [object, target] of [...pairs]) if (duplicateTargets.includes(target)) {
    pairs.delete(object); coverage.ambiguousObjects++; differences.push("state identity maps multiple native objects to one model object");
  }
  const nativeFocus = a.find(o => o.focused), modelFocus = b.find(o => o.focused);
  coverage.focusComparable = !!nativeFocus && !!modelFocus && pairs.has(nativeFocus);
  if (coverage.focusComparable && pairs.get(nativeFocus!) !== modelFocus) differences.push("keyboard focus objects differ");
  for (const [object, target] of pairs) for (const [property, value] of Object.entries(object.state)) {
    const actual = target.state[property as keyof ControlState];
    if (actual !== undefined) coverage.comparedProperties++;
    if (actual !== value) differences.push(`${object.role} ${JSON.stringify(object.name)}.${property}: native=${JSON.stringify(value)}, simulated=${JSON.stringify(actual)}`);
  }
  for (const target of b) {
    const object = [...pairs].find(([, o]) => o === target)?.[0];
    for (const property of Object.keys(target.state)) if (!object || object.state[property as keyof ControlState] === undefined) coverage.simulatorOnlyProperties++;
  }
  const missing = !coverage.focusComparable && coverage.comparedProperties === 0;
  if (missing) differences.push("no independently joinable focus or state properties");
  if (native.objectErrors?.length || simulator.objectErrors?.length) differences.push("state observation contains unresolved objects");
  return { matched: !missing && differences.length === 0, missing, differences, coverage };
}

export function comparePageState(native: PageState | undefined, simulator: PageState | undefined) {
  if (native?.objects && simulator?.objects) return compareStateObjects(native, simulator);
  const differences: string[] = [];
  const coverage = {
    focusComparable: !!native?.focusId && !!simulator?.focusId,
    nativeProperties: Object.values(native?.controls ?? {}).reduce((n, s) => n + Object.keys(s).length, 0),
    comparedProperties: 0,
    simulatorOnlyProperties: 0,
    unidentifiedNativeControls: native?.unidentifiedControls ?? 0,
    identityMethod: "dom-id" as "dom-id" | "unique-ax-identity", ambiguousObjects: 0, roleNameJoins: 0,
  };
  if (!native || !simulator) return { matched: false, missing: true, differences: ["state evidence missing"], coverage };
  if (coverage.focusComparable && native.focusId !== simulator.focusId) differences.push(`focus: native=${native.focusId}, simulated=${simulator.focusId}`);
  for (const [id, properties] of Object.entries(native.controls)) for (const [property, value] of Object.entries(properties)) {
    const actual = simulator.controls[id]?.[property as keyof typeof properties];
    if (actual !== undefined) coverage.comparedProperties++;
    if (actual !== value) differences.push(`${id}.${property}: native=${JSON.stringify(value)}, simulated=${JSON.stringify(actual)}`);
  }
  for (const [id, properties] of Object.entries(simulator.controls)) for (const property of Object.keys(properties)) {
    if (native.controls[id]?.[property as keyof typeof properties] === undefined) coverage.simulatorOnlyProperties++;
  }
  const missing = !coverage.focusComparable && coverage.nativeProperties === 0;
  if (missing) differences.push("no independently joinable focus or state properties");
  if (native.objectErrors?.length || simulator.objectErrors?.length) differences.push("state observation contains unresolved objects");
  return { matched: !missing && differences.length === 0, missing, differences, coverage };
}

/** Agreement on a bounded independently joined state oracle, never Navigation Accuracy or complete State Accuracy. */
export function summarizeState(rows: ReturnType<typeof comparePageState>[]) {
  return {
    status: "partial" as const,
    scope: "Native AX keyboard focus and exposed state properties joined by DOM ID or independently unique AX role/name; excludes VO reading cursor, unexposed selection/state properties and ambiguous identities",
    matched: rows.filter(r => r.matched).length, planned: rows.length, missing: rows.filter(r => r.missing).length,
    focusComparable: rows.filter(r => r.coverage.focusComparable).length,
    nativeProperties: rows.reduce((n, r) => n + r.coverage.nativeProperties, 0),
    comparedProperties: rows.reduce((n, r) => n + r.coverage.comparedProperties, 0),
    simulatorOnlyProperties: rows.reduce((n, r) => n + r.coverage.simulatorOnlyProperties, 0),
    unidentifiedNativeControls: rows.reduce((n, r) => n + r.coverage.unidentifiedNativeControls, 0),
    roleNameJoins: rows.reduce((n, r) => n + r.coverage.roleNameJoins, 0),
    ambiguousObjects: rows.reduce((n, r) => n + r.coverage.ambiguousObjects, 0),
  };
}
