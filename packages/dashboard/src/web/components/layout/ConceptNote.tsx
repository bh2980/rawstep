import { useState, useSyncExternalStore } from 'react';
import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { dismissConcept, readDismissed, subscribeConcepts, type Concept } from '../../lib/concepts';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';

/**
 * One sentence about a concept, the first time it appears (spec §38). It can be dismissed and then stays away; there is no tour.
 * The note is plain text in the page, so a screen reader meets it in reading order.
 */
export function ConceptNote({ concept, className }: { concept: Concept; className?: string }) {
  const { t } = useTranslation();
  // Stored dismissals are shared by every note on the page; `closed` covers a browser that would not keep the choice.
  const stored = useSyncExternalStore(subscribeConcepts, () => readDismissed().join(','), () => '');
  const [closed, setClosed] = useState(false);
  if (closed || stored.split(',').includes(concept)) return null;
  return <aside aria-label={t(`concepts.${concept}.term`)} className={cn('flex flex-wrap items-start gap-x-3 gap-y-1.5 border-l-2 border-trace bg-trace-soft py-2 pr-3 pl-3', className)}>
    <Info aria-hidden="true" className="mt-1 size-4 shrink-0 text-trace" />
    <p className="min-w-0 flex-1 text-sm leading-6"><strong className="font-semibold">{t(`concepts.${concept}.term`)}</strong> {t(`concepts.${concept}.text`)}</p>
    <Button type="button" variant="ghost" size="sm" className="text-trace" onClick={() => { setClosed(true); dismissConcept(concept); }}>{t('concepts.dismiss')}</Button>
  </aside>;
}
