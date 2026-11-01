import { useEffect, useState } from 'react';
import { ChevronRight, History, ListChecks, Settings, UserRound, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_SETTINGS_SECTION, settingsSections, type Route, type RouteChange, type View } from '../hooks/useRoute';
import { cn } from '../lib/utils';
import type { Unsaved } from '../pages/types';
import { Link } from './Link';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';

type Props = { route: Route; navigate: (change: RouteChange) => void; unsaved?: Unsaved };

/** The pages with a link of their own, in order; 설정 follows them with its sub-menu. */
const items: { view: Exclude<View, 'settings'>; icon: LucideIcon }[] = [{ view: 'tasks', icon: ListChecks }, { view: 'profiles', icon: UserRound }, { view: 'runs', icon: History }];

const itemClass = (current: boolean) => cn('flex items-center justify-between gap-2 rounded-md px-3 text-sm', current ? 'bg-trace-soft font-medium text-foreground' : 'text-muted-foreground hover:bg-raised hover:text-foreground');

/** A small dot, with words for a screen reader, for a page with edits that are not saved. */
function UnsavedDot() {
  const { t } = useTranslation();
  return <span className="size-1.5 shrink-0 rounded-full bg-trace" role="img" aria-label={t('settingsNav.unsaved')} />;
}

const OPEN_KEY = 'rawstep.nav.settingsOpen';
/** Whether 설정 was left unfolded; storage may be blocked, and then it starts folded. */
function remembered(): boolean { try { return localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; } }
function remember(open: boolean) { try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch { /* the choice is only a convenience */ } }

/**
 * Left navigation: 작업 (the landing page), 실행 프로필, 실행 기록 and 설정, a folding button over AI 연결 and 이 컴퓨터. A page with
 * edits that are not saved carries a dot.
 */
export function AppNav({ route, navigate, unsaved = {} }: Props) {
  const { t } = useTranslation();
  const section = route.view === 'settings' ? route.section ?? DEFAULT_SETTINGS_SECTION : undefined;
  // Folded unless a settings page is open or it was left open; opening a settings page unfolds it.
  const [settingsOpen, setSettingsOpen] = useState(() => !!section || remembered());
  useEffect(() => { if (section) setSettingsOpen(true); }, [section]);
  return <nav aria-label={t('nav.label')} className="h-full px-2 py-3">
    <ul className="flex flex-col gap-0.5">
      {items.map(({ view, icon: Icon }) => {
        const current = route.view === view;
        return <li key={view}>
          <Link to={{ view }} navigate={navigate} aria-current={current ? 'page' : undefined} className={cn(itemClass(current), 'h-9')}>
            <span className="flex items-center gap-2.5"><Icon className="size-4 shrink-0" aria-hidden="true" />{t(`nav.${view}`)}</span>
            {view === 'profiles' && unsaved.profiles && <UnsavedDot />}
          </Link>
        </li>;
      })}
      <li>
        <Collapsible open={settingsOpen} onOpenChange={open => { setSettingsOpen(open); remember(open); }}>
          <CollapsibleTrigger className={cn(itemClass(false), 'group h-9 w-full')}>
            <span className="flex items-center gap-2.5"><Settings className="size-4 shrink-0" aria-hidden="true" />{t('nav.settings')}</span>
            <span className="flex items-center gap-2">
              {/* Folded, the menu still says that something under it is not saved. */}
              {!settingsOpen && settingsSections.some(id => unsaved[id]) && <UnsavedDot />}
              <ChevronRight className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" aria-hidden="true" />
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul aria-label={t('settingsNav.label')} className="mt-0.5 flex flex-col gap-0.5">
              {settingsSections.map(id => <li key={id}>
                <Link to={{ view: 'settings', section: id }} navigate={navigate} aria-current={id === section ? 'page' : undefined} className={cn(itemClass(id === section), 'h-8 pl-9')}>
                  {t(`settingsNav.sections.${id}`)}
                  {unsaved[id] && <UnsavedDot />}
                </Link>
              </li>)}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      </li>
    </ul>
  </nav>;
}
