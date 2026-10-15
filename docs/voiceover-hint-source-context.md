# Help 원천·form 문맥과 새 과업 평가 — 2026-10-16

실제 사이트의 힌트 차이를 줄인 대조에서 **같은 title이라도 역할과 브라우저에 따라 처리 방식이 다름**을 확인했다. 발화 엔진과 Rawstep의 입력 투영을 함께 수정했다. 이동 구현은 추가하지 않았다. 원래 입력·예측·Native 발화·첫 점수는 보존하고, 이후 검증 범위 감사와 회귀 결과를 분리했다.

## 대조와 첫 결과

같은 대상과 이력을 유지한 10페이지·30동작을 프로파일마다 실행했다.

- 버튼/일반 링크: title 없음, 이름과 같은 title, 다른 title. 진입·이탈·재진입을 비교했다.
- 같은 두 버튼: 일반 div, 이름 없는 form, 이름 있는 form, 이름 있는 region. 진입·내부 이동·역방향 이동을 비교했다.

두 입력 경로를 Native 전에 예측했다. 첫째는 실제 Rawstep 진단 입력이다. 둘째는 같은 입력에 작성된 title을 첫 대상의 `semantic.help`로 공급한 가설이다. 둘째도 Native AX로 확인해야 하며, 작성한 title 자체를 Native 관측으로 취급하지 않았다. 양쪽 프로파일 종료 전에는 점수나 실험 발화를 보고 규칙을 수정하지 않았다.

| 첫 고정 모델, 브라우저별 | Safari | Chrome |
| --- | ---: | ---: |
| 계획 / Native 관측 | 30 / 30 | 30 / 30 |
| 실제 Rawstep 입력으로 비교 가능 | 23 | 27 |
| 실제 입력 Main / literal Full | 23/23 / 19/23 | 27/27 / 23/27 |
| 실제 입력 Main / 전체 계획 | 23/30 | 27/30 |
| 작성 title 경로로 비교 가능 | 27 | 23 |
| 작성 title 경로 Main / literal Full | 27/27 / 19/27 | 23/23 / 19/23 |
| 독립 윤곽/AX 대상 연결 / 키보드 포커스 | 30/30 / 30/30 | 30/30 / 30/30 |

양쪽 모두 이름 없는 form의 3동작에서 물리 AX 조상과 Rawstep 입력이 달랐다. Safari의 같은-title 버튼·링크 4동작은 실제 Rawstep 입력에서 help가 누락됐다. Chrome의 작성-title 경로 4동작은 Native가 동일 title의 help를 노출하지 않아 미계측이었다. 조건부 일치와 전체 계획 분모를 함께 유지한다. 열 개의 최종 활성 상태 확인은 fixture health이며 사용자 과업 성공이 아니다.

관측에서 확인한 규칙은 다음과 같다.

| 조건 | Safari + VoiceOver | Chrome + VoiceOver |
| --- | --- | --- |
| 버튼 title = 이름 | AXHelp는 노출되지만 힌트에서 같은 이름을 반복하지 않음 | help를 노출하지 않으며 반복하지 않음 |
| 일반 링크 title = 이름 | AXHelp를 노출하고 힌트에서 반복함 | help를 노출하지 않으며 반복하지 않음 |
| 다른 title의 help | 두 공백으로 힌트와 연결하고 수신 문자열 끝에 한 공백 | 동일 |
| 이름 없는 form의 Tab 이동 | AX 조상은 보존되지만 form 진입 말과 힌트 문맥은 투명 | 동일 |
| 이름 있는 form의 Tab 이동 | 진입 시 이름과 form을 말하고 웹 영역 종료 힌트를 생략 | 동일 |

`formatVoiceOverSpeech`는 focus 명령에서 이름 없는 form을 문맥 선택·반환 이력·힌트 부모 선택에서 제외한다. 이름 있는 바깥 문맥은 유지한다. object 명령의 form 탐색에 이 규칙을 확대하지 않았다. 수집의 원래 AX 트리는 변경하지 않았으며, 검증기는 발화에 쓰이는 focus 문맥을 투영한다.

Rawstep의 Safari 투영은 관측 범위인 일반 버튼/링크에서 동일 title의 help를 보존한다. 포매터는 Safari 버튼의 중복 help를 억제하고 링크는 유지한다. 다른 description 원천이 결합된 동일 title은 이 새 투영 규칙의 조건에서 제외했다. 일반 title-help 수신 끝의 한 공백도 보존한다. 기존 checkbox 회귀에도 같은 help 수신 공백이 있어 역할 목록 대신 help를 출력하는 경로에서 처리한다. 알려진 fixture 이름·URL·기대 발화로 규칙을 선택하지 않는다.

## 예약한 새 조합

대조 Native를 보기 전에 두 페이지와 전체 행동 이력을 예약했다. 기존 904개 사례와 template/site/contrast 그룹 및 전체 명령 시퀀스 충돌이 없음을 확인했다. 기본 역할과 스타일은 공유하므로 웹 전체의 구조적 독립성은 아니다.

- **저장 과업:** 이름 있는 region 안의 이름 없는 form에서 toggle 버튼으로 저장 버튼을 활성화하고, 저장·해제·다시 활성화·역방향 복귀·다시 저장한다. pressed와 disabled 전이는 각각 3회다.
- **읽기 조합:** title이 없는/같은/다른 링크 셋을 앞뒤로 비교한다. 이 페이지의 활성 상태 확인은 fixture health이며 과업 성공에 포함하지 않는다.

대조만 보고 수정한 모델의 실제 Rawstep 입력·이전 문맥·예측과 HTML을 다시 고정한 뒤 두 Native 프로파일을 실행했다. 모든 예측은 첫 Native 실행 전에 저장됐으며 양쪽 종료 후 분석했다.

| 새 조합, 프로파일마다 | Safari | Chrome |
| --- | ---: | ---: |
| 계획 / Native 관측 | 24 / 24 | 24 / 24 |
| 최초 비교 가능 Main / literal Full | 19/19 / 19/19 | 19/19 / 19/19 |
| 최초 일치 / 전체 계획 | 19/24 | 19/24 |
| 독립 윤곽/AX 대상 연결 / 키보드 포커스 | 24/24 / 24/24 | 24/24 / 24/24 |
| 선언 상태 필드 / 실제 boolean 전이 | 58/58 / 6/6 | 58/58 / 6/6 |
| 저장 과업 / 읽기 fixture health | 1/1 / 1/1 | 1/1 / 1/1 |

상태 필드 58개는 반복 스냅샷이며 서로 다른 전이 58회가 아니다. 대상의 윤곽과 AX 연결은 직접적인 논리 VoiceOver 커서 API나 전체 Navigation Accuracy가 아니다. 작은 한 과업의 성공은 일반 웹 과업 성공률이 아니다.

## 별도 입력 범위 감사

첫 평가에서 비교하지 못한 5동작은 모두 모델이 명시적으로 `modeled`로 반환한 native button의 물리 Space 이벤트였다. 일반 object 읽기용 검증기가 이름 없는 form을 요구했고, 이전 문맥도 현재 Space를 기준으로 다시 구성해 이미 Tab으로 얻은 이력과 충돌했다. 버튼 활성화 API는 이 form 읽기 문맥을 사용하지 않으며 기존 이력을 유지한다.

원래 모델·입력·예측·Native를 유지한 [범위 감사](../packages/vo-corpus/test/hint-transfer-input-audit.json)는 모든 행에 같은 조건을 적용한다. 실제 진단이 native button의 modeled Space 이벤트일 때만 별도 검증 모드를 사용한다. 현재 대상·전후 상태·Native Space 명령 대응·수신 창은 계속 확인하고, object 읽기나 VO 활성화에 이 모드를 허용하지 않는다. 이전 문맥은 마지막 실제 읽기 명령의 focus/object 투영을 유지하며, Space를 Tab으로 바꿔 평가하지 않는다. Native의 사적 발화 캐시를 직접 관측한 것은 아니다.

이 감사에서는 양쪽 모두 24/24 입력·명령·수신 창 비교와 Main·literal Full 일치가 확인됐다. **최초 19/24도 그대로 남아 있다.** 5건은 새로 엔진을 고쳐 맞힌 출력이 아니며, 이 사후 감사를 또 하나의 새 독립 평가나 전체 90% 달성으로 세지 않는다. 다음 독립 실행에는 이 명시적인 이벤트 검증 범위를 처음부터 적용해야 한다.

현재 코드의 회귀에서는 대조 60동작과 새 조합 48동작의 실제 입력/수신 문자열을 브라우저를 통해 재생한다. 전이 수집 뒤 기존 checkbox 도움말 회귀에서 확인한 후행 공백 처리도 보완했다. 따라서 보존된 첫 전이 빌드와 최종 빌드는 다르며, 최종 빌드의 재생은 확인한 자료에 대한 회귀다. 첫 빌드·예측 해시는 공개 fixture에 그대로 있다.

## 환경 장애와 보존

첫 Safari 시도는 시작 버튼의 키보드 포커스와 VO 읽기 위치가 달라 실험 키를 보내기 전에 종료됐다. Tab/Shift+Tab은 실제 Safari 포커스를 바꿨지만 반복 동기화와 Home 후에도 VO 윤곽은 현재 AX와 연결되지 않았다. VM 안의 VoiceOver를 종료하고 Command-F5로 다시 켠 뒤 시작 버튼의 발화와 단일 윤곽/AX 연결을 확인했다. 환경 회복 기록은 AT Driver가 원인이라는 증거가 아니다. 동기화 명령은 [Apple의 명령 정의](https://support.apple.com/en-euro/guide/voiceover/cpvokys04/mac)를 확인했다.

[전체 시도 감사](../packages/vo-corpus/test/hint-acquisition-audit.json)는 실패한 첫 30계획·0관측과 이후 대조 60·전이 48관측을 모두 남긴다. 총 138계획 중 108동작이 관측됐고 25개 case record가 있다. 서로 다른 모델의 대조·전이 정확도를 합산하지 않는다. 실패 시작 발화에 이전 웹사이트 내용이 있어 그 원문은 로컬에만 보존하고 공개 감사에는 분류·해시만 넣었다.

전이 모델 예측 고정 뒤 Native 검사기의 중복 지역 변수 선언을 테스트에서 발견해 첫 Native 전에 제거했다. 원래 계획의 해시는 보존하고 acquisition manifest에 수정된 관측기 해시를 따로 고정했다. 그 검사기는 모델 예측 생성에 쓰이지 않았고, 모델 JS·입력·예측은 변경하지 않았다.

macOS 26.6.2 (25G83), Safari 26.6.2, Chrome 155.0.8059.80, 영어 VoiceOver, locale `en_KR`, 설정 라벨 `baseline-v2-dnd`를 기록했다. VM은 음소거·창 없는 상태를 유지했다. Native 원문·AX·시각·실패 기록은 로컬 `packages/vo-corpus/data/`에 있고, 공개 fixture는 새로 작성한 HTML·시나리오·관측/예측과 원천 해시를 제공한다. 원본 관측과 첫 결과를 덮어쓰지 않았다.

## 한계와 재실행

이번 일반 링크는 image-map의 area 링크를 대표하지 않는다. 실제 사이트 Chrome의 map 링크에는 일반 링크 대조에 없는 이미지 그룹 조상이 있었다. 그 문맥과 help 생략을 일반 anchor 규칙으로 고치지 않았다. 해당 조상에 대한 입력 검증 보완, 복합 링크/제목의 Native 입력 연결, 새 최종 빌드 독립 평가가 남았다. 힌트의 지연·취소·완료와 발화 큐는 구현하거나 검증하지 않았다.

Native를 다시 수집할 때는 기존 생성기와 수집기를 사용하고 매번 새 출력 디렉터리를 지정한다. 프로파일별 실행과 기록을 분리한다. 새로 생성한 같은 페이지도 이제 회귀 자료다.

```sh
cd packages/vo-corpus
node --import tsx src/generate/index.ts --set hint-source-context-v1 --out data/cases/hint-source-recheck
node --import tsx src/generate/index.ts --set hint-context-transfer-v1 --out data/cases/hint-transfer-recheck
node --import tsx src/collect.ts --vm vo-collector --browser safari --cases data/cases/hint-source-recheck --url ws://127.0.0.1:14382/session --settings baseline-v2-dnd --visual-cursor
# Chrome은 별도 --browser chrome 실행으로 보존한다.
```

VM 없는 회귀:

```sh
npm run build
npx vitest run tests/mock-voiceover-hint-context.test.ts
npm run test:integration -- tests/mock-voiceover-hint-context.integration.test.ts tests/mock-voiceover-hint-transfer.integration.test.ts
cd packages/vo-corpus
node --import tsx --test test/hint-source-context.test.ts test/speech-input.test.ts test/speech-evaluation.test.ts
```
