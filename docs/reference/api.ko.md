# TypeScript 프로그래밍 API

Rawstep은 단일 패키지(`rawstep`)로 배포되며 기능별 서브패스(`rawstep/*`)를 제공합니다. TypeScript나 JavaScript 코드에서 직접 단일 태스크나 멀티 프로필 스위트를 실행하고, 트레이스를 읽거나 마찰 힌트를 추출할 수 있습니다.

---

## 1. 서브패스 모듈 개요

| 임포트 경로 | 주요 내보내기 항목 |
| :--- | :--- |
| **`rawstep`** | 루트 진입점. `runTask`, `runSuite`, `extractHints`, `aggregateHints`, `runEnding`, `readTrace`, `OrchestratedSpeechPolicy`, `LlmPlanner`, `MockVoiceOverBackend`, `AtDriverBackend`, `writeReport` 및 핵심 타입들을 재내보내기합니다. |
| **`rawstep/project`** | `runTask`, `runSuite`, `ProjectStore`, `initProject`, `parseConfig`, `defaultConfig`, `PROVIDERS`, `ProjectError`. |
| **`rawstep/contracts`** | `resolveTask`, `validateNavigation`, `describeInputs`, `matchesText`, `flattenVerifyRules`, `Task`, `VerifyRule`, `DecisionPolicy`, `Backend`, `ScreenReaderObservation`. |
| **`rawstep/policy`** | `OrchestratedSpeechPolicy`, `FixedPlanner`, `followPlan`, `applyDraft`, `renderPlanMarkdown`, `speechChoices`, `ScriptedPolicy`, `loadPolicy`. |
| **`rawstep/runner`** | 저수준 실행 함수 `runWithPolicy(task, options)`, `RunOptions`, `validateDecision`, `confirmationHeard`. |
| **`rawstep/mock-voiceover`** | `MockVoiceOverBackend`, `runMockVoiceOverTask`, `formatSimulatedSpeech`, `MOCK_VOICEOVER_PROFILE`. |
| **`rawstep/at-driver`** | `AtDriverBackend`, `AtDriverClient`, `getAtDriverProfile`, `AT_DRIVER_KEYS`, `AtDriverError`. |
| **`rawstep/hints`** | `extractHints`, `aggregateHints`, `writeHints`, `selectReference`, `summarizeRun`, `runEnding`, `runBroke`, `isMeasured`, `DEFAULT_HINT_THRESHOLDS`, `HINTS_SCHEMA_VERSION` (`"3.0"`), `buildBatchSummary`, `compareSummaries`, `measuredRuns`, `ranRuns`, `SUMMARY_SCHEMA_VERSION` (`"1.0"`). |
| **`rawstep/report`** | `renderReportHtml`, `writeReport`, `summarizeTrace`. |
| **`rawstep/analyze`** | `analyzeTrace`, `analyzeSavedTrace`, `deterministicAnalyzer`, `LlmTraceAnalyzer`, `readAnalysis`. |
| **`rawstep/trace`** | `TraceRecorder`, `FileTraceSink`, `MemoryTraceSink`, `readTrace`, `validateTrace`, `createRedactor`, `TRACE_SCHEMA_VERSION` (`"3.0"`), `OUTCOME_REASONS`, `RUN_STAGES`. |
| **`rawstep/verify`** | `verifyTask`, `evaluateVerifyRule`, `runScriptCheck`, `formatVerificationFeedback`. |
| **`rawstep/browser`** | `createBrowserSession`, `closeBrowserSession`, `settlePage`, `isBotCheckPage`, `watchPageActivity`. |
| **`rawstep/profiles`** | `resolveEnvironmentProfile`, `BUILTIN_PROFILES`, `DEFAULT_PROFILE`, `applyProfile`, `verifyLiveProfile`, `collectBrowserDiagnostics`. |
| **`rawstep/evidence`** | 제3자가 보고한 결과 2,914건을 담은 읽기 전용 데이터로, 근거가 어디까지 채워졌고 어디가 비었는지 측정하는 데 쓰입니다(실행에서는 사용하지 않습니다): `EVIDENCE_CATALOG`, `formatEvidenceSpeech`, `formatCorpusSpeech`, `summarizeEvidenceCoverage`, `selectEvidenceCases`, `compareEvidenceCase`, `runCorpusMockTask`. |
| **`rawstep/cli`** | `runCli`, `parseCliArguments`, `CLI_USAGE`, `CliUsageError`. |

---

## 2. 사용 예시

### 2.1 프로젝트 태스크 또는 스위트 실행 (`rawstep/project`)

프로젝트에 `rawstep.config.json`이 있을 때 사용하는 가장 간단한 방법입니다.

```typescript
import { runTask, runSuite } from 'rawstep/project';
import { runEnding } from 'rawstep/hints';

// 단일 태스크를 특정 프로필로 3회 반복 실행
const taskResult = await runTask('checkout', {
  projectDir: process.cwd(),
  profile: 'by-headings',
  repeat: 3,
});

for (const run of taskResult.runs) {
  const ending = runEnding(run.outcome);
  console.log(run.runId, ending?.ending ?? 'no outcome', `moves=${run.hints.steps}`);
}

// 또는 특정 태그가 붙은 태스크들을 여러 프로필에 걸쳐 병렬로 실행
const suiteResult = await runSuite({
  projectDir: process.cwd(),
  tags: ['smoke'],
  profiles: ['linear', 'by-headings'],
  repeat: 2,
  parallel: 2,
});

console.log('배치 저장 위치:', suiteResult.batch.dir);
```

### 2.2 설정 파일 없이 코드에서 단독 실행 (`rawstep/mock-voiceover` + `rawstep/policy`)

`rawstep.config.json` 없이 고정된 계획(`FixedPlanner`)이나 커스텀 `Planner`를 주입해 바로 실행할 수 있습니다.

```typescript
import { createHash } from 'node:crypto';
import { runMockVoiceOverTask } from 'rawstep/mock-voiceover';
import { OrchestratedSpeechPolicy, FixedPlanner } from 'rawstep/policy';
import type { PlanDraft } from 'rawstep/policy';
import { extractHints, runEnding } from 'rawstep/hints';

const draft: PlanDraft = {
  complete: false,
  rationale: 'Jump to the main heading and activate the Sign Up button.',
  strategy: 'Use headings navigation, then step to the CTA button.',
  criteria: [{ id: 'C1', text: 'Confirmation message is announced' }],
  assumptions: [{ id: 'A1', text: 'Sign Up button announces confirmation' }],
  phases: [
    {
      title: 'Reach and activate Sign Up',
      criteria: ['C1'],
      tasks: [
        {
          goal: 'Move to the Sign Up button',
          done: 'Sign Up, button is heard',
          cue: { name: 'Sign Up', role: 'button' },
          moves: ['next'],
          serves: ['C1'],
          relies: ['A1'],
        },
        {
          goal: 'Activate the Sign Up button',
          done: 'Welcome confirmation is heard',
          cue: 'Welcome',
          activates: true,
          serves: ['C1'],
          relies: ['A1'],
        },
      ],
    },
  ],
};

// 두 번째 인자에는 계획의 출처(파일 이름과 내용의 SHA-256)를 적습니다.
const planner = new FixedPlanner(draft, {
  file: 'sign-up-plan.json',
  sha256: createHash('sha256').update(JSON.stringify(draft)).digest('hex'),
});

// `outDir`은 폴더 경로이며, 트레이스(trace.json, trace.jsonl)가 여기에 저장됩니다.
const trace = await runMockVoiceOverTask(
  {
    url: 'https://example.com',
    goal: 'Activate the Sign Up button',
    verify: {
      all: [{ textVisible: 'Welcome' }],
    },
  },
  {
    policy: new OrchestratedSpeechPolicy(planner),
    outDir: './out/sign-up-run',
  }
);

console.log('종료 상태:', runEnding(trace.outcome));
console.log('추출된 힌트:', extractHints(trace).hints);
```

### 2.3 저장된 트레이스에서 힌트 추출 및 리포트 생성 (`rawstep/trace`, `rawstep/hints`, `rawstep/report`)

```typescript
import { readTrace } from 'rawstep/trace';
import { extractHints } from 'rawstep/hints';
import { writeReport } from 'rawstep/report';

const trace = await readTrace('.rawstep/experiments/<batch-id>/<run-id>');
const hints = extractHints(trace);

const { htmlPath, jsonPath } = await writeReport(
  trace,
  undefined,
  '.rawstep/experiments/<batch-id>/<run-id>',
  { hints }
);

console.log('생성된 HTML 리포트:', htmlPath);
```

## 직접 정책 작성하기

코드에서 `runMockVoiceOverTask`나 `runWithPolicy`(`rawstep/runner`)를 호출할 때는 `DecisionPolicy` 인터페이스를 직접 구현해 넘기거나, `.mjs`/`.js` 정책 모듈을 `loadPolicy`로 불러올 수도 있습니다.

```typescript
import type { DecisionPolicy } from 'rawstep/contracts';
import { runMockVoiceOverTask } from 'rawstep/mock-voiceover';

const myPolicy: DecisionPolicy = {
  async decide({ observation, allowedActions }) {
    const spoken = observation.speech.join(' ');
    if (spoken.includes('Get started') && allowedActions.intents.includes('activate')) {
      return { action: { kind: 'intent', intent: 'activate' } };
    }
    return { action: { kind: 'intent', intent: 'next' } };
  },
};

const trace = await runMockVoiceOverTask(
  {
    url: 'https://example.com',
    goal: 'Press Get started',
    verify: { all: [{ textVisible: 'Welcome' }] },
  },
  { policy: myPolicy, outDir: './out/custom-policy-run' }
);
```

---

## 3. 저장소 개발 명령어

Rawstep 모노레포 자체를 수정하거나 테스트할 때 사용하는 명령어입니다.

```bash
# 워크스페이스 의존성 설치 (Node >= 22.12.0 및 pnpm 10 필요)
corepack enable pnpm
pnpm install

# 의존성 순서대로 전체 패키지 빌드 및 packages/rawstep 번들링
npm run build

# 전체 패키지 및 테스트 TypeScript 타입 검사
npm run typecheck

# 유닛 테스트 실행 (Vitest)
npm test

# 직렬로 실행하는 Playwright 브라우저 통합 테스트 실행
npm run test:integration

# packages/rawstep 타르볼 패키징 및 격리 스모크 테스트
npm run test:package

# 전체 검증 게이트 실행 (build + typecheck + unit + integration + package smoke)
npm run check
```
