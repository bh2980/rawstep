export const SCREENREADER_BASIC = ['next', 'previous', 'activate'] as const;
/** One way of finding things on top of reading item by item: jumping by headings and listing them (the rotor). */
export const SCREENREADER_HEADINGS = ['heading.next', 'heading.previous', 'headings.list'] as const;
/** Jumping by form controls and picking one, buttons included, from the rotor's form controls list. */
export const SCREENREADER_FORM_CONTROLS = ['form.next', 'form.previous', 'formControls.rotor'] as const;
/** Jumping by links and listing them (the rotor). */
export const SCREENREADER_LINKS = ['link.next', 'link.previous', 'links.list'] as const;
