# 설정 안내 (`rawstep.config.json`)

프로젝트 폴더의 `rawstep.config.json` 하나가 대시보드, CLI, `runTask`의 설정을 모두 담습니다. `rawstep init` 또는 `rawstep ui`가 처음 만들며, 스키마는 `@rawstep/project`가 소유합니다(`@rawstep/project/config`). 같은 파일을 대시보드에서 편집하고 CLI에서 읽으므로 둘은 항상 같은 설정으로 실행됩니다.

## 파일 관리

| 대상 | git |
|---|---|
| `rawstep.config.json` | 프로젝트와 함께 커밋합니다 |
| `.env.local` | 커밋하지 않습니다. 제공자별 API 키가 들어 있습니다 |
| `.rawstep/` | 커밋하지 않습니다. 실행 결과와 대시보드 이력이 쌓입니다 |

API 키는 설정 파일에 들어가지 않습니다. 기본 제공자는 정해진 환경변수(아래 표)를 쓰고, `custom` 모델만 `apiKeyEnv`에 환경변수 이름을 적습니다. 값은 프로세스 환경이나 프로젝트의 `.env.local`에서 읽습니다. 대시보드는 키를 `.env.local`(권한 0600)에 쓰고 UI에는 설정 여부만 돌려줍니다. 설정 파일은 검증 후 원자적으로 저장하며, 외부에서 파일을 고치면 대시보드가 저장 충돌로 알려 줍니다.

## 최상위 필드

```json
{
  "version": 1,
  "models": [],
  "tasks": [],
  "profiles": [ ],
  "machine": { }
}
```

`version`은 `1`입니다. `profiles`에는 최소 하나가 있어야 하고, `rawstep init`은 이름이 `Default`인 프로필 하나와 빈 모델·작업 목록을 만듭니다. `id`는 영문자·숫자·`.`·`_`·`-` 100자 이하입니다. `--model`과 `--profile`은 id를 먼저, 없으면 이름(대소문자 구분)으로 찾습니다.

## models

모델은 유형, 제공자, 모델 순서로 등록합니다. `kind`와 `provider`가 모델이 있는 곳을 정하므로 따로 만들어 둘 연결은 없습니다.

| 필드 | 설명 |
|---|---|
| `id`, `name` | 식별자와 표시 이름 |
| `kind` | `llm`: 상황을 읽고 후보를 고르는 언어 모델(실행, 사후 분석, 완료 확인 제안). `decision`: 모든 후보의 확률을 바로 돌려주는 빠르고 저렴한 모델(실행 전용) |
| `provider` | 모델이 있는 곳. `kind`에 맞는 제공자만 쓸 수 있습니다(아래 표) |
| `modelId` | 제공자에서 쓰는 모델 이름 |
| `baseURL` | `provider: custom`일 때만. 서버 주소(HTTPS, 이 컴퓨터의 서버는 HTTP도 가능) |
| `apiKeyEnv` | `provider: custom`일 때만. 키를 담은 환경변수 이름(선택, 대문자·숫자·`_`) |
| `inputs` | `text`, `image` 중 지원하는 입력 |
| `capabilitySource` | `discovery`(제공자가 알려 줌) 또는 `manual`(직접 입력) |
| `maxChoices`, `maxImages` | 한 번에 줄 수 있는 후보와 이미지 수의 상한(기본 255, 2) |
| `roles` | `decision`: 행동을 고르는 모델, `analysis`: 실행 후 분석을 쓰는 모델(`llm`만 해당) |
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

같은 기본 제공자의 모델은 키 하나를 함께 씁니다. `llm`은 AI SDK로 제공자의 채팅 API를 호출하고, `decision`은 AI SDK의 실험적 `decide` API를 호출합니다. `typesafe`·`openrouter`·`custom`은 자체 `/systemone` 어댑터, `gateway`는 AI SDK의 gateway provider를 씁니다([SystemOne 결정 모델](./systemone.md)).

키보드 모드는 이미지를 보내므로 이미지 입력을 지원하고 `maxImages`가 2 이상인 `decision` 역할 모델이 필요합니다(이미지를 받는 `llm`, 또는 `typesafe`·`openrouter`·`custom`의 `decision` 모델). 목록에 이름이 있다는 것만으로 이미지 지원을 확정하지 않으며, 확인하지 못한 기능은 미확인으로 남깁니다.

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

같은 작업을 여러 조건에서 비교하는 단위입니다. `rawstep run <task> --profile <이름>`으로 고릅니다.

| 필드 | 설명 |
|---|---|
| `permissions` | `keyboard`와 `screenreader` 각각의 `keys`, `intents`, `typeText`, `replaceText`(선택 `inputKeys`). 모델이 할 수 있는 행동 |
| `policy` | 멈춤 기준: `historyLimit`, `maxStateVisits`, `maxUnchangedTransitions`, `focusGate`, `repetitionGuard`(`auto`·`on`·`off`), `modelGiveUp` |
| `environment` | 페이지 환경. `default`, `narrow`, `zoom-200`, `forced-colors`, `dark`, `reflow-text` 같은 내장 프로필 이름 또는 객체. [환경 프로필 안내](./environment-profiles.md) |
| `analysisInstructions` | 분석 초점 |

허용 행동은 후보 생성과 실행 직전 검사에 모두 적용하고, 실제 백엔드가 지원하지 않는 항목은 쓰지 않습니다. 중단 선택지, 독립 검증, 입력 필드 확인은 엔진이 유지합니다. `repetitionGuard`의 `auto`는 `decision` 모델에서는 끄고 `llm` 모델에서는 켭니다.

## machine

Rawstep을 실행하는 컴퓨터에 속한 설정입니다.

| 필드 | 설명 |
|---|---|
| `backend` | 스크린리더 모드의 백엔드. `simulation`(기본, Chromium 기반 시뮬레이션이며 trace에 시뮬레이션으로 표시), `voiceover`(macOS), `nvda`(Windows) |
| `atEndpoint` | 네이티브 AT Driver의 loopback 주소(기본 `ws://127.0.0.1:9333`) |
| `browserExecutablePath` | 쓸 Chromium 경로. 비우면 Playwright의 Chromium |
| `headless` | 브라우저를 화면 없이 실행할지(기본 `true`) |

`voiceover`와 `nvda`는 해당 OS에서 AT Driver 서버를 따로 실행해야 하며, `rawstep doctor`가 엔드포인트 응답을 확인합니다. Orca는 라이브러리 수준의 고급 백엔드로만 제공합니다.
