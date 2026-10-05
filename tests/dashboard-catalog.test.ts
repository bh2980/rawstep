import { describe, expect, it } from 'vitest';
import { dashboardCatalog, parseDashboardSpec } from '../packages/dashboard/src/shared/ui-catalog.js';
import keyboard from '../packages/dashboard/src/web/specs/keyboard-permissions.json' with { type: 'json' };
import screenreader from '../packages/dashboard/src/web/specs/screenreader-permissions.json' with { type: 'json' };

describe('dashboard JSON UI boundary', () => {
  it('accepts the bound shadcn previews for both modes', () => {
    for (const spec of [keyboard, screenreader]) {
      const parsed = parseDashboardSpec(spec);
      expect(parsed.elements.textEntry.props.checked).toHaveProperty('$bindState');
    }
  });

  it('rejects components outside the shadcn catalog', () => {
    const spec = structuredClone(keyboard);
    spec.elements.permissions.type = 'RawHtml';
    expect(() => parseDashboardSpec(spec)).toThrow('Invalid dashboard UI catalog');
  });

  it('rejects a missing referenced element', () => {
    const spec = structuredClone(keyboard);
    spec.elements.permissions.children.push('missing-element');
    expect(() => parseDashboardSpec(spec)).toThrow('Invalid dashboard UI structure');
  });

  it('exports a prompt and schema for future generation without run handlers', () => {
    expect(dashboardCatalog.prompt()).toContain('Checkbox');
    expect(dashboardCatalog.jsonSchema()).toHaveProperty('properties');
    expect(dashboardCatalog.actionNames).not.toContain('run_task');
  });
});
