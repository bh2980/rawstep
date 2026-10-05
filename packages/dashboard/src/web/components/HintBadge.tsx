import { Badge } from './ui/badge';
import { hintKindLabel } from '../i18n/ko';

export function HintBadge({ kind, count }: { kind: string; count?: number }) {
  return <Badge variant="outline" className="max-w-full">
    <span className="truncate">{hintKindLabel(kind)}</span>
    {count !== undefined && count > 0 && <span className="tabular-nums text-muted-foreground">{count}</span>}
  </Badge>;
}
