import { useState } from 'react';

/** Runs work through the page-level `act` (busy flag + refresh) but keeps the failure inside the dialog, where the user can see it. */
export function useGuardedAct(act: (work: () => Promise<unknown>) => Promise<void>) {
  const [error, setError] = useState('');
  async function run(work: () => Promise<unknown>): Promise<boolean> {
    let ok = false;
    setError('');
    await act(async () => { try { await work(); ok = true; } catch (e) { setError((e as Error).message); } });
    return ok;
  }
  return { error, setError, run };
}
