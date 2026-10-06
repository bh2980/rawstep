import type { PageEnvironment } from '@rawstep/project/config';
import { cn } from '../../lib/utils';
import { EnvironmentFields } from '../EnvironmentFields';

type Props = { environment: PageEnvironment; onChange: (e: PageEnvironment) => void; presets: Record<string, unknown>; compact?: boolean };

/** A page environment: a built-in preset or the screen size, text scale and colour settings a run's page gets. */
export function PageEnvironmentEditor({ environment, onChange, presets, compact }: Props) {
  return <div className={cn('min-w-0', compact && 'text-sm')}>
    <EnvironmentFields key={environment.id} value={environment.profile} onChange={profile => onChange({ ...environment, profile })} presets={presets} id={environment.id} />
  </div>;
}
