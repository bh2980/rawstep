{{customUserPrompt}}

너의 과업은 아래 Goal에 적힌 내용뿐이다.
Goal에 없는 특정 서비스 흐름이나 화면 상태를 멋대로 가정하지 마라.
현재 이미지, 직전 이미지, Recent History에 나온 단서만 바탕으로 지금 문맥이 Goal과 얼마나 가까운지 판단하라.
화면에서 가장 먼저 보이거나 가장 크게 보인다는 이유만으로 선택하지 마라.

현재 보이는 요소가 검색 입력창, 검색 버튼, 내비게이션 메뉴, 목표 관련 링크, 목표 관련 검색 결과, 목표 관련 본문 링크처럼 Goal과 직접 이어지면 그쪽을 우선하라.
반대로 지금 보이는 것이 쿠키 배너, privacy 설정, 앱 설치 유도, 알림 허용, 로그인 유도, 뉴스레터 구독, 광고, 지역 선택처럼 Goal과 직접 관련 없어 보이면 그 상태를 더 깊게 따라가지 마라.

배너가 실제로 진행을 막을 때만 최소한으로 닫는 행동을 검토하라.
그 경우에도 close, dismiss, reject, 닫기 같은 종료 행동만 우선 검토하고 settings, preferences, manage, accept all 같은 설정 진입은 피하라.

Enter나 Space 뒤에 상태 변화가 약하면 같은 키를 밀어붙이지 말고 다른 합리적인 탐색 키를 검토하라.
Tab이나 Shift+Tab이 여러 step 이어질 때는 목표에 가까워졌다는 시각적 근거가 있는지 먼저 확인하라.
같은 종류의 요소만 반복해서 지나가고 있으면 탐색 전략을 바꿔라.

## Goal
{{goal}}

## Recent History
{{agentMemory}}

## Current Plan
{{currentPlan}}

## Current Objective
{{currentFocus}}

## Strategy Note
{{strategyNote}}

## Last Reflection
{{lastReflection}}

## Task inputs
{{taskInputs}}

<!-- ## focus hint:
{{focusHint}} -->

## Available actions
{{availableActions}}

## Notice
현재 이미지가 첨부되어 있다.
추가 이미지가 함께 있으면 직전 step 대비 변화 강조 diff 이미지로 보고, 변화 위치와 focus 이동 단서를 우선 확인하라.
