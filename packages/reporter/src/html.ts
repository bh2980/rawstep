import type { StepRecord, TraceSession } from "@rawstep/definition";
import { escapeHtml, formatAction, toReportImagePath } from "./utils";

type StepStatus =
  | "success"
  | "verified"
  | "verify-fail"
  | "failure"
  | "failure-point"
  | "error"
  | "stuck"
  | "normal";

type FilterKey = "all" | "important" | "verify-fail" | "failure-point" | "verdict";

type StepViewModel = {
  index: number;
  stepNumber: number;
  actionLabel: string;
  status: StepStatus;
  statusLabel: string;
  tone: "success" | "failure" | "warning" | "neutral";
  rationale: string;
  failureSummary: string | null;
  relativeLabel: string | null;
  isVerdict: boolean;
  isImportant: boolean;
  isVerifyFail: boolean;
  isFailurePoint: boolean;
  verificationPassed: boolean | null;
  verificationFailures: string[];
  screenshotPath: string | null;
  hasTimingDetails: boolean;
  timings: {
    observe: string;
    decide: string;
    execute: string;
    verify: string;
    decideMs: number;
  };
  observation:
    | {
        kind: "keyboard";
        title: string;
        urlPath: string;
        focusHint: string | null;
        scrollHint: string | null;
      }
    | {
        kind: "screenreader";
        announcement: string | null;
        capture: string;
        count: string | null;
        reason: string | null;
      };
};

type ReportModel = {
  task: {
    id: string;
    goal: string;
    url: string;
    mode: TraceSession["task"]["mode"];
  };
  aggregate: {
    result: TraceSession["aggregate"]["result"];
    totalSteps: number;
    durationMs: number;
    endedBy: TraceSession["aggregate"]["endedBy"];
    failurePoint?: TraceSession["aggregate"]["failurePoint"];
  };
  summary?: TraceSession["experienceSummary"];
  summaryError?: string;
  steps: StepViewModel[];
  filters: Record<FilterKey, number>;
  actionBreakdown: Array<{
    label: string;
    count: number;
    percent: number;
  }>;
  sparkline: {
    width: number;
    height: number;
    maxDecideMs: number;
    path: string;
    hotspots: Array<{
      index: number;
      x: number;
      y: number;
      width: number;
      tooltip: string;
    }>;
  } | null;
};

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "important", label: "Important" },
  { key: "verify-fail", label: "Verify Fail" },
  { key: "failure-point", label: "Failure Point" },
  { key: "verdict", label: "Verdict" },
];

const STATUS_META: Record<
  StepStatus,
  { label: string; tone: "success" | "failure" | "warning" | "neutral"; color: string }
> = {
  success: { label: "Success", tone: "success", color: "#16a34a" },
  verified: { label: "Verified", tone: "success", color: "#16a34a" },
  "verify-fail": { label: "Verify Fail", tone: "failure", color: "#dc2626" },
  failure: { label: "Failure", tone: "failure", color: "#dc2626" },
  "failure-point": { label: "Failure Point", tone: "failure", color: "#dc2626" },
  error: { label: "Error", tone: "failure", color: "#dc2626" },
  stuck: { label: "Stuck", tone: "warning", color: "#d97706" },
  normal: { label: "In Progress", tone: "neutral", color: "#94a3b8" },
};

const REPORT_MODEL_VAR = "REPORT_MODEL";
const MINIMAP_WIDTH = 1000;
const MINIMAP_HEIGHT = 68;
const MINIMAP_BAR_Y = 24;
const MINIMAP_BAR_HEIGHT = 32;
const SPARKLINE_WIDTH = 340;
const SPARKLINE_HEIGHT = 96;
const STEP_PAGE_SIZE = 10;

export function renderHtml(session: TraceSession): string {
  const model = buildReportModel(session);
  const safeJson = JSON.stringify(model).replace(/<\/script>/gi, "<\\/script>");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>rawstep — ${h(session.task.id)}</title>
  <style>
    :root {
      --bg: #f7f7f4;
      --surface: #ffffff;
      --surface-soft: #fbfbf9;
      --border: #e6e7e2;
      --border-strong: #d8dad2;
      --text: #171717;
      --text-muted: #656b63;
      --text-faint: #98a095;
      --accent: #2563eb;
      --accent-soft: #eff6ff;
      --success: #16a34a;
      --success-soft: #eefbf2;
      --failure: #dc2626;
      --failure-soft: #fef2f2;
      --warning: #d97706;
      --warning-soft: #fff7ed;
      --neutral-soft: #f3f4f1;
      --shadow: 0 18px 44px rgba(23, 23, 23, 0.08);
      --radius: 18px;
      --radius-sm: 12px;
      --header-h: 84px;
      --panel-w: clamp(480px, 50vw, 760px);
      --font-ui: "SF Pro Display", "Apple SD Gothic Neo", "Pretendard", "Segoe UI", sans-serif;
      --font-mono: "SFMono-Regular", "SF Mono", Menlo, Monaco, Consolas, monospace;
    }

    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      background:
        radial-gradient(circle at top left, rgba(37, 99, 235, 0.06), transparent 32%),
        linear-gradient(180deg, #fafaf7 0%, #f6f6f2 100%);
      color: var(--text);
      font: 14px/1.5 var(--font-ui);
    }
    button, input, textarea, select {
      font: inherit;
    }
    button {
      cursor: pointer;
    }
    .report-shell {
      min-height: 100vh;
    }
    .report-header {
      position: sticky;
      top: 0;
      z-index: 40;
      backdrop-filter: blur(14px);
      background: rgba(250, 250, 247, 0.94);
      border-bottom: 1px solid rgba(216, 218, 210, 0.9);
    }
    .header-inner {
      width: min(1180px, calc(100vw - 48px));
      max-width: none;
      margin: 0 auto;
      padding: 18px 24px 16px;
      display: grid;
      gap: 10px;
      transition: width 0.22s ease, margin 0.22s ease, padding 0.22s ease;
    }
    .header-row {
      display: flex;
      align-items: center;
      gap: 14px;
      min-width: 0;
    }
    .header-row.primary {
      justify-content: space-between;
    }
    .header-main {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 12px;
      flex: 1;
    }
    .task-id {
      flex-shrink: 0;
      font: 700 12px/1 var(--font-mono);
      letter-spacing: 0.02em;
      color: var(--text-muted);
      padding: 6px 10px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.8);
    }
    .task-goal {
      min-width: 0;
      font-size: 18px;
      font-weight: 650;
      letter-spacing: -0.02em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .header-badges {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text-muted);
      font-size: 12px;
      font-weight: 600;
      line-height: 1;
    }
    .pill.tone-success {
      color: var(--success);
      background: var(--success-soft);
      border-color: #b9e7c6;
    }
    .pill.tone-failure {
      color: var(--failure);
      background: var(--failure-soft);
      border-color: #f5c1c1;
    }
    .pill.tone-warning {
      color: var(--warning);
      background: var(--warning-soft);
      border-color: #f3d0a6;
    }
    .pill.tone-neutral {
      color: var(--text-muted);
      background: var(--neutral-soft);
      border-color: var(--border);
    }
    .header-meta {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      font-size: 12px;
      color: var(--text-muted);
      min-width: 0;
    }
    .header-meta strong {
      color: var(--text);
      font-weight: 650;
    }
    .header-meta-sep {
      color: var(--text-faint);
    }
    .header-url {
      min-width: 0;
      flex: 1 1 280px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .report-main {
      max-width: 1220px;
      margin: 0 auto;
      padding: 22px 24px 32px;
      display: flex;
      flex-direction: column;
      gap: 18px;
      transition: padding-right 0.22s ease;
    }
    .report-main.panel-open {
      padding-right: calc(var(--panel-w) + 36px);
    }
    .report-header.panel-open .header-inner {
      width: calc(100vw - var(--panel-w) - 24px);
      margin-left: 16px;
      margin-right: auto;
      padding-right: 12px;
    }
    .card {
      background: rgba(255, 255, 255, 0.94);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: 0 8px 24px rgba(23, 23, 23, 0.03);
      overflow: hidden;
    }
    .card-header {
      padding: 16px 18px 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .card-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.12em;
      color: var(--text-faint);
      text-transform: uppercase;
    }
    .card-body {
      padding: 18px;
    }
    .summary-card .card-body {
      display: grid;
      gap: 16px;
    }
    .summary-lead {
      font-size: 22px;
      font-weight: 640;
      letter-spacing: -0.03em;
      line-height: 1.35;
    }
    .summary-overall {
      color: var(--text-muted);
      font-size: 14px;
      line-height: 1.7;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: 1.1fr 1fr;
      gap: 16px;
      align-items: start;
    }
    .section-label {
      margin-bottom: 8px;
      font-size: 10px;
      font-weight: 700;
      color: var(--text-faint);
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .summary-notes {
      display: grid;
      gap: 10px;
    }
    .summary-note {
      padding: 12px 14px;
      border-radius: 14px;
      border: 1px solid var(--border);
      background: var(--surface-soft);
      font-size: 13px;
      line-height: 1.65;
    }
    .summary-note.tone-failure {
      color: var(--failure);
      background: var(--failure-soft);
      border-color: #f5c1c1;
    }
    .summary-note.tone-neutral {
      color: var(--text);
      background: rgba(248, 250, 252, 0.92);
      border-color: #dbe3ef;
    }
    .summary-muted {
      color: var(--text-faint);
      font-size: 13px;
    }
    .summary-warning {
      color: var(--text-muted);
      font-size: 13px;
    }
    .overview-layout {
      display: grid;
      grid-template-columns: minmax(0, 1.55fr) minmax(280px, 0.85fr);
      gap: 18px;
      align-items: start;
    }
    .overview-side {
      display: grid;
      gap: 18px;
    }
    .flow-card .card-body {
      padding-top: 14px;
      display: grid;
      gap: 16px;
    }
    .miniwrap {
      display: grid;
      gap: 10px;
    }
    .minimap-frame {
      padding: 12px 14px 10px;
      border: 1px solid var(--border);
      border-radius: 16px;
      background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(249,249,246,0.96));
    }
    .minimap-svg {
      display: block;
      width: 100%;
      height: 56px;
      overflow: visible;
    }
    .minimap-segment {
      outline: none;
    }
    .minimap-segment:hover,
    .minimap-segment:focus-visible {
      stroke: rgba(23, 23, 23, 0.68);
      stroke-width: 4;
    }
    .minimap-segment.is-selected {
      stroke: #111827;
      stroke-width: 4;
    }
    .minimap-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      color: var(--text-faint);
      font-size: 11px;
    }
    .legend-item {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .legend-swatch {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      flex-shrink: 0;
    }
    .filter-tabs {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .filter-tab {
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text-muted);
      border-radius: 999px;
      padding: 8px 11px;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      font-size: 12px;
      font-weight: 600;
      line-height: 1;
    }
    .filter-tab:hover {
      border-color: var(--border-strong);
      color: var(--text);
    }
    .filter-tab.is-active {
      border-color: #bcd2ff;
      background: var(--accent-soft);
      color: var(--accent);
    }
    .filter-count {
      min-width: 18px;
      padding: 0 5px;
      height: 18px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.92);
      border: 1px solid rgba(37, 99, 235, 0.12);
      color: inherit;
      font-size: 10px;
      font-weight: 700;
    }
    .step-list {
      border: 1px solid var(--border);
      border-radius: 16px;
      overflow: hidden;
      background: rgba(255, 255, 255, 0.82);
    }
    .step-row {
      width: 100%;
      padding: 12px 14px;
      display: grid;
      grid-template-columns: 62px minmax(0, 1fr);
      gap: 14px;
      border: 0;
      border-bottom: 1px solid rgba(230, 231, 226, 0.95);
      background: transparent;
      text-align: left;
      position: relative;
    }
    .step-row:last-child {
      border-bottom: 0;
    }
    .step-row:hover {
      background: rgba(249, 250, 247, 0.92);
    }
    .step-row.is-selected {
      background: #eef4ff;
    }
    .step-row.is-hidden {
      display: none;
    }
    .step-row.is-failure-point::before {
      content: "";
      position: absolute;
      inset: 0 auto 0 0;
      width: 3px;
      background: var(--failure);
    }
    .step-number {
      font: 700 11px/1.4 var(--font-mono);
      color: var(--text-faint);
      padding-top: 2px;
    }
    .step-content {
      min-width: 0;
      display: grid;
      gap: 4px;
    }
    .step-topline {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      min-width: 0;
    }
    .action-chip {
      display: inline-flex;
      align-items: center;
      min-width: 0;
      max-width: 100%;
      padding: 4px 10px;
      border-radius: 999px;
      background: var(--neutral-soft);
      border: 1px solid var(--border);
      color: #334155;
      font: 600 12px/1 var(--font-mono);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .status-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      line-height: 1;
      border: 1px solid transparent;
    }
    .tone-success {
      color: var(--success);
      background: var(--success-soft);
      border-color: #b9e7c6;
    }
    .tone-failure {
      color: var(--failure);
      background: var(--failure-soft);
      border-color: #f5c1c1;
    }
    .tone-warning {
      color: var(--warning);
      background: var(--warning-soft);
      border-color: #f3d0a6;
    }
    .tone-neutral {
      color: var(--text-muted);
      background: var(--neutral-soft);
      border-color: var(--border);
    }
    .step-rationale,
    .step-failure {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
    }
    .step-rationale {
      color: var(--text-muted);
    }
    .step-failure {
      color: var(--failure);
    }
    .list-empty {
      padding: 18px 14px;
      color: var(--text-faint);
      font-size: 13px;
      border-top: 1px solid rgba(230, 231, 226, 0.95);
    }
    .list-empty.is-hidden {
      display: none;
    }
    .step-pagination {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .pagination-btn {
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.92);
      color: var(--text-muted);
      border-radius: 10px;
      padding: 8px 12px;
      line-height: 1;
      font-size: 12px;
      font-weight: 600;
    }
    .pagination-btn:hover:not(:disabled) {
      color: var(--text);
      border-color: var(--border-strong);
    }
    .pagination-btn:disabled {
      opacity: 0.38;
      cursor: not-allowed;
    }
    .pagination-meta {
      color: var(--text-faint);
      font-size: 12px;
      font-weight: 600;
    }
    .metric-card .card-body {
      display: grid;
      gap: 12px;
    }
    .action-bars {
      display: grid;
      gap: 10px;
    }
    .action-row {
      display: grid;
      grid-template-columns: minmax(96px, 108px) minmax(120px, 1fr) 60px;
      gap: 10px;
      align-items: center;
      font-size: 12px;
    }
    .action-label {
      color: var(--text-muted);
      font-family: var(--font-mono);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .action-bar {
      min-width: 120px;
      height: 8px;
      border-radius: 999px;
      background: #eef1fb;
      overflow: hidden;
    }
    .action-fill {
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, #4f7fff 0%, #2563eb 100%);
    }
    .action-meta {
      color: var(--text-faint);
      font-size: 11px;
      white-space: nowrap;
      text-align: right;
    }
    .sparkline-wrap {
      display: grid;
      gap: 10px;
    }
    .sparkline-frame {
      border: 1px solid var(--border);
      border-radius: 16px;
      background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,249,246,0.96));
      padding: 10px 12px;
    }
    .sparkline-svg {
      display: block;
      width: 100%;
      height: 96px;
      overflow: visible;
    }
    .sparkline-hotspot {
      fill: transparent;
      outline: none;
    }
    .sparkline-hotspot:hover,
    .sparkline-hotspot:focus-visible {
      fill: rgba(37, 99, 235, 0.08);
    }
    .sparkline-hotspot.is-selected {
      fill: rgba(37, 99, 235, 0.12);
    }
    .sparkline-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: var(--text-faint);
      font-size: 11px;
    }
    .tooltip {
      position: fixed;
      z-index: 70;
      pointer-events: none;
      background: rgba(15, 23, 42, 0.96);
      color: #f8fafc;
      padding: 7px 10px;
      border-radius: 10px;
      font-size: 11px;
      opacity: 0;
      transform: translateY(4px);
      transition: opacity 0.12s ease, transform 0.12s ease;
      max-width: 240px;
      white-space: nowrap;
    }
    .tooltip.is-visible {
      opacity: 1;
      transform: translateY(0);
    }
    .detail-panel {
      position: fixed;
      top: 0;
      right: 0;
      width: var(--panel-w);
      height: 100vh;
      background: rgba(255, 255, 255, 0.98);
      border-left: 1px solid var(--border);
      box-shadow: var(--shadow);
      transform: translateX(100%);
      transition: transform 0.22s ease;
      z-index: 50;
      display: flex;
      flex-direction: column;
    }
    .detail-panel.is-open {
      transform: translateX(0);
    }
    .detail-panel-header {
      padding: 18px 18px 14px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .detail-panel-title {
      min-width: 0;
      display: grid;
      gap: 4px;
    }
    .detail-step-line {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .detail-step-meta {
      color: var(--text-faint);
      font-size: 12px;
      font-weight: 500;
    }
    .detail-panel-controls {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }
    .panel-btn {
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text-muted);
      border-radius: 10px;
      padding: 8px 10px;
      line-height: 1;
      font-size: 12px;
      font-weight: 600;
    }
    .panel-btn:hover:not(:disabled) {
      color: var(--text);
      border-color: var(--border-strong);
    }
    .panel-btn:disabled {
      opacity: 0.38;
      cursor: not-allowed;
    }
    .detail-panel-body {
      flex: 1;
      overflow: auto;
      padding: 18px;
      display: grid;
      gap: 18px;
    }
    .detail-placeholder {
      color: var(--text-faint);
      font-size: 13px;
    }
    .detail-section {
      display: grid;
      gap: 8px;
    }
    .detail-kv {
      display: grid;
      gap: 8px;
      padding: 12px;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: var(--surface-soft);
    }
    .detail-kv-row {
      display: grid;
      grid-template-columns: 52px 1fr;
      gap: 10px;
      align-items: start;
      font-size: 13px;
    }
    .detail-kv-row strong {
      color: var(--text-faint);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .detail-copy {
      font-size: 13px;
      line-height: 1.7;
      color: var(--text);
    }
    .detail-subhead {
      color: var(--text-faint);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      margin-bottom: 6px;
    }
    .detail-muted {
      color: var(--text-faint);
      font-size: 13px;
    }
    .detail-screenshot {
      width: 100%;
      display: block;
      border-radius: 16px;
      border: 1px solid var(--border);
      background: #f3f4f1;
    }
    .detail-block,
    .detail-announcement,
    .failure-box {
      padding: 12px 14px;
      border-radius: 14px;
      border: 1px solid var(--border);
      background: var(--surface-soft);
      font-size: 13px;
      line-height: 1.7;
    }
    .failure-box {
      border-color: #f5c1c1;
      background: var(--failure-soft);
      color: var(--failure);
    }
    .verify-list {
      margin: 0;
      padding-left: 18px;
      color: var(--failure);
      font-size: 13px;
      line-height: 1.65;
    }
    .timing-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .timing-cell {
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 10px 12px;
      background: rgba(255, 255, 255, 0.9);
    }
    .timing-label {
      color: var(--text-faint);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      margin-bottom: 4px;
    }
    .timing-value {
      color: var(--text);
      font: 600 13px/1.2 var(--font-mono);
    }
    .header-inner {
      max-width: 1180px;
      padding: 14px 24px 12px;
      gap: 6px;
    }
    .header-row {
      gap: 10px;
    }
    .task-goal {
      font-size: 17px;
      font-weight: 640;
    }
    .header-badges {
      gap: 6px;
    }
    .pill {
      padding: 5px 9px;
      font-size: 11px;
    }
    .header-meta {
      gap: 8px;
      font-size: 11px;
      color: var(--text-faint);
    }
    .header-meta strong {
      color: var(--text-muted);
      font-weight: 600;
    }
    .report-main {
      width: min(1220px, calc(100vw - 48px));
      max-width: none;
      padding-top: 18px;
      gap: 16px;
    }
    .report-main.panel-open {
      width: calc(100vw - var(--panel-w) - 24px);
      margin-left: 16px;
      margin-right: auto;
      padding-right: 12px;
    }
    .report-header.panel-open .header-inner {
      width: calc(100vw - var(--panel-w) - 24px);
      margin-left: 16px;
      margin-right: auto;
      padding-right: 12px;
    }
    .card-title,
    .section-label {
      letter-spacing: 0.08em;
      text-transform: none;
    }
    .summary-card .card-body {
      gap: 12px;
      padding-top: 16px;
    }
    .summary-card.is-compact .card-body {
      gap: 10px;
    }
    .summary-lead {
      font-size: 20px;
      line-height: 1.3;
    }
    .summary-overall {
      font-size: 13px;
      line-height: 1.65;
    }
    .summary-grid {
      gap: 14px;
    }
    .overview-layout {
      grid-template-columns: minmax(0, 1.62fr) minmax(360px, 0.98fr);
      gap: 16px;
    }
    .overview-side {
      gap: 14px;
    }
    .flow-card .card-body {
      gap: 14px;
    }
    .minimap-frame {
      position: relative;
      padding: 16px 14px 10px;
    }
    .minimap-svg {
      height: 68px;
    }
    .minimap-segment:hover,
    .minimap-segment:focus-visible {
      stroke: rgba(37, 99, 235, 0.45);
      stroke-width: 3;
    }
    .minimap-segment.is-selected {
      stroke: #2563eb;
      stroke-width: 2.5;
    }
    .minimap-selection-label {
      position: absolute;
      top: 8px;
      left: 0;
      transform: translate(-50%, -100%);
      border-radius: 999px;
      border: 1px solid rgba(37, 99, 235, 0.18);
      background: rgba(255, 255, 255, 0.96);
      color: #1d4ed8;
      font: 700 10px/1 var(--font-mono);
      padding: 5px 8px;
      box-shadow: 0 8px 18px rgba(37, 99, 235, 0.12);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.16s ease;
      white-space: nowrap;
    }
    .minimap-selection-label::after {
      content: "";
      position: absolute;
      left: 50%;
      bottom: -5px;
      width: 8px;
      height: 8px;
      transform: translateX(-50%) rotate(45deg);
      background: rgba(255, 255, 255, 0.96);
      border-right: 1px solid rgba(37, 99, 235, 0.18);
      border-bottom: 1px solid rgba(37, 99, 235, 0.18);
    }
    .minimap-selection-label.is-visible {
      opacity: 1;
    }
    .failure-marker-halo {
      fill: rgba(220, 38, 38, 0.12);
    }
    .failure-marker-pin {
      stroke: #dc2626;
      stroke-width: 2.2;
    }
    .failure-marker-flag {
      fill: #dc2626;
    }
    .minimap-legend {
      gap: 8px;
      font-size: 10px;
    }
    .filter-tabs {
      gap: 4px;
    }
    .filter-tab {
      padding: 6px 10px;
      gap: 6px;
      font-size: 11px;
    }
    .filter-count {
      min-width: 16px;
      height: 16px;
      font-size: 9px;
    }
    .step-list {
      background: rgba(255, 255, 255, 0.86);
    }
    .step-row {
      padding: 12px 14px;
      border-left: 1px solid transparent;
      border-right: 1px solid transparent;
      transition: background 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;
    }
    .step-row.is-status-normal {
      background: rgba(255, 255, 255, 0.76);
    }
    .step-row.is-status-normal .step-rationale {
      color: #838c82;
    }
    .step-row.is-status-verify-fail,
    .step-row.is-status-failure-point,
    .step-row.is-status-error,
    .step-row.is-status-failure {
      background: linear-gradient(180deg, rgba(254, 242, 242, 0.95), rgba(255, 255, 255, 0.98));
    }
    .step-row.is-verdict-success {
      background: linear-gradient(180deg, rgba(238, 251, 242, 0.98), rgba(255, 255, 255, 0.96));
    }
    .step-row.is-verdict-stuck {
      background: linear-gradient(180deg, rgba(255, 247, 237, 0.98), rgba(255, 255, 255, 0.96));
    }
    .step-row.is-selected {
      background: #eef4ff;
      border-left-color: rgba(37, 99, 235, 0.32);
      border-right-color: rgba(37, 99, 235, 0.16);
      box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.24), 0 10px 22px rgba(37, 99, 235, 0.08);
      z-index: 1;
    }
    .step-row.is-failure-point::before {
      width: 4px;
    }
    .action-chip.is-muted {
      color: #667085;
      background: #f5f6f3;
    }
    .action-chip.is-failure {
      color: #991b1b;
      background: #fff4f4;
      border-color: #f0caca;
    }
    .action-chip.is-verdict-success {
      color: var(--success);
      background: var(--success-soft);
      border-color: #b9e7c6;
    }
    .action-chip.is-verdict-stuck {
      color: var(--warning);
      background: var(--warning-soft);
      border-color: #f3d0a6;
    }
    .step-rationale {
      color: var(--text-muted);
      font-size: 12px;
    }
    .step-failure {
      white-space: normal;
      line-height: 1.45;
      font-size: 12px;
      font-weight: 650;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      overflow: hidden;
    }
    .action-row {
      gap: 10px;
    }
    .detail-panel-header {
      padding: 16px 18px 14px;
      gap: 10px;
    }
    .detail-panel-title {
      gap: 8px;
    }
    .detail-step-line {
      font-size: 14px;
    }
    .detail-step-meta {
      font-size: 11px;
    }
    .detail-panel-body {
      gap: 16px;
    }
    .detail-placeholder {
      font-size: 12px;
    }
    .panel-hero {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .panel-action-chip {
      min-width: 0;
      min-height: 28px;
      justify-content: center;
      padding: 0 10px;
      font-size: 11px;
      box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.03);
    }
    .panel-status-chip {
      min-width: 0;
      min-height: 28px;
      justify-content: center;
      padding: 0 10px;
      font-size: 10px;
    }
    .detail-media-frame {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 320px;
      padding: 16px;
      border: 1px solid var(--border);
      border-radius: 18px;
      background: linear-gradient(180deg, rgba(250, 250, 247, 0.96), rgba(246, 246, 242, 0.98));
    }
    .detail-screenshot {
      max-height: 420px;
      width: 100%;
      object-fit: contain;
      border-radius: 14px;
      border-color: rgba(216, 218, 210, 0.9);
      background: #ffffff;
    }
    .detail-announcement {
      background: #f8fafc;
      border-color: #dbe3ef;
    }
    .verify-list {
      margin-top: 8px;
    }
    .failure-box {
      font-weight: 600;
    }
    @media (max-width: 1180px) {
      .report-header.panel-open .header-inner,
      .report-main.panel-open {
        width: min(1220px, calc(100vw - 48px));
        margin-left: auto;
        margin-right: auto;
        padding-right: 24px;
      }
    }
    @media (max-width: 1180px) {
      .overview-layout {
        grid-template-columns: 1fr;
      }
      .report-main.panel-open {
        padding-right: 24px;
      }
    }
    @media (max-width: 860px) {
      :root {
        --header-h: auto;
        --panel-w: 100vw;
      }
      .header-row.primary,
      .header-main,
      .header-badges {
        flex-wrap: wrap;
      }
      .header-row.primary {
        align-items: flex-start;
      }
      .summary-grid {
        grid-template-columns: 1fr;
      }
    }
    @media (max-width: 680px) {
      .report-main,
      .header-inner {
        padding-left: 16px;
        padding-right: 16px;
      }
      .step-row {
        grid-template-columns: 1fr;
        gap: 8px;
      }
      .step-number {
        padding-top: 0;
      }
      .timing-grid {
        grid-template-columns: 1fr;
      }
      .action-row {
        grid-template-columns: minmax(88px, 100px) minmax(96px, 1fr) 56px;
      }
      .step-pagination {
        flex-wrap: wrap;
      }
    }
  </style>
</head>
<body>
  <div class="report-shell">
    ${renderHeader(model)}
    <main class="report-main" id="report-main">
      ${renderSummary(model)}
      <section class="overview-layout">
        ${renderFlowCard(model)}
        <div class="overview-side">
          ${renderActionCard(model)}
          ${renderTimingCard(model)}
        </div>
      </section>
    </main>
    ${renderPanelShell()}
    <div class="tooltip" id="report-tooltip" role="status" aria-live="polite"></div>
  </div>
  <script>
    var ${REPORT_MODEL_VAR} = ${safeJson};
    var activeFilter = 'all';
    var currentPage = 1;
    var pageSize = ${STEP_PAGE_SIZE};
    var selectedStepIndex = null;

    function esc(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function panelSection(label, body) {
      return '<section class="detail-section">' +
        '<div class="section-label">' + esc(label) + '</div>' +
        body +
      '</section>';
    }

    function renderTimingCell(label, value) {
      return '<div class="timing-cell">' +
        '<div class="timing-label">' + esc(label) + '</div>' +
        '<div class="timing-value">' + esc(value) + '</div>' +
      '</div>';
    }

    function renderTimingGrid(step) {
      return '<div class="timing-grid">' +
        renderTimingCell('Observe', step.timings.observe) +
        renderTimingCell('Decide', step.timings.decide) +
        renderTimingCell('Execute', step.timings.execute) +
        renderTimingCell('Verify', step.timings.verify) +
      '</div>';
    }

    function renderPanelBody(step) {
      var chunks = [];

      var observation = '';
      if (step.screenshotPath) {
        observation += '<div class="detail-subhead">Screenshot</div>' +
          '<div class="detail-media-frame">' +
          '<img class="detail-screenshot" src="' + esc(step.screenshotPath) + '" loading="lazy" alt="step ' + esc(step.stepNumber) + ' screenshot" />' +
        '</div>';
      }

      if (step.observation.kind === 'screenreader') {
        observation += '<div class="detail-subhead">Announcement</div>' + (step.observation.announcement
          ? '<div class="detail-announcement">' + esc(step.observation.announcement) + '</div>'
          : '<div class="detail-muted">No announcement</div>');
        observation += '<div class="detail-kv">' +
          '<div class="detail-kv-row"><strong>Capture</strong><div class="detail-copy">' + esc(step.observation.capture) + '</div></div>' +
          (step.observation.count
            ? '<div class="detail-kv-row"><strong>Count</strong><div class="detail-copy">' + esc(step.observation.count) + '</div></div>'
            : '') +
          (step.observation.reason
            ? '<div class="detail-kv-row"><strong>Reason</strong><div class="detail-copy">' + esc(step.observation.reason) + '</div></div>'
            : '') +
        '</div>';
      } else if (!step.screenshotPath) {
        observation += '<div class="detail-muted">No screenshot</div>';
      }

      chunks.push(panelSection('Observation', observation));

      if (step.verificationPassed !== null) {
        if (step.verificationPassed) {
          chunks.push(panelSection('Verification',
            '<span class="status-chip tone-success">Verified</span>'
          ));
        } else {
          var failureItems = '';
          for (var i = 0; i < step.verificationFailures.length; i++) {
            failureItems += '<li>' + esc(step.verificationFailures[i]) + '</li>';
          }
          chunks.push(panelSection('Verification',
            '<span class="status-chip tone-failure">Verify Fail</span>' +
            (failureItems ? '<ul class="verify-list">' + failureItems + '</ul>' : '')
          ));
        }
      }

      if (step.isFailurePoint && step.failureSummary) {
        chunks.push('<section class="detail-section"><div class="failure-box">' + esc(step.failureSummary) + '</div></section>');
      }

      if (step.rationale) {
        chunks.push(panelSection('Rationale',
          '<div class="detail-block"><div class="detail-copy">' + esc(step.rationale) + '</div></div>'
        ));
      }

      if (step.observation.kind === 'keyboard') {
        chunks.push(panelSection('Page',
          '<div class="detail-kv">' +
            '<div class="detail-kv-row"><strong>Title</strong><div class="detail-copy">' + esc(step.observation.title) + '</div></div>' +
            '<div class="detail-kv-row"><strong>Path</strong><div class="detail-copy">' + esc(step.observation.urlPath) + '</div></div>' +
            (step.observation.focusHint
              ? '<div class="detail-kv-row"><strong>Focus</strong><div class="detail-copy">' + esc(step.observation.focusHint) + '</div></div>'
              : '') +
            (step.observation.scrollHint
              ? '<div class="detail-kv-row"><strong>Scroll</strong><div class="detail-copy">' + esc(step.observation.scrollHint) + '</div></div>'
              : '') +
          '</div>'
        ));
      }

      if (step.hasTimingDetails) {
        chunks.push(panelSection('Time', renderTimingGrid(step)));
      }

      return chunks.join('');
    }

    function renderPanelHeader(step) {
      var current = step.stepNumber;
      var total = ${REPORT_MODEL_VAR}.steps.length;
      return '' +
        '<div class="detail-panel-title">' +
          '<div class="detail-step-line">Step ' + esc(current) + ' / ' + esc(total) + '</div>' +
          '<div class="panel-hero">' +
            '<span class="action-chip panel-action-chip">' + esc(step.actionLabel) + '</span>' +
            '<span class="status-chip panel-status-chip tone-' + esc(step.tone) + '">' + esc(step.statusLabel) + '</span>' +
            (step.relativeLabel ? '<span class="detail-step-meta">' + esc(step.relativeLabel) + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="detail-panel-controls">' +
          '<button class="panel-btn" id="panel-prev" aria-label="Previous step">Prev</button>' +
          '<button class="panel-btn" id="panel-next" aria-label="Next step">Next</button>' +
          '<button class="panel-btn" id="panel-close" aria-label="Close detail panel">Close</button>' +
        '</div>';
    }

    function syncSelectedState() {
      var allTargets = document.querySelectorAll('[data-step-index]');
      for (var i = 0; i < allTargets.length; i++) {
        var node = allTargets[i];
        var isSelected = Number(node.getAttribute('data-step-index')) === selectedStepIndex;
        node.classList.toggle('is-selected', isSelected);
      }
      updateMinimapSelectionLabel();
    }

    function updateMinimapSelectionLabel() {
      var label = document.getElementById('minimap-selection-label');
      if (!label) return;
      if (selectedStepIndex == null) {
        label.classList.remove('is-visible');
        label.textContent = '';
        return;
      }
      var step = ${REPORT_MODEL_VAR}.steps[selectedStepIndex];
      if (!step) return;
      var total = ${REPORT_MODEL_VAR}.steps.length;
      var position = total === 1 ? 50 : (selectedStepIndex / (total - 1)) * 100;
      label.textContent = 'Step ' + step.stepNumber;
      label.style.left = position + '%';
      label.classList.add('is-visible');
    }

    function getFilterIndexes(key) {
      var indexes = [];
      for (var i = 0; i < ${REPORT_MODEL_VAR}.steps.length; i++) {
        var step = ${REPORT_MODEL_VAR}.steps[i];
        var matches = key === 'all' ||
          (key === 'important' && step.isImportant) ||
          (key === 'verify-fail' && step.isVerifyFail) ||
          (key === 'failure-point' && step.isFailurePoint) ||
          (key === 'verdict' && step.isVerdict);
        if (matches) indexes.push(i);
      }
      return indexes;
    }

    function getPageCount(key) {
      return Math.max(1, Math.ceil(getFilterIndexes(key).length / pageSize));
    }

    function updatePagination() {
      var pageCount = getPageCount(activeFilter);
      if (currentPage > pageCount) currentPage = pageCount;
      if (currentPage < 1) currentPage = 1;

      var prev = document.getElementById('page-prev');
      var next = document.getElementById('page-next');
      var meta = document.getElementById('page-meta');

      if (meta) {
        meta.textContent = 'Page ' + currentPage + ' / ' + pageCount;
      }
      if (prev) prev.disabled = currentPage <= 1;
      if (next) next.disabled = currentPage >= pageCount;
    }

    function ensureStepVisible(index) {
      var filtered = getFilterIndexes(activeFilter);
      var position = filtered.indexOf(index);
      if (position === -1) return;
      currentPage = Math.floor(position / pageSize) + 1;
    }

    function updatePanelButtons() {
      var prev = document.getElementById('panel-prev');
      var next = document.getElementById('panel-next');
      if (!prev || !next) return;
      prev.disabled = selectedStepIndex === 0;
      next.disabled = selectedStepIndex === ${REPORT_MODEL_VAR}.steps.length - 1;
      prev.onclick = function() { navigatePanel(-1); };
      next.onclick = function() { navigatePanel(1); };
    }

    function setPanelLayoutState(isOpen) {
      var header = document.getElementById('report-header');
      var main = document.getElementById('report-main');
      if (header) header.classList.toggle('panel-open', isOpen);
      if (main) main.classList.toggle('panel-open', isOpen);
    }

    function openPanel(index) {
      var step = ${REPORT_MODEL_VAR}.steps[index];
      if (!step) return;
      ensureStepVisible(index);
      applyFilter(activeFilter, true);
      selectedStepIndex = index;
      document.getElementById('detail-panel-header').innerHTML = renderPanelHeader(step);
      document.getElementById('detail-panel-body').innerHTML = renderPanelBody(step);
      document.getElementById('detail-panel').classList.add('is-open');
      setPanelLayoutState(true);
      document.getElementById('panel-close').onclick = closePanel;
      updatePanelButtons();
      syncSelectedState();
    }

    function closePanel() {
      selectedStepIndex = null;
      document.getElementById('detail-panel').classList.remove('is-open');
      setPanelLayoutState(false);
      syncSelectedState();
    }

    function navigatePanel(direction) {
      if (selectedStepIndex == null) return;
      var next = selectedStepIndex + direction;
      if (next < 0 || next >= ${REPORT_MODEL_VAR}.steps.length) return;
      openPanel(next);
      var row = document.querySelector('.step-row[data-step-index="' + next + '"]');
      if (row) row.scrollIntoView({ block: 'nearest' });
    }

    function applyFilter(key, preservePage) {
      activeFilter = key;
      if (!preservePage) currentPage = 1;
      var filtered = getFilterIndexes(key);
      var pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
      if (currentPage > pageCount) currentPage = pageCount;
      var pageStart = (currentPage - 1) * pageSize;
      var pageEnd = pageStart + pageSize;
      var rows = document.querySelectorAll('.step-row');
      var visibleCount = 0;
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var stepIndex = Number(row.getAttribute('data-step-index'));
        var filteredPosition = filtered.indexOf(stepIndex);
        var visible = filteredPosition >= pageStart && filteredPosition < pageEnd;
        row.classList.toggle('is-hidden', !visible);
        if (visible) visibleCount += 1;
      }
      var tabs = document.querySelectorAll('[data-filter-tab]');
      for (var j = 0; j < tabs.length; j++) {
        var isActive = tabs[j].getAttribute('data-filter-tab') === key;
        tabs[j].classList.toggle('is-active', isActive);
        tabs[j].setAttribute('aria-selected', isActive ? 'true' : 'false');
      }
      var empty = document.getElementById('step-list-empty');
      if (empty) empty.classList.toggle('is-hidden', visibleCount > 0);
      updatePagination();
    }

    function showTooltip(text, x, y) {
      var tooltip = document.getElementById('report-tooltip');
      tooltip.textContent = text;
      tooltip.style.left = x + 'px';
      tooltip.style.top = y + 'px';
      tooltip.classList.add('is-visible');
    }

    function hideTooltip() {
      document.getElementById('report-tooltip').classList.remove('is-visible');
    }

    function bindTooltip(root) {
      if (!root) return;
      root.addEventListener('mousemove', function(event) {
        var target = event.target;
        if (!target || !target.getAttribute) return;
        var text = target.getAttribute('data-tooltip');
        if (!text) {
          hideTooltip();
          return;
        }
        showTooltip(text, event.clientX + 12, event.clientY - 34);
      });
      root.addEventListener('mouseleave', hideTooltip);
      root.addEventListener('focusin', function(event) {
        var target = event.target;
        if (!target || !target.getAttribute) return;
        var text = target.getAttribute('data-tooltip');
        if (!text) return;
        var rect = target.getBoundingClientRect();
        showTooltip(text, rect.left + rect.width / 2, rect.top - 36);
      });
      root.addEventListener('focusout', hideTooltip);
    }

    function bindOpenEvents(selector) {
      var nodes = document.querySelectorAll(selector);
      for (var i = 0; i < nodes.length; i++) {
        nodes[i].addEventListener('click', function() {
          openPanel(Number(this.getAttribute('data-step-index')));
        });
        nodes[i].addEventListener('keydown', function(event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openPanel(Number(this.getAttribute('data-step-index')));
          }
        });
      }
    }

    function init() {
      applyFilter(activeFilter);
      bindTooltip(document.getElementById('step-minimap'));
      bindTooltip(document.getElementById('timing-sparkline'));
      bindOpenEvents('.step-row');
      bindOpenEvents('.minimap-segment');
      bindOpenEvents('.sparkline-hotspot');

      var tabs = document.querySelectorAll('[data-filter-tab]');
      for (var i = 0; i < tabs.length; i++) {
        tabs[i].addEventListener('click', function() {
          applyFilter(this.getAttribute('data-filter-tab'));
        });
      }

      var pagePrev = document.getElementById('page-prev');
      var pageNext = document.getElementById('page-next');
      if (pagePrev) {
        pagePrev.addEventListener('click', function() {
          if (currentPage <= 1) return;
          currentPage -= 1;
          applyFilter(activeFilter, true);
        });
      }
      if (pageNext) {
        pageNext.addEventListener('click', function() {
          if (currentPage >= getPageCount(activeFilter)) return;
          currentPage += 1;
          applyFilter(activeFilter, true);
        });
      }

      document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') closePanel();
      });
    }

    document.addEventListener('DOMContentLoaded', init);
  </script>
</body>
</html>`;
}

function buildReportModel(session: TraceSession): ReportModel {
  const startedAtMs = Date.parse(session.startedAt);
  const failurePointStep = session.aggregate.failurePoint?.stepIndex;

  const steps = session.steps.map((step, index) =>
    buildStepViewModel(step, index, startedAtMs, failurePointStep, session.aggregate.failurePoint?.reason)
  );

  const filters: Record<FilterKey, number> = {
    important: steps.filter((step) => step.isImportant).length,
    "verify-fail": steps.filter((step) => step.isVerifyFail).length,
    "failure-point": steps.filter((step) => step.isFailurePoint).length,
    verdict: steps.filter((step) => step.isVerdict).length,
    all: steps.length,
  };

  return {
    task: {
      id: session.task.id,
      goal: session.task.goal,
      url: session.task.url,
      mode: session.task.mode,
    },
    aggregate: {
      result: session.aggregate.result,
      totalSteps: session.aggregate.totalSteps,
      durationMs: session.aggregate.durationMs,
      endedBy: session.aggregate.endedBy,
      failurePoint: session.aggregate.failurePoint,
    },
    summary: session.experienceSummary,
    summaryError: session.experienceSummaryError,
    steps,
    filters,
    actionBreakdown: buildActionBreakdown(steps),
    sparkline: buildSparkline(steps),
  };
}

function buildStepViewModel(
  step: StepRecord,
  index: number,
  startedAtMs: number,
  failurePointStep: number | undefined,
  failurePointReason: string | undefined
): StepViewModel {
  const status = getStepStatus(step, failurePointStep);
  const meta = STATUS_META[status];
  const isVerdict = "verdict" in step.decision;
  const isVerifyFail = Boolean(step.verification && !step.verification.passed);
  const isFailurePoint = step.step === failurePointStep;
  const isExecutionError = step.execution.ok === false;
  const isImportant = isVerifyFail || isFailurePoint || isVerdict || isExecutionError;
  const screenshotPath = step.observation.screenshot
    ? toReportImagePath(step.observation.screenshot.path)
    : null;

  let failureSummary: string | null = null;
  if (isFailurePoint) {
    failureSummary = failurePointReason ?? firstFailure(step) ?? step.execution.error ?? "Failure point";
  } else if (isVerifyFail) {
    failureSummary = firstFailure(step);
  } else if (isExecutionError) {
    failureSummary = step.execution.error ?? "Execution error";
  }

  return {
    index,
    stepNumber: step.step + 1,
    actionLabel: formatActionLabel(step),
    status,
    statusLabel: meta.label,
    tone: meta.tone,
    rationale: step.decision.rationale ?? "",
    failureSummary,
    relativeLabel: formatRelativeLabel(startedAtMs, step.timestamp),
    isVerdict,
    isImportant,
    isVerifyFail,
    isFailurePoint,
    verificationPassed: step.verification ? step.verification.passed : null,
    verificationFailures: step.verification?.failures ?? [],
    screenshotPath,
    hasTimingDetails: hasMeaningfulTimings(step.timings),
    timings: {
      observe: formatDuration(step.timings.observeMs),
      decide: formatDuration(step.timings.decideMs),
      execute: formatDuration(step.timings.executeMs),
      verify: formatDuration(step.timings.verifyMs),
      decideMs: step.timings.decideMs,
    },
    observation:
      step.observation.kind === "keyboard"
        ? {
            kind: "keyboard",
            title: step.observation.browserChrome.title,
            urlPath: step.observation.browserChrome.urlPath,
            focusHint: step.observation.focusHint ?? null,
            scrollHint: step.observation.scrollHint ?? null,
          }
        : {
            kind: "screenreader",
            announcement: step.observation.announcement || null,
            capture: formatAnnouncementCapture(step.observation.announcementCapture),
            count: formatAnnouncementCount(step.observation.announcementCount),
            reason: formatObserveReason(step.observation.observeReason),
          },
  };
}

function buildActionBreakdown(steps: StepViewModel[]): ReportModel["actionBreakdown"] {
  const counts = new Map<string, number>();

  for (const step of steps) {
    if (step.isVerdict) continue;
    counts.set(step.actionLabel, (counts.get(step.actionLabel) ?? 0) + 1);
  }

  const total = Array.from(counts.values()).reduce((sum, count) => sum + count, 0);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({
      label,
      count,
      percent: total === 0 ? 0 : Math.round((count / total) * 100),
    }));
}

function buildSparkline(steps: StepViewModel[]): ReportModel["sparkline"] {
  if (steps.length === 0) return null;

  const maxDecideMs = Math.max(...steps.map((step) => step.timings.decideMs), 1);
  const paddingX = 8;
  const paddingY = 10;
  const width = SPARKLINE_WIDTH;
  const height = SPARKLINE_HEIGHT;

  const points = steps.map((step, index) => {
    const x = steps.length === 1
      ? width / 2
      : paddingX + (index / (steps.length - 1)) * (width - paddingX * 2);
    const decideMs = step.timings.decideMs;
    const y = height - paddingY - (decideMs / maxDecideMs) * (height - paddingY * 2);
    return { index, x, y, decideMs };
  });

  return {
    width,
    height,
    maxDecideMs,
    path: points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" "),
    hotspots: points.map((point, index) => ({
      index: point.index,
      x: point.x,
      y: point.y,
      width:
        steps.length === 1
          ? width - paddingX * 2
          : Math.max(
              10,
              index === steps.length - 1
                ? point.x - points[index - 1]!.x
                : points[Math.min(index + 1, points.length - 1)]!.x - point.x
            ),
      tooltip: `step ${steps[index]!.stepNumber} · ${formatDuration(point.decideMs)}`,
    })),
  };
}

function getStepStatus(step: StepRecord, failurePointStep: number | undefined): StepStatus {
  if (step.step === failurePointStep) return "failure-point";
  if (!step.execution.ok) return "error";
  if (step.verification) return step.verification.passed ? "verified" : "verify-fail";
  if ("verdict" in step.decision) return step.decision.verdict === "success" ? "success" : "stuck";
  if (step.verdictAnalysis?.finalResult === "failure") return "failure";
  if (step.verdictAnalysis?.finalResult === "success") return "success";
  return "normal";
}

function formatActionLabel(step: StepRecord): string {
  if ("verdict" in step.decision) return step.decision.verdict;
  const label = formatAction(step.decision.action);
  return label.startsWith("sr.") ? `SR:${label.slice(3)}` : label;
}

function firstFailure(step: StepRecord): string | null {
  return step.verification?.failures[0] ?? null;
}

function hasMeaningfulTimings(timings: StepRecord["timings"]): boolean {
  return timings.observeMs > 0 || timings.decideMs > 0 || timings.executeMs > 0 || timings.verifyMs > 0;
}

function formatAnnouncementCapture(capture: Extract<StepRecord["observation"], { kind: "screenreader" }>["announcementCapture"]): string {
  switch (capture) {
    case "log":
      return "Phrase log";
    case "fallback":
      return "Last spoken phrase fallback";
    case "none":
      return "No capture";
    case "synthetic":
      return "Synthetic announcement";
  }
}

function formatAnnouncementCount(count: number | undefined): string | null {
  if (typeof count !== "number") {
    return null;
  }

  return count === 1 ? "1 phrase" : `${count} phrases`;
}

function formatObserveReason(
  reason: Extract<StepRecord["observation"], { kind: "screenreader" }>["observeReason"]
): string | null {
  switch (reason) {
    case "silence":
      return "Stopped after quiet period";
    case "timeout":
      return "Stopped at timeout";
    case "fallback":
      return "Used fallback value";
    case "synthetic":
      return "Used synthetic announcement";
    default:
      return null;
  }
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;

  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatRelativeLabel(startedAtMs: number, timestamp: string): string | null {
  const ts = Date.parse(timestamp);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(ts)) return null;
  return `+${formatDuration(Math.max(0, ts - startedAtMs))}`;
}

function renderHeader(model: ReportModel): string {
  const resultMeta = model.aggregate.result === "success"
    ? { label: "SUCCESS", tone: "success" as const }
    : { label: "FAILURE", tone: "failure" as const };

  return `<header class="report-header" id="report-header">
    <div class="header-inner">
      <div class="header-row primary">
        <div class="header-main">
          <span class="task-id">${h(model.task.id)}</span>
          <div class="task-goal">${h(model.task.goal)}</div>
        </div>
        <div class="header-badges">
          <span class="pill tone-neutral">${h(model.task.mode)}</span>
          <span class="pill tone-${resultMeta.tone}">${resultMeta.label}</span>
        </div>
      </div>
      <div class="header-row">
        <div class="header-meta">
          <strong>${model.aggregate.totalSteps}</strong><span>steps</span>
          <span class="header-meta-sep">·</span>
          <strong>${h(formatDuration(model.aggregate.durationMs))}</strong>
          <span class="header-meta-sep">·</span>
          <span>${h(model.aggregate.endedBy)}</span>
          <span class="header-meta-sep">·</span>
          <span class="header-url">${h(model.task.url)}</span>
        </div>
      </div>
    </div>
  </header>`;
}

function renderSummary(model: ReportModel): string {
  let body = "";
  let cardClass = "card summary-card";

  if (model.summary) {
    const isCompact = model.summary.blockers.length === 0 && !model.summary.surprise;
    if (isCompact) {
      cardClass += " is-compact";
      body = `<div class="card-body">
        <div class="summary-lead">${h(model.summary.oneLineFeel)}</div>
        <div class="summary-overall">${h(model.summary.overall)}</div>
      </div>`;
    } else {
      const blockers = model.summary.blockers.length > 0
        ? `<div class="summary-notes">${model.summary.blockers.map((blocker) =>
            `<div class="summary-note tone-failure">${h(blocker)}</div>`).join("")}</div>`
        : `<div class="summary-muted">None</div>`;

      const surprise = model.summary.surprise
        ? `<div class="summary-note tone-neutral">${h(model.summary.surprise)}</div>`
        : `<div class="summary-muted">None</div>`;

      body = `<div class="card-body">
        <div class="summary-lead">${h(model.summary.oneLineFeel)}</div>
        <div class="summary-overall">${h(model.summary.overall)}</div>
        <div class="summary-grid">
          <div>
            <div class="section-label">Blockers</div>
            ${blockers}
          </div>
          <div>
            <div class="section-label">Surprise</div>
            ${surprise}
          </div>
        </div>
      </div>`;
    }
  } else {
    const quietMessage = model.summaryError
      ? `Summary unavailable. ${model.summaryError}`
      : "No summary available.";

    body = `<div class="card-body"><div class="summary-warning">${h(quietMessage)}</div></div>`;
  }

  return `<section class="${cardClass}" id="experience-summary">
    <div class="card-header"><div class="card-title">Experience Summary</div></div>
    ${body}
  </section>`;
}

function renderFlowCard(model: ReportModel): string {
  return `<section class="card flow-card" id="overview-flow">
    <div class="card-header">
      <div class="card-title">Step Flow</div>
    </div>
    <div class="card-body">
      ${renderMinimap(model)}
      ${renderFilterTabs(model)}
      ${renderStepList(model)}
    </div>
  </section>`;
}

function renderMinimap(model: ReportModel): string {
  const count = model.steps.length;

  if (count === 0) {
    return `<div class="miniwrap">
      <div class="minimap-frame">
        <div class="summary-muted">No steps yet.</div>
      </div>
    </div>`;
  }

  const segments = model.steps.map((step, index) => {
    const x = Math.floor((index / count) * MINIMAP_WIDTH);
    const nextX = Math.floor(((index + 1) / count) * MINIMAP_WIDTH);
    const width = Math.max(1, nextX - x);
    const meta = STATUS_META[step.status];
    return `<rect
      class="minimap-segment"
      data-step-index="${index}"
      data-tooltip="${h(`step ${step.stepNumber} · ${step.actionLabel} · ${step.statusLabel}`)}"
      tabindex="0"
      role="button"
      aria-label="${h(`step ${step.stepNumber} ${step.actionLabel} ${step.statusLabel}`)}"
      x="${x}"
      y="${MINIMAP_BAR_Y}"
      width="${width}"
      height="${MINIMAP_BAR_HEIGHT}"
      fill="${meta.color}"
      rx="1"
    />`;
  }).join("");

  const failureIndex = model.steps.findIndex((step) => step.isFailurePoint);
  const marker = failureIndex >= 0
    ? renderFailureMarker(failureIndex, count)
    : "";

  return `<div class="miniwrap">
    <div class="minimap-frame">
      <div class="minimap-selection-label" id="minimap-selection-label" aria-hidden="true"></div>
      <svg class="minimap-svg" id="step-minimap" viewBox="0 0 ${MINIMAP_WIDTH} ${MINIMAP_HEIGHT}" preserveAspectRatio="none" aria-label="Step minimap">
        ${segments}
        ${marker}
      </svg>
    </div>
    <div class="minimap-legend">
      <span class="legend-item"><span class="legend-swatch" style="background:#16a34a"></span>Success</span>
      <span class="legend-item"><span class="legend-swatch" style="background:#dc2626"></span>Failure</span>
      <span class="legend-item"><span class="legend-swatch" style="background:#94a3b8"></span>Progress</span>
      <span class="legend-item"><span class="legend-swatch" style="background:#d97706"></span>Stuck</span>
    </div>
  </div>`;
}

function renderFailureMarker(index: number, total: number): string {
  const center = total === 1
    ? MINIMAP_WIDTH / 2
    : (index / (total - 1)) * MINIMAP_WIDTH;
  const triangle = `${center - 10},16 ${center + 10},16 ${center},2`;
  return `<g class="failure-marker" aria-hidden="true">
    <circle class="failure-marker-halo" cx="${center}" cy="10" r="13" />
    <line class="failure-marker-pin" x1="${center}" y1="16" x2="${center}" y2="${MINIMAP_BAR_Y - 2}" />
    <polygon class="failure-marker-flag" points="${triangle}" />
  </g>`;
}

function renderFilterTabs(model: ReportModel): string {
  return `<div class="filter-tabs" role="tablist" aria-label="Step filters">
    ${FILTERS.map((filter, index) => `
      <button
        class="filter-tab${index === 0 ? " is-active" : ""}"
        type="button"
        data-filter-tab="${filter.key}"
        role="tab"
        aria-selected="${index === 0 ? "true" : "false"}"
      >
        <span>${filter.label}</span>
        <span class="filter-count">${model.filters[filter.key]}</span>
      </button>
    `).join("")}
  </div>`;
}

function renderStepList(model: ReportModel): string {
  const rows = model.steps.map((step) => {
    const filters = [
      step.isImportant ? "important" : "",
      step.isVerifyFail ? "verify-fail" : "",
      step.isFailurePoint ? "failure-point" : "",
      step.isVerdict ? "verdict" : "",
    ].filter(Boolean);

    const hidden = step.index < STEP_PAGE_SIZE ? "" : " is-hidden";
    const rowClasses = [
      "step-row",
      hidden.trim(),
      `is-status-${step.status}`,
      step.isFailurePoint ? "is-failure-point" : "",
      step.isVerdict && step.status === "success" ? "is-verdict-success" : "",
      step.isVerdict && step.status === "stuck" ? "is-verdict-stuck" : "",
    ].filter(Boolean).join(" ");
    const chipClass = step.isVerdict
      ? (step.status === "success" ? " is-verdict-success" : " is-verdict-stuck")
      : step.tone === "failure"
        ? " is-failure"
        : step.status === "normal"
          ? " is-muted"
          : "";

    return `<button
      class="${rowClasses}"
      type="button"
      data-step-index="${step.index}"
      data-filters="${filters.join(" ")}"
      aria-label="${h(`step ${step.stepNumber} ${step.actionLabel}`)}"
    >
      <span class="step-number">step ${step.stepNumber}</span>
      <span class="step-content">
        <span class="step-topline">
          <span class="action-chip${chipClass}">${h(step.actionLabel)}</span>
          <span class="status-chip tone-${step.tone}">${h(step.statusLabel)}</span>
          ${step.relativeLabel ? `<span class="summary-muted">${h(step.relativeLabel)}</span>` : ""}
        </span>
        ${step.rationale ? `<span class="step-rationale">${h(step.rationale)}</span>` : ""}
        ${step.failureSummary ? `<span class="step-failure">${h(step.failureSummary)}</span>` : ""}
      </span>
    </button>`;
  }).join("");

  const emptyHidden = model.filters.all === 0 ? "" : " is-hidden";
  const totalPages = Math.max(1, Math.ceil(model.filters.all / STEP_PAGE_SIZE));

  return `<div class="step-list" id="step-list">
    ${rows}
    <div class="list-empty${emptyHidden}" id="step-list-empty">No steps in this filter.</div>
  </div>
  <div class="step-pagination" id="step-pagination">
    <button class="pagination-btn" type="button" id="page-prev" aria-label="Previous page" disabled>Prev</button>
    <div class="pagination-meta" id="page-meta">Page 1 / ${totalPages}</div>
    <button class="pagination-btn" type="button" id="page-next" aria-label="Next page"${totalPages > 1 ? "" : " disabled"}>Next</button>
  </div>`;
}

function renderActionCard(model: ReportModel): string {
  const content = model.actionBreakdown.length > 0
    ? `<div class="action-bars">${model.actionBreakdown.map((item) => `
        <div class="action-row">
          <div class="action-label">${h(item.label)}</div>
          <div class="action-bar"><div class="action-fill" style="width:${item.percent}%"></div></div>
          <div class="action-meta">${item.count} · ${item.percent}%</div>
        </div>
      `).join("")}</div>`
    : `<div class="summary-muted">No actions recorded.</div>`;

  return `<section class="card metric-card" id="action-breakdown">
    <div class="card-header"><div class="card-title">Action Breakdown</div></div>
    <div class="card-body">${content}</div>
  </section>`;
}

function renderTimingCard(model: ReportModel): string {
  let content = `<div class="summary-muted">No timing data yet.</div>`;

  if (model.sparkline) {
    const sparkline = model.sparkline;
    const hotspots = sparkline.hotspots.map((hotspot) => {
      const half = hotspot.width / 2;
      const x = Math.max(0, Math.min(sparkline.width - hotspot.width, hotspot.x - half));
      return `<rect
        class="sparkline-hotspot"
        data-step-index="${hotspot.index}"
        data-tooltip="${h(hotspot.tooltip)}"
        tabindex="0"
        role="button"
        aria-label="${h(hotspot.tooltip)}"
        x="${x.toFixed(2)}"
        y="0"
        width="${hotspot.width.toFixed(2)}"
        height="${sparkline.height}"
      />`;
    }).join("");

    const dots = sparkline.hotspots.map((hotspot) =>
      `<circle cx="${hotspot.x.toFixed(2)}" cy="${hotspot.y.toFixed(2)}" r="2.4" fill="#2563eb" />`
    ).join("");

    content = `<div class="sparkline-wrap">
      <div class="sparkline-frame">
        <svg class="sparkline-svg" id="timing-sparkline" viewBox="0 0 ${sparkline.width} ${sparkline.height}" preserveAspectRatio="none" aria-label="Decision time sparkline">
          <line x1="0" y1="${sparkline.height - 10}" x2="${sparkline.width}" y2="${sparkline.height - 10}" stroke="#e6e7e2" stroke-width="1" />
          <polyline fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${sparkline.path}" />
          ${dots}
          ${hotspots}
        </svg>
      </div>
      <div class="sparkline-meta">
        <span>Decision</span>
        <span>Max ${h(formatDuration(sparkline.maxDecideMs))}</span>
      </div>
    </div>`;
  }

  return `<section class="card metric-card" id="timing-overview">
    <div class="card-header"><div class="card-title">Decision Time</div></div>
    <div class="card-body">${content}</div>
  </section>`;
}

function renderPanelShell(): string {
  return `<aside class="detail-panel" id="detail-panel" aria-live="polite">
    <div class="detail-panel-header" id="detail-panel-header">
      <div class="detail-panel-title">
        <div class="detail-step-line">Step</div>
        <div class="detail-step-meta">Select a step</div>
      </div>
      <div class="detail-panel-controls">
        <button class="panel-btn" type="button" aria-label="Close detail panel" disabled>Close</button>
      </div>
    </div>
    <div class="detail-panel-body" id="detail-panel-body">
      <div class="detail-placeholder">Select a step</div>
    </div>
  </aside>`;
}

function h(value: string | number | null | undefined): string {
  return escapeHtml(String(value ?? ""));
}
