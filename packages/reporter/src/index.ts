import type { TraceSession } from "@rawstep/definition";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { renderHtml } from "./html";

export type PublishedRunOutputs = {
  outputPaths: {
    traceJsonl: string;
    diagnosticsJsonl?: string;
    promptsJsonl?: string;
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

  const outputPaths: PublishedRunOutputs["outputPaths"] = {
    traceJsonl: resolve(outDir, "trace.jsonl"),
    traceJson: resolve(outDir, "trace.json"),
    metricsJson: resolve(outDir, "metrics.json"),
    promptsJson: resolve(outDir, "prompts.json"),
    reportHtml: reportPath
  };
  const diagnosticsJsonlPath = resolve(outDir, "diagnostics.jsonl");
  try {
    await access(diagnosticsJsonlPath);
    outputPaths.diagnosticsJsonl = diagnosticsJsonlPath;
  } catch {
    // Diagnostics are written lazily and may not exist for a clean run.
  }
  const promptsJsonlPath = resolve(outDir, "prompts.jsonl");
  try {
    await access(promptsJsonlPath);
    outputPaths.promptsJsonl = promptsJsonlPath;
  } catch {
    // Prompt JSONL is written lazily and may not exist for synthetic tests.
  }

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
      ...(outputPaths.diagnosticsJsonl ? [`- ${outputPaths.diagnosticsJsonl}`] : []),
      ...(outputPaths.promptsJsonl ? [`- ${outputPaths.promptsJsonl}`] : []),
      `- ${outputPaths.metricsJson}`,
      `- ${outputPaths.promptsJson}`,
      `- ${outputPaths.reportHtml}`
    ].join("\n")
  };
}
