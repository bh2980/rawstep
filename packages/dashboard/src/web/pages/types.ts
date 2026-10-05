import type { ConfigView, DashboardConfig } from '../../shared/config';
export type PageProps = { view: ConfigView; save: (config: DashboardConfig, taskWrite?: { file: string; task: unknown }, revision?: string) => Promise<ConfigView>; act: (work: () => Promise<unknown>) => Promise<void>; busy: boolean };
