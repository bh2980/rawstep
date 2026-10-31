# Rawstep

[English](./README.md) | 한국어

Rawstep은 웹 페이지 하나를 두고 이렇게 묻습니다. **스크린리더를 처음 쓰는 사람이 이 페이지에서 이 작업을 해낼 수 있는가, 그렇다면 얼마나 애를 써야 하는가?**

Rawstep은 그런 사용자가 하듯 작업을 해 봅니다. 시뮬레이션 사용자는 스크린리더가 읽어 주는 말만 듣고, 한 칸씩 움직이거나 제목·폼 컨트롤·링크 단위로 건너뜁니다. Rawstep은 이 실행을 기록하고, 느려지거나 돌아가거나 막힌 곳을 짚어 줍니다. 목표에 닿았는지는 그중 한 가지 신호일 뿐, 합격·불합격 판정이 아닙니다.

이 README는 Rawstep을 써 볼지 정하려는 분을 위한 문서입니다. 무엇을 재는지, 5분 안에 시작하는 법, 다른 문서가 어디 있는지를 다룹니다.

## 설치

Rawstep은 아직 npm에 올라가 있지 않습니다. 올라가면 이렇게 설치합니다.

```sh
npm i -D rawstep
```

그전까지는 소스 체크아웃에서 로컬 tarball을 만들어(`npm run pack:rawstep`을 실행하면 `artifacts/rawstep-<version>.tgz`가 생깁니다) 그 파일을 설치하세요. 정확한 절차는 [시작하기](./docs/getting-started.md#install)와 [CONTRIBUTING.md](./CONTRIBUTING.md)에 있습니다. Node.js 22.12 이상과 Chromium이 필요합니다. Chromium은 Playwright의 것(`npx playwright install chromium`)이나 설치된 Google Chrome을 씁니다.

## 5분 만에 시작하기

빈 폴더에서:

```sh
npx rawstep init      # rawstep.config.json과 rawstep/demo/의 데모를 만듭니다
npx rawstep run demo  # 데모 작업을 실행합니다. 모델도 API 키도 필요 없습니다
npx rawstep ui        # http://127.0.0.1:4318 에서 대시보드를 엽니다
```

데모는 작은 쇼핑 페이지 하나, 작업 하나("Add the Demo mug to the cart."), 사람이 미리 써 둔 계획 하나로 이루어져 있습니다. 첫 번째 실행 프로필 "Written plan (no model)"이 이 계획을 그대로 따르므로 모델 없이 돌아갑니다. 처음 온 사용자처럼 모델이 직접 계획을 세우게 하려면 대시보드의 설정 › AI 연결에서 모델을 연결하세요. 자세한 과정은 [시작하기](./docs/getting-started.md)에 있습니다.

## 실행하면 나오는 것

`npx rawstep run demo`를 실제로 실행한 출력입니다.

```text
Running demo...
Conditions: Written plan (no model) (planner plan file rawstep/demo/plan.json)
  page default · screen reader simulation

Run 1 of 1: reached the goal · 7 moves
  longest without a goal word: 2 moves
  <run folder>

Could a first-time user do it? reached the goal in 1 of 1 runs
Cost of reaching it: 7 moves

No findings.

Stuck places are the user model's judgement: whether the page or the expectation is wrong is for you to decide.
Details: npx rawstep hints <run-dir>, npx rawstep report <run-dir>
```

실행은 네 가지 중 하나로 끝납니다. 목표에 닿음(reached the goal), 포기함(gave up), 끝냈다고 했지만 목표에 닿지 못함(said it was done, but the goal was not reached), 측정 못 함(not measured)입니다. 대가는 움직인 횟수(moves)로 셉니다. 실제 페이지라면 출력에 사용자가 무언가를 눌렀는데 예상대로 반응하지 않은 곳과, 그 사이 페이지가 한 일(포커스를 잃음, 아무도 알려 주지 않은 변화)도 함께 나옵니다. 하나하나의 뜻은 [개념](./docs/concepts.md)에서 설명합니다.

실행 폴더에는 실행 기록(trace), 실행이 따른 계획, 힌트, HTML 보고서가 들어 있습니다. 대시보드에서는 같은 결과를 작업별, 실행별로 볼 수 있습니다.

## Rawstep이 아닌 것

Rawstep은 접근성 인증도, 적합성 검사도 아닙니다. 목표에 닿은 실행이 있다고 페이지가 접근성을 갖췄다는 뜻은 아니고, 포기한 실행이 있다고 그 작업이 불가능하다는 증명도 아닙니다. 둘 다 시뮬레이션 사용자의 판단이며, 잘못된 쪽이 페이지인지 사용자의 예상인지는 직접 판단해야 합니다. 기본 스크린리더는 Chromium 위에서 돌아가는 VoiceOver 시뮬레이션입니다. 늘 `simulation`이라고 표시되며, 이것이 하는 말은 실제 VoiceOver나 NVDA가 하는 말의 증거가 아닙니다. 실제 스크린리더로 실행하려면 AT Driver 서버를 거칩니다. [스크린리더](./docs/screen-readers.md)를 보세요.

## 문서

| 문서 | 다루는 내용 |
|---|---|
| [시작하기](./docs/getting-started.md) | 설치, 데모 실행, 모델 연결, 내 작업 만들기, 결과 읽기 |
| [개념](./docs/concepts.md) | 작업과 실행 프로필, 찾는 방법, 시뮬레이션 사용자가 알 수 있는 것, 끝나는 방식, 대가, 힌트 |
| [계획](./docs/planning.md) | 계획 문서, Rawstep이 계획을 따르는 방식, 새 계획을 요청하는 때, 계획 파일, 계획 모델 프롬프트 |
| [스크린리더](./docs/screen-readers.md) | VoiceOver 시뮬레이션과 실제 VoiceOver·NVDA 비교, AT Driver 설정, 지원 동작, 알려진 한계 |
| [설정 레퍼런스](./docs/reference/config.md) | `rawstep.config.json`의 모든 필드와 페이지 환경 |
| [작업 레퍼런스](./docs/reference/task.md) | 작업 파일: 목표, 완료 확인, 입력값, 이동 범위 |
| [CLI 레퍼런스](./docs/reference/cli.md) | 명령, 옵션, 출력, 종료 코드 |
| [API 레퍼런스](./docs/reference/api.md) | `runTask`, 공개 import 경로, 직접 정책 만들기 |
| [결과 레퍼런스](./docs/reference/results.md) | 실행 폴더의 파일과 모든 힌트 종류 |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | 소스에서 빌드·테스트하기, 코드 위치, 저장소 규칙 |
| [예제](./examples/README.md) | 예제 파일마다 무엇을 보여 주는지 |
| [시뮬레이터 내부](./packages/screenreaders/src/mock-voiceover/README.md) | VoiceOver 시뮬레이션이 말하는 방식, 근거, 가정 |
| [AT Driver 내부](./packages/screenreaders/src/at-driver/README.md) | 실제 스크린리더용 키 매핑과 로터 동작 |
| [대시보드](./packages/dashboard/README.md) | 대시보드 서버와 API 구조([개발 규칙](./packages/dashboard/AGENTS.md)) |

함께 들어 있는 스크린리더 근거 자료의 라이선스는 [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md)에 있습니다. Rawstep 자체는 [MIT 라이선스](./LICENSE)를 따릅니다.
