import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateTrace, writeJsonAtomic, type RunTrace } from "@rawstep/core/trace";
import { validateAnalysisReport, type AnalysisReport } from "../analyze/index.js";
import { isStuck, isWrongGuess, runEnding, type EndingOf, type RunEnding } from "../endings/index.js";
import type { Hint, HintReport } from "../hints/index.js";
import { record } from "../internal/guards.js";
import { actionLabel, eventGrounds, summarizeTrace, type ReportSummary } from "./summary.js";

export { summarizeTrace } from "./summary.js";
export type { ReportSummary, ReportCounts, ReportAction, ReportFailure, ReportVerification, ReportVerificationRule } from "./summary.js";

export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
}

/**
 * Every sentence of the report is written in both languages and the page shows one of them (`html[lang]`), so the report stays one
 * self-contained file. Both arguments are HTML: the caller escapes whatever it puts in them.
 */
function bi(en: string, ko: string): string { return `<span class="l-en" lang="en">${en}</span><span class="l-ko" lang="ko">${ko}</span>`; }
function evidenceLink(id: string): string { return `<a href="#${escapeHtml(id)}">${escapeHtml(id)}</a>`; }
function resultWords(passed: boolean | undefined): [string, string] { return passed === true ? ["Passed", "충족"] : passed === false ? ["Not satisfied", "충족하지 않음"] : ["Not recorded", "기록 없음"]; }
const plural = (count: number, one: string, many: string) => count === 1 ? one : many;

/**
 * The only script of the report: it picks English or Korean (the reader's saved choice, else the browser's language), keeps
 * `<html lang>` in step and wires the two language buttons. It reads nothing from the report and writes only the language key.
 * Its text is fixed, so the content security policy names its hash instead of allowing inline scripts in general.
 */
export const REPORT_SCRIPT = `(function(){var K="rawstep.language",d=document,r=d.documentElement,l="";
try{var s=localStorage.getItem(K);if(s==="ko"||s==="en")l=s}catch(e){}
if(!l){var n=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language||""];l=n.some(function(x){return String(x).toLowerCase().indexOf("ko")===0})?"ko":"en"}
function set(v,save){l=v;r.lang=v;var b=d.querySelectorAll("[data-lang]");for(var i=0;i<b.length;i++)b[i].setAttribute("aria-pressed",b[i].getAttribute("data-lang")===v?"true":"false");if(save){try{localStorage.setItem(K,v)}catch(e){}}}
r.lang=l;
function bind(){var b=d.querySelectorAll("[data-lang]");for(var i=0;i<b.length;i++)b[i].addEventListener("click",function(e){set(e.currentTarget.getAttribute("data-lang"),true)});set(l,false)}
if(d.readyState==="loading")d.addEventListener("DOMContentLoaded",bind);else bind()})();`;
/** The content security policy source of `REPORT_SCRIPT`, for the page's own policy and for a server that sends the policy as a header. */
export const REPORT_SCRIPT_HASH = `'sha256-${createHash("sha256").update(REPORT_SCRIPT).digest("base64")}'`;
/** The policy of the report: no remote loads and no script but the one above. A server adds what it needs (`img-src data:`, `sandbox allow-scripts`). */
export const REPORT_CSP = `default-src 'none'; style-src 'unsafe-inline'; script-src ${REPORT_SCRIPT_HASH}; base-uri 'none'; form-action 'none'`;

/** How a run ended, in the words of the question Rawstep answers. These are the cost of reaching the goal and where the user stopped, not a grade. */
const ENDINGS: Record<RunEnding, [string, string]> = {
  reached: ["Reached the goal", "목표에 닿음"],
  "gave-up": ["Gave up", "포기함"],
  mistaken: ["Said it was done, but the goal was not reached", "끝났다고 했지만 목표에는 닿지 않음"],
  unmeasured: ["Not measured", "측정 못 함"],
};
const STOPPED_BY: Record<string, [string, string]> = {
  "planner-calls": ["the planner-call limit", "계획 호출 한도"],
  "no-allowed-action": ["no allowed action", "허용된 동작 없음"],
  "max-steps": ["the move limit", "최대 행동 수"],
  timeout: ["the time limit", "시간 한도"],
  "repetition-guard": ["the repetition guard", "반복 감시"],
  "model-uncertain": ["the model was not sure", "모델이 확신하지 못함"],
  "planner-timeout": ["the planner did not answer in time", "계획 모델이 제때 답하지 않음"],
  blocked: ["the site blocked the browser", "사이트가 브라우저를 막음"],
  environment: ["the page environment could not be applied", "페이지 환경을 적용하지 못함"],
  other: ["another cause", "다른 원인"],
};

function endingOf(trace: RunTrace): EndingOf | undefined {
  return runEnding(trace.outcome, typeof trace.outcome?.policyStopSource === "string" ? trace.outcome.policyStopSource : undefined);
}
function targetText(target: { role: string; name?: string } | undefined): string {
  return target ? `${target.role}${target.name ? ` “${target.name}”` : ""}` : "";
}

const GENERATED_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** What to call the task: the name it has in the project, else its own id unless that is only a generated one. */
function taskTitle(trace: RunTrace, name?: string): string | undefined {
  return name?.trim() || (trace.task.id && !GENERATED_ID.test(trace.task.id) ? trace.task.id : undefined);
}
/** The task's name and goal on one line: what this run was asked to do, before anything about how it went. */
function renderHeader(trace: RunTrace, name?: string): string {
  const e = escapeHtml, goal = typeof trace.task.goal === "string" ? trace.task.goal.trim() : "", title = taskTitle(trace, name);
  return `<h1>${title ? `<span class="task">${e(title)}</span>` : ""}${goal ? `<span class="goal">${title ? " · " : ""}${e(goal)}</span>` : ""}</h1>`;
}

/**
 * What was hard in this run, from the signals it recorded: the stuck places (what the user pressed that did not respond as expected),
 * wrong guesses, the longest stretch without a goal word and why it stopped early. A list of recorded signals, never a verdict.
 */
function renderHard(trace: RunTrace, summary: ReportSummary, hints?: HintReport): string {
  const e = escapeHtml, ending = endingOf(trace), items: string[] = [];
  const found: Hint[] = hints?.hints ?? [];
  const stuck = new Map<string, { target: Hint["target"]; steps: number[] }>();
  for (const hint of found.filter((item) => item.kind === "expectation-broken" && isStuck(item))) {
    const key = targetText(hint.target), place = stuck.get(key) ?? { target: hint.target, steps: [] };
    place.steps.push(...hint.steps.slice(0, 1)); stuck.set(key, place);
  }
  const places = [...stuck.entries()];
  for (const [key, place] of places.slice(0, 5)) {
    const steps = [...new Set(place.steps)].sort((a, b) => a - b).join(", "), many = new Set(place.steps).size;
    const label = key ? `<strong>${e(key)}</strong>` : bi("An element", "어떤 요소");
    items.push(`<li>${label}: ${bi(`pressed, and it did not respond as the user expected (${plural(many, "step", "steps")} ${e(steps)}).`, `눌렀지만 사용자의 예상대로 반응하지 않았습니다 (행동 ${e(steps)}번).`)}</li>`);
  }
  if (places.length > 5) items.push(`<li>${bi(`${places.length - 5} more stuck places.`, `막힌 곳이 ${places.length - 5}곳 더 있습니다.`)}</li>`);
  const wrong = found.filter((item) => item.kind === "expectation-broken" && isWrongGuess(item)).length;
  if (wrong) items.push(`<li>${bi(`${wrong} ${plural(wrong, "guess", "guesses")} about where something is turned out wrong.`, `어디에 무엇이 있을지 예상했다가 틀린 경우가 ${wrong}번 있었습니다.`)}</li>`);
  const stretch = found.find((item) => item.kind === "goal-word-stretch")?.detail.moves;
  if (typeof stretch === "number") items.push(`<li>${bi(`${stretch} ${plural(stretch, "move", "moves")} in a row without hearing a word about the goal.`, `목표와 관련된 낱말을 듣지 못한 채 ${stretch}번 연속 행동했습니다.`)}</li>`);
  const others = found.filter((item) => item.source === "page").length;
  if (others) items.push(`<li>${bi(`${others} ${plural(others, "place", "places")} on the page worth a look (see Friction hints in the details).`, `페이지에서 더 살펴볼 지점이 ${others}곳 있습니다. (자세히의 마찰 힌트 참고)`)}</li>`);
  if (ending?.ending === "gave-up") {
    const giveUp = found.find((item) => item.kind === "early-stop")?.detail.giveUp as { reason?: unknown } | undefined, said = typeof giveUp?.reason === "string" ? giveUp.reason : "";
    items.push(`<li>${bi(`The user gave up: nothing they heard left another way to try.${said ? ` In their words: ${e(said)}` : ""}`, `사용자가 포기했습니다. 들은 것만으로는 더 해볼 방법이 없다고 판단했습니다.${said ? ` 사용자의 말: ${e(said)}` : ""}`)}</li>`);
  } else if (ending?.ending === "mistaken") {
    items.push(`<li>${bi("The user said the goal was reached, but the completion check disagreed.", "사용자는 목표에 닿았다고 했지만, 완료 확인으로는 닿지 않았습니다.")}</li>`);
  } else if (ending?.ending === "unmeasured") {
    const by = STOPPED_BY[ending.by ?? "other"];
    items.push(`<li>${bi(`The run stopped before the user decided anything (${by ? by[0] : e(ending.by)}), so it says nothing about the user.`, `사용자가 판단하기 전에 멈췄습니다 (${by ? by[1] : e(ending.by)}). 그래서 사용자에 대해서는 알 수 없습니다.`)}</li>`);
  }
  if (summary.firstFailure && ending?.ending !== "reached") items.push(`<li>${bi(`First recorded problem: ${e(summary.firstFailure.message)}`, `처음 기록된 문제: ${e(summary.firstFailure.message)}`)}</li>`);
  return `<section aria-labelledby="hard"><h2 id="hard">${bi("What was hard", "어려웠던 점")}</h2>
${items.length ? `<ul>${items.join("")}</ul>` : `<p>${bi("No stuck places, wrong guesses or early stop were recorded for this run. This lists recorded signals only; it does not mean nothing was hard.", "이 실행에는 막힌 곳, 틀린 추측, 일찍 멈춘 기록이 없습니다. 기록된 신호만 모은 것이라, 어려운 점이 없었다는 뜻은 아닙니다.")}</p>`}
${hints ? "" : `<p class="muted">${bi("This report was made without friction hints, so stuck places and wrong guesses are not listed.", "이 보고서에는 마찰 힌트가 없어서 막힌 곳과 틀린 추측은 나오지 않습니다.")}</p>`}</section>`;
}

/** How the run ended and what reaching or leaving the goal cost: moves, written as a cost and not as a pass or fail mark. */
function renderEnding(trace: RunTrace, summary: ReportSummary): string {
  const outcome = trace.outcome, ending = endingOf(trace), e = escapeHtml;
  const moves = typeof outcome?.steps === "number" ? outcome.steps : summary.actions.length;
  const label = ending ? bi(ENDINGS[ending.ending][0], ENDINGS[ending.ending][1]) : bi("Not finished", "끝나지 않음");
  const by = ending?.by ? STOPPED_BY[ending.by] : undefined;
  const started = Date.parse(trace.startedAt), ended = trace.endedAt ? Date.parse(trace.endedAt) : NaN;
  const seconds = Number.isFinite(started) && Number.isFinite(ended) && ended >= started ? ((ended - started) / 1000).toFixed(1) : undefined;
  return `<section aria-labelledby="ending"><h2 id="ending">${bi("How it ended and what it cost", "어떻게 끝났고 얼마나 들었나")}</h2>
<p class="ending">${label} · ${bi(`${moves} ${plural(moves, "move", "moves")}`, `${moves}번 행동`)}</p>
${ending?.by ? `<p>${bi(`Stopped by ${by ? by[0] : e(ending.by)}.`, `멈춘 원인: ${by ? by[1] : e(ending.by)}.`)}</p>` : ""}
<p class="muted">${bi("A move is one key press or command the simulated user sent.", "한 번은 시뮬레이션한 사용자가 보낸 키 입력이나 명령 하나입니다.")}${seconds ? ` ${bi(`It took ${seconds} s.`, `걸린 시간은 ${seconds}초입니다.`)}` : ""}</p>
${summary.modality === "simulation" || summary.modality === "mixed" ? `<p class="muted">${bi("This run used a simulated VoiceOver, an approximation and not Apple VoiceOver.", "이 실행은 시뮬레이션한 VoiceOver를 썼습니다. 근사한 것이며 Apple VoiceOver가 아닙니다.")}</p>` : ""}</section>`;
}

function renderSummary(trace: RunTrace, summary: ReportSummary): string {
  const e = escapeHtml;
  const counts = summary.counts;
  const modality = summary.modality === "simulation" ? bi("Simulated VoiceOver run", "시뮬레이션한 VoiceOver 실행") : summary.modality === "screenreader" ? bi("Screen-reader run", "스크린리더 실행") : summary.modality === "mixed" ? bi("Mixed observation evidence", "섞인 관찰 기록") : bi("Observation modality not recorded", "관찰 방식이 기록되지 않음");
  const hasNative = summary.modalities.includes("screenreader") || summary.modality === "unknown";
  const hasSimulation = summary.modalities.includes("simulation");
  const outcome = trace.outcome;
  const cancellation = record(outcome?.cancellation);
  const failure = summary.firstFailure;
  return `<section aria-labelledby="outcome"><h2 id="outcome">${bi("Recorded run outcome", "기록된 실행 결과")}</h2>
<p class="outcome">${e(outcome?.status ?? "unfinished")}${outcome?.reason ? `: ${e(outcome.reason)}` : ""}</p>
${typeof outcome?.policyStopSource === "string" && ["model", "planner", "exploration-guard", "user-gave-up", "orchestration-limit", "no-allowed-action"].includes(outcome.policyStopSource) ? `<p>${bi("Stop source:", "멈춘 주체:")} ${e(outcome.policyStopSource)}</p>` : ""}
${typeof outcome?.error === "string" ? `<p>${e(outcome.error)}</p>` : ""}
${typeof outcome?.stage === "string" ? `<p>${bi(`Stage: ${e(outcome.stage)}${typeof outcome.step === "number" ? ` · step ${e(outcome.step)}` : ""}`, `단계: ${e(outcome.stage)}${typeof outcome.step === "number" ? ` · ${e(outcome.step)}번째 행동` : ""}`)}</p>` : ""}
${typeof cancellation.signal === "string" ? `<p>${bi(`Cancellation: ${e(cancellation.signal)}`, `취소: ${e(cancellation.signal)}`)}</p>` : ""}
<p>${bi("Started", "시작")} ${e(trace.startedAt)}${trace.endedAt ? ` · ${bi("ended", "종료")} ${e(trace.endedAt)}` : ""}</p>
<p>${modality} · ${bi(`${counts.events} events · ${summary.actions.length} action attempts`, `이벤트 ${counts.events}개 · 행동 시도 ${summary.actions.length}번`)}</p>
${hasNative ? `<p>${bi(`${counts.readableSpeechEvents} readable native screen-reader output events. Transport responses and acknowledgments are not speech evidence.`, `읽을 수 있는 실제 스크린리더 출력 이벤트가 ${counts.readableSpeechEvents}개 있습니다. 전송 응답과 수신 확인은 음성의 근거가 아닙니다.`)}</p>` : ""}
${hasSimulation ? `<p>${bi(`<strong>Simulated VoiceOver approximation. This is not Apple VoiceOver.</strong> ${counts.readableSimulationOutputEvents} readable simulated output events. Generated wording and browser actions cannot establish native screen-reader behavior or accessibility conformance.`, `<strong>시뮬레이션한 VoiceOver는 근사한 것이며 Apple VoiceOver가 아닙니다.</strong> 읽을 수 있는 시뮬레이션 출력 이벤트가 ${counts.readableSimulationOutputEvents}개 있습니다. 만들어 낸 문구와 브라우저 동작만으로는 실제 스크린리더의 동작이나 접근성 준수를 확인할 수 없습니다.`)}</p>` : ""}
<p>${bi("Recorded actions and verifier results describe this run only; they do not establish accessibility conformance. Collection windows and command IDs provide temporal context, not proof of speech causality.", "기록된 행동과 완료 확인 결과는 이 실행에 대한 것일 뿐, 접근성 준수를 보증하지 않습니다. 수집 구간과 명령 ID는 시간 순서를 알려 줄 뿐, 음성이 그 명령 때문에 나왔다는 증거가 아닙니다.")}</p>
<h3>${bi("First recorded failure or interruption", "처음 기록된 실패나 중단")}</h3>
${failure ? `<p>${e(failure.type)}${failure.step !== undefined ? ` · ${bi(`step ${e(failure.step)}`, `${e(failure.step)}번째 행동`)}` : ""}${failure.stage ? ` · ${e(failure.stage)}` : ""}${failure.eventId ? ` · ${evidenceLink(failure.eventId)}` : ""}</p><p>${e(failure.message)}</p><p>${bi("A recorded execution problem may have recovered later. The recorded run outcome above is authoritative.", "기록된 실행 문제는 나중에 회복되었을 수 있습니다. 위에 기록된 실행 결과가 기준입니다.")}</p>` : `<p>${bi("No failure or interruption recorded.", "기록된 실패나 중단이 없습니다.")}</p>`}
</section>
<section aria-labelledby="privacy"><h2 id="privacy">${bi("Privacy and evidence coverage", "개인정보와 기록 범위")}</h2>
<p>${bi(`Input values: ${e(trace.privacy.inputValues)}. Redaction applied: ${trace.privacy.redactionApplied ? "yes" : "no"}.`, `입력값: ${e(trace.privacy.inputValues)}. 가림 처리: ${trace.privacy.redactionApplied ? "했음" : "안 함"}.`)}</p>
<ul><li>${bi(`${counts.redactedEvents} of ${counts.events} events marked redacted`, `이벤트 ${counts.events}개 중 ${counts.redactedEvents}개를 가림 처리했습니다`)}</li>
${hasNative ? `<li>${bi(`${counts.redactedSpeechEvents} native screen-reader output events redacted; their original contents cannot be inspected`, `실제 스크린리더 출력 이벤트 ${counts.redactedSpeechEvents}개를 가렸습니다. 원래 내용은 볼 수 없습니다`)}</li>` : ""}
${hasSimulation ? `<li>${bi(`${counts.readableSimulationOutputEvents} readable simulated output events; ${counts.redactedSimulationOutputEvents} simulated output events redacted`, `읽을 수 있는 시뮬레이션 출력 이벤트 ${counts.readableSimulationOutputEvents}개, 가린 이벤트 ${counts.redactedSimulationOutputEvents}개`)}</li>` : ""}
<li>${bi(`${counts.diagnosticScreenshots} diagnostic screenshot references; ${counts.withheldDiagnosticScreenshots} diagnostic screenshots omitted for privacy`, `진단 스크린샷 참조 ${counts.diagnosticScreenshots}개, 개인정보 때문에 뺀 스크린샷 ${counts.withheldDiagnosticScreenshots}개`)}</li>
<li>${bi(`${counts.readableVerifierEvidence} readable verifier evidence events; ${counts.redactedVerifierEvidence} verifier evidence events redacted`, `읽을 수 있는 완료 확인 근거 ${counts.readableVerifierEvidence}개, 가린 근거 ${counts.redactedVerifierEvidence}개`)}</li></ul>
<p>${bi("Diagnostic screenshots are saved separately and are not policy observations. This report does not verify whether referenced image files are still present.", "진단 스크린샷은 따로 저장되며, 사용자가 관찰한 내용이 아닙니다. 참조한 이미지 파일이 아직 있는지는 이 보고서가 확인하지 않습니다.")}</p>
<p>${bi("Screenshots can contain personal information and are not anonymized. Redaction covers configured input values and recorded privacy boundaries, not every possible secret visible on a page.", "스크린샷에는 개인정보가 들어 있을 수 있고 익명화하지 않습니다. 가림 처리는 설정한 입력값과 기록된 개인정보 경계까지만 다루고, 페이지에 보이는 모든 비밀을 가리지는 않습니다.")}</p></section>`;
}

function renderActions(summary: ReportSummary): string {
  const e = escapeHtml;
  return `<section aria-labelledby="actions"><h2 id="actions">${bi("Action results", "행동 결과")}</h2>
<p>${bi("An action result reports execution; independent verification determines completion of the task.", "행동 결과는 실행이 됐는지만 알려 줍니다. 작업을 끝냈는지는 따로 하는 완료 확인으로 정합니다.")}</p>
${summary.actions.length ? `<div class="table-scroll"><table><caption>${bi("Recorded action attempts and their results", "기록된 행동 시도와 결과")}</caption><thead><tr><th scope="col">${bi("Step", "행동")}</th><th scope="col">${bi("Action", "동작")}</th><th scope="col">${bi("Execution result", "실행 결과")}</th><th scope="col">${bi("Evidence", "근거")}</th></tr></thead><tbody>${summary.actions.map(action => `<tr><td>${action.step ?? bi("Unknown", "알 수 없음")}</td><td>${e(actionLabel(action.action))}</td><td>${action.status === "not-recorded" ? bi("No result recorded", "결과가 기록되지 않음") : e(action.status)}${action.error ? `<br>${e(action.error)}` : ""}</td><td>${[action.decisionEventId, action.resultEventId, ...action.verificationEventIds].filter((id): id is string => Boolean(id)).map(evidenceLink).join("<br>")}</td></tr>`).join("")}</tbody></table></div>` : `<p>${bi("No action attempts recorded. The run may have stopped or failed before an action was attempted.", "기록된 행동 시도가 없습니다. 행동을 시도하기 전에 실행이 멈췄거나 실패했을 수 있습니다.")}</p>`}</section>`;
}

function renderVerification(trace: RunTrace, summary: ReportSummary): string {
  const e = escapeHtml;
  const eventsById = new Map(trace.events.map(event => [event.id, event]));
  return `<section aria-labelledby="verification"><h2 id="verification">${bi("Independent verification", "독립 완료 확인")}</h2>
${summary.verification.length ? summary.verification.map(result => `<article><h3>${bi(`${result.step === undefined ? "Verification" : `Step ${e(result.step)}`}: ${resultWords(result.passed)[0]}`, `${result.step === undefined ? "완료 확인" : `${e(result.step)}번째 행동`}: ${resultWords(result.passed)[1]}`)}</h3><p>${bi("Result:", "결과:")} ${evidenceLink(result.eventId)}</p>
${result.rules.length ? result.rules.map(rule => `<section class="rule"><h4>${bi(`Rule ${rule.ruleIndex + 1}: ${e(rule.ruleType)} · ${resultWords(rule.passed)[0]}`, `규칙 ${rule.ruleIndex + 1}: ${e(rule.ruleType)} · ${resultWords(rule.passed)[1]}`)}</h4>${rule.failure ? `<p>${e(rule.failure)}</p>` : ""}
${rule.evidenceEventIds.length ? rule.evidenceEventIds.map(id => {
    const event = eventsById.get(id)!;
    return `<div><p>${bi("Grounds:", "근거:")} ${evidenceLink(id)}${event.redacted ? ` · ${bi("redacted evidence; original text is unavailable", "가려진 근거입니다. 원래 글은 볼 수 없습니다")}` : ""}</p><pre>${e(JSON.stringify(eventGrounds(event), null, 2))}</pre></div>`;
  }).join("") : `<p>${bi("No per-rule evidence reference recorded.", "규칙별 근거 참조가 기록되지 않았습니다.")}</p>`}</section>`).join("") : `<p>${bi("No per-rule grounds recorded in this trace.", "이 기록에는 규칙별 근거가 없습니다.")}</p>${result.failures.length ? `<ul>${result.failures.map(failure => `<li>${e(failure)}</li>`).join("")}</ul>` : ""}`}</article>`).join("\n") : `<p>${bi("No verification result recorded.", "기록된 완료 확인 결과가 없습니다.")}</p>`}</section>`;
}

function renderEnvironmentDiagnostics(trace: RunTrace): string {
  const profileEvents = trace.events.filter(event => event.type === 'browser.profile');
  const diagnosticEvents = trace.events.filter(event => event.type === 'browser.accessibility-diagnostic');
  if (!profileEvents.length && !diagnosticEvents.length) return '';
  return `<section><h2>${bi("Applied environment and independent diagnostics", "적용한 환경과 독립 진단")}</h2><p>${bi("Browser media emulation, page user styles and native settings are distinct. These DOM diagnostics are not policy observations and do not establish accessibility conformance.", "브라우저 미디어 에뮬레이션, 페이지 사용자 스타일, 기기 자체 설정은 서로 다릅니다. 이 DOM 진단은 사용자가 관찰한 내용이 아니고, 접근성 준수를 보증하지도 않습니다.")}</p>${profileEvents.map(event=>`<h3>${bi("Requested versus observed settings", "요청한 설정과 관찰한 설정")}</h3><p>${evidenceLink(event.id)}</p><pre>${escapeHtml(JSON.stringify(event.data,null,2))}</pre>`).join('')}<h3>${bi("Focus, layout and error-state observations", "초점, 레이아웃, 오류 상태 관찰")}</h3>${diagnosticEvents.map(event=>`<details><summary>${evidenceLink(event.id)}${event.redacted?` · ${bi("omitted after input", "입력 뒤라 뺌")}`:''}</summary><pre>${escapeHtml(JSON.stringify(event.data,null,2))}</pre></details>`).join('')}</section>`;
}

function renderHints(hints: HintReport): string {
  const e = escapeHtml, seconds = (ms: number | null) => ms === null ? "unknown duration" : `${(ms / 1000).toFixed(1)} s`, secondsKo = (ms: number | null) => ms === null ? "시간을 알 수 없음" : `${(ms / 1000).toFixed(1)}초`;
  return `<section aria-labelledby="hints"><h2 id="hints">${bi("Friction hints", "마찰 힌트")}</h2>
<p>${bi(`Goal reached: ${hints.goalReached ? "yes" : "no"} · ${hints.steps} steps · ${e(seconds(hints.durationMs))}`, `목표 도달: ${hints.goalReached ? "예" : "아니요"} · 행동 ${hints.steps}번 · ${e(secondsKo(hints.durationMs))}`)}</p>
${hints.reference ? `<p>${bi(`Reference run ${e(hints.reference.runId)}: ${hints.reference.steps} steps · ${e(seconds(hints.reference.durationMs))}`, `기준 실행 ${e(hints.reference.runId)}: 행동 ${hints.reference.steps}번 · ${e(secondsKo(hints.reference.durationMs))}`)}</p>` : ""}
${hints.hints.length ? `<div class="table-scroll"><table><caption>${bi("Places worth a human look; hints are pointers, not verdicts", "사람이 살펴볼 만한 지점입니다. 힌트는 짚어 주는 것일 뿐 판정이 아닙니다")}</caption><thead><tr><th scope="col">${bi("Steps", "행동")}</th><th scope="col">${bi("Kind", "종류")}</th><th scope="col">${bi("Certainty", "확실성")}</th><th scope="col">${bi("Summary", "요약")}</th></tr></thead><tbody>${hints.hints.map(hint => `<tr><td>${e(hint.steps.join(", ") || "run")}</td><td>${e(hint.kind)}</td><td>${e(hint.certainty)}</td><td>${e(hint.summary)}</td></tr>`).join("")}</tbody></table></div>` : `<p>${bi("No friction hints.", "마찰 힌트가 없습니다.")}</p>`}
${hints.limitations.length ? `<ul>${hints.limitations.map(limitation => `<li>${e(limitation)}</li>`).join("")}</ul>` : ""}</section>`;
}

/**
 * Render escaped text only, with one fixed inline script that switches the language (`REPORT_SCRIPT`). No remote resources and no
 * embedded executable data. The page reads: the task and its goal, what was hard, how it ended and what it cost, then the details;
 * the run id is last.
 */
export type ReportOptions = {
  hints?: HintReport;
  /** The task's name in the project; without it the heading uses the task's id, or only its goal when the id was generated. */
  taskName?: string;
};
export function renderReportHtml(trace: RunTrace, analysis?: AnalysisReport, options: ReportOptions = {}): string {
  validateTrace(trace);
  if (analysis) validateAnalysisReport(analysis, trace);
  const e = escapeHtml;
  const summary = summarizeTrace(trace);
  const events = trace.events.map((event) => `<details id="${e(event.id)}" class="event"><summary>${event.seq}. ${e(event.type)} · ${e(event.id)}${event.redacted ? ` · ${bi("redacted", "가림")}` : ""}</summary>
<p>${e(event.timestamp)} · ${e(event.source)}${event.commandId ? ` · ${bi("command", "명령")} ${e(event.commandId)}` : ""}${event.redacted ? ` · ${bi("redacted", "가림")}` : ""}</p>
${event.collectionWindow ? `<p>${bi("Collection window:", "수집 구간:")} ${e(event.collectionWindow.startedAt)} ${bi("to", "~")} ${e(event.collectionWindow.endedAt)}</p>` : ""}
${event.association ? `<p>${bi("Temporal association only; this does not establish speech causality.", "시간 순서로만 이어 둔 것입니다. 음성이 그 때문에 나왔다는 증거는 아닙니다.")}</p>` : ""}
<pre>${e(JSON.stringify(event.data, null, 2))}</pre></details>`).join("\n");
  const findings = analysis?.findings.map((finding) => `<article><h3>${e(finding.title)}</h3><p>${e(finding.severity)} · ${e(finding.description)}</p>
<p>${bi("Evidence:", "근거:")} ${finding.evidenceEventIds.map((id) => `<a href="#${e(id)}">${e(id)}</a>`).join(", ")}</p></article>`).join("\n") ?? "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${e(REPORT_CSP)}">
<title>Rawstep · ${e(taskTitle(trace, options.taskName) ?? (typeof trace.task.goal === "string" ? trace.task.goal : trace.runId))}</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#18202b;background:#fff}h1,h2,h3,h4{line-height:1.25}h1{font-size:1.5rem;margin:.5rem 0 1rem}.goal{font-weight:400;color:#3d4756}article,.event{border:1px solid #d6dce5;border-radius:8px;padding:1rem;margin:1rem 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f2f5f8;padding:1rem}a{color:#0645ad}a:focus-visible,summary:focus-visible,button:focus-visible{outline:3px solid #125ea7;outline-offset:3px}p,td,summary,li{overflow-wrap:anywhere}summary{cursor:pointer;font-weight:600}.outcome{font-size:1.25rem;font-weight:700}.ending{font-size:1.25rem;font-weight:700}.muted{color:#4a5565;font-size:.9rem}.table-scroll{overflow-x:auto}table{border-collapse:collapse;width:100%}caption{text-align:left;margin-bottom:.5rem}th,td{border:1px solid #d6dce5;text-align:left;vertical-align:top;padding:.6rem}.rule{border-left:3px solid #d6dce5;padding-left:1rem}.event:target{border-color:#125ea7}details.context{margin:1rem 0}.langbar{display:flex;gap:.5rem;justify-content:flex-end}.langbar button{font:inherit;font-size:.9rem;padding:.2rem .7rem;border:1px solid #8b95a5;border-radius:6px;background:#fff;color:#18202b;cursor:pointer}.langbar button[aria-pressed=true]{background:#18202b;color:#fff;border-color:#18202b}html[lang=ko] .l-en{display:none}html:not([lang=ko]) .l-ko{display:none}footer{margin-top:2rem;padding-top:1rem;border-top:1px solid #d6dce5}</style>
<script id="language">${REPORT_SCRIPT}</script></head>
<body><div class="langbar" role="group" aria-label="Language / 언어"><button type="button" data-lang="en" aria-pressed="true">English</button><button type="button" data-lang="ko" aria-pressed="false">한국어</button></div>
<header>${renderHeader(trace, options.taskName)}</header>
<main>${renderHard(trace, summary, options.hints)}${renderEnding(trace, summary)}
<h2 class="details">${bi("Details", "자세히")}</h2>
${renderSummary(trace, summary)}${options.hints ? renderHints(options.hints) : ""}${renderActions(summary)}${renderEnvironmentDiagnostics(trace)}${renderVerification(trace, summary)}
<details class="context"><summary>${bi("Task", "작업")}</summary><pre>${e(JSON.stringify(trace.task, null, 2))}</pre></details>
<details class="context"><summary>${bi("Environment", "환경")}</summary><pre>${e(JSON.stringify(trace.environment, null, 2))}</pre></details>
<h2>${bi("Analysis", "분석")}</h2><p>${analysis ? `${e(analysis.status)} · ${e(analysis.analyzer.id)}` : bi("Not requested. This report requires no model or analyzer.", "요청하지 않았습니다. 이 보고서는 모델이나 분석기 없이도 만들어집니다.")}</p>
${analysis ? `<p>${e(analysis.summary)}</p>` : ""}${findings}
<h2>${bi(`Raw ordered evidence (${trace.events.length} events)`, `원본 증거, 순서대로 (이벤트 ${trace.events.length}개)`)}</h2><p>${bi("Expand an event to inspect the saved payload. Event ordering is recorder ordering.", "이벤트를 펼치면 저장된 내용을 볼 수 있습니다. 이벤트 순서는 기록된 순서입니다.")}</p>${events || `<p>${bi("No events recorded.", "기록된 이벤트가 없습니다.")}</p>`}</main>
<footer class="muted">${bi("Run", "실행")} ${e(trace.runId)} · ${bi("trace schema", "기록 형식")} ${e(trace.schemaVersion)}</footer></body></html>\n`;
}

export async function writeReport(trace: RunTrace, analysis: AnalysisReport | undefined, outDir: string, options: ReportOptions = {}): Promise<{ jsonPath: string; htmlPath: string }> {
  const html = renderReportHtml(trace, analysis, options);
  await mkdir(outDir, { recursive: true });
  const jsonPath = join(outDir, "report.json");
  const htmlPath = join(outDir, "report.html");
  // Report projections are separate files; execution evidence is never rewritten.
  await writeJsonAtomic(jsonPath, { schemaVersion: "1.0", runId: trace.runId, runOutcome: trace.outcome ?? null, analysis: analysis ?? null, ...(options.hints ? { hints: options.hints } : {}),
    eventCount: trace.events.length, privacy: trace.privacy, summary: summarizeTrace(trace) });
  await writeFile(htmlPath, html, { mode: 0o600 });
  return { jsonPath, htmlPath };
}
