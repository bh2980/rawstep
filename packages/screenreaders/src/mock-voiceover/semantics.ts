/** Sanitized semantic input to the simulation's English speech formatter. */
export type SimulatedSemanticNode = {
  role: string;
  name: string;
  value?: string;
  description?: string;
  protected: boolean;
  disabled: boolean;
  readonly: boolean;
  required: boolean;
  multiline: boolean;
  checked?: boolean | 'mixed';
  pressed?: boolean | 'mixed';
  expanded?: boolean;
  selected?: boolean;
  level?: number;
  modal: boolean;
};

const roleNames: Readonly<Record<string, string>> = {
  StaticText: '', InlineTextBox: '', heading: 'heading', textbox: 'edit text',
  searchbox: 'search text field', checkbox: 'checkbox', radio: 'radio button',
  combobox: 'combo box', button: 'button', link: 'link', dialog: 'dialog',
  alertdialog: 'alert dialog', switch: 'switch', image: 'image', img: 'image',
  listitem: 'list item', menuitem: 'menu item', menuitemcheckbox: 'menu item checkbox',
  menuitemradio: 'menu item radio button', spinbutton: 'spin button',
};

/**
 * Composite, evidence-informed navigation wording, not a version-specific VoiceOver emulator.
 * Only the rules referenced in docs/mock-voiceover-evidence.md have observed-output fixtures.
 * Other states, value/description timing, and activation announcements remain approximations.
 */
export function formatSimulatedSpeech(node: SimulatedSemanticNode, checkedStateChanged = false): string {
  const parts: string[] = [];
  // The observed plain-link navigation announcements put the role before its name.
  const link = !node.protected && node.role === 'link';
  const checkbox = !node.protected && node.role === 'checkbox';
  const button = !node.protected && node.role === 'button';
  const textbox = !node.protected && node.role === 'textbox';
  const switchControl = !node.protected && node.role === 'switch' && typeof node.checked === 'boolean';
  const heading = !node.protected && node.role === 'heading' && node.level !== undefined;
  const buttonDescription = button && node.pressed === undefined && node.expanded === undefined && node.description && node.description !== node.name;
  // Native Space/VO+Space receipts for plain checked controls differ from navigation wording.
  if (checkedStateChanged && (checkbox || switchControl) && typeof node.checked === 'boolean'
    && !node.required && !node.disabled && !node.readonly && !node.description && !node.value) {
    return [switchControl ? node.checked ? 'on' : 'off' : checkedState(node.checked), node.name, roleNames[node.role]].filter(Boolean).join(', ');
  }
  if (heading) parts.push('heading', `level ${node.level}`);
  if (link) parts.push('link');
  if (node.name) parts.push(node.name);
  if (buttonDescription) parts.push(node.description!);
  if (node.protected) parts.push('secure text field');
  else {
    if (!textbox || !node.multiline) {
      if (node.value && node.value !== node.name) parts.push(node.value);
    }
    if (checkbox && node.checked !== undefined) parts.push(checkedState(node.checked));
    if (switchControl) parts.push(node.checked ? 'on' : 'off');
    if (button && node.pressed !== undefined && node.pressed !== false) parts.push(node.pressed === 'mixed' ? 'mixed' : 'selected');
    if (button && node.expanded !== undefined) parts.push(node.expanded ? 'expanded' : 'collapsed');
    if (textbox && node.required) parts.push('required');
    // Chromium's internal roles (PascalCase, e.g. LabelText) are not spoken role words; ARIA roles without wording are said as they are.
    const role = link || heading ? '' : button && node.pressed !== undefined ? 'toggle button' : roleNames[node.role] ?? (/^[A-Z]/.test(node.role) ? '' : node.role);
    if (role) parts.push(role);
    // The inspected textarea observation is name, role, value (without a multiline suffix).
    if (textbox && node.multiline && node.value && node.value !== node.name) parts.push(node.value);
  }
  if (!heading && node.level !== undefined) parts.push(`level ${node.level}`);
  if (!checkbox && !switchControl && node.checked !== undefined) parts.push(checkedState(node.checked));
  if (!button && node.pressed !== undefined) parts.push(node.pressed === 'mixed' ? 'mixed' : node.pressed ? 'pressed' : 'not pressed');
  if (!button && node.expanded !== undefined) parts.push(node.expanded ? 'expanded' : 'collapsed');
  if (node.selected !== undefined) parts.push(node.selected ? 'selected' : 'not selected');
  if (node.disabled) parts.push('disabled');
  if (node.readonly) parts.push('read only');
  if (!textbox && node.required) parts.push('required');
  if (!textbox && node.multiline) parts.push('multi-line');
  if (node.modal) parts.push('modal');
  if (!buttonDescription && node.description && node.description !== node.name) parts.push(node.description);
  return parts.join(', ');
}

function checkedState(value: boolean | 'mixed'): string {
  return value === 'mixed' ? 'mixed' : value ? 'checked' : 'unchecked';
}
