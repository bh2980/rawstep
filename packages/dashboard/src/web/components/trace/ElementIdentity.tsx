import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';

type Props = {
  /** The accessibility role as recorded (`button`, `dialog`); shown as a small-caps label. */
  role?: string | undefined;
  /** The accessible name. */
  name?: string | undefined;
  /** What to call an element that has neither, e.g. the whole page. */
  fallback?: string;
  /** `strong` for evidence about the page, `regular` for the model's behaviour. */
  weight?: 'strong' | 'regular';
  className?: string;
};

/**
 * The unit of analysis: the page element a person meets, as its role and accessible name together
 * (`BUTTON / 결제하기`). The role is plain text in the DOM, only drawn in capitals, so it reads the same to a screen reader.
 */
export function ElementIdentity({ role, name, fallback, weight = 'strong', className }: Props) {
  const { t } = useTranslation();
  const shownName = name || (role ? t('trace.unnamed') : fallback ?? t('trace.wholePage'));
  return <span className={cn('grid min-w-0 gap-0.5', className)}>
    {role && <span lang="en" className="text-[11px] leading-4 font-medium tracking-[0.08em] text-muted-foreground uppercase">{role}</span>}
    <span className={cn('break-words', weight === 'strong' ? 'font-semibold' : 'font-medium', !name && role && 'text-muted-foreground')}>{shownName}</span>
  </span>;
}
