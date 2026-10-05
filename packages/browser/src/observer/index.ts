import type { CDPSession, Page } from 'playwright';

/**
 * Page observer: records focus, ARIA state, live-region, dialog and SPA navigation changes as they happen,
 * so friction hints and goal signals can be derived after the run. It runs in an isolated JS world:
 * page scripts cannot see or patch it, and nothing it records is ever shown to the decision policy.
 */
export type ObserverEventKind = 'focus' | 'focus-lost' | 'appeared' | 'disappeared' | 'live-region' | 'state' | 'submit' | 'navigation';
export type ObserverEvent = {
  kind: ObserverEventKind;
  /** Runner step whose action preceded the change; 0 is the initial page load. */
  step: number;
  at: string;
  frame: 'main' | 'child';
  role?: string | null;
  /** Approximate accessible name or visible text, truncated. Input values are never read. */
  name?: string;
  tag?: string;
  text?: string;
  attr?: string;
  value?: string | null;
  politeness?: 'polite' | 'assertive';
  inViewport?: boolean;
  visible?: boolean;
  reason?: 'blur' | 'removed';
  /** Focus events: whether a modal dialog was open, and whether focus landed inside a dialog. */
  modalOpen?: boolean;
  inDialog?: boolean;
  url?: string;
  sameDocument?: boolean;
};
export type ObserverOptions = { maxEventsPerStep?: number };
export type PageObserver = {
  readonly available: boolean;
  /** Why the observer could not be installed; the run continues without it. */
  readonly unavailableReason?: string;
  setStep(step: number): void;
  /** Drains recorded events in arrival order. */
  take(): ObserverEvent[];
  /** Events dropped by the per-step cap, by step. */
  dropped(): Record<number, number>;
  close(): Promise<void>;
};

export const OBSERVER_WORLD = 'rawstep-observer';
const BINDING = '__rawstepObserve';
const KINDS: readonly string[] = ['focus', 'focus-lost', 'appeared', 'disappeared', 'live-region', 'state', 'submit', 'navigation'];

/** Install before the first navigation so the observer sees the initial document. */
export async function installPageObserver(page: Page, options: ObserverOptions = {}): Promise<PageObserver> {
  const maxEventsPerStep = options.maxEventsPerStep ?? 200;
  let step = 0, cdp: CDPSession | undefined, mainFrameId: string | undefined;
  const events: ObserverEvent[] = [], counts = new Map<number, number>(), drops = new Map<number, number>();
  const record = (event: Omit<ObserverEvent, 'step' | 'at'>) => {
    const count = counts.get(step) ?? 0;
    if (count >= maxEventsPerStep) { drops.set(step, (drops.get(step) ?? 0) + 1); return; }
    counts.set(step, count + 1);
    events.push({ ...event, step, at: new Date().toISOString() });
  };
  try {
    cdp = await page.context().newCDPSession(page);
    cdp.on('Runtime.bindingCalled', ({ name, payload }: { name: string; payload: string }) => {
      if (name !== BINDING) return;
      try { const event = sanitize(JSON.parse(payload)); if (event) record(event); } catch { /* Malformed payloads are ignored, never trusted. */ }
    });
    cdp.on('Page.navigatedWithinDocument', ({ frameId, url }: { frameId: string; url: string }) => record({ kind: 'navigation', frame: frameId === mainFrameId ? 'main' : 'child', url, sameDocument: true }));
    cdp.on('Page.frameNavigated', ({ frame }: { frame: { id: string; parentId?: string; url: string } }) => {
      if (frame.parentId) return;
      mainFrameId = frame.id;
      record({ kind: 'navigation', frame: 'main', url: frame.url, sameDocument: false });
    });
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    mainFrameId = (await cdp.send('Page.getFrameTree')).frameTree.frame.id;
    await cdp.send('Runtime.addBinding', { name: BINDING, executionContextName: OBSERVER_WORLD });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${OBSERVER_SOURCE})(${JSON.stringify(BINDING)})`, worldName: OBSERVER_WORLD });
  } catch (error) {
    await cdp?.detach().catch(() => undefined);
    const reason = `Page observer unavailable: ${error instanceof Error ? error.message : String(error)}`;
    return { available: false, unavailableReason: reason, setStep() {}, take: () => [], dropped: () => ({}), close: async () => {} };
  }
  return {
    available: true,
    setStep(next) { step = next; },
    take: () => events.splice(0),
    dropped: () => Object.fromEntries(drops),
    close: async () => { await cdp?.detach().catch(() => undefined); },
  };
}

const text = (value: unknown, max = 160) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : undefined;
/** The binding is reachable from any frame in the observer world; accept only the known shape. */
function sanitize(value: unknown): Omit<ObserverEvent, 'step' | 'at'> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.kind !== 'string' || !KINDS.includes(raw.kind) || raw.kind === 'navigation') return undefined;
  const event: Omit<ObserverEvent, 'step' | 'at'> = { kind: raw.kind as ObserverEventKind, frame: raw.frame === 'child' ? 'child' : 'main' };
  if (raw.role === null || typeof raw.role === 'string') event.role = raw.role === null ? null : text(raw.role, 40);
  for (const key of ['name', 'text'] as const) { const v = text(raw[key]); if (v !== undefined) event[key] = v; }
  for (const key of ['tag', 'attr'] as const) { const v = text(raw[key], 40); if (v !== undefined) event[key] = v; }
  if (raw.value === null || typeof raw.value === 'string') event.value = raw.value === null ? null : text(raw.value, 40);
  if (raw.politeness === 'polite' || raw.politeness === 'assertive') event.politeness = raw.politeness;
  if (raw.reason === 'blur' || raw.reason === 'removed') event.reason = raw.reason;
  for (const key of ['inViewport', 'visible', 'modalOpen', 'inDialog'] as const) if (typeof raw[key] === 'boolean') event[key] = raw[key];
  return event;
}

/** Runs inside the page's isolated world. Plain ES2020; no closures over Node values. */
const OBSERVER_SOURCE = String.raw`function(bindingName) {
  if (window.__rawstepObserverInstalled) return;
  window.__rawstepObserverInstalled = true;
  const send = window[bindingName];
  if (typeof send !== 'function') return;
  const frame = window.top === window ? 'main' : 'child';
  const emit = (event) => { try { send(JSON.stringify(Object.assign({ frame }, event))); } catch (e) {} };
  const IMPLICIT = { A: 'link', BUTTON: 'button', SELECT: 'combobox', TEXTAREA: 'textbox', DIALOG: 'dialog', H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading', H5: 'heading', H6: 'heading', NAV: 'navigation', MAIN: 'main', FORM: 'form', UL: 'list', OL: 'list', LI: 'listitem', IMG: 'img', SUMMARY: 'button' };
  const INPUT_ROLES = { checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', reset: 'button', range: 'slider', search: 'searchbox' };
  const roleOf = (el) => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit.split(/\s+/)[0];
    if (el.tagName === 'INPUT') return INPUT_ROLES[el.type] || 'textbox';
    if (el.tagName === 'A' && !el.hasAttribute('href')) return null;
    return IMPLICIT[el.tagName] || null;
  };
  // Approximate accessible name. Never reads form values; skips text of editable content.
  const nameOf = (el) => {
    const label = el.getAttribute('aria-label');
    if (label) return label;
    const ids = el.getAttribute('aria-labelledby');
    if (ids) return ids.split(/\s+/).map((id) => (document.getElementById(id) || {}).textContent || '').join(' ');
    if (el.labels && el.labels.length) return el.labels[0].textContent || '';
    const alt = el.getAttribute('alt') || el.getAttribute('title');
    if (alt) return alt;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable) return el.getAttribute('placeholder') || '';
    return el.textContent || '';
  };
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0; };
  const inViewport = (el) => { const r = el.getBoundingClientRect(); return r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight; };
  const describe = (el) => ({ role: roleOf(el), name: nameOf(el), tag: el.tagName.toLowerCase() });
  const deepActive = () => { let a = document.activeElement; while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement; return a; };
  const isBodyFocus = (a) => !a || a === document.body || a === document.documentElement;

  const MODALS = 'dialog:modal,[role="dialog"][aria-modal="true"],[role="alertdialog"][aria-modal="true"]';
  const DIALOGS = 'dialog,[role="dialog"],[role="alertdialog"]';
  let lastFocused = null;
  const focusLost = (reason) => {
    if (!lastFocused || !document.hasFocus() || !isBodyFocus(deepActive())) return;
    emit(Object.assign({ kind: 'focus-lost', reason }, describe(lastFocused)));
    lastFocused = null;
  };
  document.addEventListener('focusin', () => {
    const el = deepActive();
    if (isBodyFocus(el) || el === lastFocused) return;
    lastFocused = el;
    const modalOpen = Array.from(document.querySelectorAll(MODALS)).some(visible);
    emit(Object.assign({ kind: 'focus', inViewport: inViewport(el), visible: visible(el), modalOpen, inDialog: !!el.closest(DIALOGS) }, describe(el)));
  }, true);
  // Native checked state is a property, not an attribute; report it on change. Text values are never read.
  document.addEventListener('change', (event) => {
    const el = event.target;
    if (el && el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) emit(Object.assign({ kind: 'state', attr: 'checked', value: String(el.checked) }, describe(el)));
  }, true);
  document.addEventListener('focusout', (event) => { if (!event.relatedTarget) setTimeout(() => focusLost('blur'), 0); }, true);
  document.addEventListener('submit', (event) => { const form = event.target; if (form && form.getAttribute) emit(Object.assign({ kind: 'submit' }, describe(form))); }, true);

  const SURFACES = '[role="alert"],[role="alertdialog"],[role="dialog"],[role="status"],[role="log"],dialog[open]';
  const LIVE = '[aria-live]:not([aria-live="off"]),[role="alert"],[role="status"],[role="log"]';
  const STATES = ['aria-expanded', 'aria-checked', 'aria-selected', 'aria-pressed', 'aria-invalid', 'aria-current', 'disabled', 'open'];
  const surfaceEvent = (kind, el) => Object.assign({ kind, visible: kind === 'appeared' ? visible(el) : undefined, text: el.textContent || '' }, describe(el));
  const surfaces = (node) => node.nodeType !== 1 ? [] : (node.matches(SURFACES) ? [node] : []).concat(Array.from(node.querySelectorAll(SURFACES)).slice(0, 20));
  const lastLive = new WeakMap();
  const politenessOf = (region) => { const p = region.getAttribute('aria-live'); return p === 'assertive' || region.getAttribute('role') === 'alert' ? 'assertive' : 'polite'; };
  const liveChanged = (target) => {
    const start = target.nodeType === 1 ? target : target.parentElement;
    const region = start && start.closest(LIVE);
    if (!region) return;
    const content = (region.textContent || '').replace(/\s+/g, ' ').trim();
    if (!content || lastLive.get(region) === content) return;
    lastLive.set(region, content);
    emit({ kind: 'live-region', role: roleOf(region), politeness: politenessOf(region), text: content, tag: region.tagName.toLowerCase() });
  };
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes') {
        const el = m.target;
        if (el.tagName === 'DIALOG' && m.attributeName === 'open') { emit(surfaceEvent(el.hasAttribute('open') ? 'appeared' : 'disappeared', el)); continue; }
        const value = el.getAttribute(m.attributeName);
        if (value !== m.oldValue) emit(Object.assign({ kind: 'state', attr: m.attributeName, value }, describe(el)));
        continue;
      }
      for (const node of m.addedNodes) for (const el of surfaces(node)) emit(surfaceEvent('appeared', el));
      for (const node of m.removedNodes) for (const el of surfaces(node)) emit(surfaceEvent('disappeared', el));
      liveChanged(m.target);
    }
    if (lastFocused && !lastFocused.isConnected) focusLost('removed');
  });
  const start = () => observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true, attributeFilter: STATES });
  // Parser insertions are the baseline, not changes: start once the initial document is built.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
}`;
