import { RawstepError } from '@rawstep/core/errors';
import type { CorpusSpeechResult } from './learned.js';
export class UnsupportedCorpusPatternError extends RawstepError {
  static override readonly errorName = 'UnsupportedCorpusPatternError';
  constructor(readonly result:CorpusSpeechResult){super('unsupported-pattern',result.reason??'No supported corpus wording pattern.',{outcome:{status:'inconclusive',reason:'unsupported-pattern'}});this.name='UnsupportedCorpusPatternError';}
}
