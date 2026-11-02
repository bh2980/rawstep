import { History, Languages, ListChecks, Monitor, Moon, SlidersHorizontal, Sun, UserRound, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../hooks/useTheme';
import type { Route, RouteChange, View } from '../hooks/useRoute';
import { LANGUAGES, LANGUAGE_NAMES, currentLanguage, setLanguage } from '../i18n/index.js';
import { cn } from '../lib/utils';
import type { Unsaved } from '../pages/types';
import { Link } from './Link';
import { Button } from './ui/button';

type Props = {
  route: Route; navigate: (change: RouteChange) => void; unsaved?: Unsaved;
  projectName: string;
  /** How many items each page lists, shown beside its name. */
  counts: Partial<Record<View, number>>;
  connected: boolean; running: number; queued: number;
};

/** The pages, in order. 설정 holds its parts as tabs on its own page. */
const items: { view: View; icon: LucideIcon }[] = [
  { view: 'tasks', icon: ListChecks }, { view: 'runs', icon: History }, { view: 'profiles', icon: UserRound }, { view: 'settings', icon: SlidersHorizontal },
];
const themeIcons = { system: Monitor, light: Sun, dark: Moon } as const;

/**
 * The sidebar: the product and project names, the four pages with their counts, and at the foot the live run counts (a polite
 * live region), the theme and the language. A page with edits that are not saved carries a dot.
 */
export function AppNav({ route, navigate, unsaved = {}, projectName, counts, connected, running, queued }: Props) {
  const { t } = useTranslation();
  const { preference, cycle } = useTheme();
  const ThemeIcon = themeIcons[preference];
  const themeLabel = t('topBar.theme', { current: t(`topBar.themes.${preference}`) });
  const language = currentLanguage(), nextLanguage = LANGUAGES[(LANGUAGES.indexOf(language) + 1) % LANGUAGES.length]!;
  const dirty = (view: View) => view === 'profiles' ? unsaved.profiles : view === 'settings' ? unsaved.connections || unsaved.machine : false;
  return <div className="flex h-full flex-col gap-1 px-2 py-3">
    <div className="mb-2 flex h-8 items-center gap-2 px-2">
      <span className="text-md font-semibold">{t('app.title')}</span>
      <span className="ml-auto truncate text-sm text-ink-2" title={t('appShell.project', { name: projectName })}>{projectName}</span>
    </div>
    <nav aria-label={t('nav.label')}>
      <ul className="flex flex-col gap-1">
        {items.map(({ view, icon: Icon }) => {
          const current = route.view === view, count = counts[view];
          return <li key={view}>
            <Link to={{ view }} navigate={navigate} aria-current={current ? 'page' : undefined}
              className={cn('flex h-8 items-center gap-2 rounded-sm px-2 font-medium', current ? 'bg-raised text-foreground' : 'text-ink-2 hover:bg-raised hover:text-foreground')}>
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{t(`nav.${view}`)}</span>
              {dirty(view) && <span className="size-1.5 shrink-0 rounded-full bg-trace" role="img" aria-label={t('settingsNav.unsaved')} />}
              {count !== undefined && <span className="text-sm font-normal tabular-nums text-ink-3">{count}</span>}
            </Link>
          </li>;
        })}
      </ul>
    </nav>
    <div className="sticky bottom-3 mt-auto grid gap-1 border-t px-2 pt-3 text-sm text-ink-2">
      <span role="status" aria-live="polite" className="flex h-7 min-w-0 items-center gap-1.5">
        <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', connected ? 'bg-reach' : 'bg-gave-up')} />
        <span className="truncate">{connected ? t('appShell.counts', { running, queued }) : t('appShell.disconnected')}</span>
      </span>
      {/* Both switches say what they are in words: an icon or `KO` alone was not recognised. */}
      {/* Two halves of the sidebar width, icons in line with the status dot above. */}
      <span className="-mx-2 grid grid-cols-2 gap-1">
        <Button variant="ghost" size="sm" className="justify-start" aria-label={themeLabel} title={themeLabel} onClick={cycle}><ThemeIcon aria-hidden="true" />{t(`topBar.themeShort.${preference}`)}</Button>
        <Button variant="ghost" size="sm" className="justify-start" aria-label={t('topBar.language', { current: LANGUAGE_NAMES[language] })} title={t('topBar.language', { current: LANGUAGE_NAMES[language] })} onClick={() => setLanguage(nextLanguage)}>
          <Languages aria-hidden="true" /><span lang={language}>{LANGUAGE_NAMES[language]}</span>
        </Button>
      </span>
    </div>
  </div>;
}
