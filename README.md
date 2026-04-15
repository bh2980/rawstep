# rawstep

> 과업 기반 웹 접근성 실행 환경.
> AI 에이전트를 keyboard-only 사용자 또는 screen reader 사용자와 동일한
> 제약 아래 놓고 페이지를 실제로 "써보게" 한 뒤, 어디서 막히는지 기록합니다.

프로젝트 이름과 현재 코드상 패키지 이름, CLI 바이너리 이름은 모두 `rawstep` 기준으로 맞춥니다.

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
과업은 멀쩡히 완수되는 페이지가 있습니다. `rawstep`은 규칙이 아니라
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

|                  | axe / Lighthouse / Pa11y | rawstep                   |
|------------------|--------------------------|---------------------------|
| 평가 단위        | 규칙 위반                | 과업 완수                 |
| 입력 (AI 관점)   | DOM / ARIA               | 픽셀 또는 음성 텍스트     |
| 출력             | 규칙별 통과/실패         | 전체 trace + 비용 + 실패점|
| 실사용자 관점    | 간접적                   | 직접적 (실제로 시도)      |
| UX 막다른 길 탐지| ✗                        | ✓                         |

규칙 기반 스캐너를 **대체하지 않습니다**. 상호보완적입니다. 알려진 위반은
axe로 잡고, 실제 과업이 수행 가능한지는 `rawstep`으로 확인하는 식으로
함께 쓰세요.

## 사용자 모델

### `keyboard` — 키보드만 쓰는 시력 있는 사용자

- 관측 채널: 현재 뷰포트의 screenshot.
- 행동 공간: `Tab`, `Shift+Tab`, `Arrow` keys, `Enter`, `Space`, `Escape`.
- 마우스 없음. 자유 타이핑 없음.
- 단, task에 `input` 이 있으면 그 안의 named input key를 가리키는 `typeText("email")` 같은 액션은 허용됩니다.

### `screenreader` — screen reader 사용자 모드

- 관측 채널: 기본 screen reader backend인 [Guidepup](https://guidepup.dev/)
  계열 backend를 통해 수집되는 spoken announcement text.
- 행동 공간: screen reader canonical action
  + 일반 키
  (`Tab`, `Shift+Tab`, `Arrow` keys, `Enter`, `Space`, `Escape`) + task input이 있을 때만 `typeText("<input-key>")`.
- screenshot 없음. DOM 없음. accessibility tree 없음. 브라우저 title/URL path
  힌트도 없음. 에이전트는 말 그대로 "보지 못합니다".
- `allowedKeys` 를 비우면 예전 strict처럼 screen reader action만 남습니다.

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
- `named task inputs` — task에 `input` 이 있을 때만 주어지는 이름 붙은 문자열 묶음입니다. 예를 들어 `input.email`, `input.password`, `input.otp` 처럼 여러 값을 둘 수 있고, agent는 임의 텍스트를 만들지 않고 이 키들만 선택할 수 있습니다.
- `agent memory` — 이전 step들을 가볍게 요약한 text archive.
  최근 몇 개를 다시 보여줄지는 `rawstep.config.ts` 의 `memory` 나
  `--agent-memory-window`, `--agent-memory-all` 로 정합니다. 이 memory는 raw trace 전체가 아니라
  "그 step에서 무엇을 봤고, 무엇을 했고, 결과가 어땠는지"만 담는 짧은 작업
  메모입니다.

**`keyboard` 모드 관측**

- 현재 viewport screenshot
- 직전 screenshot **1장** (사람이 "방금 전 화면"을 기억하는 것의 등가물.
  여러 장을 주면 사람보다 기억력이 좋아지므로 주지 않습니다)
- 브라우저 크롬에 보이는 정보 등가물: URL path
- 스크롤 위치 힌트 (`top`/`middle`/`bottom` 수준 — 스크롤바를 시각적으로
  보는 것에 준합니다. `scrollTop=1234px` 같은 정밀 수치는 주지 않습니다)

**`screenreader` 모드 관측**

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
- 즉 `screenreader` 는 일반 키를 함께 쓸 수 있어도, 관측 채널은 여전히 announcement-only 입니다.
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
- **세부 setup 타이밍** — browser launch / page load / screen reader init / first announcement wait.
- **관측 근거** — screenreader step마다 announcement capture 경로, phrase 수,
  observe 종료 이유(`silence`, `timeout`, `fallback`)를 같이 보여줍니다.
- 이 값들은 사용자가 과업을 읽는 본문이라기보다, screenreader 관측 품질을
  해석하는 보조 근거입니다.
- **Experience summary (선택)** — `--include-experience-summary` 를 켜면,
  실행 흐름을 `overall`, `blockers`, `surprise`, `oneLineFeel` 필드로 요약해
  붙입니다.
- **성공 근거 분리** — agent가 success라고 주장한 것과 verifier가 실제로 통과시킨 것을 따로 보여줍니다.
- **종료 출처 분리** — success가 agent 선언으로 닫혔는지, verifier auto-complete로 닫혔는지도 따로 남깁니다.
- **실패 지점** — 실패로 끝난 경우, 종료 직전의 관측을 하이라이트.
- **Oracle check (선택)** — 에이전트가 자칭한 성공을 외부에서 독립적으로
  검증한 결과.

## 프로젝트 구조

```
a11y/
├── packages/
│   ├── definition/             # mode/backend/task/trace 같은 계약과 정의
│   ├── config/                 # rawstep.config.ts + task override + CLI override를 해석해 run plan 생성
│   ├── agent/                  # LLM 판단과 prompt/parsing 레이어
│   ├── runtime/                # 브라우저/관측/입력/verify/trace 실행 엔진
│   └── reporter/               # trace → HTML/JSON 리포트와 출력물 publish
├── apps/cli/                   # args 파싱 후 config/agent/runtime/reporter를 조립하는 CLI
├── examples/tasks/             # repo에 커밋된 실제 예시 task
├── fixtures/                   # 예시와 테스트가 같이 읽는 committed fixture
└── prompt/                     # system/user prompt 템플릿
```

## 빠른 시작

```bash
pnpm install
pnpm build
cat > rawstep.config.ts <<'TS'
import { defineConfig } from "@rawstep/config";

export default defineConfig({
  version: 1,
  defaults: {
    provider: "openai-compatible",
    model: "openrouter/auto",
    baseURL: "https://openrouter.ai/api/v1"
  },
  modes: {
    keyboard: {
      outDir: "./.rawstep/out/keyboard",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: 5
    }
  }
});
TS

export A11Y_TASK_AGENT_API_KEY=your-key
pnpm rawstep run examples/tasks/simple-cta.json
open ./.rawstep/out/keyboard/report/index.html
```

macOS VoiceOver를 쓰는 screenreader 모드는 headed Playwright와 macOS 접근성 권한이 필요합니다.
`guidepup-virtual` backend는 기본적으로 headless로 실행되고, `guidepup-voiceover` / `guidepup-nvda` 는 headed가 필요합니다.

`examples/tasks/*.json` 와 `fixtures/*.html` 는 테스트가 임시로 만드는 파일이 아니라,
repo에 실제로 커밋된 예시 원천입니다. 테스트도 이 파일들을 직접 읽고 씁니다.

### 예제와 fixture

- `examples/tasks/simple-cta.json`, `examples/tasks/email-login.json` 는 바로 실행 가능한 committed 예시 task 입니다.
- `fixtures/simple-cta.html`, `fixtures/email-login.html` 같은 fixture도 repo 안에 실제 파일로 들어 있습니다.
- 테스트는 이 committed 파일들을 그대로 읽습니다. 예시와 fixture 원천은 repo 안의 이 파일들 하나뿐입니다.

### `rawstep.config.ts`

반복 실행에서 매번 긴 CLI 플래그를 쓰지 않으려면 루트에 `rawstep.config.ts` 를 둡니다.
이 파일은 선택 사항이 아니라 **실행 계약 파일**입니다. 없으면 CLI가 바로 실패합니다.

```ts
import { defineConfig } from "@rawstep/config";

export default defineConfig({
  version: 1,
  defaults: {
    provider: "anthropic",
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: "claude-3-5-sonnet-latest"
  },
  modes: {
    keyboard: {
      outDir: "./.rawstep/out/keyboard",
      headless: true,
      maxSteps: 20,
      timeoutMs: 180000,
      verifierAutoComplete: true,
      memory: 5
    },
    screenreader: {
      outDir: "./.rawstep/out/screenreader",
      headless: false,
      maxSteps: 240,
      timeoutMs: 420000,
      screenshots: "all",
      verifierAutoComplete: true,
      includeRationale: true,
      includeExperienceSummary: true,
      memory: "all",
      screenReaderBackend: "guidepup-voiceover",
      allowedKeys: [
        kb.tab(),
        kb.shiftTab(),
        kb.enter(),
        kb.escape()
      ],
      allowedScreenReaderActions: [
        sr.next(),
        sr.previous(),
        sr.heading.next(),
        sr.form.next(),
        sr.act()
      ]
    }
  }
});
```

- `defaults` 는 provider 관련 공통값만 받습니다.
  `provider`, `apiKey`, `model`, `baseURL` 만 허용됩니다.
- `defaults.apiKey` 도 받을 수 있지만, 보통은 `process.env.A11Y_TASK_AGENT_API_KEY` 나 provider별 env를 쓰는 편이 안전합니다.
- CLI는 `rawstep.config.ts` 옆의 `.env` 파일을 자동으로 읽고, 이미 셸에 있는 환경 변수는 덮어쓰지 않습니다.
- `modes.<mode>` 는 그 모드의 실행 preset 입니다. 선택한 mode에 해당 preset이 없으면 실행하지 않습니다.
- CLI는 이 파일을 직접 해석하는 것이 아니라, `@rawstep/config` 가 해석한 run plan을 받아 조립만 합니다.
- `headless` 는 브라우저 창 표시 여부입니다. 기본은 `keyboard` 와 `guidepup-virtual` 이면 headless, `guidepup-voiceover` / `guidepup-nvda` 면 headed 입니다.
- `screenReaderBackend` 는 screenreader mode preset이나 task `config` override에 반드시 있어야 합니다.
- `allowedKeys`, `allowedScreenReaderActions` 는 프로그램이 공식 지원하는 전체 목록 중 이번 모드에서 실제 허용할 subset 입니다.
- `allowedKeys` 는 키만 제어합니다. `typeText("email")` 같은 named input 액션은 여기에 포함되지 않고, task에 `input` 이 있을 때만 자동으로 허용됩니다.
- task 파일(`.json`)은 과업 본문이고, `config` 블록은 task 단위 실행 override 입니다.
- CLI 플래그는 이번 한 번만 덮어쓸 값입니다.
- `rawstep.config.ts` 가 없거나, 선택한 mode preset에 `outDir`, `maxSteps`, `timeoutMs`, `memory` 가 비어 있으면 실행하지 않습니다.
- task `config` 에는 `provider`, `apiKey`, `model`, `baseURL` 를 넣을 수 없습니다. provider 설정은 `rawstep.config.ts defaults`, env, CLI override만 사용합니다.

실행 옵션 우선순위는 대체로 다음 순서입니다.

1. CLI 플래그
2. task 파일의 `config`
3. task 파일 top-level 필드 (`mode`, `maxSteps`, `timeoutMs`)
4. `rawstep.config.ts` 의 `modes.<mode>`
5. provider 관련 값이 아직 비어 있으면 환경 변수

### 설정 필드 레퍼런스

실제 코드가 받는 설정 필드는 아래 범위로 고정되어 있습니다.

구조를 먼저 아주 단순하게 보면 이렇습니다.

- `rawstep.config.ts > defaults`: 모델 연결 공통값
- `rawstep.config.ts > modes.<mode>`: mode별 실행 preset
- `task` top-level: 과업 본문
- `task.config`: 그 task에서만 덮어쓰는 실행 옵션
- CLI 플래그: 이번 한 번만 덮어쓰는 최종 override

**`rawstep.config.ts > defaults`**

- `provider`: `anthropic` 또는 `openai-compatible`
- `apiKey`: provider API 키
- `model`: 모델 ID
- `baseURL`: OpenAI-compatible provider일 때만 쓰는 base URL
- `prompt.dir`: prompt 디렉터리 경로. 기본은 `rawstep.config.ts` 와 같은 디렉터리 아래 `./prompt`

`defaults` 는 **AI provider 관련 값과 prompt 디렉터리만** 받습니다. `outDir`, `timeoutMs`, `memory` 같은 실행 옵션을 넣으면 에러가 납니다.

**`rawstep.config.ts > modes.<mode>`**

- `outDir`: 결과 출력 디렉터리. 상대 경로면 `rawstep.config.ts` 기준으로 resolve
- `headless`: 브라우저 창 표시 여부. 생략하면 mode/backend 기본 정책 사용
- `maxSteps`: 최대 step 수
- `timeoutMs`: 전체 실행 제한 시간(ms)
- `maxVerificationRetries`: verifier가 실패했을 때 success 선언을 몇 번까지 되돌릴지
- `screenshots`: `all | important | failure-only | none`
- `verifierAutoComplete`: 성공 가능성이 있는 action 뒤에도 verifier를 돌릴지
- `includeExperienceSummary`: run 종료 후 `overall / blockers / surprise / oneLineFeel` summary 포함 여부
- `includeRationale`: agent `rationale` 저장 여부
- `memory`: 숫자 또는 `all`
- `allowedKeys`: `keyboard` 또는 `screenreader`에서 허용할 키 subset
- `allowedScreenReaderActions`: `screenreader`에서 허용할 `sr.*` / `srx.*` subset
- `screenReaderBackend`: `guidepup-voiceover | guidepup-nvda | guidepup-virtual`

여기서 사실상 필수로 봐야 하는 값은 `outDir`, `maxSteps`, `timeoutMs`, `memory` 입니다.  
`screenreader` preset에는 `screenReaderBackend` 도 사실상 필수입니다.

task 본문과 task `config` 작성법은 바로 아래 [Task 작성 가이드](#task-작성-가이드)에서 따로 설명합니다.

CLI 파라미터는 아래 [rawstep run 파라미터](#rawstep-run-파라미터)에서 따로 설명합니다.

## Task 작성 가이드

task 파일은 "어느 페이지에서 무엇을 해야 하는지"를 적는 과업 본문입니다.

실제로는 아래 committed 예시를 그대로 실행합니다.

- [examples/tasks/simple-cta.json](/Users/bh2980/Desktop/a11y/examples/tasks/simple-cta.json:1)
- [examples/tasks/email-login.json](/Users/bh2980/Desktop/a11y/examples/tasks/email-login.json:1)

가장 작은 task는 아래처럼 생각하면 됩니다.

```json
{
  "url": "../../fixtures/simple-cta.html",
  "goal": "Get started 버튼을 찾아서 활성화하고, 결과 메시지가 보이는 상태로 만들어라.",
  "verify": {
    "all": [
      { "textVisible": "Started!" },
      { "titleIncludes": "Completed" }
    ]
  }
}
```

쉽게 말하면:

- `url`: 어디서 실행할지
- `goal`: 무엇을 해야 하는지
- `verify`: 진짜 성공인지 어떻게 다시 확인할지

### task top-level 키

- `id?`: 생략하면 보통 파일명 기반 ID를 씁니다.
- `url`: 실행할 페이지 URL. 상대 경로면 task 파일 기준으로 resolve
- `goal`: 자연어 과업 목표
- `mode?`: `keyboard | screenreader`
- `maxSteps?`: task 자체가 요구하는 최대 step 수
- `timeoutMs?`: task 자체가 요구하는 제한 시간(ms)
- `verify`: 성공 판정 규칙. 필수
- `input?`: named string map. 예: `email`, `password`, `otp`

여기 들어가는 값은 **과업 본문**입니다. 예를 들어 `input.email`, `input.password` 는 이 task에서만 쓰는 고정 입력값입니다.

예를 들어 `input` 이 있는 task는 이렇게 씁니다.

```json
{
  "id": "email-login",
  "url": "../../fixtures/email-login.html",
  "goal": "이메일 입력칸에 email input 값을 넣고, Send magic link 버튼을 눌러 성공 메시지가 보이게 만들어라.",
  "mode": "keyboard",
  "maxSteps": 24,
  "timeoutMs": 180000,
  "input": {
    "email": "traveler@example.com"
  },
  "verify": {
    "all": [
      { "textVisible": "Magic link sent." },
      { "textVisible": "traveler@example.com" },
      { "titleIncludes": "Completed" }
    ]
  }
}
```

`input` 은 task가 제공하는 named string map 입니다. 예를 들어 `email`, `password`, `otp` 같은 키를 둘 수 있습니다. agent는 임의 텍스트를 만들지 않고, 필요할 때만 `{"action":{"typeText":"email"}}` 같이 키를 골라 그 값을 입력합니다.

### task `config` override

- `mode`, `outDir`, `headless`, `maxSteps`, `timeoutMs`
- `maxVerificationRetries`
- `screenshots`, `verifierAutoComplete`
- `includeExperienceSummary`, `includeRationale`
- `memory`
- `allowedKeys`, `allowedScreenReaderActions`
- `screenReaderBackend`

task `config` 는 **실행 override만** 받습니다.  
여기에는 `provider`, `apiKey`, `model`, `baseURL`, `prompt.dir` 를 넣을 수 없습니다.

쉽게 말하면 task `config` 는 mode preset보다 강하고, CLI 플래그보다는 약한 중간 override 입니다.

task 파일에도 필요한 경우 override를 둘 수 있습니다.

```json
{
  "id": "simple-cta",
  "url": "../../fixtures/simple-cta.html",
  "goal": "Get started 버튼을 찾아서 활성화하고, 결과 메시지가 보이는 상태로 만들어라.",
  "verify": {
    "all": [
      { "textVisible": "Started!" },
      { "titleIncludes": "Completed" }
    ]
  },
  "config": {
    "mode": "screenreader",
    "timeoutMs": 600000,
    "memory": "all",
    "headless": true,
    "screenReaderBackend": "guidepup-virtual",
    "allowedScreenReaderActions": [
      "sr.next",
      "sr.act"
    ]
  }
}
```

쉽게 말하면 `config` 는 "이 task만 mode나 timeout, 허용 action subset을 살짝 다르게 돌리고 싶을 때" 쓰는 블록입니다.

### task 작성할 때 기억할 점

- task 파일은 현재 JSON만 받습니다.
- `url`, `goal`, `verify` 는 사실상 필수라고 생각하면 됩니다.
- 공통 실행값은 `rawstep.config.ts > modes.<mode>` 로 올리고, task에는 과업 본문만 두는 편이 읽기 쉽습니다.
- task `config` 는 예외적인 override가 있을 때만 쓰는 편이 좋습니다.
- CLI에서 한 번만 강제로 바꾸고 싶으면 아래 [rawstep run 파라미터](#rawstep-run-파라미터)를 씁니다.
- `verify` 는 아래 [verify 레퍼런스](#verify-레퍼런스)를 기준으로 씁니다.

실제로 많이 쓰는 예시는 아래 둘입니다.

**예시 1: keyboard 기본 preset**

```ts
import { defineConfig } from "@rawstep/config";

export default defineConfig({
  version: 1,
  defaults: {
    provider: "openai-compatible",
    model: "openrouter/auto",
    baseURL: "https://openrouter.ai/api/v1"
  },
  modes: {
    keyboard: {
      outDir: "./.rawstep/out/keyboard",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: 5,
      screenshots: "important",
      verifierAutoComplete: false
    }
  }
});
```

**예시 2: screenreader preset**

```ts
import { defineConfig } from "@rawstep/config";

export default defineConfig({
  version: 1,
  defaults: {
    provider: "anthropic",
    model: "claude-3-5-sonnet-latest"
  },
  modes: {
    screenreader: {
      outDir: "./.rawstep/out/screenreader",
      maxSteps: 80,
      timeoutMs: 300000,
      memory: "all",
      headless: true,
      screenReaderBackend: "guidepup-virtual",
      allowedKeys: ["Tab", "Shift+Tab", "Enter", "Escape"],
      allowedScreenReaderActions: [
        sr.next(),
        sr.previous(),
        sr.heading.next(),
        sr.act()
      ]
    }
  }
});
```

### LLM provider 설정

내장 provider는 `anthropic` 또는 `openai-compatible` 입니다. 값은 `rawstep.config.ts defaults`, 환경 변수, CLI override로 줄 수 있습니다.

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

provider별 fallback은 다음과 같습니다.

- `provider`: CLI `--provider` -> `defaults.provider` -> `A11Y_TASK_AGENT_PROVIDER`
- `apiKey`: `defaults.apiKey` -> `A11Y_TASK_AGENT_API_KEY` -> (`anthropic`일 때만 `ANTHROPIC_API_KEY`)
- `model`: CLI `--model` -> `defaults.model` -> `A11Y_TASK_AGENT_MODEL` -> (`anthropic`일 때만 `A11Y_TASK_ANTHROPIC_MODEL`)
- `baseURL`: CLI `--base-url` -> `defaults.baseURL` -> `A11Y_TASK_AGENT_BASE_URL`

CLI에서 실행별로 덮어쓸 수도 있습니다.

```bash
pnpm rawstep run examples/tasks/simple-cta.json \
  --config ./rawstep.config.ts \
  --mode screenreader \
  --headless \
  --max-steps 40 \
  --timeout-ms 240000 \
  --screen-reader-backend guidepup-virtual \
  --allowed-keys Tab,Enter \
  --allowed-screen-reader-actions sr.next,sr.act \
  --agent-memory-window 5 \
  --no-agent-memory-all \
  --include-experience-summary \
  --screenshots important \
  --include-rationale \
  --verifier-auto-complete \
  --provider openai-compatible \
  --model openrouter/auto \
  --base-url https://openrouter.ai/api/v1
```

## CLI 옵션

현재 CLI는 사실상 `rawstep run` 하나를 중심으로 동작합니다.

```bash
rawstep run <task-file> [options...]
```

쉽게 말하면:

- `<task-file>` 는 필수 위치 인자입니다.
- 나머지는 모두 이번 한 번만 덮어쓰는 실행 파라미터입니다.

### rawstep run 파라미터

**`<task-file>`**

- 실행할 task JSON 파일 경로입니다.
- 상대 경로를 줄 수 있습니다.

**`--config <rawstep.config.ts>`**

- 사용할 config 파일 경로입니다.
- 자동 config discovery 대신 이 파일을 강제로 씁니다.
- `.ts` 파일만 받습니다.

**`--mode <keyboard|screenreader>`**

- 이번 실행의 mode를 강제로 지정합니다.
- task 파일이나 `rawstep.config.ts` preset보다 우선합니다.

**`--out <dir>`**

- 결과 출력 디렉터리를 강제로 지정합니다.
- `trace.jsonl`, `trace.json`, `metrics.json`, `prompts.json`, `report/`가 여기로 나갑니다.

**`--headless` / `--headed`**

- 브라우저 창 표시 여부를 강제로 정합니다.
- backend 기본값이나 mode preset보다 우선합니다.

**`--screenshots <all|important|failure-only|none>`**

- screenreader 리포트용 개발자 스크린샷 저장 정책입니다.
- keyboard 모드의 agent 입력 screenshot 자체를 끄는 옵션은 아닙니다.

**`--max-steps <n>`**

- 최대 step 수를 강제로 지정합니다.
- 숫자는 0 이상의 정수여야 합니다.

**`--timeout-ms <n>`**

- 전체 실행 제한 시간을 밀리초 단위로 지정합니다.
- 숫자는 0 이상의 정수여야 합니다.

**`--screen-reader-backend <guidepup-voiceover|guidepup-nvda|guidepup-virtual>`**

- screenreader 모드에서 사용할 backend를 강제로 지정합니다.
- keyboard 모드에서는 보통 필요 없습니다.

**`--allowed-keys <key1,key2>`**

- 허용할 keyboard action subset만 남깁니다.
- 쉼표 구분 한 줄로 받습니다.
- 예: `--allowed-keys Tab,Shift+Tab,Enter`

**`--allowed-screen-reader-actions <sr.token1,sr.token2>`**

- 허용할 screen reader action subset만 남깁니다.
- 쉼표 구분 한 줄로 받습니다.
- 예: `--allowed-screen-reader-actions sr.next,sr.act,sr.read.itemText`

**`--verifier-auto-complete` / `--no-verifier-auto-complete`**

- verifier가 조건 만족을 확인하면 agent가 직접 `success`를 말하지 않아도 자동 종료할지 정합니다.
- 기본은 꺼져 있다고 생각하면 됩니다.

**`--agent-memory-window <n>`**

- agent에게 다시 보여줄 최근 step memory 개수를 정합니다.
- `0` 이면 사실상 memory를 안 보여줍니다.

**`--agent-memory-all` / `--no-agent-memory-all`**

- 최근 일부가 아니라 누적된 text memory 전체를 다시 보여줄지 정합니다.
- 켜면 `--agent-memory-window` 보다 넓은 범위를 씁니다.

**`--include-experience-summary` / `--no-include-experience-summary`**

- run 종료 후 `overall / blockers / surprise / oneLineFeel` summary를 만들지 정합니다.

**`--include-rationale` / `--no-include-rationale`**

- agent가 decision JSON 안에 `rationale` 필드를 넣을지 정합니다.
- 디버깅용이라고 생각하면 쉽습니다.

**`--provider <anthropic|openai-compatible>`**

- 이번 실행에서 쓸 LLM provider를 강제로 지정합니다.
- `defaults.provider` 나 환경 변수보다 우선합니다.

**`--model <id>`**

- 이번 실행에서 쓸 모델 ID를 강제로 지정합니다.

**`--base-url <url>`**

- OpenAI-compatible provider일 때 쓸 base URL을 강제로 지정합니다.

config 필드와 대응하는 대표 CLI override는 아래처럼 맞춰져 있습니다.

- `screenReaderBackend` -> `--screen-reader-backend`
- `headless` -> `--headless` / `--headed`
- `allowedKeys` -> `--allowed-keys`
- `allowedScreenReaderActions` -> `--allowed-screen-reader-actions`
- `maxSteps` -> `--max-steps`
- `timeoutMs` -> `--timeout-ms`
- `verifierAutoComplete` -> `--verifier-auto-complete` / `--no-verifier-auto-complete`
- `includeExperienceSummary` -> `--include-experience-summary` / `--no-include-experience-summary`
- `includeRationale` -> `--include-rationale` / `--no-include-rationale`
- `memory: "all"` -> `--agent-memory-all` / `--no-agent-memory-all`
- `memory: 5` -> `--agent-memory-window 5`

배열형 override는 쉼표 구분 한 개 플래그로 받습니다.

- `--allowed-keys Tab,Shift+Tab,Enter,Space`
- `--allowed-screen-reader-actions sr.next,sr.previous,sr.act`

### 전체 지원 키보드 키

`allowedKeys` 나 `--allowed-keys` 에 넣을 수 있는 키는 현재 아래 전체 목록으로 고정되어 있습니다.

```text
Tab
Shift+Tab
Home
End
ArrowUp
ArrowDown
ArrowLeft
ArrowRight
Backspace
Delete
Enter
Shift+Enter
Space
Escape
Mod+A
Mod+Backspace
Mod+Delete
Mod+Z
Mod+Shift+Z
```

이 중 기본 허용 subset은 더 작습니다.

```text
Tab
Shift+Tab
Home
End
ArrowUp
ArrowDown
ArrowLeft
ArrowRight
Enter
Space
Escape
```

쉽게 말하면, `Backspace`, `Delete`, `Mod+A`, `Mod+Z` 같은 편집 계열 키는 "지원은 하지만 기본으로는 안 켜져 있는 키" 입니다.

### 전체 지원 `sr.*` 명령어

`allowedScreenReaderActions` 나 `--allowed-screen-reader-actions` 에 넣을 수 있는 stable `sr.*` 명령은 현재 아래 전체 목록으로 고정되어 있습니다.

```text
sr.next
sr.previous
sr.act
sr.interact
sr.stopInteracting
sr.press
sr.type
sr.click
sr.heading.next
sr.heading.previous
sr.heading.level.1.next
sr.heading.level.1.previous
sr.heading.level.2.next
sr.heading.level.2.previous
sr.heading.level.3.next
sr.heading.level.3.previous
sr.heading.level.4.next
sr.heading.level.4.previous
sr.heading.level.5.next
sr.heading.level.5.previous
sr.heading.level.6.next
sr.heading.level.6.previous
sr.form.next
sr.form.previous
sr.link.next
sr.link.previous
sr.button.next
sr.button.previous
sr.landmark.next
sr.landmark.previous
sr.list.next
sr.list.previous
sr.table.next
sr.table.previous
sr.read.itemText
sr.read.itemTextLog
sr.read.lastSpokenPhrase
sr.read.spokenPhraseLog
sr.clear.itemTextLog
sr.clear.spokenPhraseLog
```

주의할 점은 두 가지입니다.

- 이 목록이 전부 "항상 다 되는 것"은 아닙니다. backend마다 실제 지원 subset이 다릅니다.
- `srx.*` 확장 action은 별도 extension action이고, 위의 stable `sr.*` 목록에는 포함되지 않습니다.

`keyboard` 모드는 screenshot 이미지를 같이 보내므로, 선택한 provider/model이
이미지 입력을 지원해야 합니다.

모드별 제약은 다음처럼 걸립니다.

- `keyboard` 모드에서는 `screenReaderBackend`, `allowedScreenReaderActions` 를 쓸 수 없습니다.
- `screenreader` 모드에서 `allowedKeys: []` 로 두면 예전 strict처럼 screen reader action만 남습니다.
- backend별 지원 action 차이는 `@rawstep/action-catalog`가 중앙에서 판정합니다.

## `verify` 레퍼런스

`verify` 는 task 성공 판정 규칙입니다. 형식은 항상 아래와 같습니다.

```yaml
verify:
  all:
    - textVisible: Started!
    - titleIncludes: Completed
```

중요한 규칙은 4가지입니다.

1. `verify` 는 반드시 `all` 배열이어야 합니다.
2. `all` 안의 rule은 **전부 통과**해야 최종 성공입니다.
3. 각 rule object는 키를 **정확히 하나만** 가져야 합니다.
4. verifier는 기본적으로 agent가 `success` 를 선언했을 때 실행됩니다.
   `--verifier-auto-complete` 를 켜면, 성공 가능성이 있는 action 뒤에도 추가로 확인할 수 있습니다.

지원하는 rule 종류는 현재 5개입니다.

**`titleIncludes`**

```yaml
verify:
  all:
    - titleIncludes: Completed
```

- 현재 `document.title` 에 지정한 문자열이 포함되면 통과합니다.
- 부분 포함 검사입니다.

**`urlIncludes`**

```yaml
verify:
  all:
    - urlIncludes: /checkout
```

- 현재 페이지 URL 문자열에 지정한 값이 포함되면 통과합니다.
- `pathname` 만이 아니라 전체 URL 문자열 기준이라 query string도 같이 매칭될 수 있습니다.

**`textVisible`**

```yaml
verify:
  all:
    - textVisible: Magic link sent.
```

- 페이지에서 해당 텍스트를 찾고, 그 첫 번째 매치가 실제로 보여야 통과합니다.
- 내부적으로는 Playwright `getByText(..., { exact: false }).first()` 를 씁니다.
- 즉 완전 일치가 아니라 부분 포함에 가깝습니다.

**`requestSeen`**

```yaml
verify:
  all:
    - requestSeen:
        urlIncludes: /api/cart
        method: POST
```

- 실행 중 관측된 네트워크 요청 목록에서 조건에 맞는 요청이 하나라도 있으면 통과합니다.
- `method` 는 선택 사항입니다.

**`responseSeen`**

```yaml
verify:
  all:
    - responseSeen:
        urlIncludes: /api/cart
        method: POST
        status: 200
```

- 실행 중 관측된 네트워크 응답 목록에서 조건에 맞는 응답이 하나라도 있으면 통과합니다.
- `method`, `status` 는 선택 사항입니다.

실무에서 많이 쓰는 패턴은 아래 정도입니다.

- 화면 상태가 바뀌는 fixture: `textVisible` + `titleIncludes`
- 라우팅 이동 확인: `urlIncludes`
- API 호출이 중요한 플로우: `requestSeen` 또는 `responseSeen`
- 폼 제출 확인: `textVisible` + `responseSeen`

예를 들어 폼 성공 예제는 이렇게 쓸 수 있습니다.

```yaml
verify:
  all:
    - textVisible: Magic link sent.
    - textVisible: traveler@example.com
    - titleIncludes: Completed
```

그리고 API 기반 예제는 이렇게 쓸 수 있습니다.

```yaml
verify:
  all:
    - requestSeen:
        urlIncludes: /api/login
        method: POST
    - responseSeen:
        urlIncludes: /api/login
        method: POST
        status: 200
```

쉽게 말하면 `verify` 는 "agent가 성공했다고 우겨도, 바깥에서 진짜 성공인지 다시 확인하는 체크리스트" 입니다.

### 프롬프트 편집

프롬프트는 루트의 [prompt](/Users/bh2980/Desktop/a11y/prompt) 디렉터리에서 직접 편집합니다.

- [keyboard.system.md](/Users/bh2980/Desktop/a11y/prompt/keyboard.system.md)
- [keyboard.user.md](/Users/bh2980/Desktop/a11y/prompt/keyboard.user.md)
- [screenreader.system.md](/Users/bh2980/Desktop/a11y/prompt/screenreader.system.md)
- [screenreader.user.md](/Users/bh2980/Desktop/a11y/prompt/screenreader.user.md)
- [experience-summary.system.md](/Users/bh2980/Desktop/a11y/prompt/experience-summary.system.md)
- [experience-summary.user.md](/Users/bh2980/Desktop/a11y/prompt/experience-summary.user.md)

`*.system.md` 는 규칙을 적는 파일이고, `*.user.md` 는 실제 실행 데이터가 들어가는 템플릿입니다.

이 파일들은 반드시 존재해야 하고 비어 있으면 안 됩니다.  
`{{goal}}`, `{{agentMemory}}`, `{{announcement}}`, `{{readbacks}}`, `{{availableActions}}`, `{{outputExamples}}`, `{{taskSummary}}`, `{{aggregateSummary}}`, `{{stepTimeline}}` 같은 자리표시자는 코드가 런타임에 채웁니다.
프롬프트 파일 안에서 `<!-- ... -->` 로 감싼 Markdown 주석은 로딩할 때 제거되므로, 내부 메모를 남겨도 모델 입력에는 들어가지 않습니다.
값이 비어 있을 수 있는 블록은 그냥 빈 문자열로 지우지 않고, `status: empty` 또는 `status: present` 와 `value/items` 구조로 명시해서 채웁니다. 반대로 템플릿에 있는 placeholder를 코드가 아예 공급하지 못하면 렌더링 에러로 바로 실패합니다.

#### 파일별 역할

- [keyboard.system.md](/Users/bh2980/Desktop/a11y/prompt/keyboard.system.md)
  - keyboard agent의 규칙서입니다.
  - 어떤 근거를 우선할지, 언제 `success`/`stuck` 을 선택할지, 출력 JSON 모양이 어떤지 적습니다.
- [keyboard.user.md](/Users/bh2980/Desktop/a11y/prompt/keyboard.user.md)
  - keyboard agent에게 이번 턴의 실제 입력 데이터를 주는 템플릿입니다.
  - goal, action history, focus hint, available actions 같은 실행 중 데이터가 들어갑니다.
- [screenreader.system.md](/Users/bh2980/Desktop/a11y/prompt/screenreader.system.md)
  - screenreader agent의 규칙서입니다.
  - announcement 기반으로 어떻게 판단할지, raw key를 언제 써도 되는지, 출력 JSON 모양이 어떤지 적습니다.
- [screenreader.user.md](/Users/bh2980/Desktop/a11y/prompt/screenreader.user.md)
  - screenreader agent에게 이번 턴의 실제 입력 데이터를 주는 템플릿입니다.
  - goal, agent memory, 현재 announcement, readbacks, available actions가 들어갑니다.
- [experience-summary.system.md](/Users/bh2980/Desktop/a11y/prompt/experience-summary.system.md)
  - run이 끝난 뒤 summary를 만들 때 쓰는 규칙서입니다.
  - 어떤 사실만 써야 하는지, 어떤 추측을 하면 안 되는지, 최종 JSON 필드가 무엇인지 적습니다.
- [experience-summary.user.md](/Users/bh2980/Desktop/a11y/prompt/experience-summary.user.md)
  - run 종료 후 summary에 넣을 실제 데이터 템플릿입니다.
  - task 요약, aggregate 요약, step timeline이 들어갑니다.

#### 파일별 변수

**`keyboard.system.md`**

- `{{outputExamples}}`: 지금 허용된 keyboard action, `typeText.<key>`, verdict 예시 JSON 묶음

**`keyboard.user.md`**

- `{{goal}}`: 현재 task 목표 문장
- `{{agentMemory}}`: 최근 action/outcome 요약. `status: present|empty` 와 `items` 구조로 들어갑니다.
- `{{focusHint}}`: 현재 focus hint. `status: present|empty` 와 `value` 구조로 들어갑니다.
- `{{availableActions}}`: 지금 턴에서 허용된 `key.*`, `typeText.*` 목록. `status: present|empty` 와 `items` 구조로 들어갑니다.

**`screenreader.system.md`**

- `{{outputExamples}}`: 지금 허용된 `sr.*`, `srx.*`, `key.*`, `typeText.*`, verdict 예시 JSON 묶음

**`screenreader.user.md`**

- `{{goal}}`: 현재 task 목표 문장
- `{{agentMemory}}`: 최근 action/outcome 요약. `status: present|empty` 와 `items` 구조로 들어갑니다.
- `{{announcement}}`: 현재 step에서 잡힌 announcement. `status: present|empty` 와 `value` 구조로 들어갑니다.
- `{{readbacks}}`: read/clear 결과를 사람이 읽기 쉬운 `items` 목록으로 정리한 값
- `{{availableActions}}`: 지금 턴에서 허용된 `sr.*`, `srx.*`, `key.*`, `typeText.*` 목록. `status: present|empty` 와 `items` 구조로 들어갑니다.

**`experience-summary.system.md`**

- 변수 없음
- 이 파일은 규칙만 적는 정적 system prompt입니다.

**`experience-summary.user.md`**

- `{{taskSummary}}`: task id, mode, goal, input key 같은 task 단위 요약
- `{{aggregateSummary}}`: result, endedBy, totalSteps, duration, action count, failure point 요약
- `{{stepTimeline}}`: 각 step의 observation, decision, execution, verification/result를 짧게 풀어쓴 timeline
- 이 세 블록 안의 optional 값도 같은 방식으로 `empty` 상태를 명시합니다.

#### 렌더링 예시

**`keyboard.user.md` 예시**

템플릿:

```md
goal:
{{goal}}

action history:
{{agentMemory}}

focus hint:
{{focusHint}}

available actions:
{{availableActions}}
```

렌더링 후 예시:

```text
goal:
Finish the task.

action history:
- status: present
- items:
  - step 0: action="key(Tab)", outcome="continued"

focus hint:
- status: present
- value: "input[type=email] \"Work email\""

available actions:
- status: present
- items:
  - key.Tab
  - key.Enter
  - typeText.email
```

**`screenreader.user.md` 예시**

템플릿:

```md
goal:
{{goal}}

announcement:
{{announcement}}

readbacks:
{{readbacks}}
```

렌더링 후 예시:

```text
goal:
Finish the task.

announcement:
- status: present
- value: "Submit button"

readbacks:
- status: present
- items:
  - method=itemText, value="Email"
  - method=clearItemTextLog, status=cleared
```

**`experience-summary.user.md` 예시**

템플릿:

```md
Task
{{taskSummary}}

Aggregate
{{aggregateSummary}}

Step Timeline
{{stepTimeline}}
```

렌더링 후 예시:

```text
Task
- id: simple-cta
- mode: keyboard
- goal: Activate the CTA.
- input keys status: empty

Aggregate
- result: success
- ended by: success
- total steps: 2
- duration: 1432 ms
- failure point status: empty

Step Timeline
- status: present
- items:
  - step 0 | observation=Keyboard observation on "Simple CTA Fixture" at /fixture. | decision=key.Tab | execution=ok with cost delta 0.
  - step 1 | observation=Keyboard observation on "Simple CTA Fixture" at /fixture. | decision=key.Enter | execution=ok with cost delta 1. | result=success via agent.
```

### 수정 포인트 가이드

무엇을 바꾸려는지에 따라 먼저 봐야 할 파일이 다릅니다.  
쉽게 말하면 "진짜 원본 1곳"을 먼저 고치고, 나머지는 그 결과를 따라가게 만드는 구조입니다.

- **새 키보드 키를 추가하거나 기본 허용 키를 바꾸려면**
  - 원본은 [packages/action-catalog/src/source.ts](/Users/bh2980/Desktop/a11y/packages/action-catalog/src/source.ts:1) 의 `keyboardActionSource` 입니다.
  - `cliToken`, `helperPath`, `defaultAllowed` 를 여기서 정합니다.
  - generated 결과물은 직접 고치지 않습니다.

- **새 stable `sr.*` 명령을 추가하거나 backend별 지원 범위를 바꾸려면**
  - 원본은 [packages/action-catalog/src/source.ts](/Users/bh2980/Desktop/a11y/packages/action-catalog/src/source.ts:1) 의 `screenReaderActionSource` 입니다.
  - `semantic`, `kind`, `argumentKind`, `backendSupport`, `catalogIdsByBackend` 를 여기서 정합니다.
  - 쉽게 말하면 `sr.heading.next` 같은 명령은 여기서 시작합니다.

- **mode 이름이나 mode 정책을 바꾸려면**
  - 원본은 [packages/definition/src/modes/source.ts](/Users/bh2980/Desktop/a11y/packages/definition/src/modes/source.ts:1) 의 `MODE_SPEC` 입니다.
  - `keyboard` / `screenreader` 가 어떤 관측을 쓰는지, raw key를 허용하는지, backend가 필요한지 여기서 정합니다.

- **backend id, 플랫폼 지원, headless 정책을 바꾸려면**
  - 원본은 [packages/definition/src/backends/source.ts](/Users/bh2980/Desktop/a11y/packages/definition/src/backends/source.ts:1) 의 `BACKEND_SPEC` 입니다.
  - backend 이름, 지원 OS, browser 정책, `supportsRawPerform` 를 여기서 정합니다.

- **backend capability snapshot을 갱신하려면**
  - checked-in snapshot은 [packages/definition/src/backends/generated-capabilities.ts](/Users/bh2980/Desktop/a11y/packages/definition/src/backends/generated-capabilities.ts:1) 입니다.
  - 생성 스크립트는 [packages/runtime/scripts/generate-backend-capabilities.ts](/Users/bh2980/Desktop/a11y/packages/runtime/scripts/generate-backend-capabilities.ts:1) 입니다.
  - 쉽게 말하면 snapshot은 결과물이고, 실제 생성 로직은 runtime 쪽 스크립트가 가집니다.

- **`rawstep.config.ts` 에 쓸 수 있는 필드 모양을 바꾸려면**
  - authoring 타입 원본은 [packages/config/src/project/source.ts](/Users/bh2980/Desktop/a11y/packages/config/src/project/source.ts:1) 입니다.
  - `defineConfig`, `defaults`, `modes.<mode>` shape가 여기서 시작합니다.

- **config 필드 검증 규칙을 바꾸려면**
  - 원본은 [packages/config/src/project/schema.ts](/Users/bh2980/Desktop/a11y/packages/config/src/project/schema.ts:1) 입니다.
  - 어떤 필드를 허용할지, 어떤 값이 에러인지, parser가 무엇을 받아들이는지 여기서 정합니다.

- **override 우선순위를 바꾸려면**
  - 원본은 [packages/config/src/run-plan/precedence.ts](/Users/bh2980/Desktop/a11y/packages/config/src/run-plan/precedence.ts:1) 입니다.
  - CLI, task `config`, task top-level, mode preset, defaults 중 누가 이기는지 여기서 정합니다.

- **최종 실행 계획이 어떻게 조립되는지 바꾸려면**
  - 원본은 [packages/config/src/run-plan/resolve.ts](/Users/bh2980/Desktop/a11y/packages/config/src/run-plan/resolve.ts:1) 입니다.
  - task 읽기, config 읽기, mode 선택, action plan 계산, `ResolvedRunPlan` 생성이 여기서 끝납니다.

- **CLI 플래그나 help/usage 문구를 바꾸려면**
  - 원본은 [packages/config/src/run-plan/cli-manifest.ts](/Users/bh2980/Desktop/a11y/packages/config/src/run-plan/cli-manifest.ts:1) 입니다.
  - 쉽게 말하면 CLI 옵션의 진짜 원본은 `args.ts` 가 아니라 manifest 입니다.

- **프롬프트 문구를 바꾸려면**
  - 원본은 [prompt](/Users/bh2980/Desktop/a11y/prompt) 아래 `*.system.md`, `*.user.md` 파일들입니다.
  - 규칙을 바꾸려면 `*.system.md`, 실제 입력 모양을 바꾸려면 `*.user.md` 를 봅니다.

- **예시 task나 fixture를 바꾸려면**
  - 원본은 [examples/tasks](/Users/bh2980/Desktop/a11y/examples/tasks) 와 [fixtures](/Users/bh2980/Desktop/a11y/fixtures) 입니다.
  - 테스트가 이 파일들을 다시 생성하지는 않습니다. repo에 커밋된 파일이 원본입니다.

`--screenshots` 는 screenreader 리포트용 개발자 스크린샷 저장 정책을 고릅니다.

- `all` — 모든 step 저장
- `important` — verdict step, verification step, 실행 실패 step, `typeText(<input-key>)`, `sr.click` 같은 상태 변화 가능 action만 저장
- `failure-only` — 실패와 verifier 실패 위주로만 저장
- `none` — screenreader 리포트용 개발자 스크린샷을 저장하지 않음

keyboard 모드의 screenshot은 agent 입력 자체이므로 이 옵션의 영향을 받지 않습니다.

`--verifier-auto-complete` 는 기본값이 꺼진 실험 옵션입니다.

- agent가 success를 선언하지 않아도,
- **최소 한 번 이상 성공 action을 한 뒤**
- verifier가 조건 만족을 확인하면 자동 종료할 수 있습니다.

이 경우 report의 `completionSource` 가 `verifier-auto-complete` 로 남아, agent가 직접 닫은 성공과 구분됩니다.

`--agent-memory-window` 는 agent에게 다시 보여줄 이전 step archive 개수를 정합니다.

- 코드에 숨은 기본값은 없습니다. `rawstep.config.ts` 의 `memory` 나 CLI override로 정해야 합니다.
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
- 이 summary는 `overall`, `blockers`, `surprise`, `oneLineFeel` 구조를 가집니다.
- summary는 root cause를 단정하거나 pass/fail을 다시 판정하지 않고, 실행 흐름과 마찰만 요약합니다.

## 상태와 한계

- 임의 자유 텍스트 입력은 금지합니다. 다만 task가 고정 문자열을 제공한 경우에만
  제한된 text input action을 허용합니다.
- Screen reader strict/hybrid 모드는 RawStep canonical semantic action을 쓰고, 실제 구현은 backend가 맡습니다.
- 현재 backend id 계약은 `guidepup-voiceover`, `guidepup-nvda`, `guidepup-virtual` 입니다.
- backend마다 지원하는 stable `sr.*` action 범위가 다르고, 지원 여부는 `@rawstep/action-catalog` registry 기준으로 판정합니다.
- 에이전트의 성공/실패 판정은 설계상 관측 채널만으로 자체 선언합니다.
  ground-truth 검증이 필요하면 선택적 oracle을 사용하세요.
