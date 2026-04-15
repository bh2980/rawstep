import type { UserModel } from "../modes";
import type { VerifySpec } from "../verify";
import type { TaskInput } from "./source";

export type ResolvedTask = {
  id: string;
  url: string;
  goal: string;
  mode: UserModel;
  maxSteps: number;
  timeoutMs: number;
  verify: VerifySpec;
  input?: TaskInput;
};
