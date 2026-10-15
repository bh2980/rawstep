/** Independent evidence channel: state is recorded after actions and never used to choose the next command. */
import { focusedAxNode, type AxDump, type AxNode } from "./axdump.js";
export interface PageState {
  focusId: string | null;
  controls: Record<string, { value?: string; checked?: boolean | "mixed"; selected?: boolean; expanded?: boolean; pressed?: boolean }>;
  /** Native controls with observable state but no DOM ID cannot be joined to this DOM oracle. */
  unidentifiedControls?: number;
}

export const fixtureStateScript = `(() => {
  const controls={};
  for(const e of document.querySelectorAll('[id]')) {
    if(e.closest('[hidden],[inert]') || getComputedStyle(e).display==='none' || (e.closest('dialog') && !e.closest('dialog').open))continue;
    const s={};
    if((e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement) && e.type!=='password' && !['checkbox','radio','button','submit'].includes(e.type))s.value=e.value;
    if(e instanceof HTMLInputElement && ['checkbox','radio'].includes(e.type))s.checked=e.indeterminate?'mixed':e.checked;
    for(const a of ['checked','selected','expanded','pressed'])if(e.hasAttribute('aria-'+a))s[a]=e.getAttribute('aria-'+a)==='mixed'?'mixed':e.getAttribute('aria-'+a)==='true';
    if(e instanceof HTMLDetailsElement)s.expanded=e.open;
    if(e.tagName==='SUMMARY' && e.parentElement instanceof HTMLDetailsElement)s.expanded=e.parentElement.open;
    if(Object.keys(s).length)controls[e.id]=s;
  }
  return {focusId:document.activeElement?.id||null,controls};
})()`;

export function nativePageState(dump: AxDump): PageState | undefined {
  if (dump.truncated || !focusedAxNode(dump)) return undefined;
  const controls: PageState["controls"] = {};
  let unidentifiedControls = 0;
  function visit(n: AxNode) {
    const id = n.AXDOMIdentifier;
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
    if (Object.keys(s).length) {
      if (typeof id === "string" && id) controls[id] = s;
      else unidentifiedControls++;
    }
    for (const c of n.children ?? []) visit(c);
  }
  visit(dump.root);
  return { focusId: String(focusedAxNode(dump)?.AXDOMIdentifier || "") || null, controls, ...(unidentifiedControls ? { unidentifiedControls } : {}) };
}

export function comparePageState(native: PageState | undefined, simulator: PageState | undefined) {
  const differences: string[] = [];
  const coverage = {
    focusComparable: !!native?.focusId && !!simulator?.focusId,
    nativeProperties: Object.values(native?.controls ?? {}).reduce((n, s) => n + Object.keys(s).length, 0),
    comparedProperties: 0,
    simulatorOnlyProperties: 0,
    unidentifiedNativeControls: native?.unidentifiedControls ?? 0,
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
  return { matched: !missing && differences.length === 0, missing, differences, coverage };
}

/** Agreement on a bounded ID-based oracle, never Navigation Accuracy or complete State Accuracy. */
export function summarizeState(rows: ReturnType<typeof comparePageState>[]) {
  return {
    status: "partial" as const,
    scope: "Native AX keyboard focus and exposed state properties joined by DOM ID; excludes VO reading cursor, text selection and unidentifiable controls",
    matched: rows.filter(r => r.matched).length, planned: rows.length, missing: rows.filter(r => r.missing).length,
    focusComparable: rows.filter(r => r.coverage.focusComparable).length,
    nativeProperties: rows.reduce((n, r) => n + r.coverage.nativeProperties, 0),
    comparedProperties: rows.reduce((n, r) => n + r.coverage.comparedProperties, 0),
    simulatorOnlyProperties: rows.reduce((n, r) => n + r.coverage.simulatorOnlyProperties, 0),
    unidentifiedNativeControls: rows.reduce((n, r) => n + r.coverage.unidentifiedNativeControls, 0),
  };
}
