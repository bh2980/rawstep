export const SCREENSHOT_KEYS = Object.freeze(['Tab', 'Shift+Tab', 'Enter', 'Space', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Backspace', 'Delete', 'Shift+Space', 'Alt+ArrowLeft'] as const);
/** Browser shortcuts the page never receives as keystrokes; the keyboard backend does what the browser would. */
export const BROWSER_KEYS: Readonly<Record<string, 'back'>> = Object.freeze({ 'Alt+ArrowLeft': 'back' });
