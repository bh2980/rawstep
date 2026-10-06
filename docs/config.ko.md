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

```json
{
  "version": 1,
  "connections": [],
  "tasks": [],
  "profiles": [ ],
  "machine": { }
}
```

`version`은 `1`입니다. `profiles`에는 최소 하나가 있어야 하고, `rawstep init`은 이름이 `Default`인 프로필 하나와 빈 연결·작업 목록을 만듭니다. `id`는 영문자·숫자·`.`·`_`·`-` 100자 이하입니다. `--profile`은 id를 먼저, 없으면 이름(대소문자 구분)으로 찾습니다.

## connections

연결은 모델에 닿는 곳입니다. 제공자 프리셋(정해진 주소와 키 환경변수)이거나 직접 지정한 서버입니다. 연결에는 모델이 들어 있지 않고, 실행 프로필이 연결 위에서 모델을 고릅니다([profiles](#profiles-실행-프로필) 참고).

| 필드 | 설명 |
|---|---|
| `id`, `name` | 식별자와 표시 이름 |
| `kind` | `llm`: 상황을 읽고 후보를 고르는 언어 모델(실행, 사후 분석, 완료 확인 제안). `decision`: 모든 후보의 확률을 바로 돌려주는 빠르고 저렴한 모델(실행 전용) |
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
| `llm` | `custom` | OpenAI 호환 서버(LM Studio, Ollama 등), `baseURL` | 선택, `apiKeyEnv` |
| `decision` | `typesafe` | `https://api.typesafe.ai/v1` (`POST /v1/systemone`) | `RAWSTEP_TYPESAFE_API_KEY` |
| `decision` | `gateway` | Vercel AI Gateway(AI SDK의 gateway provider 사용), 텍스트 전용 | `RAWSTEP_AI_GATEWAY_API_KEY` |
| `decision` | `openrouter` | `https://openrouter.ai/api/v1` (`POST /api/v1/systemone`) | `RAWSTEP_OPENROUTER_API_KEY` (`llm`과 같은 키) |
| `decision` | `custom` | `/systemone` 호환 서버, `baseURL` | 선택, `apiKeyEnv` |

같은 기본 제공자의 연결은 키 하나를 함께 씁니다. `llm`은 AI SDK로 제공자의 채팅 API를 호출하고, `decision`은 AI SDK의 실험적 `decide` API를 호출합니다. `typesafe`·`openrouter`·`custom`은 자체 `/systemone` 어댑터, `gateway`는 AI SDK의 gateway provider를 씁니다([SystemOne 결정 모델](./systemone.md)).

키보드 모드는 이미지를 보내므로 이미지 입력을 지원하고 `maxImages`가 2 이상인 모델이 필요합니다(이미지를 받는 `llm`, 또는 `typesafe`·`openrouter`·`custom`의 `decision` 모델). 목록에 이름이 있다는 것만으로 이미지 지원을 확정하지 않으며, 확인하지 못한 기능은 미확인으로 남깁니다.

## tasks

| 필드 | 설명 |
|---|---|
| `id`, `name` | `rawstep run <task>`에 넘기는 id와 표시 이름 |
| `file` | 프로젝트 기준 작업 JSON 경로. 형식은 [작업 안내](./task.ko.md) |
| `profileId` | 기본으로 쓸 실행 프로필(생략하면 첫 번째 프로필) |
| `policy` | 이 작업에서만 프로필의 `policy` 값을 덮어쓰는 일부 필드 |
| `modes` | `keyboard`와 `screenreader` 각각의 `permissions`(`null`이면 프로필의 허용 행동 사용, 값이 있으면 그 모드의 목록을 대체)와 `prompts`(`{ id, name, version, instructions }` 목록). 프롬프트 구조는 [프롬프트 안내](./prompts.ko.md) |
| `analysisInstructions` | 이 작업의 분석 지침(프로필 값을 대체) |

## profiles (실행 프로필)

같은 작업을 여러 조건에서 비교하는 단위입니다. `rawstep run <task> --profile <이름>`으로 고르며, 그 프로필의 모델로 실행합니다.

| 필드 | 설명 |
|---|---|
| `permissions` | `keyboard`와 `screenreader` 각각의 `keys`, `intents`, `typeText`, `replaceText`(선택 `inputKeys`). 모델이 할 수 있는 행동 |
| `policy` | 멈춤 기준: `historyLimit`, `maxStateVisits`, `maxUnchangedTransitions`, `focusGate`, `repetitionGuard`(`auto`·`on`·`off`), `modelGiveUp` |
| `model` | 이 프로필의 실행이 판단에 쓰는 모델: `{ connectionId, modelId, inputs, maxChoices, maxImages }`. `connectionId`는 연결 id, `modelId`는 제공자에서 쓰는 모델 이름, `inputs`는 `["text"]` 또는 `["text", "image"]`, `maxChoices`·`maxImages`는 한 번에 줄 수 있는 후보와 이미지 수의 상한(기본 255, 2)입니다. `model`이 없는 프로필은 실행할 수 없습니다. 모델을 비교하려면 `model`만 다른 프로필끼리 비교합니다 |
| `analysisModel` | 선택. `llm` 연결의 `{ connectionId, modelId }`. 있으면 이 프로필의 모든 실행(`rawstep run`, `runTask`, 대시보드)에 LLM 분석이 더해집니다. 없으면 Rawstep의 규칙 기반 분석만 하며, 규칙 기반 분석은 항상 실행됩니다 |
| `environment` | 페이지 환경. `default`, `narrow`, `zoom-200`, `forced-colors`, `dark`, `reflow-text` 같은 내장 프로필 이름 또는 객체. [환경 프로필 안내](./environment-profiles.md) |
| `analysisInstructions` | 분석 초점 |

```json
"model": { "connectionId": "jev", "modelId": "jev-latest", "inputs": ["text", "image"], "maxChoices": 255, "maxImages": 2 }
```

허용 행동은 후보 생성과 실행 직전 검사에 모두 적용하고, 실제 백엔드가 지원하지 않는 항목은 쓰지 않습니다. 중단 선택지, 독립 검증, 입력 필드 확인은 엔진이 유지합니다. `repetitionGuard`의 `auto`는 `decision` 모델에서는 끄고 `llm` 모델에서는 켭니다.

## machine

Rawstep을 실행하는 컴퓨터에 속한 설정입니다.

| 필드 | 설명 |
|---|---|
| `backend` | 스크린리더 모드의 백엔드. `simulation`(기본, Chromium 기반 시뮬레이션이며 trace에 시뮬레이션으로 표시), `voiceover`(macOS), `nvda`(Windows) |
| `atEndpoint` | 네이티브 AT Driver의 loopback 주소. 비워 두면(기본) 고른 스크린리더 서버의 일반적인 주소를 씁니다. VoiceOver(Bocoup macOS 서버)는 `ws://localhost:4382/session`, NVDA(PAC 서버)는 `ws://localhost:3031/session`입니다 |
| `browserExecutablePath` | 쓸 Chromium 경로. 비우면 Playwright의 Chromium |
| `headless` | 브라우저를 화면 없이 실행할지(기본 `true`) |

`voiceover`와 `nvda`는 해당 OS에서 AT Driver 서버가 필요하며, `rawstep doctor`가 엔드포인트 응답을 확인합니다. 해당 주소에 응답하는 서버가 없으면 Rawstep이 명령으로 서버를 시작할 수 있습니다. 이 명령은 프로그램을 실행하므로 공유 설정 파일에는 두지 않고, 이 컴퓨터의 `.env.local`에만 `RAWSTEP_AT_DRIVER_COMMAND`로 저장합니다.

```dotenv
# .env.local (커밋하지 마세요)
RAWSTEP_AT_DRIVER_COMMAND=서버를_시작하는_명령
```

Rawstep은 이 명령으로 서버를 띄우고 주소가 연결을 받을 때까지 기다리며, 실행이 끝나면 자신이 띄운 서버를 종료합니다. 이미 응답하는 서버가 있으면 그대로 씁니다. 스크린리더 자체와 OS 권한 설정은 직접 해야 합니다. Orca는 라이브러리 수준의 고급 백엔드로만 제공합니다.
