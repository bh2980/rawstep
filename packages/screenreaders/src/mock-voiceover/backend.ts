import type { CDPSession, Page } from '@rawstep/browser/types';
import type { Backend, BackendAction, BackendOperationOptions, BackendOutput, BackendSession, BackendSpeechObservation } from '@rawstep/core/contracts';
import { formatSimulatedSpeech, type SimulatedSemanticNode } from './semantics.js';
import { setTimeout as wait } from 'node:timers/promises';
import {formatVoiceOverActivation} from './activation.js';
import {formatVoiceOverSpeech, type VoiceOverSpeechContext, type VoiceOverContainer, type VoiceOverCell, type VoiceOverEditState} from './speech.js';

export { formatSimulatedSpeech, type SimulatedSemanticNode } from './semantics.js';

export const MOCK_VOICEOVER_PROFILE = 'english-dom-navigation-evidence-v17' as const;
export const MOCK_VOICEOVER_CHROME_PROFILE = 'english-chrome-navigation-evidence-v11' as const;
export type MockVoiceOverReferenceBrowser='safari'|'chrome';
export const MOCK_VOICEOVER_LIMITATIONS = Object.freeze([
  'Simulation of an English DOM-navigation profile using Chromium accessibility semantics; not native VoiceOver speech or an accessibility conformance result.',
  'Selected wording and plain checked-control state-change rules are calibrated to versioned third-party observations and local macOS/Safari 26.6.2 captures; this is a composite simulation profile, not any one native version. Other state changes and speech timing remain heuristic.',
  'Role/context usage hints are polled after a 600 ms delay from their main receipt, rounded from local receipt-time measurements. New actions cancel pending hints and repeated targets suppress them. Editing/autofill hints, native speech queues and configurable verbosity remain incomplete.',
  'Next at an enabled terminal button re-announces that object, inferred from the repeated final-button observations in the local corpus. Other endpoint roles and previous-boundary behavior remain uncalibrated.',
  'The projected accessibility cursor includes named group/landmark boundaries, list positions and table coordinates. Navigation synchronizes focus to actual focusable DOM objects, calibrated to the local native profile; static stops preserve keyboard focus. Configurable tracking preferences remain unimplemented.',
  'Activation uses guarded DOM click or editable-field focus as an approximation of AXPress; DOM clicks are untrusted and no missing widget behavior is repaired.',
  'Physical Enter/Space reaches an enabled native HTML button even when it is incorrectly marked aria-disabled, calibrated to a paired native capture. Explicit activate intents and custom AX-disabled controls retain their guards.',
  'Quick navigation covers next/previous heading and next form control only. Native previous-heading input is unresolved in the local collector. Group interaction, rotor, speech queue/interruption and cross-frame navigation are unimplemented.',
  'Live regions are polled during an explicit minimum observation window; successive observed text changes are preserved. Polling can miss brief changes and does not simulate native queue timing or interruption.',
  'List item markers, positions, nested list levels and end boundaries are projected from Chromium and DOM metadata, calibrated to local captures.',
  'Safari listboxes are outer reading units until explicit interaction. Native select and ARIA selected-option summaries differ. Listbox interaction itself remains unsupported pending native calibration.',
  'Linked text headings are projected as one reading unit, preserving nesting-dependent navigation wording and actual anchor focus. Mixed interactive/image headings need further calibration.',
  'Articles and named figures have observed entry/exit stops. Simple time elements with date-only datetime attributes repeat their text in the captured profile; other datetime formats remain uncalibrated.',
  'Tab context announces the nearest named group, landmark, table or article when that context changes. Chrome unnamed-article focus naming is unresolved; only its article role is announced rather than inventing a name.',
  'Fragment activation moves the reading cursor to an observed same-document hash target without changing DOM focus manually. Repeated activation of an unchanged hash and browser-specific Tab preferences remain uncalibrated.',
  'Single-character editing echoes and caret/selection key receipts are calibrated on generated text inputs and textareas. Multi-character task input, native autocomplete/autofill and browser-specific focus selection need further validation.',
  'Only the attached Chromium main document is traversed. Browser chrome and operating-system dialogs are outside the profile.',
  'A newly loaded document is announced by its title alone; native VoiceOver adds its own page-load wording.',
  'headings.list reads every heading with its level in one announcement, like opening the VoiceOver rotor on headings (VO+U) and listening through it; the cursor does not move.',
]);

const intents = Object.freeze(['next', 'previous', 'readCurrent', 'readFocused', 'activate', 'heading.next', 'heading.previous', 'form.next', 'headings.list']);
const formRoles = new Set(['button', 'checkbox', 'radio', 'switch', 'textbox', 'searchbox', 'combobox', 'spinbutton', 'slider', 'listbox']);
/** Cursor moves: one object, or (quick navigation, as VoiceOver's VO-Command-H / VO-Command-J) to the next object of a kind. */
const moves: Readonly<Record<string, { step: 1 | -1; match?: (role: string) => boolean; none: string }>> = Object.freeze({
  next: { step: 1, none: 'End of content' },
  previous: { step: -1, none: 'Start of content' },
  'heading.next': { step: 1, match: role => role === 'heading', none: 'No more headings' },
  'heading.previous': { step: -1, match: role => role === 'heading', none: 'No previous heading' },
  'form.next': { step: 1, match: role => formRoles.has(role), none: 'No more form controls' },
});
const keys = Object.freeze(['Tab', 'Shift+Tab', 'Enter', 'Space', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'Shift+Home', 'Shift+End', 'Backspace', 'Delete', 'ControlOrMeta+A']);
const textRoles = new Set(['StaticText', 'InlineTextBox']);
const namedLeafRoles = new Set(['button', 'link', 'checkbox', 'radio', 'switch', 'textbox', 'searchbox', 'combobox', 'spinbutton', 'slider', 'heading', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'option']);
// Separators are decorative here; VoiceOver's object navigation does not stop on a plain rule.
// Raw marker nodes are projected onto list-item stops, including marker-only stops before links.
const skippedRoles = new Set(['RootWebArea', 'WebArea', 'none', 'presentation', 'generic', 'InlineTextBox', 'LineBreak', 'separator', 'ListMarker']);
/** Live regions: their new text is announced when it changes; with nothing in them they are not a stop. */
const liveRoles = new Set(['status', 'alert', 'log', 'marquee', 'timer']);
// LabelText is Chromium's role for <label>: its text is read from the StaticText inside, so an unnamed label adds nothing.
const unnamedContainerRoles = new Set(['paragraph', 'section', 'group', 'list', 'listitem', 'main', 'navigation', 'banner', 'contentinfo', 'complementary', 'form', 'LabelText', ...liveRoles])
const clickableRoles = new Set(['button', 'link', 'checkbox', 'radio', 'switch', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab']);
const editableRoles = new Set(['textbox', 'searchbox', 'spinbutton', 'combobox']);

type AXValue = { relatedNodes?:{backendDOMNodeId:number}[]; value?: unknown; sources?: { type: string; superseded?: boolean; value?: { value?: unknown } }[] };
type AXNode = {
  nodeId: string; backendDOMNodeId?: number; parentId?: string; childIds?: string[];
  ignored: boolean; role?: AXValue; name?: AXValue; value?: AXValue; description?: AXValue;
  properties?: { name: string; value: AXValue }[];
  ignoredReasons?: {name:string;value:AXValue}[];
};
type Container = VoiceOverContainer;
type Cell = VoiceOverCell;
type CursorNode = { identity: string; backendDOMNodeId?: number; axId: string; semantic: SimulatedSemanticNode; unmodeledContext?: boolean; end?: boolean; containers?: Container[]; cell?: Cell; textGroup?: string; hintInCell?:boolean;hintTextFragment?:boolean; labelText?: boolean; popup?: { name: string; count: number; activeId?: string; active?: SimulatedSemanticNode } };
type DOMMeta = { tag: string;text?:string; attributes: Record<string, string>; parent?: number; nodeId: number; generatedContent: boolean };
type EditState = VoiceOverEditState;
export type MockWordingOptions = { profile: string; metadata?: unknown; capabilities?: Backend['capabilities']; format: (node: SimulatedSemanticNode | undefined, context: { sourceCommand: string; unmodeledContext: boolean }) => { speech: string; evidence: unknown } };
type Window = { id: string; startedAt: string; outputs: BackendOutput[] };
type ActionReceipt = { backend: 'mock-voiceover'; evidenceProvenance: 'simulation'; acknowledged: true; activation?: 'dom-click-untrusted' | 'dom-focus'; };

/** Browser-backed testing adapter. It never connects to or claims to measure native VoiceOver. */
export class MockVoiceOverBackend implements Backend {
  readonly observationKind = 'screenreader' as const;
  readonly evidenceProvenance = 'simulation' as const;
  readonly capabilities: Backend['capabilities'];
  private sourceCommand = 'next_item';
  constructor(private readonly wording?: MockWordingOptions, private readonly observationMinWaitMs = wording ? 0 : 800, private readonly referenceBrowser:MockVoiceOverReferenceBrowser='safari') {
    if (!Number.isFinite(observationMinWaitMs) || observationMinWaitMs < 0) throw new Error('Invalid minimum observation wait');
    if(!['safari','chrome'].includes(referenceBrowser))throw new Error('Reference browser must be safari or chrome');
    this.capabilities=Object.freeze(wording?.capabilities ?? {intents,keys,textEntry:true,replaceText:true});
  }
  private get profile(){return this.wording?.profile??(this.referenceBrowser==='chrome'?MOCK_VOICEOVER_CHROME_PROFILE:MOCK_VOICEOVER_PROFILE);}
  private actionEndedAt = 0;
  private page?: Page;
  private session?: CDPSession;
  private cssEnabled = false;
  private fragmentTargets = new Map<string,string>();
  private state: 'new' | 'ready' | 'closed' = 'new';
  private busy = false;
  private nodes: CursorNode[] = [];
  private cursor?: string;
  private focusedIdentity?: string;
  private focusedEdit?: EditState;
  private focusInitialized = false;
  private window?: Window;
  private nextWindow = 1;
  private sequence = 0;
  private lastAnnouncement?: string;
  private hintTarget?: string;
  private pendingHint?: {text:string;dueAt:number};
  private speechContext: VoiceOverSpeechContext = {containers:[]};
  /** The document whose title was last spoken; a new one is announced by its title. */
  private documentIdentity?: string;
  private lastCurrentFingerprint?: string;
  /** Each live region's text as last seen (undefined before the first look: what a page loads with is not announced). */
  private liveTexts?: Map<string, string>;
  /** Live-region text that changed, spoken after the speech of the action that changed it. */
  private pendingLive: string[] = [];
  private listeners = new Set<(event: unknown) => void>();

  attachSession(session: BackendSession): void {
    const page = session.page as Page;
    if (this.state === 'closed') throw new Error('Mock VoiceOver backend is closed.');
    if (this.page && this.page !== page) throw new Error('Mock VoiceOver backend is already attached to a page.');
    this.page = page;
  }

  async start({ signal }: BackendOperationOptions = {}): Promise<unknown> {
    signal?.throwIfAborted();
    if (this.state !== 'new') throw new Error('Mock VoiceOver backend has already started or closed.');
    this.state = 'ready';
    return {
      backend: 'mock-voiceover', observationKind: this.observationKind, evidenceProvenance: this.evidenceProvenance,
      profile: this.profile, capabilities: this.capabilities, limitations: [...MOCK_VOICEOVER_LIMITATIONS,...(!this.wording&&this.referenceBrowser==='chrome'?['Chrome reference profile is experimental: native controls and selected table-field caret contexts are calibrated; broader structure, partial selections, non-Latin interior word positions, editing hints and task fidelity require independent validation.']:[])], ...(this.wording ? {wordingEvidenceProfile: structuredClone(this.wording.metadata)} : {}),
      environment: { atName: this.wording ? 'Corpus word-pattern mock (simulation)' : 'Mock VoiceOver (simulation)', atVersion: this.referenceBrowser==='chrome'?'10':'16', platformName: 'chromium', locale: 'en', nativeScreenReader: false,...(!this.wording?{referenceBrowser:this.referenceBrowser}:{}) },
      semanticSource: 'Chromium CDP Accessibility.getFullAXTree', activation: 'guarded DOM click / editable-field focus approximation',
    };
  }

  subscribe(listener: (event: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(event: unknown): void {
    for (const listener of this.listeners) {
      try { listener(structuredClone(event)); } catch { /* Subscribers own their failures. */ }
    }
  }

  private getPage(): Page {
    if (this.state !== 'ready' || !this.page || this.page.isClosed()) throw new Error('Mock VoiceOver backend requires an attached active Chromium page.');
    return this.page;
  }

  private async cdp(signal?: AbortSignal): Promise<CDPSession> {
    signal?.throwIfAborted();
    if (!this.session) {
      this.session = await this.getPage().context().newCDPSession(this.getPage());
      signal?.throwIfAborted();
      await this.session.send('Accessibility.enable');
    }
    signal?.throwIfAborted();
    return this.session;
  }

  private beginWindow(): Window {
    return this.window ??= { id: `mock-voiceover-window-${this.nextWindow++}`, startedAt: new Date().toISOString(), outputs: [] };
  }

  private announce(node: CursorNode | undefined, fallback = 'No accessible content', force = true, checkedStateChanged = false, focusEntry = false): void {
    const rendered = this.wording?.format(node?.semantic, { sourceCommand: this.sourceCommand, unmodeledContext: node?.unmodeledContext ?? true });
    let text = rendered?.speech ?? (node ? formatSimulatedSpeech(node.semantic, checkedStateChanged,this.sourceCommand) : fallback);
    const formatted = !this.wording && node ? formatVoiceOverSpeech({
      target:node,command:this.sourceCommand,referenceBrowser:this.referenceBrowser,
      focused:node.identity===this.focusedIdentity,focusEntry,edit:this.focusedEdit,checkedStateChanged,
    },this.speechContext) : undefined;
    if(formatted){text=formatted.speech;this.speechContext=formatted.context;}
    const fingerprint = JSON.stringify([node?.identity, text]);
    if (!force && this.lastAnnouncement === fingerprint) return;
    this.lastAnnouncement = fingerprint;
    const output: BackendOutput = {
      sequence: ++this.sequence, receivedAt: new Date().toISOString(), text,
      raw: { evidenceProvenance: 'simulation', profile: this.profile, ...(rendered ? { wordingEvidence: rendered.evidence } : {}), semanticSource: 'chromium-accessibility-tree', ...(node ? { semantic: { ...node.semantic } } : {}) },
    };
    this.beginWindow().outputs.push(output);
    this.emit({ type: 'output', timestamp: Date.parse(output.receivedAt), evidenceProvenance: 'simulation', windowId: this.window!.id, output });
    if(!this.wording&&node){
      const hintTarget=node.semantic.role==='radio'?`${node.identity}:${node.semantic.checked}`:node.identity;
      if(this.hintTarget!==hintTarget){
        const text=formatted?.usageHint;
        this.pendingHint=text?{text,dueAt:Date.now()+600}:undefined;
      }
      this.hintTarget=hintTarget;
    }else if(!this.wording){this.hintTarget=undefined;this.pendingHint=undefined;}
  }

  /** Speech that belongs to no cursor stop, such as the title of a page that just loaded. */
  private announceText(text: string, kind: 'page-title' | 'headings-list' | 'live-region' | 'editing' | 'value-change' | 'usage-hint'): void {
    const output: BackendOutput = {
      sequence: ++this.sequence, receivedAt: new Date().toISOString(), text,
      raw: { evidenceProvenance: 'simulation', profile: this.profile, semanticSource: 'chromium-accessibility-tree', announcement: kind },
    };
    this.beginWindow().outputs.push(output);
    this.emit({ type: 'output', timestamp: Date.parse(output.receivedAt), evidenceProvenance: 'simulation', windowId: this.window!.id, output });
  }

  /** Speaks live-region changes queued by the last refresh, after whatever the action itself said (a polite announcement). */
  private flushLive(): void {
    for (const text of this.pendingLive.splice(0)) this.announceText(text, 'live-region');
  }

  private current(): CursorNode | undefined { return this.nodes.find(node => node.identity === this.cursor); }

  private currentFingerprint(): string { return JSON.stringify([this.cursor, this.current()?.semantic]); }

  private async readFocusedIdentity(session: CDPSession, signal?: AbortSignal): Promise<string | undefined> {
    this.focusedEdit = undefined;
    const { result } = await session.send('Runtime.evaluate', {
      expression: `(() => { if (!document.hasFocus()) return null; let element = document.activeElement; while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement; return element; })()`,
      returnByValue: false,
    });
    signal?.throwIfAborted();
    if (!result.objectId) return undefined;
    try {
      const { node } = await session.send('DOM.describeNode', { objectId: result.objectId });
      signal?.throwIfAborted();
      if (!this.wording) {
        const edit = await session.send('Runtime.callFunctionOn', { objectId: result.objectId, returnByValue: true,
          functionDeclaration: `function() { if (!(this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement) || this.type === 'password' || this.selectionStart === null) return null; return {value:this.value,start:this.selectionStart,end:this.selectionEnd,multiline:this instanceof HTMLTextAreaElement}; }` });
        if (edit.result.value) this.focusedEdit = edit.result.value as EditState;
      }
      return `dom:${node.backendNodeId}`;
    } finally { await session.send('Runtime.releaseObject', { objectId: result.objectId }).catch(() => {}); }
  }

  private async refresh(signal?: AbortSignal): Promise<void> {
    const session = await this.cdp(signal);
    const result = await session.send('Accessibility.getFullAXTree');
    signal?.throwIfAborted();
    const axNodes = result.nodes as AXNode[];
    const byId = new Map(axNodes.map(node => [node.nodeId, node]));
    const byDOM=new Map(axNodes.filter(n=>n.backendDOMNodeId!==undefined).map(n=>[n.backendDOMNodeId!,n]));
    const dom = new Map<number, DOMMeta>();
    if (!this.wording) {
      const document = await session.send('DOM.getDocument', { depth: -1, pierce: true });
      const scan = (n: { nodeId: number; backendNodeId: number; nodeName: string;nodeValue?:string; attributes?: string[]; children?: unknown[]; shadowRoots?: unknown[]; pseudoElements?: unknown[] }, parent?: number) => {
        const attrs = n.attributes ?? [], attributes: Record<string, string> = {};
        for (let i = 0; i < attrs.length; i += 2) attributes[attrs[i]!] = attrs[i + 1]!;
        dom.set(n.backendNodeId, { tag: n.nodeName.toLowerCase(),text:n.nodeName==='#text'?n.nodeValue:undefined, attributes, parent, nodeId:n.nodeId, generatedContent:!!n.pseudoElements?.length });
        for (const child of [...n.children ?? [], ...n.shadowRoots ?? []]) scan(child as typeof n, n.backendNodeId);
      };
      scan(document.root);
    }
    const next: CursorNode[] = [];
    const visited = new Set<string>();
    const containers = new Map<string, Container>();
    const cellPositions = new Map<number, Omit<Cell, 'table' | 'header'>>();
    const tableSizes = new Map<number, { rows: number; columns: number }>();
    const ancestor = (id: number, tag: string): number | undefined => {
      let parent = dom.get(id)?.parent;
      while (parent !== undefined) { if (dom.get(parent)?.tag === tag) return parent; parent = dom.get(parent)?.parent; }
      return undefined;
    };
    for (const [tableId, meta] of dom) if (meta.tag === 'table') {
      const rows = [...dom].filter(([id, m]) => m.tag === 'tr' && ancestor(id, 'table') === tableId), occupied = new Set<string>();
      let columns = 0;
      for (const [row, [rowId]] of rows.entries()) {
        let column = 0;
        for (const [id, cell] of [...dom].filter(([, m]) => ['td','th'].includes(m.tag) && m.parent === rowId)) {
          while (occupied.has(`${row}:${column}`)) column++;
          const colspan = Math.min(1000, Math.max(1, Number.parseInt(cell.attributes.colspan ?? '1') || 1));
          const rowspan = Math.min(rows.length - row, Math.max(1, Number.parseInt(cell.attributes.rowspan ?? '1') || 1));
          cellPositions.set(id, { row, column, rows: rows.length, columns: 0,rowSpan:rowspan,columnSpan:colspan });
          for (let r = row; r < row + rowspan; r++) for (let c = column; c < column + colspan; c++) occupied.add(`${r}:${c}`);
          column += colspan; columns = Math.max(columns, column);
        }
      }
      tableSizes.set(tableId, { rows: rows.length, columns });
      for (const [id, cell] of cellPositions) if (ancestor(id, 'table') === tableId) cell.columns = columns;
    }
    const children = (n: AXNode) => (n.childIds ?? []).map(id => byId.get(id)).filter((child): child is AXNode => !!child);
    const recoveredLabels=new Map<string,string>();
    if(!this.wording&&this.referenceBrowser==='safari')for(const n of axNodes.filter(n=>n.ignored&&n.backendDOMNodeId!==undefined)){
      const meta=dom.get(n.backendDOMNodeId!);
      if(meta?.tag!=='#text'||!meta.text?.trim())continue;
      let ancestor:AXNode|undefined=n,labelFor=false,hidden=false;
      while(ancestor){
        if(ancestor.ignoredReasons?.some(r=>!['labelFor','presentationalRole','uninteresting'].includes(r.name)))hidden=true;
        if(ancestor.ignoredReasons?.some(r=>r.name==='labelFor')&&ancestor.backendDOMNodeId!==undefined&&dom.get(ancestor.backendDOMNodeId)?.tag==='label')labelFor=true;
        ancestor=ancestor.parentId?byId.get(ancestor.parentId):undefined;
      }
      if(labelFor&&!hidden)recoveredLabels.set(n.nodeId,meta.text);
    }
    const exposedChildren = (n:AXNode):AXNode[] => children(n).flatMap(c=>c.ignored||['generic','none','strong','emphasis'].includes(stringValue(c.role))?exposedChildren(c):[c]);
    const headingProjections = new Map<string,{level:number;parts?:SimulatedSemanticNode['headingParts'];outer?:boolean;target?:AXNode;name?:string}>(), folded = new Set<string>();
    const fold = (n:AXNode) => {folded.add(n.nodeId);for(const c of children(n))fold(c);};
    const containsReadingObject=(n:AXNode):boolean=>children(n).some(c=>!c.ignored&&(namedLeafRoles.has(stringValue(c.role))||stringValue(c.role)==='DisclosureTriangle')||containsReadingObject(c));
    if(!this.wording){
      for(const n of axNodes.filter(n=>!n.ignored&&stringValue(n.role)==='link')){
        const inner=exposedChildren(n),h=inner.length===1?inner[0]:undefined;
        if(h&&stringValue(h.role)==='heading'&&typeof property(h,'level')==='number'&&stringValue(n.name)===stringValue(h.name)&&exposedChildren(h).every(c=>stringValue(c.role)==='StaticText')){
          headingProjections.set(n.nodeId,{level:property(h,'level') as number,outer:true,target:n});
          for(const c of children(n))fold(c);
        }
      }
      for(const n of axNodes.filter(n=>!n.ignored&&!folded.has(n.nodeId)&&stringValue(n.role)==='heading')){
        const inner=exposedChildren(n);
        if(typeof property(n,'level')!=='number'||!inner.length||!inner.every(c=>['StaticText','link'].includes(stringValue(c.role))))continue;
        const parts=inner.map(c=>({text:stringValue(c.name).trim()||'space',...(stringValue(c.role)==='link'?{link:true}:{})}));
        if(!parts.some(p=>p.link)&&parts.length===1)continue;
        const explicitName=n.backendDOMNodeId!==undefined&&dom.get(n.backendDOMNodeId)?.attributes['aria-label']&&stringValue(n.name)!==parts.map(p=>p.text).join(' ');
        if(explicitName&&!(parts.length===1&&parts[0]!.link))continue;
        headingProjections.set(n.nodeId,{level:property(n,'level') as number,...(explicitName?{name:stringValue(n.name)}:{parts}),...(parts.length===1&&parts[0]!.link?{target:inner[0]}:{})});
        for(const c of children(n))fold(c);
      }
    }
    const timeUnits=new Map<string,{name:string;repeated:boolean}>();
    if(!this.wording)for(const n of axNodes.filter(n=>!n.ignored&&stringValue(n.role)==='time'&&!stringValue(n.name))){
      const meta=n.backendDOMNodeId===undefined?undefined:dom.get(n.backendDOMNodeId),inner=exposedChildren(n).filter(c=>stringValue(c.name).trim());
      if(meta?.tag==='time'&&inner.length===1&&stringValue(inner[0]!.role)==='StaticText'){
        timeUnits.set(n.nodeId,{name:stringValue(inner[0]!.name).trim(),repeated:/^\d{4}-\d{2}-\d{2}$/.test(meta.attributes.datetime??'')});
        for(const c of children(n))fold(c);
      }
    }
    const articleHeading = (n:AXNode):string => {
      for(const c of children(n)){if(stringValue(c.role)==='article')continue;if(!c.ignored&&stringValue(c.role)==='heading')return stringValue(c.name);const name=articleHeading(c);if(name)return name;}
      return '';
    };
    const containsImage = (n: AXNode): boolean => children(n).some(c => !c.ignored && stringValue(c.role) === 'image' || containsImage(c));
    const insideNamedControl = (n: AXNode): boolean => {
      const seen = new Set<string>();
      let parent = n.parentId ? byId.get(n.parentId) : undefined;
      while (parent && !seen.has(parent.nodeId)) {
        if (!parent.ignored && stringValue(parent.name) && (stringValue(parent.role) === 'link' || stringValue(parent.role) === 'button' && !stringValue(n.name))) return true;
        seen.add(parent.nodeId); parent = parent.parentId ? byId.get(parent.parentId) : undefined;
      }
      return false;
    };
    const labelControls = (n: AXNode): string[] => namedLeafRoles.has(stringValue(n.role)) ? [stringValue(n.name)] : children(n).flatMap(labelControls);
    const listboxOptions=(n:AXNode):{name:string;selected:boolean}[]=>children(n).flatMap(c=>stringValue(c.role)==='option'?[{name:stringValue(c.name),selected:property(c,'selected')===true}]:stringValue(c.role)==='listbox'?[]:listboxOptions(c));
    const listText = (n: AXNode): string => {
      const role = stringValue(n.role);
      if (role === 'ListMarker' || namedLeafRoles.has(role) || role === 'list') return '';
      if (role === 'StaticText') return stringValue(n.name);
      return children(n).map(listText).filter(Boolean).join(' ');
    };
    const layoutLists = new Set<string>();
    if (!this.wording) for (const list of axNodes.filter(n=>!n.ignored && stringValue(n.role)==='list')) {
      const meta=list.backendDOMNodeId===undefined?undefined:dom.get(list.backendDOMNodeId);
      if (!meta || !['ul','ol'].includes(meta.tag) || meta.attributes.role?.split(/\s+/).includes('list')) continue;
      let parent=meta.parent===undefined?undefined:dom.get(meta.parent), inNavigation=false;
      while(parent){if(parent.tag==='nav'||parent.attributes.role==='navigation'){inNavigation=true;break;}parent=parent.parent===undefined?undefined:dom.get(parent.parent);}
      const items=children(list).filter(n=>!n.ignored);
      if (inNavigation || !items.length || !items.every(item=>stringValue(item.role)==='listitem' && children(item).length===1 && stringValue(children(item)[0]!.role)==='link' && item.backendDOMNodeId!==undefined && !dom.get(item.backendDOMNodeId)?.generatedContent)) continue;
      if (!this.cssEnabled) {await session.send('DOM.enable');await session.send('CSS.enable');this.cssEnabled=true;}
      const style=await session.send('CSS.getComputedStyleForNode',{nodeId:meta.nodeId}); signal?.throwIfAborted();
      if (style.computedStyle.some((p:{name:string;value:string})=>p.name==='list-style-type'&&p.value==='none') && style.computedStyle.some((p:{name:string;value:string})=>p.name==='list-style-image'&&p.value==='none')) layoutLists.add(list.nodeId);
    }
    // External formatter profiles retain historical filtering; native-profile labels follow DOM order.
    let lastSaid = '';
    const visit = (node: AXNode, suppressText: boolean, groupNames: readonly string[], scopes: Container[] = [], labelNames: string[] = []) => {
      if (visited.has(node.nodeId)||folded.has(node.nodeId)) return;
      visited.add(node.nodeId);
      const sourceRole = stringValue(node.role);
      const timeUnit=timeUnits.get(node.nodeId);
      const recoveredLabel=recoveredLabels.get(node.nodeId);
      const name = recoveredLabel??timeUnit?.name??(stringValue(node.name)||(!this.wording&&sourceRole==='article'?articleHeading(node):'')), said = name.trim();
      const meta = node.backendDOMNodeId === undefined ? undefined : dom.get(node.backendDOMNodeId);
      const projection=headingProjections.get(node.nodeId), representative=projection?.target??node;
      const role = recoveredLabel!==undefined?'StaticText':projection?'heading':timeUnit?'StaticText':!this.wording && meta?.tag === 'table' ? 'table' : !this.wording && meta?.tag === 'dl' ? 'descriptionlist' : sourceRole;
      const list = !this.wording && !node.ignored && role === 'list' && !layoutLists.has(node.nodeId);
      const listItem = !this.wording && !node.ignored && role === 'listitem';
      const description = !this.wording && !node.ignored && role === 'descriptionlist';
      const descriptionItem = !this.wording && !node.ignored && ['dt','dd'].includes(meta?.tag ?? '');
      const table = !this.wording && !node.ignored && role === 'table';
      const ownsCell=!this.wording&&node.backendDOMNodeId!==undefined&&cellPositions.has(node.backendDOMNodeId),transparentCell=ownsCell&&containsReadingObject(node);
      const structuralRow = !this.wording && (transparentCell||['row','rowgroup','LayoutTableRow','strong','emphasis','blockquote'].includes(role) || ['figure','sectionheader','sectionfooter'].includes(role)&&!name || layoutLists.has(node.nodeId) || role==='listitem' && !!node.parentId && layoutLists.has(node.parentId) || role === 'image' && insideNamedControl(node));
      const caption = !this.wording && meta?.tag === 'caption';
      let cellOwner=!this.wording?node.backendDOMNodeId:undefined;
      while(cellOwner!==undefined&&!cellPositions.has(cellOwner))cellOwner=dom.get(cellOwner)?.parent;
      const cell=cellOwner===undefined?undefined:cellPositions.get(cellOwner);
      const container = !this.wording && !node.ignored && (list || description || table || ['article','menu','listbox'].includes(role) || (['figure','group','dialog','alertdialog','radiogroup','tablist'].includes(role) && !!name) || ['main','navigation','banner','contentinfo','complementary','region','form'].includes(role));
      const scope = container ? { id: node.nodeId, name, role, items: 0, ...(role==='article'&&!stringValue(node.name)?{inferredName:true}:{}) } : undefined;
      if (scope && table && node.backendDOMNodeId !== undefined) Object.assign(scope, tableSizes.get(node.backendDOMNodeId));
      if (scope) containers.set(scope.id, scope);
      const innerScopes = scope ? [...scopes, scope] : scopes;
      const repeated = textRoles.has(role) && !!this.wording && (said === lastSaid || groupNames.includes(said));
      if ((!node.ignored||recoveredLabel!==undefined) && !structuralRow && !caption && !skippedRoles.has(role) && !(suppressText && textRoles.has(role)) && (!(unnamedContainerRoles.has(role) && !name) || list || listItem || description || descriptionItem || scope) && (name || !textRoles.has(role)) && !repeated) {
        const semantic = semanticNode(representative);
        if (!this.wording) {
          if (meta) {
            semantic.tagName = meta.tag;
            if (meta.tag === 'input') { semantic.inputType = meta.attributes.type ?? 'text'; semantic.autofill = ['username','email','name','given-name','family-name'].includes(meta.attributes.autocomplete ?? ''); }
          }
          // CDP flattens inline descriptions and native tooltip help into one field.
          // shortcut: combined/ambiguous sources need Native observations before projection.
          const descriptionText=semantic.description,attrs=meta?.attributes??{};
          const related=node.properties?.find(p=>p.name==='describedby')?.value.relatedNodes?.length;
          const ariaDescription=attrs['aria-description']?.trim();
          if(descriptionText){
            if(descriptionText.trim()===ariaDescription||related&&descriptionText!==attrs.title)semantic.hasMoreContent=true;
            else if(!related&&!ariaDescription&&descriptionText===attrs.title){
              semantic.help=descriptionText;semantic.description=undefined;semantic.hasMoreContent=false;
            }
          }
          semantic.hasPopup = typeof property(node, 'hasPopup') === 'string' ? property(node, 'hasPopup') as string : undefined;
          const invalid = property(node, 'invalid');
          semantic.invalid = invalid !== undefined && invalid !== false && invalid !== 'false';
          // Safari exposes an empty required native input as invalid before submission; Chromium AX can defer it.
          if (meta?.tag === 'input' && 'required' in meta.attributes && !semantic.value && !semantic.disabled && !semantic.readonly && ['text','email','tel','url','number','search','password'].includes(semantic.inputType ?? 'text')) semantic.invalid = true;
          semantic.nameFromPlaceholder = node.name?.sources?.some(source => source.type === 'placeholder' && !source.superseded && source.value?.value === name);
          semantic.currentPage = meta?.attributes['aria-current'] === 'page';
          if (role === 'link') {
            semantic.containsImage = containsImage(node);
            const parent = node.parentId ? byId.get(node.parentId) : undefined;
            const list = parent?.parentId ? byId.get(parent.parentId) : undefined;
            if (parent && stringValue(parent.role) === 'listitem' && children(parent).length === 1 && list && stringValue(list.role) === 'list' && !layoutLists.has(list.nodeId)) {
              const siblings = children(list).filter(c => stringValue(c.role) === 'listitem');
              semantic.position = siblings.indexOf(parent) + 1; semantic.setSize = siblings.length;
            }
          }
          if (role === 'progressbar') {
            semantic.valueMin = typeof property(node, 'valuemin') === 'number' ? property(node, 'valuemin') as number : 0;
            semantic.valueMax = typeof property(node, 'valuemax') === 'number' ? property(node, 'valuemax') as number : meta?.tag === 'progress' ? Number(meta.attributes.max ?? '1') : 100;
          }
          semantic.role = role;
          if(recoveredLabel!==undefined)semantic.name=recoveredLabel;
          if(role==='article')semantic.name=name;
          if(projection){semantic.level=projection.level;semantic.headingParts=projection.parts;semantic.headingLink=!!projection.target;if(projection.name)semantic.name=projection.name;if(projection.outer)semantic.headingLinkOrder='link-heading';}
          if(timeUnit){semantic.name=timeUnit.name;semantic.timeValueRepeated=timeUnit.repeated;}
          if(role==='listbox'&&this.referenceBrowser==='safari')semantic.listboxSummary={native:meta?.tag==='select',options:listboxOptions(node)};
          if (list) { semantic.setSize = children(node).filter(c => stringValue(c.role) === 'listitem').length; semantic.level = innerScopes.filter(c => c.role === 'list').length; }
          if (table && scope) { semantic.rows = (scope as Container).rows; semantic.columns = (scope as Container).columns; }
          if (description) semantic.setSize = children(node).filter(c => c.backendDOMNodeId !== undefined && dom.get(c.backendDOMNodeId)?.tag === 'dt').length;
          if (descriptionItem) {
            semantic.role = 'descriptionitem'; semantic.name = name || children(node).map(listText).filter(Boolean).join(' ');
            const parent = node.parentId ? byId.get(node.parentId) : undefined;
            const siblings = parent ? children(parent).filter(c => c.backendDOMNodeId !== undefined && ['dt','dd'].includes(dom.get(c.backendDOMNodeId)?.tag ?? '')) : [];
            semantic.position = siblings.indexOf(node) + 1; semantic.setSize = siblings.length;
          }
          if (listItem) {
            semantic.name = name || children(node).map(listText).filter(Boolean).join(' ');
            const marker = children(node).find(c => stringValue(c.role) === 'ListMarker');
            const markerName = marker ? stringValue(marker.name).trim() : '';
            semantic.marker = ({ '•': 'bullet', '◦': 'white bullet', '▪': 'black square' } as Record<string, string>)[markerName] ?? markerName;
            const parent = node.parentId ? byId.get(node.parentId) : undefined;
            const siblings = parent ? children(parent).filter(c => stringValue(c.role) === 'listitem') : [];
            semantic.position = siblings.findIndex(c => c.nodeId === node.nodeId) + 1; semantic.setSize = siblings.length;
          }
        }
        if (formatSimulatedSpeech(semantic).trim()) {
          const tableScope = [...innerScopes].reverse().find(c => c.role === 'table');
          const tableParent = cellOwner!==undefined ? ancestor(cellOwner, 'table') : undefined;
          const header = cell && tableParent !== undefined ? axNodes.find(n => n.backendDOMNodeId !== undefined && ancestor(n.backendDOMNodeId, 'table') === tableParent && cellPositions.get(n.backendDOMNodeId)?.row === 0 && cellPositions.get(n.backendDOMNodeId)?.column === cell.column&&cellPositions.get(n.backendDOMNodeId)?.columnSpan===1) : undefined;
          let paragraph = node.parentId ? byId.get(node.parentId) : undefined;
          while (paragraph && stringValue(paragraph.role) !== 'paragraph') paragraph = paragraph.parentId ? byId.get(paragraph.parentId) : undefined;
          let label = node.parentId ? byId.get(node.parentId) : undefined;
          while (label && stringValue(label.role) !== 'LabelText' && (label.backendDOMNodeId===undefined||dom.get(label.backendDOMNodeId)?.tag!=='label')) label = label.parentId ? byId.get(label.parentId) : undefined;
          next.push({ identity: identity(representative), backendDOMNodeId: representative.backendDOMNodeId, axId: node.nodeId, semantic, unmodeledContext: hasUnmodeledContext(node, byId), containers: innerScopes, ...(!this.wording && role === 'StaticText' && paragraph ? { textGroup: paragraph.nodeId } : {}),
            hintInCell:node.backendDOMNodeId!==undefined&&(ancestor(node.backendDOMNodeId,'td')!==undefined||ancestor(node.backendDOMNodeId,'th')!==undefined),
            hintTextFragment:!!paragraph&&exposedChildren(paragraph).findIndex(c=>c.nodeId===node.nodeId)>0||labelNames.some(n=>n.trim()===name.trim())||cellOwner!==undefined&&!!byDOM.get(cellOwner)&&exposedChildren(byDOM.get(cellOwner)!).findIndex(c=>c.nodeId===node.nodeId)>0,
            ...(!this.wording && textRoles.has(role) && label && labelControls(label).some(n=>n.trim()===name.trim()) ? { labelText: true } : {}),
            ...(cell && tableScope ? { cell: { ...cell, table: tableScope.id, header: header ? stringValue(header.name) : '' } } : {}) });
          if (said) lastSaid = said;
        }
      }
      const suppressDescendantText = suppressText || listItem || descriptionItem || caption || ownsCell&&!transparentCell || (!node.ignored && !!name && (namedLeafRoles.has(role)||!this.wording&&role==='DisclosureTriangle'&&meta?.tag==='summary'));
      const inner = !node.ignored && said && !textRoles.has(role) ? [...groupNames, said] : groupNames;
      let innerLabels = labelNames;
      if (!this.wording && (meta?.tag === 'label' || role === 'LabelText')) {
        innerLabels = [...labelNames];
      }
      for (const childId of node.childIds ?? []) {
        const child = byId.get(childId);
        if (child) {
          visit(child, suppressDescendantText, inner, innerScopes, innerLabels);
          if (!this.wording && (meta?.tag === 'label' || role === 'LabelText')) innerLabels = [...innerLabels, ...labelControls(child)];
        }
      }
      if (scope && ['article','figure','group','list','descriptionlist','table','main','navigation','banner','contentinfo','complementary','region','form'].includes(role)) next.push({ identity: identity(node) + ':end', axId: node.nodeId,
        semantic: { ...semanticNode(node), role: ['list','descriptionlist','table'].includes(role) ? 'StaticText' : role,
          name: role === 'list' ? 'end of list' : role === 'descriptionlist' ? 'end of description list' : role === 'table' ? 'end of table' : name ? `end of ${name}` : 'end of' },
        containers: innerScopes, end: true });
    };
    for (const node of axNodes) if (!node.parentId || !byId.has(node.parentId)) visit(node, false, []);
    if (!this.wording) for (let i = next.length - 1; i > 0; i--) {
      const a = next[i - 1]!, b = next[i]!;
      if (a.textGroup && a.textGroup === b.textGroup && a.semantic.role === 'StaticText' && b.semantic.role === 'StaticText' && !a.end && !b.end) {
        a.semantic.name = (a.semantic.name + ' ' + b.semantic.name).replace(/\s+/g, ' ').replace(/\s+([.,!?;:])/g, '$1').trim(); next.splice(i, 1);
      }
    }
    for (const c of containers.values()) c.items = next.filter(n => !n.end && !n.labelText && n.axId !== c.id && n.containers?.at(-1)?.id === c.id).length;
    this.fragmentTargets.clear();
    if(!this.wording)for(const n of next.filter(n=>!n.end)){
      let id=n.backendDOMNodeId;
      while(id!==undefined){const m=dom.get(id);if(!m)break;const target=m.attributes.id||(m.tag==='a'?m.attributes.name:undefined);if(target&&!this.fragmentTargets.has(target))this.fragmentTargets.set(target,n.identity);id=m.parent;}
    }
    if (!this.wording) for (const n of next.filter(n => ['radio','tab','menuitem','option'].includes(n.semantic.role))) {
      const nativeRadio=(s:CursorNode)=>s.semantic.role==='radio'&&s.backendDOMNodeId!==undefined&&dom.get(s.backendDOMNodeId)?.tag==='input';
      const radioGroup=(s:CursorNode)=>{
        const id=s.backendDOMNodeId!,meta=dom.get(id)!,name=meta.attributes.name;
        if(!name&&this.referenceBrowser==='safari')return undefined;
        const form=meta.attributes.form===undefined?ancestor(id,'form'):[...dom].find(([,m])=>m.tag==='form'&&m.attributes.id===meta.attributes.form)?.[0];
        let root=id;while(dom.get(root)?.parent!==undefined&&dom.get(root)?.tag!=='#document-fragment')root=dom.get(root)!.parent!;
        return JSON.stringify([name||`anonymous:${id}`,form,root]);
      };
      if(nativeRadio(n)){
        const group=radioGroup(n);
        if(group){const siblings=next.filter(s=>!s.end&&nativeRadio(s)&&radioGroup(s)===group);n.semantic.position=siblings.indexOf(n)+1;n.semantic.setSize=siblings.length;}
        continue;
      }
      const scope = n.containers ? [...n.containers].reverse().find(c => ['group','radiogroup','tablist','menu','listbox'].includes(c.role)) : undefined;
      const siblings = next.filter(s => !s.end && s.semantic.role === n.semantic.role && (scope ? s.containers?.some(c => c.id === scope.id) : true));
      n.semantic.position = siblings.indexOf(n) + 1; n.semantic.setSize = siblings.length;
    }
    if (!this.wording) for (const n of next.filter(n => n.semantic.role === 'combobox' && n.backendDOMNodeId !== undefined)) {
      const attrs = dom.get(n.backendDOMNodeId!)?.attributes;
      const listId = attrs?.['aria-controls']?.split(/\s+/).find(id => [...dom.values()].some(m => m.attributes.id === id && m.attributes.role === 'listbox'));
      const list = next.find(s => s.backendDOMNodeId !== undefined && dom.get(s.backendDOMNodeId)?.attributes.id === listId);
      const options = list ? next.filter(s => s.semantic.role === 'option' && s.containers?.some(c => c.id === list.axId)) : [];
      const active = options.find(s => s.backendDOMNodeId !== undefined && dom.get(s.backendDOMNodeId)?.attributes.id === attrs?.['aria-activedescendant']);
      n.popup = { name: list?.semantic.name ?? '', count: options.length, activeId: attrs?.['aria-activedescendant'], active: active?.semantic };
    }
    // Live regions: text that appeared or changed since the last look is queued to be spoken (not what the page loaded with).
    const live = new Map<string, string>();
    for (const node of axNodes) {
      const politeness = property(node, 'live');
      if (node.ignored || !(liveRoles.has(stringValue(node.role)) || politeness === 'polite' || politeness === 'assertive')) continue;
      live.set(identity(node), regionText(node, byId));
    }
    if (this.liveTexts) for (const [id, text] of live) if (text && text !== this.liveTexts.get(id)) this.pendingLive.push(text);
    this.liveTexts = live;
    // VoiceOver speaks the page title when a new document loads; the title is heard before anything on the page.
    const root = axNodes.find(node => ['RootWebArea', 'WebArea'].includes(stringValue(node.role)) && (!node.parentId || !byId.has(node.parentId)));
    if (root && identity(root) !== this.documentIdentity) {
      this.documentIdentity = identity(root);
      this.hintTarget=undefined;this.pendingHint=undefined;
      this.speechContext={containers:[]};
      const title = stringValue(root.name).trim();
      if (title) this.announceText(title, 'page-title');
    }
    // AX values for password fields are intentionally discarded before formatting or emitting diagnostics.
    for (const node of next) {
      if ((!editableRoles.has(node.semantic.role) && !node.semantic.value) || node.backendDOMNodeId === undefined) continue;
      const { node: dom } = await session.send('DOM.describeNode', { backendNodeId: node.backendDOMNodeId });
      signal?.throwIfAborted();
      const attrs = dom.attributes ?? [];
      for (let index = 0; index < attrs.length; index += 2) {
        if (attrs[index] === 'type' && attrs[index + 1]?.toLowerCase() === 'password') {
          node.semantic.protected = true;
          delete node.semantic.value;
        }
      }
    }
    const focusedIdentity = await this.readFocusedIdentity(session, signal);
    const oldIndex = this.nodes.findIndex(node => node.identity === this.cursor);
    const identities = new Set(next.map(node => node.identity));
    if (!this.cursor || !identities.has(this.cursor)) {
      const successor = this.nodes.slice(Math.max(0, oldIndex + 1)).find(node => identities.has(node.identity));
      const predecessor = this.nodes.slice(0, Math.max(0, oldIndex)).reverse().find(node => identities.has(node.identity));
      this.cursor = successor?.identity ?? predecessor?.identity ?? next[0]?.identity;
    }
    // Do not continuously snap back to unchanged keyboard focus while browsing static content.
    if ((!this.focusInitialized || focusedIdentity !== this.focusedIdentity) && focusedIdentity && identities.has(focusedIdentity)) this.cursor = focusedIdentity;
    this.focusInitialized = true;
    this.focusedIdentity = focusedIdentity;
    this.nodes = next;
  }

  async execute(action: BackendAction, { signal }: BackendOperationOptions = {}): Promise<ActionReceipt> {
    signal?.throwIfAborted();
    this.getPage();
    if (this.busy) throw new Error('Concurrent mock VoiceOver execution/observation is unsupported.');
    if (action.kind === 'intent' && !this.capabilities.intents.includes(action.intent)) throw new Error(`Unsupported mock VoiceOver intent: ${action.intent}`);
    if (action.kind === 'key' && !this.capabilities.keys.includes(action.key)) throw new Error(`Unsupported mock VoiceOver key: ${action.key}`);
    if (!['intent', 'key', 'typeText', 'replaceText'].includes(action.kind)) throw new Error('Unsupported mock VoiceOver action.');
    if (action.kind==='typeText'&&!this.capabilities.textEntry || action.kind==='replaceText'&&!this.capabilities.replaceText) throw new Error('Text entry is unsupported by this mock wording profile.');
    this.busy = true;
    this.pendingHint=undefined;
    this.sourceCommand = action.kind === 'intent' ? ({next:'next_item',previous:'previous_item',readCurrent:'read_current',readFocused:'read_focused',activate:'activate_button','heading.next':'next_heading','heading.previous':'previous_heading','form.next':'next_form_control','headings.list':'rotor_headings'}[action.intent] ?? action.intent) : action.kind === 'key' ? ({Tab:'next_focusable_item','Shift+Tab':'previous_focusable_item',Space:'activate_form_control',Enter:'enter',Escape:'escape'}[action.key] ?? action.key) : 'enter_text';
    this.beginWindow();
    try {
      await this.refresh(signal);
      signal?.throwIfAborted();
      const receipt: ActionReceipt = { backend: 'mock-voiceover', evidenceProvenance: 'simulation', acknowledged: true };
      const move = action.kind === 'intent' ? moves[action.intent] : undefined;
      if (move) {
        const currentIndex = this.nodes.findIndex(node => node.identity === this.cursor);
        let index = currentIndex + move.step;
        while (index >= 0 && index < this.nodes.length && (move.match&&!move.match(this.nodes[index]!.semantic.role)
          || !this.wording&&this.referenceBrowser==='safari'&&this.nodes[index]!.containers?.some(c=>c.role==='listbox'&&c.id!==this.nodes[index]!.axId))) index += move.step;
        if (index >= 0 && index < this.nodes.length) {
          this.cursor = this.nodes[index]!.identity;
          if (!this.wording) { await this.focusCursor(signal); await this.refresh(signal); }
          this.announce(this.current());
        } else if (!this.wording && action.kind === 'intent' && action.intent === 'next'
          && this.current()?.semantic.role === 'button' && !this.current()?.semantic.disabled
          && this.current()?.semantic.pressed === undefined && this.current()?.semantic.expanded === undefined) this.announce(this.current());
        else this.announce(undefined, move.none);
      } else if (action.kind === 'intent' && action.intent === 'headings.list') this.announceText(headingsList(this.nodes), 'headings-list');
      else if (action.kind === 'intent' && action.intent === 'readCurrent') this.announce(this.current());
      else if (action.kind === 'intent' && action.intent === 'readFocused') {
        this.announce(this.nodes.find(node => node.identity === this.focusedIdentity), 'No focused accessible object');
      } else {
        const before = this.current();
        const beforeUrl=this.getPage().url();
        const beforeFocus = this.focusedIdentity, beforeEdit = this.focusedEdit;
        const focusedBefore = this.nodes.find(n => n.identity === beforeFocus);
        if (action.kind === 'intent') receipt.activation = await this.activate(signal);
        else if (action.kind === 'key') {
          if (['Enter', 'Space'].includes(action.key) && this.nodes.find(node => node.identity === this.focusedIdentity)?.semantic.disabled) {
            const enabledNativeButton = !this.wording && await this.getPage().evaluate(() => {
              const active=document.activeElement;
              return active instanceof HTMLButtonElement && !active.matches(':disabled') && !active.closest('[inert]');
            });
            if (!enabledNativeButton) throw new Error('Cannot activate a disabled focused accessible object.');
          }
          await this.getPage().keyboard.press(action.key);
        }
        else await this.enterText(action, signal);
        signal?.throwIfAborted();
        await this.refresh(signal);
        if(!this.wording&&action.kind==='intent'&&action.intent==='activate'&&this.getPage().url()!==beforeUrl){
          const a=new URL(beforeUrl),b=new URL(this.getPage().url());
          if(a.origin===b.origin&&a.pathname===b.pathname&&a.search===b.search&&b.hash){
            let fragment:string|undefined;try{fragment=decodeURIComponent(b.hash.slice(1));}catch{/* Invalid fragments have no measured target. */}
            const target=fragment===undefined?undefined:this.fragmentTargets.get(fragment);if(target)this.cursor=target;
          }
        }
        const after = this.current();
        const checkedStateChanged = (action.kind === 'intent' && action.intent === 'activate' || action.kind === 'key' && action.key === 'Space')
          && before !== undefined && after !== undefined && before.identity === after.identity
          && before.semantic.role === after.semantic.role && before.semantic.name === after.semantic.name
          && typeof before.semantic.checked === 'boolean' && typeof after.semantic.checked === 'boolean'
          && before.semantic.checked !== after.semantic.checked;
        const activation=!this.wording&&action.kind==='key'&&action.key==='Space'&&after
          ?formatVoiceOverActivation({beforeTarget:before,target:after,command:'activate_form_control',referenceBrowser:this.referenceBrowser},this.speechContext):undefined;
        if(activation?.status==='modeled'){
          this.speechContext=activation.context;
          for(const text of activation.utterances)this.announceText(text,'value-change');
        }else if(!this.wording&&this.referenceBrowser==='chrome'&&action.kind==='intent'&&action.intent==='activate'&&checkedStateChanged&&after&&after.semantic.role==='radio'){
          this.announceText('selected','value-change');
        }else if(!this.wording&&action.kind==='intent'&&action.intent==='activate'&&before&&after&&before.identity===after.identity&&after.semantic.role==='DisclosureTriangle'&&after.semantic.tagName==='summary'&&before.semantic.expanded!==after.semantic.expanded){
          this.announceText(after.semantic.expanded?'expanded':'collapsed','value-change');
        }else if(!this.wording&&action.kind==='intent'&&action.intent==='activate'&&before&&after&&before.identity===after.identity
          &&['button','checkbox','switch','radio'].includes(after.semantic.role)&&JSON.stringify(before.semantic)===JSON.stringify(after.semantic)){
          // Unchanged controls are silent; live-region changes are still flushed below.
        }else if (!this.wording && before && after && this.popupSpeech(action, before, after)) { /* Active-descendant announcements do not move DOM focus. */ }
        else if (!this.wording && action.kind === 'key' && after?.semantic.role === 'radio' && before?.semantic.role === 'radio' && before.semantic.inputType === 'radio'
          && before.identity !== after.identity && before.semantic.checked === true && after.semantic.checked === true && ['ArrowDown','ArrowUp','ArrowLeft','ArrowRight'].includes(action.key)) {
          this.announce({ ...before, semantic: { ...before.semantic, checked: false } }); this.announce(after);
        } else if (!this.wording && action.kind === 'key' && after?.semantic.role === 'slider' && before?.identity === after.identity && !['Tab','Shift+Tab'].includes(action.key)) {
          if (before.semantic.value !== after.semantic.value && after.semantic.value) this.announceText(after.semantic.value, 'value-change');
        } else if (!this.wording && action.kind === 'key' && before && after && action.key === 'Space'
          && before.identity === after.identity && before.semantic.role === after.semantic.role
          && (after.semantic.role === 'button' && typeof before.semantic.expanded === 'boolean' && before.semantic.expanded !== after.semantic.expanded
            || after.semantic.role === 'tab' && before.semantic.selected === false && after.semantic.selected === true)) {
          // Two native state receipts were observed for Space on expanded buttons and manually selected tabs.
          this.announce(after); this.announce(after);
        } else if (!this.wording && action.kind === 'key' && before?.semantic.role === 'tab' && after?.semantic.role === 'tab'
          && before.identity !== after.identity && after.semantic.selected === true && ['ArrowRight','ArrowLeft','ArrowDown','ArrowUp'].includes(action.key)) {
          // Automatic selection emits three receipts in the captured profile; this is not a speech queue model.
          this.announce(after); this.announce(after); this.announce(after);
        } else if (!this.wording && after && (action.kind === 'typeText' && action.text.length === 1 || action.kind === 'key')
          && this.editSpeech(action, beforeEdit, beforeFocus, after)) { /* Native editing receipts replace the object summary. */ }
        else if (!this.wording && action.kind === 'key' && action.key === 'Enter' && beforeFocus === this.focusedIdentity) {
          // Keyboard activation on the same object is silent even when its text changes; live updates remain audible.
        } else if (!this.wording && action.kind === 'key' && action.key === 'Space' && before?.identity === after?.identity
          && (after?.semantic.pressed !== undefined || after?.semantic.role === 'tab' && before?.semantic.selected === after.semantic.selected)) {
          // Native toggle buttons and an already-selected tab stay silent on Space.
        } else if (!this.wording && action.kind === 'key' && action.key === 'Space' && beforeFocus === this.focusedIdentity
          && focusedBefore?.semantic.tagName === 'button' && focusedBefore.semantic.role === 'button' && focusedBefore.semantic.expanded === undefined) {
          // Native plain-button keyboard activation stays silent; a resulting live update speaks on its own.
        } else this.announce(after, 'No accessible content', true, checkedStateChanged);
      }
      this.flushLive();
      this.lastCurrentFingerprint = this.currentFingerprint();
      this.actionEndedAt = Date.now();
      signal?.throwIfAborted();
      return receipt;
    } finally { this.busy = false; }
  }

  private async focusCursor(signal?: AbortSignal): Promise<void> {
    const node = this.current();
    if (!node || node.end || node.backendDOMNodeId === undefined) return;
    const session = await this.cdp(signal), { object } = await session.send('DOM.resolveNode', { backendNodeId: node.backendDOMNodeId });
    if (!object.objectId) return;
    try {
      const result = await session.send('Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true,
        functionDeclaration: `function() { if (this instanceof HTMLElement && this.isConnected && this.matches('a[href],button,input,textarea,select,summary,[tabindex]') && !this.matches(':disabled') && !this.closest('[inert]') && (!this.closest('[aria-disabled="true"]') || this instanceof HTMLButtonElement)) this.focus(); }` });
      signal?.throwIfAborted();
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'Cursor focus synchronization failed');
    } finally { await session.send('Runtime.releaseObject', { objectId: object.objectId }).catch(() => {}); }
  }

  private popupSpeech(action: BackendAction, before: CursorNode, after: CursorNode): boolean {
    if (after.semantic.role !== 'combobox' || before.identity !== after.identity || after.identity !== this.focusedIdentity || !after.popup) return false;
    if (action.kind === 'typeText' && action.text.length === 1 && after.semantic.expanded) {
      this.announceText(action.text, 'editing');
      this.announceText(`expanded list ${after.popup.name} ${after.popup.count} items`, 'value-change'); return true;
    }
    if (action.kind === 'key' && ['ArrowDown','ArrowUp'].includes(action.key) && after.popup.active && before.popup?.activeId !== after.popup.activeId) {
      const option = after.popup.active, position = `(${option.position} of ${option.setSize})`;
      this.announceText(`${option.name} text ${position}`, 'value-change');
      if (option.selected) this.announceText(`${option.name} selected ${position}`, 'value-change');
      return true;
    }
    if (action.kind === 'key' && ['Enter','Escape'].includes(action.key) && before.semantic.expanded && after.semantic.expanded === false) {
      this.announceText(`collapsed ${after.semantic.value ?? ''}`.trim(), 'value-change'); return true;
    }
    return false;
  }

  private editSpeech(action: BackendAction, before: EditState | undefined, beforeFocus: string | undefined, node: CursorNode): boolean {
    const after = this.focusedEdit;
    if (!after || node.identity !== this.focusedIdentity || node.semantic.protected) return false;
    const emit = (text: string) => { if (text) this.announceText(text, 'editing'); };
    if (action.kind === 'key' && (['Tab','Shift+Tab'].includes(action.key) || beforeFocus !== this.focusedIdentity) && after.value) {
      this.announce(node, 'No accessible content', true, false, true);
      return true;
    }
    if (!before || beforeFocus !== this.focusedIdentity) return false;
    if (action.kind === 'typeText' && action.text.length === 1) {
      if (before.end > before.start) emit(`selection replaced ${action.text}`);
      else { emit(action.text); emit(after.value.slice(0, after.start).split(/\s/).at(-1) ?? ''); }
      return true;
    }
    if (action.kind !== 'key') return false;
    const selected = after.value.slice(after.start, after.end);
    if (action.key === 'ControlOrMeta+A') { emit('Select All'); if (selected) emit(`${selected} selected`); return true; }
    if (action.key.startsWith('Shift+') && ['Shift+Home','Shift+End'].includes(action.key)) { if (selected) emit(`${selected} selected`); return true; }
    if (action.key === 'Home' || action.key === 'End') return true;
    if (action.key === 'ArrowLeft' || action.key === 'ArrowRight') {
      const index = before.end > before.start ? action.key === 'ArrowRight' ? before.end - 1 : before.start : action.key === 'ArrowLeft' ? before.start - 1 : before.start;
      emit(before.value[index] ?? ''); return true;
    }
    if (action.key === 'Backspace' || action.key === 'Delete') {
      const removed = before.end > before.start ? before.value.slice(before.start, before.end) : before.value[action.key === 'Backspace' ? before.start - 1 : before.start] ?? '';
      if (removed === '\n' && after.multiline) {
        const word = after.value.slice(0, after.start).split(/\s/).at(-1)! + after.value.slice(after.start).split(/\s/)[0];
        emit(`${node.semantic.name} text entry area ${after.value} Insertion on word: ${word} , between characters: ${after.value[after.start - 1] ?? ''} and ${after.value[after.start] ?? ''}`);
      } else emit(removed);
      return true;
    }
    if (action.key === 'Enter' && after.multiline) { emit('new line'); emit(before.value.slice(0, before.start).split('\n').at(-1) ?? ''); return true; }
    return false;
  }

  private async activate(signal?: AbortSignal): Promise<'dom-click-untrusted' | 'dom-focus'> {
    const node = this.current();
    if (!node || node.backendDOMNodeId === undefined) throw new Error('Current simulated cursor has no activatable DOM object.');
    if (node.semantic.disabled) throw new Error('Cannot activate a disabled accessible object.');
    const editable = editableRoles.has(node.semantic.role);
    const linkedHeading=node.semantic.role==='heading'&&node.semantic.headingLink;
    const disclosure=node.semantic.role==='DisclosureTriangle'&&node.semantic.tagName==='summary';
    if (!editable && !linkedHeading && !disclosure && !clickableRoles.has(node.semantic.role)) throw new Error(`Activation is unsupported for simulated role ${node.semantic.role}.`);
    const session = await this.cdp(signal);
    const { object } = await session.send('DOM.resolveNode', { backendNodeId: node.backendDOMNodeId });
    if (!object.objectId) throw new Error('Current simulated cursor is no longer attached to a DOM object.');
    try {
      signal?.throwIfAborted();
      const result = await session.send('Runtime.callFunctionOn', {
        objectId: object.objectId,
        functionDeclaration: `function(editable) {
          if (!(this instanceof HTMLElement) || !this.isConnected) throw new Error('Activation target is detached or unsupported.');
          if (this.matches(':disabled') || this.closest('[inert]') || this.closest('[aria-disabled="true"]')) throw new Error('Cannot activate a disabled accessible object.');
          if (editable) { this.focus(); return 'dom-focus'; }
          this.click(); return 'dom-click-untrusted';
        }`,
        arguments: [{ value: editable }], returnByValue: true,
      });
      signal?.throwIfAborted();
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'Mock activation failed.');
      return result.result.value as 'dom-click-untrusted' | 'dom-focus';
    } finally { await session.send('Runtime.releaseObject', { objectId: object.objectId }).catch(() => {}); }
  }

  private async enterText(action: Extract<BackendAction, { kind: 'typeText' | 'replaceText' }>, signal?: AbortSignal): Promise<void> {
    const page = this.getPage();
    signal?.throwIfAborted();
    const originalFocus = await page.evaluateHandle(() => {
      let active = document.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      return active;
    });
    const assertEditable = async () => {
      signal?.throwIfAborted();
      const editable = await originalFocus.evaluate(original => {
        if (!document.hasFocus()) return false;
        let active = document.activeElement;
        while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
        if (active !== original) return false;
        if (!(active instanceof HTMLElement) || active.closest('[inert], [aria-disabled="true"]')) return false;
        if (active instanceof HTMLTextAreaElement) return !active.disabled && !active.readOnly;
        if (active instanceof HTMLInputElement) return !active.disabled && !active.readOnly && ['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(active.type);
        return active.isContentEditable;
      });
      signal?.throwIfAborted();
      if (!editable) throw new Error('Text entry requires an actually focused editable field.');
    };
    try {
      await assertEditable();
      if (action.kind === 'replaceText') {
        await page.keyboard.press('ControlOrMeta+A');
        await assertEditable();
        await page.keyboard.press('Backspace');
      }
      for (const character of action.text) {
        await assertEditable();
        await page.keyboard.type(character);
      }
      signal?.throwIfAborted();
    } finally { await originalFocus.dispose().catch(() => {}); }
  }

  async observe({ signal }: BackendOperationOptions = {}): Promise<BackendSpeechObservation> {
    signal?.throwIfAborted();
    this.getPage();
    if (this.busy) throw new Error('Concurrent mock VoiceOver execution/observation is unsupported.');
    this.busy = true;
    const window = this.beginWindow();
    try {
      const deadline = this.actionEndedAt + this.observationMinWaitMs;
      do {
        await this.refresh(signal);
        signal?.throwIfAborted();
        if (this.lastCurrentFingerprint !== undefined && this.lastCurrentFingerprint !== this.currentFingerprint() && this.wording) this.sourceCommand = 'asynchronous_semantic_change';
        if (this.lastCurrentFingerprint !== this.currentFingerprint()) this.announce(this.current(), 'No accessible content', false);
        this.flushLive();
        this.lastCurrentFingerprint = this.currentFingerprint();
        if(this.pendingHint&&Date.now()>=this.pendingHint.dueAt){const hint=this.pendingHint;this.pendingHint=undefined;this.announceText(hint.text,'usage-hint');}
        if (Date.now() >= deadline) break;
        await wait(Math.min(100, deadline - Date.now()), undefined, { signal });
      } while (true);
      this.actionEndedAt = 0;
      signal?.throwIfAborted();
      const observation = {
        kind: 'screenreader' as const, evidenceProvenance: 'simulation' as const, profile: this.profile,
        windowId: window.id, startedAt: window.startedAt, endedAt: new Date().toISOString(), reason: 'simulation-snapshot',
        outputs: [...window.outputs], speech: window.outputs.map(output => output.text),
      };
      this.window = undefined;
      return observation;
    } finally { this.busy = false; }
  }

  async close(): Promise<void> {
    this.state = 'closed';
    const session = this.session;
    this.session = undefined;
    this.page = undefined;
    this.nodes = [];
    this.window = undefined;
    this.pendingHint=undefined;
    this.listeners.clear();
    if (session) await session.detach().catch(() => {});
  }
}

function stringValue(value?: AXValue): string { return typeof value?.value === 'string' ? value.value : ''; }
function property(node: AXNode, name: string): unknown { return node.properties?.find(value => value.name === name)?.value.value; }
function identity(node: AXNode): string { return node.backendDOMNodeId === undefined ? `ax:${node.nodeId}` : `dom:${node.backendDOMNodeId}`; }
function booleanOrMixed(value: unknown): boolean | 'mixed' | undefined {
  return value === 'mixed' ? 'mixed' : value === true || value === 'true' ? true : value === false || value === 'false' ? false : undefined;
}
function semanticNode(node: AXNode): SimulatedSemanticNode {
  const value = typeof node.value?.value === 'number' && Number.isFinite(node.value.value) ? String(node.value.value) : stringValue(node.value);
  const description = stringValue(node.description);
  const level = property(node, 'level');
  const protectedValue = property(node, 'protected') === true;
  return {
    role: stringValue(node.role), name: stringValue(node.name),
    ...(!protectedValue && value ? { value } : {}), ...(description ? { description } : {}),
    protected: protectedValue, disabled: property(node, 'disabled') === true, readonly: property(node, 'readonly') === true,
    required: property(node, 'required') === true, multiline: property(node, 'multiline') === true, modal: property(node, 'modal') === true,
    checked: booleanOrMixed(property(node, 'checked')), pressed: booleanOrMixed(property(node, 'pressed')),
    expanded: typeof property(node, 'expanded') === 'boolean' ? property(node, 'expanded') as boolean : undefined,
    selected: typeof property(node, 'selected') === 'boolean' ? property(node, 'selected') as boolean : undefined,
    ...(typeof level === 'number' ? { level } : {}),
  };
}

function hasUnmodeledContext(node: AXNode, byId: Map<string, AXNode>): boolean {
  for (const key of ['hasPopup','invalid','busy','roledescription','keyshortcuts','current','posinset','setsize','live']) { const value=property(node,key); if(value!==undefined&&value!==false&&value!=='false'&&value!==''&&value!=='off')return true; }
  const visited=new Set<string>();let parent=node.parentId ? byId.get(node.parentId) : undefined;
  while(parent&&!visited.has(parent.nodeId)){visited.add(parent.nodeId);if(['group','radiogroup','list','listitem','main','navigation','banner','contentinfo','complementary','form','dialog','alertdialog','table','grid'].includes(stringValue(parent.role)))return true;parent=parent.parentId?byId.get(parent.parentId):undefined;}
  return false;
}
/** The text inside a live region, as one utterance: its visible text nodes in order. */
function regionText(node: AXNode, byId: Map<string, AXNode>): string {
  const parts: string[] = [], seen = new Set<string>();
  const walk = (current: AXNode) => {
    if (seen.has(current.nodeId)) return;
    seen.add(current.nodeId);
    if (!current.ignored && stringValue(current.role) === 'StaticText') { const text = stringValue(current.name).trim(); if (text) parts.push(text); }
    for (const childId of current.childIds ?? []) { const child = byId.get(childId); if (child) walk(child); }
  };
  walk(node);
  return parts.join(' ');
}
/** The rotor's headings list as one announcement: each heading with its level, in page order. */
function headingsList(nodes: readonly CursorNode[]): string {
  const headings = nodes.filter(node => node.semantic.role === 'heading');
  if (!headings.length) return 'Headings, no items';
  return `Headings, ${headings.length} items: ` + headings.map(node => `${node.semantic.name}, level ${node.semantic.level ?? '?'}`).join('; ');
}
