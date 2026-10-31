# Rawstep

[English](./README.md) | 한국어

Rawstep은 웹 페이지를 처음 보는 사용자처럼 스크린리더로 작업을 시도해 보고(계획 모델이 들은 것으로 계획을 세우고 Rawstep이 그 계획을 따릅니다), 어디에서 느려졌거나 돌아갔는지를 **마찰 힌트**로 알려 주는 도구입니다. 프로젝트 하나에 `rawstep` 패키지 하나만 설치하면 대시보드(`npx rawstep ui`), 명령줄과 CI(`npx rawstep run`), 테스트 코드(`import { runTask } from 'rawstep'`)에서 같은 설정으로 쓸 수 있습니다.

**실험용 도구이며 접근성 인증 도구가 아닙니다.** 목표 달성 여부, 계획 모델의 판단, 시뮬레이션 발화는 서로 다른 근거이고, 어느 것도 사이트 전체의 접근성이나 실제 보조공학과의 동등성을 증명하지 않습니다.

## Quick start

```sh
npm i -D rawstep
npx rawstep ui          # 대시보드에서 연결·실행 프로필·작업을 설정합니다. 터미널에서 시작하려면 npx rawstep init
npx rawstep run checkout
```

`rawstep ui`나 `rawstep init`은 프로젝트 폴더에 `rawstep.config.json`을 만듭니다. 대시보드에서 연결(모델에 닿는 곳)과 작업을 등록하고 실행 프로필에서 계획 모델을 고른 뒤 `rawstep run <task>`에 작업 id(또는 작업 JSON 파일 경로)를 넘기면 실행하고, 실행마다 결과와 여러 번 실행에서 모은 발견 사항을 `Page`와 `Model`로 나누어 보여 줍니다.

```text
Run 1 of 2: gave up · 34 moves
  Why: "Add to cart never says the item was added, and nothing else heard can add it."
  Rests on A3 "Pressing Add to cart announces that the item was added" · broke at step 17 after pressing StaticText "Add to cart"
  longest without a goal word: 9 moves · wrong guesses about where something is: 1
  <run 1 folder>
Run 2 of 2: reached the goal · 84 moves
  longest without a goal word: 21 moves · wrong guesses about where something is: 0
  <run 2 folder>

Could a first-time user do it? reached the goal in 1 of 2 runs · gave up 1
Cost of reaching it: 84 moves

Stuck: pressed, and it did not respond as the user expected
  StaticText "Add to cart" · 1 of 2 runs · 1 give-up rest on it
    expected: Pressing Add to cart announces that the item was added

Page
  button "Checkout" · focus-lost · 1 of 2 runs

Details: npx rawstep hints <run-dir>, npx rawstep report <run-dir>
```

각 줄은 `<role "이름"> · <종류> · <n> of <N> runs` 형식입니다. 테스트에서는 같은 결과를 코드로 받습니다.

```ts
import { runTask } from 'rawstep';

const { runs, findings } = await runTask('checkout', { repeat: 3 });
// 페이지가 만든 마찰이 없어야 한다는 기준은 팀이 정하는 임계값이며 Rawstep의 판정이 아닙니다.
expect(findings.filter((f) => f.source === 'page')).toEqual([]);
```

`runTask`는 실행이 끝나면 목표 달성 여부와 상관없이 결과를 돌려 줍니다. 설정 문제(설정 파일 없음, 알 수 없는 조건 이름, 계획 모델이 없는 프로필, 키 누락)와 취소는 `ProjectError`로 거부됩니다. 자세한 사용법은 [CLI 안내](./docs/cli.ko.md)와 [설정 안내](./docs/config.ko.md)를 참고하세요.

## 스크린리더

계획 모델은 스크린리더가 읽어 주는 음성 출력만 듣고 계획합니다. 프로필의 스크린리더(`screenReader`)가 `simulation`이면 Chromium 기반의 시뮬레이션 스크린리더를 쓰며, 만들어진 문구는 trace에서 항상 시뮬레이션으로 표시합니다. `voiceover`나 `nvda`는 해당 OS의 네이티브 AT Driver 서버에 연결하며, `machine.atEndpoints`를 비워 두면 서버의 일반적인 주소를 씁니다. 응답하는 서버가 없으면 이 컴퓨터의 `.env.local`에 둔 `RAWSTEP_AT_DRIVER_COMMAND`로 서버를 시작할 수 있습니다. Orca는 라이브러리 수준의 고급 백엔드로만 제공합니다.

## 힌트는 판정이 아닙니다

Rawstep은 통과/실패를 판정하지 않습니다. 목표를 달성했는지는 여러 신호 중 하나이고, 사람이 확인해 볼 만한 곳을 가리키는 것이 힌트입니다. 힌트는 출처별로 나뉩니다.

- `page`: 포커스를 잃음·보이지 않음, 안내 누락, 지나치게 많은 키 입력, 모달 밖으로 나간 포커스처럼 페이지 쪽에서 생긴 마찰
- `model`: 되돌아감, 조기 중단, 사용자가 예상한 대로 반응하지 않은 곳(틀린 가정)
- `run`: 같은 작업을 반복했을 때 가장 빠른 실행보다 느림, 시작 시점에 이미 충족된 목표, 새 계획을 세워야 했던 곳

`--repeat <n>`으로 같은 작업을 여러 번 실행하면 각 실행의 힌트를 목표에 도달한 가장 빠른 실행과 비교하고, 같은 요소에서 반복된 힌트를 하나의 발견 사항으로 묶습니다. 저장된 실행의 힌트는 `rawstep hints <run-dir>`로 다시 볼 수 있습니다. 자세한 내용은 [보고서 안내](./docs/report.ko.md)를 참고하세요.

## 실행 프로필

실험은 **작업 × 실행 프로필**입니다. 작업은 무엇을 할지만 담고, 실행 프로필은 누가 어떻게 하는지와 실행이 끝나는 방식을 바꾸는 모든 것을 한 이름으로 묶은 것이며, `rawstep.config.json`의 `profiles`에 정의합니다.

- **계획**(`planner`): 스크린리더 실행은 항상 계획합니다. 계획 모델(LLM 또는 계획 파일)이 계획 문서(성공 기준, 가정, 단계와 번호 붙은 작업, 버전과 이력)를 쓰고, Rawstep이 작업을 적힌 그대로 하나씩 수행합니다. 이동 작업은 cue가 들릴 때까지 같은 이동을 되풀이하고, 누르기 작업은 커서가 있는 항목을 누르고, 입력 작업은 커서가 있는 입력란에 이름 있는 입력값을 입력합니다. 행동이 계속 실패하거나 아무것도 바꾸지 못할 때, 새로운 것을 못 들은 채 작업이 길어질 때, 일정 횟수를 넘길 때마다 새 계획을 요청합니다([계획과 계획 따르기](./docs/config.ko.md#계획과-계획-따르기)). 행동 하나하나를 고르는 모델이 없으니 실행 비용은 계획 모델 호출뿐입니다. 모델과 추론 강도는 연결이 아니라 프로필에서 고릅니다
- **행동**(`actions`): 허용하는 키와 스크린리더 동작, 입력값 입력 여부. 대시보드에서는 찾는 방법(한 칸씩, 제목으로, 폼 컨트롤로, 링크로)으로 고릅니다
- **페이지**(`page`): 화면 크기, 글자 확대, 색상 조건 같은 페이지 환경
- **스크린리더**(`screenReader`): 시뮬레이션, VoiceOver, NVDA
- **실행 규칙**(`runRules`): 반복 감시, 변화 없음 한도, 계획 모델 호출 한도, 노력 점검 간격. 프로필마다 전체를 가지며 `--rule`이 한 실행에 한해 바꿉니다

프로필은 실행할 때 고르고(`--profile`), 고르지 않으면 첫 번째 프로필을 씁니다. 같은 작업을 한 부분만 다른 프로필로 실행하면 그 부분의 영향을 비교할 수 있습니다. 실행마다 쓴 프로필의 내용 전체를 기록하므로 이름이 아니라 내용으로 비교합니다. 매 실행 뒤 Rawstep의 규칙 기반 분석은 항상 실행되고, 프로젝트(`project.analysis.model`)에 해설 모델이 있으면 LLM 분석이 더해집니다. 해설 모델은 결과를 바꾸지 않으므로 프로필에 들어가지 않습니다.

```sh
npx rawstep run checkout --profile narrow
npx rawstep run checkout --profile zoom-200
npx rawstep run checkout --profile headings-voiceover
npx rawstep run checkout --profile narrow-headings --rule maxPlannerCalls=60
```

프로필의 `page`는 `default`, `narrow`, `zoom-200`, `forced-colors`, `dark`, `reflow-text` 같은 내장 이름이나 객체로 지정합니다. 요청한 값과 관측한 값을 함께 기록하며, 브라우저 미디어 에뮬레이션과 네이티브 OS 설정은 구분합니다. 사용할 수 없는 환경은 적용했다고 주장하지 않고 unsupported로 남깁니다. [환경 프로필 안내](./docs/environment-profiles.md)를 참고하세요.

## 대시보드

`npx rawstep ui`가 `127.0.0.1`에서 대시보드를 엽니다. 메뉴는 **작업 · 실행 기록 · 설정** 셋입니다. 작업 화면에서 실행 프로필을 고르고 실행합니다. 설정은 세 묶음입니다. **실행**(실행 프로필), **모델**(연결, 해설·제안 모델), **이 컴퓨터**(브라우저, AT Driver 주소, 봇 확인). 연결 화면은 각 연결을 계획·해설·제안 중 어느 역할이 쓰는지 보여 줍니다. 실행 상세는 계획 문서(단계, 현재 작업, 버전 이력)와 작업별 행동, 계획 모델 호출을 보여 줍니다.

## 설정 파일

프로젝트 폴더의 `rawstep.config.json` 하나에 연결(모델에 닿는 곳), 실행 프로필, 작업, 프로젝트 설정(해설·제안 모델), 이 컴퓨터의 설정(`machine`)이 모두 들어 있고, 대시보드·CLI·`runTask`가 같은 파일을 읽습니다. 프로젝트와 함께 커밋하세요. API 키는 이 파일에 넣지 않습니다. 제공자마다 정해진 환경변수(`RAWSTEP_OPENAI_API_KEY`, `RAWSTEP_ANTHROPIC_API_KEY` 등, 사용자 지정 연결은 직접 지정)에서 읽고, 값은 `.env.local`이나 프로세스 환경에 둡니다. `.env.local`과 실행 결과가 쌓이는 `.rawstep/`는 git에서 제외하세요. 필드는 [설정 안내](./docs/config.ko.md)에 있고, `version` 7보다 오래된 설정은 읽지 않으니 `rawstep init`으로 새 프로젝트를 시작하고 작업을 복사해 오세요.

## 소스에서 실행

기여자를 위한 안내입니다. Node.js 22.12 이상과 `package.json`에 고정된 pnpm이 필요합니다.

```sh
corepack pnpm install --frozen-lockfile
npm run build
corepack pnpm --filter @rawstep/browser exec playwright install chromium
npm run rawstep -- --help
```

체크아웃의 CLI는 먼저 빌드해야 합니다. 기존의 신뢰할 수 있는 Chromium을 쓰려면 `machine.browserExecutablePath`를 설정하세요. 테스트에는 `RAWSTEP_TEST_BROWSER_PATH`도 사용할 수 있습니다. 브라우저 sandbox를 끄는 옵션은 필요하지 않습니다. 자세한 내용은 [로컬 개발 안내](./docs/local-development.md)에 있습니다. 대시보드 UI를 개발할 때는 `npm run dashboard:dev`를 사용합니다.

기본 `npm test`는 브라우저를 실행하지 않습니다. 실제 browser 테스트는 `test:integration`으로 worker 1개에서 순차 실행하고, `test:all`과 `check`는 전체 범위를 검증합니다.

## 패키지

사용자는 `rawstep` 패키지 하나만 설치합니다. 이 패키지의 dist에 CLI, 대시보드(UI와 서버), API가 모두 들어 있고 내부 workspace는 번들에 인라인됩니다. 아래 workspace는 개발 구조(의존 방향을 강제)이며 모두 `private`이라 게시하지 않습니다.

| 패키지 | 역할 |
|---|---|
| `@rawstep/core` | 계약, 작업·환경 프로필 스키마, trace 기록 |
| `@rawstep/policies` | 정책, 계획 모델과 Rawstep이 따르는 계획 |
| `@rawstep/browser` | 브라우저, runner, 검증, 환경 진단 |
| `@rawstep/screenreaders` | AT Driver, Orca, 시뮬레이션과 출처별 코퍼스 |
| `@rawstep/reports` | 마찰 힌트, 저장된 trace 분석·보고서 |
| `@rawstep/project` | `rawstep.config.json` 스키마와 저장소(작업 파일, `.env.local` 키), 실행 조립·실행, `runTask`, 모델 조회. 대시보드·CLI·API가 공유 |
| `@rawstep/dashboard` | UI, 로컬 API, 실험 큐와 실행 이력 |
| `@rawstep/cli` | `init`, `ui`, `run`, `hints`, `report`, `analyze`, `doctor` 명령 |
| `rawstep` | 게시되는 유일한 패키지. 위 workspace를 묶고 실행 파일과 공개 진입점을 제공합니다 |

각 구현은 `packages/<이름>/src`에 있습니다. 빌드 순서는 core, policies, browser, screenreaders, reports, project, dashboard, cli이고, 마지막에 `rawstep`이 나머지를 번들합니다. `rawstep`의 하위 경로(`rawstep/runner`, `rawstep/trace`, `rawstep/report`, `rawstep/hints`, `rawstep/project`, `rawstep/orca` 등)로 저수준 API를 쓸 수 있습니다. 서드파티 런타임 의존성(`playwright`, `ai`, `@ai-sdk/openai-compatible`, `zod`)은 `rawstep`의 일반 dependencies이며 프로젝트에는 `@rawstep/*`가 설치되지 않습니다.

### npm 게시 없이 다른 프로젝트에서 쓰기

```sh
npm run pack:rawstep
# 별도의 프로젝트에서 tarball 하나만 설치합니다
npm install /절대/경로/rawstep/artifacts/rawstep-<버전>.tgz
npx rawstep --help
```

`npm run test:package`는 임시 프로젝트에서 이 과정을 수행하고 CLI, `rawstep ui`, import, TypeScript 타입을 검사합니다. 모델 가중치, Python 환경, 네이티브 AT 서버와 브라우저 바이너리는 별도 설치입니다. npm 설치·import만으로 다운로드하거나 실행하지 않습니다.

## 개인정보와 안전

이전 결과를 덮어쓰지 않도록 실행마다 새 출력 폴더를 만듭니다. 이름 있는 입력값은 기본적으로 숨기며, 입력 후에는 모델 근거·자유 형식 진단도 저장에서 제외합니다. 다만 모델에게 보내는 페이지 텍스트가 trace의 가림 처리 때문에 익명화되는 것은 아닙니다. 계획 모델은 스크린리더 음성과 목표, 이름 있는 입력 키, 행동 기록만 받습니다. 원격 HTTPS 모델 전송에는 명시적인 허용이 필요합니다. API 키는 설정 파일에 저장하지 않으며, 대시보드는 키의 설정 여부만 보여 줍니다.

행동 제한, 이름 있는 입력값, 탐색 경계, 단계·시간 예산, 취소와 기록 실패 시 중단은 runner가 담당합니다. 계획이 나쁘다고 미리 정한 행동으로 바꾸지 않습니다. 계획 모델의 성공 선언은 독립 검증을 통과해야 하고, 사용자의 포기, 측정 못 함, 반복 보호장치와 런타임 오류를 구분합니다. 접근 제한·사람 확인·TLS 경고를 우회하지 않습니다.

## 검증

```sh
npm run check
```

전체 검사는 workspace 빌드, 소스·테스트 타입 검사, 기본 테스트 전체, 각 패키지의 로컬 의존성 묶음 격리 설치를 포함합니다. facade 검사는 실제 Chromium, 프로토콜, 취소, 기록 실패와 보고서를 확인합니다. Python 단위 검사가 통과해도 실제 Orca 발화가 검증된 것은 아닙니다.

추가 안내: [네이티브 Orca](./docs/native-orca.md), [코퍼스 범위](./docs/screenreader-evidence.md), [CLI](./docs/cli.ko.md), [소스 지도](./docs/editing-map.ko.md).
