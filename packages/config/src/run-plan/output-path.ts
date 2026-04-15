import { join } from "node:path";

const RUN_ID_COUNTERS = new Map<string, number>();

export function buildRunOutputDir(outDirRoot: string, taskId: string, now = new Date()): string {
  return join(outDirRoot, taskId, createRunId(now));
}

function createRunId(now: Date): string {
  const baseRunId = formatLocalRunId(now);
  const nextCount = (RUN_ID_COUNTERS.get(baseRunId) ?? 0) + 1;
  RUN_ID_COUNTERS.set(baseRunId, nextCount);

  return nextCount === 1 ? baseRunId : `${baseRunId}-${nextCount}`;
}

function formatLocalRunId(now: Date): string {
  return [
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`,
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
    pad(now.getMilliseconds(), 3)
  ].join("-");
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}
