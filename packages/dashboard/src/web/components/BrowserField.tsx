import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { BROWSER_MODES, needsEndpoint, type BrowserChoice, type BrowserMode } from '../lib/taskBrowser';
import { NewTabLink } from './Link';
import { Checkbox } from './ui/checkbox';
import { Label } from './ui/label';

type Props = {
  value: BrowserChoice; onChange: (value: BrowserChoice) => void;
  /** Whether this computer has the address of a Chrome the person started (`machine.browserEndpoint`). */
  endpointSet: boolean;
};

/**
 * Which browser a task opens: a radio group of three (a new one, a Chrome the person started, that Chrome with its sign-in) and a
 * checkbox for a person passing bot checks. Each choice has a one-line description a screen reader reads with it. Choosing a Chrome of
 * their own when this computer has no address for it says so, with a link to where the address is entered (in a new tab, so an
 * edit that is not saved stays).
 */
export function BrowserField({ value, onChange, endpointSet }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const missing = needsEndpoint(value) && !endpointSet;
  return <fieldset className="grid gap-3">
    <legend className="mb-1 text-sm font-semibold">{t('taskBrowser.title')}</legend>
    {BROWSER_MODES.map((mode: BrowserMode) => {
      const note = mode !== 'launch' && missing && value.mode === mode;
      return <div key={mode} className="flex items-start gap-2.5">
        <input type="radio" id={`${id}-${mode}`} name={`${id}-mode`} checked={value.mode === mode} onChange={() => onChange({ ...value, mode })}
          aria-describedby={`${id}-${mode}-hint${note ? ` ${id}-missing` : ''}`} className="mt-1 size-4 shrink-0 accent-trace" />
        <div className="grid min-w-0 gap-0.5">
          <Label htmlFor={`${id}-${mode}`} className="text-sm leading-6 font-medium">{t(`taskBrowser.${mode}`)}</Label>
          <p id={`${id}-${mode}-hint`} className="text-xs leading-5 text-muted-foreground">{t(`taskBrowser.${mode}Hint`)}</p>
          {note && <p id={`${id}-missing`} className="text-[13px] leading-5 text-inspect">
            {t('taskBrowser.noEndpoint')} <NewTabLink to={{ view: 'settings', section: 'machine' }} className="font-medium text-trace underline underline-offset-4">{t('taskBrowser.toMachine')}</NewTabLink>
          </p>}
        </div>
      </div>;
    })}
    <div className="flex items-start gap-2.5 border-t border-edge pt-3">
      <Checkbox id={`${id}-person`} className="mt-1" checked={value.personCheck} aria-describedby={`${id}-person-hint`} onCheckedChange={on => onChange({ ...value, personCheck: on === true })} />
      <div className="grid min-w-0 gap-0.5">
        <Label htmlFor={`${id}-person`} className="text-sm leading-6 font-medium">{t('taskBrowser.personCheck')}</Label>
        <p id={`${id}-person-hint`} className="text-xs leading-5 text-muted-foreground">{t('taskBrowser.personCheckHint')}</p>
      </div>
    </div>
  </fieldset>;
}
