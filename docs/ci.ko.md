# CI 및 베이스라인 회귀 테스트

AI 탐색은 실행할 때마다 이동 횟수가 1~2회씩 달라질 수 있습니다. `rawstep suite`와 `rawstep compare`는 여러 번 반복 실행해 사소한 흔들림은 넘어가고, 저장해 둔 베이스라인보다 **확실히 나빠졌을 때만** CI를 실패시킵니다.

---

## 1. 태스크 스위트 실행하기 (`rawstep suite`)

`rawstep suite`는 여러 태스크와 프로필 조합을 하나의 배치로 실행하고 `.rawstep/experiments/<batch-id>/` 폴더에 `summary.json`(`BatchSummary` 스키마 `1.0`)을 저장합니다.

```bash
# rawstep.config.json에 등록된 모든 태스크를 각 태스크의 기본 프로필로 실행
npx rawstep suite

# "checkout" 태그가 붙은 태스크만 두 프로필에 대해 3회씩 반복, 브라우저 2개 병렬 실행
# (`linear`와 `by-headings`는 예시 프로필 ID입니다. 직접 설정한 프로필 ID를 쓰세요)
npx rawstep suite --tag checkout --profile linear --profile by-headings --repeat 3 --parallel 2
```

각 `(태스크, 프로필)` 조합은 `summary.json` 안에서 하나의 요약 셀이 되며 다음 정보를 담습니다.
- `reached`, `gave-up`, `mistaken`, `unmeasured`, `error`로 끝난 실행 횟수.
- 측정된 실행 중 목표 도달 비율 (`reached / measured`).
- 목표에 도달한 실행들의 최소(`min`), 중앙값(`median`), 최대(`max`) 이동 횟수.
- **막힌 지점**: 사용자가 누른 요소가 기대와 다르게 반응한 곳(`expectation-broken`)과, 그것이 나타난 실행 횟수.
- 반복해서 나타난 **페이지 힌트**(`focus-lost`, `missing-announcement`, `modal-focus-outside` 등).

---

## 2. 베이스라인 저장 및 비교하기

### 1단계: 베이스라인 요약 파일 저장 및 커밋

스위트를 실행할 때 `--save-summary`를 지정해 `summary.json`을 저장소 내 파일로 저장합니다.

```bash
npx rawstep suite --tag smoke --repeat 3 --save-summary baseline.summary.json
git add baseline.summary.json
```

### 2단계: Pull Request에서 베이스라인과 비교하기

이후 실행(또는 `rawstep compare`)에서 `--baseline`과 `--fail-on`을 함께 전달합니다.

```bash
npx rawstep suite --tag smoke --repeat 3 \
  --baseline baseline.summary.json \
  --fail-on reach,moves,stuck \
  --junit rawstep-junit.xml
```

브라우저를 다시 띄우지 않고 이미 저장된 두 요약 파일(또는 배치 폴더)만 오프라인으로 비교할 수도 있습니다.

```bash
npx rawstep compare baseline.summary.json .rawstep/experiments/<batch-id>/summary.json \
  --fail-on reach,moves,stuck
```

---

## 3. 회귀 판정 게이트(`--fail-on`)와 노이즈 필터링

`--baseline`을 지정하면 `--fail-on`의 기본값은 `reach`입니다. 네 가지 게이트를 쉼표로 구분해 조합할 수 있습니다.

| 게이트 | 실패 조건 (종료 코드 `4`) | 반복 실행 간 편차 보정 방식 |
| :--- | :--- | :--- |
| **`reach`** *(기본값)* | 측정된 실행 중 목표에 도달한 비율이 베이스라인보다 떨어졌을 때. | 양쪽 모두 측정된 실행이 2회 이상일 때만 판정합니다. 적은 쪽 기준으로 실행 1회 이하의 차이는 편차로 봅니다. |
| **`moves`** | 목표에 도달하기까지 걸린 이동 횟수가 베이스라인보다 유의미하게 늘어났을 때. | 양쪽 모두 목표에 도달한 실행이 2회 이상일 때만 판정합니다. 새 배치의 중앙값이 베이스라인의 `min`..`max` 범위를 벗어나야 하며, 범위는 양쪽으로 3회 또는 베이스라인 중앙값의 20% 중 큰 값만큼 넓혀서 봅니다. |
| **`stuck`** | 새로운 **막힌 지점**이 생겼을 때. 해당 `(태스크, 프로필)` 셀에서 새 배치의 측정된 실행 중 50% 이상에 나타났고 베이스라인에는 한 번도 없던 요소입니다. | 셀 단위로 막힌 요소를 비교하며, 실행의 절반 미만에서만 보인 지점은 편차로 봅니다. |
| **`missing`** | 베이스라인에 있던 `(태스크, 프로필)` 조합이 새 배치에서 빠졌을 때. 측정된 실행이 0건인 조합은 "비교하지 못함"으로 알리며 실패시키지 않습니다. | 테스트 커버리지가 실수로 누락되는 것을 방지합니다. |

---

## 4. CI 종료 코드 및 GitHub Actions 연동

### CI 종료 코드
- **`0`:** 모든 실행이 정상 측정되었고 `--fail-on` 회귀 게이트에 걸린 항목이 없음.
- **`1`:** 인프라 오류, 잘못된 설정/태스크 파일, 또는 실행 중 예외 발생.
- **`2`:** 잘못된 CLI 플래그나 인자.
- **`3`:** 크래시는 없었으나 하나 이상의 실행이 **`unmeasured`**로 끝남 (플래너 호출 한도, `maxSteps`, `timeoutMs`, 반복 방지 장치 도달, 계획에 필요한 동작을 프로필이 허용하지 않음, 모델이 확신하지 못함, 플래너가 제때 답하지 않음, 봇 확인 등으로 사이트가 차단함, 이 컴퓨터에서 페이지 환경을 적용하지 못함).
- **`4`:** `--baseline` 대비 하나 이상의 `--fail-on` 회귀 게이트에서 퇴행이 감지됨.

여러 조건이 겹치면 `1`이 `4`보다, `4`가 `3`보다 우선합니다. `run`이나 `suite`에서 `--baseline` 없이 `--fail-on`만 쓰면 사용법 오류(`2`)입니다.

### GitHub Actions 연동
GitHub Actions 환경(`$GITHUB_STEP_SUMMARY` 환경 변수가 설정된 상태)에서 `rawstep run`, `rawstep suite`, `rawstep compare`를 실행하면, 워크플로의 **Job Summary**에 마크다운 비교 표가 자동으로 추가됩니다.

```yaml
name: Screen Reader Regression Suite
on:
  pull_request:

jobs:
  rawstep:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22.12.0'
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - name: Run Rawstep Suite against Baseline
        env:
          RAWSTEP_OPENAI_API_KEY: ${{ secrets.RAWSTEP_OPENAI_API_KEY }}
        run: |
          npx rawstep suite --tag ci \
            --repeat 3 \
            --parallel 2 \
            --baseline baseline.summary.json \
            --fail-on reach,moves,stuck \
            --junit rawstep-junit.xml
      - name: Upload Rawstep Artifacts
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: rawstep-experiments
          path: |
            .rawstep/experiments/
            rawstep-junit.xml
```
