import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export type ReadTaskFileResult = {
  absoluteTaskFile: string;
  raw: unknown;
};

export async function readTaskFile(taskFile: string): Promise<ReadTaskFileResult> {
  const absoluteTaskFile = resolve(taskFile);
  const raw = await readFile(absoluteTaskFile, "utf8");

  try {
    return {
      absoluteTaskFile,
      raw: JSON.parse(raw) as unknown
    };
  } catch (error) {
    throw new Error(
      `Task file ${absoluteTaskFile} must be valid JSON. ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export function resolveTaskUrl(rawUrl: string, taskFile: string): string {
  if (/^https?:\/\//.test(rawUrl) || rawUrl.startsWith("file://")) {
    return rawUrl;
  }

  const absolutePath = resolve(dirname(taskFile), rawUrl);
  return pathToFileURL(absolutePath).toString();
}
