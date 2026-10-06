import { Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Mode } from '@rawstep/project/config';
import { Button } from './ui/button';

/** Run buttons that say their mode: one per mode, so a run never starts in a mode nobody picked. */
export function RunModeButtons({ name, disabled, onRun }: { name: string; disabled?: boolean; onRun: (mode: Mode) => void }) {
  const { t } = useTranslation();
  return <span className="inline-flex gap-1.5">
    {(['keyboard', 'screenreader'] as const).map(mode => <Button key={mode} type="button" variant="outline" size="sm" className="h-7" disabled={disabled}
      aria-label={t('taskList.runModeLabel', { name, mode: t(`sidebar.modes.${mode}`) })} onClick={() => onRun(mode)}>
      <Play aria-hidden="true" />{t(`sidebar.modes.${mode}`)}
    </Button>)}
  </span>;
}
