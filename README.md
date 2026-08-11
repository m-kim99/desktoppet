# Desktop Pet World

데스크톱 위에서 병아리와 강아지가 사는 **실시간 3D 월드**.
계절과 날씨가 흐르고, 펫들은 농사짓고 요리하고 낚시하고, **당신이 접속하지 않은 날에도 하루를 살고 일기를 씁니다.**

> **English summary** — A real-time 3D desktop-pet world built as a fork of
> [super-agent-party](https://github.com/heshengtao/super-agent-party). The upstream project provides
> the Electron shell and LLM agent backend; this fork adds a ~29k-line 3D world
> (`static/js/world.js`), two original characters modeled in Blender, and an offline day
> simulator that keeps the pets living while you are away. Built with three.js under a hard
> thermal budget on Apple Silicon, with a self-built test/perf/balance harness.

---

## 이 포크가 무엇인가

**상류 프로젝트** — [`heshengtao/super-agent-party`](https://github.com/heshengtao/super-agent-party) (AGPL-3.0)
Electron 셸, LLM 에이전트 백엔드, 데스크톱 펫 창을 제공합니다. 원본 문서는 [README_UPSTREAM.md](README_UPSTREAM.md).

**이 포크가 더한 것**

| | |
|---|---|
| `static/js/world.js` | **28,687줄 · 전량 신규** — 3D 월드 전체 |
| `chick_and_puppy_cute.blend` → `*.glb` | 병아리 · 강아지 **직접 모델링** |
| `scripts/` | 스모크 테스트 · 성능 프로브 · 밸런스 시뮬레이터 |
| `design/` | 조형 기준 시트(먹기/마시기 단계 일러스트 스펙) |
| [`PATCHING-GUIDE.md`](PATCHING-GUIDE.md) | 이 프로젝트의 불변식과 검증 루틴 |

포크 이후 205개 파일 · +42,030 / −75,023 (상류의 VRM 파이프라인 등을 걷어낸 순감).

---

## 월드

### 살아있는 환경
- **사계절** — 봄·여름·가을·겨울. 나무 색이 개체별로 갈리고, 겨울엔 잔디 텍스처가 설원으로 스왑
- **날씨** — 맑음/흐림/비/눈. 비가 오면 펫이 스스로 집으로 뛰어들어가 앉아 기다리고, 개면 일어남
  (눈은 예외 — 눈밭 산책은 두니까)
- **낮과 밤** — 하늘 그라디언트, 해와 달이 호를 그리며 이동, 30초마다 갱신
- **별자리** — 별을 이어 등록하면 그 별자리가 매일 밤 하늘에 남음 (`config/world_constellations.json`)

### 생활
- **농사** — 씨앗 → 새싹 → 성장 → 수확. 실시간 성장, 단계당 1회 물주기로 절반 단축
- **요리** — 재료 계보(잠수채집 / 조개 / 장터 / 찬장) 매칭 → 플레이팅. 매칭 성공 시 정식 레시피 카드로 승격
- **낚시 · 잠수 채집 · 조개잡이**
- **페리 배달** — 하루 1주문 · 품목당 3개. 배달 알림은 토스트가 아니라 잔교에 놓인 상자로
- **발굴** — 조종 중 ⌘ 또는 채팅 `<game=treasure>`. 펫이 아주 가끔 스스로 파기도 함

### 상호작용
- **펫 조종(빙의)** — 심즈式 패널 조작 / 동숲式 직접 조종 두 층
- **탈것** — 걷기의 3배 속도, 조수석 탑승
- **손잡기 · 숨바꼭질** — 창 간 IPC 없이 씬 안에서 안무로 재현
- **음악** — `static/music/`에 파일을 넣으면 목록에 뜨고 루프 재생
- **간식 · 음료** — 3D 컵이 발/날개에 parenting되어 몸짓 따라 흔들림. 베어물면 실제로 줄어듦

### 부재일 시뮬레이션 ⭐
이 프로젝트의 핵심 아이디어입니다.

```
접속하지 않은 날
      ↓  데이 시뮬레이터가 날짜 시드로 "추상 하루"를 굴림
  그날의 사건들
      ↓  일기 데몬이 펫 시점으로 하루를 기록
   월드 로그에 편입 (canon)
      ↓
다음 접속 시 펫이 아침 인사와 함께 그날 얘기를 꺼냄
```

펫은 당신이 없던 날에도 살아 있습니다. 하루는 오전 6시에 넘어가서 새벽 일기에도 아침 코멘트가 붙습니다.

---

## 엔지니어링 노트

### 발열 예산 (가장 큰 제약)
M 시리즈 맥북에서 이 월드를 상시 띄워두려면 GPU 발열이 실질적 상한이었습니다.

- **포스트프로세싱 체인 제거** — GTAO/bloom 컴포저가 프레임당 전체화면 half-float 패스를 ~19회 쌓고 있었음.
  단일 포워드 패스 + MSAA + 블롭 그림자 + 글로우 스프라이트로 대체
- **프레임 티어 60 / 30 / 15 fps** — 아무도 안 보고 있으면 15fps로 내려감. 펫 창도 동일
- **파티클은 셰이더 Points만** (강수·분수·반딧불이). 스프라이트 생성/폐기 금지
- **오션 파도는 버텍스 셰이더** — CPU는 프레임당 아무것도 쓰지 않음
- **꺼진 라이트는 `scene.remove`** — `intensity = 0`은 금지 (포워드 셰이더는 라이트 수만큼 전 픽셀 과금)
- **크로스 프롭 메시 병합** — 재질 인스턴스별로 합쳐 그룹당 몇 개의 메시로. 원본은 `visible=false`로만
  숨겨서(제거 아님) Raycaster 클릭 판정은 유지
- **정점 색 베이킹(`bakeGrad`)** — 그라디언트를 재질이 아니라 지오메트리가 들게 해서 1종 1드로우콜

불변식은 [`PATCHING-GUIDE.md` §1](PATCHING-GUIDE.md)에 못박아 두었고, 스모크 테스트가 **`draws ≤ 250`** 을 강제합니다.

### 검증 하네스

```bash
npm run test:world      # 스모크 10/10 — pageerror 0, draws ≤ 250, 핵심 상태 어서션
npm run perf:world      # 헤드리스 fps/draws/CPU% — active/parked/ambient/toast 4개 시나리오
npm run balance:world   # 자율행동 밸런스 몬테카를로
```

**밸런스 시뮬레이터**가 이 중 특이합니다. `world.js`의 여가 결정 로직을 미러링해 가상 하루를
400회 굴리고 활동별 점유율 표를 냅니다. 리팩터·튜닝의 전후 비교 게이트로 쓰고, 신규 활동이
점유 10%를 넘으면 의도한 것인지 다시 확인하게 되어 있습니다.

```bash
node scripts/balance-sim.mjs --mode both    # 패치 전/후 ±편차 표
node scripts/balance-sim.mjs --day 2026-08-08   # 부재일 하루를 날짜 시드로 굴려 이벤트 JSON
```

게임 밸런스를 감으로 맞추지 않기 위한 장치입니다.

### 조형 검수 랩
먹기/마시기 단계는 [`design/`](design/README.md)에 기준 일러스트를 두고,
월드에 내장된 검수 랩으로 3D 결과를 대조합니다.

```
world.html?foodlab=1    음식 9종 × 베어물기 3단계
world.html?drinklab=1   음료 9종 × 마시기 3단계
world.html?dishlab=1    수확 요리 8종
```

헤드리스 스크린샷 스크립트(`scripts/_*lab-shot.mjs`)로 캡처해 스펙과 나란히 비교합니다.

---

## 실행

```bash
npm install
npm run dev        # Electron 개발 실행
```

빌드:

```bash
npm run build:mac    # 또는 build:win / build:linux
```

LLM 백엔드 설정은 상류 문서([README_UPSTREAM.md](README_UPSTREAM.md))를 따릅니다.

---

## 기술 스택

`three.js` · `Electron` · `Python (FastAPI)` · `Blender` · `Playwright(headless)` · `Node.js`

---

## 라이선스 · 크레딧

이 저장소는 [`heshengtao/super-agent-party`](https://github.com/heshengtao/super-agent-party)의
포크이며, 상류와 동일하게 **AGPL-3.0**으로 배포됩니다. 전문은 [LICENSE](LICENSE),
서드파티 목록은 [`LICENSE-third-party/`](LICENSE-third-party/)를 참조하세요.

발소리 음원은 [`static/sounds/steps/LICENSE.txt`](static/sounds/steps/LICENSE.txt)의 조건을 따릅니다.

병아리·강아지 캐릭터(`chick_and_puppy_cute.blend`, `Chick.glb`, `Puppy.glb`)와
`static/js/world.js`를 비롯한 월드 구현은 이 포크에서 새로 작성한 것입니다.
