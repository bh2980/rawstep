# Task-based Accessibility Testing Library — 설계 플랜

## Context

기존 a11y 자동 점검 도구(axe-core, Lighthouse, Pa11y 등)는 DOM/ARIA 규칙 위반을 정적으로 탐지한다. 그러나 실제 사용자가 "장바구니에 상품을 담는다" 같은 **과업을 완수할 수 있는지**는 규칙 통과 여부와 별개다. 규칙을 모두 통과해도 탐색 비용이 과도하거나 특정 지점에서 막힐 수 있고, 규칙을 위반해도 과업 자체는 가능할 수 있다.

이 프로젝트는 **AI 에이전트를 제한된 관측/행동 채널에 가둔 채 과업을 수행시키는 방식**으로 이 간극을 메운다. 목적은 점수 산출이 아니라 **"이 페이지에서 이 사용자 모델이 이 과업을 어떻게 겪는가"를 관측 가능한 형태로 기록**하는 것이다.

- 사용자 모델: `keyboard-only` / `blind (keyboard + screen reader)`
- 관측 채널: `screenshot` / `spoken announcement text`
- 행동 공간: `Tab`, `Shift+Tab`, `Arrow`, `Escape`, `Enter`, `Space`
- 수집 데이터: 과업 완수 여부 · 탐색 경로 · 입력 비용 · 실패 지점

README가 "무엇/왜"를 설명한다면, 이 문서는 "어떻게 만들 것인가"를 담는다.

---

## 1. 프로젝트 목표

1. **과업 중심 평가**: 규칙 위반이 아닌 "과업을 끝낼 수 있었는가"를 1차 신호로 본다.
2. **관측 채널의 충실한 제한**: 에이전트는 사람이 받는 것과 동등한 정보(픽셀 or 음성 텍스트)만 본다. DOM/셀렉터/a11y tree 접근 불가.
3. **행동 공간의 충실한 제한**: 허용 키셋 외 입력은 시스템 레벨에서 거부한다. 마우스, 직접 클릭, 임의 타이핑 없음.
4. **재현 가능한 trace**: 모든 step을 `관측 → 판단 → 행동` 단위로 append-only 로그에 기록.
5. **사람이 읽는 리포트**: 단계별 리플레이, 입력 비용, 막힌 지점, 에이전트가 남긴 근거를 시각화.

### 비목표

- 자동 판정/점수화 (axe와 경쟁하지 않는다)
- 실제 보조기기의 완벽한 시뮬레이션 (VoiceOver의 모든 제스처 재현은 범위 밖)
- 임의 텍스트 입력 (v1에서는 제외 — 한계로 명시)

---

## 2. 아키텍처

### 실행 루프 (관측–판단–행동 사이클)

```
 ┌──────────────┐     ┌─────────┐     ┌──────────┐     ┌──────────┐
 │   Browser    │◀────│ Actuator│◀────│  Agent   │◀────│ Observer │
 │ (Playwright) │     │(allowed │     │ (LLM)    │     │(screen / │
 │              │     │  keys)  │     │          │     │  SR)     │
 └──────┬───────┘     └─────────┘     └────┬─────┘     └────┬─────┘
        │                                  │                │
        └────────────────► Trace ◀─────────┴────────────────┘
                             │
                             ▼
                         Reporter
```

각 step:
1. `Observer`가 현재 상태를 캡처 (screenshot bytes **또는** announcement transcript)
2. `Trace`에 observation append
3. `Agent`가 `(task, history, latest observation)`을 받아 다음 action 또는 verdict(`success` / `stuck`) 반환
4. verdict이면 종료, 아니면 `Actuator`가 허용된 키만 실행 (비용 +1)
5. `Trace`에 action + rationale append

### 무결성 경계 (에이전트가 "치트"하지 못하도록)

- Agent 패키지는 **Playwright page 객체를 모른다**. Observer가 생성한 직렬화된 observation만 받는다.
- Actuator는 whitelist enum만 받는 `press(key: AllowedKey)` API. 문자열 자유입력 없음.
- LLM 프롬프트는 "너는 이 관측 채널만 갖는다"를 고정 시스템 메시지로 주입.
- 외부 oracle(성공 판정 보조)은 옵션이며, agent가 success를 선언한 **이후에만** 실행되어 trace에 검증 결과로 기록된다. agent의 판단 경로에는 흘러들지 않는다.

### 에이전트에게 주는 정보 — 관측(Observation) vs 컨텍스트(Context)

이 둘을 개념적으로 분리한다. **관측**은 매 step마다 새로 수집되는 센서 데이터이고, **컨텍스트**는 태스크 전체에 걸쳐 주어지는 불변 정보 또는 에이전트의 단기 기억이다.

**매 턴 주는 컨텍스트 (관측 아님):**
- `task.goal` — 사용자도 자기 목적을 안다.
- `allowedKeys` — 행동 공간 정의. 관측이 아니라 규칙이므로 system prompt에 고정.
- `history` — 최근 N step의 `{ action, agentRationale }`. 사람의 작업 기억 등가물.

**keyboard 모드 관측 스키마:**
```ts
type KeyboardObservation = {
  kind: "keyboard";
  screenshot: { pngBase64: string; viewport: { w: number; h: number } };
  previousScreenshot?: { pngBase64: string };   // 직전 1장만. 여러 장은 치트.
  browserChrome: { title: string; urlPath: string }; // 브라우저 크롬 등가물
  scrollHint?: "top" | "middle" | "bottom";     // 스크롤바 시각 판독 보조
};
```

**screenreader 모드 관측 스키마:**
```ts
type ScreenReaderObservation = {
  kind: "screenreader";
  announcement: string;  // 직전 액션 이후 SR이 말한 텍스트 전부
  previousAnnouncement?: string;
};
```

### 의도적으로 주지 않는 정보 (핵심 결정)

> **포커스 주변 crop 이미지는 주지 않는다.**

이유: crop을 만들려면 DOM에서 `document.activeElement`의 bounding box를 알아야 하고, 그 순간 에이전트는 "포커스가 어디 있는지 항상 완벽하게 아는 사용자"가 된다. 그러나 실제 접근성 결함의 가장 흔한 유형이 바로 **focus indicator가 안 보이거나 너무 약해서 사용자가 포커스를 잃는 것**이고, 이것이 본 프로젝트가 탐지해야 할 핵심 failure mode다. crop을 주는 순간 그 결함은 에이전트에게 존재하지 않게 되며, 리포트는 기존 axe류 도구의 false negative를 그대로 재현하게 된다.

대안: viewport를 충분히 고해상도로 캡처한다. 포커스 링이 보이면 에이전트가 본다. **안 보이면 그건 버그가 아니라 측정하려던 신호 그 자체이며, trace에 "포커스를 잃음" step으로 기록되는 것이 정답이다.**

동일한 원칙으로 다음도 주지 않는다:
- `document.activeElement`, accessibility tree, ARIA role/label
- 정밀 scroll 수치(`scrollTop=1234px`) — 사람은 스크롤바를 보고 대략만 안다
- DOM 셀렉터, 요소 존재 여부

---

## 3. 모노레포 구조

pnpm workspace 기반. TypeScript.

```
a11y/
├── package.json                 # workspace root, scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── README.md
├── plan.md                      # 본 문서
├── packages/
│   ├── core/                    # 공통 타입/스키마, 런타임 의존성 0
│   ├── browser/                 # Playwright 래퍼
│   ├── actuator/                # 허용 키 whitelist 실행기
│   ├── observer-keyboard/       # screenshot 관측자
│   ├── observer-screenreader/   # Guidepup 기반 announcement 관측자
│   ├── agent/                   # LLM 어댑터 (Anthropic SDK)
│   ├── runner/                  # 관측-판단-행동 루프 오케스트레이터
│   ├── trace/                   # append-only step log + 직렬화
│   └── reporter/                # trace → HTML/JSON 리포트
├── apps/
│   └── cli/                     # `a11y-task run <task.yml>`
└── examples/
    └── tasks/                   # 예시 task 정의 (yml)
```

---

## 4. 패키지 책임 분리

| 패키지 | 책임 | 핵심 export | 의존 |
|---|---|---|---|
| **core** | 타입 · 스키마 · enum. `Task`, `UserModel`, `AllowedKey`, `Observation`(`KeyboardObservation` \| `ScreenReaderObservation`), `AgentContext`(`goal`, `allowedKeys`, `history`), `Action`, `Verdict`, `StepRecord`, `TraceSession` | 타입 only | — |
| **browser** | Playwright 라이프사이클 (launch, goto, close). focus 제어는 actuator에 위임 | `createBrowserSession(url)` | playwright, core |
| **actuator** | `press(key)` — whitelist 외 throw. keystroke counter. | `Actuator.press()`, `Actuator.cost` | browser, core |
| **observer-keyboard** | viewport screenshot · 직전 screenshot 1장 · browserChrome(title/urlPath) · scrollHint 수집. **focus crop 및 DOM 정보는 수집하지 않는다.** | `KeyboardObserver.observe() → KeyboardObservation` | browser, core |
| **observer-screenreader** | Guidepup VoiceOver/NVDA 구동, 직전 액션 이후의 spoken phrase + 직전 announcement 1개 수집 | `ScreenReaderObserver.observe() → ScreenReaderObservation` | guidepup, browser, core |
| **agent** | LLM 호출, 시스템 프롬프트 주입, `(context, observation) → {action OR verdict, rationale}` 파싱. 컨텍스트(goal/allowedKeys/history)와 관측(screenshot or announcement)을 분리해 프롬프트 구성 | `LLMAgent(model, userModel)` | @anthropic-ai/sdk, core |
| **runner** | 루프 제어, timeout / max step, step 조립, trace 기록 | `runTask(task, {observer, actuator, agent, trace})` | core, trace |
| **trace** | append-only `StepRecord[]`, aggregate (`totalSteps`, `totalKeystrokes`, `reachedGoal`, `failurePoint`), JSON 직렬화 | `TraceRecorder` | core |
| **reporter** | trace JSON → 정적 HTML 리포트(step 썸네일/트랜스크립트, 비용 차트, 실패 하이라이트) | `renderReport(trace, outDir)` | core |
| **cli** | task yml 로드, 모드 선택, runner 구동, reporter 호출 | `a11y-task` 바이너리 | 모두 |

### 의존 방향

```
cli → runner → {agent, observer-*, actuator, trace} → browser → playwright
core는 모두에게 읽힘. reporter는 trace만 읽음.
```

agent는 observer를 직접 import하지 않는다 (관측은 runner가 중계).

---

## 5. 실행 흐름 (End-to-End)

1. `a11y-task run examples/tasks/add-to-cart.yml --mode keyboard --out ./report`
2. CLI가 task 스펙 파싱: `{ url, goal, userModel?, maxSteps, timeoutMs, oracle? }`
3. `browser.createBrowserSession(task.url)` → Playwright page 생성, goto.
4. 모드에 따라 observer 선택:
   - `keyboard` → `KeyboardObserver(page)`
   - `screenreader` → `ScreenReaderObserver(page)` (Guidepup VO 세션 시작)
5. `Actuator(page)` 초기화, `TraceRecorder` 시작.
6. `LLMAgent(claude-opus-4-6, task.userModel)` 인스턴스 생성. 시스템 프롬프트에 관측 채널 종류와 허용 키셋 삽입.
7. `runner.runTask(...)`:
   ```
   while step < maxSteps && !timedOut:
     obs = observer.observe()             # viewport + prev screenshot + chrome + scrollHint
     trace.logObservation(obs)
     ctx = {                               # 불변 + 단기 기억 — 관측과 분리
       goal: task.goal,
       allowedKeys: ALLOWED,
       history: trace.recentDecisions(N),
     }
     decision = agent.decide(ctx, obs)
     trace.logDecision(decision)
     if decision.verdict: break
     actuator.press(decision.action)       # cost += 1
   ```
8. 종료 후 optional `oracle.check(page)` → trace에 `oracleVerdict` 추가 (agent 판단과 독립적으로).
9. `reporter.renderReport(trace, outDir)` → `report/index.html` + `trace.json`.
10. 브라우저/SR 세션 정리.

---

## 6. 생성/수정할 파일 (Phase 1 스캐폴딩 범위)

greenfield이므로 아래를 전부 신규 생성:

- `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`
- `README.md` — 한글 README 초안
- `plan.md` — 본 문서
- `packages/core/src/index.ts` — `Task`, `UserModel`, `AllowedKey` enum, `Observation` union, `Action`, `Verdict`, `StepRecord`, `TraceSession`
- `packages/browser/src/index.ts` — `createBrowserSession`
- `packages/actuator/src/index.ts` — `Actuator` with `press`, `cost`
- `packages/observer-keyboard/src/index.ts` — `KeyboardObserver.observe`
- `packages/observer-screenreader/src/index.ts` — `ScreenReaderObserver.observe` (Guidepup)
- `packages/agent/src/index.ts` — `LLMAgent.decide` + 시스템 프롬프트 템플릿
- `packages/runner/src/index.ts` — `runTask`
- `packages/trace/src/index.ts` — `TraceRecorder`
- `packages/reporter/src/index.ts` — `renderReport`
- `apps/cli/src/index.ts` — CLI entry
- `examples/tasks/add-to-cart.yml`

구현은 타입/인터페이스 먼저, 이후 패키지별 최소 구현.

---

## 7. 검증 방법 (end-to-end)

1. `pnpm install && pnpm build` — 모노레포 전체 빌드 성공.
2. `pnpm -r test` — 각 패키지 단위 테스트 (actuator whitelist 거부, trace 직렬화, reporter 렌더링).
3. 통합: 로컬 정적 HTML(간단한 성공 케이스 1개 + 실패 케이스 1개)에 대해
   `a11y-task run ... --mode keyboard` 실행 → `report/index.html` 생성 및 trace 내용 확인.
4. 무결성 검사: agent 패키지에서 `Page` 타입/`querySelector` 문자열을 import/사용하지 않는지 grep.
5. screenreader 모드 스모크: Guidepup VoiceOver 초기화가 macOS 로컬에서 성공하고, 최소 1개의 announcement를 캡처하는지 확인.

---

## 8. 열린 질문 (기본값 가정)

1. **LLM 백엔드**: Anthropic SDK + `claude-opus-4-6`.
2. **SR 대상**: v1은 macOS VoiceOver (Guidepup). NVDA는 후속.
3. **텍스트 입력**: v1에서 제외, 필요 시 "blocked" 스텝으로 trace 기록.
4. **패키지 매니저 / 언어**: pnpm workspace + TypeScript.
