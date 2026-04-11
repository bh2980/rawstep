# CURRENT_SCOPE (v1)

> 이 문서는 **이번 단계의 범위를 강제**한다. 다른 모든 문서는 이 범위 안에서만 쓰인다.
> 작업을 시작하기 전과 PR 전에 스캔한다.

## 이번 단계 목표

**v1**: `keyboard` 모드 하나로 관측–판단–행동 루프를 end-to-end로 완성하고, 3개의 로컬 fixture에 대해 trace + 최소 HTML 리포트를 생성한다.

## 포함 (v1 delivery)

**모드**
- `keyboard` only

**패키지**
- `core` — 모든 타입 정의 (`ScreenReaderObservation` 포함 — 타입만 선언, 구현 없음)
- `browser` — Playwright 세션 래퍼
- `actuator` — 화이트리스트 키 입력기
- `observer-keyboard` — screenshot 관측자
- `agent` — Anthropic `claude-opus-4-6` 어댑터
- `runner` — 관측–판단–행동 루프
- `trace` — append-only TraceRecorder
- `reporter` — 최소 HTML 리포트
- `apps/cli` — `a11y-task` 바이너리

**Fixtures**
- `simple-cta.html` — 10 step 이내 성공 가능
- `modal.html` — 모달 open/close/focus return
- `bad-focus.html` — focus indicator 결함, stuck 예상

**산출물**
- `trace.jsonl` (step별 append)
- `metrics.json` (집계: totalSteps, totalKeystrokes, reachedGoal, failurePoint)
- `report/index.html` (step replay + 비용 요약 + 실패 하이라이트)

**허용 키**
`Tab`, `Shift+Tab`, `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Enter`, `Space`, `Escape`

## 제외 (v1에 포함하지 않음)

- **`screenreader` 모드** → v2 (Guidepup VoiceOver). `--mode screenreader` 지정 시 명시적 에러.
- **`observer-screenreader` 패키지** → v2에서 신설. v1에서는 파일/폴더 생성하지 않음.
- **자유 텍스트 입력** → 입력 필요 폼은 "blocked" step으로 기록
- **Oracle 자동 검증** → v3+
- **NVDA** → v3+
- **다중 세션 병렬 실행** → v3+
- **CI 통합** → v3+
- **점수화 / 등급 산출** → 영구 비목표

## 완료 기준 (이 단계가 "끝났다"를 판정하는 방식)

스스로 판정 가능한 사실 목록:

1. `pnpm install && pnpm -r build` 가 에러 없이 끝난다.
2. `pnpm a11y-task run examples/tasks/simple-cta.yml --mode keyboard --out ./out/simple-cta` 가 에러 없이 끝난다.
3. `out/simple-cta/trace.jsonl` 에 최소 1개 이상의 `StepRecord` 가 있다.
4. `out/simple-cta/metrics.json` 에 `reachedGoal: true` 가 기록된다.
5. `out/simple-cta/report/index.html` 이 생성되고, 브라우저로 열었을 때 step replay가 렌더된다.
6. `pnpm a11y-task run examples/tasks/bad-focus.yml --mode keyboard --out ./out/bad-focus` 를 실행하면 `metrics.json` 의 `reachedGoal: false` 이고 `failurePoint` 가 기록된다.
7. `pnpm a11y-task run <any> --mode screenreader` 는 명시적 에러로 종료 (v2 안내 포함).
8. `packages/agent/` 에서 `page.evaluate`, `querySelector`, `activeElement`, `accessibility` 문자열이 grep 되지 않는다.

## 참고

- 상세 타입 계약: `01-CONTRACTS.md`
- 실행 루프 상세: `02-RUNTIME_LOOP.md`
- Fixture 스펙: `03-FIXTURES.md`
- 설계 불변식: `04-DECISIONS.md`
- 진행 체크리스트: `05-MILESTONES.md`
- 오늘 할 작업 한 개: `tasks/_INDEX.md` → `tasks/T-###-*.md`
