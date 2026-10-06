import type { ProjectConfig } from '@rawstep/project/config';
import type { ConfigView } from '../../shared/config';
/**
 * What every page gets: the project, `save` (writes the config, and a task file when given, against a revision), `act` (runs work with the
 * busy flag and refreshes afterwards; `as` says what kind of trouble a failure is) and `notify` (a one-line notice that is not an error).
 */
export type PageProps = {
  view: ConfigView; save: (config: ProjectConfig, taskWrite?: { file: string; task: unknown }, revision?: string) => Promise<ConfigView>;
  act: (work: () => Promise<unknown>, options?: { as?: ErrorKind }) => Promise<void>; busy: boolean; notify: (message: string) => void;
};
import type { TaskSummary } from '../../shared/api';
import type { RouteChange } from '../hooks/useRoute';
import type { ErrorKind } from '../lib/errors';
import type { RunRef } from '../lib/runs';

/** What the home, task list and run list pages share: the project, every run and the per-task summaries. */
export type ListProps = {
  pageProps: PageProps; runs: RunRef[]; summaries: TaskSummary[]; summaryError: string;
  navigate: (change: RouteChange) => void;
};
