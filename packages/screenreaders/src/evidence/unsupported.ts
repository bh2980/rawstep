import { RawstepError } from '@rawstep/core/errors';
import type { CorpusSpeechResult } from './learned.js';
export class UnsupportedCorpusPatternError extends RawstepError {
  constructor(readonly result:CorpusSpeechResult){super('unsupported-pattern',result.reason??'No supported corpus wording pattern.',{outcome:{status:'inconclusive',reason:'unsupported-pattern'}});this.name='UnsupportedCorpusPatternError';}
}
