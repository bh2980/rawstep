/** Independent evidence channel: state is recorded after actions and never used to choose the next command. */
import { focusedAxNode, type AxDump, type AxNode } from "./axdump.js";
export interface PageState { focusId: string | null; controls: Record<string, { value?: string; checked?: boolean | "mixed"; selected?: boolean; expanded?: boolean; pressed?: boolean }> }

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
  function visit(n: AxNode) {
    const id = n.AXDOMIdentifier;
    if (typeof id === "string" && id) {
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
      if (Object.keys(s).length) controls[id] = s;
    }
    for (const c of n.children ?? []) visit(c);
  }
  visit(dump.root);
  return { focusId: String(focusedAxNode(dump)?.AXDOMIdentifier || "") || null, controls };
}

export function comparePageState(native: PageState | undefined, simulator: PageState | undefined) {
  if (!native || !simulator) return { matched: false, missing: true, differences: ["state evidence missing"] };
  const differences: string[] = [];
  if (native.focusId !== simulator.focusId) differences.push(`focus: native=${native.focusId}, simulated=${simulator.focusId}`);
  for (const [id, properties] of Object.entries(native.controls)) for (const [property, value] of Object.entries(properties)) {
    if (simulator.controls[id]?.[property as keyof typeof properties] !== value) differences.push(`${id}.${property}: native=${JSON.stringify(value)}, simulated=${JSON.stringify(simulator.controls[id]?.[property as keyof typeof properties])}`);
  }
  return { matched: differences.length === 0, missing: false, differences };
}
