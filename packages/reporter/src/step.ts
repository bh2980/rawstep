import type { StepRecord, TraceSession } from "@rawstep/core";
import { escapeHtml, formatAction, toReportImagePath } from "./utils";

export function renderStep(step: StepRecord): string {
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
  const rationaleHtml = step.decision.rationale
    ? `<p>${escapeHtml(step.decision.rationale)}</p>`
    : "";
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
        ${rationaleHtml}
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

export function renderActionCounts(actionCounts: TraceSession["aggregate"]["actionCounts"]): string {
  return `<ul>
    <li><code>srCommandCount</code>: ${actionCounts.srCommandCount}</li>
    <li><code>rawKeyCount</code>: ${actionCounts.rawKeyCount}</li>
    <li><code>typeTextCount</code>: ${actionCounts.typeTextCount}</li>
  </ul>`;
}

export function renderExperienceSummary(experienceSummary: NonNullable<TraceSession["experienceSummary"]>): string {
  const nextChecks = experienceSummary.nextChecks.length > 0
    ? `<ul>${experienceSummary.nextChecks.map((check) => `<li>${escapeHtml(check)}</li>`).join("")}</ul>`
    : "<p>No follow-up checks suggested.</p>";

  return `<section>
    <h2>Experience summary</h2>
    <p>${escapeHtml(experienceSummary.overall)}</p>
    <p><strong>Biggest friction:</strong> ${escapeHtml(experienceSummary.biggestFriction)}</p>
    <div><strong>Next checks</strong>${nextChecks}</div>
  </section>`;
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
  const agentVerdict = verdictAnalysis.agentVerdict ?? "not-declared";
  return `<ul>
    <li>Agent verdict: <code>${escapeHtml(agentVerdict)}</code></li>
    <li>Verification result: <code>${escapeHtml(verdictAnalysis.verificationResult)}</code></li>
    <li>Final result at this step: <code>${escapeHtml(verdictAnalysis.finalResult)}</code></li>
    <li>Completion source: <code>${escapeHtml(verdictAnalysis.completionSource)}</code></li>
  </ul>`;
}
