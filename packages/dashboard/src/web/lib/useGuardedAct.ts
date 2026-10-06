import { useState } from 'react';
import { describeApiError, type ErrorView } from './errors';

/**
 * Runs work through the page-level `act` (busy flag + refresh) but keeps the failure inside the dialog, where the user can see it.
 * The failure is told by its kind (a setting that cannot be used, a lost connection), not as one alert for everything.
 */
export function useGuardedAct(act: (work: () => Promise<unknown>) => Promise<void>) {
  const [error, setError] = useState<ErrorView>();
  async function run(work: () => Promise<unknown>): Promise<boolean> {
    let ok = false;
    setError(undefined);
    await act(async () => { try { await work(); ok = true; } catch (e) { setError(describeApiError(e, 'setup')); } });
    return ok;
  }
  return { error, setError, run };
}
