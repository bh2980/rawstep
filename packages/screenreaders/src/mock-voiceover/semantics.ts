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
  /** Native-profile projection metadata; independent corpus formatters still receive the original shape. */
  tagName?: string;
  inputType?: string;
  hasPopup?: string;
  autofill?: boolean;
  position?: number;
  setSize?: number;
  marker?: string;
  invalid?: boolean;
  nameFromPlaceholder?: boolean;
  currentPage?: boolean;
  containsImage?: boolean;
  valueMin?: number;
  valueMax?: number;
  caretStart?: number;
  selectionLength?: number;
  rows?: number;
  columns?: number;
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
  if (!node.protected && node.tagName === 'textarea') return [node.name, 'text entry area', node.value].filter(Boolean).join(', ');
  if (!node.protected && node.role === 'slider' && node.value) return [node.value, node.name, 'slider'].filter(Boolean).join(', ');
  if (!node.protected && node.role === 'button' && node.hasPopup === 'menu') return [node.name, 'menu pop up button'].filter(Boolean).join(', ');
  if (!node.protected && node.role === 'menuitem' && node.position !== undefined && node.setSize !== undefined) return `${node.name} menu item (${node.position} of ${node.setSize})`;
  if (!node.protected && node.role === 'combobox' && node.hasPopup === 'listbox') return [node.name, 'list box pop up', node.expanded ? 'expanded' : 'collapsed', 'combo box'].filter(Boolean).join(', ');
  if (!node.protected && node.role === 'textbox' && node.tagName === 'input' && node.autofill) return [node.value, node.name, node.description, node.required ? 'required' : '', node.invalid ? 'invalid data' : '', 'edit text with autofill menu'].filter(Boolean).join(', ');
  // Empty, explicitly named native inputs have type-specific field words. Placeholder/caret receipts need separate evidence.
  if (!node.protected && node.tagName === 'input' && !node.value && node.name && !node.nameFromPlaceholder && !node.autofill && !node.readonly) {
    const field = ({ text: 'edit text', email: 'email field', tel: 'telephone number field', url: 'url field', number: 'incrementable number field', search: 'search text field' } as Record<string, string>)[node.inputType ?? 'text'];
    if (field) return [node.name, node.description, node.required ? 'required' : '', node.invalid ? 'invalid data' : '', node.disabled ? 'dimmed' : '', field].filter(Boolean).join(', ');
  }
  if (!node.protected && node.role === 'progressbar') {
    const min = node.valueMin ?? 0, max = node.valueMax ?? 100, value = node.value === undefined ? undefined : Number(node.value);
    const amount = value !== undefined && Number.isFinite(value) && max > min ? `${Math.round(100 * (Math.min(max, Math.max(min, value)) - min) / (max - min))}%` : 'indeterminate';
    return [node.name, amount, 'progress indicator'].filter(Boolean).join(', ');
  }
  if (!node.protected && node.role === 'list') return ['list', node.name, node.setSize === undefined ? '' : `${node.setSize} ${node.setSize === 1 ? 'item' : 'items'}`, node.level && node.level > 1 ? `level ${node.level}` : ''].filter(Boolean).join(', ');
  if (!node.protected && node.role === 'listitem' && node.marker === '' && !node.name) return '';
  if (!node.protected && node.role === 'listitem') return [node.marker ?? 'bullet', node.name, node.position !== undefined && node.setSize !== undefined ? `${node.position} of ${node.setSize}` : ''].filter(Boolean).join(', ');
  if (!node.protected && node.role === 'descriptionlist') return ['description list', node.name, `${node.setSize ?? 0} items`].filter(Boolean).join(', ');
  if (!node.protected && node.role === 'descriptionitem') return [node.name, `${node.position} of ${node.setSize}`].filter(Boolean).join(', ');
  if (!node.protected && node.role === 'table' && node.rows !== undefined && node.columns !== undefined) return [node.name, 'table', `${node.columns} columns`, `${node.rows} rows`].filter(Boolean).join(', ');
  const parts: string[] = [];
  // The observed plain-link navigation announcements put the role before its name.
  const link = !node.protected && node.role === 'link';
  const checkbox = !node.protected && node.role === 'checkbox';
  const button = !node.protected && node.role === 'button';
  const textbox = !node.protected && node.role === 'textbox';
  const radio = !node.protected && node.role === 'radio' && typeof node.checked === 'boolean';
  const tab = !node.protected && node.role === 'tab';
  const disclosure = !node.protected && node.role === 'DisclosureTriangle';
  const switchControl = !node.protected && node.role === 'switch' && typeof node.checked === 'boolean';
  const heading = !node.protected && node.role === 'heading' && node.level !== undefined;
  const buttonDescription = button && node.pressed === undefined && node.expanded === undefined && node.description && node.description !== node.name;
  // Native Space/VO+Space receipts for plain checked controls differ from navigation wording.
  if (checkedStateChanged && (checkbox || switchControl) && typeof node.checked === 'boolean'
    && !node.required && !node.disabled && !node.readonly && !node.description && !node.value) {
    return [switchControl ? node.checked ? 'on' : 'off' : checkedState(node.checked), node.name, roleNames[node.role]].filter(Boolean).join(', ');
  }
  if (heading) parts.push('heading', `level ${node.level}`);
  if (link) parts.push([node.currentPage ? 'current page link' : 'link', node.containsImage ? 'image' : ''].filter(Boolean).join(' '));
  if (node.name) parts.push(node.name);
  if (buttonDescription) parts.push(node.description!);
  if (node.protected) parts.push('secure text field');
  else {
    if (!textbox || !node.multiline) {
      if (node.value && node.value !== node.name) parts.push(node.value);
    }
    if (checkbox && node.checked !== undefined) parts.push(checkedState(node.checked));
    if (switchControl) parts.push(node.checked ? 'on' : 'off');
    if ((radio && node.checked === true) || (tab && node.selected === true)) parts.push('selected');
    if (disclosure && node.expanded !== undefined) parts.push(node.expanded ? 'expanded' : 'collapsed');
    if (button && node.pressed !== undefined && node.pressed !== false) parts.push(node.pressed === 'mixed' ? 'mixed' : 'selected');
    if (button && node.expanded !== undefined) parts.push(node.expanded ? 'expanded' : 'collapsed');
    if (textbox && node.required) parts.push('required');
    // Chromium's internal roles (PascalCase, e.g. LabelText) are not spoken role words; ARIA roles without wording are said as they are.
    const role = link || heading ? '' : disclosure ? 'summary' : button && node.pressed !== undefined ? 'toggle button' : roleNames[node.role] ?? (/^[A-Z]/.test(node.role) ? '' : node.role);
    if (role) parts.push(role);
    // The inspected textarea observation is name, role, value (without a multiline suffix).
    if (textbox && node.multiline && node.value && node.value !== node.name) parts.push(node.value);
  }
  if (!heading && node.level !== undefined) parts.push(`level ${node.level}`);
  if (!checkbox && !switchControl && !radio && node.checked !== undefined) parts.push(checkedState(node.checked));
  if (!button && node.pressed !== undefined) parts.push(node.pressed === 'mixed' ? 'mixed' : node.pressed ? 'pressed' : 'not pressed');
  if (!button && !disclosure && node.expanded !== undefined) parts.push(node.expanded ? 'expanded' : 'collapsed');
  if (!tab && node.selected !== undefined) parts.push(node.selected ? 'selected' : 'not selected');
  if ((radio || tab || link && (node.setSize ?? 0) > 1) && node.position !== undefined && node.setSize !== undefined) parts.push(`${node.position} of ${node.setSize}`);
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
