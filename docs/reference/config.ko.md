# 설정 파일 레퍼런스 (`rawstep.config.json`)

`rawstep.config.json`(`version: 7`, [`packages/project/src/config.ts`](../../packages/project/src/config.ts)에 정의됨)과 `.env.local`의 전체 설정 항목 안내입니다.

---

## 1. 최상위 구조

```json
{
  "version": 7,
  "connections": [],
  "profiles": [],
  "tasks": [],
  "project": {
    "analysis": {
      "instructions": ""
    },
    "suggestions": {}
  },
  "machine": {
    "atEndpoints": {
      "voiceover": "",
      "nvda": ""
    },
    "browserExecutablePath": "",
    "headless": true,
    "browserEndpoint": "",
    "proxyServer": "",
    "parallelRuns": 1
  }
}
```

`version`(반드시 `7`), `connections`, `profiles`(1개 이상), `tasks`, `machine`은 필수입니다(`connections`와 `tasks`는 빈 배열이어도 되고, `machine`은 모든 필드에 기본값이 있어 `{}`도 가능합니다). `project`는 선택입니다. 알 수 없는 키는 어디에서든 거부됩니다.

---

## 2. 모델 연결 (`connections[]`)

`connections`(최대 100개)의 각 항목은 AI 모델에 연결하는 경로를 정의합니다. 연결 자체에는 모델 ID가 들어가지 않으며, 프로필이나 프로젝트 설정에서 연결 ID와 사용할 `modelId`를 함께 지정합니다.

| 필드 | 타입 | 기본값 | 제약 사항 및 설명 |
| :--- | :--- | :--- | :--- |
| `id` | `string` | *(필수)* | `/^[A-Za-z0-9._-]{1,100}$/` 패턴을 만족하는 고유 ID. |
| `name` | `string` | *(필수)* | 표시 이름 (`1–16384`자). |
| `provider` | `ProviderId` | *(필수)* | `'openai'`, `'anthropic'`, `'google'`, `'openrouter'`, `'claudeCode'`, `'codex'`, `'opencode'`, `'grok'`, `'antigravity'`, `'custom'` 중 하나. |
| `baseURL` | `string` (URL) | *(프리셋 기본값)* | `provider === 'custom'`일 때 **필수**이며, 다른 프로바이더에서는 지정할 수 없습니다. |
| `apiKeyEnv` | `string` | *(프리셋 기본값)* | API 키가 담긴 환경 변수 이름 (`/^[A-Z][A-Z0-9_]{0,100}$/`). `provider === 'custom'`일 때만 지정할 수 있습니다. |
| `timeoutMs` | `number` | `60000` (API)<br>`180000` (에이전트 CLI) | 모델 호출당 제한 시간(밀리초, `100–600000`). |

### 프로바이더 프리셋 및 환경 변수 (`PROVIDERS`)

API 키는 `rawstep.config.json`에 적지 않고 `.env.local`(파일 권한 `0600`)이나 셸 환경 변수에 저장합니다.

| `provider` | 종류 | 기본 `baseURL` / 실행 명령어 | 기본 환경 변수 이름 | 대체 환경 변수 |
| :--- | :--- | :--- | :--- | :--- |
| `openai` | 클라우드 API | `https://api.openai.com/v1` | `RAWSTEP_OPENAI_API_KEY` | `OPENAI_API_KEY` |
| `anthropic` | 클라우드 API | `https://api.anthropic.com/v1` | `RAWSTEP_ANTHROPIC_API_KEY` | `ANTHROPIC_API_KEY` |
| `google` | 클라우드 API | `https://generativelanguage.googleapis.com/v1beta/openai` | `RAWSTEP_GOOGLE_API_KEY` | `GEMINI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` |
| `openrouter` | 클라우드 API | `https://openrouter.ai/api/v1` | `RAWSTEP_OPENROUTER_API_KEY` | `OPENROUTER_API_KEY` |
| `claudeCode` | 에이전트 CLI (ACP) | `npx -y @agentclientprotocol/claude-agent-acp@0.89.1` | *(없음 — `claude` 로그인 사용)* | — |
| `codex` | 에이전트 CLI (ACP) | `npx -y @agentclientprotocol/codex-acp@2.2.2` | *(없음 — `codex login` 사용)* | — |
| `opencode` | 에이전트 CLI (ACP) | `opencode acp` | *(없음 — `opencode auth login` 사용)* | — |
| `grok` | 에이전트 CLI (ACP) | `grok agent stdio` | *(없음 — `grok` 로그인 사용)* | — |
| `antigravity` | 에이전트 CLI (ACP) | `agy_acp_server.par` | *(없음 — UI에서 OAuth 로그인)* | — |
| `custom` | OpenAI 호환 서버 | *(`baseURL`로 지정)* | *(선택적 `apiKeyEnv`)* | — |

---

## 3. 실행 프로필 (`profiles[]`)

`profiles`(`1–500`개)의 각 항목은 실험 조건 전체를 하나의 이름으로 묶어 정의합니다. `id`(연결 ID와 같은 패턴), `name`, `actions`는 필수이고, `planner`, `page`(`"default"`), `screenReader`(`"simulation"`), `runRules`(모두 기본값)는 선택입니다. `planner`가 없는 프로필은 검증은 통과하지만 플래너를 지정하기 전에는 실행할 수 없습니다.

```json
{
  "id": "by-headings",
  "name": "By Headings",
  "planner": {
    "connectionId": "openai-main",
    "modelId": "gpt-4.1",
    "reasoningEffort": "medium",
    "instructions": ""
  },
  "actions": {
    "keys": [],
    "intents": ["next", "previous", "activate", "heading.next", "heading.previous", "headings.list"],
    "typeText": true,
    "replaceText": true
  },
  "page": "default",
  "screenReader": "simulation",
  "runRules": {
    "repetitionGuard": true,
    "maxUnchangedTransitions": 4,
    "confirmationGrace": 5,
    "maxPlannerCalls": 40,
    "reviewEvery": 60,
    "stepActionLimit": 12,
    "failureLimit": 2,
    "noChangeLimit": 3,
    "plannerHistoryLimit": 60,
    "survey": "headings"
  }
}
```

### 3.1 `planner`
**LLM 플래너** 또는 **파일 플래너** 중 하나를 지정합니다.
- **LLM 플래너:**
  - `connectionId` (`string`, 필수): `connections`에 등록된 연결 ID.
  - `modelId` (`string`, 필수): 해당 연결에서 사용할 모델 ID.
  - `reasoningEffort` (`string`, 선택): 추론 강도 (예: `"low"`, `"medium"`, `"high"`).
  - `instructions` (`string`, 기본값 `""`, 최대 `16384`자): 기본 플래너 규칙 뒤에 덧붙일 추가 지침. 처음 쓰는 실제 사용자가 알 수 없는 페이지 지식(예: 버튼 위치)을 적어서는 안 됩니다. 그러면 길을 찾는 어려움, 곧 측정하려는 대상이 사라집니다.
- **파일 플래너:**
  - `planFile` (`string`, 필수): `.json`으로 끝나는 프로젝트 상대 경로 (`{task}` 치환자 지원, 예: `"plans/{task}.json"`).

### 3.2 `actions` (`Permissions`)
시뮬레이션 사용자가 사용할 수 있는 동작을 제어합니다.
`keys`, `intents`, `typeText`, `replaceText`는 모두 필수(기본값 없음)이고 `inputKeys`는 선택입니다. `keys`와 `intents`는 각각 최대 100개까지 지정할 수 있습니다.
- `intents` (`string[]`): 허용할 스크린리더 명령 목록:
  - 기본 이동 및 읽기: `'next'`, `'previous'`, `'activate'`, `'readCurrent'`, `'readFocused'`
  - 헤딩 탐색: `'heading.next'`, `'heading.previous'`, `'headings.list'`
  - 폼 컨트롤 탐색: `'form.next'`, `'form.previous'`, `'formControls.rotor'`
  - 링크 탐색: `'link.next'`, `'link.previous'`, `'links.list'`
- `keys` (`string[]`): 허용할 물리 키보드 키. 시뮬레이션(`screenReader: "simulation"`)은 `'Tab'`, `'Shift+Tab'`, `'Enter'`, `'Space'`, `'Escape'`, `'ArrowUp'`, `'ArrowDown'`, `'ArrowLeft'`, `'ArrowRight'`, `'Home'`, `'End'`만 지원합니다. 실제 AT Driver 백엔드(`voiceover`, `nvda`)는 여기에 `'Backspace'`, `'Delete'`, `'PageUp'`, `'PageDown'`, `'Shift+Enter'`, `'Mod+A'`도 지원합니다.
- `typeText` (`boolean`): 선언된 태스크 입력값 타이핑 허용 여부.
- `replaceText` (`boolean`): 기존 입력창 텍스트를 지우고 선언된 태스크 입력값으로 덮어쓰기 허용 여부.
- `inputKeys` (`string[]`, 선택): `task.input` 중 타이핑을 허용할 키 이름 목록.

### 3.3 페이지 환경 (`page`)

`profile.page`에는 **9가지 내장 프리셋 이름** 중 하나 또는 커스텀 `EnvironmentProfile` 객체를 지정할 수 있습니다.
- 내장 프리셋: `'default'` (`1280×800`, 변경 없음), `'narrow'` (`320×800`), `'text-200'` (글자 2배), `'spacing'` (WCAG 텍스트 간격: 줄 높이 1.5, 글자 간격 `0.12em`, 단어 간격 `0.16em`, 문단 간격 `2em`), `'reflow-text'` (`320×800`에 글자 2배), `'forced-colors'`, `'contrast'` (`prefers-contrast: more`), `'dark'`, `'reduced-motion'`.
- 커스텀 객체 필드 (모두 선택이며 생략한 항목은 `default` 값을 따르고, 알 수 없는 키는 오류): `id` (`/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/`), `viewport` (`{ width, height }`, 둘 다 필수인 정수: width `240..7680`, height `200..4320`), `textScale` (`1..4`), `colorScheme` (`'light' | 'dark' | 'no-preference'`), `forcedColors` (`'none' | 'active'`), `contrast` (`'no-preference' | 'more'`), `reducedMotion` (`'no-preference' | 'reduce'`), `textSpacing` (네 키 모두 필수: `lineHeight` `1..4`, `letterSpacingEm` `0..1`, `wordSpacingEm` `0..2`, `paragraphSpacingEm` `0..5`), `at` (`{ name, version?, configuration? }`, 각 500자 이내 문자열이며 `name`은 비어 있으면 안 됨: 실행이 기대하는 스크린리더로, 백엔드가 알려 주는 값과 대조합니다), `diagnostics` (`boolean`, 기본값 `true`), `requireApplied` (`boolean`, 기본값 `true`: 요청한 설정이 적용되지 않았거나 `at`이 일치하지 않으면 실행이 중단됨).

### 3.4 `screenReader`
- `'simulation'` *(기본값)*: 내장 Chromium 접근성 트리 시뮬레이터 (`MockVoiceOverBackend`).
- `'voiceover'`: W3C AT Driver를 통한 macOS VoiceOver.
- `'nvda'`: W3C AT Driver를 통한 Windows NVDA.

### 3.5 실행 규칙 (`runRules`)
`rawstep.config.json`의 프로필마다 설정할 수 있으며, CLI 실행 시 `--rule <name>=<value>`로 일회성 덮어쓰기가 가능합니다.

| 규칙 이름 | 타입 및 범위 | 기본값 | 설명 |
| :--- | :--- | :---: | :--- |
| `repetitionGuard` | `boolean` | `true` | 동일한 동작이 연속으로 `maxUnchangedTransitions`번 똑같은 음성만 낼 때 실행을 중단합니다. |
| `maxUnchangedTransitions` | 정수 `1–10000` | `4` | `repetitionGuard`가 작동하기까지 허용할 연속 동일 전이 횟수. |
| `confirmationGrace` | 정수 `0–100` | `5` | `verify.all` 조건이 충족된 단계에서 변화를 알리는 음성 안내가 전혀 없었을 때, 즉시 종료하지 않고 추가로 지켜볼 이동 횟수 (`0`이면 즉시 종료). 어느 쪽이든 `reached`로 끝나며, 이 이동은 비용에 넣지 않습니다. |
| `maxPlannerCalls` | 정수 `1–1000` | `40` | 한 번의 실행에서 플래너 모델을 호출할 수 있는 최대 횟수 (초과 시 `unmeasured`로 종료). |
| `reviewEvery` | 정수 `1–10000` | `60` | 마지막 플래너 호출 이후 `effort-review` 재계획을 요청하기까지의 이동 횟수. |
| `stepActionLimit` | 정수 `1–1000` | `12` | 하나의 세부 작업에서 새로운 단서를 듣지 못한 채 이동할 수 있는 최대 횟수 (초과 시 `task-limit` 재계획 요청). |
| `failureLimit` | 정수 `1–100` | `2` | 하나의 세부 작업에서 연속 동작 실패 시 재계획(`failures`)을 요청할 횟수. |
| `noChangeLimit` | 정수 `1–100` | `3` | 하나의 세부 작업에서 아무것도 바꾸지 못한 동작이 연속될 때 재계획(`no-change`)을 요청할 횟수. |
| `plannerHistoryLimit` | 정수 `1–10000` | `60` | 재계획 시 플래너에게 전달할 최근 동작 및 음성 기록의 최대 개수. |
| `survey` | `'none' \| 'headings'` | `'headings'` | `'headings'`이고 프로필에서 `headings.list`가 허용되어 있으면, 첫 계획 수립 전에 1단계에서 페이지 헤딩 목록을 먼저 조회합니다. |

---

## 4. 등록된 태스크 (`tasks[]`)

`rawstep.config.json`에 프로젝트 태스크 파일들을 등록합니다 (최대 500개).

| 필드 | 타입 | 기본값 | 설명 |
| :--- | :--- | :--- | :--- |
| `id` | `string` | *(필수)* | 고유 태스크 ID (`/^[A-Za-z0-9._-]{1,100}$/`). |
| `name` | `string` | *(필수)* | 표시 이름. |
| `file` | `string` | *(필수)* | 태스크 JSON 파일의 프로젝트 상대 경로 (예: `"tasks/checkout.json"`). |
| `profiles` | `string[]` *(선택)* | *(첫 번째 프로필)* | `--profile`을 지정하지 않고 실행할 때 사용할 기본 프로필 ID 목록 (최대 20개). |
| `tags` | `string[]` *(선택)* | `[]` | `rawstep suite --tag` 필터링에 사용할 태그 목록 (최대 10개). 각 태그는 문자 또는 숫자로 시작하고 문자, 숫자, `-`, `_`만 쓸 수 있으며 30자 이내입니다(공백 불가). |
| `minimalSteps` | `number` *(선택)* | *(없음)* | 사람이 이 목표를 완료하는 데 필요한 최소 이동 횟수 (`1–10000`). 리포트에서 비교 기준선으로 표시됩니다. |
| `variantOf` | `string` *(선택)* | *(없음)* | 이 태스크가 특정 접근성 결함을 가진 변형본일 때 기준이 되는 원본 태스크 ID (한 단계까지만: 원본은 그 자체가 변형본이 아닌 다른 태스크여야 함). 리포트에서 원본 태스크와 이동 횟수를 비교합니다. |
| `analysisInstructions` | `string` *(선택)* | *(프로젝트 기본값)* | 이 태스크에 대해서만 `project.analysis.instructions`를 덮어씁니다. |

### 검증

다음 경우 설정 파일을 불러올 때 오류가 납니다.
- 연결, 태스크, 프로필 중 같은 종류끼리 `id`가 겹치거나, 두 태스크의 `file`이 같을 때
- 태스크의 `profiles`가 존재하지 않는 프로필을 가리킬 때
- 태스크의 `variantOf`가 자기 자신, 없는 태스크, 또는 이미 변형본인 태스크를 가리킬 때
- 프로필의 `planner`, `project.analysis.model`, `project.suggestions.model`이 `connections`에 없는 `connectionId`를 가리킬 때

---

## 5. 프로젝트 공통 설정 (`project`)

실행 자체의 동작에는 영향을 주지 않는 프로젝트 단위의 보조 모델 설정입니다.

- **`project.analysis`:**
  - `model` (`{ connectionId, modelId, reasoningEffort? }`, 선택): 실행 완료 후 트레이스 분석(`LlmTraceAnalyzer`)에 사용할 기본 모델. 생략하면 로컬 규칙 기반 분석기만 실행됩니다.
  - `instructions` (`string`, 기본값 `""`): 사후 분석 모델에 전달할 추가 분석 지침.
- **`project.suggestions`:**
  - `model` (`{ connectionId, modelId, reasoningEffort? }`, 선택): 대시보드에서 태스크 작성 시 **AI 제안 받기** 기능에 사용할 모델 (생략 시 `project.analysis.model` 또는 첫 번째 프로필의 LLM 플래너를 사용).

---

## 6. 머신 설정 (`machine`)

Rawstep을 실행하는 현재 컴퓨터 환경에 맞춘 설정입니다.

| 필드 | 타입 | 기본값 | 설명 |
| :--- | :--- | :--- | :--- |
| `atEndpoints` | `{ voiceover: string, nvda: string }` | `{ voiceover: "", nvda: "" }` | 실제 AT Driver 서버의 루프백 WebSocket URL. 빈 문자열이면 기본값(`voiceover`는 `ws://localhost:4382/session`, `nvda`는 `ws://localhost:3031/session`)을 사용합니다. |
| `browserExecutablePath` | `string` | `""` | 직접 지정할 Chrome/Chromium 실행 파일 경로. 비워 두면 Playwright Chromium이나 시스템에 설치된 Google Chrome을 사용합니다. |
| `headless` | `boolean` | `true` | 브라우저를 헤드리스 모드로 띄울지 여부 (네이티브 `voiceover`·`nvda` 스크린리더나 `personCheck` 사용 시에는 항상 `false`가 적용됨). |
| `browserEndpoint` | `string` | `""` | `"browser": { "mode": "connect" }` 태스크가 연결할 로컬 Chrome DevTools HTTP 엔드포인트 (예: `"http://localhost:9222"`). |
| `proxyServer` | `string` | `""` | 인증 정보가 없는 프록시 URL (`http://`, `https://`, `socks4://`, `socks5://`). 브라우저 실행 시 사용합니다. |
| `parallelRuns` | 정수 `1–8` | `1` | `run` 및 `suite` 실행 시 기본 동시 브라우저 실행 수. |
