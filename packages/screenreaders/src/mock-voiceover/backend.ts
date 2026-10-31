import type { CDPSession, Page } from '@rawstep/browser/types';
import type { Backend, BackendAction, BackendOperationOptions, BackendOutput, BackendSession, BackendSpeechObservation, CursorLocation } from '@rawstep/core/contracts';
import { formatSimulatedSpeech, type SimulatedSemanticNode } from './semantics.js';

export { formatSimulatedSpeech, type SimulatedSemanticNode } from './semantics.js';

export const MOCK_VOICEOVER_PROFILE = 'english-dom-navigation-evidence-v2' as const;
export const MOCK_VOICEOVER_LIMITATIONS = Object.freeze([
  'Simulation of an English DOM-navigation profile using Chromium accessibility semantics; not native VoiceOver speech or an accessibility conformance result.',
  'Selected navigation-wording rules are calibrated to versioned third-party VoiceOver observations; this is a composite profile, not any one macOS/Safari version. Other wording and state-change announcements remain heuristic.',
  'A flat accessibility cursor is independent of keyboard focus. Only actual focus changes move the cursor to a focused exposed object.',
  'Activation uses guarded DOM click or editable-field focus as an approximation of AXPress; DOM clicks are untrusted and no missing widget behavior is repaired.',
  'Quick navigation covers next/previous heading, form control and link; the rotor covers the headings, links and form controls lists only. No macOS/Safari AX fidelity, group interaction, Quick Nav settings, live-region announcement timing, speech queue, or cross-frame navigation simulation.',
  'Live regions (status, alert, log, aria-live polite/assertive): new text is spoken once after the speech of the action that caused it, without the role and without timing or interruption; an empty live region is not a cursor stop (documented VoiceOver/Safari support for role=status, a11ysupport.io 2020; the empty-region skip is inferred).',
  'List markers (bullets, "1.") are not cursor stops: VoiceOver reads a list item\'s content directly (inferred; markers are not separate accessibility objects in WebKit).',
  'Only the attached Chromium main document is traversed. Browser chrome and operating-system dialogs are outside the profile.',
  'A newly loaded document is announced by its title alone; native VoiceOver adds its own page-load wording.',
  'headings.list reads every heading with its level in one announcement, like opening the VoiceOver rotor on headings (VO+U) and listening through it; the cursor does not move.',
  'links.list reads every link name in one announcement, like the rotor\'s links list; the cursor does not move.',
  'formControls.rotor opens the rotor on its form controls list (VO+U, then to that list) at the first form control in page order, buttons included. While it is open, next and previous move one item through the list and speak it, activate moves the cursor to that item without pressing it (Return in the rotor), and Escape or any other action closes it. Typing to filter the list is not modelled, so finding an item can take more moves than in VoiceOver.',
  'Arrow, Home and End keys go to the page as keystrokes, as in VoiceOver with Quick Nav off: menus, tabs and radio groups that move focus with them are announced at the new focus.',
]);

const intents = Object.freeze(['next', 'previous', 'readCurrent', 'readFocused', 'activate', 'heading.next', 'heading.previous', 'form.next', 'form.previous', 'link.next', 'link.previous', 'headings.list', 'links.list', 'formControls.rotor']);
const formRoles = new Set(['button', 'checkbox', 'radio', 'switch', 'textbox', 'searchbox', 'combobox', 'spinbutton', 'slider', 'listbox']);
/** Cursor moves: one object, or (quick navigation, as VoiceOver's VO-Command-H / VO-Command-J) to the next object of a kind. */
const moves: Readonly<Record<string, { step: 1 | -1; match?: (role: string) => boolean; none: string }>> = Object.freeze({
  next: { step: 1, none: 'End of content' },
  previous: { step: -1, none: 'Start of content' },
  'heading.next': { step: 1, match: role => role === 'heading', none: 'No more headings' },
  'heading.previous': { step: -1, match: role => role === 'heading', none: 'No previous heading' },
  'form.next': { step: 1, match: role => formRoles.has(role), none: 'No more form controls' },
  'form.previous': { step: -1, match: role => formRoles.has(role), none: 'No previous form control' },
  'link.next': { step: 1, match: role => role === 'link', none: 'No more links' },
  'link.previous': { step: -1, match: role => role === 'link', none: 'No previous link' },
});
const keys = Object.freeze(['Tab', 'Shift+Tab', 'Enter', 'Space', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);
const textRoles = new Set(['StaticText', 'InlineTextBox']);
const namedLeafRoles = new Set(['button', 'link', 'checkbox', 'radio', 'switch', 'textbox', 'searchbox', 'combobox', 'spinbutton', 'slider', 'heading', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'option']);
// Separators are decorative here; VoiceOver's object navigation does not stop on a plain rule.
// List markers (bullets, "1.") are not stops either: VoiceOver reads a list item's content directly.
// strong and emphasis (<strong>, <em>) are styling: VoiceOver reads their text, never the role.
const skippedRoles = new Set(['RootWebArea', 'WebArea', 'none', 'presentation', 'generic', 'InlineTextBox', 'LineBreak', 'separator', 'ListMarker', 'strong', 'emphasis']);
/** Live regions: their new text is announced when it changes; with nothing in them they are not a stop. */
const liveRoles = new Set(['status', 'alert', 'log', 'marquee', 'timer']);
// LabelText is Chromium's role for <label>: its text is read from the StaticText inside, so an unnamed label adds nothing.
const unnamedContainerRoles = new Set(['paragraph', 'section', 'group', 'list', 'listitem', 'main', 'navigation', 'banner', 'contentinfo', 'complementary', 'form', 'LabelText', ...liveRoles])
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
  /** The rotor's form controls list while it is open: the items and the one it is on. */
  private rotor?: { items: CursorNode[]; index: number };
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
      backend: 'mock-voiceover', evidenceProvenance: this.evidenceProvenance,
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

  /** Speech that belongs to no cursor stop, such as the title of a page that just loaded. */
  private announceText(text: string, kind: 'page-title' | 'headings-list' | 'links-list' | 'rotor' | 'live-region'): void {
    const output: BackendOutput = {
      sequence: ++this.sequence, receivedAt: new Date().toISOString(), text,
      raw: { evidenceProvenance: 'simulation', profile: this.wording?.profile ?? MOCK_VOICEOVER_PROFILE, semanticSource: 'chromium-accessibility-tree', announcement: kind },
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
    // Text that only repeats what was just said — a group's legend after "Categories, group", a checkbox label after the checkbox —
    // is one utterance, not two. Objects with nothing to say are not stops.
    let lastSaid = '';
    const visit = (node: AXNode, suppressText: boolean, groupNames: readonly string[]) => {
      if (visited.has(node.nodeId)) return;
      visited.add(node.nodeId);
      const role = stringValue(node.role);
      const name = stringValue(node.name), said = name.trim();
      const repeated = textRoles.has(role) && (said === lastSaid || groupNames.includes(said));
      if (!node.ignored && !skippedRoles.has(role) && !(suppressText && textRoles.has(role)) && !(unnamedContainerRoles.has(role) && !name) && (name || !textRoles.has(role)) && !repeated) {
        const semantic = semanticNode(node);
        if (formatSimulatedSpeech(semantic).trim()) {
          next.push({ identity: identity(node), backendDOMNodeId: node.backendDOMNodeId, axId: node.nodeId, semantic, unmodeledContext: hasUnmodeledContext(node, byId) });
          if (said) lastSaid = said;
        }
      }
      const suppressDescendantText = suppressText || (!node.ignored && !!name && namedLeafRoles.has(role));
      const inner = !node.ignored && said && !textRoles.has(role) ? [...groupNames, said] : groupNames;
      for (const childId of node.childIds ?? []) {
        const child = byId.get(childId);
        if (child) visit(child, suppressDescendantText, inner);
      }
    };
    for (const node of axNodes) if (!node.parentId || !byId.has(node.parentId)) visit(node, false, []);
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
    this.sourceCommand = action.kind === 'intent' ? ({next:'next_item',previous:'previous_item',readCurrent:'read_current',readFocused:'read_focused',activate:'activate_button','heading.next':'next_heading','heading.previous':'previous_heading','form.next':'next_form_control','form.previous':'previous_form_control','link.next':'next_link','link.previous':'previous_link','headings.list':'rotor_headings','links.list':'rotor_links','formControls.rotor':'rotor_form_controls'}[action.intent] ?? action.intent) : action.kind === 'key' ? ({Tab:'next_focusable_item','Shift+Tab':'previous_focusable_item',Space:'activate_form_control',Enter:'enter',Escape:'escape'}[action.key] ?? action.key) : 'enter_text';
    this.beginWindow();
    try {
      await this.refresh(signal);
      signal?.throwIfAborted();
      const receipt: ActionReceipt = { backend: 'mock-voiceover', evidenceProvenance: 'simulation', acknowledged: true };
      const move = action.kind === 'intent' ? moves[action.intent] : undefined;
      const rotor = this.rotor;
      // Any action but moving through the list or picking from it closes the rotor; Escape only closes it.
      if (!(action.kind === 'intent' && ['next', 'previous', 'activate'].includes(action.intent))) this.rotor = undefined;
      if (rotor && action.kind === 'key' && action.key === 'Escape') this.announce(this.current(), undefined, true);
      else if (rotor && action.kind === 'intent' && (action.intent === 'next' || action.intent === 'previous')) {
        rotor.index = Math.min(rotor.items.length - 1, Math.max(0, rotor.index + (action.intent === 'next' ? 1 : -1)));
        this.announceText(formatSimulatedSpeech(rotor.items[rotor.index]!.semantic), 'rotor');
      } else if (rotor && action.kind === 'intent' && action.intent === 'activate') {
        this.rotor = undefined;
        const item = rotor.items[rotor.index]!;
        this.cursor = this.nodes.some(node => node.identity === item.identity) ? item.identity : this.cursor;
        this.announce(this.current(), undefined, true);
      } else if (action.kind === 'intent' && action.intent === 'formControls.rotor') {
        const items = this.nodes.filter(node => formRoles.has(node.semantic.role));
        if (!items.length) this.announceText('Form controls, no items', 'rotor');
        else {
          this.rotor = { items, index: 0 };
          // The list's name, then its first item, as two utterances: the item is what the cursor is on in the list.
          this.announceText(`Form controls, ${items.length} items`, 'rotor');
          this.announceText(formatSimulatedSpeech(items[0]!.semantic), 'rotor');
        }
      } else if (move) {
        const currentIndex = this.nodes.findIndex(node => node.identity === this.cursor);
        let index = currentIndex + move.step;
        while (move.match && index >= 0 && index < this.nodes.length && !move.match(this.nodes[index]!.semantic.role)) index += move.step;
        if (index >= 0 && index < this.nodes.length) {
          this.cursor = this.nodes[index]!.identity;
          this.announce(this.current());
        } else this.announce(undefined, move.none);
      } else if (action.kind === 'intent' && action.intent === 'headings.list') this.announceText(headingsList(this.nodes), 'headings-list');
      else if (action.kind === 'intent' && action.intent === 'links.list') this.announceText(linksList(this.nodes), 'links-list');
      else if (action.kind === 'intent' && action.intent === 'readCurrent') this.announce(this.current());
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
        // A document still loading has no objects yet: say nothing until its first one appears (the next look speaks it).
        if (this.nodes.length) this.announce(this.current());
      }
      this.flushLive();
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

  /**
   * Scrolls the cursor's object into view, as VoiceOver keeps its cursor on screen, and says where it is. For people reading
   * the run (screenshots, the start page); nothing here reaches a policy. Undefined when the object has no box.
   */
  private async locate(signal?: AbortSignal): Promise<CursorLocation | undefined> {
    const node = this.current();
    if (node?.backendDOMNodeId === undefined) return undefined;
    const session = await this.cdp(signal);
    const { object } = await session.send('DOM.resolveNode', { backendNodeId: node.backendDOMNodeId }).catch(() => ({ object: { objectId: undefined } }));
    if (!object.objectId) return undefined;
    try {
      const result = await session.send('Runtime.callFunctionOn', {
        objectId: object.objectId,
        functionDeclaration: `function() {
          const element = this.nodeType === Node.TEXT_NODE ? this.parentElement : this;
          if (!(element instanceof Element) || !element.isConnected) return null;
          const box = () => { if (this.nodeType !== Node.TEXT_NODE) return element.getBoundingClientRect(); const range = document.createRange(); range.selectNodeContents(this); return range.getBoundingClientRect(); };
          let r = box();
          if (r.width === 0 && r.height === 0) return null;
          if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) { element.scrollIntoView({ block: 'center', inline: 'nearest' }); r = box(); }
          return { rect: { x: r.x, y: r.y, width: r.width, height: r.height }, scroll: { x: scrollX, y: scrollY }, viewport: { width: innerWidth, height: innerHeight }, url: location.href };
        }`,
        returnByValue: true,
      });
      signal?.throwIfAborted();
      return result.exceptionDetails ? undefined : (result.result.value as CursorLocation | null) ?? undefined;
    } catch { signal?.throwIfAborted(); return undefined; }
    finally { await session.send('Runtime.releaseObject', { objectId: object.objectId }).catch(() => {}); }
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
      if (this.lastCurrentFingerprint !== this.currentFingerprint() && this.nodes.length) this.announce(this.current(), 'No accessible content', false);
      this.flushLive();
      this.lastCurrentFingerprint = this.currentFingerprint();
      signal?.throwIfAborted();
      const cursor = await this.locate(signal);
      const observation = {
        kind: 'screenreader' as const, evidenceProvenance: 'simulation' as const, profile: this.wording?.profile ?? MOCK_VOICEOVER_PROFILE,
        windowId: window.id, startedAt: window.startedAt, endedAt: new Date().toISOString(), reason: 'simulation-snapshot',
        outputs: [...window.outputs], speech: window.outputs.map(output => output.text), ...(cursor ? { cursor } : {}),
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
/** The rotor's links list as one announcement: each link's name, in page order. */
function linksList(nodes: readonly CursorNode[]): string {
  const links = nodes.filter(node => node.semantic.role === 'link');
  if (!links.length) return 'Links, no items';
  return `Links, ${links.length} items: ` + links.map(node => node.semantic.name || 'unnamed link').join('; ');
}
