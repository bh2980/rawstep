import { defaultProfile, type Connection, type RunProfile } from '@rawstep/project/config';

/** A connection with the defaults tests do not care about: a decision server on this computer unless `extra` says otherwise. Only custom connections carry an address. */
export const connection = (id: string, extra: Partial<Connection> = {}): Connection => {
  const base = { id, name: id, kind: 'decision' as const, provider: 'custom' as const, timeoutMs: 10000, ...extra };
  return base.provider === 'custom' ? { baseURL: 'http://127.0.0.1:1234', ...base } : base;
};
/** A run profile that decides with `modelId` on `connectionId`, taking text and images. */
export const profileWith = (id: string, connectionId: string, modelId = 'm-' + connectionId, name = id): RunProfile => ({ ...defaultProfile(id, name), model: { connectionId, modelId, inputs: ['text', 'image'], maxChoices: 255, maxImages: 2 } });
