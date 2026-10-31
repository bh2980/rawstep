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
| `version` | 항상 `7` |
| `connections` | 모델에 닿는 곳. 제공자 프리셋 또는 직접 지정한 서버. 모델과 추론 강도는 쓰는 곳에서 고릅니다 |
| `profiles` | 실행 프로필: 실행이 끝나는 방식을 바꾸는 모든 것을 한 이름으로 묶은 것. 최소 하나 |
| `tasks` | 등록한 작업 파일. 작업은 무엇을 할지만 담고, 누가 어떻게 할지는 실행할 때 고르는 프로필이 정합니다 |
| `project` | 실행 결과를 바꾸지 않는 프로젝트 공통 설정: 해설 모델·지침, 완료 확인 제안 모델 |
| `machine` | 이 컴퓨터의 설정 |

알 수 없는 필드는 거부합니다. `id`는 영문자·숫자·`.`·`_`·`-` 100자 이하입니다. `rawstep init`은 프로필 `Default`(계획 모델 없음, 행동 `Basic`, 페이지 환경 `default`, 시뮬레이션 스크린리더) 하나를 만들고 연결·작업은 비워 둡니다.

예전 설정은 읽지 않습니다. `version` 1~5는 오류 코드 `old-config`로, 실행 모델과 연결 종류가 있던 `version` 6은 `invalid-config`로 멈춥니다. `rawstep init`으로 새 프로젝트를 시작하고 작업을 복사해 오세요.

## 실행 프로필

실험은 **작업 × 실행 프로필**입니다. 작업은 무엇을 할지만 담고, 실행 프로필은 누가 어떻게 하는지와 실행이 끝나는 방식을 바꾸는 모든 것을 담습니다. 누가 계획하는지, 시뮬레이션하는 사용자가 무엇을 할 수 있는지, 페이지, 스크린리더, 실행 규칙입니다. 프로필은 실행할 때 고릅니다. 두 조건을 비교하려면 그 부분만 다른 프로필 둘을 만들어 같은 작업을 각각 실행합니다.

| 프로필의 부분 | 담는 것 |
|---|---|
| `planner` | 누가 계획하는지: LLM과 지침, 또는 계획 파일 |
| `actions` | 허용하는 키, 스크린리더 동작, 이름 있는 입력값 입력 |
| `page` | 페이지 환경: 화면 크기, 글자 크기·간격, 색상·대비, 움직임 |
| `screenReader` | 스크린리더 백엔드: `simulation`, `voiceover`, `nvda` |
| `runRules` | 언제 막힌 것으로 보고 멈추는지, 언제 새 계획을 요청하는지 |

실행은 그 실행에 지정한 프로필(`rawstep run --profile`, 대시보드의 실행 창에서 고른 프로필), 없으면 프로젝트의 첫 번째 프로필을 씁니다. Rawstep의 기본값과 프로필 사이에 다른 계층은 없습니다. 프로필은 실행 규칙 전체를 담고, `--rule`은 그 실행에 한해 일부를 바꿉니다. 실행마다 프로필의 내용 전체를 기록하므로, 실행은 이름이 아니라 내용으로 비교합니다.

실행이 끝나는 방식을 바꾸는 설정은 모두 프로필에 들어갑니다. 해설 모델은 끝난 실행을 설명할 뿐 결과를 바꾸지 않으므로 프로필이 아니라 `project`에 있습니다.

## connections

연결은 언어 모델에 닿는 곳입니다. 제공자 프리셋(정해진 주소와 키 환경변수), 코딩 에이전트 CLI, 직접 지정한 OpenAI 호환 서버 중 하나입니다. 연결에는 모델이 들어 있지 않고, 프로필의 계획 모델과 해설·제안이 연결 위에서 모델을 고릅니다([profiles](#profiles-실행-프로필) 참고).

| 필드 | 설명 |
|---|---|
| `id`, `name` | 식별자와 표시 이름 |
| `provider` | 모델이 있는 곳. 아래 표의 제공자 중 하나 |
| `baseURL` | `provider: custom`일 때만 쓰며 이때는 필수입니다. 서버 주소(HTTPS, 이 컴퓨터의 서버는 HTTP도 가능) |
| `apiKeyEnv` | `provider: custom`일 때만. 키를 담은 환경변수 이름(선택, 대문자·숫자·`_`) |
| `timeoutMs` | 모델 요청 제한 시간(100~600000, 기본 60000) |

제공자는 `@rawstep/project/config`의 `PROVIDERS`에 한 번만 정의합니다.

| `provider` | 주소 | 키 환경변수 |
|---|---|---|
| `openai` | `https://api.openai.com/v1` | `RAWSTEP_OPENAI_API_KEY` |
| `anthropic` | `https://api.anthropic.com/v1` (Anthropic의 OpenAI 호환 주소) | `RAWSTEP_ANTHROPIC_API_KEY` |
| `google` | `https://generativelanguage.googleapis.com/v1beta/openai` | `RAWSTEP_GOOGLE_API_KEY` |
| `openrouter` | `https://openrouter.ai/api/v1` | `RAWSTEP_OPENROUTER_API_KEY` |
| `claudeCode` | 실행: `npx -y @agentclientprotocol/claude-agent-acp@0.89.1` | 없음 (CLI 로그인) |
| `codex` | 실행: `npx -y @agentclientprotocol/codex-acp@2.2.2` | 없음 (CLI 로그인) |
| `opencode` | 실행: `opencode acp` | 없음 (CLI 로그인) |
| `grok` | 실행: `grok agent stdio` | 없음 (CLI 로그인) |
| `antigravity` | 실행: `agy_acp_server.par` (ACP 레지스트리에서 받는 Google의 별도 ACP 서버, 폴더를 `PATH`에 둠) | 없음 (자체 Google 로그인) |
| `custom` | OpenAI 호환 서버(LM Studio, Ollama 등), `baseURL` | 선택, `apiKeyEnv` |

**코딩 에이전트 CLI**(`claudeCode`, `codex`, `opencode`, `grok`, `antigravity`)는 주소 대신 ACP(Agent Client Protocol, stdio 위의 JSON-RPC)로 말을 거는 CLI 연결입니다. CLI가 설치되어 로그인되어 있어야 하며, 호출 비용은 CLI 자체의 구독으로 나가므로 API 키도 `baseURL`도 없습니다. 실행 명령은 `PROVIDERS`에 고정되어 있고 공유 설정에서 읽지 않습니다. `npx` 어댑터 둘은 버전을 고정해 처음 쓸 때 내려받으므로 첫 호출이 느립니다. `modelId: "default"`는 에이전트가 정한 모델을 그대로 쓰며, 모델 목록(대시보드 확인과 모델 선택)은 에이전트를 띄워 `default`를 맨 앞에 보여 줍니다. 호출마다 새 에이전트 세션을 빈 임시 폴더에서 열고, 파일·터미널 접근과 권한 요청은 거절하며, 호출이 끝나면 세션을 지웁니다. 에이전트는 자체 시스템 프롬프트가 커서 호출마다 토큰을 더 쓰고 직접 API보다 느립니다(호출 한 번에 약 4~13초 측정).

모델의 응답을 쓸 수 없으면(JSON 객체가 없거나, 요청한 형식과 다르면) 무엇이 틀렸는지 알려 주고 한 번 더 묻습니다. 다시 물은 일은 정책 근거 `model-retry`로 남습니다. 두 번째 응답도 틀리거나, 첫 응답이 잘렸거나, 다른 모델이 답했거나, 키가 응답에 들어 있으면 실행은 오류로 끝나고 `run.error` 이벤트의 `modelFailure`에 실패 종류, 형식 검사가 지적한 필드와 이유, 모델 응답(앞부분만)이 남습니다. 키가 들어 있던 응답과 페이지에 글자를 입력한 뒤의 응답은 남기지 않습니다. 제공자의 오류 본문은 계정 정보가 섞일 수 있어 남기지 않습니다.

같은 기본 제공자의 연결은 키 하나를 함께 씁니다. 주소가 있는 모델은 AI SDK로 제공자의 채팅 API를 호출하고, 코딩 에이전트 CLI는 ACP로 대화합니다.

```json
{ "id": "openai", "name": "OpenAI", "provider": "openai", "timeoutMs": 60000 }
```

### 코딩 에이전트 CLI (`claudeCode`, `codex`, `opencode`, `grok`, `antigravity`)

위에서 설명한 대로 ACP로 대화합니다. `antigravity`는 Google의 ACP 서버 `agy_acp_server.par`를 실행하며, ACP 레지스트리에서 따로 받아 그 폴더를 `PATH`에 둬야 합니다. 이 서버는 자체 Google 로그인을 유지하고, 대시보드 연결 확인의 로그인 버튼으로 한 번 로그인합니다. Rawstep은 스스로 로그인하지 않으며, 로그인 방법이 없는 에이전트는 터미널에서 그 CLI로 직접 로그인해야 합니다. `reasoningEffort`는 에이전트가 얼마나 깊이 생각할지 정하며, 에이전트마다 지원하는 값이 달라 모르는 값은 실행 때 실패합니다.

```json
{ "id": "codex", "name": "Codex", "provider": "codex", "timeoutMs": 180000 }
```

## tasks

| 필드 | 설명 |
|---|---|
| `id`, `name` | `rawstep run <task>`에 넘기는 id와 표시 이름 |
| `file` | 프로젝트 기준 작업 JSON 경로. 형식은 [작업 안내](./task.ko.md) |
| `variantOf` | 선택. 이 작업이 어느 작업의 결함판인지(같은 목표를 접근성 결함 하나만 넣은 페이지 사본에서 하는 작업). 대시보드는 원본 아래에 묶고 더 움직인 횟수를 보여 줍니다. 한 단계만 됩니다 |
| `minimalSteps` | 선택. 목표까지 가장 적게 움직이는 횟수. 결과에 함께 보입니다 |
| `analysisInstructions` | 이 작업의 분석 지침(`project.analysis.instructions`를 대체) |

## profiles (실행 프로필)

| 필드 | 설명 |
|---|---|
| `id`, `name` | 식별자와 표시 이름. `--profile`은 둘 중 아무거나 받습니다 |
| `planner` | Rawstep이 그대로 따를 계획 문서를 쓰는 쪽으로, LLM `{ connectionId, modelId, reasoningEffort?, instructions }` 또는 계획 파일 `{ planFile }`([계획 파일](#계획-파일) 참고) 중 하나입니다. 계획 모델이 없는 프로필은 하나 고를 때까지 실행할 수 없습니다(`planner-model-invalid`). 새 프로필에는 아직 없습니다 |
| `actions` | 시뮬레이션하는 사용자가 할 수 있는 행동(아래 설명) |
| `page` | `default`, `narrow`, `zoom-200`, `forced-colors`, `dark`, `reflow-text` 같은 내장 페이지 환경 이름 또는 객체. 기본 `"default"`. [환경 프로필 안내](./environment-profiles.md) |
| `screenReader` | 실행이 거치는 보조기술입니다. `simulation`(기본): Chromium 기반 시뮬레이션이며 trace에 항상 시뮬레이션으로 표시합니다. `voiceover`(macOS) 또는 `nvda`(Windows): AT Driver 서버로 연결하는 네이티브 스크린리더(주소는 [machine](#machine) 참고). 이 필드만 다른 프로필 둘로 같은 작업을 시뮬레이션 VoiceOver와 실제 VoiceOver에서 비교할 수 있습니다 |
| `runRules` | 실행 규칙 전체([runRules](#runrules-실행-규칙) 참고) |

LLM 계획 모델의 `connectionId`는 실제로 있는 연결이어야 하고(`profile-connection-missing`), `modelId`는 제공자에서 쓰는 모델 이름입니다. `reasoningEffort`는 선택이며, 에이전트가 주는 추론 강도 중 하나입니다(코딩 에이전트 CLI 연결만 의미가 있음). 비우면 에이전트 기본값을 씁니다(Codex는 xhigh라 느림). `project.analysis.model`과 `project.suggestions.model`에도 쓸 수 있습니다. `instructions`는 계획 규칙에 더해집니다([계획과 계획 따르기](#계획과-계획-따르기), [프롬프트 안내](./prompts.ko.md) 참고).

`actions`는 허용 행동 `{ keys, intents, typeText, replaceText, inputKeys? }`입니다. 시뮬레이션하는 사용자가 쓸 수 있는 키와 스크린리더 동작, 이름 있는 입력값에 입력하거나 바꿔 쓸 수 있는지(`inputKeys`는 대상 제한, 기본은 작업의 모든 입력)를 정합니다. 계획 모델은 이것을 쓸 수 있는 행동 목록으로 받아 그 안에서만 계획하고, Rawstep이 하는 행동마다 실행 직전에 다시 검사합니다. 보조기술이 지원하지 않는 행동(시뮬레이션이나 네이티브 스크린리더에 없는 스크린리더 동작 등)이 들어 있으면 브라우저를 띄우기 전에 실행 점검에서 막습니다. 독립 검증과 입력 필드 확인은 엔진이 맡습니다.

대시보드는 스크린리더 프로필을 숙련도가 아니라 찾는 방법으로 시작합니다. 한 칸씩은 `next`, `previous`, `activate`만 허용합니다. 나머지 셋은 여기에 이동 방법 하나를 더합니다. 제목으로(`heading.next`, `heading.previous`, `headings.list`), 폼 컨트롤로(`form.next`, `form.previous`, `formControls.rotor`), 링크로(`link.next`, `link.previous`, `links.list`)입니다. 넷 모두 이름 있는 입력값에 입력할 수 있습니다. 동작을 하나씩 바꾸면 직접 고른 프로필이 됩니다. 같은 작업을 방법마다 돌리면 그 방법으로 목표를 찾는 데 드는 대가를 비교할 수 있습니다.

```json
{
  "id": "headings-voiceover",
  "name": "제목으로 찾기, VoiceOver",
  "planner": { "connectionId": "openai", "modelId": "gpt-5", "instructions": "경험 많은 스크린리더 사용자처럼 계획한다." },
  "actions": { "keys": [], "intents": ["next", "previous", "activate", "heading.next", "heading.previous", "headings.list"], "typeText": true, "replaceText": false },
  "page": "narrow",
  "screenReader": "voiceover",
  "runRules": { "maxPlannerCalls": 60 }
}
```

## runRules (실행 규칙)

실행이 언제 일찍 멈추는지, Rawstep이 언제 계획 모델에게 새 계획을 요청하는지 정합니다. 프로필마다 자기 `runRules`를 가지며, `rawstep run`의 `--rule <이름>=<값>` 옵션(`runTask`의 `runRules` 옵션)이 각 필드를 그 실행에 한해 바꿉니다. 실행마다 쓴 규칙을 기록합니다.

| 필드 | 기본값 | 설명 |
|---|---|---|
| `repetitionGuard` | `true` | 실행이 같은 일을 되풀이하면 막힌 것으로 보고 멈출지 |
| `maxUnchangedTransitions` | 4 | 같은 행동이 같은 발화를 이 횟수만큼 연달아 만들면 막힌 것으로 보고 멈춥니다 |
| `maxPlannerCalls` | 40 | 한 실행에서 계획 모델을 부르는 최대 횟수(첫 계획, 들은 항목을 묻는 호출, 쓸 수 없는 응답 뒤 다시 묻기 포함). 비용 한도라서, 닿으면 사용자 실패가 아니라 측정 못 함(`orchestration-limit`)으로 끝납니다 |
| `reviewEvery` | 60 | 마지막으로 계획을 본 뒤 이만큼 넘기면, 들인 노력을 알려 주고 계속·방법 바꾸기·포기를 묻습니다(`effort-review`) |
| `stepActionLimit` | 12 | 작업 하나에서 새로운 것을 못 들은 행동이 이 횟수만큼 쌓이면 새 계획을 요청합니다. 항목을 하나씩 새로 들으며 나아가는 동안은 세지 않습니다 |
| `failureLimit` | 2 | 한 작업에서 행동이 연달아 이만큼 실패하면 새 계획을 요청합니다 |
| `noChangeLimit` | 3 | 한 작업에서 아무것도 바뀌지 않은 행동이 연달아 이만큼이면 새 계획을 요청합니다 |
| `plannerHistoryLimit` | 60 | 계획을 세우며 받는 지난 행동 수. 행동마다 그 전에 들은 말이 함께 갑니다. 더 오래된 것은 잊고, 계획 모델이 써 둔 계획 문서는 남습니다. 낮추면 페이지를 다 기억하지 못하는 사용자가 됩니다 |
| `survey` | `headings` | 프로필의 허용 행동에 `headings.list`가 있으면(대시보드의 "제목으로 찾는" 사용자), 첫 계획 전에 제목 목록(VoiceOver 로터)을 먼저 듣고 행동 한 번으로 셉니다. 다른 방법으로 찾는 사용자는 제목 목록을 쓰지 않아 제목이 없어도 느려지지 않고, 제목으로 찾는 사용자는 느려집니다. `none`이면 훑지 않습니다. 실제 VoiceOver 연결은 로터(VO+U)로 제목 목록을 읽습니다(실제 VoiceOver로는 아직 확인 전). NVDA 연결은 아직 지원하지 않습니다 |
| `confirmationGrace` | 5 | 스크린리더 실행에서 목표에 도달했지만 사용자가 들은 말에 성공 문구가 없으면(화면에만 뜬 경우) 이만큼 더 진행한 뒤 끝납니다. 그 행동이 "됐는지 모름" 마찰이고, trace의 `goal.reached`에 도달 단계와 들었는지가 남습니다. 0이면 바로 끝납니다 |

프로필이 빼 둔 필드는 위 기본값을 씁니다. 한 실행의 덮어쓰기는 이름을 적은 필드만 바꿉니다.

```json
{ "repetitionGuard": true, "maxUnchangedTransitions": 4, "maxPlannerCalls": 40, "reviewEvery": 60, "stepActionLimit": 12, "failureLimit": 2, "noChangeLimit": 3, "plannerHistoryLimit": 60, "survey": "headings", "confirmationGrace": 5 }
```

## 전체 예시

연결 하나, 프로필 하나, 프로젝트 해설 모델을 담은 `rawstep.config.json`입니다.

```json
{
  "version": 7,
  "connections": [
    { "id": "openai", "name": "OpenAI", "provider": "openai", "timeoutMs": 60000 }
  ],
  "profiles": [
    {
      "id": "narrow-screenreader", "name": "Narrow page, screen reader",
      "planner": { "connectionId": "openai", "modelId": "gpt-5", "instructions": "Plan like an experienced screen reader user." },
      "actions": { "keys": [], "intents": ["next", "previous", "activate"], "typeText": false, "replaceText": false },
      "page": "narrow",
      "screenReader": "voiceover",
      "runRules": { "maxPlannerCalls": 60 }
    }
  ],
  "tasks": [
    { "id": "checkout", "name": "Checkout", "file": "tasks/checkout.json" }
  ],
  "project": {
    "analysis": { "model": { "connectionId": "openai", "modelId": "gpt-5-mini" }, "instructions": "Focus on where the page made the run detour." },
    "suggestions": {}
  },
  "machine": { "atEndpoints": { "voiceover": "", "nvda": "" }, "browserExecutablePath": "", "headless": true, "personCheck": false }
}
```

## 계획과 계획 따르기

실행은 항상 계획합니다. 계획 모델(LLM 또는 [계획 파일](#계획-파일))이 **계획 문서**를 쓰고, Rawstep은 그 작업을 적힌 그대로 하나씩 수행합니다. 행동 하나하나를 고르는 모델은 없습니다. 판단은 모두 계획 모델과 cue가 맡고, 실행 비용은 계획 모델 호출뿐이며, 반복 실행 사이의 편차도 작습니다.

계획 문서에는 다음이 들어 있습니다.

- **성공 기준**(C1, C2, …): 목표에 도달했다고 보려면 사용자가 무엇을 들을 수 있어야 하는지. 상태는 미확인, 충족, 미충족입니다
- **전략과 가정**: 접근 방식 한 줄과, 일반적인 UI 관례에서 끌어낸 가정(A1, A2, …). 상태는 미확인, 맞음, 틀림입니다
- **단계와 번호 붙은 작업**(1, 1.1, 1.2, …): 작업마다 목표, 완료 cue(들려야 하는 말, 알 수 있으면 역할과 상태까지), 수행 방식(아래), 맡은 성공 기준, 기대는 가정이 있습니다. 작업 상태는 대기, 진행 중, 완료, 포기, 실패이며 행동 수를 기록하고, 현재 작업을 표시합니다
- **버전과 이력**: 다시 계획하면 문서를 고칩니다. 끝난 작업은 그대로 두고, 포기한 작업은 이유와 함께 남기며, 버전이 오르고 이력에 계기, 틀린 가정, 바뀐 내용을 적습니다

### 작업 수행 방식

작업은 세 가지 중 하나입니다.

- **이동**(`activates: false`): 작업에 적힌 첫 이동(`moves`, 예: `["heading.next"]`. 적지 않았으면 `next`로 한 칸씩)을 cue가 들릴 때까지 되풀이합니다. 작업 하나에는 이동 방법과 방향이 하나뿐이라, 둘 중 하나를 바꾸려면 계획 모델이 새 작업을 만듭니다. 그 작업에서 이미 연 목록(`formControls.rotor`)은 다시 열지 않습니다
- **누르기**(`activates: true`): 커서가 있는 항목을 누릅니다. 그래서 앞 작업들이 커서를 그 항목까지 데려가야 합니다
- **입력**(`types: "<입력 이름>"`): 커서가 있는 입력란을 눌러 포커스를 준 뒤, 그 이름의 입력값을 입력하면 작업이 끝납니다. 계획 모델은 작업의 입력 이름(과 설명)만 알고 값은 모릅니다. 입력 작업에는 `moves`가 없고 cue는 비워 둡니다. 입력한 뒤 입력란이 무엇이라고 읽힐지는 미리 알 수 없기 때문입니다. 프로필의 `actions`가 그 입력값의 입력을 허용해야 합니다

프로필이 허용하지 않는 행동이 필요한 작업을 만나면 실행은 측정 못 함으로 끝납니다. Rawstep이 한 행동은 모두 정책 근거 `orchestration-follow`로 남습니다. 어느 작업과 계획 버전의 행동인지, 허용된 행동과 실제로 한 행동이 들어 있습니다.

이동·누르기 작업은 그 작업의 행동 뒤에 cue가 들리면 끝납니다. cue는 항목을 듣기 전에 쓴 것이라 문구가 추측일 수밖에 없습니다. 그래서 커서가 cue와 낱말이 겹치지만 맞지는 않는 항목에 닿으면, 항목마다 한 번씩 계획 모델에게 cue가 가리킨 항목이 맞는지 묻습니다(`orchestration-cue`, `recognized` 또는 `not-recognized`). 계획 파일에는 물을 수 없으므로 적힌 대로 들린 cue만 작업을 끝냅니다. 단계의 작업이 모두 끝나면 계획 모델이 **체크포인트**에서 그 단계의 성공 기준을 점검하고, 남은 작업이 없으면 마지막 점검을 해 완료를 선언할 수 있습니다.

Rawstep은 체크포인트와 마지막 점검에서, 그리고 현재 작업이 막혀 보일 때 새 계획을 요청합니다. 행동 실패가 `failureLimit`회 연속일 때, 변화 없는 행동이 `noChangeLimit`회 연속일 때(같은 발화가 되풀이될 때 포함), 한 작업에서 새로운 것을 못 들은 행동이 `stepActionLimit`에 이를 때, 커서가 같은 두 항목 사이를 오갈 때(행동 네 번 연속)입니다. 작업이 다른 것을 찾는 중에 목표에 나온 이름의 항목을 처음 들었을 때(`goal-heard`)와, 계획 모델이 마지막으로 본 뒤 `reviewEvery`번 넘겼을 때(`effort-review`)도 요청합니다. 계획 모델은 사람이 들을 수 있는 정보, 프로필이 허용하는 행동(입력은 이름만, 비밀값은 주지 않음), 작업별 시도 내역만 받습니다. 시도마다 실행 결과(`ok`, 실패하면 `not-editable` 또는 `backend` 코드이며 원본 오류 문구는 아님)와 그 뒤 발화가 바뀌었는지(`changed`)가 함께 갑니다. 접근성 트리는 받지 않습니다.

### 실행이 끝나는 방식

스크린리더 실행은 이 페이지를 처음 본 사용자가 이 작업을 해낼 수 있는지, 그 대가가 얼마인지를 봅니다. 실행은 셋 중 하나로 끝나고, 어느 쪽이든 대가(넘긴 횟수, 돌아간 길, 계획이 바뀐 곳)와 함께 남습니다.

- **해냄**: 실행의 완료 확인이 맞습니다. 계획 모델이 목표 도달을 선언할 수도 있지만(`planner`) 판정은 독립 검증이 합니다.
- **사용자가 포기함**(`user-gave-up`): 계획을 다시 보는 시점에 계획 모델이 "들은 것으로는 더 해볼 방법이 없다"고 판단하고, 틀린 것으로 표시한 가정(실패한 방법)을 근거로 `giveUp`을 냅니다. 근거 없는 포기는 받아들이지 않고 `wanted-to-give-up` 단서로 남긴 뒤 다시 묻습니다. 많이 넘겼다는 것만으로는 포기 이유가 되지 않습니다.
- **측정 못 함**(`orchestration-limit`, `maxSteps`, 시간 초과): 비용 한도에 먼저 닿아, 해낼 수 있는지 알 수 없습니다.

계획 모델은 들인 노력을 넘긴 횟수로 받습니다(`effort`: 전체, 마지막으로 본 뒤, 목표 낱말을 하나도 못 들은 채 연속으로). Rawstep은 인내심을 정하지 않습니다. 실행마다 목표 낱말 없이 넘긴 가장 긴 구간(`goal-word-stretch`, 카드마다 나오는 "Add … to cart"처럼 서로 다른 항목 세 개보다 많이 들린 목표 낱말은 더 세지 않음)을 남기고, 사용자가 얼마나 버틸지는 결과를 읽는 사람이 판단합니다. 계획 모델이 틀렸다고 표시한 가정은 `expectation-broken` 단서로 남습니다. 직전 세 행동 안에 누르기가 있었으면 그 누른 요소에 남기고(`pressed`), 대시보드는 이를 실행 전체에서 모아 시작 페이지 전체 화면 위에 막힌 곳(눌러도 예상대로 반응하지 않은 곳)으로 표시합니다. 이동하다 깨진 가정은 어디에 무엇이 있을지에 대한 추측이라 요소에 두지 않고, 실행마다 "위치 추측이 틀림" 횟수로 셉니다. 모의 스크린리더는 VoiceOver처럼 커서를 화면 안으로 스크롤하고, 단계 화면에 쓰도록 커서 위치를 기록합니다. 이 정보는 모델에게 가지 않습니다. 시간이 아니라 넘긴 횟수로 세는 이유는 시간이 모델에 따라 달라지기 때문입니다. 스크린리더 실행의 폴더에는 `plan.json`과 `plan.md`(사람이 읽는 체크박스 형식)도 저장되고, 대시보드는 실행 중에 계획 문서를 실시간으로 보여 줍니다. 계획, 작업 변경, 다시 계획한 이유는 정책 근거로 trace에 남습니다.

실패하거나 아무것도 바꾸지 못하거나 두 항목 사이를 오간 행동 뒤의 새 계획(`replan`), 새로운 것을 못 들은 채 길어진 작업(`task-limit`), 틀린 가정(`expectation-broken`)은 마찰 힌트입니다. 실행이 다시 생각해야 했던 곳을 가리킬 뿐 이유는 단정하지 않습니다. 페이지가 어려웠을 수도, 계획이 틀렸을 수도 있습니다.

`planner.instructions`는 Rawstep의 계획 규칙(계획 문서 형식, 들은 것과 허용 행동만으로 계획)에 더해지며 규칙을 대체하지 않습니다. 버튼이 어디 있는지처럼 실제 사용자가 알 수 없는 페이지 지식은 넣지 마세요. Rawstep이 재려는 어려움이 가려집니다. "경험 많은 스크린리더 사용자처럼 계획한다" 같은 전략이나 사용자 유형에 관한 지침은 괜찮습니다. 계획 지침은 계획 근거에 sha256 지문으로 기록됩니다.

### 계획 파일

계획 모델 대신 미리 써 둔 계획을 읽을 수 있습니다: `"planner": { "planFile": "plans/{task}/plan.json" }`. 경로는 프로젝트 기준 상대 경로이고 `.json`으로 끝나야 합니다. `{task}`는 작업 파일 이름(`.json` 제외)으로 바뀌어, 프로필 하나로 작업마다 자기 계획을 읽게 할 수 있습니다(작업 파일이 `tasks/checkout.json`이고 경로가 `plans/{task}/L2.json`이면 `plans/checkout/L2.json`을 읽습니다).

파일 형식은 계획 모델의 초안과 같습니다. `strategy`, `criteria`(`C1`...), `assumptions`(`A1`...), 그리고 `tasks`를 담은 `phases`로 이루어지며, 작업마다 `goal`, `done`, `cue`(끝났을 때 들려야 하는 말. 문자열 또는 `{ name, role?, state? }`)와 수행 방식(`activates`, `moves`, `types`, [작업 수행 방식](#작업-수행-방식) 참고)이 들어가고 `serves`, `relies`는 선택입니다. `complete`와 `rationale`도 선택입니다.

```json
{
  "strategy": "Find the product, add it to the cart, then open the cart.",
  "criteria": [{ "id": "C1", "text": "The user hears that the item is in the cart." }],
  "assumptions": [{ "id": "A1", "text": "The product page has an \"Add to cart\" button." }],
  "phases": [{ "title": "Add the product", "criteria": ["C1"], "tasks": [
    { "goal": "Move to the 'Add to cart' button", "done": "The user hears \"Add to cart, button\"", "cue": { "name": "Add to cart", "role": "button" }, "activates": false, "moves": ["next"], "serves": ["C1"], "relies": ["A1"] },
    { "goal": "Activate the 'Add to cart' button", "done": "The user hears that the item was added", "cue": "added to cart", "activates": true, "serves": ["C1"] }
  ] }]
}
```

실행 중에는 계획이 바뀌지 않습니다. 새 계획을 요청해야 할 상황이면 막힌 작업을 포기로 기록하고 다음 작업으로 넘어갑니다. 사람이 쓴 계획을 돌릴 때, 계획 모델이 쓴 계획을 저장해 다시 돌릴 때, 계획을 고정한 채 행동이나 환경만 바꿔 비교하는 실험에 씁니다.

## project (프로젝트 설정)

실행 결과를 바꾸지 않는 프로젝트 공통 설정입니다.

| 필드 | 설명 |
|---|---|
| `analysis.model` | 선택. 연결 위의 `{ connectionId, modelId, reasoningEffort? }`. 이 모델로 모든 실행(`rawstep run`, `runTask`, 대시보드)에 LLM 분석이 더해집니다. 없으면 규칙 기반 분석만 하며, 규칙 기반 분석은 항상 실행됩니다. 키가 없어도 실행은 막지 않고 분석만 건너뜁니다 |
| `analysis.instructions` | 선택. 분석 초점. 작업의 `analysisInstructions`가 이 값을 대체합니다 |
| `suggestions.model` | 선택. 작업을 쓸 때 완료 확인을 제안하는 모델의 `{ connectionId, modelId, reasoningEffort? }`. 없으면 분석 모델을 씁니다 |

## machine

실험이 아니라 이 컴퓨터에 속한 설정입니다.

| 필드 | 설명 |
|---|---|
| `atEndpoints` | `{ voiceover, nvda }`. 네이티브 AT Driver의 loopback 주소. 비워 두면(기본) 그 스크린리더 서버의 일반적인 주소를 씁니다. VoiceOver(Bocoup macOS 서버)는 `ws://localhost:4382/session`, NVDA(PAC 서버)는 `ws://localhost:3031/session`입니다. 시뮬레이션은 쓰지 않습니다 |
| `browserExecutablePath` | 쓸 Chromium 경로. 비우면 Playwright의 Chromium |
| `browserEndpoint` | 직접 띄운 Chrome의 `--remote-debugging-port` 주소(예: `http://localhost:9222`). 비우지 않으면 브라우저를 새로 띄우지 않고 거기에 붙어, 사이트가 일반 브라우저(headless 아님, `navigator.webdriver` false)로 보므로 봇 판정이 줄어듭니다. loopback만 가능. 실행마다 그 Chrome 안에 분리된 컨텍스트를 열고 끝나면 연결만 끊으므로 평소 탭의 쿠키는 공유되지 않습니다. `browserExecutablePath`, `headless`, 프록시 설정은 적용되지 않으며, 그 창에서 사람이 봇 확인을 통과해야 하면 `personCheck`와 함께 쓰세요. Chrome은 별도 프로필에서만 포트를 엽니다: `/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.rawstep-chrome"` |
| `headless` | 브라우저를 화면 없이 실행할지(기본 `true`) |
| `personCheck` | Cloudflare 같은 봇 확인이 있는 실제 사이트용. 설치된 Chrome 창을 띄우고 프로필을 `.rawstep/browser-profile`에 유지하며, 봇 확인이 나오면 사람이 그 창에서 통과할 때까지(최대 5분, 실행 시간 제한에서 제외) 기다립니다. Rawstep이 확인을 대신 풀지는 않습니다. 기본 `false` |

`voiceover`와 `nvda` 스크린리더를 쓰는 프로필은 해당 OS에서 AT Driver 서버가 필요하며, `rawstep doctor`가 엔드포인트 응답을 확인합니다. 해당 주소에 응답하는 서버가 없으면 Rawstep이 명령으로 서버를 시작할 수 있습니다. 이 명령은 프로그램을 실행하므로 공유 설정 파일에는 두지 않고, 이 컴퓨터의 `.env.local`에만 `RAWSTEP_AT_DRIVER_COMMAND`로 저장합니다.

```dotenv
# .env.local (커밋하지 마세요)
RAWSTEP_AT_DRIVER_COMMAND=서버를_시작하는_명령
```

Rawstep은 이 명령으로 서버를 띄우고 주소가 연결을 받을 때까지 기다리며, 실행이 끝나면 자신이 띄운 서버를 종료합니다. 이미 응답하는 서버가 있으면 그대로 씁니다. 스크린리더 자체와 OS 권한 설정은 직접 해야 합니다.
