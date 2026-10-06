import { ChevronDown } from 'lucide-react';
import { Button } from '../ui/button';
import { CollapsibleTrigger } from '../ui/collapsible';

/** The trigger line of a collapsible: a label and a chevron that turns when it is open. */
export function Disclosure({ label }: { label: string }) {
  return <CollapsibleTrigger asChild>
    <Button type="button" variant="ghost" size="sm" className="group/disclosure -ml-2 justify-self-start text-sm text-muted-foreground">
      <ChevronDown aria-hidden="true" className="transition-transform group-aria-expanded/disclosure:rotate-180" />{label}
    </Button>
  </CollapsibleTrigger>;
}
