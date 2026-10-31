export const SCREENREADER_BASIC = ['next', 'previous', 'activate'] as const;
/** Jump by heading or form control, and list the headings (the rotor): how people who know their screen reader move around. */
export const SCREENREADER_QUICK = ['heading.next', 'heading.previous', 'form.next', 'headings.list'] as const;
/** Links and going back through form controls, by quick navigation and the rotor: what a skilled screen reader user adds. */
export const SCREENREADER_MORE = ['form.previous', 'link.next', 'link.previous', 'links.list'] as const;
/** Keys a skilled screen reader user presses in forms, menus and dialogs, where focus moves with them. */
export const SCREENREADER_KEYS = ['Tab', 'Shift+Tab', 'Enter', 'Space', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] as const;
