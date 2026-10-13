import { useTranslation } from 'react-i18next';
import { roleLabel } from '../../i18n/labels';
import { cn } from '../../lib/utils';

type Props = {
  /** The accessibility role as recorded (`button`, `dialog`); shown as a small label above the name. */
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
 * (`버튼` over `결제하기`).
 */
export function ElementIdentity({ role, name, fallback, weight = 'strong', className }: Props) {
  const { t } = useTranslation();
  const shownName = name || (role ? t('trace.unnamed') : fallback ?? t('trace.wholePage'));
  return <span className={cn('grid min-w-0 gap-0.5', className)}>
    {role && <span className="text-xs leading-4 text-muted-foreground">{roleLabel(role)}</span>}
    <span className={cn('break-words', weight === 'strong' ? 'font-semibold' : 'font-medium', !name && role && 'text-muted-foreground')}>{shownName}</span>
  </span>;
}
