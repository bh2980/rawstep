# CONTRACTS

> 패키지 간 입출력 계약. TypeScript 타입 + JSON 예시로 고정한다.
> 산문이 아니라 **코드가 진실**이다. `packages/core/src/index.ts` 의 export와 1:1 대응해야 한다.

---

## §1. Task

```ts
export type UserModel = "keyboard" | "screenreader-strict" | "screenreader-hybrid";

export type Task = {
  id: string;              // kebab-case, 파일명과 일치
  url: string;             // http(s):// 또는 file:// 허용
  goal: string;            // 자연어 과업 설명 (agent 프롬프트에 그대로 삽입)
  mode: UserModel;         // "keyboard" | "screenreader-strict" | "screenreader-hybrid"
  maxSteps: number;        // 상한 (초과 시 verdict="stuck")
  timeoutMs: number;       // 전체 실행 wallclock 상한
  verify: VerifySpec;      // success 판정 규칙
  input?: {                // 선택적 task-scoped 고정 입력 문자열
    text: string;
  };
};
```

**JSON 예시 (examples/tasks/simple-cta.yml 파싱 후)**

```json
{
  "id": "simple-cta",
  "url": "file:///.../fixtures/simple-cta.html",
  "goal": "Get started 버튼을 찾아서 활성화하고, 결과 메시지가 보이는 상태로 만들어라.",
  "mode": "keyboard",
  "maxSteps": 20,
  "timeoutMs": 180000,
  "verify": {
    "all": [
      { "textVisible": "Started!" },
      { "titleIncludes": "Completed" }
    ]
  }
}
```

**JSON 예시 (task-scoped text input 포함)**

```json
{
  "id": "search-task",
  "url": "https://example.com/search",
  "goal": "검색창에 passport를 입력하고 결과 페이지로 이동한다.",
  "mode": "keyboard",
  "maxSteps": 20,
  "timeoutMs": 60000,
  "verify": {
    "all": [
      { "urlIncludes": "/search" }
    ]
  },
  "input": {
    "text": "passport"
  }
}
```

---

## §2. AllowedKey

```ts
export const ALLOWED_KEYS = [
  "Tab",
  "Shift+Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Enter",
  "Space",
  "Escape",
] as const;

export type AllowedKey = typeof ALLOWED_KEYS[number];
```

이 enum은 **actuator의 런타임 whitelist + agent의 행동 공간 선언** 양쪽에서 단일 진실 원본이다.

---

## §3. Observation

`core`는 둘 다 선언하고, 현재 구현은 둘 다 실제로 생성한다.

```ts
export type KeyboardObservation = {
  kind: "keyboard";
  screenshot: {
    pngBase64: string;
    viewport: { w: number; h: number };
  };
  previousScreenshot?: { pngBase64: string };   // 직전 1장만
  browserChrome: {
    title: string;     // document.title 등가물 (브라우저 탭에 보이는 것)
    urlPath: string;   // pathname + search (origin 제외)
  };
  scrollHint?: "top" | "middle" | "bottom";
};

export type ScreenReaderObservation = {
  kind: "screenreader";
  announcement: string;              // 직전 action 이후 SR이 말한 텍스트 전부
  announcementCapture: "log" | "fallback" | "none"; // 무엇으로 획득했는가
  announcementCount?: number;      // 고유 발화 수가 아니라 캡처된 phrase line 수
  observeReason?: "silence" | "timeout" | "fallback"; // 왜 관측을 종료했는가
  previousAnnouncement?: string;     // 직전 1개
};

export type Observation = KeyboardObservation | ScreenReaderObservation;
```

screenreader 모드의 **agent observation** 은 announcement-only다. `announcementCapture`,
`announcementCount`, `observeReason` 와 개발자 디버깅용 screenshot은 trace/report에만
저장되고 agent 프롬프트에는 전달되지 않는다.

해석 규칙은 다음처럼 고정한다.

- `announcementCount` 는 "고유 발화 수"가 아니라 이번 step에서 캡처된 phrase line 수다.
- step 경계는 DOM 상태나 문자열 diff가 아니라 **read-and-clear spoken log** 기준이다.
- `announcementCapture` 는 획득 경로, `observeReason` 는 종료 이유다.

**KeyboardObservation JSON 예시**

```json
{
  "kind": "keyboard",
  "screenshot": {
    "pngBase64": "iVBORw0KGgoAAAANSUhEUg...",
    "viewport": { "w": 1280, "h": 800 }
  },
  "browserChrome": {
    "title": "Simple CTA Fixture",
    "urlPath": "/fixtures/simple-cta.html"
  },
  "scrollHint": "top"
}
```

---

## §4. Action / Decision / Verdict

```ts
export type Action =
  | { key: AllowedKey }
  | { typeText: "task" }
  | { srCommand: ScreenReaderCommand };

export type Verdict = "success" | "stuck";

export type Decision =
  | { action: Action; rationale?: string }      // 한 번 더 키를 누른다
  | { verdict: Verdict; rationale?: string };   // 루프 종료
```

Agent는 한 턴에 **action XOR verdict** 중 정확히 하나만 반환한다. 둘 다 또는 둘 다 없음은 parser가 stuck으로 강제 변환한다.

**Decision JSON 예시 (action)**

```json
{ "action": { "key": "Tab" } }
```

**Decision JSON 예시 (task text input)**

```json
{ "action": { "typeText": "task" } }
```

**Decision JSON 예시 (screenreader canonical command)**

```json
{ "action": { "srCommand": "nextHeading" } }
```

**Decision JSON 예시 (verdict)**

```json
{ "verdict": "success" }
```

---

## §5. StepRecord / TraceSession

```ts
export type StepRecord = {
  step: number;                        // 0-indexed
  timestamp: string;                   // ISO 8601
  observation: RecordedObservation;
  decision: Decision;
  execution: {
    ok: boolean;
    error?: string;                    // whitelist 위반 등
    costDelta: number;                 // 이 step에서 추가된 action cost (0 or 1)
  };
  timings: {
    observeMs: number;                 // 관측 수집 시간
    decideMs: number;                  // agent 판단 시간
    executeMs: number;                 // action 실행 시간
    verifyMs: number;                  // verifier 시간 (없으면 0)
  };
  verification?: {
    passed: boolean;
    failures: string[];
  };
  verdictAnalysis?: {
    agentVerdict?: "success" | "stuck";
    verificationResult: "passed" | "failed" | "not-run";
    finalResult: "success" | "failure" | "continued";
    completionSource: "agent" | "verifier-auto-complete";
  };
};

export type TraceSession = {
  task: Task;
  startedAt: string;
  endedAt: string;
  steps: StepRecord[];
  experienceSummary?: {
    overall: string;
    biggestFriction: string;
    nextChecks: string[];              // 최대 2개
  };
  aggregate: {
    result: "success" | "failure";
    totalSteps: number;
    durationMs: number;
    timings: {
      setupMs: number;                 // 브라우저/VO/runtime 초기화 시간
      browserLaunchMs: number;         // browser launch 시간
      pageLoadMs: number;              // goto + 초기 load 시간
      screenReaderInitMs: number;      // 선택된 screen reader backend 시작 시간
      firstAnnouncementWaitMs: number; // 첫 announcement 확보 시간
      reportMs: number;                // 최종 HTML report 생성 시간
    };
    actionCounts: {
      srCommandCount: number;
      rawKeyCount: number;
      typeTextCount: number;
    };
    terminatedAtStep: number | null;
    endedBy: "success" | "stuck" | "maxSteps" | "timeout" | "error";
    failurePoint?: {
      stepIndex: number;               // 마지막 step 번호
      reason: string;                  // endedBy 에 대응하는 한 줄 설명
    };
  };
};
```

주의:

- `Observation` 은 observer가 agent에게 넘기는 **in-memory 입력 타입**이다.
- `RecordedObservation` 은 trace/report에 저장되는 **직렬화 타입**이다.
- screenreader trace에는 개발자용 screenshot이 선택적으로 붙을 수 있지만, agent 입력에는 들어가지 않는다.

---

## §6. Agent 입출력 포맷

Agent는 **관측(Observation)** 과 **컨텍스트(AgentContext)** 를 구분해서 받는다.

```ts
export type AgentContext = {
  goal: string;                        // task.goal
  allowedKeys: readonly AllowedKey[];  // ALLOWED_KEYS
  allowedScreenReaderCommands?: readonly ScreenReaderCommand[];
  memory: AgentMemoryEntry[];
};

export interface Agent {
  decide(ctx: AgentContext, obs: Observation): Promise<Decision>;
}
```

Agent의 LLM 프롬프트는 **모드별 system prompt + 최소 user prompt + 선택적 이미지 block** 구조를 가진다.

```
[system]
모드별 행동 공간과 종료 규칙을 선언한다.
- keyboard: 현재 screenshot + 직전 screenshot 비교, focus ring 추정, success/stuck 판단 규칙
- screenreader-strict: current announcement + agent memory만 사용, srCommand만 허용, act 후 결과/완료 announcement가 읽히면 success 우선 검토
- screenreader-hybrid: 관측은 strict와 같고, 행동만 srCommand + raw key 허용, 활성화 후 결과/완료 announcement가 읽히면 success 우선 검토
한 턴에 action 또는 verdict 중 하나만 반환한다.
JSON만 반환한다.

`--include-rationale` 를 켜면 위 JSON에 `rationale: string` 을 함께 포함한다.

[user]
goal: {goal}
agent memory:
- step {n}: action="{...}", outcome="{continued|success|failure}"
screenreader 모드일 때만 announcement: {announcement}
task input이 있을 때만 task input text: "{text}"
keyboard 모드일 때만 screenshot image block 추가
```

실제 agent 프롬프트용 observation은 아래처럼 축약된다.

- keyboard: 현재 상태는 observation JSON 대신 screenshot image block으로만 전달한다.
- screenreader: `announcementCapture`, `announcementCount`, `observeReason`, `previousAnnouncement` 는 빼고 `announcement` 한 줄만 남긴다.

`agent memory` 는 raw trace 전체가 아니라 **가벼운 step 메모** 배열이다.

각 item에는 아래 수준의 정보만 담는다.

- `step`
- `action`
- `outcome`

이때 keyboard 이미지 base64, verification 상세 배열, raw network record, rationale, timing 값은 memory item에 넣지 않는다.

응답 파서는 malformed JSON 또는 허용되지 않은 key 사용 시 `{ verdict: "stuck", rationale: "agent returned malformed decision: <snippet>" }` 로 강제 변환한다. 에이전트가 치트하려고 해도 stuck 처리될 뿐이며, 예외로 루프가 깨지지 않는다.

CLI 실험 옵션으로 verifier auto-complete를 켤 수 있다.

- 기본값은 `false`
- 켜면 **최소 한 번 이상 성공 action을 수행한 뒤부터** 매 action step 이후 verifier를 돌려 조건 만족 시 자동 종료할 수 있다.
- 이때 `verdictAnalysis.completionSource = "verifier-auto-complete"` 로 남겨, agent가 직접 닫은 성공과 구분한다.

CLI 실험 옵션으로 `--include-rationale` 를 켤 수 있다.

- 기본값은 `false`
- 기본 실행에서는 agent decision JSON에서 `rationale` 필드를 생략한다.
- verifier feedback, malformed decision 같은 시스템 생성 기록은 필요하면 rationale를 포함할 수 있다.

CLI memory / summary 옵션도 있다.

- `--agent-memory-window <N>`: 기본값 `5`, 최근 N개 memory archive 전달
- `--agent-memory-window 0`: memory 미전달
- `--agent-memory-all`: window 대신 누적 text memory 전체 전달
- `--include-experience-summary`: run 종료 후 같은 logical agent abstraction이 aggregate + 전체 step trace를 사용해 summary 생성

여기서 "same logical agent abstraction" 은 provider native session/thread를 뜻하지 않는다.
매 step 요청은 항상 `goal + current observation + selected memory excerpt` 로 새로 구성한다.
다만 experience summary는 decision window와 분리되어, `agent-memory-window=5` 이어도 **aggregate + 전체 step trace** 를 사용한다.
