# 현재 prompts 안내

현재 단일 패키지의 사용법은 [한국어 README](../README.ko.md), 소스 위치는 [구조 안내](./editing-map.ko.md)를 참고하세요. 작업 실행은 `rawstep run <task>` 또는 대시보드(`rawstep ui`)를 사용하고, 설정은 [설정 안내](./config.ko.md)에 있습니다.

## 실행 모델과 계획 모델의 지침

프롬프트는 [`rawstep.config.json`](./config.ko.md#combos-모델-조합)의 모델 조합에 속합니다. `combos[].executors.<모드>.instructions`가 그 모드에서 행동을 고르는 모델에 주는 지침이며, 작업에는 프롬프트가 없습니다. 실행마다 실행 모델의 지침은 프롬프트 id `<모델 조합 id>.<모드>`와 내용 해시 버전으로 기록되므로 지침이 바뀐 실행을 구분할 수 있습니다. 프롬프트를 비교하려면 `instructions`만 다른 모델 조합끼리 비교합니다.

계획 + 실행 구조의 모델 조합에는 따로 `combos[].planner.instructions`가 있습니다(스크린리더 모드 전용). 이 지침은 Rawstep의 계획 규칙(계획 문서 형식, 들은 것과 허용 행동만으로 계획)에 더해질 뿐 규칙을 대체하지 않으며, 계획 근거에 sha256 지문으로 기록됩니다. 버튼이 어디 있는지처럼 실제 사용자가 알 수 없는 페이지 지식은 넣지 마세요. Rawstep이 재려는 어려움이 가려집니다. 전략이나 사용자 유형에 관한 지침은 괜찮습니다. [계획과 실행](./config.ko.md#계획과-실행-orchestration)을 참고하세요.

해설 지침(`project.analysis.instructions`, 또는 작업의 `analysisInstructions`)은 실행이 끝난 뒤 해설 모델이 무엇을 중점으로 볼지 알려 줍니다. 실행 결과는 바꾸지 않습니다.
