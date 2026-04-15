# RawStep
> 과업 기반 접근성 사용성 테스트

## 왜 이 프로젝트가 필요한가

axe-core, Lighthouse와 같은 기존 도구는 DOM을 스캔해 **규칙 위반**을 찾습니다.
하지만 실제 사용자가 겪는 사용성은 측정할 수 없습니다.

- 키보드만 쓰는 사용자가 실제로 "장바구니 담기" 버튼에 도달할 수 있는가?
- 도달하려면 키를 몇 번이나 눌러야 하는가?
- 스크린리더 사용자는 Enter를 누른 뒤 무슨 일이 일어났는지 이해할 수 있는가?
- 구체적으로 **어디서** 사용자가 막히는가?

`rawstep`은 AI를 활용해 **주어진 과업의 수행 과정**을 추적합니다. 이를 통해 서비스가 제한된 환경에서 사용할 수 있는지, 사용할 수 있더라도 불편함은 없는지 확인할 수 있습니다.

|                  | axe / Lighthouse / Pa11y | rawstep                        |
|------------------|--------------------------|--------------------------------|
| 평가 단위        | 규칙 위반                | 과업 완수                      |
| 에이전트 입력    | DOM / ARIA               | 픽셀 또는 음성 텍스트          |
| 출력             | 규칙별 통과/실패         | 전체 trace + 입력 비용 + 실패점|
| 실사용자 관점    | 간접적                   | 직접적 (실제로 시도)           |
| UX 막다른 길 탐지| ✗                        | ✓                              |

---

## 빠른 시작

```bash
pnpm install
pnpm build
cp .env.sample .env
# .env 에서 AI_PROVIDER, AI_API_KEY, AI_MODEL, AI_BASE_URL 값을 채운다
pnpm rawstep run examples/tasks/simple-cta.json
open ./.rawstep/out/keyboard/report/index.html
```

이 repo에는 바로 실행 가능한 기본 [rawstep.config.ts](/Users/bh2980/Desktop/a11y/rawstep.config.ts:1)가 포함되어 있습니다.
처음에는 `rawstep.config.ts`를 새로 만들기보다 `.env.sample`을 복사해서 `.env`만 채우면 됩니다.

screenreader 모드는 OS 접근성 권한이 필요합니다. backend에 따라 headed 브라우저가 필요할 수 있습니다.

---

## 사용자 모델

### `keyboard` — 키보드만 쓰는 시력 있는 사용자

- **관측**: 현재 viewport screenshot + 직전 screenshot 1장
- **행동**: `Tab`, `Shift+Tab`, Arrow keys, `Enter`, `Space`, `Escape`, `Home`, `End`, 등 지정된 키값 + task input이 있을 때만 `typeText`.

### `screenreader` — 스크린리더 사용자

- **관측**: 스크린리더가 실제로 말한 announcement 텍스트. screenshot, DOM, accessibility tree 없음.
- **행동**: 스크린리더 canonical action + `Tab`, `Shift+Tab`, Arrow keys, `Enter`, `Space`, `Escape` 등 지정된 키 값 + task input이 있을 때만 `typeText`.
- 개발자 디버깅용 screenshot은 별도로 저장할 수 있지만 에이전트 입력에는 들어가지 않습니다.

### 의도적으로 주지 않는 정보

- `document.activeElement`, ARIA role/label, accessibility tree
- DOM 셀렉터, 요소의 존재 여부
- 정밀 scroll 수치 (keyboard 모드에서 `top/middle/bottom` 수준은 허용)

---

## Task 작성

task 파일은 "어느 페이지에서 무엇을 해야 하는지"를 적는 과업 본문입니다.

### 최소 예시

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

### `input`이 있는 예시

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

`input`은 task가 제공하는 named string map입니다. 에이전트는 임의 텍스트를 만들지 않고,
필요할 때 `{"action":{"typeText":"email"}}` 같이 키를 골라 그 값을 입력합니다.

### task top-level 키

| 키           | 필수 | 설명 |
|--------------|------|------|
| `url`        | ✓   | 실행할 페이지 URL. 상대 경로면 task 파일 기준으로 resolve |
| `goal`       | ✓   | 자연어 과업 목표 |
| `verify`     | ✓   | 성공 판정 규칙 |
| `id`         |     | 생략하면 파일명 기반 ID 사용 |
| `mode`       |     | `keyboard \| screenreader` |
| `maxSteps`   |     | 최대 step 수 override |
| `timeoutMs`  |     | 제한 시간(ms) override |
| `input`      |     | named string map. 예: `email`, `password`, `otp` |
| `config`     |     | task 단위 실행 override (아래 참고) |

### task `config` override

task `config`는 실행 옵션만 받습니다. `provider`, `apiKey`, `model`, `baseURL`은 넣을 수 없습니다.

```json
{
  "config": {
    "mode": "screenreader",
    "timeoutMs": 600000,
    "memory": "all",
    "headless": true,
    "screenReaderBackend": "guidepup-virtual",
    "allowedScreenReaderActions": ["sr.next", "sr.act"]
  }
}
```

공통 실행값은 `rawstep.config.ts > modes.<mode>`로 올리고, task에는 과업 본문만 두는 편이 읽기 쉽습니다.
`config`는 예외적인 override가 있을 때만 쓰세요.

---

## rawstep.config.ts

`rawstep.config.ts`는 선택 사항이 아닌 **실행 계약 파일**입니다. 없으면 CLI가 바로 실패합니다.

```ts
import { defineConfig, kb, sr } from "@rawstep/config";

export default defineConfig({
  version: 1,
  defaults: {
    provider: "anthropic",
    model: "claude-3-5-sonnet-latest",
    apiKey: process.env.AI_API_KEY
  },
  modes: {
    keyboard: {
      outDir: "./.rawstep/out/keyboard",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: 5,
      screenshots: "important",
      verifierAutoComplete: false
    },
    screenreader: {
      outDir: "./.rawstep/out/screenreader",
      maxSteps: 240,
      timeoutMs: 420000,
      memory: "all",
      headless: false,
      screenReaderBackend: "guidepup-voiceover",
      screenshots: "all",
      verifierAutoComplete: true,
      includeRationale: true,
      includeExperienceSummary: true,
      allowedKeys: [
        kb.tab(), kb.shiftTab(), kb.enter(), kb.escape(),
        kb.arrow.up(), kb.arrow.down(), kb.arrow.left(), kb.arrow.right(),
        kb.home(), kb.end()
      ],
      allowedScreenReaderActions: [
        sr.next(), sr.previous(),
        sr.landmark.next(), sr.landmark.previous(),
        sr.heading.next(), sr.heading.previous(),
        sr.button.next(), sr.button.previous(),
        sr.form.next(), sr.form.previous(),
        sr.interact(), sr.stopInteracting(),
        sr.act()
      ]
    }
  }
});
```

### `defaults` 필드

`defaults`는 AI provider 관련 값과 prompt 디렉터리만 받습니다.
`outDir`, `timeoutMs`, `memory` 같은 실행 옵션을 넣으면 에러가 납니다.

| 필드         | 설명 |
|--------------|------|
| `provider`   | `anthropic` 또는 `openai-compatible` |
| `apiKey`     | provider API 키 |
| `model`      | 모델 ID |
| `baseURL`    | OpenAI-compatible provider일 때만 사용 |
| `prompt.dir` | prompt 디렉터리 경로. 기본은 config 파일 옆 `./prompt` |

### `modes.<mode>` 필드

`outDir`, `maxSteps`, `timeoutMs`, `memory`는 사실상 필수입니다.
`screenreader` preset에는 `screenReaderBackend`도 필수입니다.

| 필드                         | 설명 |
|------------------------------|------|
| `outDir`                     | 결과 출력 디렉터리 |
| `headless`                   | 브라우저 창 표시 여부. 생략하면 mode/backend 기본 정책 사용 |
| `maxSteps`                   | 최대 step 수 |
| `timeoutMs`                  | 전체 실행 제한 시간(ms) |
| `maxVerificationRetries`     | verifier 실패 시 success 선언을 되돌릴 최대 횟수 |
| `screenshots`                | `all \| important \| failure-only \| none` |
| `verifierAutoComplete`       | 성공 가능성이 있는 action 뒤에도 verifier를 돌릴지 |
| `includeExperienceSummary`   | run 종료 후 experience summary 포함 여부 |
| `includeRationale`           | agent `rationale` 저장 여부 |
| `memory`                     | 숫자 또는 `"all"` |
| `allowedKeys`                | 허용할 키 subset |
| `allowedScreenReaderActions` | 허용할 `sr.*` action subset |
| `screenReaderBackend`        | `guidepup-voiceover \| guidepup-nvda \| guidepup-virtual` |

---

## CLI 레퍼런스

```bash
rawstep run <task-file> [options...]
```

CLI 플래그는 이번 실행에서만 적용되는 최종 override입니다.

### 실행 우선순위

```
CLI 플래그
  > task.config
    > task top-level (mode, maxSteps, timeoutMs)
      > rawstep.config.ts modes.<mode>
        > 환경 변수 (provider 관련만)
```

### 전체 파라미터

| 파라미터 | 설명 |
|----------|------|
| `<task-file>` | 실행할 task JSON 파일 경로 (필수) |
| `--config <path>` | 사용할 `rawstep.config.ts` 경로 |
| `--mode <keyboard\|screenreader>` | 실행 mode 강제 지정 |
| `--out <dir>` | 결과 출력 디렉터리 강제 지정 |
| `--headless` / `--headed` | 브라우저 창 표시 여부 |
| `--max-steps <n>` | 최대 step 수 |
| `--timeout-ms <n>` | 전체 실행 제한 시간(ms) |
| `--screen-reader-backend <backend>` | screenreader backend 강제 지정 |
| `--allowed-keys <key1,key2>` | 허용할 키 subset (쉼표 구분) |
| `--allowed-screen-reader-actions <sr.x,sr.y>` | 허용할 sr action subset (쉼표 구분) |
| `--screenshots <all\|important\|failure-only\|none>` | screenreader 리포트용 개발자 스크린샷 저장 정책 |
| `--verifier-auto-complete` / `--no-verifier-auto-complete` | verifier 조건 만족 시 자동 종료 여부 |
| `--agent-memory-window <n>` | agent에게 보여줄 최근 step memory 개수 |
| `--agent-memory-all` / `--no-agent-memory-all` | 누적된 text memory 전체를 보여줄지 |
| `--include-experience-summary` / `--no-include-experience-summary` | experience summary 생성 여부 |
| `--include-rationale` / `--no-include-rationale` | agent rationale 저장 여부 |
| `--provider <anthropic\|openai-compatible>` | LLM provider 강제 지정 |
| `--model <id>` | 모델 ID 강제 지정 |
| `--base-url <url>` | OpenAI-compatible provider base URL |

### 전체 실행 예시

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
  --include-experience-summary \
  --screenshots important \
  --include-rationale \
  --verifier-auto-complete \
  --provider openai-compatible \
  --model openrouter/auto \
  --base-url https://openrouter.ai/api/v1
```

### LLM Provider 환경 변수

```bash
# Anthropic
export AI_PROVIDER=anthropic
export AI_API_KEY=your-key
export AI_MODEL=your-model-id

# OpenAI-compatible (OpenRouter, vLLM, LM Studio 등)
export AI_PROVIDER=openai-compatible
export AI_API_KEY=your-key
export AI_MODEL=your-model-id
export AI_BASE_URL=https://your-openai-compatible-base-url
```

provider 값 fallback 순서:

- `provider`: `--provider` → `defaults.provider` → `AI_PROVIDER`
- `apiKey`: `defaults.apiKey` → `AI_API_KEY`
- `model`: `--model` → `defaults.model` → `AI_MODEL`
- `baseURL`: `--base-url` → `defaults.baseURL` → `AI_BASE_URL`

CLI은 `rawstep.config.ts` 옆의 `.env` 파일을 자동으로 읽고, 이미 셸에 있는 환경 변수는 덮어쓰지 않습니다.

### 허용 키보드 키 전체 목록

`allowedKeys` / `--allowed-keys`에 넣을 수 있는 키 전체 목록입니다.

```
Tab  Shift+Tab  Home  End
ArrowUp  ArrowDown  ArrowLeft  ArrowRight
Enter  Shift+Enter  Space  Escape
Backspace  Delete  Mod+A  Mod+Backspace  Mod+Delete  Mod+Z  Mod+Shift+Z
```

기본 허용 subset (편집 계열 키 제외):

```
Tab  Shift+Tab  Home  End
ArrowUp  ArrowDown  ArrowLeft  ArrowRight
Enter  Space  Escape
```

### 허용 스크린리더 action 전체 목록

`allowedScreenReaderActions` / `--allowed-screen-reader-actions`에 넣을 수 있는 stable `sr.*` 목록입니다.
backend마다 실제 지원 subset이 다르고, 지원 여부는 `@rawstep/action-catalog` 기준으로 판정합니다.

```
sr.next  sr.previous  sr.act
sr.interact  sr.stopInteracting
sr.press  sr.type  sr.click

sr.heading.next  sr.heading.previous
sr.heading.level.{1~6}.next  sr.heading.level.{1~6}.previous

sr.form.next  sr.form.previous
sr.link.next  sr.link.previous
sr.button.next  sr.button.previous
sr.landmark.next  sr.landmark.previous
sr.list.next  sr.list.previous
sr.table.next  sr.table.previous

sr.read.itemText  sr.read.itemTextLog
sr.read.lastSpokenPhrase  sr.read.spokenPhraseLog
sr.clear.itemTextLog  sr.clear.spokenPhraseLog
```

`srx.*` 확장 action은 위 stable 목록에 포함되지 않는 별도 extension입니다.

---

## verify 레퍼런스

`verify`는 task 성공 판정 규칙입니다. 반드시 `all` 배열이어야 하고, 배열 안의 rule이 **전부 통과**해야 성공입니다. 각 rule object는 키를 **정확히 하나만** 가져야 합니다.

verifier는 기본적으로 agent가 `success`를 선언했을 때 실행됩니다.
`--verifier-auto-complete`를 켜면 성공 가능성이 있는 action 뒤에도 추가로 확인합니다.

### rule 종류

**`textVisible`** — 페이지에 해당 텍스트가 실제로 보이면 통과. 부분 포함 검사.

```json
{ "textVisible": "Magic link sent." }
```

**`titleIncludes`** — `document.title`에 지정한 문자열이 포함되면 통과.

```json
{ "titleIncludes": "Completed" }
```

**`urlIncludes`** — 현재 페이지 전체 URL 문자열에 지정한 값이 포함되면 통과.

```json
{ "urlIncludes": "/checkout" }
```

**`requestSeen`** — 실행 중 관측된 네트워크 요청 중 조건에 맞는 것이 하나라도 있으면 통과.

```json
{ "requestSeen": { "urlIncludes": "/api/cart", "method": "POST" } }
```

**`responseSeen`** — 실행 중 관측된 네트워크 응답 중 조건에 맞는 것이 하나라도 있으면 통과.

```json
{ "responseSeen": { "urlIncludes": "/api/cart", "method": "POST", "status": 200 } }
```

`requestSeen`, `responseSeen`의 `method`, `status`는 선택 사항입니다.

### 자주 쓰는 패턴

```jsonc
// 화면 상태 변화
{ "all": [{ "textVisible": "Started!" }, { "titleIncludes": "Completed" }] }

// 라우팅 이동
{ "all": [{ "urlIncludes": "/checkout" }] }

// 폼 제출
{ "all": [{ "textVisible": "Magic link sent." }, { "responseSeen": { "urlIncludes": "/api/login", "status": 200 } }] }
```

---

## 리포트

한 번의 실행마다 다음이 생성됩니다.

| 항목 | 설명 |
|------|------|
| `prompts.json` | step별 system/user prompt와 이미지 개수 |
| Verdict | 과업 달성 / 막힘 / 시간 초과 여부 |
| 단계별 리플레이 | 각 step의 관측, 누른 키, 그 이유 |
| 입력 비용 | 전체 키 입력 수, 키 종류별 분포 |
| 타이밍 분해 | setup / 각 step의 observe / decide / execute / verify 시간 |
| 관측 근거 | screenreader step마다 announcement capture 경로, phrase 수, 종료 이유 |
| Experience summary | `overall`, `blockers`, `surprise`, `oneLineFeel` (opt-in) |
| 성공 근거 분리 | agent 선언 성공과 verifier 통과를 따로 표시 |
| 종료 출처 분리 | agent 선언 종료인지 verifier auto-complete 종료인지 구분 |
| 실패 지점 | 실패 시 종료 직전 관측 하이라이트 |

---

## 프롬프트 편집

프롬프트는 기본적으로 루트 `prompt/` 디렉터리에서 읽습니다. `rawstep.config.ts > defaults.prompt.dir` 를 쓰면 다른 디렉터리로 바꿀 수 있습니다. 선택한 prompt 디렉터리의 파일들은 반드시 존재해야 하고 비어 있으면 안 됩니다.

| 파일 | 역할 |
|------|------|
| `keyboard.system.md` | keyboard agent 규칙서. 판단 기준, verdict 조건, 출력 JSON 형식 |
| `keyboard.user.md` | keyboard agent 매 턴 입력 템플릿 |
| `screenreader.system.md` | screenreader agent 규칙서 |
| `screenreader.user.md` | screenreader agent 매 턴 입력 템플릿 |
| `experience-summary.system.md` | run 종료 후 summary 생성 규칙서 |
| `experience-summary.user.md` | summary 생성용 실행 데이터 템플릿 |

`*.system.md`는 규칙, `*.user.md`는 런타임 데이터가 들어가는 템플릿입니다.
`<!-- ... -->`로 감싼 Markdown 주석은 로딩 시 제거되므로 내부 메모를 남겨도 모델 입력에 들어가지 않습니다.

### 템플릿 변수

**`keyboard.user.md`**: `{{goal}}`, `{{agentMemory}}`, `{{focusHint}}`, `{{availableActions}}`

**`screenreader.user.md`**: `{{goal}}`, `{{agentMemory}}`, `{{announcement}}`, `{{readbacks}}`, `{{availableActions}}`

**`keyboard.system.md`** / **`screenreader.system.md`**: `{{outputExamples}}`

**`experience-summary.user.md`**: `{{taskSummary}}`, `{{aggregateSummary}}`, `{{stepTimeline}}`

---

## 수정 포인트 가이드

| 수정 목적 | 원본 파일 |
|-----------|-----------|
| 새 키보드 키 추가 / 기본 허용 키 변경 | `packages/action-catalog/src/source.ts` → `keyboardActionSource` |
| 새 `sr.*` 명령 추가 / backend별 지원 범위 변경 | `packages/action-catalog/src/source.ts` → `screenReaderActionSource` |
| mode 이름 / mode 정책 변경 | `packages/definition/src/modes/source.ts` → `MODE_SPEC` |
| backend id / 플랫폼 지원 / headless 정책 변경 | `packages/definition/src/backends/source.ts` → `BACKEND_SPEC` |
| backend capability snapshot 갱신 | `packages/definition/src/backends/generated-capabilities.ts` (생성 스크립트: `packages/runtime/scripts/generate-backend-capabilities.ts`) |
| `rawstep.config.ts` 허용 필드 변경 | `packages/config/src/project/source.ts` |
| config 필드 검증 규칙 변경 | `packages/config/src/project/schema.ts` |
| override 우선순위 변경 | `packages/config/src/run-plan/precedence.ts` |
| 실행 계획 조립 방식 변경 | `packages/config/src/run-plan/resolve.ts` |
| CLI 플래그 / help 문구 변경 | `packages/config/src/run-plan/cli-manifest.ts` |
| 프롬프트 문구 변경 | `prompt/*.system.md`, `prompt/*.user.md` |
| 예시 task / fixture 변경 | `examples/tasks/`, `fixtures/` |

generated 결과물은 직접 고치지 않습니다. 항상 원본 파일을 수정하세요.

---

## 상태와 한계

- 임의 자유 텍스트 입력은 금지합니다. task가 고정 문자열을 제공한 경우에만 제한된 text input action을 허용합니다.
- backend마다 지원하는 stable `sr.*` action 범위가 다릅니다. 지원 여부는 `@rawstep/action-catalog` registry 기준으로 판정합니다.
- `keyboard` 모드는 screenshot 이미지를 같이 보내므로, 선택한 provider/model이 이미지 입력을 지원해야 합니다.
- 에이전트의 성공/실패 판정은 관측 채널과 verifier 결과만으로 결정합니다. 별도의 ground-truth oracle 경로는 현재 내장되어 있지 않습니다.
