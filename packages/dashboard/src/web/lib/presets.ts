/** What the backend of a mode can do. */
export type ActionCapabilities = { keys: readonly string[]; intents: readonly string[] };

export const KEYBOARD_BASIC = ['Tab', 'Shift+Tab', 'Enter', 'Space'] as const;
/** Arrow keys, Escape, Home and End on top of the basic keys: menus, tabs, comboboxes and dialogs move with them. */
export const KEYBOARD_WIDGETS = [...KEYBOARD_BASIC, 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape', 'Home', 'End'] as const;
export const SCREENREADER_BASIC = ['next', 'previous', 'activate'] as const;
/** One way of finding things on top of reading item by item: jumping by headings and listing them (the rotor). */
export const SCREENREADER_HEADINGS = ['heading.next', 'heading.previous', 'headings.list'] as const;
/** Jumping by form controls and picking one, buttons included, from the rotor's form controls list. */
export const SCREENREADER_FORM_CONTROLS = ['form.next', 'form.previous', 'formControls.rotor'] as const;
/** Jumping by links and listing them (the rotor). */
export const SCREENREADER_LINKS = ['link.next', 'link.previous', 'links.list'] as const;
/** Every keyboard key, with scrolling up a page (Shift+Space) and the browser's back (Alt+←). */
export const KEYBOARD_ALL = [...KEYBOARD_WIDGETS, 'PageUp', 'PageDown', 'Shift+Space', 'Backspace', 'Delete', 'Alt+ArrowLeft'] as const;
