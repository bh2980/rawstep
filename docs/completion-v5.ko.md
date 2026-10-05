# Rawstep V5 소스 전달 및 검증 보고서

작성일: 2026-10-01 UTC  
패치 기준: `d567466074b99d9e2580a6da8fed7ab3ededdf3f`

## 요약

소스는 7개의 실제 workspace로 정리했습니다. 로컬에서 설치·빌드·CLI 실행과 라이브러리 사용이 가능하며 npm 게시나 Git push는 하지 않았습니다. 사용자 Mac에도 접근하지 않았습니다. `rawstep`의 기존 18개 JavaScript 진입점은 얇은 facade로 유지합니다.

브라우저·프로필·진단·비교·출처 코퍼스·정지 이유를 연결하는 코드와 회귀 검사는 제공하지만, 요청한 모든 환경에서의 실제 동작을 입증한 것은 아닙니다. 실제 브라우저 줌과 Orca 발화는 이 환경에서 라이브 검증하지 못했습니다. 공개 사이트의 초기 시도는 인증서 신뢰 저장소 차이로 막혔습니다. 이후 사용자 승인 아래 격리된 검사 전용 신뢰 경로를 정상 구성해 Wikipedia/GOV.UK의 TLS·페이지 접근을 확인했고, W3C는 HTTP 403/challenge 장벽으로 남았습니다. 최종 실제 모델 결과는 별도로 전달하는 공개 사이트 결과 보고서와 trace가 기준입니다. 아래에서 구현, 통과한 검사, 미검증·차단된 항목을 구분합니다.

## 요청한 9개 항목의 상태

| 항목 | 제공 내용 | 검증 상태와 남은 제한 |
|---|---|---|
| 1. 재현 가능한 환경 프로필 | 브라우저·viewport·줌·텍스트·색상·모션·AT 버전의 요청값, 관측값, 적용 방식과 불일치 기록 | 브라우저 fixture 검증 통과. OS 설정이나 알려지지 않은 AT 버전을 추정하지 않음 |
| 2. 확대·간격·리플로우 | 페이지 텍스트 확대, 줄/글자/단어/문단 간격, 좁은 viewport, 잘림·겹침·가로 스크롤 후보 | 실제 Chromium fixture 통과. 텍스트 사용자 스타일은 브라우저 text-only zoom과 다름. 진짜 탭 줌 controller 구현은 라이브 미검증이며 미지원 시 중단. OS 돋보기 제어 미구현 |
| 3. 강제색·대비·모션 | 미디어 에뮬레이션 요청/관측 확인 및 실제 화면 기록 | 설정 적용 확인과 UI 반응을 구분. 네이티브 OS 고대비 검증 아님. 4B 강제색 작업 시간 초과는 모델/실행 결과로 남김 |
| 4. 키보드 상호작용 | 실제 포커스 순서, indicator 힌트, 가림 후보, skip link, 정/역방향 이동, dialog Escape·복귀, 폼 오류 변화 | 실제 브라우저 fixture 통과. 모든 메뉴·위젯·프레임을 포괄하는 접근성 판정기는 아님 |
| 5. 네이티브 Orca | 공통 runner/backend 규약, 실제 Orca→Speech Dispatcher 제출 hook, 정확한 X11 창·프로세스·포커스 연결, 취소·추적 실패 시 중단 | TS/30 Python 단위·프로토콜 검사 통과. DISPLAY와 D-Bus IPC 제약으로 실제 발화·오디오 검증 차단. VoiceOver/NVDA 라이브 OS 검증도 미실행 |
| 6. 실제 출력 코퍼스 | 출처·버전·명령·역할·상태별 2,914개 외부 보고 기록, coverage/unsupported, 25개 제한된 문구 회귀, 8개 학습된 버튼 template | 출처 대조와 제한된 회귀 통과. 독립 미관측 환경의 높은 정확도나 네이티브 동등성을 입증하지 못함. 알려지지 않은 패턴은 기권 |
| 7. 결정과 중단 구분 | action/success/stuck/uncertain, 별도 반복·시간 guard, 독립 성공 검증, 제한된 후보의 정지 이유 가설 | 회귀 통과. 별도 실제 0.8B 이유 선택 기록 보존. 점수는 원인·확정 결함이 아니며 결과를 바꾸거나 키를 보내지 않음 |
| 8. 동일 작업 환경 비교 | 독립 실행 matrix, 행동·성공·중단·화면·발화·포커스 차이, heuristic/모델/런타임/미지원과 출처 있는 사람의 주장 구분 | 실제 브라우저 통합 통과. 각 모델의 다른 경로는 다른 coverage이며 환경 인과로 단정하지 않음 |
| 9. CLI와 회귀·사람 근거 연결 | profile/matrix 선택, 정상·의도된 문제 fixture, AT 기록 회귀, 동의·출처·정확한 task ID가 있는 사용자/검토자 결과 import | CLI/설치본 회귀 통과. 실제 사용자 테스트는 실시하지 않았고 예제 evidence 배열은 비어 있음 |

정확한 지원 범위는 [환경 프로필](./environment-profiles.md), [Orca](./native-orca.md), [코퍼스](./screenreader-evidence.md)에 있습니다. 휴리스틱이나 모델 실패를 WCAG 결함으로 승격하지 않습니다.

## 실제 모노레포 구조

- `@rawstep/core`: 계약·프로필 schema·trace
- `@rawstep/policies`: 결정 정책·화면 모델 연결·정지 가설
- `@rawstep/browser`: 실제 브라우저·runner·verifier·프로필 진단
- `@rawstep/screenreaders`: AT Driver·Orca·시뮬레이션·코퍼스
- `@rawstep/reports`: 저장 근거 분석·보고서
- `@rawstep/cli`: CLI와 matrix 조합
- `rawstep`: 호환 export와 실행 파일

각 구현은 자기 `packages/<name>/src`와 `dist`를 소유합니다. 다른 패키지의 소스 경로를 직접 import하거나 root `src`를 공유하지 않습니다. 의존성은 비순환이며 core/policies/reports의 독립 설치에는 Playwright가 없습니다. facade 패키지의 문서·fixture는 빌드할 때 루트 원본에서 복사하는 배포 자산입니다.

7개 tarball을 함께 로컬 설치하면 npm에 게시하지 않은 내부 패키지를 내려받으려 하지 않습니다. tarball 하나만 설치할 때는 해당 manifest의 로컬 의존성 closure를 같이 제공해야 합니다. 패키지 묶음의 `INSTALL.md`, `packages.json`, `SHA256SUMS`를 참고하세요.

## 최종 검증

- Node 24.19.0, pnpm 10.12.1, TypeScript 5.9.3, Vitest 4.1.4, Playwright 1.59.1
- 실제 Chromium 147.0.7727.0, sandbox 유지, 임의 실행 플래그 없음
- 깨끗한 외부 소스 추출 경로에서 frozen-lockfile 설치, 7개 workspace 빌드, 전체 소스·테스트 타입 검사
- JS/TS 641개, 34개 파일 전체 통과. 기본 suite에서 제외하거나 skip한 브라우저 검사는 없음
- Python 30개 Orca 프로토콜·경계 단위 검사 통과. 네이티브 발화 성공이라는 뜻은 아님
- 7개 패키지를 각자의 로컬 의존성 묶음으로 외부 경로에 독립 설치하고 exports·타입·허용 배포 파일 검사 통과
- 설치된 facade 18개 exports, CLI help/version/doctor, 저장 trace 분석·HTML 보고서, 실제 WebSocket 프로토콜과 실제 Chromium 경로 통과
- 설치본의 실제 OS SIGINT/SIGTERM, trace 기록 실패 중단, 금지 행동 실패, 모의 VoiceOver/화면 모델 HTTP fixture 통합 통과
- 독립 재검토: 97개 검사/7개 파일 통과 뒤 발견한 입력 후 profile-error와 matrix 메타데이터 가림 누락을 수정하고 실제 브라우저 회귀를 추가. 가림 처리 후에도 unsupported/런타임 분류와 안전한 상대 보고서 링크를 유지
- 4B의 새 데이터 준비 helper는 기존 6개 실제 모델·tokenizer 자산의 고정 크기/SHA-256을 읽기 전용으로 재검증. 가중치나 실행 바이너리는 전달물에 포함하지 않음

최종 파일의 SHA-256, 소스 목록, 정확한 source ZIP 재추출 검사와 패치 재적용 검사는 전달 묶음의 JSON receipt와 로그에 남깁니다. 설치는 패키지 캐시를 재사용할 수 있지만 이전 checkout의 node_modules나 dist를 복사하지 않습니다. 클라우드 전용 cache/browser 경로는 검사 환경에만 지정했으며 소스 실행 경로로 하드코딩하지 않았습니다.

## 실제 모델 실험과 현재 소스의 관계

이전 단계의 실제 OneJev-4B Q4_K_M 환경 실험은 기본과 좁은 viewport+200% 텍스트에서 각각 Tab→Tab→Tab→Enter 4회로 독립 검증을 통과했습니다. 강제색 실험은 8회 결정 뒤 300초 예산을 소진해 inconclusive로 끝났습니다. 모든 저장 행동이 실제 모델 receipt와 일치함을 별도 감사했습니다.

이 모델 실행은 물리적 workspace 이동 전의 기록입니다. 당시 trace·receipt와 source hash를 보존하고 이후 진단·분류 수정 여부도 명시했습니다. 최종 이동 후 실제 브라우저/프로토콜 fixture 회귀를 다시 돌렸지만, 그 결과를 새로운 실제 모델 추론이라고 부르지 않습니다. 모델의 성능·정확도·보조공학 동등성 벤치마크로 일반화할 수 없습니다.

실제 0.8B의 별도 정지 이유 선택은 `unknown-next-action`을 골랐고 다른 후보와 근접한 점수였습니다. 이는 불확실한 모델 가설이며 원래 반복 guard의 결과를 바꾸지 않았습니다.

## 공개 사이트와 native 검증 차단

Wikipedia, GOV.UK, W3C BAD 전/후 페이지를 대상으로 읽기 전용 작업을 준비했습니다. 현재 환경의 직접 브라우저 경로는 응답 오류, 기존 허용 프록시 경로는 세 origin 모두 `ERR_CERT_AUTHORITY_INVALID`로 시작 단계에서 멈췄습니다. 프록시 경로에서는 모델 호출 0회이며 사이트 접근성 결과는 없습니다. 같은 origin의 후속 작업은 보안 장벽 뒤에 재시도하지 않았습니다.

읽기 전용 TLS 진단 결과, 프록시 인증서는 기존 실행 셸의 CA 파일에서 호스트명·체인·기간 검증을 통과했습니다. 원인은 선택한 Chromium과 프록시 CA 사이의 신뢰 저장소 차이였습니다. 웹사이트 자체 인증서가 무효이거나 접근성이 나쁘다는 결론이 아닙니다.

사용자가 수정을 승인한 뒤, 시스템 전역이나 사용자 Mac을 건드리지 않는 검사 전용 격리 NSS 저장소에 이미 검증된 클라우드 CA를 연결했습니다. TLS 검증·호스트명 확인을 유지한 실제 Chromium preflight에서 Wikipedia와 GOV.UK는 HTTP 200으로 열렸습니다. W3C의 TLS도 정상 통과했으나 HTTP 403/Cloudflare challenge가 남아 해당 작업은 진행하지 않습니다. CAPTCHA·challenge를 상호작용하거나 다른 경로로 우회하지 않습니다.

이 소스 ZIP은 정상적인 로컬 개발을 위한 것으로 클라우드 NSS DB, 임시 HOME, 브라우저 프로필이나 CA 설치를 포함하지 않습니다. 실제 모델 공개 사이트 실험은 이 소스의 최종 런타임과 동일한 별도 고정 패키지를 사용합니다. 결과·실패·제한은 함께 전달하는 `PUBLIC-RESULTS.ko.md`와 최종 공개 trace/모델 receipt/해시 대조에 기록합니다. 소스의 로컬/모의 회귀 통과를 공개 사이트 모델 성공으로 대신하지 않습니다.

Orca는 실제 공식 패키지의 의존성 import까지 확인했지만 DISPLAY가 없고 D-Bus 세션 socket은 EPERM으로 실패했습니다. 실제 bridge는 `DISPLAY_MISSING`으로 브라우저·정책 시작 전에 중단했습니다. 네이티브 speech/audio 성공을 만들거나 다른 스크린리더의 모의 결과로 대체하지 않았습니다.

## 코퍼스 정확도에 대한 결론

2,914개는 서로 다른 실제 독립 실행을 이번에 수집한 수가 아니라 출처가 있는 제3자 보고 record 수입니다. 원래 엄격한 holdout 230개는 지원되는 예측이 0개여서 정확도 정의 불가입니다. 후속 exploratory holdout은 509개 중 4개만 예측(4개 문구 일치, coverage 0.79%)했습니다. exploratory leave-one-family-out은 2,606개 중 18개 예측, 8개 일치/10개 불일치(조건부 문구 일치 44.4%, coverage 0.69%)입니다.

따라서 높은 정확도의 범용 VoiceOver/NVDA mock을 완성했다고 주장할 수 없습니다. 현재의 유용한 결과는 출처·조건·지원 범위를 실행 가능한 형태로 고정하고 미지원 항목을 숨기지 않는 것입니다. 사용자가 후속으로 요청한 독립 수집 저장소와 AT Driver 캡처 프로세스는 이 전달과 분리된 다음 작업입니다.

## 사용자가 직접 실행하기

[로컬 실행 안내](./local-development.md)를 따라 소스를 풀고 설치·빌드한 뒤 먼저 모델 없는 fixture로 확인하세요. macOS/Apple Silicon에서 직접 검증한 결과는 없으며 Linux 전용 Python wheel/Orca/runtime 명령을 Mac 공통 설치 명령으로 안내하지 않습니다. 선택적인 [4B companion 절차](../examples/screenshot/onejev4b.md)는 자산 준비·프로세스·플랫폼 제한을 별도로 설명합니다.

모든 기록은 실험용입니다. 접근성 인증, 모든 사용자에게의 사용성 보장, 모델 확률의 보정 또는 실제 스크린리더 동등성을 뜻하지 않습니다.
