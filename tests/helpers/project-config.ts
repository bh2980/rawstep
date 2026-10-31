import { defaultProfile, type Connection, type Profile } from '@rawstep/project/config';

/** A connection with the defaults tests do not care about: an LLM server on this computer unless `extra` says otherwise. Only custom connections carry an address. */
export const connection = (id: string, extra: Partial<Connection> = {}): Connection => {
  const base = { id, name: id, provider: 'custom' as const, timeoutMs: 10000, ...extra };
  return base.provider === 'custom' ? { baseURL: 'http://127.0.0.1:1234', ...base } : base;
};
/** A run profile that plans with `modelId` on the LLM connection `connectionId`: every run needs a planner. */
export const profileWith = (id: string, connectionId: string, modelId = 'planner', name = id, plannerInstructions = ''): Profile =>
  ({ ...defaultProfile(id, name), planner: { connectionId, modelId, instructions: plannerInstructions } });
