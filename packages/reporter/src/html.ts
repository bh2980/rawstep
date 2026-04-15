import type { TraceSession } from "@rawstep/definition";
import { renderActionCounts, renderExperienceSummary, renderStep } from "./step";
import { escapeHtml } from "./utils";

export function renderHtml(session: TraceSession): string {
  const stepCards = session.steps.map((step) => renderStep(step)).join("\n");
  const actionCounts = renderActionCounts(session.aggregate.actionCounts);
  const experienceSummaryHtml = session.experienceSummary
    ? renderExperienceSummary(session.experienceSummary)
    : "";
  const failureHtml = session.aggregate.failurePoint
    ? `<p class="failure">Failure point: step ${session.aggregate.failurePoint.stepIndex} - ${escapeHtml(session.aggregate.failurePoint.reason)}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>rawstep report - ${escapeHtml(session.task.id)}</title>
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
        <h1>rawstep report</h1>
        <p><strong>${escapeHtml(session.task.id)}</strong> - ${escapeHtml(session.task.goal)}</p>
        <p>Result: <code>${escapeHtml(session.aggregate.result)}</code>. Ended by <code>${escapeHtml(session.aggregate.endedBy)}</code>.</p>
        ${failureHtml}
        ${experienceSummaryHtml}
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
            <span class="label">Screen reader init</span>
            <span class="value">${session.aggregate.timings.screenReaderInitMs} ms</span>
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
