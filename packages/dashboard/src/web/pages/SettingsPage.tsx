import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/layout/PageHeader';
import { Link } from '../components/Link';
import { sections, type RouteChange, type Section } from '../hooks/useRoute';
import type { ConfigView } from '../../shared/config';
import { cn } from '../lib/utils';
import { MachinePage } from './MachinePage';
import { ModelsPage } from './ModelsPage';
import { ProfilesPage } from './ProfilesPage';
import type { PageProps } from './types';

type Props = { pageProps: PageProps; section: Section; navigate: (change: RouteChange) => void; editorKey: number };

/**
 * Settings as a page with its own side menu: models, run profiles and this computer.
 * The sections stay mounted and only the current one is shown, so a draft survives a visit to another section.
 */
export function SettingsPage({ pageProps, section, navigate, editorKey }: Props) {
  const { t } = useTranslation();
  // Capabilities of a screen reader backend that was picked but not saved yet; shown while editing profile actions.
  const [pending, setPending] = useState<ConfigView['capabilities']>();
  const capabilities = pending ?? pageProps.view.capabilities;
  return <div className="grid gap-4">
    <PageHeader title={t('settings.title')} description={t('settings.description')} />
    <div className="grid items-start gap-8 md:grid-cols-[12rem_minmax(0,1fr)]">
      <nav aria-label={t('settings.menuLabel')} className="flex gap-1 md:flex-col md:gap-0 md:border-y md:border-edge-strong">
        {sections.map(id => <Link key={id} to={{ view: 'settings', section: id }} navigate={navigate} aria-current={section === id ? 'page' : undefined}
          data-selected={section === id} className={cn('row-rail rail-divider grid min-h-11 content-center py-2 pr-3 pl-4 md:border-b md:border-edge md:last:border-b-0', section === id ? 'bg-trace-soft font-medium' : 'text-muted-foreground hover:bg-raised')}>
          <span className="text-sm">{t(`settings.sections.${id}.name`)}</span>
          <span className="hidden text-xs font-normal text-muted-foreground md:block">{t(`settings.sections.${id}.hint`)}</span>
        </Link>)}
      </nav>
      <div className="min-w-0">
        <section hidden={section !== 'models'} aria-label={t('settings.sections.models.name')}><ModelsPage key={editorKey} {...pageProps} /></section>
        <section hidden={section !== 'profiles'} aria-label={t('settings.sections.profiles.name')}><ProfilesPage key={editorKey} {...pageProps} capabilities={capabilities} /></section>
        <section hidden={section !== 'machine'} aria-label={t('settings.sections.machine.name')}><MachinePage key={editorKey} {...pageProps} onCapabilities={setPending} /></section>
      </div>
    </div>
  </div>;
}
