# CLI 문서

RawStep CLI의 기본 명령은 아래와 같습니다.

```bash
rawstep run <task-file> [options...]
```

쉽게 말하면:

- task 파일이 기본 입력
- config는 프로젝트 기본값
- CLI 플래그는 이번 실행에서만 강제로 덮어쓰기

관련 문서:

- task 구조는 [task.md](./task.md)
- config 우선순위와 mode preset은 [config.md](./config.md)

## 옵션 전체 표

| 옵션 | 설명 |
|------|------|
| `<task-file>` | 실행할 task JSON 파일 경로 |
| `--config <rawstep.config.ts>` | 사용할 config 파일 경로 |
| `--mode <keyboard\|screenreader>` | 실행 mode 강제 지정 |
| `--out <dir>` | 결과 출력 디렉터리 강제 지정 |
| `--headless` / `--headed` | 브라우저 창 표시 여부 |
| `--screenshots <all\|important\|failure-only\|none>` | 개발자용 스크린샷 저장 정책 |
| `--max-steps <n>` | 최대 step 수 |
| `--timeout-ms <n>` | 전체 제한 시간(ms) |
| `--screen-reader-backend <backend>` | screenreader backend 강제 지정 |
| `--allowed-keys <key1,key2>` | 허용할 키 subset. keyboard 모드 전용 |
| `--allowed-screen-reader-actions <sr.x,sr.y>` | 허용할 `sr.*` subset |
| `--verifier-auto-complete` / `--no-verifier-auto-complete` | verifier 자동 확인 여부 |
| `--agent-memory-window <n>` | 최근 step memory 개수 |
| `--agent-memory-all` / `--no-agent-memory-all` | text memory 전체 사용 여부 |
| `--include-experience-summary` / `--no-include-experience-summary` | experience summary 생성 여부 |
| `--include-rationale` / `--no-include-rationale` | rationale 저장 여부 |
| `--provider <anthropic\|openai-compatible>` | provider 강제 지정 |
| `--model <id>` | 모델 ID 강제 지정 |
| `--base-url <url>` | OpenAI-compatible provider base URL |

## 대표 실행 예시

```bash
pnpm rawstep run examples/tasks/simple-cta.json \
  --config ./rawstep.config.ts \
  --mode screenreader \
  --headless \
  --max-steps 40 \
  --timeout-ms 240000 \
  --screen-reader-backend guidepup-virtual \
  --allowed-screen-reader-actions sr.key.tab,sr.key.enter,sr.next,sr.act \
  --agent-memory-window 5 \
  --include-experience-summary \
  --screenshots important \
  --include-rationale \
  --verifier-auto-complete \
  --provider openai-compatible \
  --model openrouter/auto \
  --base-url https://openrouter.ai/api/v1
```

## Provider 환경 변수

```bash
# Anthropic
export AI_PROVIDER=anthropic
export AI_API_KEY=your-key
export AI_MODEL=your-model-id

# OpenAI-compatible
export AI_PROVIDER=openai-compatible
export AI_API_KEY=your-key
export AI_MODEL=your-model-id
export AI_BASE_URL=https://your-openai-compatible-base-url
```

provider 관련 fallback 순서:

- `provider`: `--provider` → `defaults.provider` → `AI_PROVIDER`
- `apiKey`: `defaults.apiKey` → `AI_API_KEY`
- `model`: `--model` → `defaults.model` → `AI_MODEL`
- `baseURL`: `--base-url` → `defaults.baseURL` → `AI_BASE_URL`

CLI는 `rawstep.config.ts` 옆의 `.env` 파일을 자동으로 읽고, 이미 셸에 있는 환경 변수는 덮어쓰지 않습니다.

## 허용 키보드 키 전체 목록

`allowedKeys`, `--allowed-keys`에 넣을 수 있는 keyboard 키 목록입니다.

```text
Tab  Shift+Tab  Home  End
ArrowUp  ArrowDown  ArrowLeft  ArrowRight
Backspace  Delete
Enter  Shift+Enter  Space  Escape
Mod+A  Mod+Backspace  Mod+Delete  Mod+Z  Mod+Shift+Z
```

기본 허용 subset:

```text
Tab  Shift+Tab  Home  End
ArrowUp  ArrowDown  ArrowLeft  ArrowRight
Enter  Space  Escape
```

## 허용 스크린리더 action 전체 목록

`allowedScreenReaderActions`, `--allowed-screen-reader-actions`에 넣을 수 있는 stable public `sr.*` 목록입니다.
backend별 실제 지원 범위는 다를 수 있습니다.

```text
sr.next  sr.previous  sr.act
sr.interact  sr.stopInteracting  sr.type  sr.click

sr.key.tab  sr.key.shiftTab  sr.key.home  sr.key.end
sr.key.arrow.up  sr.key.arrow.down  sr.key.arrow.left  sr.key.arrow.right
sr.key.enter  sr.key.shiftEnter  sr.key.space  sr.key.escape
sr.key.backspace  sr.key.delete
sr.key.mod.a  sr.key.mod.backspace  sr.key.mod.delete
sr.key.mod.z  sr.key.mod.shiftZ

sr.heading.next  sr.heading.previous
sr.heading.level.{1~6}.next  sr.heading.level.{1~6}.previous

sr.form.next  sr.form.previous
sr.link.next  sr.link.previous
sr.button.next  sr.button.previous
sr.landmark.next  sr.landmark.previous
sr.list.next  sr.list.previous
sr.table.next  sr.table.previous

sr.read.itemText  sr.read.itemTextLog
sr.read.lastSpokenPhrase  sr.read.spokenPhraseLog
sr.clear.itemTextLog  sr.clear.spokenPhraseLog
```

주의:

- 실제로 어떤 action이 동작하는지는 backend capability에 따라 달라집니다.
- 그래서 문법상 허용되는 것과, 현재 backend가 실제 지원하는 것은 다를 수 있습니다.

## 자주 헷갈리는 점

- `--allowed-keys`는 keyboard 모드 전용입니다.
- `--screen-reader-backend`는 screenreader 모드에서만 의미가 있습니다.
- `--headless`를 줘도 backend가 headed를 강제하면 오류가 납니다.
- CLI 플래그가 가장 우선순위가 높습니다.
