import { summarizeEvidenceCoverage } from '@rawstep/screenreaders/evidence/coverage';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { Backend, DecisionPolicy, Task } from '@rawstep/core/contracts';
import { resolveTask } from '@rawstep/core/contracts';
import { resolveEnvironmentProfile, type EnvironmentProfile, type BrowserDiagnostic } from '@rawstep/browser/profiles';
import { runTask, type RunOptions } from '@rawstep/browser/runner';
import type { ScreenshotModelAdapter } from '@rawstep/policies/screenshot/model';
import { runScreenshotTask } from '@rawstep/browser/screenshot';
import { runMockVoiceOverTask } from '@rawstep/screenreaders/mock-voiceover';
import { analyzeSavedTrace } from '@rawstep/reports/analyze';
import { writeReport, escapeHtml } from '@rawstep/reports/report';
import { writeJsonAtomic, createRedactor, type RunTrace } from '@rawstep/core/trace';

export type FindingCategory = 'confirmed-defect' | 'suspected-issue' | 'model-failure' | 'runtime-error' | 'unsupported-environment' | 'unsupported-pattern' | 'task-completed' | 'inconclusive';
export type HumanTestEvidence = { id: string; taskId: string; profileId?: string; observedAt: string; sourceUrl: string; sourceUrlRedacted?: true; consent: 'confirmed'; summary: string; result: 'confirmed-defect' | 'no-defect-observed' | 'inconclusive'; criterion?: string; reviewer: string };
export type MatrixRow = { profileId: string; profile: EnvironmentProfile; runId?: string; tracePath?: string; reportPath?: string; outcome?: RunTrace['outcome']; analysisStatus?: 'completed' | 'failed'; reportStatus?: 'completed' | 'failed'; classification: FindingCategory; findings: { source?: 'browser-diagnostic' | 'human-evidence'; sourceUrl?: string; category: FindingCategory; code: string; description: string; eventIds: string[] }[]; focusOrder: { step: number; identity?:string|null; node: string | null; eventId: string }[]; metrics: { actions: number; diagnostics: number; distinctFocusTargets: number; horizontalOverflow: number; clipping: number; overlaps: number; hiddenOrOccludedFocus: number }; error?: string };
export type MatrixReport = { schemaVersion: '1.0'; id: string; taskId: string; taskFingerprint: string; startedAt: string; endedAt?: string; cancellationSignal?: string; status: 'running' | 'completed' | 'aborted'; plannedProfiles: string[]; rows: MatrixRow[]; humanEvidence: HumanTestEvidence[]; evidenceCoverage?: unknown; limitations: string[] };
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
export function validateHumanEvidence(raw: unknown, taskId: string): HumanTestEvidence[] {
  if (!Array.isArray(raw)) throw new Error('Human-test evidence must be an array.');
  const ids = new Set<string>();
  return raw.map(item => {
    const v = object(item); const allowed = ['id','taskId','profileId','observedAt','sourceUrl','sourceUrlRedacted','consent','summary','result','criterion','reviewer'];
    if (Object.keys(v).some(k => !allowed.includes(k)) || typeof v.id !== 'string' || !v.id || ids.has(v.id) || v.taskId !== taskId || v.consent !== 'confirmed' || typeof v.summary !== 'string' || !v.summary.trim() || typeof v.reviewer !== 'string' || !v.reviewer.trim() || typeof v.observedAt !== 'string' || !Number.isFinite(Date.parse(v.observedAt)) || !['confirmed-defect','no-defect-observed','inconclusive'].includes(String(v.result)) || typeof v.sourceUrl !== 'string') throw new Error('Invalid human-test evidence; exact task identity, consent and source are required.');
    if (v.sourceUrlRedacted !== undefined && v.sourceUrlRedacted !== true) throw new Error('Invalid redacted-source marker.');
    let url:URL;try{url=new URL(v.sourceUrl)}catch{throw new Error('Invalid human-test evidence source URL.')} if (!['https:','http:','file:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid human-test evidence source URL.');
    for (const key of ['profileId','criterion']) if (v[key] !== undefined && typeof v[key] !== 'string') throw new Error(`Invalid human evidence ${key}.`);
    ids.add(v.id); return structuredClone(v) as HumanTestEvidence;
  });
}
export function taskFingerprint(task: Task): string {
  // Do not publish a digest of secret input values; compare task identity/goal/verifier and input names only.
  const { profile: _profile, input, ...rest } = resolveTask(task);
  return createHash('sha256').update(JSON.stringify({ ...createRedactor(Object.values(input ?? {}))(rest).value, inputKeys: Object.keys(input ?? {}).sort() })).digest('hex');
}
export function classifyRun(trace: RunTrace): FindingCategory {
  if (trace.outcome?.reason === 'unsupported-profile' || trace.events?.some(e=>(e.type==='browser.profile'&&object(e.data).supported===false)||(['browser.at-profile','browser.profile-check'].includes(e.type)&&object(e.data).verified===false))) return 'unsupported-environment';
  if (trace.outcome?.reason === 'unsupported-pattern') return 'unsupported-pattern';
  if (trace.outcome?.status === 'success') return 'task-completed';
  if (trace.outcome?.reason === 'error' || trace.outcome?.reason === 'trace-persistence-error') return 'runtime-error';
  if (['policy-stuck','verification-failed'].includes(String(trace.outcome?.reason)) && trace.outcome?.policyStopSource !== 'exploration-guard' && (trace.outcome?.policyStopSource==='model' || trace.events?.some(e=>e.type==='policy.evidence'&&object(object(e.data).evidence).kind==='model-inference'))) return 'model-failure';
  return 'inconclusive';
}
export function summarizeMatrixRow(trace: RunTrace, profile: EnvironmentProfile): MatrixRow {
  const findings: MatrixRow['findings'] = []; const focusOrder: MatrixRow['focusOrder'] = [];
  const metrics = { actions: trace.events.filter(e => e.type === 'action.result').length, diagnostics: 0, distinctFocusTargets: 0, horizontalOverflow: 0, clipping: 0, overlaps: 0, hiddenOrOccludedFocus: 0 };
  let previous: { d: BrowserDiagnostic; id: string; step: number } | undefined;
  let dialogOpener: string | null = null;
  for (const event of trace.events) {
    if (event.source !== 'browser-diagnostic' || event.type !== 'browser.accessibility-diagnostic' || event.redacted) continue;
    const data = object(event.data); const d = data.diagnostic as BrowserDiagnostic | undefined; if (d?.kind !== 'independent-browser-diagnostic') continue;
    const step = typeof data.step === 'number' ? data.step : 0; metrics.diagnostics++;
    if (!previous || d.documentId !== previous.d.documentId || (d.focus.identity??d.focus.id) !== (previous.d.focus.identity??previous.d.focus.id)) focusOrder.push({ step, identity:d.focus.identity, node: d.focus.id, eventId: event.id });
    for (const finding of d.findings) {
      findings.push({ category: 'suspected-issue', code: finding.code, description: finding.detail, eventIds: [event.id] });
      if (finding.code === 'horizontal-overflow') metrics.horizontalOverflow++;
      if (finding.code === 'text-clipping') metrics.clipping++;
      if (finding.code === 'control-overlap') metrics.overlaps++;
      if (['focused-element-hidden','focus-center-occluded','focus-outside-viewport'].includes(finding.code)) metrics.hiddenOrOccludedFocus++;
    }
    if (previous && previous.d.documentId===d.documentId) {
      if (!previous.d.modal.open && d.modal.open) dialogOpener = previous.d.focus.identity??previous.d.focus.id;
      if (previous.d.modal.open && !d.modal.open && dialogOpener && (d.focus.identity??d.focus.id) !== dialogOpener) findings.push({ category: 'suspected-issue', code: 'dialog-focus-not-restored', description: `Focus after modal close differs from observed opener ${dialogOpener}; intended workflow may justify a different destination.`, eventIds: [previous.id,event.id] });
      const action = trace.events.find(e => e.type === 'action.result' && object(e.data).step === step); const key = object(object(action?.data).action).key;
      if (key === 'Escape' && previous.d.modal.open && d.modal.open) findings.push({ category: 'suspected-issue', code: 'escape-did-not-close-modal', description: 'Modal remained open after Escape; inspect keyboard behavior and requirements.', eventIds: [previous.id,event.id] });
      if (d.errorState.invalidCount > previous.d.errorState.invalidCount && d.focus.id === previous.d.focus.id) findings.push({ category: 'suspected-issue', code: 'validation-focus-unchanged', description: 'Invalid-field state increased without a focus change; error messaging may still be sufficient.', eventIds: [previous.id,event.id] });
    }
    previous = { d, id: event.id, step };
  }
  metrics.distinctFocusTargets = new Set(focusOrder.map(x => x.identity??x.node).filter(Boolean)).size;
  return { profileId: profile.id, profile, runId: trace.runId, outcome: trace.outcome, classification: classifyRun(trace), findings, focusOrder, metrics };
}
export type MatrixOptions = Omit<RunOptions, 'backend' | 'policy' | 'outDir' | 'profile'> & { analyze?: typeof analyzeSavedTrace; reportWriter?: typeof writeReport; stopReasonModel?:ScreenshotModelAdapter;stopReasonTimeoutMs?:number;outDir: string; profiles: readonly (EnvironmentProfile | string)[]; mode: 'screenshot' | 'mock' | 'native'; createPolicy: (profile: EnvironmentProfile, options: {signal:AbortSignal}) => DecisionPolicy | Promise<DecisionPolicy>; createBackend?: (profile: EnvironmentProfile, options: {signal:AbortSignal}) => Backend | Promise<Backend>; humanEvidence?: unknown };
export async function runEnvironmentMatrix(source: Task, options: MatrixOptions): Promise<MatrixReport> {
  const task = resolveTask(source); if (!task.id) throw new Error('Matrix task requires a stable task id.');
  if (!options.profiles.length || options.profiles.length > 30) throw new Error('Matrix requires 1–30 profiles.');
  const profiles = options.profiles.map(resolveEnvironmentProfile); if (new Set(profiles.map(p => p.id)).size !== profiles.length) throw new Error('Matrix profile ids must be unique.');
  if (options.mode === 'native' && !options.createBackend) throw new Error('Native matrix requires a fresh backend factory.');
  const humanEvidence = validateHumanEvidence(options.humanEvidence ?? [], task.id);
  for (const item of humanEvidence) if (item.profileId && !profiles.some(p => p.id === item.profileId)) throw new Error('Human evidence references a profile outside this matrix.');
  await mkdir(dirname(options.outDir), {recursive:true});
  await mkdir(options.outDir, { recursive: false });
  const report: MatrixReport = { schemaVersion: '1.0', id: randomUUID(), taskId: task.id, taskFingerprint: taskFingerprint(task), startedAt: new Date().toISOString(), status: 'running', plannedProfiles: profiles.map(p => p.id), rows: [], humanEvidence, evidenceCoverage: profiles.map(profile=>({ profileId:profile.id, coverage:summarizeEvidenceCoverage({profileId:profile.at?.name?.toLowerCase() ?? (options.mode==='mock'?'mock-voiceover':'screenshot'),atVersion:profile.at?.version}) })), limitations: ['Matched task specification and separate browser/backend/policy instances per profile; trusted custom modules remain responsible for external/shared state.', 'Heuristic diagnostics and model failures do not establish accessibility defects.', 'Confirmed defects are only imported reviewer/user-test claims with explicit source and consent; Rawstep does not independently endorse them.', 'Human evidence can contain private information; the caller must minimize and authorize included details.'] };
  const redact = createRedactor(options.includeSensitiveInputValues ? [] : Object.values(task.input ?? {}));
  // IDs are caller-supplied metadata too. Avoid putting a named input in a path.
  const privateProfileIds = profiles.some(profile => redact(profile.id).redacted);
  const storedReport = (): MatrixReport => {
    const safe = redact(report).value;
    // Known structural values are not free payload; preserve report validity and links.
    Object.assign(safe, { schemaVersion:report.schemaVersion, id:report.id, taskFingerprint:report.taskFingerprint, startedAt:report.startedAt, endedAt:report.endedAt, status:report.status });
    for (const [i,row] of safe.rows.entries()) {
      const original=report.rows[i]!;
      Object.assign(row,{classification:original.classification,metrics:original.metrics,runId:original.runId,tracePath:original.tracePath,reportPath:original.reportPath,analysisStatus:original.analysisStatus,reportStatus:original.reportStatus});
      row.profile={...original.profile,id:row.profile.id,...(row.profile.at?{at:row.profile.at}:{})};
      if(row.outcome&&original.outcome){row.outcome.status=original.outcome.status;row.outcome.reason=original.outcome.reason;}
      row.focusOrder.forEach((focus,j)=>{focus.eventId=original.focusOrder[j]!.eventId;});
      row.findings.forEach((finding,j)=>{const previous=original.findings[j]!;finding.category=previous.category;finding.source=previous.source;finding.eventIds=previous.eventIds;if(previous.sourceUrl&&redact(previous.sourceUrl).redacted){delete finding.sourceUrl;finding.description+=' [Source URL omitted for input privacy.]';}});
    }
    safe.humanEvidence.forEach((item,i)=>{
      const original=report.humanEvidence[i]!;item.consent=original.consent;item.result=original.result;item.observedAt=original.observedAt;
      if(redact(original.id).redacted)item.id=`redacted-evidence-${i+1}`;
      if(redact(original.sourceUrl).redacted){item.sourceUrl='https://redacted.invalid/';item.sourceUrlRedacted=true;}
    });
    return safe;
  };
  const save = async () => { const safe=storedReport(); await writeJsonAtomic(join(options.outDir, 'matrix.json'), safe); await writeMatrixHtml(safe, join(options.outDir, 'matrix.html')); };
  await save();
  const policyInstances=new WeakSet<object>();const backendInstances=new WeakSet<object>();
  for (const profile of profiles) {
    if (options.signal?.aborted) { report.status = 'aborted'; break; }
    const directoryId=privateProfileIds?`profile-${profiles.indexOf(profile)+1}`:profile.id;
    const outDir = join(options.outDir, directoryId);
    const deadline=Date.now()+task.timeoutMs!;const remaining=()=>{const ms=deadline-Date.now();if(ms<=0)throw new Error('Matrix profile budget exhausted.');return ms;};
    let preparedBackend: Backend | undefined;
    let handedOff = false;
    try {
      const policy = await boundedSetup(signal=>options.createPolicy(profile,{signal}), options.signal, remaining()); if(policyInstances.has(policy))throw new Error('Matrix requires fresh policy instances.');policyInstances.add(policy);
      const runOptions = { ...options, policy, profile, outDir };
      let backend:Backend|undefined;
      if(options.mode==='native'){backend=await boundedSetup(signal=>options.createBackend!(profile,{signal}),options.signal,remaining(),value=>value.close());preparedBackend=backend;if(backendInstances.has(backend))throw new Error('Matrix requires fresh backend instances.');backendInstances.add(backend);}
      const runSource={...task,timeoutMs:remaining()};
      handedOff = true;
      const trace = options.mode === 'screenshot' ? await runScreenshotTask(runSource, runOptions) : options.mode === 'mock' ? await runMockVoiceOverTask(runSource, { ...runOptions, warn: () => {} }) : await runTask(runSource, { ...runOptions, backend: backend! });
      const row = summarizeMatrixRow(trace, profile);
      for (const human of humanEvidence.filter(h=>(!h.profileId||h.profileId===profile.id)&&h.result==='confirmed-defect')) row.findings.push({source:'human-evidence',sourceUrl:human.sourceUrl,category:'confirmed-defect',code:`human:${human.id}`,description:`Imported claim by ${human.reviewer}: ${human.summary}`,eventIds:[]}); row.tracePath = `${directoryId}/trace.json`;
      report.rows.push(row);
      let analysis: Awaited<ReturnType<typeof analyzeSavedTrace>> | undefined;
      try { analysis = await (options.analyze ?? analyzeSavedTrace)(outDir); row.analysisStatus = analysis.status; }
      catch { row.analysisStatus = 'failed'; }
      try {
        await (options.reportWriter ?? writeReport)(trace, analysis, outDir);
        row.reportStatus = 'completed'; row.reportPath = `${directoryId}/report.html`;
      } catch { row.reportStatus = 'failed'; }
    } catch {
      if(options.signal?.aborted){report.status='aborted';report.cancellationSignal=String(options.signal.reason ?? 'requested');break;}
      report.rows.push({ profileId: profile.id, profile, classification: 'runtime-error', findings: [], focusOrder: [], metrics: { actions: 0, diagnostics: 0, distinctFocusTargets: 0, horizontalOverflow: 0, clipping: 0, overlaps: 0, hiddenOrOccludedFocus: 0 }, error: 'Run setup or report generation failed; raw error omitted for privacy. Inspect any partial trace.' });
    } finally { if (preparedBackend && !handedOff) await preparedBackend.close(); }
    await save();
  }
  if (report.status === 'running') report.status = options.signal?.aborted ? 'aborted' : 'completed'; if(options.signal?.aborted)report.cancellationSignal=String(options.signal.reason ?? 'requested'); report.endedAt = new Date().toISOString(); await save(); return storedReport();
}
export async function readMatrix(path: string): Promise<MatrixReport> {
  const value = JSON.parse(await readFile(path, 'utf8')) as MatrixReport;
  if (value.schemaVersion !== '1.0' || typeof value.taskId !== 'string' || !Array.isArray(value.rows) || !Array.isArray(value.plannedProfiles) || !['running','completed','aborted'].includes(value.status)) throw new Error('Invalid matrix report.');
  value.humanEvidence = validateHumanEvidence(value.humanEvidence, value.taskId); return value;
}
async function writeMatrixHtml(report: MatrixReport, path: string): Promise<void> {
  const { writeFile } = await import('node:fs/promises'); const e = escapeHtml;
  const baseline=report.rows.find(row=>!['unsupported-environment','unsupported-pattern','runtime-error'].includes(row.classification)&&row.metrics.diagnostics>0);
  const deltas=baseline?report.rows.filter(row=>row!==baseline).map(row=>({profileId:row.profileId,relativeTo:baseline.profileId,comparable:!['unsupported-environment','unsupported-pattern','runtime-error'].includes(row.classification),taskCompleted:row.classification==='task-completed',actionDelta:['unsupported-environment','unsupported-pattern','runtime-error'].includes(row.classification)?null:row.metrics.actions-baseline.metrics.actions,focusTargetDelta:['unsupported-environment','unsupported-pattern','runtime-error'].includes(row.classification)?null:row.metrics.distinctFocusTargets-baseline.metrics.distinctFocusTargets,horizontalOverflowDelta:['unsupported-environment','unsupported-pattern','runtime-error'].includes(row.classification)?null:row.metrics.horizontalOverflow-baseline.metrics.horizontalOverflow,limitation:'Different model decisions mean different coverage; numerical differences do not by themselves establish environment-caused defects.'})):[];
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'"><title>Rawstep environment matrix</title><style>body{font:16px/1.5 system-ui;max-width:1200px;margin:2rem auto;padding:1rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:.6rem;text-align:left}pre{white-space:pre-wrap}a{color:#0645ad}</style><h1>Environment matrix: ${e(report.taskId)}</h1><p>${e(report.status)} · ${report.rows.length}/${report.plannedProfiles.length} profiles executed</p><p>Matching task fingerprint: ${e(report.taskFingerprint)}</p><ul>${report.limitations.map(x=>`<li>${e(x)}</li>`).join('')}</ul><table><thead><tr><th>Profile</th><th>Run result</th><th>Actions / focus targets</th><th>Layout observations</th><th>Evidence</th></tr></thead><tbody>${report.rows.map(row=>`<tr><td>${e(row.profileId)}</td><td>${e(row.classification)}<br>Analysis: ${e(row.analysisStatus??'unknown')}; report: ${e(row.reportStatus??'unknown')}<br>${e(row.outcome?.reason??row.error??'')}</td><td>${row.metrics.actions} / ${row.metrics.distinctFocusTargets}</td><td>Overflow ${row.metrics.horizontalOverflow}; clipping ${row.metrics.clipping}; overlap ${row.metrics.overlaps}</td><td>${row.reportPath?`<a href="${e(row.reportPath)}">Run report</a>`:'No finalized report'}</td></tr>`).join('')}</tbody></table>${report.rows.map(row=>`<details><summary>${e(row.profileId)}: profile, focus order and suspected findings</summary><pre>${e(JSON.stringify({profile:row.profile,focusOrder:row.focusOrder,findings:row.findings},null,2))}</pre></details>`).join('')}<h2>Compared with first supported observed profile</h2><pre>${e(JSON.stringify(deltas,null,2))}</pre><h2>Corpus coverage and gaps</h2><details><summary>Versioned source coverage and explicit missing patterns</summary><pre>${e(JSON.stringify(report.evidenceCoverage,null,2))}</pre></details><h2>Linked real-user/reviewer evidence</h2><p>Imported source claims, not simulated users or Rawstep conformance verdicts.</p>${report.humanEvidence.map(h=>`<article><h3>${e(h.result)}: ${e(h.id)}</h3><p>${e(h.summary)}</p><p>${e(h.reviewer)} · ${e(h.observedAt)} · ${h.sourceUrlRedacted?'Source URL omitted for input privacy':`<a href="${e(h.sourceUrl)}">Original evidence</a>`}</p></article>`).join('')}</html>`;
  await writeFile(path, html, { mode: 0o600 });
}

async function boundedSetup<T>(work:(signal:AbortSignal)=>T|Promise<T>, external:AbortSignal|undefined, timeoutMs:number, cleanup?:(value:T)=>Promise<unknown>):Promise<T>{
  const timeout=AbortSignal.timeout(timeoutMs);const signal=external?AbortSignal.any([external,timeout]):timeout;signal.throwIfAborted();
  return new Promise<T>((resolve,reject)=>{const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});Promise.resolve().then(()=>work(signal)).then(value=>{signal.removeEventListener('abort',abort);if(signal.aborted){void cleanup?.(value).catch(()=>{});reject(signal.reason)}else resolve(value)},error=>{signal.removeEventListener('abort',abort);reject(error)});});
}
