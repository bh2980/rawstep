import type { runTask } from "@rawstep/runtime";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function persistSessionArtifacts(
  session: Awaited<ReturnType<typeof runTask>>,
  outDir: string,
  promptLog?: unknown[]
): Promise<void> {
  await writeFile(resolve(outDir, "trace.json"), JSON.stringify(session, null, 2), "utf8");
  await writeFile(resolve(outDir, "metrics.json"), JSON.stringify(session.aggregate, null, 2), "utf8");
  await writeFile(resolve(outDir, "prompts.json"), JSON.stringify(promptLog ?? [], null, 2), "utf8");
}
