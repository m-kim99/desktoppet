# 조형 기준 시트 (illustration specs)

먹기/마시기 단계 모델링의 기준 일러스트. 브라우저로 열면 됨.

- `food-bite-spec.html` — 푸드 부스 9종 (온전/1입/2입)
- `drink-sip-spec.html` — 음료 9종 (가득/절반/조금)
- `space-snack-spec.html` — 우주 자판기 5종 (현재/보완/1입/2입)

## 3D 검수 랩 (world.js에 내장, URL 파라미터로 활성화)
- `world.html?foodlab=1` — 음식 9종 × 베어물기 3단계
- `world.html?drinklab=1` — 음료 9종 × 마시기 3단계
- `world.html?snacklab=1` — 우주식 5종 × 베어물기 3단계
- 헤드리스 스크린샷: `scripts/_foodlab-shot.mjs` / `_drinklab-shot.mjs` / `_snacklab-shot.mjs`
