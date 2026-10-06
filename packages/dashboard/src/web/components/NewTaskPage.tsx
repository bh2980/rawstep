import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import type { VerifyRule } from '@rawstep/core/contracts';
import { createManagedTask, hostnameOf, slugify } from '../lib/taskFiles';
import type { RouteChange } from '../hooks/useRoute';
import type { PageProps } from '../pages/types';
import { CheckSuggestions } from './CheckSuggestions';
import { RuleCard } from './RuleCard';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Textarea } from './ui/textarea';

type Props = PageProps & { navigate: (change: RouteChange) => void };
type VerifyKind = 'textVisible' | 'urlIncludes';

const BLANK: VerifyRule = { textVisible: '' };
/** The kind and text of a rule the simple editor can edit; `undefined` for every other kind. */
function simpleOf(rule: VerifyRule | undefined): { kind: VerifyKind; value: string } | undefined {
  if (!rule) return undefined;
  if ('textVisible' in rule) return { kind: 'textVisible', value: rule.textVisible };
  if ('urlIncludes' in rule) return { kind: 'urlIncludes', value: rule.urlIncludes };
  return undefined;
}
const complete = (rule: VerifyRule) => { const simple = simpleOf(rule); return !simple || simple.value.trim() !== ''; };

function BigField({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return <div className="grid gap-2"><Label htmlFor={id} className="text-base">{label}</Label>{children}{hint && <p id={id + '-hint'} className="text-sm leading-6 text-muted-foreground">{hint}</p>}</div>;
}

/** Full-page task creation: the few things a first-time user needs, with large inputs. Everything else keeps its default. */
export function NewTaskPage({ navigate, ...props }: Props) {
  const { t } = useTranslation();
  const profiles = props.view.config.profiles;
  const [url, setUrl] = useState(''), [goal, setGoal] = useState(''), [name, setName] = useState('');
  const [rules, setRules] = useState<VerifyRule[]>([BLANK]);
  const [profileId, setProfileId] = useState(profiles[0]!.id);
  const host = hostnameOf(url);
  // The simple editor edits the first rule while that is a simple kind; every other rule is a card.
  const simple = simpleOf(rules[0]);
  const cardStart = simple ? 1 : 0;
  const ready = url.trim() !== '' && goal.trim() !== '' && rules.length > 0 && rules.every(complete);
  const setSimple = (next: Partial<{ kind: VerifyKind; value: string }>) => {
    const merged = { ...simple!, ...next };
    setRules([{ [merged.kind]: merged.value } as VerifyRule, ...rules.slice(1)]);
  };
  const removeRule = (index: number) => { const next = rules.filter((_, i) => i !== index); setRules(next.length ? next : [BLANK]); };
  const addRule = (rule: VerifyRule) => setRules(current => current.length === 1 && simpleOf(current[0])?.value.trim() === '' ? [rule] : [...current, rule]);
  async function create() {
    const title = name.trim() || host || t('newTask.fallbackName');
    const task = {
      url: url.trim(), goal: goal.trim(), maxSteps: RAWSTEP_DEFAULTS.task.maxSteps, timeoutMs: RAWSTEP_DEFAULTS.task.timeoutMs,
      verify: { all: rules.map(rule => { const one = simpleOf(rule); return one ? { [one.kind]: one.value.trim() } : rule; }) },
    };
    const id = await createManagedTask(props, { name: title, slug: slugify(name) || slugify(host), task, profileId });
    navigate({ task: id });
  }
  return <form className="mx-auto grid w-full max-w-3xl gap-6" onSubmit={event => { event.preventDefault(); if (ready && !props.busy) void props.act(create); }}>
    <div className="grid gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">{t('newTask.title')}</h1>
      <p className="text-sm leading-6 text-muted-foreground">{t('newTask.description')}</p>
    </div>
    <Card>
      <CardHeader><CardTitle>{t('newTask.whatTitle')}</CardTitle><CardDescription>{t('newTask.whatDescription')}</CardDescription></CardHeader>
      <CardContent className="grid gap-6">
        <BigField id="new-task-url" label={t('newTask.url')} hint={t('taskFields.startUrlHint')}>
          <Input id="new-task-url" aria-describedby="new-task-url-hint" className="h-11 text-base md:text-base" placeholder="https://" value={url} onChange={event => setUrl(event.target.value)} />
        </BigField>
        <BigField id="new-task-goal" label={t('newTask.goal')} hint={t('newTask.goalHint')}>
          <Textarea id="new-task-goal" aria-describedby="new-task-goal-hint" rows={7} className="min-h-40 text-base leading-7 md:text-base" value={goal} onChange={event => setGoal(event.target.value)} />
        </BigField>
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle>{t('newTask.verifyTitle')}</CardTitle><CardDescription>{t('newTask.verifyDescription')}</CardDescription></CardHeader>
      <CardContent className="grid gap-6">
        {simple && <>
          <BigField id="new-task-kind" label={t('newTask.verifyKind')}>
            <Select value={simple.kind} onValueChange={next => setSimple({ kind: next as VerifyKind })}>
              <SelectTrigger id="new-task-kind" className="h-11 w-full text-base"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="textVisible">{t('taskFields.ruleKinds.textVisible')}</SelectItem>
                <SelectItem value="urlIncludes">{t('taskFields.ruleKinds.urlIncludes')}</SelectItem>
              </SelectContent>
            </Select>
          </BigField>
          <BigField id="new-task-value" label={t('newTask.verifyValue')} hint={t('newTask.verifyHint')}>
            <Input id="new-task-value" aria-describedby="new-task-value-hint" className="h-11 text-base md:text-base" value={simple.value} onChange={event => setSimple({ value: event.target.value })} />
          </BigField>
        </>}
        {rules.length > cardStart && <div className="grid gap-3">
          <h3 className="text-base font-medium">{t('checkSuggest.chosen')}</h3>
          {!simple && <p className="text-sm leading-6 text-muted-foreground">{t('checkSuggest.chosenHint')}</p>}
          {rules.slice(cardStart).map((rule, i) => <RuleCard key={cardStart + i + JSON.stringify(rule)} rule={rule} n={cardStart + i + 1} onRemove={() => removeRule(cardStart + i)} />)}
        </div>}
        <CheckSuggestions view={props.view} url={url} goal={goal} onUse={rule => setRules([rule])} onAdd={addRule} />
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle>{t('newTask.optionsTitle')}</CardTitle></CardHeader>
      <CardContent className="grid gap-6">
        <BigField id="new-task-name" label={t('newTask.name')} hint={t('newTask.nameHint')}>
          <Input id="new-task-name" aria-describedby="new-task-name-hint" className="h-11 text-base md:text-base" placeholder={host || t('newTask.fallbackName')} value={name} onChange={event => setName(event.target.value)} />
        </BigField>
        <BigField id="new-task-profile" label={t('newTask.profile')} hint={t('newTask.profileHint')}>
          <Select value={profileId} onValueChange={setProfileId}>
            <SelectTrigger id="new-task-profile" aria-describedby="new-task-profile-hint" className="h-11 w-full text-base"><SelectValue /></SelectTrigger>
            <SelectContent>{profiles.map(profile => <SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>)}</SelectContent>
          </Select>
        </BigField>
      </CardContent>
      <CardFooter className="justify-end gap-3">
        <Button type="button" variant="outline" onClick={() => navigate({ view: 'tasks' })}>{t('newTask.cancel')}</Button>
        <Button type="submit" size="lg" disabled={props.busy || !ready}>{t('newTask.create')}</Button>
      </CardFooter>
    </Card>
  </form>;
}
