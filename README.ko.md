# Rawstep

[English](./README.md) | 한국어

Rawstep은 웹 페이지에서 키보드 또는 스크린리더 작업을 모델이 직접 시도하게 하고, 어디에서 느려졌거나 돌아갔는지를 **마찰 힌트**로 알려 주는 도구입니다. 프로젝트 하나에 `rawstep` 패키지 하나만 설치하면 대시보드(`npx rawstep ui`), 명령줄과 CI(`npx rawstep run`), 테스트 코드(`import { runTask } from 'rawstep'`)에서 같은 설정으로 쓸 수 있습니다.

**실험용 도구이며 접근성 인증 도구가 아닙니다.** 목표 달성 여부, 모델 점수, 시뮬레이션 발화는 서로 다른 근거이고, 어느 것도 사이트 전체의 접근성이나 실제 보조공학과의 동등성을 증명하지 않습니다.

## Quick start

```sh
npm i -D rawstep
npx rawstep ui          # 대시보드에서 연결·모델·작업을 설정합니다. 터미널에서 시작하려면 npx rawstep init
npx rawstep run checkout
```

`rawstep ui`나 `rawstep init`은 프로젝트 폴더에 `rawstep.config.json`을 만듭니다. 대시보드에서 모델 연결과 작업을 등록한 뒤 `rawstep run <task>`에 작업 id(또는 작업 JSON 파일 경로)를 넘기면 실행하고, 실행마다 결과와 여러 번 실행에서 모은 발견 사항을 `Page`와 `Model`로 나누어 보여 줍니다.

```text
Run 1 of 2: goal reached · 7 steps
  /my-project/.rawstep/runs/2026-10-06T09-12-30-a1b2c3/run-1
Run 2 of 2: goal reached · 12 steps
  Slower than the fastest run
  /my-project/.rawstep/runs/2026-10-06T09-12-30-a1b2c3/run-2

Page
  button "Add to cart" · focus lost · 2 of 2 runs
Model
  link "Skip to content" · repeated state · 1 of 2 runs

Details: npx rawstep hints <run-dir>, npx rawstep report <run-dir>
```

각 줄은 `<role "이름"> · <종류> · <n> of <N> runs` 형식입니다. 테스트에서는 같은 결과를 코드로 받습니다.

```ts
import { runTask } from 'rawstep';

const { runs, findings } = await runTask('checkout', { repeat: 3 });
// 페이지가 만든 마찰이 없어야 한다는 기준은 팀이 정하는 임계값이며 Rawstep의 판정이 아닙니다.
expect(findings.filter((f) => f.source === 'page')).toEqual([]);
```

`runTask`는 실행이 끝나면 목표 달성 여부와 상관없이 결과를 돌려 줍니다. 설정 문제(설정 파일 없음, 알 수 없는 모델·프로필, 사용할 수 있는 모델 없음, 키 누락)와 취소는 `ProjectError`로 거부됩니다. 자세한 사용법은 [CLI 안내](./docs/cli.ko.md)와 [설정 안내](./docs/config.ko.md)를 참고하세요.

## 두 가지 모드

- **keyboard**: 실제 화면 픽셀을 이미지 입력을 지원하는 모델에게 보여 주고, 모델이 고른 키 입력으로 페이지를 조작합니다. DOM·접근성 트리·독립 검증 결과는 모델에게 넘기지 않습니다.
- **screenreader**: 스크린리더가 읽어 주는 음성 출력만 보고 다음 동작을 고릅니다. `rawstep.config.json`의 `machine.backend`가 `simulation`이면 Chromium 기반의 시뮬레이션 스크린리더를 쓰며, 만들어진 문구는 trace에서 항상 시뮬레이션으로 표시합니다. `voiceover`나 `nvda`는 해당 OS에서 별도로 실행한 네이티브 AT Driver 서버에 연결합니다. Orca는 라이브러리 수준의 고급 백엔드로만 제공합니다.

모드는 `rawstep run <task> --mode keyboard|screenreader`로 고릅니다(기본값은 `keyboard`).

## 힌트는 판정이 아닙니다

Rawstep은 통과/실패를 판정하지 않습니다. 목표를 달성했는지는 여러 신호 중 하나이고, 사람이 확인해 볼 만한 곳을 가리키는 것이 힌트입니다. 힌트는 출처별로 나뉩니다.

- `page`: 포커스를 잃음·보이지 않음, 안내 누락, 지나치게 많은 키 입력, 모달 밖으로 나간 포커스처럼 페이지 쪽에서 생긴 마찰
- `model`: 되돌아감, 같은 상태 반복, 모델의 망설임이나 조기 중단
- `run`: 같은 작업을 반복했을 때 가장 빠른 실행보다 느림, 시작 시점에 이미 충족된 목표

`--repeat <n>`으로 같은 작업을 여러 번 실행하면 각 실행의 힌트를 목표에 도달한 가장 빠른 실행과 비교하고, 같은 요소에서 반복된 힌트를 하나의 발견 사항으로 묶습니다. 저장된 실행의 힌트는 `rawstep hints <run-dir>`로 다시 볼 수 있습니다. 자세한 내용은 [보고서 안내](./docs/report.ko.md)를 참고하세요.

## 실행 프로필

화면 크기, 확대, 색상 조건 같은 환경과 허용 행동, 멈춤 기준을 묶은 것이 실행 프로필입니다. `rawstep.config.json`의 `profiles`에 정의하고 같은 작업을 프로필만 바꿔 실행하면 환경 간 차이를 비교할 수 있습니다.

```sh
npx rawstep run checkout --profile narrow
npx rawstep run checkout --profile zoom-200
```

환경은 `default`, `narrow`, `zoom-200`, `forced-colors`, `dark`, `reflow-text` 같은 내장 이름이나 객체로 지정합니다. 요청한 값과 관측한 값을 함께 기록하며, 브라우저 미디어 에뮬레이션과 네이티브 OS 설정은 구분합니다. 사용할 수 없는 환경은 적용했다고 주장하지 않고 unsupported로 남깁니다. [환경 프로필 안내](./docs/environment-profiles.md)를 참고하세요.

## 설정 파일

프로젝트 폴더의 `rawstep.config.json` 하나에 모델 연결, 모델, 작업, 실행 프로필, 실행 환경(`machine`)이 모두 들어 있고, 대시보드·CLI·`runTask`가 같은 파일을 읽습니다. 프로젝트와 함께 커밋하세요. API 키는 이 파일에 넣지 않습니다. 연결에는 환경변수 이름(`apiKeyEnv`)만 적고, 값은 `.env.local`이나 프로세스 환경에 둡니다. `.env.local`과 실행 결과가 쌓이는 `.rawstep/`는 git에서 제외하세요. 필드는 [설정 안내](./docs/config.ko.md)에 있습니다.

## 소스에서 실행

기여자를 위한 안내입니다. Node.js 22.12 이상과 `package.json`에 고정된 pnpm이 필요합니다.

```sh
corepack pnpm install --frozen-lockfile
npm run build
corepack pnpm --filter @rawstep/browser exec playwright install chromium
npm run rawstep -- --help
```

체크아웃의 CLI는 먼저 빌드해야 합니다. 기존의 신뢰할 수 있는 Chromium을 쓰려면 `machine.browserExecutablePath`를 설정하세요. 테스트에는 `RAWSTEP_TEST_BROWSER_PATH`도 사용할 수 있습니다. 브라우저 sandbox를 끄는 옵션은 필요하지 않습니다. 자세한 내용은 [로컬 개발 안내](./docs/local-development.md)에 있습니다. 대시보드 UI를 개발할 때는 `npm run dashboard:dev`를 사용하고, 구성은 [대시보드 안내](./docs/dashboard-plan.ko.md)에 있습니다.

기본 `npm test`는 브라우저를 실행하지 않습니다. 실제 browser 테스트는 `test:integration`으로 worker 1개에서 순차 실행하고, `test:all`과 `check`는 전체 범위를 검증합니다.

## 패키지

| 패키지 | 역할 |
|---|---|
| `@rawstep/core` | 계약, 작업·프로필 스키마, trace 기록 |
| `@rawstep/policies` | 정책, 화면 모델 어댑터, 정지 이유 가설 |
| `@rawstep/browser` | 브라우저, runner, 검증, 키보드와 환경 진단 |
| `@rawstep/screenreaders` | AT Driver, Orca, 시뮬레이션과 출처별 코퍼스 |
| `@rawstep/reports` | 마찰 힌트, 저장된 trace 분석·보고서 |
| `@rawstep/project` | `rawstep.config.json` 스키마와 저장소(작업 파일, `.env.local` 키), 실행 조립·실행, `runTask`, 모델 조회. 대시보드·CLI·API가 공유 |
| `@rawstep/dashboard` | UI, 로컬 API, 실험 큐와 실행 이력 |
| `@rawstep/cli` | `init`, `ui`, `run`, `hints`, `report`, `analyze`, `doctor` 명령 |
| `rawstep` | 위 패키지를 묶은 facade와 실행 파일. 사용자는 이 패키지만 설치합니다 |

각 구현은 `packages/<이름>/src`에 있고, 각 패키지가 자기 빌드 결과와 의존성을 소유합니다. 빌드 순서는 core, policies, browser, screenreaders, reports, project, dashboard, cli, rawstep입니다. `rawstep`의 하위 경로(`rawstep/runner`, `rawstep/trace`, `rawstep/report`, `rawstep/hints`, `rawstep/project`, `rawstep/orca` 등)로 저수준 API를 쓸 수 있고, facade에 구현을 복제하지 않습니다.

### npm 게시 없이 다른 프로젝트에서 쓰기

```sh
npm run pack:all
# 별도의 프로젝트에서 로컬 패키지 묶음을 설치합니다
npm install /절대/경로/rawstep/artifacts/*.tgz
npx rawstep --help
```

`artifacts/INSTALL.md`, `packages.json`, `SHA256SUMS`에 패키지 묶음과 해시가 저장됩니다. 아직 npm에 없는 내부 의존성을 내려받을 수는 없으므로, 의존하는 tarball 하나만 설치하지 말고 안내된 로컬 의존성 묶음을 함께 설치해야 합니다. core·policies·reports만 사용하는 경우에는 해당 묶음만 설치할 수 있고 Playwright가 필수는 아닙니다.

모델 가중치, Python 환경, 네이티브 AT 서버와 브라우저 바이너리는 별도 설치입니다. npm 설치·import만으로 다운로드하거나 실행하지 않습니다.

## 개인정보와 안전

이전 결과를 덮어쓰지 않도록 실행마다 새 출력 폴더를 만듭니다. 이름 있는 입력값은 기본적으로 숨기며, 입력 후에는 화면·모델 근거·자유 형식 진단도 저장에서 제외합니다. 다만 활성 모델에게 보내는 화면이 trace의 가림 처리 때문에 익명화되는 것은 아닙니다. 스크린샷에는 페이지의 개인 정보가 담길 수 있고, 모델은 픽셀과 목표, 이름 있는 입력 키, 행동 기록만 받습니다. 원격 HTTPS 모델 전송에는 명시적인 허용이 필요합니다. API 키는 설정 파일에 저장하지 않으며, 대시보드는 키의 설정 여부만 보여 줍니다.

행동 제한, 이름 있는 입력값, 탐색 경계, 단계·시간 예산, 취소와 기록 실패 시 중단은 runner가 담당합니다. 모델 판단이 나쁘다고 미리 정한 행동으로 바꾸지 않습니다. 성공 선언은 독립 검증을 통과해야 하고, 모델의 stuck·uncertain, 반복 보호장치와 런타임 오류를 구분합니다. 접근 제한·사람 확인·TLS 경고를 우회하지 않습니다.

## 검증

```sh
npm run check
```

전체 검사는 workspace 빌드, 소스·테스트 타입 검사, 기본 테스트 전체, 각 패키지의 로컬 의존성 묶음 격리 설치를 포함합니다. facade 검사는 실제 Chromium, 프로토콜, 취소, 기록 실패와 보고서를 확인합니다. Python 단위 검사가 통과해도 실제 Orca 발화가 검증된 것은 아닙니다.

[과거 화면 모델 측정](./docs/screenshot-verification.md)은 당시 기록입니다. 현재 체크아웃 검증과 혼동하지 마세요. 추가 안내: [네이티브 Orca](./docs/native-orca.md), [코퍼스 범위](./docs/screenreader-evidence.md), [CLI](./docs/cli.ko.md), [소스 지도](./docs/editing-map.ko.md).
