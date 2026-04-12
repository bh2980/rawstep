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
3. 사용자 모델: `keyboard`, `screenreader-strict`, 또는 `screenreader-hybrid`

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

### `screenreader-strict` — 순수 SR 탐색 실험 모드

- 관측 채널: [Guidepup](https://guidepup.dev/)을 통해 수집되는 macOS
  VoiceOver의 spoken announcement text.
- 행동 공간: screen reader canonical command
  (`nextItem`, `previousItem`, `nextHeading`, `previousHeading`,
  `nextFormControl`, `previousFormControl`, `act`) + opt-in `typeText`.
- screenshot 없음. DOM 없음. accessibility tree 없음. 브라우저 title/URL path
  힌트도 없음. 에이전트는 말 그대로 "보지 못합니다".

### `screenreader-hybrid` — 현실적 사용 모드

- 관측 채널: `screenreader-strict`와 동일.
- 행동 공간: screen reader canonical command + 일반 키
  (`Tab`, `Shift+Tab`, `Arrow` keys, `Enter`, `Space`, `Escape`) + opt-in `typeText`.
- 스크린 리더 탐색과 일반 키보드 입력을 같이 허용한다.
- 하이브리드라는 말은 **행동 공간만 넓어진다**는 뜻이다. 시야가 생기는 것은 아니다.

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
- `agent memory` — 이전 step들을 가볍게 요약한 text archive.
  기본값은 최근 5개이며, `--agent-memory-window` 나 `--agent-memory-all`
  로 범위를 늘릴 수 있습니다. 이 memory는 raw trace 전체가 아니라
  "그 step에서 무엇을 봤고, 무엇을 했고, 결과가 어땠는지"만 담는 짧은 작업
  메모입니다.

**`keyboard` 모드 관측**

- 현재 viewport screenshot
- 직전 screenshot **1장** (사람이 "방금 전 화면"을 기억하는 것의 등가물.
  여러 장을 주면 사람보다 기억력이 좋아지므로 주지 않습니다)
- 브라우저 크롬에 보이는 정보 등가물: URL path
- 스크롤 위치 힌트 (`top`/`middle`/`bottom` 수준 — 스크롤바를 시각적으로
  보는 것에 준합니다. `scrollTop=1234px` 같은 정밀 수치는 주지 않습니다)

**`screenreader-strict` / `screenreader-hybrid` 모드 관측**

- 직전 액션 이후 screen reader가 실제로 말한 announcement 텍스트
- observer는 내부적으로 `previousAnnouncement` 를 유지할 수 있지만, 현재 agent 프롬프트에는 `announcement` 1개와 `agent memory` 만 넣습니다.
- announcement를 어떻게 잡았는지 나타내는 capture 메타
  (`log`, `fallback`, `none`)는 trace/report에만 저장하고, agent 프롬프트에는 넣지 않습니다.
- trace/report에는 `announcementCount`, `observeReason` 도 함께 저장합니다.
  즉 이번 step에서 몇 개의 spoken phrase line을 붙잡았는지, silence로 관측을 닫았는지
  timeout/fallback으로 닫았는지를 사람이 나중에 읽을 수 있습니다.
- 여기서 `announcementCount` 는 "고유 발화 수"가 아니라 이번 step에서 캡처된
  phrase line 수입니다.
- step 경계는 DOM 상태나 문자열 비교가 아니라 **read-and-clear spoken log** 기준으로
  나뉩니다. 즉 한 poll에서 읽고 비운 로그는 다음 step에서 다시 읽지 않습니다.
- `announcementCapture` 는 "무엇으로 잡았는가", `observeReason` 는 "왜 여기서 관측을
  닫았는가"를 뜻합니다.
- agent 프롬프트에는 screenshot, title, urlPath를 넣지 않습니다.
- 즉 `screenreader-hybrid` 도 일반 키를 더 쓸 수 있을 뿐, 관측 채널은 여전히 announcement-only 입니다.
- 다만 개발자용 trace/report에는 디버깅을 위해 step 시점 screenshot을 별도로 저장할 수 있습니다. 이 이미지는 agent 입력에는 절대 들어가지 않습니다.

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

- `prompts.json` — step별 system prompt, user prompt, 이미지 개수. 실제로 모델에 어떤 입력이 갔는지 확인할 때 씁니다.
- **Verdict** — 에이전트가 과업을 달성했는지, 막혔는지, 시간 초과인지.
- **단계별 리플레이** — 각 step마다: 당시의 관측(스크린샷 썸네일 또는
  announcement transcript), 에이전트가 누른 키, 그 키를 누른 이유(근거).
- screenreader 리포트도 개발자 디버깅용 screenshot을 함께 보여줄 수 있지만,
  agent 자체는 그 이미지를 보지 못합니다.
- **입력 비용** — 전체 키 입력 수, 키 종류별 분포.
- **타이밍 분해** — setup / report 와 각 step의 observe / decide / execute / verify 시간.
- **세부 setup 타이밍** — browser launch / page load / VoiceOver init / first announcement wait.
- **관측 근거** — screenreader step마다 announcement capture 경로, phrase 수,
  observe 종료 이유(`silence`, `timeout`, `fallback`)를 같이 보여줍니다.
- 이 값들은 사용자가 과업을 읽는 본문이라기보다, screenreader 관측 품질을
  해석하는 보조 근거입니다.
- **Experience summary (선택)** — `--include-experience-summary` 를 켜면,
  실행이 전반적으로 어땠는지, 가장 큰 마찰은 무엇이었는지, 다음에 뭘 점검하면
  좋은지를 3줄 요약으로 붙입니다.
- **성공 근거 분리** — agent가 success라고 주장한 것과 verifier가 실제로 통과시킨 것을 따로 보여줍니다.
- **종료 출처 분리** — success가 agent 선언으로 닫혔는지, verifier auto-complete로 닫혔는지도 따로 남깁니다.
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
pnpm a11y-task run examples/tasks/simple-cta.yml \
  --mode keyboard --out ./report
open ./report/report/index.html
```

macOS VoiceOver를 쓰는 screenreader 모드는 headed Playwright와 macOS 접근성 권한이 필요합니다.

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
  --agent-memory-window 5 \
  --include-experience-summary \
  --screenshots important \
  --include-rationale \
  --verifier-auto-complete \
  --provider openai-compatible \
  --model openrouter/auto \
  --base-url https://openrouter.ai/api/v1
```

`keyboard` 모드는 screenshot 이미지를 같이 보내므로, 선택한 provider/model이
이미지 입력을 지원해야 합니다.

`--screenshots` 는 screenreader 리포트용 개발자 스크린샷 저장 정책을 고릅니다.

- `all` — 모든 step 저장
- `important` — verdict step, verification step, 실행 실패 step, `typeText(task)`, `srCommand(act)` 만 저장
- `failure-only` — 실패와 verifier 실패 위주로만 저장
- `none` — screenreader 리포트용 개발자 스크린샷을 저장하지 않음

keyboard 모드의 screenshot은 agent 입력 자체이므로 이 옵션의 영향을 받지 않습니다.

`--verifier-auto-complete` 는 기본값이 꺼진 실험 옵션입니다.

- agent가 success를 선언하지 않아도,
- **최소 한 번 이상 성공 action을 한 뒤**
- verifier가 조건 만족을 확인하면 자동 종료할 수 있습니다.

이 경우 report의 `completionSource` 가 `verifier-auto-complete` 로 남아, agent가 직접 닫은 성공과 구분됩니다.

`--agent-memory-window` 는 agent에게 다시 보여줄 이전 step archive 개수를 정합니다.

- 기본값은 `5`
- `0` 이면 이전 step memory를 보내지 않아 사실상 stateless처럼 동작
- `N` 이면 최근 N개 archive만 전달

`--agent-memory-all` 을 켜면 최근 일부가 아니라 **누적된 text memory 전체**를 agent에게 전달합니다.

이 memory는 긴 raw trace 전체가 아니라, 각 step의 관측/행동/실행 결과/verification 결과를
짧게 요약한 text archive입니다. keyboard 이미지 자체는 memory에 저장하지 않고, 기존처럼
현재 screenshot + 직전 screenshot까지만 판단 입력으로 사용합니다.

`--include-rationale` 는 기본값이 꺼져 있습니다.

- 기본 실행에서는 agent가 `rationale` 필드를 생성하지 않습니다.
- 디버깅이나 데모가 필요할 때만 켜서 긴 자연어 설명을 저장합니다.
- malformed decision, verifier feedback 같은 시스템 생성 메시지는 필요하면 여전히 rationale를 포함할 수 있습니다.

`--include-experience-summary` 도 기본값이 꺼져 있습니다.

- 켜면 run이 끝난 뒤 같은 logical agent abstraction이 **누적된 text memory 전체**를 바탕으로
  짧은 experience summary를 생성합니다.
- 이 summary는 `overall`, `biggestFriction`, `nextChecks`(최대 2개) 구조를 가집니다.
- summary는 root cause를 단정하거나 pass/fail을 다시 판정하지 않고, 실행 흐름과 마찰만 요약합니다.

## 상태와 한계

- 임의 자유 텍스트 입력은 금지합니다. 다만 task가 고정 문자열을 제공한 경우에만
  제한된 text input action을 허용합니다.
- Screen reader strict/hybrid 모드는 현재 macOS VoiceOver (Guidepup)만 지원합니다.
  NVDA는 후속 릴리스 예정입니다.
- 에이전트의 성공/실패 판정은 설계상 관측 채널만으로 자체 선언합니다.
  ground-truth 검증이 필요하면 선택적 oracle을 사용하세요.
