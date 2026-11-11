# 실제 VoiceOver 실행 엔진 검증

목적은 현재 Rawstep 엔진이 실제 VoiceOver로 시작·조작·관측·완료 판정·정리를 수행하는지 확인하는 것이다. 모델의 태스크 성공률, 시뮬레이터와의 발화 일치율, 실제 사용자의 사용성은 이 실험의 판정 대상이 아니다.

## 실행

준비된 Tart VM의 터미널에서 실행한다. 호스트 macOS에서 `run`을 실행하면 키를 보내기 전에 거부한다.

```sh
cd ~/rawstep-native-validation
export PATH="/opt/homebrew/bin:$PATH"
pnpm native:voiceover check
pnpm native:voiceover run
```

`check`는 브라우저나 AT Driver 세션을 열지 않는다. 설정·태스크·고정 계획과 지원 범위를 검사하고, `artifacts/native-voiceover/prepared/`에 일반 Rawstep 프로젝트를 만든다. `run`은 별도의 새 결과 폴더를 만들고 실험을 직렬 실행한다. 기존 Rawstep 프로젝트, 로그인 정보, 브라우저 프로필은 사용하지 않는다.

처음에는 S01→S02→S03 순으로 각 3회 실행한다. 이 중 하나라도 통과하지 못하면 나머지를 실행하지 않고 기록을 보존한다. 이후 흐름 검사, 엔진의 멈춤 검사, 오류 주입과 복구, 오프라인 계약 검사를 수행한다. 총 **20개 케이스, 68개 예정 검사**이다. 오류 4종의 각 반복 뒤에 S01을 추가로 실행해 다음 태스크를 실행할 수 있는지 확인한다.

```sh
# 1회씩 짧게 실행하거나, 실패한 케이스만 재현
pnpm native:voiceover run --phase smoke --repeats 1
pnpm native:voiceover run --only W01-input --repeats 1

# 단계별 실행: workflow, limit, fault, contract, all
pnpm native:voiceover run --phase workflow --repeats 3
```

## 계획 모델로 돌리기

기본 실행은 손으로 쓴 고정 계획이라 실행 엔진만 검증한다. 모델이 실제 발화를 듣고 계획하는지는 `--planner grok`으로 따로 본다. VM에서 Grok CLI에 로그인되어 있어야 한다.

```sh
pnpm native:voiceover run --planner grok --repeats 1
```

- S, W, L 케이스 14개만 돈다. 모델에게는 사람이 원하는 목표 문장(`userGoal`)과 입력의 이름만 주고, 키나 탐색 방법은 주지 않는다.
- 오류 주입과 계약 검사 6개는 돌지 않는다. 모델이 계획하면 일부러 만든 실패 상황이 재현되지 않고, 이미 고정 계획으로 검증했다.
- 프로필은 제품 기본 규칙을 쓴다. 먼저 제목 목록을 읽고(`survey: headings`), `typeText`와 `replaceText`를 모두 허용한다.
- 모델은 `grok-4.7`, 추론 강도는 `low`다. 이 VM에서 계획 호출 1번이 기본 강도 `high`로는 168~253초, `low`로는 약 70초 걸렸다. 연결의 제한 시간은 300초로 둔다.
- 고정 계획에서 나오는 검사(어떤 행동, 어떤 단서, 어떤 로터, 실패한 행동, `확인 안 됨` 여부)는 적용하지 않고 기록만 남긴다. 대신 모델이 실제로 계획했는지(`planned-by-the-model`)를 본다.
- 모델이 목표를 놓친 것은 결과이지 실행 고장이 아니므로 다음 케이스로 넘어간다. 실패한 시도는 `trace.json`을 읽어 모델 판단 때문인지 엔진 때문인지 가른다.

다른 체크아웃에서 준비하려면 저장소 루트에서 `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm exec playwright install --no-shell chromium`, `pnpm native:voiceover check` 순서로 실행한다. Native 실험에는 창이 있는 Chromium을 사용한다. 빌드 후 원본 코드를 바꿨다면 다시 빌드한다.

## 실행 전 조건

- macOS Tart VM의 GUI 로그인 세션. VoiceOver와 AT Driver 서비스가 켜져 있고, 기본 음성은 `MacOSATDriverServerExtensionVoice`.
- 영어 US 음성, US 키보드, Control+Option 수정 키, 기본 단축키. Quick Nav는 끄고 키보드 포커스와 VoiceOver 커서 추적을 켠다.
- Node의 손쉬운 사용 및 System Events 자동화 권한. VM 설치 단계에서 허용한 실행 파일을 사용한다.
- 같은 데스크톱에서 다른 키보드·마우스 조작을 하지 않는다. 브라우저는 엔진이 새로 연다. 첫 실험 전에 사람이 브라우저 포커스나 VoiceOver 커서를 맞춰 주지 않는다.
- VM을 다시 켜면 AT Driver는 자동으로 뜨지만 VoiceOver는 꺼져 있다. `open /System/Library/CoreServices/VoiceOver.app`으로 켠다. 꺼져 있으면 `run`이 키를 보내기 전에 거부한다.

### VoiceOver의 페이지 진입

실제 VoiceOver의 커서는 페이지가 열려도 브라우저 자체의 컨트롤에 머물 수 있다. 연결한 Chrome처럼 VoiceOver가 혼자 들어가 페이지를 읽기 시작할 때도 있다. 그래서 엔진이 시작할 때와 새 문서가 열릴 때마다 VoiceOver 커서가 어디 있는지 화면 좌표로 확인한다. 이미 페이지 안이면 누르지 않고, 웹 콘텐츠 위면 안으로 들어가고(`interact`), 브라우저 컨트롤에 있으면 웹 콘텐츠 위에 올 때까지 `next`를 누른 뒤 들어간다. 결과는 `screen-reader.page-entry`로 남긴다. 사용자의 이동으로 세지 않으며 계획에도 쓰지 않는다. 모의 VoiceOver에는 브라우저 창이 없어 이 단계가 없다.

웹 콘텐츠 위가 아닌 곳에서 `interact`를 누르면 그 자리의 항목으로 들어간다. 탭 그룹에서는 탭의 닫기 버튼에 닿아, 이어서 활성화하면 탭이 닫힌다. 그래서 들어가기 전과 후에 커서 위치를 확인한다. 위치는 발화가 아니라 화면에서 읽으므로 음성 언어와 상관없다. VoiceOver의 "AppleScript로 VoiceOver 제어 허용"과, 실행하는 앱이 VoiceOver와 System Events를 제어하는 자동화 권한이 필요하다.

`heading.previous`·`form.previous`·`link.previous`는 키가 아니라 VoiceOver 명령(`find previous heading/control/link`)을 AppleScript로 실행한다. AT Driver 서버가 보내는 VO+Command+Shift+H/J/L을 VoiceOver 키보드 도움말(VO+K)로 확인하면 Find Next로 인식된다. 같은 키를 하드웨어 입력 단계로 보내면 Find Previous로 인식되므로, 키가 아니라 서버의 Shift 전달 방식이 문제다.

하드웨어 모델, macOS, Node, 브라우저 실행 파일, 읽을 수 있는 키보드·VoiceOver 저장 설정을 `results.json`에 기록한다. 이 기록으로 실제 Quick Nav 상태나 모든 설정을 확인했다고 주장하지 않는다. 위 조건이 다르면 그 사실을 결과와 함께 기록하고, 결과 폴더를 바꿔 재실행한다. 설정을 중간에 바꿔 얻은 결과를 한 배치로 합치지 않는다.

## 검사 목록

| 케이스 | 검증 내용 | 기대하는 엔진 결과 |
|---|---|---|
| S01-button | 항목 탐색 → 버튼 활성화 → 페이지 완료 | success |
| S02-heading | 제목 탐색 → 버튼 활성화 | success |
| S03-navigation | 링크 탐색 → 다른 문서로 이동 → 완료 안내까지 이동 | success, 2개 문서 진입 |
| W01-input | 필드 탐색 → ASCII 입력 → 제출 | success |
| W02-replace | OLD를 TEST42로 교체 → 제출 | success |
| W03-form | 두 입력을 각각 입력 → 제출 | success |
| W04-dialog | 모달 열기 → 바뀐 포커스에서 닫기 | success + 확인 안 됨 (닫을 때 VoiceOver는 돌아온 포커스만 읽음) |
| W05-headings-rotor | 제품의 초기 제목 로터 조사로 목록 읽기 → 탐색 → 완료 | success, Down 키 전송 |
| W06-form-rotor | 폼 컨트롤 로터 → 필드 선택 → 입력 → 제출 | success, Return 키 전송 |
| W07-delayed | 활성화 1.5초 뒤 페이지 완료와 발화 수집 | success + 완료 발화 |
| W08-late | 활성화 4.5초 뒤 페이지 완료와 발화 수집 | success + 완료 발화 |
| W09-silent | live region이 없는 완료 상태와 발화 여부 구분 | success + 확인 안 됨 |
| W10-next-page | 링크로 다음 문서로 이동 → 그 문서에서 작업을 이어서 완료 | success, 2개 문서 진입 |
| L01-missing-target | 기본 규칙으로 없는 대상을 찾아 페이지 끝까지 이동 | failure / policy-stuck, 포기 |
| F01-timeout | 없는 단서를 계속 찾다가 실제 20초 기한 만료 | inconclusive / timeout |
| F02-cancel | 첫 Native 이동 완료 후 취소 | aborted |
| F03-disconnect | 첫 Native 이동 완료 후 이 실행의 연결만 끊기 | failure / error |
| F04-focus-loss | 첫 키 전송 전에 Finder 활성화 | harness가 전송 차단, aborted |
| C01-simulation-only | readCurrent를 Native 프로필에 허용 | 세션 시작 전 unsupported-action |

F01~F04는 일부러 넣은 실행 환경 오류에서 엔진이 안전하게 멈추는지 보는 검사이고, 접근성 오류를 찾는 검사가 아니다. F01은 기한만 보려고 멈춤 감지를 끄며, 없는 대상을 만났을 때 기본 규칙으로 어떻게 끝나는지는 L01이 본다. C01은 오프라인 계약 검사이며 Native 실행 수에 포함하지 않는다. F04는 **실험 도구의 안전 차단** 검사이다. 현재 엔진 자체가 OS의 전면 앱을 계속 감시하거나 복구한다는 증거로 사용하지 않는다.

## 기존 엔진을 사용하는 범위

```text
일반 프로젝트와 계획 생성
  → checkRun / loadPlanFile
  → executeRun                     (CLI·대시보드와 같은 실행 조립)
  → FixedPlanner + OrchestratedSpeechPolicy
  → runWithPolicy
  → AtDriverBackend → VM의 실제 VoiceOver
```

계획은 미리 작성하고 모델이나 API 키를 사용하지 않는다. 상태 판단, 계획 단서 해석, 네이티브 키 매핑, 발화 대기, 로터 처리, 완료 판정과 정리는 제품 코드를 사용한다. fixture에 대한 마우스 클릭·DOM 입력·자동 포커스 수리·모의 발화 대체는 하지 않는다. 예외는 F04의 명시적인 Finder 활성화뿐이다.

새 브라우저 세션과 페이지 로드가 각 반복의 초기화다. fixture는 저장소나 외부 서비스 없이 시작하며 DOM의 완료 상태는 항상 false다. VoiceOver의 OS 전역 상태까지 초기화했다고 간주하지 않는다. 정리 실패와 다음 복구 태스크 실패가 이를 드러내면 그대로 실패로 남긴다.

실험 도구는 매 물리 키 명령을 전송하기 직전에 전면 프로세스의 실행 파일을 검사한다. 대상 Chromium과 다르거나 확인할 수 없으면 명령을 취소하고 실험을 중단한다. 엔진이 브라우저를 전면으로 가져오지 못하면 이를 대신 고치지 않는다. 이 검사의 시간도 실행 시간에 포함되므로 여기서의 시간을 모델이나 사용자 속도 평가에 사용하지 않는다. 이 검사는 전송 직전 표본이며 OS 수준의 포커스 잠금은 아니다.

F03은 AT Driver와 이 실행 사이의 TCP relay만 끊는다. 발화 텍스트와 프레임 내용을 바꾸지 않으며 공용 AT Driver 서비스를 종료하지 않는다. 오류 주입 시점과 복구 실행을 각각 기록한다.

## 판정과 결과 읽기

`artifacts/native-voiceover/<배치>/results.md`가 요약이고 `results.json`이 전체 원장이다. 각 `attempts/<검사>/`에는 제품의 `trace.json`, 이벤트 저널, `plan.json`, `plan.md`, 진단 스크린샷이 남는다. `project/`에는 당시의 일반 설정·태스크·고정 계획·fixture가 있다.

**엔진 결과**와 **실험 판정**은 다르다. 타임아웃·취소 같은 예상 오류가 정확하게 발생하면 실험 검사는 passed일 수 있지만 태스크 성공으로 세지 않는다. `status: complete`도 예정 검사를 끝냈다는 뜻이며 모두 통과했다는 뜻이 아니다. 전체 통과 외에는 실행 명령이 0이 아닌 종료 코드를 반환한다.

정상 태스크의 passed에는 다음 증거를 모두 요구한다.

- Native VoiceOver 세션 협상과 키 명령의 성공 응답.
- 모든 키 명령 직전의 Chromium 전면 확인.
- 케이스가 요구한 행동들의 성공 기록과 키 전송 뒤 수신된 실제 발화.
- 처음에는 실패하던 독립 완료 판정이 실제 페이지 변화 후 통과.
- 필요한 단서의 발화 수집, 실패한 행동이나 정리 경고 없음. 지연 케이스는 완료 발화까지 수집.
- 기대한 종료 상태 일치. 목표에 닿은 실행은 사용자가 알았다는 근거가 없을 때 `확인 안 됨`(`goalConfirmed: false`)이 붙는데, 이 표시도 케이스의 기대와 맞아야 한다.
- 케이스가 여는 모든 문서에 진입. 로터 케이스는 목록을 찾았을 때만 누르는 키(Down, Return)의 실제 전송. 로터가 목록을 못 찾아도 행동 자체는 성공으로 돌아오므로 행동 결과만으로 판정하지 않는다.

원시 발화는 제품 trace의 `backend.output`에 그대로 보존한다. 중복·빈 문자열·순서를 고쳐 정답에 맞추지 않는다. `windowId`는 수집 구간이지 명령의 인과관계 증거가 아니다. 완료 발화를 들었는지, DOM이 완료됐는지, 엔진이 success를 냈는지를 따로 읽는다. AT Driver가 전달하지 않는 VoiceOver의 취소·생명주기 신호, 발화 완료 시점, 실제 소리가 들렸는지는 측정하지 않는다.

모든 예정 행은 실행 전에 저장한다. 실패, 미실행, 검증 불가, 중단 시 실행 중이던 행도 분모에 남긴다. Ctrl+C는 현재 실행을 취소하고 나머지를 미실행으로 남긴다. 강제 종료로 `running`이 남았다면 미검증으로 취급한다. 결과 폴더를 덮어쓰거나 성공한 시도만 골라 합치지 않는다.

소스·빌드 파일의 SHA-256과 가능한 경우 Git HEAD도 함께 남긴다. 수정 후 재실행은 새 배치로 기록하고 기존 결과를 보존한다. 실패 기록에는 엔진의 단계·행동·응답·발화·관측·독립 판정을 보고 원인을 붙인다. 자동 판정이 원인을 모델·엔진·VoiceOver 중 하나로 단정하지 않는다.

## 이번 기반의 검증 범위

단위 검사는 케이스·계획·지원 거부·원장 분모·Native 증거 판정·전송 전 취소·연결 오류 주입을 검사한다. 브라우저 통합 검사는 fixture의 입력·교체·문서 이동·모달·지연·초기화를 검사한다. 이때 Playwright를 사용한 결과는 fixture 검증이며 Native 실험 결과가 아니다.

이 케이스 묶음은 시작을 위한 범위다. 접근성 결함이 있는 페이지, `previous`, `stopInteracting`, `links.list`, 복잡한 표·중첩 iframe·실제 사이트·한글 입력 지원·Safari는 여기서 검증하지 않는다. 현재 엔진의 지원 범위를 이 묶음의 통과만으로 확대하지 않는다. 실험 과정에서 필요한 행동이 드러나면 케이스와 판정 근거를 먼저 추가한다.
