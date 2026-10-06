import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';

type Props = { position: number; total: number; hasPrevious: boolean; hasNext: boolean; onPrevious: () => void; onNext: () => void };

/** The small sticky control for narrow screens: `← 이전  17 / 43  다음 →`. Wide screens use the rail's arrow keys instead. */
export function StepPager({ position, total, hasPrevious, hasNext, onPrevious, onNext }: Props) {
  const { t } = useTranslation();
  return <nav aria-label={t('pager.label')} className="sticky bottom-0 z-10 -mx-4 flex items-center justify-between gap-3 border-t bg-card px-4 py-2 lg:hidden">
    <Button variant="outline" size="lg" disabled={!hasPrevious} onClick={onPrevious}><ArrowLeft aria-hidden="true" />{t('pager.previous')}</Button>
    <span className="font-mono text-sm tabular-nums">{t('pager.position', { n: position, total })}</span>
    <Button variant="outline" size="lg" disabled={!hasNext} onClick={onNext}>{t('pager.next')}<ArrowRight aria-hidden="true" /></Button>
  </nav>;
}
