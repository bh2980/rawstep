import type { TraceSession } from "@a11y-task/core";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderHtml } from "./html";

export async function renderReport(session: TraceSession, outDir: string): Promise<string> {
  const reportDir = join(outDir, "report");
  const reportPath = join(reportDir, "index.html");

  await mkdir(reportDir, { recursive: true });
  await writeFile(reportPath, renderHtml(session), "utf8");

  return reportPath;
}
