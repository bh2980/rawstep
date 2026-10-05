# 설정 안내 (`rawstep.config.json`)

프로젝트 폴더의 `rawstep.config.json` 하나가 대시보드, CLI, `runTask`의 설정을 모두 담습니다. `rawstep init` 또는 `rawstep ui`가 처음 만들며, 스키마는 `@rawstep/project`가 소유합니다(`@rawstep/project/config`). 같은 파일을 대시보드에서 편집하고 CLI에서 읽으므로 둘은 항상 같은 설정으로 실행됩니다.

## 파일 관리

| 대상 | git |
|---|---|
| `rawstep.config.json` | 프로젝트와 함께 커밋합니다 |
| `.env.local` | 커밋하지 않습니다. 연결별 API 키가 들어 있습니다 |
| `.rawstep/` | 커밋하지 않습니다. 실행 결과와 대시보드 이력이 쌓입니다 |

API 키는 설정 파일에 들어가지 않습니다. 연결에는 환경변수 이름(`apiKeyEnv`)만 적고, 값은 프로세스 환경이나 프로젝트의 `.env.local`에서 읽습니다. 대시보드는 키를 `.env.local`(권한 0600)에 쓰고 UI에는 설정 여부만 돌려줍니다. 설정 파일은 검증 후 원자적으로 저장하며, 외부에서 파일을 고치면 대시보드가 저장 충돌로 알려 줍니다.

## 최상위 필드

```json
{
  "version": 1,
  "connections": [],
  "models": [],
  "tasks": [],
  "profiles": [ ],
  "machine": { }
}
```

`version`은 `1`입니다. `profiles`에는 최소 하나가 있어야 하고, `rawstep init`은 이름이 `Default`인 프로필 하나와 빈 연결·모델·작업 목록을 만듭니다. `id`는 영문자·숫자·`.`·`_`·`-` 100자 이하입니다. `--model`과 `--profile`은 id를 먼저, 없으면 이름(대소문자 구분)으로 찾습니다.

## connections

모델 서버 연결입니다.

| 필드 | 설명 |
|---|---|
| `id`, `name` | 식별자와 표시 이름 |
| `provider` | `openai`: OpenAI 호환 API(OpenAI, OpenRouter, Vercel AI Gateway, LM Studio, Ollama 등), `systemone`: SystemOne 서버, `screenshot`: 로컬 `/choose` 서버(`rawstep-screenshot-choice-v1` 규약) |
| `baseURL` | 서버 주소 |
| `apiKeyEnv` | 키를 담은 환경변수 이름(선택, 대문자·숫자·`_`). 로컬 서버처럼 키가 없으면 생략합니다 |
| `timeoutMs` | 모델 요청 제한 시간(100~600000, 기본 60000) |

## models

| 필드 | 설명 |
|---|---|
| `id`, `name`, `connectionId` | 식별자, 표시 이름, 사용하는 연결 |
| `modelId` | 서버에서 쓰는 모델 이름 |
| `family` | `SystemOne` 또는 `LLM` |
| `protocol` | `chat`, `openrouter-decisions`, `vercel-evaluation`, `systemone-http`, `choose`. 연결의 provider가 지원하는 값만 쓸 수 있습니다 |
| `inputs` | `text`, `image` 중 지원하는 입력 |
| `capabilitySource` | `discovery`(서버 조회로 확인) 또는 `manual`(직접 입력) |
| `maxChoices`, `maxImages` | 한 번에 줄 수 있는 후보와 이미지 수의 상한(기본 255, 2) |
| `roles` | `decision`: 행동을 고르는 모델, `analysis`: 실행 후 분석을 쓰는 모델(LLM만 해당) |
| `promptEditable` | 대시보드에서 프롬프트를 바꿀 수 있는지 |

키보드 모드는 이미지 입력을 지원하고 `maxImages`가 2 이상인 `decision` 모델이 필요합니다. 목록에 이름이 있다는 것만으로 이미지 지원을 확정하지 않으며, 확인하지 못한 기능은 미확인으로 남깁니다.

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

허용 행동은 후보 생성과 실행 직전 검사에 모두 적용하고, 실제 백엔드가 지원하지 않는 항목은 쓰지 않습니다. 중단 선택지, 독립 검증, 입력 필드 확인은 엔진이 유지합니다. `repetitionGuard`의 `auto`는 SystemOne 모델에서는 끄고 LLM과 `/choose` 서버에서는 켭니다.

## machine

Rawstep을 실행하는 컴퓨터에 속한 설정입니다.

| 필드 | 설명 |
|---|---|
| `backend` | 스크린리더 모드의 백엔드. `simulation`(기본, Chromium 기반 시뮬레이션이며 trace에 시뮬레이션으로 표시), `voiceover`(macOS), `nvda`(Windows) |
| `atEndpoint` | 네이티브 AT Driver의 loopback 주소(기본 `ws://127.0.0.1:9333`) |
| `browserExecutablePath` | 쓸 Chromium 경로. 비우면 Playwright의 Chromium |
| `headless` | 브라우저를 화면 없이 실행할지(기본 `true`) |

`voiceover`와 `nvda`는 해당 OS에서 AT Driver 서버를 따로 실행해야 하며, `rawstep doctor`가 엔드포인트 응답을 확인합니다. Orca는 라이브러리 수준의 고급 백엔드로만 제공합니다.
