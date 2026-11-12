/**
 * Whether keyboard focus is on a field text can be typed into. It runs inside the page (`page.evaluate`), so it stands alone: no
 * imports, nothing from the scope around it. The one test for this: the runner's gate before a text action and the simulated screen
 * reader's own check while it types both use it, so a field one refuses the other refuses too, and for the same reason.
 * A field that is disabled, read-only, inert or marked `aria-disabled` is not one a user would type into. With `original`, focus must
 * also still be on that element (typing moved it away).
 */
export function focusIsEditable(original?: Element | null): boolean {
  if (!document.hasFocus()) return false;
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  if (original && active !== original) return false;
  if (!(active instanceof HTMLElement) || active.closest('[inert], [aria-disabled="true"]')) return false;
  if (active instanceof HTMLTextAreaElement) return !active.disabled && !active.readOnly;
  if (active instanceof HTMLInputElement) return !active.disabled && !active.readOnly && ['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(active.type);
  return active.isContentEditable;
}
