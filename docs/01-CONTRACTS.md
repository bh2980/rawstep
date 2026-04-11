# CONTRACTS

> 패키지 간 입출력 계약. TypeScript 타입 + JSON 예시로 고정한다.
> 산문이 아니라 **코드가 진실**이다. `packages/core/src/index.ts` 의 export와 1:1 대응해야 한다.

---

## §1. Task

```ts
export type UserModel = "keyboard" | "screenreader";

export type Task = {
  id: string;              // kebab-case, 파일명과 일치
  url: string;             // http(s):// 또는 file:// 허용
  goal: string;            // 자연어 과업 설명 (agent 프롬프트에 그대로 삽입)
  mode: UserModel;         // "keyboard" | "screenreader"
  maxSteps: number;        // 상한 (초과 시 verdict="stuck")
  timeoutMs: number;       // 전체 실행 wallclock 상한
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
  "goal": "페이지의 첫 CTA 버튼을 찾아서 활성화(Enter)한다.",
  "mode": "keyboard",
  "maxSteps": 20,
  "timeoutMs": 60000
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
  previousAnnouncement?: string;     // 직전 1개
};

export type Observation = KeyboardObservation | ScreenReaderObservation;
```

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
  | { action: Action; rationale: string }      // 한 번 더 키를 누른다
  | { verdict: Verdict; rationale: string };   // 루프 종료
```

Agent는 한 턴에 **action XOR verdict** 중 정확히 하나만 반환한다. 둘 다 또는 둘 다 없음은 parser가 stuck으로 강제 변환한다.

**Decision JSON 예시 (action)**

```json
{
  "action": { "key": "Tab" },
  "rationale": "첫 포커스 가능한 요소로 이동하기 위해 Tab을 누른다."
}
```

**Decision JSON 예시 (task text input)**

```json
{
  "action": { "typeText": "task" },
  "rationale": "task에 제공된 고정 문자열을 현재 입력 필드에 입력한다."
}
```

**Decision JSON 예시 (screenreader canonical command)**

```json
{
  "action": { "srCommand": "nextHeading" },
  "rationale": "다음 제목으로 이동해 구조를 파악한다."
}
```

**Decision JSON 예시 (verdict)**

```json
{
  "verdict": "success",
  "rationale": "CTA가 활성화되어 페이지가 /thanks로 이동했다."
}
```

---

## §5. StepRecord / TraceSession

```ts
export type StepRecord = {
  step: number;                        // 0-indexed
  timestamp: string;                   // ISO 8601
  observation: Observation;
  decision: Decision;
  execution: {
    ok: boolean;
    error?: string;                    // whitelist 위반 등
    costDelta: number;                 // 이 step에서 추가된 action cost (0 or 1)
  };
};

export type TraceSession = {
  task: Task;
  startedAt: string;
  endedAt: string;
  steps: StepRecord[];
  aggregate: {
    result: "success" | "failure";
    totalSteps: number;
    durationMs: number;
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

---

## §6. Agent 입출력 포맷

Agent는 **관측(Observation)** 과 **컨텍스트(AgentContext)** 를 구분해서 받는다.

```ts
export type AgentContext = {
  goal: string;                        // task.goal
  allowedKeys: readonly AllowedKey[];  // ALLOWED_KEYS
  allowedScreenReaderCommands?: readonly ScreenReaderCommand[];
  history: Array<{
    stepIndex: number;
    source: "agent" | "verifier";
    action?: Action;                   // verdict 이전 step은 action
    rationale: string;
  }>;
};

export interface Agent {
  decide(ctx: AgentContext, obs: Observation): Promise<Decision>;
}
```

Agent의 LLM 프롬프트는 다음 구조를 가진다.

```
[system]
너는 {userModel} 사용자를 시뮬레이션한다.
너에게 허용된 키는 {allowedKeys} 뿐이다.
너는 DOM, 셀렉터, accessibility tree에 접근할 수 없다.
screenreader 모드에서는 allowedScreenReaderCommands 도 함께 주어진다.
너는 한 턴에 {action} 또는 {verdict} 중 하나만 반환한다.
JSON 형식: { action?: {key|typeText|srCommand}, verdict?: "success"|"stuck", rationale: string }

[user]
goal: {goal}
recent history: {history JSON}
observation: {observation JSON}
keyboard 모드일 때만 screenshot image block 추가
```

응답 파서는 malformed JSON 또는 허용되지 않은 key 사용 시 `{ verdict: "stuck", rationale: "agent returned malformed decision: <snippet>" }` 로 강제 변환한다. 에이전트가 치트하려고 해도 stuck 처리될 뿐이며, 예외로 루프가 깨지지 않는다.
