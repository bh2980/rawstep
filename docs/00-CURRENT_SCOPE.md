# CURRENT_SCOPE

> 이 문서는 **이번 단계의 범위를 강제**한다. 다른 모든 문서는 이 범위 안에서만 쓰인다.
> 작업을 시작하기 전과 PR 전에 스캔한다.

## 이번 단계 목표

**현재 단계**: `keyboard`, `screenreader-strict`, `screenreader-hybrid` 모드를 end-to-end로 완성하고, 로컬 fixture에 대해 trace + 최소 HTML 리포트를 생성한다.

## 포함 (v1 delivery)

**모드**
- `keyboard`
- `screenreader-strict` (기본 backend 선택은 `screenReaderBackend` 설정 기준)
- `screenreader-hybrid` (기본 backend 선택은 `screenReaderBackend` 설정 기준)

**패키지**
- `core` — 모든 타입 정의 (`ScreenReaderObservation`, `ScreenReaderCommand` 포함)
- `browser` — Playwright 세션 래퍼
- `actuator` — 화이트리스트 키 입력기
- `observer-keyboard` — screenshot 관측자
- `observer-screenreader` — screen reader backend announcement 관측자
- `agent` — AI SDK 기반 built-in provider (`anthropic` + `openai-compatible`)
- `runner` — 관측–판단–행동 루프
- `trace` — append-only TraceRecorder
- `reporter` — 최소 HTML 리포트
- `apps/cli` — 현재 CLI 바이너리 `rawstep` (프로젝트 이름은 rawstep)

**Fixtures**
- `simple-cta.html` — 10 step 이내 성공 가능
- `modal.html` — 모달 open/close/focus return
- `bad-focus.html` — focus indicator 결함, stuck 예상
- `email-login.html` — named input + submit 성공 경로

**산출물**
- `trace.jsonl` (step별 append)
- `metrics.json` (집계: result, totalSteps, durationMs, actionCounts, terminatedAtStep, failurePoint, timing breakdown)
- `prompts.json` (step별 system prompt, user prompt, 이미지 개수)
- `report/index.html` (step replay + 비용 요약 + 실패 하이라이트)
- 선택적 `experience summary` (`--include-experience-summary` 일 때만 생성)
- screenreader 리포트용 개발자 screenshot 정책 (`all | important | failure-only | none`)
 - agent memory 정책 (`--agent-memory-window`, `--agent-memory-all`)

**허용 키**
`Tab`, `Shift+Tab`, `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Enter`, `Space`, `Escape`

## 제외 (현재 단계에 포함하지 않음)

- **임의 자유 텍스트 입력** → 금지. 다만 task가 named input 값을 제공한 경우에만 제한된 text input action 허용
- **추가 backend 패키지 분리** (`@rawstep/screenreader-guidepup` 같은 형태) → 후속 단계
- **다중 세션 병렬 실행** → v3+
- **CI 통합** → v3+
- **점수화 / 등급 산출** → 영구 비목표

## 완료 기준 (이 단계가 "끝났다"를 판정하는 방식)

스스로 판정 가능한 사실 목록:

1. `pnpm install && pnpm -r build` 가 에러 없이 끝난다.
2. `pnpm rawstep run examples/tasks/simple-cta.json --mode keyboard --out ./out/simple-cta` 가 에러 없이 끝난다.
3. `out/simple-cta/trace.jsonl` 에 최소 1개 이상의 `StepRecord` 가 있다.
4. `out/simple-cta/metrics.json` 에 `result: "success"` 가 기록된다.
5. `out/simple-cta/report/index.html` 이 생성되고, 브라우저로 열었을 때 step replay가 렌더된다.
6. `pnpm rawstep run examples/tasks/bad-focus.json --mode keyboard --out ./out/bad-focus` 를 실행하면 `metrics.json` 의 `result: "failure"` 이고 `failurePoint` 가 기록된다.
7. 지원되는 backend가 있는 환경에서 `pnpm rawstep run <any> --mode screenreader-strict` 실행 시 trace와 report가 생성된다.
8. 지원되는 backend가 있는 환경에서 `pnpm rawstep run <any> --mode screenreader-hybrid` 실행 시 trace와 report가 생성된다.
9. 선택된 `screenReaderBackend` 가 현재 플랫폼에서 지원되지 않으면 명확한 환경 에러로 종료된다.
10. `packages/agent/` 에서 `page.evaluate`, `querySelector`, `activeElement`, `accessibility` 문자열이 grep 되지 않는다.

## 참고

- 상세 타입 계약: `01-CONTRACTS.md`
- 실행 루프 상세: `02-RUNTIME_LOOP.md`
- Fixture 스펙: `03-FIXTURES.md`
- 설계 불변식: `04-DECISIONS.md`
- 진행 체크리스트: `05-MILESTONES.md`
- 오늘 할 작업 한 개: `tasks/_INDEX.md` → `tasks/T-###-*.md`
