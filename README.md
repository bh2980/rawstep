# a11y-task

> 과업 기반 웹 접근성 테스트 라이브러리.
> AI 에이전트를 keyboard-only 사용자 또는 screen reader 사용자와 동일한
> 제약 아래 놓고 페이지를 실제로 "써보게" 한 뒤, 어디서 막히는지 기록합니다.

## 왜 이 프로젝트가 필요한가

기존 접근성 도구(axe-core, Lighthouse, Pa11y 등)는 DOM을 스캔해서
**규칙 위반**을 찾습니다. "이 페이지가 WCAG 규칙 X를 어겼는가?"는 잘
답해주지만, 다음 질문에는 답하지 못합니다.

- 키보드만 쓰는 사용자가 정말로 "장바구니 담기" 버튼에 도달할 수 있는가?
- 그러려면 키를 몇 번이나 눌러야 하는가?
- 스크린 리더 사용자는 Enter를 누른 뒤 무슨 일이 일어났는지 이해할 수
  있는가?
- 구체적으로 **어디서** 사용자가 막히는가?

자동 규칙을 모두 통과해도 쓸 수 없는 페이지가 있고, 규칙을 어기고도
과업은 멀쩡히 완수되는 페이지가 있습니다. `a11y-task`는 규칙이 아니라
**과업**을 측정합니다.

## 무엇을 하는 도구인가

다음 세 가지를 입력합니다.

1. URL
2. 자연어로 쓴 과업 (예: *"첫 번째 상품을 장바구니에 담고 장바구니 화면을
   연다"*)
3. 사용자 모델: `keyboard` 또는 `screenreader`

그러면 Playwright로 브라우저를 띄우고, 선택한 사용자 모델과 **동일한 관측/
행동 제약** 아래에 AI 에이전트를 앉혀 시도를 시작합니다. 모든 step이
기록되며, 탐색 경로 · 입력 비용 · 막힌 지점을 볼 수 있는 리플레이 리포트가
만들어집니다.

## 기존 a11y 도구와 무엇이 다른가

|                  | axe / Lighthouse / Pa11y | a11y-task                 |
|------------------|--------------------------|---------------------------|
| 평가 단위        | 규칙 위반                | 과업 완수                 |
| 입력 (AI 관점)   | DOM / ARIA               | 픽셀 또는 음성 텍스트     |
| 출력             | 규칙별 통과/실패         | 전체 trace + 비용 + 실패점|
| 실사용자 관점    | 간접적                   | 직접적 (실제로 시도)      |
| UX 막다른 길 탐지| ✗                        | ✓                         |

규칙 기반 스캐너를 **대체하지 않습니다**. 상호보완적입니다. 알려진 위반은
axe로 잡고, 실제 과업이 수행 가능한지는 `a11y-task`로 확인하는 식으로
함께 쓰세요.

## 사용자 모델

### `keyboard` — 키보드만 쓰는 시력 있는 사용자

- 관측 채널: 현재 뷰포트의 screenshot.
- 행동 공간: `Tab`, `Shift+Tab`, `Arrow` keys, `Enter`, `Space`, `Escape`.
- 마우스 없음. 자유 타이핑 없음.

### `screenreader` — 시각장애, 키보드 + 스크린 리더

- 관측 채널: [Guidepup](https://guidepup.dev/)을 통해 수집되는 screen
  reader의 spoken announcement text (macOS VoiceOver / Windows NVDA).
  에이전트는 **스크린 리더가 실제로 말한 내용만** 읽습니다.
- 행동 공간: 위와 동일한 제한 키셋.
- screenshot 없음. DOM 없음. accessibility tree 없음. 에이전트는 말 그대로
  "보지 못합니다".

두 모델 모두 동일한 키 화이트리스트를 공유합니다. 이는 실제 사용자가
갖는 행동 표면과 결과를 비교 가능한 수준으로 맞추기 위해서입니다.

## 관측 채널과 행동 공간을 어떻게 제한하는가

이 프로젝트의 핵심 불변식은 다음과 같습니다.

> **에이전트는 같은 사용자 모델의 실제 사용자가 받지 못하는 정보를
> 절대 받지 않으며, 실제 사용자가 취할 수 없는 행동을 절대 취하지
> 않는다.**

이를 코드 레벨에서 강제합니다.

- Agent 패키지에는 직렬화된 `Observation` 객체만 전달됩니다. Playwright의
  `Page`, 셀렉터, ARIA tree는 타입상 접근 불가능합니다.
- Actuator의 `press(key)`는 enum 화이트리스트로 타입이 고정됩니다. 자유
  타이핑, 클릭, `page.evaluate` 등은 agent 코드에서 호출 자체가 불가능
  합니다.
- LLM 시스템 프롬프트는 구조 정보 요청을 금지하고, 이 에이전트가 받는
  관측 채널이 무엇인지 명시적으로 선언합니다.

### 에이전트가 매 턴 받는 것

이 프로젝트는 "관측"(매 step 새로 들어오는 센서 데이터)과 "컨텍스트"
(태스크 전체에 걸친 불변 정보와 에이전트의 단기 기억)를 명시적으로
분리합니다.

**컨텍스트 — 매 턴 주어지지만 관측은 아님**

- `goal` — 수행해야 할 과업. 사용자도 자기 목적을 압니다.
- `allowedKeys` — 허용된 키 목록. 관측이 아니라 행동 공간의 정의.
- `history` — 최근 몇 step의 `{ 누른 키, 그 이유 }` 리스트.
  사람의 작업 기억에 해당합니다.

**`keyboard` 모드 관측**

- 현재 viewport screenshot
- 직전 screenshot **1장** (사람이 "방금 전 화면"을 기억하는 것의 등가물.
  여러 장을 주면 사람보다 기억력이 좋아지므로 주지 않습니다)
- 브라우저 크롬에 보이는 정보 등가물: 탭 제목, URL path
- 스크롤 위치 힌트 (`top`/`middle`/`bottom` 수준 — 스크롤바를 시각적으로
  보는 것에 준합니다. `scrollTop=1234px` 같은 정밀 수치는 주지 않습니다)

**`screenreader` 모드 관측**

- 직전 액션 이후 screen reader가 실제로 말한 announcement 텍스트
- 직전 announcement 1개 (사람의 단기 청각 기억 등가물)

### 의도적으로 주지 않는 정보

> **포커스 주변 crop 이미지를 에이전트에게 주지 않습니다.**

이는 설계상 핵심 결정입니다. 포커스 crop을 만들려면 DOM에서
`document.activeElement`의 위치를 알아야 하고, 그 순간 에이전트는
"포커스 위치를 항상 완벽하게 아는 사용자"가 됩니다.

그런데 실제 접근성 결함의 가장 흔한 유형이 바로
**focus indicator가 안 보이거나 너무 약해서 사용자가 포커스를 잃는 것**
이고, 이 프로젝트가 탐지해야 할 가장 중요한 failure mode입니다.
crop을 주는 순간 이 결함은 에이전트에게 존재하지 않게 되며, 리포트는
기존 규칙 기반 도구의 false negative를 그대로 재현하게 됩니다.

대신 viewport를 충분히 고해상도로 캡처합니다. 포커스 링이 보이면 보고,
안 보이면 못 봅니다. **안 보이는 것은 버그가 아니라 우리가 측정하려던
신호 그 자체**이며, trace에 "포커스를 잃음" step으로 기록되는 것이
정답입니다.

같은 원칙으로 다음도 주지 않습니다.
- `document.activeElement`, ARIA role / label, accessibility tree
- DOM 셀렉터, 요소의 존재 여부
- 정밀 scroll 수치

## 리포트는 무엇을 보여주는가

한 번의 실행마다 다음이 생성됩니다.

- **Verdict** — 에이전트가 과업을 달성했는지, 막혔는지, 시간 초과인지.
- **단계별 리플레이** — 각 step마다: 당시의 관측(스크린샷 썸네일 또는
  announcement transcript), 에이전트가 누른 키, 그 키를 누른 이유(근거).
- **입력 비용** — 전체 키 입력 수, 키 종류별 분포.
- **실패 지점** — 실패로 끝난 경우, 종료 직전의 관측을 하이라이트.
- **Oracle check (선택)** — 에이전트가 자칭한 성공을 외부에서 독립적으로
  검증한 결과.

## 프로젝트 구조

```
a11y/
├── packages/
│   ├── core/                   # 공유 타입 (Task, Observation, Action, ...)
│   ├── browser/                # Playwright 라이프사이클
│   ├── actuator/               # 화이트리스트 키 입력기
│   ├── observer-keyboard/      # screenshot 관측자
│   ├── observer-screenreader/  # Guidepup announcement 관측자
│   ├── agent/                  # LLM 판단 레이어
│   ├── runner/                 # observe → decide → act 루프
│   ├── trace/                  # append-only step 로그
│   └── reporter/               # trace → HTML/JSON 리포트
├── apps/cli/                   # a11y-task CLI
└── examples/tasks/             # 예시 task 정의
```

## 빠른 시작

```bash
pnpm install
pnpm build
pnpm a11y-task run examples/tasks/add-to-cart.yml \
  --mode keyboard --out ./report
open ./report/index.html
```

### LLM provider 설정

기본 provider는 `anthropic` 입니다.

```bash
export A11Y_TASK_AGENT_PROVIDER=anthropic
export A11Y_TASK_AGENT_API_KEY=your-key
export A11Y_TASK_AGENT_MODEL=claude-3-5-sonnet-latest
```

OpenRouter, OpenAI, vLLM, LM Studio 같은 OpenAI-compatible API는 아래처럼
설정합니다.

```bash
export A11Y_TASK_AGENT_PROVIDER=openai-compatible
export A11Y_TASK_AGENT_API_KEY=your-key
export A11Y_TASK_AGENT_MODEL=openrouter/auto
export A11Y_TASK_AGENT_BASE_URL=https://openrouter.ai/api/v1
```

CLI에서 실행별로 덮어쓸 수도 있습니다.

```bash
pnpm a11y-task run examples/tasks/simple-cta.yml \
  --mode keyboard \
  --out ./report \
  --provider openai-compatible \
  --model openrouter/auto \
  --base-url https://openrouter.ai/api/v1
```

`keyboard` 모드는 screenshot 이미지를 같이 보내므로, 선택한 provider/model이
이미지 입력을 지원해야 합니다.

## 상태와 한계

- 임의 자유 텍스트 입력은 금지합니다. 다만 task가 고정 문자열을 제공한 경우에만
  제한된 text input action을 허용합니다.
- Screen reader 모드는 v1에서 macOS VoiceOver (Guidepup)만 지원합니다.
  NVDA는 후속 릴리스 예정.
- 에이전트의 성공/실패 판정은 설계상 관측 채널만으로 자체 선언합니다.
  ground-truth 검증이 필요하면 선택적 oracle을 사용하세요.
