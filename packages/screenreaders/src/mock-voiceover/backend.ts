import type { CDPSession, Page } from '@rawstep/browser/types';
import type { Backend, BackendAction, BackendOperationOptions, BackendOutput, BackendSession, BackendSpeechObservation } from '@rawstep/core/contracts';
import { formatSimulatedSpeech, type SimulatedSemanticNode } from './semantics.js';

export { formatSimulatedSpeech, type SimulatedSemanticNode } from './semantics.js';

export const MOCK_VOICEOVER_PROFILE = 'english-dom-navigation-evidence-v2' as const;
export const MOCK_VOICEOVER_LIMITATIONS = Object.freeze([
  'Simulation of an English DOM-navigation profile using Chromium accessibility semantics; not native VoiceOver speech or an accessibility conformance result.',
  'Selected navigation-wording rules are calibrated to versioned third-party VoiceOver observations; this is a composite profile, not any one macOS/Safari version. Other wording and state-change announcements remain heuristic.',
  'A flat accessibility cursor is independent of keyboard focus. Only actual focus changes move the cursor to a focused exposed object.',
  'Activation uses guarded DOM click or editable-field focus as an approximation of AXPress; DOM clicks are untrusted and no missing widget behavior is repaired.',
  'No macOS/Safari AX fidelity, group interaction, rotor, quick navigation, live-region announcement timing, speech queue, or cross-frame navigation simulation.',
  'Only the attached Chromium main document is traversed. Browser chrome and operating-system dialogs are outside the profile.',
]);

const intents = Object.freeze(['next', 'previous', 'readCurrent', 'readFocused', 'activate']);
const keys = Object.freeze(['Tab', 'Shift+Tab', 'Enter', 'Space', 'Escape']);
const textRoles = new Set(['StaticText', 'InlineTextBox']);
const namedLeafRoles = new Set(['button', 'link', 'checkbox', 'radio', 'switch', 'textbox', 'searchbox', 'combobox', 'spinbutton', 'slider', 'heading', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'option']);
const skippedRoles = new Set(['RootWebArea', 'WebArea', 'none', 'presentation', 'generic', 'InlineTextBox', 'LineBreak']);
const unnamedContainerRoles = new Set(['paragraph', 'section', 'group', 'list', 'listitem', 'main', 'navigation', 'banner', 'contentinfo', 'complementary', 'form']);
const clickableRoles = new Set(['button', 'link', 'checkbox', 'radio', 'switch', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab']);
const editableRoles = new Set(['textbox', 'searchbox', 'spinbutton', 'combobox']);

type AXValue = { value?: unknown };
type AXNode = {
  nodeId: string; backendDOMNodeId?: number; parentId?: string; childIds?: string[];
  ignored: boolean; role?: AXValue; name?: AXValue; value?: AXValue; description?: AXValue;
  properties?: { name: string; value: AXValue }[];
};
type CursorNode = { identity: string; backendDOMNodeId?: number; axId: string; semantic: SimulatedSemanticNode; unmodeledContext?: boolean };
export type MockWordingOptions = { profile: string; metadata?: unknown; capabilities?: Backend['capabilities']; format: (node: SimulatedSemanticNode | undefined, context: { sourceCommand: string; unmodeledContext: boolean }) => { speech: string; evidence: unknown } };
type Window = { id: string; startedAt: string; outputs: BackendOutput[] };
type ActionReceipt = { backend: 'mock-voiceover'; evidenceProvenance: 'simulation'; acknowledged: true; activation?: 'dom-click-untrusted' | 'dom-focus'; };

/** Browser-backed testing adapter. It never connects to or claims to measure native VoiceOver. */
export class MockVoiceOverBackend implements Backend {
  readonly observationKind = 'screenreader' as const;
  readonly evidenceProvenance = 'simulation' as const;
  readonly capabilities: Backend['capabilities'];
  private sourceCommand = 'next_item';
  constructor(private readonly wording?: MockWordingOptions) { this.capabilities=Object.freeze(wording?.capabilities ?? {intents,keys,textEntry:true,replaceText:true}); }
  private page?: Page;
  private session?: CDPSession;
  private state: 'new' | 'ready' | 'closed' = 'new';
  private busy = false;
  private nodes: CursorNode[] = [];
  private cursor?: string;
  private focusedIdentity?: string;
  private focusInitialized = false;
  private window?: Window;
  private nextWindow = 1;
  private sequence = 0;
  private lastAnnouncement?: string;
  private lastCurrentFingerprint?: string;
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
      profile: this.wording?.profile ?? MOCK_VOICEOVER_PROFILE, capabilities: this.capabilities, limitations: MOCK_VOICEOVER_LIMITATIONS, ...(this.wording ? {wordingEvidenceProfile: structuredClone(this.wording.metadata)} : {}),
      environment: { atName: this.wording ? 'Corpus word-pattern mock (simulation)' : 'Mock VoiceOver (simulation)', atVersion: '2', platformName: 'chromium', locale: 'en', nativeScreenReader: false },
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

  private announce(node: CursorNode | undefined, fallback = 'No accessible content', force = true): void {
    const rendered = this.wording?.format(node?.semantic, { sourceCommand: this.sourceCommand, unmodeledContext: node?.unmodeledContext ?? true });
    const text = rendered?.speech ?? (node ? formatSimulatedSpeech(node.semantic) : fallback);
    const fingerprint = JSON.stringify([node?.identity, text]);
    if (!force && this.lastAnnouncement === fingerprint) return;
    this.lastAnnouncement = fingerprint;
    const output: BackendOutput = {
      sequence: ++this.sequence, receivedAt: new Date().toISOString(), text,
      raw: { evidenceProvenance: 'simulation', profile: this.wording?.profile ?? MOCK_VOICEOVER_PROFILE, ...(rendered ? { wordingEvidence: rendered.evidence } : {}), semanticSource: 'chromium-accessibility-tree', ...(node ? { semantic: { ...node.semantic } } : {}) },
    };
    this.beginWindow().outputs.push(output);
    this.emit({ type: 'output', timestamp: Date.parse(output.receivedAt), evidenceProvenance: 'simulation', windowId: this.window!.id, output });
  }

  private current(): CursorNode | undefined { return this.nodes.find(node => node.identity === this.cursor); }

  private currentFingerprint(): string { return JSON.stringify([this.cursor, this.current()?.semantic]); }

  private async readFocusedIdentity(session: CDPSession, signal?: AbortSignal): Promise<string | undefined> {
    const { result } = await session.send('Runtime.evaluate', {
      expression: `(() => { if (!document.hasFocus()) return null; let element = document.activeElement; while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement; return element; })()`,
      returnByValue: false,
    });
    signal?.throwIfAborted();
    if (!result.objectId) return undefined;
    try {
      const { node } = await session.send('DOM.describeNode', { objectId: result.objectId });
      signal?.throwIfAborted();
      return `dom:${node.backendNodeId}`;
    } finally { await session.send('Runtime.releaseObject', { objectId: result.objectId }).catch(() => {}); }
  }

  private async refresh(signal?: AbortSignal): Promise<void> {
    const session = await this.cdp(signal);
    const result = await session.send('Accessibility.getFullAXTree');
    signal?.throwIfAborted();
    const axNodes = result.nodes as AXNode[];
    const byId = new Map(axNodes.map(node => [node.nodeId, node]));
    const next: CursorNode[] = [];
    const visited = new Set<string>();
    const visit = (node: AXNode, suppressText: boolean) => {
      if (visited.has(node.nodeId)) return;
      visited.add(node.nodeId);
      const role = stringValue(node.role);
      const name = stringValue(node.name);
      if (!node.ignored && !skippedRoles.has(role) && !(suppressText && textRoles.has(role)) && !(unnamedContainerRoles.has(role) && !name) && (name || !textRoles.has(role))) {
        next.push({ identity: identity(node), backendDOMNodeId: node.backendDOMNodeId, axId: node.nodeId, semantic: semanticNode(node), unmodeledContext: hasUnmodeledContext(node, byId) });
      }
      const suppressDescendantText = suppressText || (!node.ignored && !!name && namedLeafRoles.has(role));
      for (const childId of node.childIds ?? []) {
        const child = byId.get(childId);
        if (child) visit(child, suppressDescendantText);
      }
    };
    for (const node of axNodes) if (!node.parentId || !byId.has(node.parentId)) visit(node, false);
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
    this.sourceCommand = action.kind === 'intent' ? ({next:'next_item',previous:'previous_item',readCurrent:'read_current',readFocused:'read_focused',activate:'activate_button'}[action.intent] ?? action.intent) : action.kind === 'key' ? ({Tab:'next_focusable_item','Shift+Tab':'previous_focusable_item',Space:'activate_form_control',Enter:'enter',Escape:'escape'}[action.key] ?? action.key) : 'enter_text';
    this.beginWindow();
    try {
      await this.refresh(signal);
      signal?.throwIfAborted();
      const receipt: ActionReceipt = { backend: 'mock-voiceover', evidenceProvenance: 'simulation', acknowledged: true };
      if (action.kind === 'intent' && ['next', 'previous'].includes(action.intent)) {
        const currentIndex = this.nodes.findIndex(node => node.identity === this.cursor);
        const index = currentIndex + (action.intent === 'next' ? 1 : -1);
        if (index >= 0 && index < this.nodes.length) {
          this.cursor = this.nodes[index]!.identity;
          this.announce(this.current());
        } else this.announce(undefined, action.intent === 'next' ? 'End of content' : 'Start of content');
      } else if (action.kind === 'intent' && action.intent === 'readCurrent') this.announce(this.current());
      else if (action.kind === 'intent' && action.intent === 'readFocused') {
        this.announce(this.nodes.find(node => node.identity === this.focusedIdentity), 'No focused accessible object');
      } else {
        if (action.kind === 'intent') receipt.activation = await this.activate(signal);
        else if (action.kind === 'key') {
          if (['Enter', 'Space'].includes(action.key) && this.nodes.find(node => node.identity === this.focusedIdentity)?.semantic.disabled) {
            throw new Error('Cannot activate a disabled focused accessible object.');
          }
          await this.getPage().keyboard.press(action.key);
        }
        else await this.enterText(action, signal);
        signal?.throwIfAborted();
        await this.refresh(signal);
        this.announce(this.current());
      }
      this.lastCurrentFingerprint = this.currentFingerprint();
      signal?.throwIfAborted();
      return receipt;
    } finally { this.busy = false; }
  }

  private async activate(signal?: AbortSignal): Promise<'dom-click-untrusted' | 'dom-focus'> {
    const node = this.current();
    if (!node || node.backendDOMNodeId === undefined) throw new Error('Current simulated cursor has no activatable DOM object.');
    if (node.semantic.disabled) throw new Error('Cannot activate a disabled accessible object.');
    const editable = editableRoles.has(node.semantic.role);
    if (!editable && !clickableRoles.has(node.semantic.role)) throw new Error(`Activation is unsupported for simulated role ${node.semantic.role}.`);
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
      await this.refresh(signal);
      signal?.throwIfAborted();
      if (this.lastCurrentFingerprint !== undefined && this.lastCurrentFingerprint !== this.currentFingerprint() && this.wording) this.sourceCommand = 'asynchronous_semantic_change';
      if (this.lastCurrentFingerprint !== this.currentFingerprint()) this.announce(this.current(), 'No accessible content', false);
      this.lastCurrentFingerprint = this.currentFingerprint();
      signal?.throwIfAborted();
      const observation = {
        kind: 'screenreader' as const, evidenceProvenance: 'simulation' as const, profile: this.wording?.profile ?? MOCK_VOICEOVER_PROFILE,
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
  const value = stringValue(node.value);
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
