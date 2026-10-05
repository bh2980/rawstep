import { defineCatalog, formatSpecIssues, validateSpec, type Spec } from '@json-render/core';
import { schema } from '@json-render/react/schema';
import { shadcnComponentDefinitions as components } from '@json-render/shadcn/catalog';

export const dashboardCatalog = defineCatalog(schema, {
  components: {
    Card: components.Card,
    Stack: components.Stack,
    Heading: components.Heading,
    Text: components.Text,
    Badge: components.Badge,
    Separator: components.Separator,
    Checkbox: components.Checkbox,
    Switch: components.Switch,
    Button: components.Button,
    Input: components.Input,
    Textarea: components.Textarea,
    Select: components.Select,
    Table: components.Table,
    Progress: components.Progress,
    Alert: components.Alert,
  },
  // Permission forms use built-in state bindings; persisted actions use explicit React API handlers.
  actions: {},
});

export function parseDashboardSpec(value: unknown): Spec {
  const parsed = dashboardCatalog.validate(value);
  if (!parsed.success || !parsed.data) throw new Error('Invalid dashboard UI catalog specification.');
  // Catalog inference exposes visibility/repeat as unknown; the renderer uses core's Spec contract.
  const spec = parsed.data as Spec;
  const issues = validateSpec(spec);
  if (!issues.valid) throw new Error(`Invalid dashboard UI structure: ${formatSpecIssues(issues.issues)}`);
  return spec;
}
