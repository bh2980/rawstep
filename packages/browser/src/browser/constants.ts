import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';

export const DEFAULT_VIEWPORT = {
  w: RAWSTEP_DEFAULTS.viewport.width,
  h: RAWSTEP_DEFAULTS.viewport.height
} as const;

export const SETTLE_MS = RAWSTEP_DEFAULTS.settleMs;
