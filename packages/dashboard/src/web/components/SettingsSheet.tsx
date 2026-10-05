import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ModelsPage } from '../pages/ModelsPage';
import { SettingsPage } from '../pages/SettingsPage';
import type { PageProps } from '../pages/types';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

type Props = { open: boolean; onOpenChange: (open: boolean) => void; pageProps: PageProps; banner: ReactNode; editorKey: number };

/** Right-hand sheet with the model connections and global settings pages. Both tabs stay mounted so drafts survive switching. */
export function SettingsSheet({ open, onOpenChange, pageProps, banner, editorKey }: Props) {
  const { t } = useTranslation();
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
            <TabsTrigger value="globals">{t('settingsSheet.tabRun')}</TabsTrigger>
          </TabsList>
          <TabsContent value="models" forceMount className="pt-6 data-[state=inactive]:hidden"><ModelsPage key={editorKey} {...pageProps} /></TabsContent>
          <TabsContent value="globals" forceMount className="pt-6 data-[state=inactive]:hidden"><SettingsPage key={editorKey} {...pageProps} /></TabsContent>
        </Tabs>
      </div>
    </SheetContent>
  </Sheet>;
}
