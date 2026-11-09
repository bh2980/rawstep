# 스크린리더 및 탐색 모드

프로필에서 **어떻게 이동할지**(`actions`)와 **어떤 스크린리더를 쓸지**(`screenReader`)를 고를 수 있습니다.

---

## 1. 탐색 모드

실제 스크린리더 사용자들의 탐색 습관은 모두 같지 않습니다. 위에서부터 한 항목씩 차례대로 읽으며 내려가는 사용자도 있고, VoiceOver 로터(`VO+U`)나 단축키를 써서 헤딩, 폼 컨트롤, 링크만 빠르게 건너뛰는 사용자도 있습니다.

프로필의 `actions` 객체는 시뮬레이션 사용자가 사용할 수 있는 명령과 키를 결정합니다.

| 찾는 방법 | 허용되는 `intents` | 주로 확인하는 문제 |
| :--- | :--- | :--- |
| **한 칸씩** | `next`, `previous`, `activate` | 읽기 순서, 건너뛰기 링크 유무, 페이지 상단부터 목표 지점까지 거쳐야 하는 항목 수. |
| **제목으로** | `next`, `previous`, `activate`, `heading.next`, `heading.previous`, `headings.list` | 헤딩(`<h1>`–`<h6>`, `role="heading"`)이 적절히 마크업되어 있고, 원하는 섹션으로 바로 찾아갈 수 있을 만큼 이름이 명확한지 여부. |
| **폼 컨트롤로** | `next`, `previous`, `activate`, `form.next`, `form.previous`, `formControls.rotor` | 입력창, 셀렉트, 체크박스, 버튼들을 로터 목록이나 폼 점프로 탐색했을 때 각각의 접근 가능한 이름이 명확히 구분되는지 여부. |
| **링크로** | `next`, `previous`, `activate`, `link.next`, `link.previous`, `links.list` | 주변 문맥 없이 링크 목록만 모아 들었을 때도 각 링크의 목적을 알 수 있는지 여부 (*"여기 클릭"*, *"더 보기"* 같은 모호한 링크 검출). |
| **커스텀** | 원하는 `intents` 및 `keys` 조합 | `Escape`, `Tab`, `Shift+Tab`, `ArrowDown`, `readCurrent`, `readFocused` 등 특정 키나 명령을 추가한 맞춤형 시나리오. |

### 로터 및 목록 조회 명령의 동작 방식
- **`headings.list`:** 페이지의 모든 헤딩과 레벨을 한 번의 출력으로 읽어줍니다 (VoiceOver의 헤딩 로터 목록을 본뜬 것). `runRules.survey`가 `"headings"`(기본값)이고 `headings.list`가 허용되어 있으면 첫 단계에서 자동으로 실행됩니다.
- **`links.list`:** 페이지의 모든 링크를 한 번의 출력으로 읽어줍니다.
- **`formControls.rotor`:** 폼 컨트롤 로터 목록을 엽니다. 로터가 열린 상태에서는 `next`와 `previous`로 목록 항목을 탐색하고, `activate`를 실행하면 해당 컨트롤을 누르지 않고 스크린리더 커서만 그 컨트롤로 이동시킨 뒤 로터를 닫습니다. `Escape`를 누르면 이동 없이 로터를 닫습니다.

---

## 2. 스크린리더 엔진 (`profile.screenReader`)

Rawstep은 세 가지 스크린리더 백엔드를 지원합니다.

| `screenReader` 값 | 지원 운영체제 | 필요한 설정 | 적합한 용도 |
| :--- | :--- | :--- | :--- |
| **`"simulation"`** *(기본값)* | macOS, Linux, Windows | 별도 설정 없음 (헤드리스 또는 일반 Chromium에서 바로 동작) | 빠른 로컬 개발, 다중 프로필 반복 실행, Linux CI 파이프라인. |
| **`"voiceover"`** | macOS (`darwin`) | macOS VoiceOver + AT Driver 서버 (`ws://localhost:4382/session`) | macOS에서 실제 Apple VoiceOver 동작을 검증할 때. |
| **`"nvda"`** | Windows (`win32`) | Windows NVDA + AT Driver 서버 (`ws://localhost:3031/session`) | Windows에서 실제 NVDA 동작을 검증할 때. |

---

## 3. 시뮬레이션된 VoiceOver (`"simulation"`)

`MockVoiceOverBackend`(`@rawstep/screenreaders/mock-voiceover`)는 운영체제에 구애받지 않는 내장 스크린리더 시뮬레이터입니다.
- Chrome DevTools Protocol(`Accessibility.getFullAXTree`)을 통해 Chromium의 실시간 접근성 트리를 읽고, DOM 포커스와는 별도로 가상 스크린리더 커서를 유지합니다.
- 직접 작성한 영어 문구 규칙(`formatSimulatedSpeech`)으로 역할, 이름, 헤딩 레벨, 랜드마크, 다이얼로그 경계, 라이브 리전(`aria-live`, `role="alert"`, `role="status"`), 상태(`expanded`, `collapsed`, `checked`, `disabled`, `required`)를 음성 문구로 조합합니다. 이 중 일부 규칙은 [Accessibility Supported (`a11ysupport.io`)](https://github.com/accessibilitysupported/a11ysupport.io)에 보고된 실제 VoiceOver 발화 13가지 사례로 확인했고, 나머지는 Rawstep에서 정한 것입니다. 별도의 증거 모듈에는 Accessibility Supported와 공개된 [W3C ARIA-AT](https://github.com/w3c-cg/aria-at) 보고서에서 가져온 제3자 보고 결과 2,914건(발화 기록이 아니라 보고된 결과)이 들어 있으며, 어디까지 근거가 있고 어디가 비어 있는지 재는 데만 쓰입니다. 실행 중에는 쓰이지 않습니다.
- 모든 트레이스에 `evidenceProvenance: "simulation"`을 기록해 실제 운영체제 스크린리더 실행 결과와 혼동되지 않도록 구분합니다.

---

## 4. W3C AT Driver를 통한 실제 VoiceOver 및 NVDA 연결

실제 운영체제 스크린리더로 태스크를 실행하려면 실행 프로필에서 `"screenReader": "voiceover"`(macOS) 또는 `"screenReader": "nvda"`(Windows)로 설정합니다.

Rawstep은 [W3C AT Driver](https://github.com/w3c/at-driver) WebSocket 프로토콜(`AtDriverBackend`)을 통해 실제 스크린리더와 통신합니다.
- **기본 WebSocket 엔드포인트 (`machine.atEndpoints`):**
  - `voiceover`: `ws://localhost:4382/session` ([Bocoup macOS AT Driver 서버](https://github.com/bocoup/macos-at-driver-server))
  - `nvda`: `ws://localhost:3031/session` ([PAC NVDA AT Automation 서버](https://github.com/Prime-Access-Consulting/nvda-at-automation))
- **화면에 보이는 브라우저 창:** 실제 스크린리더는 운영체제 화면에 떠 있는 창을 읽으므로, `voiceover`와 `nvda` 실행에서는 `machine.headless` 설정과 관계없이 Rawstep이 항상 눈에 보이는 브라우저를 엽니다.

### AT Driver 서버 자동 실행 (`RAWSTEP_AT_DRIVER_COMMAND`)

매번 실행 전에 AT Driver WebSocket 서버를 수동으로 띄우는 대신, `.env.local`(또는 대시보드의 **설정 › 이 컴퓨터**)에 `RAWSTEP_AT_DRIVER_COMMAND`를 설정해 둘 수 있습니다.

```bash
# .env.local 예시
RAWSTEP_AT_DRIVER_COMMAND="npx your-at-driver-server --port 4382"
```

실행 프로필이 `voiceover`나 `nvda`를 사용할 때 해당 WebSocket 포트가 아직 열려 있지 않으면, Rawstep이 자동으로 `RAWSTEP_AT_DRIVER_COMMAND`를 실행해 연결을 기다렸다가 실행이 끝나면 서버 프로세스를 함께 종료합니다.

### 실제 스크린리더 연결 상태 확인

설정한 AT Driver 서버와 WebSocket 연결이 정상적으로 되는지 확인하려면 `doctor`를 실행하세요.

```bash
npx rawstep doctor
```

### VoiceOver에서 페이지 안으로 들어가기

VoiceOver의 커서는 페이지가 열려도 브라우저 자체의 컨트롤에 머물고, 안으로 들어가기 전에는 페이지 내용에 닿을 수 없습니다. 실행을 시작할 때와 새 문서가 열릴 때마다 엔진이 직접 들어갑니다.

1. 페이지가 열리면서 스스로 포커스를 옮겼다면(`autofocus` 또는 `focus()` 호출) VoiceOver가 이미 안에 있으므로 아무 키도 누르지 않습니다.
2. 그렇지 않으면 VoiceOver가 웹 콘텐츠를 말할 때까지(최대 8번) 다음 항목 키를 누른 뒤, 안으로 들어가고(VO+Shift+Down) VoiceOver가 그렇게 말했는지 확인합니다.

이 과정은 사용자의 이동이 아닙니다. 이동 횟수에 더해지지 않고, 브라우저 컨트롤을 지나는 동안의 발화는 플래너가 듣는 내용에서 빠집니다. 원시 trace에는 남고, 진입마다 `screen-reader.page-entry`가 기록됩니다. 다만 실행의 `timeoutMs`는 소모합니다. 시작할 때 약 4초, 이후 페이지마다 약 7초입니다. VoiceOver가 들어가지 못하면 실행은 `page-entry` 단계의 오류로 끝나며, 이는 페이지에 대해 아무것도 말해 주지 않습니다. NVDA에는 이 단계가 없습니다.
