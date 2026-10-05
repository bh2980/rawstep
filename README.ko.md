# Rawstep

[English](./README.md) | 한국어

키보드·스크린리더 작업 시도를 기록하고, 실행 정책·독립 검증·환경 비교·사후 보고서를 분리하는 로컬 실행용 모노레포입니다. npm에 게시하지 않아도 소스를 받아 빌드하거나 로컬 tarball을 라이브러리로 설치할 수 있습니다.

**실험용 도구이며 접근성 인증 도구가 아닙니다.** 작업 성공, 모델 점수, 모의 발화와 사람이 보고한 문제는 서로 다른 근거입니다. 사이트 전체의 접근성이나 실제 보조공학과의 동등성을 증명하지 않습니다.

## 소스를 받아 실행하기

Node.js 22.12 이상과 `package.json`에 고정된 pnpm이 필요합니다.

```sh
corepack pnpm install --frozen-lockfile
npm run build
corepack pnpm --filter @rawstep/browser exec playwright install chromium
npm run rawstep -- --help
npm run rawstep -- profiles
```

체크아웃의 CLI는 먼저 빌드해야 합니다. 기존의 신뢰할 수 있는 Chromium을 쓰려면 `--browser-executable`을 지정하세요. 테스트에는 `RAWSTEP_TEST_BROWSER_PATH`도 사용할 수 있습니다. 브라우저 sandbox를 끄는 옵션은 필요하지 않습니다. 자세한 내용은 [로컬 개발 안내](./docs/local-development.md)에 있습니다.

## 로컬 대시보드

```sh
npm run rawstep -- ui
# 개발: npm run dashboard:dev
```

연결 주소에서 모델을 조회하고, 작업별 프롬프트·허용 행동을 저장한 뒤 개별·선택·전체 실행과 결과 비교를 할 수 있습니다. Node가 화면과 API를 함께 제공하며 설정·결과는 프로젝트 파일에 저장합니다. UI는 별도 `packages/dashboard` workspace이며 shadcn과 공식 json-render shadcn 연동을 사용합니다. [대시보드 안내](./docs/dashboard-plan.ko.md)와 [구현 계획·검증 기록](./docs/dashboard-plan.ko.md)을 참고하세요.

## 실행 방식

- `screenshot-run`: 실제 PNG 화면 → 멀티모달 모델 선택 → 키보드 입력 → 새 화면. 기본 화면 정책에 DOM·AX·선택자·숨은 포커스·독립 검증 결과를 넘기지 않습니다
- `run --backend voiceover|nvda`: 해당 OS에서 별도로 실행한 네이티브 AT Driver 서버에 연결합니다
- `run --backend orca`: 정확한 Linux 브라우저 창과 연결한 Orca 발화 파이프라인 어댑터입니다. 개발 클라우드에서는 필요한 IPC가 막혀 실제 발화 검증은 완료하지 못했습니다
- `mock-run`: Chromium 기반 VoiceOver 시뮬레이션입니다. 생성된 문구는 항상 simulation으로 표시합니다
- `matrix`: 같은 작업을 여러 환경 프로필에서 실행하고 결과를 비교합니다
- `analyze` / `report`: 저장된 근거로 별도의 JSON·HTML 분석 보고서를 만듭니다
- `analyze --llm`: 저장된 trace에 대한 명시적인 사후 모델 분석입니다. 실행 결과는 변경하지 않습니다

0.2에서는 텍스트·이미지 SystemOne을 `--decision systemone`으로 선택합니다. 모델 이름을 Jev로 고정하지 않습니다. `legacy-run`과 `rawstep/legacy`는 제거했으며 `screenshot-run --script` 또는 `--policy`로 이전하세요. 새 screenshot 모드와 과거 2.0/2.1 trace 읽기는 유지합니다. [설정·검증 상태](./docs/systemone.md)를 참고하세요.

기본 `npm test`는 브라우저를 실행하지 않습니다. 실제 browser 테스트는 `test:integration`으로 worker 1개에서 순차 실행하고, `test:all`과 `check`는 전체 범위를 검증합니다.

행동 제한, 이름 있는 입력값, 탐색 경계, 단계·시간 예산, 취소와 기록 실패 시 중단은 runner가 담당합니다. 모델 판단이 나쁘다고 미리 정한 행동으로 바꾸지 않습니다. 성공 선언은 독립 검증을 통과해야 하고, 모델의 stuck·uncertain, 반복 보호장치와 런타임 오류를 구분합니다.

## 스크린샷 모델 실행

선택 사항인 [OneJev 모델 서버](./examples/screenshot/README.md)를 먼저 실행한 뒤:

```sh
npm run rawstep -- screenshot-run examples/screenshot/task.json \
  --model-endpoint http://127.0.0.1:8766/choose --out runs/screenshot-01
npm run rawstep -- analyze runs/screenshot-01
npm run rawstep -- report runs/screenshot-01 --analysis runs/screenshot-01/analysis.json
```

엔드포인트는 `rawstep-screenshot-choice-v1` 규약을 사용합니다. OpenAI chat-completions 주소를 그대로 넣는 방식은 아닙니다. `--policy ./policy.mjs`로 다른 신뢰된 모델 어댑터를 연결할 수 있습니다.

선택적인 `--diagnose-stop`은 정지 후 제한된 이유 후보를 별도 모델 호출로 평가합니다. 결과는 점수가 있는 가설이며 자유 생성 설명이나 확정된 결함이 아닙니다. 진단 실패·시간 초과가 원래 실행 결과를 바꾸거나 추가 키를 누르게 하지 않습니다.

모델 가중치, Python 환경, 네이티브 AT 서버와 브라우저 바이너리는 별도 설치입니다. npm 설치·import만으로 다운로드하거나 실행하지 않습니다. 실제 OneJev0.8B/4B 검증은 CPU에서 수행했으며, 모델 제작자의 GPU 지연 시간과 같은 수치라고 주장하지 않습니다.

## 환경 프로필과 비교

```sh
npm run rawstep -- matrix examples/profiles/task.json \
  --profiles default,reflow-text,forced-colors \
  --model-endpoint http://127.0.0.1:8767/choose --out runs/matrix-01
```

화면 크기, 페이지 텍스트 확대·간격, 색상·강제색·대비·모션 미디어 조건과 AT 버전 등을 요청값과 관측값으로 기록합니다. 브라우저 미디어 에뮬레이션, 페이지 사용자 스타일과 네이티브 OS 설정은 구분합니다. 진짜 브라우저 줌은 검증된 Chromium 탭 줌 연결이 필요합니다. 사용할 수 없으면 CSS 확대나 핀치를 대신 적용했다고 주장하지 않고 unsupported로 남깁니다. OS 돋보기와 고대비 제어는 브라우저 어댑터가 제공하지 않습니다.

포커스 순서·가림 후보·잘림·겹침·오류 상태는 모델에게 주지 않는 별도 진단입니다. 비교 보고서는 성공, 의심 문제, 모델 실패, 런타임 오류, 미지원 환경·패턴과 사람이 보고한 결과를 구분합니다. `--human-evidence`는 동의와 출처가 있는 동일 작업의 실제 사용자·검토자 결과를 연결하며, 가짜 사용자 테스트를 만들지 않습니다. [프로필 안내](./docs/environment-profiles.md)를 참고하세요.

## 모노레포와 라이브러리

| 패키지 | 역할 |
|---|---|
| `@rawstep/core` | 계약, 작업·프로필 스키마, trace 기록 |
| `@rawstep/policies` | 정책, 화면 모델 어댑터, 정지 이유 가설 |
| `@rawstep/browser` | 브라우저, runner, 검증, 키보드와 환경 진단 |
| `@rawstep/screenreaders` | AT Driver, Orca, 모의 실행과 출처별 코퍼스 |
| `@rawstep/reports` | 저장된 trace 분석·보고서 |
| `@rawstep/dashboard` | shadcn·json-render UI, 로컬 설정 API와 모델·프롬프트 실험 큐 |
| `@rawstep/cli` | 명령과 환경 matrix 실행 |
| `rawstep` | 기존 import와 실행 파일을 유지하는 호환 facade |

각 구현은 `packages/<이름>/src`에 있고, 각 패키지가 자기 빌드 결과와 의존성을 소유합니다. `rawstep/screenshot`, `rawstep/runner`, `rawstep/trace`, `rawstep/orca`, `rawstep/matrix` 등의 기존 import는 유지됩니다. facade에 구현을 복제하지 않습니다.

```js
import { runScreenshotTask, ScreenshotDecisionPolicy, HttpScreenshotModel } from 'rawstep/screenshot';
const policy = new ScreenshotDecisionPolicy({
  model: new HttpScreenshotModel({ endpoint: 'http://127.0.0.1:8766/choose' }),
});
await runScreenshotTask(task, { policy, outDir: 'runs/example' });
```

### npm 게시 없이 다른 프로젝트에서 쓰기

```sh
npm run pack:all
# 별도의 프로젝트에서 로컬 패키지 묶음을 설치합니다
npm install /절대/경로/rawstep/artifacts/*.tgz
npx rawstep --help
```

`artifacts/INSTALL.md`, `packages.json`, `SHA256SUMS`에 패키지 묶음과 해시가 저장됩니다. 아직 npm에 없는 내부 의존성을 내려받을 수는 없으므로, 의존하는 tarball 하나만 설치하지 말고 안내된 로컬 의존성 묶음을 함께 설치해야 합니다. core·policies·reports만 사용하는 경우에는 해당 묶음만 설치할 수 있고 Playwright가 필수는 아닙니다.

## 개인정보와 안전

이전 결과를 덮어쓰지 않도록 새 출력 폴더를 사용합니다. 이름 있는 입력값은 기본적으로 숨기며, 입력 후에는 화면·모델 근거·자유 형식 진단도 저장에서 제외합니다. 다만 활성 모델에게 보내는 화면이 trace의 가림 처리 때문에 익명화되는 것은 아닙니다. 원격 HTTPS 모델 전송에는 명시적인 허용이 필요합니다. 사용자 정책·분석기는 신뢰된 실행 코드이며 악성 코드를 격리하는 sandbox가 아닙니다.

공개 사이트 테스트에서는 변경 요청과 계정·편집·결제·신청 경로를 막을 수 있습니다. 접근 제한·사람 확인·TLS 경고를 우회하지 않습니다. `--proxy-server`는 이미 사용 가능한 인증정보 없는 프록시를 명시적으로 선택하는 옵션이며, 인증서 신뢰나 TLS 검증을 완화하지 않습니다.

## 검사

```sh
npm run check
npm run test:orca-native
```

전체 검사는 workspace 빌드, 소스·테스트 타입 검사, 기본 테스트 전체, 각 패키지의 로컬 의존성 묶음 격리 설치를 포함합니다. facade 검사는 실제 Chromium, 프로토콜, 취소, 기록 실패와 보고서를 확인합니다. Python 단위 검사가 통과해도 실제 Orca 발화가 검증된 것은 아닙니다.

[과거 화면 모델 측정](./docs/screenshot-verification.md)은 당시 기록입니다. 현재 체크아웃 검증과 혼동하지 마세요. 추가 안내: [네이티브 Orca](./docs/native-orca.md), [코퍼스 범위](./docs/screenreader-evidence.md), [CLI](./docs/cli.md), [소스 지도](./docs/editing-map.ko.md).

### 추가 실험 기능

[화면 포커스 확인, 고정 화면 비교 실험, 검증된 경로 재실행](./docs/visual-improvement-study.md)을 선택적으로 사용할 수 있습니다. 기본 정책은 그대로이며, 모델의 포커스 추정과 키보드 재실행 결과는 접근성 인증이나 실제 스크린 리더 검증을 대신하지 않습니다.
