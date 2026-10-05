# 소스 수령 후 로컬 실행 / Local development

이 저장소는 엔진·프로젝트 패키지(`@rawstep/project` 포함)와 비공개 dashboard workspace로 구성됩니다. npm 게시, 원격 배포 또는 사용자 컴퓨터에 대한 원격 접근 없이 소스를 받아 로컬에서 실행할 수 있습니다.

## 1. 설치와 빌드

- Node.js 22.12 이상 (dashboard 포함 빌드 기준)
- `package.json`의 pnpm10.12.1
- 브라우저 실행에는 호환되는 Playwright Chromium
- 실제 AT·모델은 선택 사항이며 별도 준비

```sh
corepack pnpm install --frozen-lockfile
npm run build
corepack pnpm --filter @rawstep/browser exec playwright install chromium
npm run rawstep -- --help
```

Corepack을 제공하지 않는 Node 설치에서는 공식 pnpm 설치 안내에 따라 동일한 고정 버전을 준비하세요. 임의로 lockfile을 지우거나 다른 버전으로 바꾸는 것이 재현 절차는 아닙니다.

브라우저는 npm 설치 시 자동 다운로드하지 않습니다. 이미 설치한 신뢰된 Chromium은 다음처럼 선택할 수 있습니다.

`rawstep.config.json`의 `machine.browserExecutablePath`에 절대 경로를 지정합니다(`npm run rawstep -- ui`의 설정 화면에서 편집할 수 있습니다).

```json
{ "machine": { "backend": "simulation", "browserExecutablePath": "/absolute/path/to/chromium", "headless": true } }
```

기본 실행은 headless입니다. `machine.headless`를 `false`로 두면 화면에 보이는 브라우저를 사용하며, 실제 데스크톱 환경이 있어야 합니다. sandbox 해제를 해결 방법으로 사용하지 마세요.

### macOS에서 시작할 때

위의 Node/pnpm 설치·빌드·CLI 명령은 사용자 컴퓨터에서 직접 실행하는 소스 절차입니다. 과거 검증 기록은 Linux 기준이며, 0.2 browser 검증은 macOS에서도 수행합니다. 실제 VoiceOver 검증과는 구분합니다. macOS에서 `npm run check`는 별도 Chromium이 필요하지만 실제 VoiceOver나 모델 가중치를 요구하지 않습니다. 패키지의 설치·빌드·import는 OS 설정, 브라우저 권한 또는 VoiceOver를 바꾸지 않습니다.

Python 단위 검사(`npm run test:orca-native`)는 Python 3이 있을 때 실행할 수 있는 별도 검사입니다. Orca 라이브 실행은 Linux X11 전용이며 macOS에서는 해당 경로를 실행하지 마세요. macOS의 실제 VoiceOver 검증은 대응 AT Driver 서버와 사용자가 준비한 권한이 필요하며 여기서는 검증하지 않았습니다.

첫 frozen 설치에서 아직 없는 `dist/cli/bin.js`에 대한 bin 생성 경고가 나올 수 있습니다. 정상 빌드 후 안내된 `npm run rawstep -- ...` 경로를 사용하세요. 이는 네이티브 AT나 모델 설치를 요청하는 경고가 아닙니다.

### Dashboard UI 개발

```sh
npm run dashboard
npm run dashboard:build
```

`packages/dashboard`의 Vite 개발 서버는 `127.0.0.1`에서 실행됩니다. `npm run rawstep -- ui`(설치된 패키지에서는 `npx rawstep ui`)는 같은 대시보드를 프로젝트 디렉터리에 연결해 실행합니다. 설정은 프로젝트의 `rawstep.config.json`, API 키는 `.env.local`에 저장됩니다(커밋하지 마세요). 실행 결과는 `.rawstep/`에 쌓이므로 git에서 제외하세요. [Dashboard 안내](../packages/dashboard/README.md)와 [개발 계획](./dashboard-plan.ko.md)을 참고하세요.

## 2. 어떤 기능에 무엇이 필요한가

| 기능 | 추가 준비 |
|---|---|
| 저장된 trace 분석·보고서 | 모델·브라우저·스크린리더 없이 실행 가능 |
| Chromium 시뮬레이션 / 스크린샷 fixture | Chromium |
| 실제 스크린샷 모델 | 모델 서버와 별도 가중치·런타임 |
| VoiceOver AT Driver | macOS, 실제 VoiceOver, 대응 AT Driver 서버와 필요한 사용자 권한 |
| NVDA AT Driver | Windows, 실제 NVDA, 대응 추가 기능·서버 |
| Orca 네이티브 어댑터 | Linux X11, Orca48.x, D-Bus/AT-SPI, 기존 Speech Dispatcher, 정확히 연결한 브라우저 창 |

Orca의 입력은 특정 X11 창·프로세스·포커스를 확인한 후에만 전송됩니다. 다른 활성 창을 임의로 선택하지 않습니다. `examples/orca`의 안내와 `docs/native-orca.md`를 먼저 읽으세요. 개발 클라우드의 단위 검사는 실제 네이티브 발화 검증이 아닙니다.

## 3. 기본 예제와 모델 예제

모델은 `rawstep.config.json`에 등록합니다(`npm run rawstep -- ui`). 연결·모델 등록 방법은 [SystemOne](./systemone.md)과 [config](./config.md)를 참고하세요. 등록한 뒤:

```sh
npm run rawstep -- run examples/profiles/task.json --model MODEL --out runs/first
```

`examples/profiles/task.json`은 함께 제공되는 환경 fixture에 맞춰져 있습니다. 실제 사이트의 탐색 정책으로 사용하지 마세요. 모델 없이 고정 행동을 쓰는 회귀 테스트는 라이브러리(`runScreenshotTask`와 `ScriptedPolicy` 등)로 작성하며, 실제 모델 추론이라고 표현하지 않습니다.

실제 스크린샷 모델은 `examples/screenshot/README.md`의 별도 설치 절차를 따릅니다. 로컬 서버를 실행한 뒤 `screenshot` 연결(`http://127.0.0.1:8766/choose`)과 프로토콜 `choose` 모델을 등록하고:

```sh
npm run rawstep -- run examples/screenshot/task.json --model onejev --mode keyboard
```

OneJev는 TypeSafe의 비공개 Jev와 구분되는 공개 모델입니다. 기본 npm 의존성에는 모델 SDK·가중치·Python·GPU 런타임이 없습니다. 0.8B 예제의 PyTorch `+cpu` 설치 명령은 측정한 Linux 전용입니다. Mac에서 그대로 실행하는 명령이 아닙니다. Mac용 Python/모델 런타임은 공식 배포처의 해당 플랫폼 지원을 따로 확인해야 하며 이번 전달에서 검증한 것으로 간주하지 않습니다. 4B 브리지의 별도 자산과 실행 절차는 [4B 안내](../examples/screenshot/onejev4b.md)에 있습니다. CPU에서는 모델 선택에 수십 초가 걸릴 수 있습니다. 작은 모델의 잘못된 판단을 행동 스크립트로 대신하지 않습니다.

## 4. 환경 비교

`rawstep.config.json`에 환경별 실행 프로필(예: `default`, `reflow-text`, `forced-colors`)을 두고 같은 작업을 프로필마다 실행합니다. 대시보드의 실험 큐는 작업×모델×프롬프트×프로필 조합을 한 번에 실행합니다.

```sh
npm run rawstep -- run examples/profiles/task.json --profile default --model MODEL
npm run rawstep -- run examples/profiles/task.json --profile reflow-text --model MODEL
npm run rawstep -- run examples/profiles/task.json --profile forced-colors --model MODEL
```

각 프로필은 새 실행으로 기록됩니다. 강제색·대비·모션 미디어, 페이지 글자 확대와 실제 OS 기능을 구분하세요. 사용 불가능한 브라우저 줌/OS 돋보기를 viewport·CSS 확대·핀치로 대체해 통과 처리하지 않습니다. 자세한 계약은 [환경 프로필 문서](./environment-profiles.md)에 있습니다.

## 5. 결과 보기

`rawstep run`은 실행마다 `run-<n>/` 폴더를 만들고 `trace.json`/`trace.jsonl`, `hints.json`, `analysis.json`, `report.html`, `report.json`을 기록합니다. 저장된 실행은 다시 분석하거나 보고서로 만들 수 있습니다.

```sh
npm run rawstep -- hints runs/first/run-1
npm run rawstep -- analyze runs/first/run-1
npm run rawstep -- report runs/first/run-1
```

`--out`을 생략하면 `<project>/.rawstep/runs/<timestamp>-<id>/` 아래에 새 폴더가 만들어집니다.

독립 검증 통과, 모델 가설, 휴리스틱 의심 문제와 출처가 있는 사람의 보고를 구분합니다. 성공 하나로 접근성 인증을 만들지 않습니다.

## 6. 라이브러리로 설치하기

소스에서 모든 로컬 배포물을 생성합니다.

```sh
npm run pack:all
```

결과는 `artifacts/`의 tarball과 `packages.json`, `SHA256SUMS`, `INSTALL.md`입니다. 별도 소비 프로젝트에서:

```sh
npm init -y
npm install /absolute/path/to/rawstep/artifacts/*.tgz
npx rawstep --help
```

로컬 경로를 실제 경로로 바꾸세요. 내부 패키지는 npm에 게시되어 있지 않으므로 의존하는 tarball 하나만 넣고 npm이 나머지를 받으리라 가정하지 않습니다. 독립 패키지를 선택적으로 쓸 때도 `INSTALL.md`에 적힌 의존성 묶음을 함께 제공합니다.

```js
import { runScreenshotTask } from 'rawstep/screenshot';
import { TraceRecorder } from '@rawstep/core/trace';
```

배포 대상 workspace는 `@rawstep/core`, `@rawstep/policies`, `@rawstep/browser`, `@rawstep/screenreaders`, `@rawstep/reports`, `@rawstep/project`, `@rawstep/cli`, `rawstep`입니다. 마지막 패키지는 `rawstep` 실행 파일과 `runTask`를 제공하는 facade입니다. 각 패키지의 import는 선언된 패키지 exports를 사용하며 다른 패키지의 소스 경로를 직접 참조하지 않습니다. 비공개 `@rawstep/dashboard`는 전체 빌드·타입 검사에 포함되며 엔진 tarball 묶음에서는 제외됩니다.

## 7. 전체 검사와 깨끗한 소스 재현

```sh
npm run check
npm run test:orca-native
npm run test:source
```

- `check`: workspace 빌드, 모든 소스·테스트 타입 검사, 테스트 전체, 외부 폴더에서 각 패키지의 독립 의존성 설치, facade 통합 검사
- `test:orca-native`: Python 프로토콜·입력 경계 단위 검사. 실제 Orca 발화 성공을 뜻하지 않음
- `test:source`: 소스를 깨끗한 외부 경로로 옮겨 frozen-lock 설치·전체 검사·네이티브 Python 단위 검사를 확인하는 재현 검사

실제 Chromium이 없는 상태의 브라우저 테스트를 통과로 간주하지 않습니다. 신뢰된 호환 바이너리를 지정하려면:

```sh
RAWSTEP_TEST_BROWSER_PATH=/absolute/path/to/chromium npm run check
```

환경변수 문법은 셸에 따라 다릅니다. Windows PowerShell에서는 먼저 `$env:RAWSTEP_TEST_BROWSER_PATH`를 설정한 뒤 명령을 실행하세요.

## 8. 네트워크·인증서·개인정보

프록시나 네트워크 경로를 자동으로 바꾸거나 TLS 검증을 무시하는 기능은 없습니다. 접근이 허용된 환경에서 실행하세요.

인증서 오류·접근 제한·사람 확인이 나오면 해당 환경을 정상적으로 준비한 뒤 다시 실행해야 합니다. `ignoreHTTPSErrors`, 보안 경고 우회나 임의 인증서 신뢰 추가를 해결책으로 사용하지 않습니다.

기본 trace는 이름 있는 입력값과 입력 뒤의 민감한 화면·진단을 숨깁니다. 모델에게 전송되는 실제 화면은 별도 문제이므로, 원격 모델 사용 시 목적지와 화면 내용을 확인하세요.

## Restricted/offline verification environments

`COREPACK_HOME` can select an existing writable cache containing the pinned pnpm version. Package smoke checks normally use a fresh npm cache; for an explicitly offline environment, set `RAWSTEP_SMOKE_NPM_CACHE` to a pre-populated npm cache and `RAWSTEP_SMOKE_OFFLINE=1`. Installed test projects remain isolated from the checkout and receive only their declared local tarball dependency closure. Missing cached dependencies fail rather than silently changing the test or downloading them.
