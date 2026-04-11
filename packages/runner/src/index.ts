import { Actuator, NotAllowedKeyError } from "@a11y-task/actuator";
import { LLMAgent, type LLMAgentOptions } from "@a11y-task/agent";
import { closeBrowserSession, createBrowserSession, settlePage } from "@a11y-task/browser";
import {
  ALLOWED_KEYS,
  HISTORY_WINDOW,
  type Agent,
  type EndedBy,
  type Task,
  type TraceSession
} from "@a11y-task/core";
import { KeyboardObserver } from "@a11y-task/observer-keyboard";
import { TraceRecorder } from "@a11y-task/trace";

export type RunTaskOptions = {
  outDir: string;
  agent?: Agent;
  agentOptions?: LLMAgentOptions;
};

export async function runTask(task: Task, options: RunTaskOptions): Promise<TraceSession> {
  if (task.mode !== "keyboard") {
    throw new Error("screenreader mode is planned for v2. Use --mode keyboard in v1.");
  }

  const trace = new TraceRecorder(task, options.outDir);
  await trace.initialize();

  const browser = await createBrowserSession(task.url);
  const observer = new KeyboardObserver(browser.page);
  const actuator = new Actuator(browser.page);
  const agent = options.agent ?? new LLMAgent(task.mode, options.agentOptions);

  const deadline = Date.now() + task.timeoutMs;
  let endedBy: EndedBy | undefined;
  let session: TraceSession | undefined;
  let unexpectedError: unknown;

  try {
    for (let step = 0; step < task.maxSteps; step += 1) {
      if (Date.now() >= deadline) {
        endedBy = "timeout";
        break;
      }

      const observation = await observer.observe();
      const context = {
        goal: task.goal,
        allowedKeys: ALLOWED_KEYS,
        history: trace.recentDecisions(HISTORY_WINDOW)
      };
      const decision = await agent.decide(context, observation);

      if ("verdict" in decision) {
        await trace.append(step, observation, decision, { ok: true, costDelta: 0 });
        endedBy = decision.verdict;
        break;
      }

      try {
        await actuator.press(decision.action.key);
        await trace.append(step, observation, decision, { ok: true, costDelta: 1 });
      } catch (error) {
        const message = getErrorMessage(error);
        await trace.append(step, observation, decision, {
          ok: false,
          error: message,
          costDelta: 0
        });

        if (error instanceof NotAllowedKeyError) {
          endedBy = "error";
          break;
        }

        throw error;
      }

      await settlePage(browser.page);
    }

    if (!endedBy) {
      endedBy = "maxSteps";
    }
  } catch (error) {
    unexpectedError = error;
    endedBy = endedBy ?? "error";
  } finally {
    await closeBrowserSession(browser);
    session = await trace.finalize(endedBy ?? "error", actuator.keyCounts);
  }

  if (unexpectedError) {
    throw unexpectedError;
  }

  return session!;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
