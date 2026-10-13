# CLI 안내

`rawstep` 패키지를 설치하면 `npx rawstep`으로 명령을 쓸 수 있습니다. 소스 체크아웃에서는 빌드 후 `npm run rawstep -- <명령>`을 사용합니다. 설정은 모두 프로젝트의 `rawstep.config.json`에 있으며 대시보드와 같은 파일을 읽습니다. 필드는 [설정 안내](./config.ko.md)를 참고하세요. 모든 명령의 옵션은 `rawstep --help`에서 볼 수 있습니다.

## 명령

| 명령 | 하는 일 |
|---|---|
| `rawstep init [--project <dir>]` | 기본 `rawstep.config.json`을 만듭니다(실행 프로필 하나, 연결·작업 없음). 이미 있는 파일은 덮어쓰지 않습니다 |
| `rawstep ui [--port <port>] [--project <dir>]` | 로컬 대시보드를 `127.0.0.1`(기본 포트 4318)에서 엽니다. 설정 파일이 없으면 만듭니다 |
| `rawstep run <task> [옵션]` | 실행 프로필(모델, 허용 행동, 페이지 환경, 스크린리더, 실행 규칙)로 작업을 실행하고 조건, 결과, 발견 사항을 출력합니다 |
| `rawstep hints <run-dir> [--reference <run-dir>]` | 저장된 실행의 마찰 힌트를 출력하고 `hints.json`을 씁니다 |
| `rawstep report <run-dir> [--analysis <analysis.json>] [--out <dir>]` | `report.html`과 `report.json`을 만듭니다 |
| `rawstep analyze <run-dir> [--llm] [--out <dir>] [--project <dir>]` | 저장된 실행을 분석합니다 |
| `rawstep doctor [--project <dir>]` | 환경을 점검합니다 |

## run

```sh
rawstep run <task> [--profile <id|name>] [--mode keyboard|screenreader]
                   [--rule <name>=<value>]... [--diagnose-stop]
                   [--repeat <n>] [--out <dir>] [--json] [--project <dir>]
```

`<task>`는 `rawstep.config.json`에 등록한 작업 id이거나 작업 JSON 파일 경로입니다. 상대 경로는 프로젝트 폴더 기준이며, 등록하지 않은 파일은 프로젝트의 첫 번째 프로필로 실행합니다. 매 단계는 프로필의 그 모드 실행 모델이 결정하며(계획 + 실행 구조의 스크린리더 모드에서는 계획 모델도 함께), 실행 모델이 없는 모드는 실행할 수 없습니다. [실행 프로필](./config.ko.md#실행-프로필)이 실행을 바꾸는 모든 것을 담으므로, 모델이나 프롬프트, 사용자가 할 수 있는 행동, 페이지 조건, 시뮬레이션과 네이티브 스크린리더를 비교하려면 그 부분만 다른 프로필을 만들어 같은 작업을 각각 실행합니다. 작업 파일 형식은 [작업 안내](./task.ko.md)에 있습니다.

기본값은 다음과 같습니다.

- `--profile`: 실행 프로필의 id나 이름. 없으면 작업에 지정한 프로필, 없으면 프로젝트의 첫 번째 프로필. 키보드 모드는 이미지 입력(`maxImages` 2 이상)을, 스크린리더 모드는 텍스트 입력을 받는 실행 모델이 필요합니다
- `--mode`: `keyboard`
- `--rule`: 없음. `--rule <이름>=<값>`으로 [실행 규칙](./config.ko.md#runrules-실행-규칙) 하나를 그 실행에서만 덮어씁니다. 예: `--rule maxReplans=2 --rule survey=headings`. 여러 규칙은 옵션을 반복해 지정하고, 같은 규칙을 두 번 쓰면 마지막 값이 적용됩니다. 숫자, `true`·`false`, 규칙이 허용하는 선택지는 설정 파일과 같은 기준으로 검사합니다
- `--diagnose-stop`: 꺼짐. 키보드 모드 전용이며, 일찍 멈춘 실행 뒤에 실행 모델에게 이유를 따로 한 번 묻습니다. 점수는 불확실한 가설이며 결과를 바꾸지 않습니다
- `--repeat`: 1(최대 100). 반복 실행의 힌트는 목표에 도달한 가장 빠른 실행과 비교합니다
- `--out`: `<프로젝트>/.rawstep/runs/<시각>-<짧은 id>/`. 반복마다 `run-<n>/` 폴더가 생깁니다

`--rule`은 그 실행에서만 실행 규칙을 덮어씁니다(프로필의 규칙 위에 이 옵션). 덮어쓰지 않은 실행 규칙은 설정 파일이나 대시보드에서 정합니다.

출력은 실행 조건, 실행별 블록, 전체 실행에서 모은 발견 사항으로 이루어집니다.

```text
Conditions: Plan with GPT, act with Jev (planned · planner OpenAI · gpt-5 → executor Jev · jev-latest)
  page narrow · screen reader simulation

Run 1 of 2: goal reached · 7 steps
  <run 폴더 경로>
Run 2 of 2: goal not reached (<이유>) · 20 steps
  <run 폴더 경로>

Page
  button "Add to cart" · focus lost · 2 of 2 runs
Model
  link "Skip to content" · repeated state · 1 of 2 runs
```

실행 결과는 `goal reached`, `goal not reached (이유)`, `inconclusive`, `no outcome recorded` 중 하나입니다. 발견 사항은 `Page`, `Run`, `Model`로 묶이고 한 줄이 `<role "이름"> · <종류> · <n> of <N> runs` 형식입니다. Rawstep은 통과/실패 도구가 아니므로 목표에 도달하지 못해도 종료 코드는 0입니다. `--json`을 주면 같은 정보를 `{ conditions, warnings, runs: [{ runId, outDir, outcome, hints }], findings }` JSON으로 출력합니다.

### run 폴더

| 파일 | 내용 |
|---|---|
| `trace.json`, `trace.jsonl`, `blobs/` | 실행 기록. 스크린샷은 `blobs/<sha256>.png`로 한 번만 저장합니다 |
| `hints.json` | 마찰 힌트 |
| `analysis.json` | 분석. 규칙 기반 분석은 실행 후 항상 만들고, 프로젝트에 분석 모델이 있으면 LLM 분석이 더해집니다(키가 없으면 규칙 기반 분석만 하고 알림을 남깁니다) |
| `diagnostics/step-<n>.png` | 스크린리더 실행의 단계별 참고 스크린샷. 사람이 볼 용도이며 모델은 받지 않습니다 |
| `plan.json`, `plan.md` | 계획 + 실행 구조의 실행에서만. 최종 계획 문서(`plan.md`는 사람이 읽는 체크박스 형식, [계획과 실행](./config.ko.md#계획과-실행-orchestration)) |
| `report.html`, `report.json` | 보고서([보고서 안내](./report.ko.md)) |

## hints, report, analyze

`hints`는 힌트 수, 목표 달성 여부, 단계 수(`--reference`를 주면 기준 실행의 단계 수 포함)와 힌트별 한 줄을 출력합니다. 힌트는 사람이 확인해 볼 단계를 가리킬 뿐 통과/실패 판정이 아닙니다.

`analyze`는 `--llm` 없이 실행하면 네트워크를 쓰지 않는 로컬 규칙 기반 요약을 만듭니다. `--llm`을 주면 프로젝트의 분석 모델(`project.analysis.model`, LLM)에게 저장된 이벤트를 보내 분석하며, PNG 바이트는 보내지 않습니다. 두 경우 모두 `hints.json`을 함께 씁니다. `report`는 `analysis.json`을 `--analysis`로 지정하면 보고서에 포함합니다.

## doctor

Node 버전, `rawstep.config.json`을 읽을 수 있는지, 브라우저를 실행할 수 있는지, 각 연결의 키 환경변수가 설정되어 있는지(값은 출력하지 않습니다)를 확인합니다. 프로필이 `voiceover`나 `nvda` 스크린리더를 쓰면 그 AT Driver 엔드포인트의 응답도 확인합니다. 점검이 하나라도 실패하면 종료 코드 1입니다. 이는 연결과 설정만 확인하며 실제 음성 출력이나 네이티브 환경 준비를 보장하지 않습니다.

## 종료 코드

| 코드 | 의미 |
|---|---|
| 0 | 실행이 끝났습니다(목표 달성 여부와 무관) |
| 1 | 오류(설정 파일 없음, 실행 모델이 없는 프로필, 지원하지 않는 행동·조건, 키 누락, 예전 설정 버전, 실행 실패, `doctor` 점검 실패) |
| 2 | 잘못된 사용법 |
| 130 / 143 | SIGINT(Ctrl+C) / SIGTERM으로 취소. 그때까지 쓴 trace는 보존합니다 |

## 인증 정보

API 키는 `rawstep.config.json`에 저장하지 않습니다. 연결 제공자의 환경변수(`RAWSTEP_OPENAI_API_KEY`, `RAWSTEP_TYPESAFE_API_KEY` 등, [설정 안내](./config.ko.md) 참고. `custom` 연결은 `apiKeyEnv`로 직접 지정)를 프로세스 환경 또는 프로젝트의 `.env.local`에서 읽으며, 대시보드가 입력받은 키도 `.env.local`(권한 0600)에 씁니다. `.env.local`은 커밋하지 마세요.

## 개인정보

스크린샷에는 페이지의 개인 정보가 담길 수 있습니다. 모델은 픽셀, 목표, 이름 있는 입력 키와 행동 기록만 받고 DOM이나 독립 검증 결과는 받지 않습니다. 저장된 trace에서는 입력값을 가립니다. 이전 결과를 덮어쓰지 않도록 실행마다 새 출력 폴더를 만들며, 실행 결과는 `.rawstep/`에 쌓이므로 git에서 제외하세요.

## runTask

같은 실행을 코드에서 부를 수 있습니다. 기본값은 `rawstep run`과 같고 `projectDir`의 기본값은 현재 폴더입니다.

```ts
import { runTask } from 'rawstep';

const { runs, findings } = await runTask('checkout', { repeat: 3, mode: 'keyboard' });
```

옵션은 `projectDir`, `profile`(id나 이름), `runRules`(그 실행에만 쓰는 덮어쓰기), `diagnoseStop`, `mode`, `repeat`, `outDir`, `signal`, `onEvent`입니다. 실행이 끝나면 목표 달성 여부와 무관하게 `{ conditions, warnings, runs, findings }`로 이행하고(`runs[n].hints.goalReached`와 `hints.steps`로 확인), 설정 문제와 취소는 `.code`를 가진 `ProjectError`로 거부됩니다. 저수준 실행기는 `rawstep/runner`의 `runTask`입니다.
