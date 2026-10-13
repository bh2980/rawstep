import { defaultProfile, type Connection, type Profile } from '@rawstep/project/config';

/** A connection with the defaults tests do not care about: a decision server on this computer unless `extra` says otherwise. Only custom connections carry an address. */
export const connection = (id: string, extra: Partial<Connection> = {}): Connection => {
  const base = { id, name: id, kind: 'decision' as const, provider: 'custom' as const, timeoutMs: 10000, ...extra };
  return base.provider === 'custom' ? { baseURL: 'http://127.0.0.1:1234', ...base } : base;
};
/** Instructions tests give executors unless they care about the wording. */
export const instructions = { keyboard: 'Keyboard fixture instructions.', screenreader: 'Screen reader fixture instructions.' } as const;
/** A solo run profile whose executor in both modes is `modelId` on `connectionId`, taking text and images. */
export const profileWith = (id: string, connectionId: string, modelId = 'm-' + connectionId, name = id): Profile => {
  const model = { connectionId, modelId, inputs: ['text', 'image'] as ('text' | 'image')[], maxChoices: 255, maxImages: 2, historyLimit: 12, focusGate: false, latitude: 'none' as const };
  return { ...defaultProfile(id, name), executors: { keyboard: { ...model, instructions: instructions.keyboard }, screenreader: { ...model, instructions: instructions.screenreader } } };
};
/** The same profile planning with `plannerModelId` on the LLM connection `plannerConnectionId`. */
export const plannedWith = (profile: Profile, plannerConnectionId: string, plannerModelId = 'planner', plannerInstructions = ''): Profile =>
  ({ ...profile, structure: 'planned', planner: { connectionId: plannerConnectionId, modelId: plannerModelId, instructions: plannerInstructions } });
