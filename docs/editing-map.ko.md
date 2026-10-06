# 소스 수정 위치

실제 구현은 엔진 패키지, 공용 `@rawstep/project` 패키지, 비공개 dashboard workspace로 나뉩니다. `rawstep`은 게시되는 유일한 패키지로, `src/`에는 실행 파일과 reexport만 있고 `tsdown`이 모든 workspace를 번들합니다. 나머지 workspace는 모두 `private`입니다.

| 책임 | 위치 |
|---|---|
| 작업·행동·관찰 계약, trace, 프로필 스키마 | `packages/core/src/` |
| 정책 로딩·스크립트·화면 모델·정지 가설 | `packages/policies/src/` |
| 브라우저·탐색 경계·runner·독립 검증·프로필 적용 | `packages/browser/src/` |
| AT Driver·Orca·VoiceOver 시뮬레이션·코퍼스 | `packages/screenreaders/src/` |
| 선택적인 Python Orca 브리지 | `packages/screenreaders/native/` |
| 사후 분석·보고서·화면 상태 요약 | `packages/reports/src/` |
| `rawstep.config.json` 스키마·스토어·실행 계획/실행·`runTask`·모델 탐색·LLM | `packages/project/src/` (`config.ts`, `store.ts`, `plan.ts`, `execution.ts`, `run.ts`, `discover.ts`, `llm.ts`) |
| CLI 명령 | `packages/cli/src/` |
| `rawstep` 실행 파일과 `rawstep/*` 하위 경로 import(번들 entry), `tsdown.config.ts` | `packages/rawstep/src/` |
| 로컬 dashboard UI·shadcn 컴포넌트·JSON UI 카탈로그 | `packages/dashboard/src/` |
| 공개 API 루트(명시적 export 목록)와 패키지 내부 헬퍼(`src/internal/`) | `packages/*/src/index.ts` (`tests/public-api.test.ts`로 고정) |
| 빌드·패키지 묶음·격리 설치·소스 재현 검사 | 루트 `scripts/` |

예제와 fixture는 루트 `examples/`, `fixtures/`에 유지합니다. 모델 가중치·Python 환경·브라우저·네이티브 AT 서버는 자동으로 포함하거나 설치하지 않습니다. 코퍼스 생성 결과를 수동으로 유리하게 바꾸지 말고 근거와 생성·평가 절차를 보존하세요.

`npm run check`는 빌드·타입·테스트 전체와7개 패키지의 로컬 의존성 격리 설치를 확인합니다. `npm run test:source`는 깨끗한 외부 경로에서 소스 재현을 확인합니다. sibling 패키지의 소스를 직접 가리키는 path alias로 격리 설치 실패를 숨기지 않습니다. 자세한 실행법은 [로컬 개발 안내](./local-development.md)를 참고하세요.
