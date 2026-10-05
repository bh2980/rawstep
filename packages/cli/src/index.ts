export { CLI_USAGE, CliUsageError, parseCliArguments, runCli } from './cli/index.js';
export type { CliDependencies } from './cli/index.js';
export { classifyRun, readMatrix, runEnvironmentMatrix, summarizeMatrixRow, taskFingerprint, validateHumanEvidence } from './matrix/index.js';
export type { FindingCategory, HumanTestEvidence, MatrixOptions, MatrixReport, MatrixRow } from './matrix/index.js';
