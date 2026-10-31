# 현재 prompts 안내

현재 단일 패키지의 사용법은 [한국어 README](../README.ko.md), 소스 위치는 [구조 안내](./editing-map.ko.md)를 참고하세요. 작업 실행은 `rawstep run <task>` 또는 대시보드(`rawstep ui`)를 사용하고, 설정은 [설정 안내](./config.ko.md)에 있습니다.

## 계획 모델의 지침

실행 중에 무언가를 판단하는 모델은 계획 모델뿐이고, 그 프롬프트는 [`rawstep.config.json`](./config.ko.md#profiles-실행-프로필)의 실행 프로필에 있는 `profiles[].planner.instructions`입니다. 작업에는 프롬프트가 없고, 행동 하나하나를 고르는 모델도 없습니다. 이 지침은 Rawstep의 계획 규칙(계획 문서 형식, Rawstep이 적힌 그대로 수행할 수 있게 작업을 짜는 방법, 들은 것과 허용 행동만으로 계획)에 더해질 뿐 규칙을 대체하지 않습니다. 계획마다 지침 전체를 `rawstep-planner` 프롬프트로 sha256 지문과 거기서 딴 짧은 버전과 함께 기록하므로, 지침이 바뀐 실행을 구분할 수 있습니다. 프롬프트를 비교하려면 `instructions`만 다른 프로필끼리 비교합니다.

버튼이 어디 있는지처럼 실제 사용자가 알 수 없는 페이지 지식은 넣지 마세요. Rawstep이 재려는 어려움이 가려집니다. 전략이나 사용자 유형에 관한 지침은 괜찮습니다. 계획 파일에는 지침이 없고 대신 파일의 해시를 기록합니다. [계획과 계획 따르기](./config.ko.md#계획과-계획-따르기)를 참고하세요.

해설 지침(`project.analysis.instructions`, 또는 작업의 `analysisInstructions`)은 실행이 끝난 뒤 해설 모델이 무엇을 중점으로 볼지 알려 줍니다. 실행 결과는 바꾸지 않습니다.
