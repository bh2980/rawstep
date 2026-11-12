/**
 * The dashboard runs batches with the project's queue, the same one `rawstep run` and `rawstep suite` use, so either shows what the
 * other ran.
 */
export { BATCHES_DIR, BatchQueue as ExperimentQueue, failureDetail, publicOutcome, type Executor } from '@rawstep/project/batch';
