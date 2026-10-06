import type { ProjectConfig } from '@rawstep/project/config';
import type { ConfigView } from '../../shared/config';
export type PageProps = { view: ConfigView; save: (config: ProjectConfig, taskWrite?: { file: string; task: unknown }, revision?: string) => Promise<ConfigView>; act: (work: () => Promise<unknown>) => Promise<void>; busy: boolean };
import type { TaskSummary } from '../../shared/api';
import type { RouteChange } from '../hooks/useRoute';
import type { RunRef } from '../lib/runs';

/** What the home, task list and run list pages share: the project, every run and the per-task summaries. */
export type ListProps = {
  pageProps: PageProps; runs: RunRef[]; summaries: TaskSummary[]; summaryError: string;
  navigate: (change: RouteChange) => void;
};
