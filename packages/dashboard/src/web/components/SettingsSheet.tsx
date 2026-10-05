import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ModelsPage } from '../pages/ModelsPage';
import { MachinePage } from '../pages/MachinePage';
import { ProfilesPage } from '../pages/ProfilesPage';
import type { ConfigView } from '../../shared/config';
import type { PageProps } from '../pages/types';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

type Props = { open: boolean; onOpenChange: (open: boolean) => void; pageProps: PageProps; banner: ReactNode; editorKey: number };

/** Right-hand sheet with models, run profiles and this computer's settings. All tabs stay mounted so drafts survive switching. */
export function SettingsSheet({ open, onOpenChange, pageProps, banner, editorKey }: Props) {
  const { t } = useTranslation();
  // Capabilities of a screen reader backend that was picked but not saved yet; shown while editing profile permissions.
  const [pending, setPending] = useState<ConfigView['capabilities']>();
  const capabilities = pending ?? pageProps.view.capabilities;
  return <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent side="right" className="w-full overflow-y-auto data-[side=right]:sm:max-w-4xl">
      <SheetHeader>
        <SheetTitle>{t('settings.title')}</SheetTitle>
        <SheetDescription>{t('settings.description')}</SheetDescription>
      </SheetHeader>
      <div className="grid gap-4 px-4 pb-6">
        {banner}
        <Tabs defaultValue="models">
          <TabsList aria-label={t('settings.tabsLabel')}>
            <TabsTrigger value="models">{t('settingsSheet.tabModels')}</TabsTrigger>
            <TabsTrigger value="profiles">{t('settingsSheet.tabProfiles')}</TabsTrigger>
            <TabsTrigger value="machine">{t('settingsSheet.tabMachine')}</TabsTrigger>
          </TabsList>
          <TabsContent value="models" forceMount className="pt-6 data-[state=inactive]:hidden"><ModelsPage key={editorKey} {...pageProps} /></TabsContent>
          <TabsContent value="profiles" forceMount className="pt-6 data-[state=inactive]:hidden"><ProfilesPage key={editorKey} {...pageProps} capabilities={capabilities} /></TabsContent>
          <TabsContent value="machine" forceMount className="pt-6 data-[state=inactive]:hidden"><MachinePage key={editorKey} {...pageProps} onCapabilities={setPending} /></TabsContent>
        </Tabs>
      </div>
    </SheetContent>
  </Sheet>;
}
