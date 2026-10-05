# 현재 cli 안내

예전 Guidepup/LLMAgent workspace 전용 설정과 명령은 제거되었습니다. 현재 단일 패키지의 사용법은 [한국어 README](../README.ko.md), 상세 API는 [마이그레이션 가이드](./migration.md), 소스 위치는 [구조 안내](./editing-map.ko.md)를 참고하세요. 스크린샷 기반 모델 탐색은 `screenshot-run`을 사용합니다. legacy-run은 0.2에서 제거했습니다. [SystemOne 설정](./systemone.md)을 참고하세요.

`mock-run <task.json> --policy <module>|--script <decisions.json>`은 Chromium 기반 VoiceOver 근사 프로필을 명시적으로 선택합니다. 시뮬레이션 경고를 표시하며 기본값은 headless입니다. `--headed`, `--browser-executable`, `--diagnostic-screenshots`, `--out`을 지원하고 네이티브 endpoint는 사용하지 않습니다. 기존 `run`의 backend는 계속 `voiceover` 또는 `nvda`이며 `--backend mock`은 허용하지 않습니다. [지원 범위와 제한](./mock-voiceover.md)을 참고하세요.

세 실행 명령 모두 SIGINT(Ctrl+C)와 SIGTERM을 받으면 실행을 중단하고 리소스를 닫은 뒤 signal·stage·step이 포함된 `aborted` 결과를 저장합니다. 완료 후에는 signal 처리기를 제거합니다. 종료 코드는 SIGINT 130, SIGTERM 143, 실패한 실행 1, 잘못된 CLI 사용 2입니다. 강제 프로세스 종료는 이러한 정리와 trace 최종 저장을 수행할 수 없습니다.

실패한 실행은 기록된 이유·단계·오류와 함께 보고서 생성과 trace 분석 명령을 출력합니다. 네이티브 실행에는 AT Driver 연결 점검 명령도 표시합니다. `doctor`는 실제 연결 오류의 원인을 보여 주고 정리 중 오류가 발생해도 처음 원인을 유지합니다. doctor 성공은 프로토콜 연결만 확인하며 실제 음성 출력이나 네이티브 환경 준비를 보장하지 않습니다. 재실행할 때는 기존 기록을 보존하도록 새 `--out` 디렉터리를 사용하세요.

설치된 패키지의 `npx rawstep` 명령과 저장소의 `npm run rawstep --` 명령은 [번들 예제 안내](../examples/v2/README.md)에 구분되어 있습니다.

## 스크린샷 키보드 탐색

`screenshot-run <task.json> --model-endpoint http://127.0.0.1:8766/choose`는 실제 화면 픽셀과 모델 추론으로 키보드를 조작하는 독립 모드입니다. `--policy <module>`로 모델 어댑터를 바꿀 수 있습니다. DOM/AX와 독립 검증 결과는 정책 입력에 포함하지 않습니다. --script는 결정론적 실행을, --decision systemone은 모델 실행을 명시적으로 선택합니다. [설정, 개인정보와 한계](./screenshot-keyboard.md)를 참고하세요.
