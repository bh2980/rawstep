import { runTask } from '@rawstep/browser/runner';
import { createHash } from 'node:crypto';
import { runScreenshotTask, ScreenshotKeyboardBackend } from '@rawstep/browser/screenshot';
import { runMockVoiceOverTask, MockVoiceOverBackend } from '@rawstep/screenreaders/mock-voiceover';
import { AtDriverBackend, getAtDriverProfile } from '@rawstep/screenreaders/at-driver';
import { SystemOneHttpClient, OpenRouterSystemOneClient, VercelEvaluationClient, SystemOneSpeechPolicy, SystemOneScreenshotAdapter, type SystemOneClient } from '@rawstep/policies/systemone';
import { ScreenshotDecisionPolicy } from '@rawstep/policies/screenshot/policy';
import { validateModelResponse, type ScreenshotModelAdapter } from '@rawstep/policies/screenshot/model';
import { resolveEnvironmentProfile } from '@rawstep/browser/profiles';
import type { DecisionPolicy, Task } from '@rawstep/core/contracts';
import type { RunTrace } from '@rawstep/core/trace';
import { LlmChoiceClient, LlmScreenshotAdapter, LlmSpeechPolicy } from './llm.js';
import { boundedJson } from './models.js';
import { type DashboardConfig, type Permissions, type RunRecord, defaultInstructions } from '../shared/config.js';

export function backendCapabilities(config: DashboardConfig, mode: 'keyboard' | 'screenreader') {
  return mode === 'keyboard' ? new ScreenshotKeyboardBackend().capabilities : config.globals.backend === 'simulation' ? new MockVoiceOverBackend().capabilities : getAtDriverProfile(config.globals.backend).capabilities;
}
export function resolvePermissions(config: DashboardConfig, task: Task, mode: 'keyboard' | 'screenreader', override: Permissions | null): Permissions {
  const p = structuredClone(override ?? config.globals[mode]), capabilities = backendCapabilities(config, mode);
  if (p.keys.some(k => !(capabilities.keys as readonly string[]).includes(k)) || p.intents.some(k => !capabilities.intents.includes(k))) throw new Error('이 백엔드가 지원하지 않는 행동이 선택되었습니다.');
  const keys = Object.keys(task.input ?? {});
  const requested = p.inputKeys ?? keys;
  if (requested.some(k => !keys.includes(k))) throw new Error('작업에 없는 입력 이름이 선택되었습니다.');
  p.inputKeys = capabilities.textEntry && (p.typeText || p.replaceText) ? requested : [];
  p.typeText &&= capabilities.textEntry; p.replaceText &&= capabilities.replaceText;
  return p;
}
export async function executeRun(run: RunRecord, task: Task, outDir: string, apiKey: string | undefined, signal: AbortSignal): Promise<RunTrace> {
  const { model, connection, prompt, mode, globals } = run.snapshot;
  const deadline = Date.now() + (task.timeoutMs ?? 120000);
  const setupSignal = AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, deadline - Date.now()))]);
  const limits = globals.policy;
  let policy: DecisionPolicy;
  let screenshotModel: ScreenshotModelAdapter | undefined;
  if (model.family === 'LLM') {
    const client = new LlmChoiceClient(connection, model, prompt, apiKey);
    screenshotModel = new LlmScreenshotAdapter(client);
    policy = mode === 'keyboard' ? new ScreenshotDecisionPolicy({ ...limits, focusGate: undefined, model: screenshotModel }) : new LlmSpeechPolicy(client, limits.historyLimit);
  } else if (connection.provider === 'screenshot') {
    const fetchChoice = async (request: object, inner: AbortSignal) => {
      const value = await boundedJson(await fetch(connection.baseURL.replace(/\/$/, '') + '/choose', {
        method: 'POST', redirect: 'error', signal: AbortSignal.any([inner, AbortSignal.timeout(connection.timeoutMs)]),
        headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: 'Bearer ' + apiKey } : {}) },
        body: JSON.stringify(request),
      }));
      if (apiKey && JSON.stringify(value).includes(apiKey)) throw new Error('모델 응답에 인증 정보가 포함되었습니다.');
      return value;
    };
    let adapter: ScreenshotModelAdapter = { choose: async (request, {signal: inner}) => {
      const response = await fetchChoice(request, inner); validateModelResponse(response, request.choices); return response;
    } };
    if (model.promptEditable) {
      adapter = { choose: async (request, { signal: inner }) => {
        const response = await fetchChoice({ ...request, promptControl: 'client-v1', instructions: prompt.instructions, prompt: { id: prompt.id, version: prompt.version } }, inner);
        validateModelResponse(response, request.choices);
        if (response.model.id !== model.modelId) throw new Error('로컬 서버의 모델 ID가 변경되었습니다.');
        const hash = createHash('sha256').update(JSON.stringify({ instructions: prompt.instructions, choices: request.choices.map(c => ({ id: c.id, label: c.label })) })).digest('hex');
        if (response.prompt?.id !== prompt.id || response.prompt.version !== prompt.version || response.prompt.sha256 !== hash) throw new Error('서버가 요청한 프롬프트 적용 근거를 반환하지 않았습니다.');
        return response;
      } };
    } else {
      if (prompt.instructions !== defaultInstructions.keyboard) throw new Error('이 /choose 서버는 프롬프트 변경을 지원하지 않습니다.');
      const original = adapter;
      adapter = { choose: async (r, o) => { const answer = await original.choose(r, o); if (answer.model.id !== model.modelId) throw new Error('로컬 서버의 모델 ID가 변경되었습니다.'); return answer; } };
    }
    screenshotModel = adapter;
    policy = new ScreenshotDecisionPolicy({ ...limits, focusGate: limits.focusGate ? {} : undefined, model: adapter });
  } else {
    const opts = { baseURL: connection.baseURL, model: model.modelId, apiKey, timeoutMs: connection.timeoutMs };
    const capabilities = { inputs: model.inputs, maxChoices: model.maxChoices, maxImages: model.maxImages };
    const client: SystemOneClient = connection.provider === 'openrouter' ? new OpenRouterSystemOneClient({ ...opts, capabilities })
      : connection.provider === 'vercel' ? new VercelEvaluationClient(opts) : new SystemOneHttpClient({ ...opts, capabilities });
    await client.prepare?.({ signal: setupSignal });
    screenshotModel = new SystemOneScreenshotAdapter(client, prompt);
    policy = mode === 'keyboard' ? new ScreenshotDecisionPolicy({ ...limits, focusGate: limits.focusGate ? {} : undefined, model: screenshotModel })
      : new SystemOneSpeechPolicy(client, limits.historyLimit, prompt);
  }
  const common = { policy, outDir, signal, allowedActions: run.permissions,
    headless: mode === 'screenreader' && globals.backend !== 'simulation' ? false : globals.headless,
    browserExecutablePath: globals.browserExecutablePath || undefined };
  setupSignal.throwIfAborted();
  if (Date.now() >= deadline) throw new Error('실행 준비 중 작업 제한 시간을 초과했습니다.');
  const resolvedTask = { ...task, mode, timeoutMs: Math.max(1, deadline - Date.now()), profile: resolveEnvironmentProfile(run.snapshot.profile) };
  return mode === 'keyboard' ? runScreenshotTask(resolvedTask, { ...common, ...(run.diagnoseStop ? { stopReasonModel: screenshotModel, stopReasonTimeoutMs: Math.min(30000, connection.timeoutMs) } : {}) }) : globals.backend === 'simulation'
    ? runMockVoiceOverTask(resolvedTask, { ...common, warn: () => {} })
    : runTask(resolvedTask, { ...common, backend: new AtDriverBackend({ profile: globals.backend, url: globals.atEndpoint }) });
}
