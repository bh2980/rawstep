# 수정 포인트 맵

이 문서는 "무엇을 바꾸려는지"에 따라 **어느 파일부터 열어봐야 하는지**를 빠르게 찾기 위한 레퍼런스입니다.

설치 방법과 전체 사용 흐름은 `README.ko.md`, 세부 스펙은 `docs/task.ko.md`, `docs/config.ko.md`, `docs/cli.ko.md`에서 확인합니다.  
여기서는 주로 "이 변경은 어디를 고쳐야 하는가?"만 다룹니다.

---

## 보는 법

수정 목적과 가장 가까운 항목을 먼저 찾고, 표에 적힌 **원본 파일**부터 확인합니다.  
generated 파일은 직접 수정하지 않고, 원본이나 생성 스크립트를 수정한 뒤 다시 생성합니다.

---

## 수정 목적별 시작점

| 수정 목적 | 원본 파일 | 같이 볼 가능성이 큰 파일 |
|-----------|-----------|---------------------------|
| 새 키보드 키 추가 / 기본 허용 키 변경 | `packages/action-catalog/src/source.ts` → `keyboardActionSource` | `packages/action-catalog/scripts/generate.ts` |
| 새 `sr.*` 명령 추가 / backend별 지원 범위 변경 | `packages/action-catalog/src/source.ts` → `screenReaderActionSource` | `packages/definition/src/backends/`, `packages/runtime/` |
| mode 이름 / mode 정책 변경 | `packages/definition/src/modes/source.ts` → `MODE_SPEC` | `packages/config/src/run-plan/precedence.ts`, `docs/config.ko.md` |
| backend id / 플랫폼 지원 / headless 정책 변경 | `packages/definition/src/backends/source.ts` → `BACKEND_SPEC` | `packages/runtime/`, `docs/config.ko.md` |
| backend capability snapshot 갱신 | `packages/runtime/scripts/generate-backend-capabilities.ts` | `packages/definition/src/backends/generated-capabilities.ts` |
| `rawstep.config.ts` 허용 필드 변경 | `packages/config/src/project/source.ts` | `packages/config/src/project/schema.ts`, `docs/config.ko.md` |
| config 필드 검증 규칙 변경 | `packages/config/src/project/schema.ts` | `packages/config/src/project/source.ts`, `docs/config.ko.md` |
| override 우선순위 변경 | `packages/config/src/run-plan/precedence.ts` | `packages/config/src/run-plan/resolve.ts`, `docs/config.ko.md`, `docs/cli.ko.md` |
| 실행 계획 조립 방식 변경 | `packages/config/src/run-plan/resolve.ts` | `packages/config/src/run-plan/precedence.ts`, `apps/cli/src/index.ts` |
| CLI 플래그 / help 문구 변경 | `packages/config/src/run-plan/cli-manifest.ts` | `apps/cli/src/args.ts`, `docs/cli.ko.md` |
| CLI 인자 파싱 흐름 확인 | `apps/cli/src/args.ts` | `packages/config/src/run-plan/cli-manifest.ts`, `apps/cli/src/index.ts` |
| provider / model / apiKey 결정 흐름 확인 | `packages/config/src/run-plan/precedence.ts` | `apps/cli/src/index.ts`, `packages/agent/src/config.ts`, `docs/cli.ko.md` |
| task 스펙 변경 | `packages/definition/src/task/schema.ts` | `docs/task.ko.md`, 예시 task |
| verifier 규칙 변경 | `packages/definition/src/verify/` | `docs/task.ko.md`, 예시 task |
| 프롬프트 문구 변경 | `prompt/*.system.md`, `prompt/*.user.md` | `docs/prompts.ko.md`, 실행 후 `prompts.json` |
| 예시 task / fixture 변경 | `examples/tasks/`, `fixtures/` | `README.ko.md`, 관련 문서 |
| 리포트 구조 / 출력 변경 | `packages/reporter/` | `docs/report.ko.md` |

---

## 자주 있는 수정 흐름

### CLI 옵션 추가

보통 아래 순서로 함께 수정합니다.

1. `packages/config/src/run-plan/cli-manifest.ts`
2. `apps/cli/src/args.ts`
3. `packages/config/src/run-plan/precedence.ts` 또는 `packages/config/src/run-plan/resolve.ts`
4. `docs/cli.ko.md`

CLI 플래그를 추가하면 help 문구, 실제 파싱, run plan 반영, 문서까지 같이 맞춰야 합니다.

### config 필드 추가

보통 아래를 함께 봅니다.

1. `packages/config/src/project/source.ts`
2. `packages/config/src/project/schema.ts`
3. `packages/config/src/run-plan/precedence.ts`
4. `docs/config.ko.md`

타입만 추가하고 schema나 precedence를 놓치면 실제 실행에서는 값이 반영되지 않을 수 있습니다.

### action 정의 변경

action 자체를 바꾸려면 `packages/action-catalog/src/source.ts`를 수정한 뒤 다시 생성합니다.

```bash
pnpm generate:actions
```

또는 전체 빌드를 다시 돌려도 됩니다.

```bash
pnpm build
```

---

## generated 파일 규칙

아래 파일들은 대표적인 generated 결과물입니다.

- `packages/action-catalog/dist/*`
- `packages/definition/dist/*`
- `packages/config/dist/*`
- `packages/runtime/dist/*`
- `packages/definition/src/backends/generated-capabilities.ts`

이 파일들은 직접 수정하지 않습니다.  
먼저 원본 파일이나 생성 스크립트를 수정한 뒤 명령으로 다시 만듭니다.

### 자주 쓰는 명령

| 목적 | 명령 |
|------|------|
| action catalog 재생성 | `pnpm generate:actions` |
| 전체 빌드 | `pnpm build` |
| 테스트 실행 | `pnpm test` |
| backend capability snapshot 재생성 | `pnpm --filter @rawstep/runtime generate:backend-capabilities` |
| 예시 task 실행 | `pnpm rawstep run examples/tasks/simple-cta.json` |

---

## 변경 후 같이 볼 문서

코드 변경이 끝났다면 관련 문서도 함께 확인하는 편이 좋습니다.

| 변경 내용 | 같이 볼 문서 |
|----------|--------------|
| CLI 옵션 변경 | `docs/cli.ko.md` |
| config 스키마 / 우선순위 변경 | `docs/config.ko.md` |
| task 스펙 변경 | `docs/task.ko.md` |
| 리포트 출력 변경 | `docs/report.ko.md` |
| 프롬프트 구조 변경 | `docs/prompts.ko.md` |

코드만 맞고 문서가 이전 상태로 남아 있으면 다음 수정자가 가장 오래 헤맵니다.
