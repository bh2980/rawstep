import { defineRegistry } from '@json-render/react';
import { shadcnComponents as components } from '@json-render/shadcn';
import { dashboardCatalog } from '../../shared/ui-catalog';

export const { registry: dashboardRegistry } = defineRegistry(dashboardCatalog, {
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
});
