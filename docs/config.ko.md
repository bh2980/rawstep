# 설정 안내 (`rawstep.config.json`)

프로젝트 폴더의 `rawstep.config.json` 하나가 대시보드, CLI, `runTask`의 설정을 모두 담습니다. `rawstep init` 또는 `rawstep ui`가 처음 만들며, 스키마는 `@rawstep/project`가 소유합니다(`@rawstep/project/config`). 같은 파일을 대시보드에서 편집하고 CLI에서 읽으므로 둘은 항상 같은 설정으로 실행됩니다.

## 파일 관리

| 대상 | git |
|---|---|
| `rawstep.config.json` | 프로젝트와 함께 커밋합니다 |
| `.env.local` | 커밋하지 않습니다. 제공자별 API 키가 들어 있습니다 |
| `.rawstep/` | 커밋하지 않습니다. 실행 결과와 대시보드 이력이 쌓입니다 |

API 키는 설정 파일에 들어가지 않습니다. 기본 제공자는 정해진 환경변수(아래 표)를 쓰고, `custom` 연결만 `apiKeyEnv`에 환경변수 이름을 적습니다. 값은 프로세스 환경이나 프로젝트의 `.env.local`에서 읽습니다. 대시보드는 키를 `.env.local`(권한 0600)에 쓰고 UI에는 설정 여부만 돌려줍니다. 설정 파일은 검증 후 원자적으로 저장하며, 외부에서 파일을 고치면 대시보드가 저장 충돌로 알려 줍니다.

## 최상위 필드

| 필드 | 내용 |
|---|---|
| `version` | 항상 `3` |
| `connections` | 모델에 닿는 곳. 제공자 프리셋 또는 직접 지정한 서버 |
| `tasks` | 등록한 작업 파일과, 각 작업이 기본으로 쓰는 실험 조건 |
| `combos` | 모델 조합: 누가 계획하고 누가 행동하는지. 최소 하나 |
| `actionSets` | 행동 조합: 시뮬레이션하는 사용자가 할 수 있는 행동. 최소 하나 |
| `pageEnvironments` | 페이지 환경(화면 크기, 글자, 색상 조건). 최소 하나 |
| `atEnvironments` | 보조기술 환경: 시뮬레이션, VoiceOver, NVDA. 최소 하나 |
| `presets` | 위 조건을 묶어 저장한 실행 프리셋(선택) |
| `runRules` | 프로젝트의 기본 실행 규칙 |
| `project` | 실행 결과를 바꾸지 않는 프로젝트 공통 설정: 해설 모델·지침, 완료 확인 제안 모델 |
| `machine` | 이 컴퓨터의 설정 |

알 수 없는 필드는 거부합니다. `id`는 영문자·숫자·`.`·`_`·`-` 100자 이하입니다. `rawstep init`은 모델 조합 `Default`(실행 모델 없음), 행동 조합 `Basic`, 페이지 환경 `Default`(`profile: "default"`), 보조기술 환경 `Simulated VoiceOver`(시뮬레이션)를 하나씩 만들고 연결·작업은 비워 둡니다.

예전 설정(`version` 1 또는 2)은 읽지 않고 오류 코드 `old-config`로 멈춥니다. Rawstep 저장소에서 `node scripts/migrate-config.mjs <프로젝트 폴더>`로 한 번 변환하세요. 대시보드의 실행 기록(`.rawstep/experiments/*/experiment.json`)도 함께 변환하며, 원본은 각각 `.bak` 사본으로 남깁니다.

## 실험 조건

실험은 **작업 × 모델 조합 × 행동 조합 × 페이지 환경 × 보조기술 환경 × 모드**입니다. 각 조건은 설정 파일의 공용 목록이므로 한 번에 한 조건만 바꿔 실행을 비교할 수 있습니다.

| 조건 | 담는 것 |
|---|---|
| 모델 조합 (`combos`) | 구조(모델 단독 / 계획 + 실행), 계획 모델과 지침, 모드별 실행 모델과 지침, 선택 사항인 해설 모델 |
| 행동 조합 (`actionSets`) | 모드별로 허용하는 키, 스크린리더 동작, 이름 있는 입력값 입력 |
| 페이지 환경 (`pageEnvironments`) | 화면 크기, 글자 크기·간격, 색상·대비, 움직임 |
| 보조기술 환경 (`atEnvironments`) | 스크린리더 백엔드: `simulation`, `voiceover`, `nvda` |
| 실행 규칙 (`runRules`) | 언제 막힌 것으로 보고 멈추는지, 계획 모델이 있으면 언제 다시 계획하는지 |

실행 프리셋은 이 가운데 일부를 묶습니다. 실행이 쓰는 조건은 작업이 직접 지정한 값, 작업의 프리셋, 목록의 첫 번째 공용 항목 순으로 정합니다. 실행 규칙도 프로젝트 기본값, 프리셋, 작업 순으로 덮어씁니다. `rawstep run`의 옵션(`--combo`, `--actions`, `--environment`, `--at`, `--preset`, `--rule`)은 그 실행에 한해 이 값을 대체합니다. 실행마다 쓴 조건의 내용 전체(작업 전용 사본이면 원본 공용 항목)를 기록하므로, 실행은 이름이 아니라 내용으로 비교합니다.

실행이 끝나는 방식을 바꾸는 설정은 모두 실험 조건입니다. 해설 모델은 끝난 실행을 설명할 뿐 결과를 바꾸지 않으므로 조건이 아닙니다.

## connections

연결은 모델에 닿는 곳입니다. 제공자 프리셋(정해진 주소와 키 환경변수)이거나 직접 지정한 서버입니다. 연결에는 모델이 들어 있지 않고, 모델 조합이 연결 위에서 모델을 고릅니다([combos](#combos-모델-조합) 참고).

| 필드 | 설명 |
|---|---|
| `id`, `name` | 식별자와 표시 이름 |
| `kind` | `llm`: 상황을 읽고 후보를 고르는 언어 모델(실행, 계획, 사후 분석, 완료 확인 제안). `decision`: 모든 후보의 확률을 바로 돌려주는 빠르고 저렴한 모델(실행 전용) |
| `provider` | 모델이 있는 곳. `kind`에 맞는 제공자만 쓸 수 있습니다(아래 표) |
| `baseURL` | `provider: custom`일 때만 쓰며 이때는 필수입니다. 서버 주소(HTTPS, 이 컴퓨터의 서버는 HTTP도 가능) |
| `apiKeyEnv` | `provider: custom`일 때만. 키를 담은 환경변수 이름(선택, 대문자·숫자·`_`) |
| `timeoutMs` | 모델 요청 제한 시간(100~600000, 기본 60000) |

제공자는 `@rawstep/project/config`의 `PROVIDERS`에 한 번만 정의합니다.

| `kind` | `provider` | 주소 | 키 환경변수 |
|---|---|---|---|
| `llm` | `openai` | `https://api.openai.com/v1` | `RAWSTEP_OPENAI_API_KEY` |
| `llm` | `anthropic` | `https://api.anthropic.com/v1` (Anthropic의 OpenAI 호환 주소) | `RAWSTEP_ANTHROPIC_API_KEY` |
| `llm` | `google` | `https://generativelanguage.googleapis.com/v1beta/openai` | `RAWSTEP_GOOGLE_API_KEY` |
| `llm` | `openrouter` | `https://openrouter.ai/api/v1` | `RAWSTEP_OPENROUTER_API_KEY` |
| `llm` | `claudeCode` | 실행: `npx -y @agentclientprotocol/claude-agent-acp@0.89.1` | 없음 (CLI 로그인) |
| `llm` | `codex` | 실행: `npx -y @agentclientprotocol/codex-acp@2.2.2` | 없음 (CLI 로그인) |
| `llm` | `opencode` | 실행: `opencode acp` | 없음 (CLI 로그인) |
| `llm` | `grok` | 실행: `grok agent stdio`, 이미지 없음 | 없음 (CLI 로그인) |
| `llm` | `antigravity` | 실행: `agy_acp_server.par` (ACP 레지스트리에서 받는 Google의 별도 ACP 서버, 폴더를 `PATH`에 둠) | 없음 (자체 Google 로그인) |
| `llm` | `custom` | OpenAI 호환 서버(LM Studio, Ollama 등), `baseURL` | 선택, `apiKeyEnv` |
| `decision` | `typesafe` | `https://api.typesafe.ai/v1` (`POST /v1/systemone`) | `RAWSTEP_TYPESAFE_API_KEY` |
| `decision` | `gateway` | Vercel AI Gateway(AI SDK의 gateway provider 사용), 텍스트 전용 | `RAWSTEP_AI_GATEWAY_API_KEY` |
| `decision` | `openrouter` | `https://openrouter.ai/api/v1` (`POST /api/v1/systemone`) | `RAWSTEP_OPENROUTER_API_KEY` (`llm`과 같은 키) |
| `decision` | `custom` | `/systemone` 호환 서버, `baseURL` | 선택, `apiKeyEnv` |

**코딩 에이전트 CLI**(`claudeCode`, `codex`, `opencode`, `grok`, `antigravity`)는 주소 대신 ACP(Agent Client Protocol, stdio 위의 JSON-RPC)로 말을 거는 CLI 연결입니다. CLI가 설치되어 로그인되어 있어야 하며, 호출 비용은 CLI 자체의 구독으로 나가므로 API 키도 `baseURL`도 없습니다. 실행 명령은 `PROVIDERS`에 고정되어 있고 공유 설정에서 읽지 않습니다. `npx` 어댑터 둘은 버전을 고정해 처음 쓸 때 내려받으므로 첫 호출이 느립니다. `modelId: "default"`는 에이전트가 정한 모델을 그대로 쓰며, 모델 목록(대시보드 확인과 모델 선택)은 에이전트를 띄워 `default`를 맨 앞에 보여 줍니다. Grok은 이미지를 받지 않아 스크린리더 모드와 분석에만 맞습니다. 판단마다 새 에이전트 세션을 빈 임시 폴더에서 열고, 파일·터미널 접근과 권한 요청은 거절하며, 호출이 끝나면 세션을 지웁니다. 에이전트는 자체 시스템 프롬프트가 커서 호출마다 토큰을 더 쓰고 직접 API보다 느립니다(판단 한 번에 약 4~13초 측정).

같은 기본 제공자의 연결은 키 하나를 함께 씁니다. `llm`은 AI SDK로 제공자의 채팅 API를 호출하고, `decision`은 AI SDK의 실험적 `decide` API를 호출합니다. `typesafe`·`openrouter`·`custom`은 자체 `/systemone` 어댑터, `gateway`는 AI SDK의 gateway provider를 씁니다([SystemOne 결정 모델](./systemone.md)).

### 코딩 에이전트 CLI (`claudeCode`, `codex`, `opencode`, `grok`, `antigravity`)

위에서 설명한 대로 ACP로 대화합니다. `antigravity`는 Google의 ACP 서버 `agy_acp_server.par`를 실행하며, ACP 레지스트리에서 따로 받아 그 폴더를 `PATH`에 둬야 합니다. 이 서버는 자체 Google 로그인을 유지하고, 대시보드 연결 확인의 로그인 버튼으로 한 번 로그인합니다. Rawstep은 스스로 로그인하지 않으며, 로그인 방법이 없는 에이전트는 터미널에서 그 CLI로 직접 로그인해야 합니다. `reasoningEffort`는 에이전트가 얼마나 깊이 생각할지 정하며, 에이전트마다 지원하는 값이 달라 모르는 값은 실행 때 실패합니다.

```json
{ "id": "codex", "name": "Codex", "kind": "llm", "provider": "codex", "timeoutMs": 180000 }
```

## tasks

| 필드 | 설명 |
|---|---|
| `id`, `name` | `rawstep run <task>`에 넘기는 id와 표시 이름 |
| `file` | 프로젝트 기준 작업 JSON 경로. 형식은 [작업 안내](./task.ko.md) |
| `presetId` | 선택. 작업이 기본으로 쓰는 실행 프리셋 |
| `comboId`, `actionSetId`, `pageEnvironmentId`, `atEnvironmentId` | 선택. 작업이 기본으로 쓰는 조건(프리셋보다 우선) |
| `runRules` | 선택. 이 작업에서만 프로젝트·프리셋의 실행 규칙을 덮어씁니다([runRules](#runrules-실행-규칙) 참고) |
| `analysisInstructions` | 이 작업의 분석 지침(`project.analysis.instructions`를 대체) |

작업과 프리셋이 지정하지 않은 조건은 그 목록의 첫 번째 공용 항목을 씁니다. 대시보드에서 작업 안에서 공용 항목을 고치면 작업 전용 사본(`owner`에 작업 id, `copiedFrom`에 원본 id)이 만들어지고 공용 항목은 그대로 남습니다. 작업 전용 사본은 그 작업만 쓰고 작업을 지우면 함께 지워집니다. 작업 전용 사본은 모델 조합, 행동 조합, 페이지 환경에 있습니다.

## combos (모델 조합)

어떤 모델이 어떻게 행동하는지 정합니다. 실험 조건이므로 모델이나 지침을 비교하려면 그 부분만 다른 모델 조합끼리 비교합니다.

| 필드 | 설명 |
|---|---|
| `id`, `name` | 식별자와 표시 이름. `--combo`는 둘 중 아무거나 받습니다 |
| `structure` | `solo`(기본): 그 모드의 실행 모델이 모든 행동을 정합니다. `planned`: 계획 LLM이 계획 문서를 쓰고 실행 모델이 작업을 하나씩 수행합니다 |
| `planner` | `structure`가 `planned`이면 필수이며 아직 스크린리더 모드에서만 씁니다. LLM `{ connectionId, modelId, reasoningEffort?, instructions }`(`llm` 연결이어야 함) 또는 계획 파일 `{ planFile }`([계획 파일](#계획-파일) 참고) 중 하나입니다 |
| `executors` | `screenreader`와 `keyboard` 각각의 실행 모델. 그 모드에서 행동을 고르는 모델과 지침입니다(아래 설명). 실행 모델이 없는 모드는 이 모델 조합으로 실행할 수 없습니다 계획 조합의 스크린리더 실행 모델 자리에는 `{ "followPlan": true }`를 둘 수도 있습니다. 실행 모델 없이 Rawstep이 계획을 그대로 수행해(누르기 작업은 누르고, 이동 작업은 첫 이동 방법) 판단은 계획 모델과 cue가 맡고, 실행 비용이 계획 호출뿐이며 반복 간 편차가 작습니다. 이동과 누르기만 하므로 행동 조합이 입력란 타이핑을 허용하는 작업은 실행 전에 거부합니다. 대시보드는 새 계획 조합에 이것을 고릅니다 |
| `analysis` | 선택. 이 조합의 실행을 해설하는 `llm` 연결의 `{ connectionId, modelId, reasoningEffort? }`. 없으면 `project.analysis.model`을 씁니다 |
| `owner`, `copiedFrom` | 작업 전용 사본에만 붙습니다 |

실행 모델은 `{ connectionId, modelId, reasoningEffort?, inputs, maxChoices, maxImages, instructions, historyLimit, focusGate, latitude }`입니다.

| 필드 | 설명 |
|---|---|
| `connectionId`, `modelId` | 연결 id, 제공자에서 쓰는 모델 이름 |
| `reasoningEffort` | 선택. 에이전트가 주는 추론 강도 중 하나(코딩 에이전트 CLI 연결만 의미가 있음). 비우면 에이전트 기본값(Codex는 xhigh로 느림) |
| `inputs` | `["text"]` 또는 `["text", "image"]` |
| `maxChoices`, `maxImages` | 한 번에 줄 수 있는 후보와 이미지 수의 상한(기본 255, 2) |
| `instructions` | 실행 모델에 주는 지침(필수). [프롬프트 안내](./prompts.ko.md) |
| `historyLimit` | 모델이 보는 지난 단계 수(기본 12) |
| `focusGate` | 키보드 모드의 `decision` 모델에서만(기본 `false`). 행동마다 별도의 포커스 판단으로 후보를 좁힙니다. `llm` 실행 모델에 켜면 실행 전에 거부합니다 |
| `latitude` | 계획 조합의 스크린리더 실행에서(기본 `none`) 작업 안에서 실행 모델이 정하는 범위. `none`: 이동 방법·방향·누를 때를 계획이 정합니다. `direction`: 한 작업이 대상까지 가서 누르고, 실행 모델이 같은 방법으로 되돌아가거나 누를 때를 판단합니다. `method`: 모든 이동을 실행 모델이 고릅니다. 계획 모델도 이에 맞춰 작업을 짭니다 |

키보드 실행 모델은 이미지 입력과 2 이상의 `maxImages`가, 스크린리더 실행 모델은 텍스트 입력이 필요합니다. 계획 모델과 해설 모델은 `llm` 연결이어야 하고, 실행 모델의 연결은 실제로 있어야 합니다.

```json
{
  "id": "plan-and-jev",
  "name": "Plan with GPT, act with Jev",
  "structure": "planned",
  "planner": { "connectionId": "openai", "modelId": "gpt-5", "instructions": "경험 많은 스크린리더 사용자처럼 계획한다." },
  "executors": {
    "screenreader": { "connectionId": "jev", "modelId": "jev-latest", "inputs": ["text"], "maxChoices": 255, "maxImages": 0, "instructions": "허용된 행동만으로 목표에 도달한다.", "historyLimit": 12, "focusGate": false },
    "keyboard": { "connectionId": "jev", "modelId": "jev-latest", "inputs": ["text", "image"], "maxChoices": 255, "maxImages": 2, "instructions": "허용된 키만으로 목표에 도달한다.", "historyLimit": 12, "focusGate": false }
  }
}
```

## actionSets (행동 조합)

시뮬레이션하는 사용자가 모드별로 할 수 있는 행동입니다. 실험 조건입니다(예: 다음/이전만 쓰는 초보, 제목·폼 컨트롤로 건너뛰는 숙련자).

| 필드 | 설명 |
|---|---|
| `id`, `name` | 식별자와 표시 이름. `--actions`는 둘 중 아무거나 받습니다 |
| `keyboard`, `screenreader` | 모드별 허용 행동 `{ keys, intents, typeText, replaceText, inputKeys? }`. 모델이 고를 수 있는 키와 스크린리더 동작, 이름 있는 입력값에 입력하거나 바꿔 쓸 수 있는지(`inputKeys`는 대상 제한, 기본은 작업의 모든 입력) |
| `owner`, `copiedFrom` | 작업 전용 사본에만 붙습니다 |

허용 행동은 모델에 주는 후보 생성과 실행 직전 검사에 모두 적용합니다. 보조기술이 지원하지 않는 행동(시뮬레이션이나 네이티브 스크린리더에 없는 스크린리더 동작 등)이 들어 있으면 브라우저를 띄우기 전에 실행 점검에서 막습니다. 중단 선택지, 독립 검증, 입력 필드 확인은 엔진이 유지합니다.

```json
{ "id": "basic", "name": "Basic", "keyboard": { "keys": ["Tab", "Shift+Tab", "Enter", "Space"], "intents": [], "typeText": false, "replaceText": false }, "screenreader": { "keys": [], "intents": ["next", "previous", "activate"], "typeText": false, "replaceText": false } }
```

## pageEnvironments (페이지 환경)

작업을 실행하는 페이지 조건입니다.

| 필드 | 설명 |
|---|---|
| `id`, `name` | 식별자와 표시 이름. `--environment`는 둘 중 아무거나 받습니다 |
| `profile` | `default`, `narrow`, `zoom-200`, `forced-colors`, `dark`, `reflow-text` 같은 내장 환경 프로필 이름 또는 객체. [환경 프로필 안내](./environment-profiles.md) |
| `owner`, `copiedFrom` | 작업 전용 사본에만 붙습니다 |

```json
{ "id": "narrow", "name": "Narrow", "profile": "narrow" }
```

## atEnvironments (보조기술 환경)

스크린리더 실행이 거치는 보조기술입니다. 키보드 실행은 쓰지 않습니다.

| 필드 | 설명 |
|---|---|
| `id`, `name` | 식별자와 표시 이름. `--at`은 둘 중 아무거나 받습니다 |
| `backend` | `simulation`: Chromium 기반 시뮬레이션이며 trace에 항상 시뮬레이션으로 표시합니다. `voiceover`(macOS) 또는 `nvda`(Windows): AT Driver 서버로 연결하는 네이티브 스크린리더(주소는 [machine](#machine) 참고) |

시뮬레이션 VoiceOver와 실제 VoiceOver를 각각 보조기술 환경으로 두면 같은 작업을 둘로 비교할 수 있습니다.

```json
{ "id": "voiceover", "name": "VoiceOver", "backend": "voiceover" }
```

## presets (실행 프리셋)

조건을 묶어 저장해 한 번에 고르는 것입니다. 모든 필드가 선택이며, 빠진 조건은 첫 번째 공용 항목으로 대체됩니다.

| 필드 | 설명 |
|---|---|
| `id`, `name` | 식별자와 표시 이름. `--preset`은 둘 중 아무거나 받습니다 |
| `comboId`, `actionSetId`, `pageEnvironmentId`, `atEnvironmentId` | 묶는 조건 |
| `runRules` | 선택. 이 프리셋으로 실행할 때의 실행 규칙 |

```json
{ "id": "narrow-beginner", "name": "Beginner on a narrow page", "actionSetId": "basic", "pageEnvironmentId": "narrow", "runRules": { "maxStateVisits": 3 } }
```

## runRules (실행 규칙)

실행이 언제 일찍 멈추는지, 계획 모델이 있으면 언제 다시 계획하는지 정합니다. 최상위 `runRules`가 프로젝트 기본값이고, 프리셋의 `runRules`, 작업의 `runRules`, `--rule <이름>=<값>` 옵션이 각 필드를 덮어씁니다(그 실행에 한해). 실행마다 쓴 규칙을 기록합니다.

| 필드 | 기본값 | 설명 |
|---|---|---|
| `repetitionGuard` | `auto` | `auto`는 스크린리더 모드와 키보드 모드의 `llm` 실행 모델에서 켜고, 키보드 모드의 `decision` 실행 모델에서는 끕니다. `on`·`off`로 고정할 수 있습니다 |
| `maxStateVisits` | 5 | 키보드 모드에서 같은 화면을 이 횟수보다 많이 방문하면 막힌 것으로 보고 멈춥니다 |
| `maxUnchangedTransitions` | 4 | 같은 행동이 같은 발화나 화면을 이 횟수만큼 연달아 만들면 막힌 것으로 보고 멈춥니다 |
| `modelGiveUp` | `false` | 실행 모델이 `stop:stuck`·`stop:uncertain`을 골라 실행을 끝낼 수 있는지. 끄면 모델에는 `stop:success`만 제시하고, 실행은 목표, 한도, 감시로 끝납니다 |
| `maxReplans` | 4 | 계획 모델이 있을 때 계획을 고치는 최대 횟수(체크포인트는 세지 않음). 넘으면 멈춥니다 |
| `stepActionLimit` | 12 | 계획 모델이 있을 때 작업 하나에서 새로운 것을 못 들은 행동이 이 횟수만큼 쌓이면 새 계획을 요청합니다. 항목을 하나씩 새로 들으며 나아가는 동안은 세지 않고, 작업 하나가 이 값의 3배를 넘지는 않습니다 |
| `failureLimit` | 2 | 계획 모델이 있을 때 한 작업에서 행동이 연달아 이만큼 실패하면 새 계획을 요청합니다 |
| `noChangeLimit` | 3 | 계획 모델이 있을 때 한 작업에서 아무것도 바뀌지 않은 행동이 연달아 이만큼이면 새 계획을 요청합니다 |
| `taskControl` | `rawstep` | 계획 모델이 있을 때 작업 종료와 재계획을 누가 정하는지. `rawstep`: 실행 모델은 행동만 고르고, 작업은 cue가 들리면 끝나며, Rawstep의 신호(위 한도, 반복, 실행 모델의 낮은 확신 — `confidenceFloor` 참고)가 새 계획을 요청합니다. `executor`: 실행 모델이 작업 완료를 선언하거나 도움을 요청할 수도 있습니다. 비교용으로 남겨 둔 값입니다 |
| `survey` | `none` | 계획 모델이 있을 때 `headings`면 첫 계획 전에 제목 목록(VoiceOver 로터)을 먼저 듣습니다. 행동 조합이 `headings.list`를 허용해야 합니다 |
| `confirmationGrace` | 5 | 스크린리더 실행에서 목표에 도달했지만 사용자가 들은 말에 성공 문구가 없으면(화면에만 뜬 경우) 이만큼 더 진행한 뒤 끝납니다. 그 행동이 "됐는지 모름" 마찰이고, trace의 `goal.reached`에 도달 단계와 들었는지가 남습니다. 0이면 바로 끝납니다 |
| `confidenceFloor` | 0.25 | `taskControl: "rawstep"`일 때 실행 모델이 얼마나 불확실해도 되는지. 정규화한 값으로, 가장 높은 확률이 무작위 추측(1/n)에서 확신(1) 쪽으로 얼마나 떨어져 있는지입니다. 낮은 선택이 연속 두 번 나오면 새 계획을 요청합니다 |

덮어쓰기는 기본값을 채우지 않습니다. 프리셋이나 작업이 빼 둔 필드는 아래 계층의 값을 그대로 씁니다.

```json
{ "repetitionGuard": "auto", "maxStateVisits": 5, "maxUnchangedTransitions": 4, "modelGiveUp": false, "maxReplans": 4, "stepActionLimit": 12, "failureLimit": 2, "noChangeLimit": 3, "taskControl": "rawstep", "confidenceFloor": 0.25, "survey": "none", "confirmationGrace": 5 }
```

## 전체 예시

연결 두 개, 단독·계획 모델 조합 하나씩, 프리셋, 프로젝트 해설 모델을 담은 `rawstep.config.json`입니다.

```json
{
  "version": 3,
  "connections": [
    { "id": "openai", "name": "OpenAI", "kind": "llm", "provider": "openai", "timeoutMs": 60000 },
    { "id": "jev", "name": "Jev", "kind": "decision", "provider": "typesafe", "timeoutMs": 60000 }
  ],
  "tasks": [
    { "id": "checkout", "name": "Checkout", "file": "tasks/checkout.json", "presetId": "narrow-planned" }
  ],
  "combos": [
    {
      "id": "jev-alone", "name": "Jev alone", "structure": "solo",
      "executors": {
        "screenreader": { "connectionId": "jev", "modelId": "jev-latest", "inputs": ["text"], "maxChoices": 255, "maxImages": 0, "instructions": "Reach the goal with the actions you are allowed.", "historyLimit": 12, "focusGate": false }
      }
    },
    {
      "id": "plan-and-jev", "name": "Plan with GPT, act with Jev", "structure": "planned",
      "planner": { "connectionId": "openai", "modelId": "gpt-5", "instructions": "Plan like an experienced screen reader user." },
      "executors": {
        "screenreader": { "connectionId": "jev", "modelId": "jev-latest", "inputs": ["text"], "maxChoices": 255, "maxImages": 0, "instructions": "Reach the goal with the actions you are allowed.", "historyLimit": 12, "focusGate": false },
        "keyboard": { "connectionId": "jev", "modelId": "jev-latest", "inputs": ["text", "image"], "maxChoices": 255, "maxImages": 2, "instructions": "Reach the goal with the keys you are allowed.", "historyLimit": 12, "focusGate": false }
      }
    }
  ],
  "actionSets": [
    { "id": "basic", "name": "Basic",
      "keyboard": { "keys": ["Tab", "Shift+Tab", "Enter", "Space"], "intents": [], "typeText": false, "replaceText": false },
      "screenreader": { "keys": [], "intents": ["next", "previous", "activate"], "typeText": false, "replaceText": false } }
  ],
  "pageEnvironments": [
    { "id": "default", "name": "Default", "profile": "default" },
    { "id": "narrow", "name": "Narrow", "profile": "narrow" }
  ],
  "atEnvironments": [
    { "id": "simulation", "name": "Simulated VoiceOver", "backend": "simulation" },
    { "id": "voiceover", "name": "VoiceOver", "backend": "voiceover" }
  ],
  "presets": [
    { "id": "narrow-planned", "name": "Narrow page, planned", "comboId": "plan-and-jev", "pageEnvironmentId": "narrow", "runRules": { "maxReplans": 6 } }
  ],
  "runRules": { "repetitionGuard": "auto", "maxStateVisits": 5, "maxUnchangedTransitions": 4, "modelGiveUp": false, "maxReplans": 4, "stepActionLimit": 12, "failureLimit": 2, "noChangeLimit": 3, "taskControl": "rawstep", "confidenceFloor": 0.25, "survey": "none", "confirmationGrace": 5 },
  "project": {
    "analysis": { "model": { "connectionId": "openai", "modelId": "gpt-5-mini" }, "instructions": "Focus on where the page made the run detour." },
    "suggestions": {}
  },
  "machine": { "atEndpoints": { "voiceover": "", "nvda": "" }, "browserExecutablePath": "", "headless": true, "personCheck": false }
}
```

## 계획과 실행 (orchestration)

`structure: "planned"`이면 스크린리더 실행이 둘로 나뉩니다. 계획 LLM이 **계획 문서**를 쓰고, 실행 모델이 작업을 하나씩 수행합니다. 키보드 모드에서는 아직 계획 모델을 쓰지 않습니다(점검이 경고하고 키보드 실행 모델이 혼자 정합니다).

계획 문서에는 다음이 들어 있습니다.

- **성공 기준**(C1, C2, …): 목표에 도달했다고 보려면 사용자가 무엇을 들을 수 있어야 하는지. 상태는 미확인, 충족, 미충족입니다
- **전략과 가정**: 접근 방식 한 줄과, 일반적인 UI 관례에서 끌어낸 가정(A1, A2, …). 상태는 미확인, 맞음, 틀림입니다
- **단계와 번호 붙은 작업**(1, 1.1, 1.2, …): 작업마다 목표, 완료 조건(예측할 수 있으면 정확한 문구를 따옴표로), 맡은 성공 기준, 기대는 가정이 있습니다. 작업 상태는 대기, 진행 중, 완료, 포기, 실패이며 행동 수를 기록하고, 현재 작업을 표시합니다
- **버전과 이력**: 다시 계획하면 문서를 고칩니다. 끝난 작업은 그대로 두고, 포기한 작업은 이유와 함께 남기며, 버전이 오르고 이력에 계기, 틀린 가정, 바뀐 내용을 적습니다

실행 모델은 계획 요약, 현재 작업과 완료 조건, 그 작업에서 한 시도를 보고, 행동을 고르거나 **작업 완료**, 또는 이유를 달아 **도움 요청**을 고릅니다. 이유는 `no-cue`(완료 단서를 찾을 수 없음), `no-effect`(행동이 먹히지 않음), `already-done`(이미 이뤄진 것 같음)입니다. 실행 모델이 작업 완료를 고르면 Rawstep이 완료 조건의 따옴표 문구가 지금이나 직전 발화에 있었는지 대조합니다. 결과(`heard`, `not-heard`, `unchecked`)는 기록하고 계획 모델에게 보여 주며, 작업은 다음으로 넘어갑니다. 단계의 작업이 모두 끝나면 계획 모델이 **체크포인트**에서 그 단계의 성공 기준을 점검하고, 남은 작업이 없으면 마지막 점검을 해 완료를 선언할 수 있습니다.

계획 모델은 실행 모델이 도움을 요청할 때, 체크포인트와 마지막 점검에서, 그리고 실행 규칙이 정한 때에 다시 계획합니다. 한 작업에서 행동 실패가 `failureLimit`회 연속일 때, 변화 없는 행동이 `noChangeLimit`회 연속일 때, 행동 수가 `stepActionLimit`에 이를 때입니다. 계획 모델은 사람이 들을 수 있는 정보, 실행 모델이 쓸 수 있는 행동(입력은 이름만, 비밀값은 주지 않음), 작업별 시도 내역만 받고 접근성 트리는 받지 않습니다.

멈춘 이유는 trace에 다음 중 하나로 구분해 남습니다. `model`(실행 모델), `planner`(계획 모델이 목표 도달을 선언함, 최종 판정은 독립 검증), `exploration-guard`(반복 감시), `orchestration-limit`(`maxReplans`를 넘음). 계획 모델을 쓴 실행의 폴더에는 `plan.json`과 `plan.md`(사람이 읽는 체크박스 형식)도 저장되고, 대시보드는 실행 중에 계획 문서를 실시간으로 보여 줍니다. 계획, 작업 변경, 다시 계획한 이유는 정책 근거로 trace에 남습니다.

다시 계획한 지점, 도움 요청, 포기한 작업, 완료 문구를 듣지 못한 작업, 틀린 가정, 미충족 성공 기준은 마찰 힌트(`replan`, `help-request`, `task-limit`, `unverified-done`)입니다. 실행이 다시 생각해야 했던 곳을 가리킬 뿐 이유는 단정하지 않습니다. 페이지가 어려웠을 수도, 계획이 틀렸을 수도 있습니다.

`planner.instructions`는 Rawstep의 계획 규칙(계획 문서 형식, 들은 것과 허용 행동만으로 계획)에 더해지며 규칙을 대체하지 않습니다. 버튼이 어디 있는지처럼 실제 사용자가 알 수 없는 페이지 지식은 넣지 마세요. Rawstep이 재려는 어려움이 가려집니다. "경험 많은 스크린리더 사용자처럼 계획한다" 같은 전략이나 사용자 유형에 관한 지침은 괜찮습니다. 계획 지침은 계획 근거에 sha256 지문으로 기록됩니다.

### 계획 파일

계획 모델 대신 미리 써 둔 계획을 읽을 수 있습니다: `"planner": { "planFile": "plans/{task}/plan.json" }`. 경로는 프로젝트 기준 상대 경로이고 `.json`으로 끝나야 합니다. `{task}`는 작업 파일 이름(`.json` 제외)으로 바뀌어, 조합 하나로 작업마다 자기 계획을 읽게 할 수 있습니다(작업 파일이 `tasks/checkout.json`이고 경로가 `plans/{task}/L2.json`이면 `plans/checkout/L2.json`을 읽습니다).

파일 형식은 계획 모델의 초안과 같습니다. `strategy`, `criteria`(`C1`...), `assumptions`(`A1`...), 그리고 `tasks`를 담은 `phases`로 이루어지며, 작업마다 `goal`, `done`, `cue`(끝났을 때 들려야 하는 말)가 필요하고 `serves`, `relies`는 선택입니다. `complete`와 `rationale`도 선택입니다.

```json
{
  "strategy": "Find the product, add it to the cart, then open the cart.",
  "criteria": [{ "id": "C1", "text": "The user hears that the item is in the cart." }],
  "assumptions": [{ "id": "A1", "text": "The product page has an \"Add to cart\" button." }],
  "phases": [{ "title": "Add the product", "criteria": ["C1"], "tasks": [
    { "goal": "Move to the 'Add to cart' button", "done": "The user hears \"Add to cart, button\"", "cue": "Add to cart, button", "serves": ["C1"], "relies": ["A1"] },
    { "goal": "Activate the 'Add to cart' button", "done": "The user hears that the item was added", "cue": "added to cart", "serves": ["C1"] }
  ] }]
}
```

실행 중에는 계획이 바뀌지 않습니다. 새 계획을 요청해야 할 상황이면 막힌 작업을 포기로 기록하고 다음 작업으로 넘어갑니다. 사람이 쓴 계획을 돌릴 때, 계획 모델이 쓴 계획을 저장해 다시 돌릴 때, 계획을 고정한 채 실행 모델·행동·환경만 바꿔 비교하는 실험에 씁니다.

모델이 보는 행동 이력에는 각 행동의 실행 결과(`ok`, 실패하면 `not-editable` 또는 `backend` 코드이며 원본 오류 문구는 아님)와 그 뒤 발화·스크린샷이 바뀌었는지(`changed`)가 들어 있습니다.

## project (프로젝트 설정)

실행 결과를 바꾸지 않는 프로젝트 공통 설정입니다.

| 필드 | 설명 |
|---|---|
| `analysis.model` | 선택. `llm` 연결의 `{ connectionId, modelId }`. 모델 조합에 자체 `analysis`가 없으면 이 모델로 모든 실행(`rawstep run`, `runTask`, 대시보드)에 LLM 분석이 더해집니다. 없으면 규칙 기반 분석만 하며, 규칙 기반 분석은 항상 실행됩니다. 키가 없어도 실행은 막지 않고 분석만 건너뜁니다 |
| `analysis.instructions` | 선택. 분석 초점. 작업의 `analysisInstructions`가 이 값을 대체합니다 |
| `suggestions.model` | 선택. 작업을 쓸 때 완료 확인을 제안하는 `llm` 연결의 `{ connectionId, modelId, reasoningEffort? }`. 없으면 분석 모델을 씁니다 |

## machine

실험이 아니라 이 컴퓨터에 속한 설정입니다.

| 필드 | 설명 |
|---|---|
| `atEndpoints` | `{ voiceover, nvda }`. 네이티브 AT Driver의 loopback 주소. 비워 두면(기본) 그 스크린리더 서버의 일반적인 주소를 씁니다. VoiceOver(Bocoup macOS 서버)는 `ws://localhost:4382/session`, NVDA(PAC 서버)는 `ws://localhost:3031/session`입니다. 시뮬레이션은 쓰지 않습니다 |
| `browserExecutablePath` | 쓸 Chromium 경로. 비우면 Playwright의 Chromium |
| `browserEndpoint` | 직접 띄운 Chrome의 `--remote-debugging-port` 주소(예: `http://localhost:9222`). 비우지 않으면 브라우저를 새로 띄우지 않고 거기에 붙어, 사이트가 일반 브라우저(headless 아님, `navigator.webdriver` false)로 보므로 봇 판정이 줄어듭니다. loopback만 가능. 실행마다 그 Chrome 안에 분리된 컨텍스트를 열고 끝나면 연결만 끊으므로 평소 탭의 쿠키는 공유되지 않습니다. `browserExecutablePath`, `headless`, 프록시 설정은 적용되지 않으며, 그 창에서 사람이 봇 확인을 통과해야 하면 `personCheck`와 함께 쓰세요. Chrome은 별도 프로필에서만 포트를 엽니다: `/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.rawstep-chrome"` |
| `headless` | 브라우저를 화면 없이 실행할지(기본 `true`) |
| `personCheck` | Cloudflare 같은 봇 확인이 있는 실제 사이트용. 설치된 Chrome 창을 띄우고 프로필을 `.rawstep/browser-profile`에 유지하며, 봇 확인이 나오면 사람이 그 창에서 통과할 때까지(최대 5분, 실행 시간 제한에서 제외) 기다립니다. Rawstep이 확인을 대신 풀지는 않습니다. 기본 `false` |

`voiceover`와 `nvda` 보조기술 환경은 해당 OS에서 AT Driver 서버가 필요하며, `rawstep doctor`가 엔드포인트 응답을 확인합니다. 해당 주소에 응답하는 서버가 없으면 Rawstep이 명령으로 서버를 시작할 수 있습니다. 이 명령은 프로그램을 실행하므로 공유 설정 파일에는 두지 않고, 이 컴퓨터의 `.env.local`에만 `RAWSTEP_AT_DRIVER_COMMAND`로 저장합니다.

```dotenv
# .env.local (커밋하지 마세요)
RAWSTEP_AT_DRIVER_COMMAND=서버를_시작하는_명령
```

Rawstep은 이 명령으로 서버를 띄우고 주소가 연결을 받을 때까지 기다리며, 실행이 끝나면 자신이 띄운 서버를 종료합니다. 이미 응답하는 서버가 있으면 그대로 씁니다. 스크린리더 자체와 OS 권한 설정은 직접 해야 합니다. Orca는 라이브러리 수준의 고급 백엔드로만 제공합니다.
