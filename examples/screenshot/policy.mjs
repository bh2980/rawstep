import { ScreenshotDecisionPolicy, HttpScreenshotModel } from 'rawstep/screenshot';

// Start the separately installed local model server first. No model is downloaded
// or executed automatically by importing RawStep. This is an actual inference adapter.
export default new ScreenshotDecisionPolicy({
  model: new HttpScreenshotModel({ endpoint: process.env.RAWSTEP_MODEL_ENDPOINT ?? 'http://127.0.0.1:8765/choose', timeoutMs: 120_000 }),
  maxStateVisits: 5,
  maxUnchangedTransitions: 4,
  historyLimit: 12,
});
