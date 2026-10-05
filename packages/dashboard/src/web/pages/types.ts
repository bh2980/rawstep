import type { ProjectConfig } from '@rawstep/project/config';
import type { ConfigView } from '../../shared/config';
export type PageProps = { view: ConfigView; save: (config: ProjectConfig, taskWrite?: { file: string; task: unknown }, revision?: string) => Promise<ConfigView>; act: (work: () => Promise<unknown>) => Promise<void>; busy: boolean };
