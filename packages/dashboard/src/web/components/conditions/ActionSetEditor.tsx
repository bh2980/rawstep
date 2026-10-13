import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { i18n } from '../../i18n';
import { Check, Minus } from 'lucide-react';
import type { ActionSet, AtBackend, Mode, Permissions } from '@rawstep/project/config';
import type { ConfigView } from '../../../shared/config';
import { actionLabel, AT_BACKENDS, MODES, unsupportedActions } from '../../lib/conditions';
import { cn } from '../../lib/utils';
import { MultiChoice, Toggle } from '../forms';
import { InfoTip } from '../layout/InfoTip';
import { Checkbox } from '../ui/checkbox';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';

type Capabilities = ConfigView['capabilities'];
type Props = {
  actionSet: ActionSet; onChange: (a: ActionSet) => void; capabilities: Capabilities; inputNames?: readonly string[]; compact?: boolean;
  /** Only this mode's actions, without the mode tabs: a task page edits the mode it runs. */
  only?: Mode;
  /** The screen reader the profile runs on: only its missing actions are warned about. All three are warned about when unset. */
  backend?: AtBackend;
};

/** Screen reader actions in the order a person learns them; anything a backend adds comes after. */
const INTENT_ORDER = ['next', 'previous', 'activate', 'heading.next', 'heading.previous', 'form.next', 'form.previous', 'link.next', 'link.previous', 'headings.list', 'links.list', 'readCurrent', 'readFocused', 'interact', 'stopInteracting'];
const ordered = (names: Iterable<string>, order: readonly string[] = []) => [...new Set(names)].sort((a, b) => {
  const ia = order.indexOf(a), ib = order.indexOf(b);
  return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib);
});
const toggle = (list: readonly string[], name: string, on: boolean) => on ? [...new Set([...list, name])] : list.filter(item => item !== name);
const head = 'h-8 px-3 text-xs font-medium tracking-wide text-muted-foreground';

/**
 * What the simulated user may do, per mode. Screen reader actions are listed with a column per assistive technology, because the same
 * action set can run on the simulation, VoiceOver or NVDA and a run with an action its screen reader lacks is stopped before it starts.
 */
export function ActionSetEditor({ actionSet, onChange, capabilities, inputNames, compact, only, backend }: Props) {
  const { t } = useTranslation();
  const set = (mode: Mode) => (permissions: Permissions) => onChange({ ...actionSet, [mode]: permissions });
  const gaps = unsupportedActions(actionSet, capabilities), warned = AT_BACKENDS.filter(b => (!backend || b === backend) && gaps.screenreader[b].length);
  const screenreader = <div className="grid gap-4">
    <ScreenreaderActions value={actionSet.screenreader} onChange={set('screenreader')} capabilities={capabilities.screenreader} compact={compact} backends={backend ? [backend] : AT_BACKENDS} />
    {warned.map(b => <p key={b} role="note" className="border-l-2 border-inspect bg-inspect-soft py-2 pr-3 pl-3 text-[13px] leading-5">
      {t('conditions.actionSet.unsupportedWarning', { backend: t(`conditions.backends.${b}`), actions: gaps.screenreader[b].map(actionLabel).join(', ') })}
    </p>)}
    <Typing mode="screenreader" value={actionSet.screenreader} onChange={set('screenreader')} inputNames={inputNames} compact={compact} />
  </div>;
  const keyboard = <div className="grid gap-4">
    <KeyboardActions value={actionSet.keyboard} onChange={set('keyboard')} capabilities={capabilities.keyboard} />
    {gaps.keyboard.length > 0 && <p role="note" className="border-l-2 border-inspect bg-inspect-soft py-2 pr-3 pl-3 text-[13px] leading-5">{t('conditions.actionSet.keyboardUnsupported', { actions: gaps.keyboard.join(', ') })}</p>}
    <Typing mode="keyboard" value={actionSet.keyboard} onChange={set('keyboard')} inputNames={inputNames} compact={compact} />
  </div>;
  if (only) return only === 'keyboard' ? keyboard : screenreader;
  return <Tabs defaultValue="screenreader" className={cn('min-w-0', compact ? 'gap-3' : 'gap-4')}>
    <TabsList variant="line" aria-label={t('conditions.actionSet.modesLabel')}>
      {MODES.map(mode => <TabsTrigger key={mode} value={mode}>{t(`conditions.modes.${mode}`)}
        {(mode === 'keyboard' ? gaps.keyboard.length > 0 : warned.length > 0) && <span className="ml-1 font-normal text-inspect">· {t('conditions.actionSet.hasUnsupported')}</span>}
      </TabsTrigger>)}
    </TabsList>
    <TabsContent value="screenreader">{screenreader}</TabsContent>
    <TabsContent value="keyboard">{keyboard}</TabsContent>
  </Tabs>;
}

/** A support mark: a check, or the words "지원 안 함" (never colour alone). */
function Support({ ok }: { ok: boolean }) {
  const { t } = useTranslation();
  return ok
    ? <span className="inline-flex items-center gap-1"><Check aria-hidden="true" className="size-3.5 text-reach" /><span className="sr-only">{t('conditions.actionSet.supported')}</span></span>
    : <span className="inline-flex items-center gap-1 text-inspect"><Minus aria-hidden="true" className="size-3.5" />{t('conditions.actionSet.unsupported')}</span>;
}

/** A checkbox row label; a key also says, in small words, what it does. */
function AllowCell({ label, note, checked, onChange }: { label: string; note?: string | undefined; checked: boolean; onChange: (on: boolean) => void }) {
  const id = useId();
  return <TableCell className="px-3 py-2 whitespace-normal">
    <span className="flex items-center gap-2.5"><Checkbox id={id} checked={checked} onCheckedChange={v => onChange(v === true)} />
      <label htmlFor={id} className="cursor-pointer text-sm">{label}{note && <span className="ml-2 text-xs text-muted-foreground">{note}</span>}</label></span>
  </TableCell>;
}

/** What a key does, for the keys table; a key without words shows none. */
function keyRole(key: string): string | undefined {
  const path = `conditions.actionSet.keyRoles.${key}`;
  return i18n.exists(path) ? i18n.t(path as 'conditions.actionSet.allowedKey') : undefined;
}

/**
 * Screen reader actions with a support column per screen reader. Given one screen reader, only it is listed, and only what it supports
 * (plus anything already allowed). Raw keys are listed only once a profile uses them.
 */
function ScreenreaderActions({ value, onChange, capabilities, compact, backends }: { value: Permissions; onChange: (p: Permissions) => void; capabilities: Capabilities['screenreader']; compact?: boolean | undefined; backends: readonly AtBackend[] }) {
  const { t } = useTranslation();
  const intents = ordered([...backends.flatMap(b => capabilities[b].intents), ...value.intents], INTENT_ORDER);
  const keys = ordered([...backends.flatMap(b => capabilities[b].keys), ...value.keys]);
  const table = (rows: string[], kind: 'intents' | 'keys', caption: string, info?: string) => <div className="overflow-x-auto border-y border-edge-strong">
    {/* Fixed layout and a fixed first column, so the actions table and the keys table line up. */}
    <Table className={cn('table-fixed', backends.length > 1 && 'min-w-[32rem]')}>
      <TableCaption className="sr-only">{caption}</TableCaption>
      <TableHeader><TableRow className="bg-raised hover:bg-raised">
        <TableHead scope="col" className={cn(head, 'w-72')}><span className="inline-flex items-center gap-1">{t(`conditions.actionSet.${kind === 'keys' ? 'allowedKey' : 'allowed'}`)}{info && !compact && <InfoTip term={t(`conditions.actionSet.${kind === 'keys' ? 'allowedKey' : 'allowed'}`)}>{info}</InfoTip>}</span></TableHead>
        {backends.map(b => <TableHead key={b} scope="col" className={head}>{t(`conditions.backends.${b}`)}</TableHead>)}
      </TableRow></TableHeader>
      <TableBody>{rows.map(name => <TableRow key={name}>
        <AllowCell label={kind === 'intents' ? actionLabel(name) : name} note={kind === 'keys' ? keyRole(name) : undefined} checked={value[kind].includes(name)} onChange={on => onChange({ ...value, [kind]: toggle(value[kind], name, on) })} />
        {backends.map(b => <TableCell key={b} className="px-3 py-2 text-[13px]"><Support ok={capabilities[b][kind].includes(name)} /></TableCell>)}
      </TableRow>)}</TableBody>
    </Table>
  </div>;
  return <div className="grid gap-3">
    {table(intents, 'intents', t('conditions.actionSet.intentsCaption'), t('conditions.actionSet.screenreaderIntro'))}
    {keys.length > 0 && table(keys, 'keys', t('conditions.actionSet.keysCaption'), t('conditions.actionSet.keysDescription'))}
  </div>;
}

function KeyboardActions({ value, onChange, capabilities }: { value: Permissions; onChange: (p: Permissions) => void; capabilities: Capabilities['keyboard'] }) {
  const { t } = useTranslation();
  const keys = ordered([...capabilities.keys, ...value.keys], capabilities.keys);
  return <div className="grid gap-3">
    <div className="overflow-x-auto border-y border-edge-strong">
      <Table className="min-w-[20rem]">
        <TableCaption className="sr-only">{t('conditions.actionSet.keyboardCaption')}</TableCaption>
        <TableHeader><TableRow className="bg-raised hover:bg-raised">
          <TableHead scope="col" className={head}>{t('conditions.actionSet.allowedKey')}</TableHead>
          <TableHead scope="col" className={head}>{t('conditions.actionSet.keyboardBackend')}</TableHead>
        </TableRow></TableHeader>
        <TableBody>{keys.map(key => <TableRow key={key}>
          <AllowCell label={key} note={keyRole(key)} checked={value.keys.includes(key)} onChange={on => onChange({ ...value, keys: toggle(value.keys, key, on) })} />
          <TableCell className="px-3 py-2 text-[13px]"><Support ok={capabilities.keys.includes(key)} /></TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </div>
  </div>;
}

/** Typing the task's named inputs: whether the model may type them, may replace what a field holds, and which inputs it may use. */
function Typing({ mode, value, onChange, inputNames, compact }: { mode: Mode; value: Permissions; onChange: (p: Permissions) => void; inputNames?: readonly string[] | undefined; compact?: boolean | undefined }) {
  const { t } = useTranslation();
  const typing = value.typeText || value.replaceText;
  return <section className="grid gap-3 border-t border-edge pt-3" aria-label={t('conditions.actionSet.typingTitle', { mode: t(`conditions.modes.${mode}`) })}>
    <Toggle label={t('conditions.actionSet.typeText')} info={compact ? undefined : t('conditions.actionSet.typeTextHint')} checked={value.typeText} onChange={typeText => onChange({ ...value, typeText })} />
    <Toggle label={t('conditions.actionSet.replaceText')} info={compact ? undefined : t('conditions.actionSet.replaceTextHint')} checked={value.replaceText} onChange={replaceText => onChange({ ...value, replaceText })} />
    {typing && inputNames && inputNames.length > 0 && <MultiChoice label={t('conditions.actionSet.inputKeys')} items={inputNames.map(name => ({ id: name, name }))} selected={value.inputKeys ?? [...inputNames]}
      onChange={selected => { const { inputKeys: _old, ...rest } = value; onChange(selected.length === inputNames.length && inputNames.every(n => selected.includes(n)) ? rest : { ...rest, inputKeys: selected }); }} />}
  </section>;
}
