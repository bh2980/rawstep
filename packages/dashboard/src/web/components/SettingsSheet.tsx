import type { ReactNode } from 'react';
import { ko } from '../i18n/ko';
import { ModelsPage } from '../pages/ModelsPage';
import { SettingsPage } from '../pages/SettingsPage';
import type { PageProps } from '../pages/types';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

type Props = { open: boolean; onOpenChange: (open: boolean) => void; pageProps: PageProps; banner: ReactNode; editorKey: number };

/** Right-hand sheet with the model connections and global settings pages. Both tabs stay mounted so drafts survive switching. */
export function SettingsSheet({ open, onOpenChange, pageProps, banner, editorKey }: Props) {
  const tabs = ko.settings.tabs;
  return <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent side="right" className="w-full overflow-y-auto data-[side=right]:sm:max-w-4xl">
      <SheetHeader>
        <SheetTitle>{ko.settings.title}</SheetTitle>
        <SheetDescription>{ko.settings.description}</SheetDescription>
      </SheetHeader>
      <div className="grid gap-4 px-4 pb-6">
        {banner}
        <Tabs defaultValue="models">
          <TabsList aria-label={ko.settings.tabsLabel}>
            <TabsTrigger value="models">{tabs.models}</TabsTrigger>
            <TabsTrigger value="globals">{tabs.globals}</TabsTrigger>
          </TabsList>
          <TabsContent value="models" forceMount className="pt-6 data-[state=inactive]:hidden"><ModelsPage key={editorKey} {...pageProps} /></TabsContent>
          <TabsContent value="globals" forceMount className="pt-6 data-[state=inactive]:hidden"><SettingsPage key={editorKey} {...pageProps} /></TabsContent>
        </Tabs>
      </div>
    </SheetContent>
  </Sheet>;
}
