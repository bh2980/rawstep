import { defaultProfile, type Connection, type Profile } from '@rawstep/project/config';

/** A connection with the defaults tests do not care about: a decision server on this computer unless `extra` says otherwise. Only custom connections carry an address. */
export const connection = (id: string, extra: Partial<Connection> = {}): Connection => {
  const base = { id, name: id, kind: 'decision' as const, provider: 'custom' as const, timeoutMs: 10000, ...extra };
  return base.provider === 'custom' ? { baseURL: 'http://127.0.0.1:1234', ...base } : base;
};
/** Instructions tests give executors unless they care about the wording. */
export const instructions = 'Executor fixture instructions.';
/** A run profile whose executor is `modelId` on `connectionId`, with no planner yet (see `plannedWith`). */
export const profileWith = (id: string, connectionId: string, modelId = 'm-' + connectionId, name = id): Profile =>
  ({ ...defaultProfile(id, name), executor: { connectionId, modelId, maxChoices: 255, historyLimit: 12, latitude: 'none', instructions } });
/** The same profile planning with `plannerModelId` on the LLM connection `plannerConnectionId`. */
export const plannedWith = (profile: Profile, plannerConnectionId: string, plannerModelId = 'planner', plannerInstructions = ''): Profile =>
  ({ ...profile, planner: { connectionId: plannerConnectionId, modelId: plannerModelId, instructions: plannerInstructions } });
