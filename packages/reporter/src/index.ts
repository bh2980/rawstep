import type { TraceSession } from "@rawstep/definition";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { renderHtml } from "./html";

export type PublishedRunOutputs = {
  outputPaths: {
    traceJsonl: string;
    traceJson: string;
    metricsJson: string;
    promptsJson: string;
    reportHtml: string;
  };
  reportPath: string;
  summaryText: string;
};

export async function renderReport(session: TraceSession, outDir: string): Promise<string> {
  const reportDir = join(outDir, "report");
  const reportPath = join(reportDir, "index.html");

  await mkdir(reportDir, { recursive: true });
  await writeFile(reportPath, renderHtml(session), "utf8");

  return reportPath;
}

export async function publishRunOutputs(
  session: TraceSession,
  outDir: string,
  promptLog?: unknown[]
): Promise<PublishedRunOutputs> {
  await mkdir(outDir, { recursive: true });

  const reportStartedAt = Date.now();
  let reportPath = await renderReport(session, outDir);
  session.aggregate.timings.reportMs = Date.now() - reportStartedAt;

  const outputPaths = {
    traceJsonl: resolve(outDir, "trace.jsonl"),
    traceJson: resolve(outDir, "trace.json"),
    metricsJson: resolve(outDir, "metrics.json"),
    promptsJson: resolve(outDir, "prompts.json"),
    reportHtml: reportPath
  };

  await writeFile(outputPaths.traceJson, JSON.stringify(session, null, 2), "utf8");
  await writeFile(outputPaths.metricsJson, JSON.stringify(session.aggregate, null, 2), "utf8");
  await writeFile(outputPaths.promptsJson, JSON.stringify(promptLog ?? [], null, 2), "utf8");

  reportPath = await renderReport(session, outDir);
  outputPaths.reportHtml = reportPath;

  return {
    outputPaths,
    reportPath,
    summaryText: [
      `Task ${session.task.id} finished with ${session.aggregate.endedBy}.`,
      `Result: ${session.aggregate.result}.`,
      "Outputs:",
      `- ${outputPaths.traceJsonl}`,
      `- ${outputPaths.metricsJson}`,
      `- ${outputPaths.promptsJson}`,
      `- ${outputPaths.reportHtml}`
    ].join("\n")
  };
}
