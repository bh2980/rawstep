import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createStateStore, JSONUIProvider } from '@json-render/react';
import { parseDashboardSpec } from '../../shared/ui-catalog';
import type { Permissions } from '@rawstep/project/config';
import { dashboardRegistry } from '../json-ui/registry';
import { DashboardRenderer } from '../json-ui/DashboardRenderer';

export function PermissionsEditor({ value, onChange, capabilities, inputNames }: { value: Permissions; onChange: (p: Permissions) => void; capabilities: { keys: string[]; intents: string[] }; inputNames?: string[] }) {
  const id = useId();
  const { t } = useTranslation();
  const options = [...[...new Set([...capabilities.keys, ...value.keys])].map(label => ({ label, kind: 'keys' as const, supported: capabilities.keys.includes(label) })), ...[...new Set([...capabilities.intents, ...value.intents])].map(label => ({ label, kind: 'intents' as const, supported: capabilities.intents.includes(label) })), ...(inputNames ?? []).map(label => ({ label, kind: 'inputKeys' as const, supported: true }))];
  const bits: Record<string, boolean> = Object.fromEntries(options.map((o, i) => ['a' + i, o.kind === 'inputKeys' ? (value.inputKeys ?? inputNames ?? []).includes(o.label) : value[o.kind].includes(o.label)]));
  bits.typeText = value.typeText; bits.replaceText = value.replaceText;
  const [store] = useState(() => createStateStore({ bits }));
  const current = useRef({ value, onChange, options }); const syncing = useRef(false);
  useEffect(() => { current.current = { value, onChange, options }; });
  const serialized = JSON.stringify(bits);
  useEffect(() => { if (JSON.stringify(store.get('/bits')) !== serialized) { syncing.current = true; store.set('/bits', JSON.parse(serialized)); syncing.current = false; } }, [serialized, store]);
  useEffect(() => store.subscribe(() => {
    if (syncing.current) return;
    const b = store.get('/bits') as Record<string, boolean>, c = current.current;
    c.onChange({ ...c.value, keys: c.options.filter((o, i) => o.kind === 'keys' && b['a' + i]).map(o => o.label), intents: c.options.filter((o, i) => o.kind === 'intents' && b['a' + i]).map(o => o.label),
      ...(inputNames ? { inputKeys: c.options.filter((o, i) => o.kind === 'inputKeys' && b['a' + i]).map(o => o.label) } : {}), typeText: b.typeText!, replaceText: b.replaceText! });
  }), [store, inputNames]);
  const optionsKey = JSON.stringify(options);
  const spec = useMemo(() => {
    const elements: Record<string, unknown> = {};
    const children: string[] = [];
    const parsedOptions = JSON.parse(optionsKey) as typeof options;
    parsedOptions.forEach((o, i) => { const name = 'a' + i; children.push(name); elements[name] = { type: 'Checkbox', props: { label: o.supported ? (o.kind === 'inputKeys' ? t('permissions.inputLabel', { label: o.label }) : o.label) : t('permissions.unsupported', { label: o.kind === 'inputKeys' ? t('permissions.inputLabel', { label: o.label }) : o.label }), name: id + '-' + name, checked: { $bindState: '/bits/' + name }, checks: null, validateOn: 'change' }, children: [] }; });
    for (const [name, label] of [['typeText', t('permissions.textEntry')], ['replaceText', t('permissions.replaceText')]]) { children.push(name!); elements[name!] = { type: 'Switch', props: { label, name: id + name, checked: { $bindState: '/bits/' + name }, checks: null, validateOn: 'change' }, children: [] }; }
    elements.root = { type: 'Stack', props: { direction: 'vertical', gap: 'md', align: 'stretch', justify: 'start', className: null }, children };
    return parseDashboardSpec({ root: 'root', elements });
  }, [id, optionsKey, t]);
  return <JSONUIProvider registry={dashboardRegistry} store={store}><DashboardRenderer spec={spec} /></JSONUIProvider>;
}
