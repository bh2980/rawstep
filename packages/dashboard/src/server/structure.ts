import { resolveTask } from '@rawstep/core/contracts';
import { closeBrowserSession, createBrowserSession, type BrowserSession } from '@rawstep/browser/browser';
import type { MachineSettings } from '@rawstep/project/config';
import type { PageElement } from '../shared/api.js';

type StructureMachine = Pick<MachineSettings, 'headless' | 'browserExecutablePath'>;

/** What a start page looks like to a person using the keyboard or a screen reader. All text comes from the website and is untrusted. */
export type PageStructure = {
  title: string;
  url: string;
  accessibilityTree: string;
  liveRegions: { role: string | null; live: string | null; text: string }[];
  dialogs: { name: string; open: boolean }[];
  forms: { action: string | null; method: string; fields: string[] }[];
  /** Notable elements as {role, name}, for picking one when writing a completion check. */
  elements: PageElement[];
};

const MAX_ELEMENTS = 200;
const MAX_NAME = 80;
/** Roles worth offering in a picker: things a person operates, announcements and the landmarks they navigate by. */
const NOTABLE_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'switch', 'combobox', 'listbox', 'slider', 'spinbutton', 'tab', 'menuitem',
  'dialog', 'alertdialog', 'alert', 'status', 'log', 'heading', 'navigation', 'main', 'banner', 'contentinfo', 'complementary', 'search', 'form', 'region',
]);
/** Roles that are useful even when they have no name. */
const NAMELESS_OK = new Set(['dialog', 'alertdialog', 'alert', 'status', 'log', 'navigation', 'main', 'banner', 'contentinfo', 'complementary', 'search']);

/** Reads `- role "name"` lines of an ARIA snapshot (the YAML Playwright prints) into notable elements, without duplicates. */
export function elementsFromAriaSnapshot(snapshot: string): PageElement[] {
  const found = new Map<string, PageElement>();
  for (const line of snapshot.split('\n')) {
    const match = /^\s*- ([a-z]+)(?: "((?:[^"\\]|\\.)*)")?/.exec(line);
    if (!match) continue;
    const role = match[1]!, name = (match[2] ?? '').replace(/\\(.)/g, '$1').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);
    if (!NOTABLE_ROLES.has(role) || (!name && !NAMELESS_OK.has(role))) continue;
    found.set(role + '\n' + name, { role, ...(name ? { name } : {}) });
  }
  return [...found.values()];
}

/** Opens the start page of a task in a headless browser, resolving project-relative HTML paths the way a task does. */
export async function openStartPage(options: { url: string; projectDir: string; machine: StructureMachine }): Promise<BrowserSession> {
  const startUrl = resolveTask({ url: options.url, goal: 'read page', verify: { all: [{ titleIncludes: '-' }] } }, options.projectDir).url;
  return createBrowserSession(startUrl, { headless: true, executablePath: options.machine.browserExecutablePath || undefined });
}

/** Reads the page of an open session: title, accessibility tree, live regions, dialogs, forms and notable elements. */
export async function readPageStructure(session: BrowserSession): Promise<PageStructure> {
  const page = session.page;
  await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);
  const title = await page.title(), url = page.url();
  const accessibilityTree = await page.locator('body').ariaSnapshot({ timeout: 10_000 }).catch(() => '');
  const extras = await page.evaluate(() => {
    const label = (el: Element) => (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    return {
      liveRegions: Array.from(document.querySelectorAll('[aria-live], [role=status], [role=alert], [role=log], output')).slice(0, 20).map(el => ({ role: el.getAttribute('role'), live: el.getAttribute('aria-live'), text: label(el) })),
      dialogs: Array.from(document.querySelectorAll('dialog, [role=dialog], [role=alertdialog]')).slice(0, 10).map(el => ({ name: label(el), open: el instanceof HTMLDialogElement ? el.open : el.getAttribute('aria-hidden') !== 'true' })),
      forms: Array.from(document.forms).slice(0, 10).map(form => ({ action: form.getAttribute('action'), method: form.method, fields: Array.from(form.elements).slice(0, 15).map(el => el.getAttribute('name') || el.getAttribute('aria-label') || el.tagName.toLowerCase()) })),
    };
  }).catch(() => ({ liveRegions: [], dialogs: [], forms: [] }));
  const elements = new Map(elementsFromAriaSnapshot(accessibilityTree).map(e => [e.role + '\n' + (e.name ?? ''), e]));
  // Hidden dialogs and live regions are not in the accessibility tree yet, but a check may wait for them to appear.
  for (const dialog of extras.dialogs) if (dialog.name) elements.set('dialog\n' + dialog.name, { role: 'dialog', name: dialog.name });
  for (const region of extras.liveRegions) { const role = region.role === 'alert' || region.role === 'log' ? region.role : 'status'; if (region.text) elements.set(role + '\n' + region.text, { role, name: region.text }); }
  return { title, url, accessibilityTree, ...extras, elements: [...elements.values()].slice(0, MAX_ELEMENTS) };
}

/** Opens a start page, reads it and closes the browser. */
export async function inspectStartPage(options: { url: string; projectDir: string; machine: StructureMachine }): Promise<PageStructure> {
  const session = await openStartPage(options);
  try { return await readPageStructure(session); }
  finally { await closeBrowserSession(session).catch(() => undefined); }
}
