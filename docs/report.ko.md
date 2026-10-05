# 현재 report 안내

예전 Guidepup/LLMAgent workspace 전용 설정과 명령은 제거되었습니다. 현재 단일 패키지의 사용법은 [한국어 README](../README.ko.md), 소스 위치는 [구조 안내](./editing-map.ko.md)를 참고하세요. 스크린샷 기반 모델 탐색은 `screenshot-run`을 사용합니다. legacy-run은 0.2에서 제거했습니다. [SystemOne 설정](./systemone.md)을 참고하세요.

`npx rawstep report <run-dir>`는 분석기 없이도 HTML과 JSON 보고서를 만듭니다. HTML에는 기록된 실행 결과·이유·단계, 첫 실행 오류 또는 중단, 동작별 결과, 검증 규칙별 관측 근거와 원본 이벤트 링크가 표시됩니다. 최종 성공 전에 충족되지 않은 중간 검증은 해당 단계의 `Not satisfied`로 표시하며 실행 실패로 간주하지 않습니다. 규칙별 근거가 없는 이전 trace는 근거가 기록되지 않았음을 명시합니다.

원시 이벤트는 개별적으로 접혀 있고 펼쳐서 확인할 수 있습니다. HTML 이스케이프와 CSP를 유지하며 스크립트나 원격 리소스를 실행하지 않습니다. 개인정보 요약은 남아 있는 키보드 스크린샷, 입력 후 제거된 스크린샷, 별도 진단 이미지 참조, 가려진 음성·검증 근거 수를 구분합니다. 남아 있는 이미지의 픽셀은 익명화되지 않으며, 진단 이미지 참조만으로 실제 파일의 존재를 보장하지 않습니다.

`report.json.summary`에는 `modality`, `modalities`, `counts`, `actions`, `firstFailure`, `verification`이 추가됩니다. 동작 실행 성공과 작업 검증 성공은 별개이며, 보고서와 분석은 원본 trace나 실행 결과를 변경하지 않습니다.

새 실행은 trace schema 2.2를 저장하며(스크린샷은 `blobs/<sha256>.png`로 한 번만 저장하고 이벤트에는 `{ sha256, blob, bytes, viewport }` 참조만 남깁니다). 이전 스키마(2.0/2.1)의 trace는 읽지 않습니다. `rawstep report`는 스크린샷을 복원해 HTML에 포함합니다. `mock-run` 보고서는 VoiceOver 근사 시뮬레이션임을 눈에 띄게 표시합니다. `modality: "simulation"`과 별도의 `readableSimulationOutputEvents`, `redactedSimulationOutputEvents` 수로 실제 스크린리더 발화와 구분합니다. 초기 실행 실패로 출력이 없어도 환경 provenance로 시뮬레이션임을 유지합니다. 시뮬레이션에 네이티브 발화가 없다는 이유만으로 missing-speech 경고를 내지 않으며, 시뮬레이션 결과는 Apple VoiceOver의 실제 동작이나 적합성을 증명하지 않습니다.
