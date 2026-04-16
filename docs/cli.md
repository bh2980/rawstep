# RawStep CLI

---

## 빠른 시작

```bash
# 1. LLM provider 설정
export AI_PROVIDER=anthropic
export AI_API_KEY=<your-key>
export AI_MODEL=<your-model>
# export AI_BASE_URL=<your-base-url> // when openai provider

# 2. task 실행
pnpm rawstep run examples/tasks/simple-cta.json
```

실행이 끝나면 CLI가 실제 `report/index.html` 경로를 출력합니다.  
산출물은 출력 루트 아래 `/<taskId>/<runId>/` 구조로 저장됩니다. `--out`을 주면 그 디렉터리가 출력 루트가 되고, 없으면 `modes.<mode>.outDir` 또는 모드별 기본 출력 루트를 사용합니다.
런타임 내부 경고/에러가 있었던 실행만 `diagnostics.jsonl`이 추가로 생기고, CLI 출력 목록에도 그 경로가 함께 표시됩니다.

전체 옵션을 사용한 예시:

```bash
pnpm rawstep run examples/tasks/simple-cta.json \
  --config ./rawstep.config.ts \
  --mode screenreader \
  --headless \
  --max-steps 40 \
  --timeout-ms 240000 \
  --screen-reader-backend guidepup-virtual \
  --allowed-screen-reader-actions sr.next,sr.form.next,sr.heading.next,sr.act \
  --agent-memory-all \
  --include-experience-summary \
  --screenshots important \
  --include-rationale \
  --verifier-auto-complete \
  --provider <your-provider> \
  --model <your-model>
  # --base-url <your-api-url-when-openai-provider>
```

---

## 옵션 우선순위

높은 것이 낮은 것을 덮어씁니다.

```
CLI 플래그
  > task.config
    > task top-level (mode, maxSteps, timeoutMs)
      > rawstep.config.ts modes.<mode>
        > 환경 변수 (provider 관련만)
```

---

## 파라미터 레퍼런스

### 기본

| 파라미터 | 설명 | 기본값 |
|----------|------|--------|
| `<task-file>` | 실행할 task JSON 파일 경로 **(필수)** | — |
| `--config <path>` | `rawstep.config.ts` 경로 | 현재 디렉터리 탐색 |
| `--mode <keyboard\|screenreader>` | 실행 모드 강제 지정 | task 설정값 |
| `--out <dir>` | 출력 루트 디렉터리. 실제 저장 위치는 `<dir>/<taskId>/<runId>` | `modes.<mode>.outDir` 또는 모드별 기본값 |
| `--headless` / `--headed` | 브라우저 창 표시 여부 | config 또는 backend 정책 |

### 실행 제어

| 파라미터 | 설명 | 기본값 |
|----------|------|--------|
| `--max-steps <n>` | 최대 step 수 | task 설정값 |
| `--timeout-ms <n>` | 전체 실행 제한 시간(ms) | task 설정값 |
| `--verifier-auto-complete` / `--no-verifier-auto-complete` | verifier 조건 만족 시 자동 종료 | `true` |

### 스크린리더

| 파라미터 | 설명 | 기본값 |
|----------|------|--------|
| `--screen-reader-backend <backend>` | screenreader backend 강제 지정 | config 설정값 |
| `--allowed-screen-reader-actions <sr.x,...>` | 허용할 sr action subset (쉼표 구분) | 전체 허용 |
| `--screenshots <all\|important\|failure-only\|none>` | 리포트용 스크린샷 저장 정책 | config 설정값 |

### 키보드

| 파라미터 | 설명 | 기본값 |
|----------|------|--------|
| `--allowed-keys <key1,...>` | 허용할 키 subset (쉼표 구분) | 편집 계열 제외 기본 subset |

### 에이전트 메모리

| 파라미터 | 설명 | 기본값 |
|----------|------|--------|
| `--agent-memory-window <n>` | 에이전트에게 보여줄 최근 step 수 | config 설정값 |
| `--agent-memory-all` / `--no-agent-memory-all` | 누적 text memory 전체 표시 여부 | config 설정값 |
| `--include-experience-summary` / `--no-include-experience-summary` | experience summary 생성 여부 | config 설정값 |
| `--include-rationale` / `--no-include-rationale` | agent rationale 저장 여부 | config 설정값 |
| `--reasoning-effort <none\|low\|medium\|high\|xhigh>` | reasoning effort override | config 설정값 |

### LLM Provider

| 파라미터 | 설명 | 기본값 |
|----------|------|--------|
| `--provider <anthropic\|openai-compatible>` | LLM provider 강제 지정 | `AI_PROVIDER` 환경 변수 |
| `--model <id>` | 모델 ID 강제 지정 | `AI_MODEL` 환경 변수 |
| `--base-url <url>` | OpenAI-compatible provider base URL | `AI_BASE_URL` 환경 변수 |

> **주의:** `--allowed-keys`와 `--allowed-screen-reader-actions`로 값을 override하면, `rawstep.config.ts`에 설정된 `hint`는 프롬프트에 전달되지 않습니다. `hint`는 CLI에서 설정할 수 없으며 `rawstep.config.ts`의 `kb.*` / `sr.*` helper를 통해서만 설정됩니다.

---

## LLM Provider 설정

### 환경 변수

```bash
# Anthropic
export AI_PROVIDER=anthropic
export AI_API_KEY=<your-key>
export AI_MODEL=<your-model>

# OpenAI-compatible
export AI_PROVIDER=openai-compatible
export AI_API_KEY=<your-key>
export AI_MODEL=<your-model>
export AI_BASE_URL=https://your-openai-compatible-base-url
```

CLI는 `rawstep.config.ts`와 같은 디렉터리의 `.env` 파일을 자동으로 읽습니다. 셸에 이미 설정된 환경 변수는 덮어쓰지 않습니다.

### provider 값 fallback 순서

각 값은 다음 순서로 결정됩니다:

| 값 | 순서 |
|----|------|
| `provider` | `--provider` → `defaults.provider` → `AI_PROVIDER` |
| `apiKey` | `defaults.apiKey` → `AI_API_KEY` |
| `model` | `--model` → `defaults.model` → `AI_MODEL` |
| `baseURL` | `--base-url` → `defaults.baseURL` → `AI_BASE_URL` |

---

## 허용 키 전체 목록

`keyboard` 모드의 `allowedKeys` / `--allowed-keys`에 사용할 수 있는 키 목록입니다.

```
Tab  Shift+Tab  Home  End
ArrowUp  ArrowDown  ArrowLeft  ArrowRight
Enter  Shift+Enter  Space  Escape
Backspace  Delete
Mod+A  Mod+Backspace  Mod+Delete  Mod+Z  Mod+Shift+Z
```

**기본 허용 subset** (편집 계열 키 제외):

```
Tab  Shift+Tab  Home  End
ArrowUp  ArrowDown  ArrowLeft  ArrowRight
Enter  Space  Escape
```

---

## 허용 스크린리더 action 전체 목록

`allowedScreenReaderActions` / `--allowed-screen-reader-actions`에 사용할 수 있는 stable `sr.*` 목록입니다. backend마다 실제 지원 subset이 다르며, 지원 여부는 `@rawstep/action-catalog` 기준으로 판정합니다.

**기본 탐색**

```
sr.next  sr.previous  sr.act
sr.interact  sr.stopInteracting
```

**키보드 입력**

```
sr.key.arrow.up  sr.key.arrow.down  sr.key.arrow.left  sr.key.arrow.right
sr.key.enter  sr.key.space  sr.key.escape
```

**요소 유형별 이동**

```
sr.heading.next  sr.heading.previous
sr.form.next      sr.form.previous
sr.button.next    sr.button.previous
sr.landmark.next  sr.landmark.previous
```

실제로 어떤 액션을 허용할지는 `rawstep.config.ts`와 task override가 결정합니다.  
현재 repo 기본 설정은 [rawstep.config.ts](/Users/bh2980/Desktop/a11y/rawstep.config.ts:74) 기준으로 더 좁은 subset만 씁니다.
