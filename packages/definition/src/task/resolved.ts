import type { UserModel } from "../modes";
import type { VerifySpec } from "../verify";
import type { TaskInput, TaskPrompt } from "./source";

export type ResolvedTask = {
  id: string;
  url: string;
  goal: string;
  prompt?: TaskPrompt;
  mode: UserModel;
  maxSteps: number;
  timeoutMs: number;
  verify: VerifySpec;
  input?: TaskInput;
};
