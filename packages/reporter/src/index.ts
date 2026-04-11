import type { Action, StepRecord, TraceSession } from "@a11y-task/core";
import { mkdir, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";

export async function renderReport(session: TraceSession, outDir: string): Promise<string> {
  const reportDir = join(outDir, "report");
  const reportPath = join(reportDir, "index.html");

  await mkdir(reportDir, { recursive: true });
  await writeFile(reportPath, renderHtml(session), "utf8");

  return reportPath;
}

function renderHtml(session: TraceSession): string {
  const stepCards = session.steps.map((step) => renderStep(step)).join("\n");
  const actionCounts = renderActionCounts(session.aggregate.actionCounts);
  const failureHtml = session.aggregate.failurePoint
    ? `<p class="failure">Failure point: step ${session.aggregate.failurePoint.stepIndex} - ${escapeHtml(session.aggregate.failurePoint.reason)}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>a11y-task report - ${escapeHtml(session.task.id)}</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "Iowan Old Style", "Palatino Linotype", serif;
        background: #f4efe6;
        color: #1f1b16;
      }
      body {
        margin: 0;
        padding: 32px;
        background:
          radial-gradient(circle at top left, rgba(201, 122, 72, 0.18), transparent 32%),
          linear-gradient(180deg, #f7f1e8 0%, #eee1cf 100%);
      }
      main {
        max-width: 1100px;
        margin: 0 auto;
      }
      h1, h2 {
        margin: 0 0 12px;
      }
      .hero, .step {
        background: rgba(255, 251, 246, 0.9);
        border: 1px solid rgba(65, 45, 21, 0.12);
        border-radius: 20px;
        box-shadow: 0 18px 45px rgba(76, 48, 20, 0.08);
      }
      .hero {
        padding: 24px;
        margin-bottom: 24px;
      }
      .summary {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
        margin-top: 16px;
      }
      .summary-card {
        background: #fff7ef;
        border-radius: 14px;
        padding: 14px;
      }
      .label {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #7a5d45;
      }
      .value {
        display: block;
        margin-top: 8px;
        font-size: 22px;
        font-weight: 700;
      }
      .steps {
        display: grid;
        gap: 18px;
      }
      .step {
        padding: 18px;
      }
      .step-grid {
        display: grid;
        gap: 18px;
        grid-template-columns: minmax(280px, 1fr) minmax(260px, 320px);
      }
      img {
        width: 100%;
        border-radius: 14px;
        border: 1px solid rgba(65, 45, 21, 0.12);
        background: #fff;
      }
      ul {
        padding-left: 18px;
      }
      code {
        font-family: "SFMono-Regular", "Menlo", monospace;
        background: rgba(65, 45, 21, 0.08);
        padding: 2px 6px;
        border-radius: 999px;
      }
      .failure {
        color: #9c321a;
        font-weight: 700;
      }
      @media (max-width: 820px) {
        body {
          padding: 16px;
        }
        .step-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <h1>a11y-task report</h1>
        <p><strong>${escapeHtml(session.task.id)}</strong> - ${escapeHtml(session.task.goal)}</p>
        <p>Result: <code>${escapeHtml(session.aggregate.result)}</code>. Ended by <code>${escapeHtml(session.aggregate.endedBy)}</code>.</p>
        ${failureHtml}
        <div class="summary">
          <div class="summary-card">
            <span class="label">Result</span>
            <span class="value">${escapeHtml(session.aggregate.result)}</span>
          </div>
          <div class="summary-card">
            <span class="label">Total steps</span>
            <span class="value">${session.aggregate.totalSteps}</span>
          </div>
          <div class="summary-card">
            <span class="label">Duration</span>
            <span class="value">${session.aggregate.durationMs} ms</span>
          </div>
          <div class="summary-card">
            <span class="label">Setup</span>
            <span class="value">${session.aggregate.timings.setupMs} ms</span>
          </div>
          <div class="summary-card">
            <span class="label">Browser launch</span>
            <span class="value">${session.aggregate.timings.browserLaunchMs} ms</span>
          </div>
          <div class="summary-card">
            <span class="label">Page load</span>
            <span class="value">${session.aggregate.timings.pageLoadMs} ms</span>
          </div>
          <div class="summary-card">
            <span class="label">VoiceOver init</span>
            <span class="value">${session.aggregate.timings.voiceOverInitMs} ms</span>
          </div>
          <div class="summary-card">
            <span class="label">First announcement wait</span>
            <span class="value">${session.aggregate.timings.firstAnnouncementWaitMs} ms</span>
          </div>
          <div class="summary-card">
            <span class="label">Report</span>
            <span class="value">${session.aggregate.timings.reportMs} ms</span>
          </div>
          <div class="summary-card">
            <span class="label">Terminated at step</span>
            <span class="value">${session.aggregate.terminatedAtStep ?? "-"}</span>
          </div>
          <div class="summary-card">
            <span class="label">Mode</span>
            <span class="value">${escapeHtml(session.task.mode)}</span>
          </div>
        </div>
        <h2>Action counts</h2>
        ${actionCounts}
      </section>
      <section class="steps">
        ${stepCards}
      </section>
    </main>
  </body>
</html>`;
}

function renderStep(step: StepRecord): string {
  const decision = "action" in step.decision
    ? `Action: <code>${escapeHtml(formatAction(step.decision.action))}</code>`
    : `Verdict: <code>${escapeHtml(step.decision.verdict)}</code>`;
  const screenshotHtml = "screenshot" in step.observation && step.observation.screenshot
    ? `<img src="${escapeHtml(toReportImagePath(step.observation.screenshot.path))}" alt="Step ${step.step} screenshot" />`
    : `<div>No screenshot</div>`;
  const observationHtml = step.observation.kind === "keyboard"
    ? `<ul>
        <li>Title: ${escapeHtml(step.observation.browserChrome.title)}</li>
        <li>URL path: ${escapeHtml(step.observation.browserChrome.urlPath)}</li>
        <li>Scroll hint: ${escapeHtml(step.observation.scrollHint ?? "top")}</li>
      </ul>`
    : `<ul>
        <li>Announcement: ${step.observation.announcement ? escapeHtml(step.observation.announcement) : "<em>none captured</em>"}</li>
        <li>Announcement capture: <code>${escapeHtml(step.observation.announcementCapture)}</code></li>
        <li>Announcement count: <code>${step.observation.announcementCount ?? 0}</code></li>
        <li>Observe reason: <code>${escapeHtml(step.observation.observeReason ?? "unknown")}</code></li>
      </ul>`;
  const executionHtml = step.execution.ok
    ? `Execution ok. Cost delta: <code>${step.execution.costDelta}</code>`
    : `Execution failed. Error: <code>${escapeHtml(step.execution.error ?? "unknown")}</code>`;
  const verificationHtml = step.verification
    ? renderVerification(step.verification)
    : "";
  const verdictAnalysisHtml = step.verdictAnalysis
    ? renderVerdictAnalysis(step.verdictAnalysis)
    : "";
  const timingsHtml = `<ul>
        <li>Observe: ${step.timings.observeMs} ms</li>
        <li>Decide: ${step.timings.decideMs} ms</li>
        <li>Execute: ${step.timings.executeMs} ms</li>
        <li>Verify: ${step.timings.verifyMs} ms</li>
      </ul>`;

  return `<article class="step">
    <h2>Step ${step.step}</h2>
    <div class="step-grid">
      <div>${screenshotHtml}</div>
      <div>
        <p>${decision}</p>
        <p>${escapeHtml(step.decision.rationale)}</p>
        ${observationHtml}
        <p>${executionHtml}</p>
        ${verdictAnalysisHtml}
        ${timingsHtml}
        ${verificationHtml}
        <p>Recorded at <code>${escapeHtml(step.timestamp)}</code></p>
      </div>
    </div>
  </article>`;
}

function formatAction(action: Action): string {
  if ("key" in action) {
    return action.key;
  }

  if ("srCommand" in action) {
    return `srCommand(${action.srCommand})`;
  }

  return "typeText(task)";
}

function renderActionCounts(actionCounts: TraceSession["aggregate"]["actionCounts"]): string {
  return `<ul>
    <li><code>srCommandCount</code>: ${actionCounts.srCommandCount}</li>
    <li><code>rawKeyCount</code>: ${actionCounts.rawKeyCount}</li>
    <li><code>typeTextCount</code>: ${actionCounts.typeTextCount}</li>
  </ul>`;
}

function toReportImagePath(relativeScreenshotPath: string): string {
  return posix.join("..", ...relativeScreenshotPath.split("/"));
}

function renderVerification(verification: NonNullable<StepRecord["verification"]>): string {
  const summary = verification.passed
    ? 'Verification: <code>passed</code>'
    : 'Verification: <code>failed</code>';

  const failures = verification.failures.length > 0
    ? `<ul>${verification.failures.map((failure) => `<li>${escapeHtml(failure)}</li>`).join("")}</ul>`
    : "";

  return `<div><p>${summary}</p>${failures}</div>`;
}

function renderVerdictAnalysis(verdictAnalysis: NonNullable<StepRecord["verdictAnalysis"]>): string {
  return `<ul>
    <li>Agent verdict: <code>${escapeHtml(verdictAnalysis.agentVerdict)}</code></li>
    <li>Verification result: <code>${escapeHtml(verdictAnalysis.verificationResult)}</code></li>
    <li>Final result at this step: <code>${escapeHtml(verdictAnalysis.finalResult)}</code></li>
  </ul>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
