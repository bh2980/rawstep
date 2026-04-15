# Contributing 문서

이 문서는 "어디를 고쳐야 하는지"를 빠르게 찾기 위한 안내서입니다.
헷갈리기 쉬운 generated 파일 주의사항도 같이 적어둡니다.

## 수정 목적별 원본 파일

| 수정 목적 | 원본 파일 |
|-----------|-----------|
| 새 키보드 키 추가 / 기본 허용 키 변경 | `packages/action-catalog/src/source.ts` → `keyboardActionSource` |
| 새 `sr.*` 명령 추가 / backend별 지원 범위 변경 | `packages/action-catalog/src/source.ts` → `screenReaderActionSource` |
| mode 이름 / mode 정책 변경 | `packages/definition/src/modes/source.ts` → `MODE_SPEC` |
| backend id / 플랫폼 지원 / headless 정책 변경 | `packages/definition/src/backends/source.ts` → `BACKEND_SPEC` |
| backend capability snapshot 갱신 | 원본 스크립트: `packages/runtime/scripts/generate-backend-capabilities.ts` |
| `rawstep.config.ts` 허용 필드 변경 | `packages/config/src/project/source.ts` |
| config 필드 검증 규칙 변경 | `packages/config/src/project/schema.ts` |
| override 우선순위 변경 | `packages/config/src/run-plan/precedence.ts` |
| 실행 계획 조립 방식 변경 | `packages/config/src/run-plan/resolve.ts` |
| CLI 플래그 / help 문구 변경 | `packages/config/src/run-plan/cli-manifest.ts` |
| 프롬프트 문구 변경 | `prompt/*.system.md`, `prompt/*.user.md` |
| 예시 task / fixture 변경 | `examples/tasks/`, `fixtures/` |

## generated 파일 주의

generated 파일은 직접 수정하지 않습니다.
항상 원본 소스나 생성 스크립트를 수정한 뒤 다시 생성해야 합니다.

대표 예시:

- `packages/action-catalog/src/generated.ts`
  - 생성 스크립트: `packages/action-catalog/scripts/generate.ts`
- `packages/definition/src/backends/generated-capabilities.ts`
  - 생성 스크립트: `packages/runtime/scripts/generate-backend-capabilities.ts`

쉽게 말하면:

- `generated.ts`를 바로 고치면 잠깐은 맞아 보여도 다음 생성 때 다시 덮어써집니다.
- 그래서 "무엇이 원본인지"를 먼저 찾는 습관이 중요합니다.

## 문서 수정 시 같이 확인할 것

문서를 고칠 때는 글만 맞는지 보지 말고, 아래도 같이 맞춰야 합니다.

- 경로가 실제 파일 위치와 일치하는지
- 옵션 이름이 코드와 정확히 같은지
- backend 이름이 현재 구현과 같은지
- `allowedKeys`, `allowedScreenReaderActions` 목록이 현재 구현과 같은지
- generated 파일 경고가 실제 생성 구조와 맞는지

문서에서 가장 자주 틀어지는 부분은 "이름은 비슷한데 실제 코드와 한 글자 다른 경우"입니다.
그래서 문서 변경 전에 `rg`로 실제 심볼과 문자열을 다시 확인하는 편이 안전합니다.

## 작업 방식 권장

- 동작 추가는 먼저 source/schema 쪽에서 합니다.
- 생성 파일이 있다면 생성 스크립트를 다시 돌립니다.
- 테스트가 있는 영역이면 관련 테스트를 같이 봅니다.
- 문서도 같이 갱신해서 사용자가 현재 동작을 보고 따라갈 수 있게 맞춥니다.
