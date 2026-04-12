import {
  DEFAULT_MAX_STEPS,
  DEFAULT_TIMEOUT_MS,
  type Task,
  type UserModel
} from "@a11y-task/core";
import { validateVerifySpec } from "@a11y-task/runner";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import YAML from "yaml";
import { type TaskFileShape, parseUserModel, validateTaskInput } from "./shared";

export async function loadTask(taskFile: string, overrideMode?: UserModel): Promise<Task> {
  const absoluteTaskFile = resolve(taskFile);
  const raw = await readFile(absoluteTaskFile, "utf8");
  const parsed = YAML.parse(raw) as TaskFileShape;

  if (!parsed.url || !parsed.goal) {
    throw new Error("Task file must include url and goal.");
  }

  const mode = parseUserModel(overrideMode ?? parsed.mode ?? "keyboard");

  return {
    id: parsed.id ?? stripFileExtension(basename(absoluteTaskFile)),
    url: resolveTaskUrl(parsed.url, absoluteTaskFile),
    goal: parsed.goal,
    mode,
    maxSteps: parsed.maxSteps ?? DEFAULT_MAX_STEPS,
    timeoutMs: parsed.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    verify: validateVerifySpec(parsed.verify),
    input: validateTaskInput(parsed.input)
  };
}

function resolveTaskUrl(rawUrl: string, taskFile: string): string {
  if (/^https?:\/\//.test(rawUrl) || rawUrl.startsWith("file://")) {
    return rawUrl;
  }

  const absolutePath = resolve(dirname(taskFile), rawUrl);
  return pathToFileURL(absolutePath).toString();
}

function stripFileExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}
