import type { Page } from 'playwright';
import type { Backend, BackendAction, BackendKeyboardObservation, BackendOperationOptions, BackendSession } from '@rawstep/core/contracts';

import { SCREENSHOT_KEYS } from '@rawstep/core/screenshot';
export { SCREENSHOT_KEYS } from '@rawstep/core/screenshot';

/** Only viewport pixels leave this adapter. No locators, DOM, AX, OCR, or mouse actions. */
export class ScreenshotKeyboardBackend implements Backend {
  readonly observationKind = 'keyboard' as const;
  readonly capabilities = Object.freeze({ intents: [] as readonly string[], keys: SCREENSHOT_KEYS, textEntry: true, replaceText: true });
  private page?: Page;
  private active = false;
  private counter = 0;
  private previousScreenshot?: BackendKeyboardObservation['screenshot'];

  attachSession(session: BackendSession): void { this.page = session.page as Page; }
  /** @deprecated Prefer attachSession; the runner calls it with the opened session. */
  attachPage(page: Page): void { this.page = page; }
  async start(options: BackendOperationOptions = {}): Promise<unknown> {
    options.signal?.throwIfAborted();
    if (this.active) throw new Error('Screenshot keyboard backend has already started.');
    this.active = true;
    return { backend: 'screenshot-keyboard', observationKind: 'keyboard', observationProvenance: 'keyboard', screenReader: 'not-used',
      policyObservation: 'viewport-png-only', actuator: 'playwright-keyboard-only', capabilities: this.capabilities,
      limitations: 'Visible pixels do not expose semantic focus or establish accessibility conformance.' };
  }
  subscribe(_listener: (event: unknown) => void): () => void { return () => {}; }
  private getPage(): Page {
    if (!this.active || !this.page) throw new Error('Screenshot keyboard backend is not attached to an active browser.');
    return this.page;
  }
  async execute(action: BackendAction, options: BackendOperationOptions = {}): Promise<unknown> {
    options.signal?.throwIfAborted();
    const page = this.getPage();
    if (action.kind === 'intent') throw new Error('Screen reader intents are unavailable in screenshot mode.');
    if (action.kind === 'key') {
      if (!(SCREENSHOT_KEYS as readonly string[]).includes(action.key)) throw new Error(`Unsupported screenshot key: ${action.key}`);
      await page.keyboard.press(action.key);
    } else {
      if (action.kind === 'replaceText') {
        await page.keyboard.press('ControlOrMeta+A');
        options.signal?.throwIfAborted();
        await page.keyboard.press('Backspace');
      }
      for (const character of action.text) {
        options.signal?.throwIfAborted();
        await page.keyboard.type(character);
      }
    }
    options.signal?.throwIfAborted();
    return { acknowledged: true, backend: 'screenshot-keyboard' };
  }
  async observe(options: BackendOperationOptions = {}): Promise<BackendKeyboardObservation> {
    options.signal?.throwIfAborted();
    const page = this.getPage();
    const startedAt = new Date().toISOString();
    const png = await page.screenshot({ type: 'png', fullPage: false, caret: 'hide' });
    options.signal?.throwIfAborted();
    const viewport = page.viewportSize();
    const screenshot = { pngBase64: png.toString('base64'), viewport: { w: viewport?.width ?? 0, h: viewport?.height ?? 0 } };
    const result: BackendKeyboardObservation = { kind: 'keyboard', windowId: `screenshot-window-${++this.counter}`,
      startedAt, endedAt: new Date().toISOString(), reason: 'viewport-screenshot', screenshot,
      ...(this.previousScreenshot ? { previousScreenshot: this.previousScreenshot } : {}) };
    this.previousScreenshot = screenshot;
    return result;
  }
  async close(): Promise<void> { this.active = false; this.page = undefined; this.previousScreenshot = undefined; }
}
