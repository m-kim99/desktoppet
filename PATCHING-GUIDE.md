# Desktop Pet World — 패치 가이드 (필독)

이 앱을 수정할 때 반드시 지켜야 할 규칙들. 어기면 발열 회귀·크래시·저장 데이터 유실이 실제로 났었다.
(2026-07 기준. 상세 이력은 CHANGELOG.md와 git log 참조)

## ⛔ 최우선 5계명 — 이것만은 절대
1. **발열 불변식(§1)을 어기지 마라** — 이 앱 최대의 적은 맥북 발열. 매 프레임 도는 코드·재질·라이트·파티클은 §1 문법으로만
2. **`git add -A` 금지, 항상 파일 명시** — config/world_*.json은 사용자의 개인 데이터(소원·타임캡슐 문구). 커밋 전 `git status`
3. **검증 없이 커밋 금지** — headless로: `node --check` → err-check → E2E → 스모크 10/10. **headed 브라우저 창은 절대 띄우지 마라**
4. **PROPS 순서 = 저장 id. 재배열 금지** + 좌표 변경 시 `node scripts/world-layout-sweep.mjs` 필수
5. **퀄리티 기준은 §14** — "돌아가는 것"과 "고퀄"은 다르다. 사용자는 고퀄만 승인한다 (북극성 = 동물의 숲)

## ⭐ 고퀄리티로 만드는 법 (§14) — 이 프로젝트의 품질 방법론
사용자가 세션 내내 반복 요구한 기준. 새 기능은 처음부터 이 문법으로 만들 것 → 상세는 §14

## 0. 파일 지도
- `static/js/world.js` (~11k줄) — 월드 엔진 전부: 지형·프롭 빌더·펫 AI·상호작용·낚시·보트·날씨
- `static/js/world-layout.js` — 배치 데이터만 (섬·다리·언덕·평탄패드·소품 좌표). WHERE는 여기, HOW는 world.js
- `static/js/glb-pet-entity.js` — 펫 엔티티 공용 모듈 (펫 창 + 월드 공유). 모션 14종
- `static/js/vrm.js` — 데스크톱 펫 창
- `scripts/world-smoke.mjs` — 스모크 10항목 / `scripts/world-perf-probe.mjs` — 발열 계측 / `scripts/world-layout-sweep.mjs` — 배치 전수검사

## 1. 발열 불변식 (가장 중요 — 절대 어기지 말 것)
M 시리즈 맥북 발열로 대규모 수술을 했다. 새 코드가 지킬 것:
- **프레임 티어 60/30/15fps** (`frameIntervalMs()`): 말풍선·토스트는 `wakeSoft`(3~4초)만 — `wakeInput`(12초 타이머 리셋) 금지. pointermove는 movementX/Y≠0만 웨이크(터치는 pointerType으로 통과)
- **bare `M(color)`는 색상별 공유 재질** — material을 개별 변이(색 애니 등)하려면 반드시 `M(c, {unique:true})`
- **worldBake()** = 프롭 경계 넘는 크로스 병합. 원본은 visible=false로 숨김(제거 아님 — Raycaster는 visible 무시라 클릭 유지). 씬 레벨 정적물은 `WORLD_STATIC_ROOTS.push()`, 동적 비주얼 자식은 plotIdx/keyIdx처럼 서브트리 태그로 베이크 제외
- **꺼진 라이트는 scene.remove** (intensity 0 금지 — 포워드 셰이더는 라이트 수만큼 전 픽셀 과금)
- **파티클은 셰이더 Points만** (강수/분수/반딧불이 패턴 재사용). 스프라이트 생성/폐기 금지
- **오션 파도 = 버텍스 셰이더** (wxTime uniform). CPU 정점 애니 금지. `waveYAt()`/`tideOffset()`은 셰이더 상수의 CPU 미러 — 하나 바꾸면 셋 다 같이
- **포스트프로세싱 체인 재도입 금지** (GTAO/bloom 컴포저가 발열 주범이었음 — 단일 포워드 패스 + MSAA + 블롭 그림자 + 글로우 스프라이트)
- 스모크에 **draws ≤ 250 어서션** 있음. 넘으면 병합/베이크부터 의심

## 2. 레이캐스트 규칙 (실제 앱 프리즈 났던 것)
- 프롭 서브트리 레이캐스트는 반드시 `raycaster.camera = camera` 지정 + **isMesh 히트만 인정** (Sprite.raycast가 camera 없으면 null 크래시; Points는 invisible이어도 threshold 1m로 잡혀 허공이 바닥 됨)
- 핫루프 레이캐스트는 try/catch 가드
- **병합 베이크 메시는 레이캐스트 금지** (BVH 없음 — 수만 삼각형 브루트포스). 근처 프롭 "원본"에만 쏠 것 (propTopAt 패턴)

## 3. 배치(레이아웃) 규칙
- **PROPS 배열 순서 = 저장 id(타입-순번). 절대 재배열 금지, 새 프롭은 목록 끝에 추가**
- **좌표를 만지면 반드시 `node scripts/world-layout-sweep.mjs`** (겹침·섬이탈·도로침범·집 풋프린트·다리 기하 — 배치 리뉴얼 때 위반 77→0 만들고 커밋). 기준: 소품 페어 통로 0.5m+(가로등 0.3, 나무끼리 0.15), 다리목 노드 0.35+
- 섬을 옮기면 그 섬의 소품·FLAT_SPOTS·HILLS를 같은 델타로 동반 이동. 다리 공식: A=u·(본섬R−0.5), B=위성중심−u·(위성R−0.5), inner/outer=∓0.4u (u=중심선 단위벡터)
- 집 치수(HOUSE hw/hd/loftY) 바꾸면 world.js의 houseFloorY/houseBlocked 하드 상수 + makeHouse 지오메트리 1:1 동기
- 연못은 지형 함몰이라 이동 불가. FLAT_SPOTS는 지반을 0으로 누르는 얕은 크레이터 — 받침판은 패드 바닥에 직접
- terrainHeight는 rr≥r에서 0 — 섬 메시 최외곽 링은 r−0.002에서 샘플(아니면 테두리 톱니)
- 물에 고립된 저장 좌표는 로드 시 자동 폴백(islandOf+onBridge 게이트) — 섬 지형 바꿀 때 이 마이그레이션 믿고 진행

## 4. 펫 포즈/애니메이션 규칙
- 엔티티가 **매 프레임 팔다리(feet/wings/ears)와 wrap.rotation.x/z를 리셋** → 포즈 오버라이드는 엔티티 업데이트 *뒤에* 덮어쓰기만 하면 복원 자동
- **⚠️ wrap.rotation.y는 모션 종료 때만 π로 리셋** — 매 프레임 `+=`는 적분 누적(몸이 감김). 반드시 `= Math.PI + 값` 절대값으로
- **⚠️ AI 펫의 mover.position.y도 매 프레임 리셋이 없다** — 조종 펫만 서포트 클램프가 기준선을 복원. AI(busy) 펫에 `position.y +=`(폴짝 등)는 적분 누적으로 하늘로 솟고, 떠오르면 steerToward 턱 규칙(0.26)에 막혀 걷지도 못함. AI 대상 수직 오프셋은 `= playerSupportY(...).y + 오프셋` 절대값으로
- 앉기 포즈: 몸 기울임(tilt) 금지(사용자 3회 지적) — 몸 곧게 + feet rotation.x −1.35(다리 앞접기) + 몸 −0.06 가라앉히기
- 손에 드는 소품 오프셋은 절대 미터 금지 — **펫 키 비례(×height/0.85)** (낚싯대 선례). 펫 키: 병아리 0.4, 강아지 0.5
- mover(월드 위치·heading, forward=(sin,cos)) ⊃ wrap(모션 로컬, y=π가 정면)

## 5. 검증 워크플로우 (필수 루틴)
- **headed 브라우저 창 금지** — 전부 headless. Playwright는 `--use-angle=metal` 필수(없으면 SwiftShader 4fps)
- 순서: `node --check` → err-check(pageerror 0) → 기능 E2E → `node scripts/world-smoke.mjs`(10/10) → 필요시 스샷/perf
- `?stats=1` 디버그 훅 `window.__worldDev`: fishState/aiFishState/aiFishSnap/wrapDrift/tp/castAt/aim/petScreenXY/toast/scene/season 등. 새 기능 검증 훅은 여기에 추가
- 테스트 서버는 127.0.0.1:8897+ (앱 백엔드 3456과 분리). 폰 서빙용은 0.0.0.0:8765
- E2E에서 펫 조준: 기본 캠은 펫 북쪽 — 물은 화면상 펫 "아래"

## 6. Git/커밋 규칙
- **`git add -A` 절대 금지 — 항상 파일 명시** (config/world_*.json은 개인 플레이 데이터·gitignore — 사용자 소원/캡슐 문구가 커밋될 뻔했음)
- 커밋 전 `git status` 확인 (병렬 세션이 같은 리포에 커밋함 — 파일 수정 경고 시 재읽기)
- 매 커밋마다 CHANGELOG.md 최신 항목 추가(최신이 위) + 서술형 커밋 메시지
- 저장 키: world-layout(boat-2·car-1 포함, 서버 /api/world_layout 동기화), world-pets(8초+pagehide), world-fishdex, world-eco. 키 세대교체(boat-1→boat-2)가 저장값 리셋 수단

## 7. i18n
- `locales/{ko,en,zh}-*.js` + `t('key')||'中文'` — **키 누락이면 중국어가 노출됨**. UI는 한글, 프롬프트/로그는 영어
- 한자 스캔은 코드포인트 범위로 (정규식 리터럴 range는 한글 오탐)

## 8. 시스템별 핵심 포인터
- **낚시**: 상태기계 idle→cast→wait→bite(0.65s)→hook→reel→land/miss (`updateFishingInstance`). 리그는 `_fishGear` 캐시(재생성 금지). 절친 자율 낚시 소유권 = onArrive 클로저 정체성 + began 플래그 — 다른 디렉터가 goto/busy 덮어쓰면 즉시 endAiFishing. 도감은 주인 조과 전용
- **AI 디렉터**: releaseAI/gotoAsync/onArrive(막힘·10초 stall시 arrive-anyway — 데드락 없음), duoBusy가 듀오 연출 직렬화, ai.state: idle/walk/goto/busy/player/held
- **보트/차**: 콜라이더가 PROPS에 push됨(boat-2/car-1). 뭍에 찍힌 정박 저장은 무시
- **날씨/계절**: 조건부 컨텐츠는 fishConditionActive 패턴(밤 19~06시·wxF·season을 실월드로 판정)
- **베이크 리훅**: 공사모드 진입/종료, 계절 전환 시작/끝 — 새 리베이크 타이밍 필요하면 이 훅에 편승

## 9. 새 프롭 추가 체크리스트 (하나라도 빠지면 어딘가 깨짐)
1. `world-layout.js` PROPS **목록 끝**에 추가 (r = 차단 반경, 0 = 밟고 다님) → `node scripts/world-layout-sweep.mjs`
2. `world.js`에 빌더 작성 후 `PROP_BUILDERS`에 등록. 조형은 절차 생성만(외부 에셋 금지 — Kenney 킷 기각 이력). 그라디언트는 `bakeGrad`, 재질은 `M()`/gradMat 공유
3. 정적이면 `MERGE_TYPES`에 타입 추가. 움직이거나 토글되는 자식(깃발·시트 등)은 userData 태그로 베이크 제외
4. `PROP_KO`(한글명) + `HOVER_H`(호버 라벨 높이) + 호버 문구 맵 + 필요시 `BLOB_SIZE`(접지 그림자)
5. 공사모드로 옮겨도 되면 `MOVABLE_TYPES`에 추가, 평탄 지반 필요하면 FLAT_SPOTS(+follow)
6. 펫이 배회 목적지로 삼으려면 goto 화이트리스트(8600줄대 `goto: new Set`)에 추가
7. 상호작용(Ctrl/⌘)은 doInteract 분기, 클릭은 onGardenClick처럼 "히트 지점→최근접 대상 해석"(미세 픽킹 패드 의존 금지)
8. 라이트를 넣으면 꺼질 때 scene.remove (§1)

## 10. 자주 쓰는 패턴 포인터
- **UI 패널**: `memorialPanel(title)` 재사용(우편함/소원우물/타임캡슐/도감이 선례) — pointerdown/keydown stopPropagation 내장
- **독 버튼**: `dockBtn(emoji, title)` + onclick. 터치 타깃 48px 자동
- **아이콘 스냅샷**: 도감 패턴 — 1회 오프스크린 WebGLRenderer(96px)로 dataURL 캐시 후 `dispose()+forceContextLoss()` (발열 0)
- **효과음**: `playBuffer(buf, {vol, rate, filterFreq})` / 발소리는 지면 재질별(grass/road/wood/sand) 자동
- **LLM 연동**: 월드 상태는 `petStatusLine`/`buildWorldSnapshot`이 프롬프트로 들어감 — 새 활동 만들면 상태줄 한 줄 추가. 선제대화는 `maybeProactive(null, '이벤트 설명')`, 기록은 `logWorldEvent()`
- **프레임 루프 순서**: 엔티티 업데이트 → 포즈 오버라이드 계열(updateFishing 등) — 새 안무는 반드시 엔티티 뒤에 두어야 덮어쓰기가 됨
- **디버그 URL**: `?stats=1`(오버레이+__worldDev) `?hour=14` `?weather=clear` `?cam=px,py,pz` `?nomerge=1`(병합 이분탐색)

## 11. 모바일/멀티클라이언트
- 터치 분기는 **pointerType**으로 (UA 스니핑 금지). 독/버튼 터치 타깃 48px
- 조종 버튼 세로 순서: ✕ 해제 / 🦘 점프 / ✋ 상호작용 (스왑 이력 있음 — b9826ab)
- 폰 테스트: 정적 서버 **0.0.0.0**:8765 바인딩 (루프백 금지). E2E 테스트 서버는 127.0.0.1:8897+ (앱 백엔드 3456과 충돌 금지)
- 레이아웃 저장은 서버(/api/world_layout)+localStorage 이중화 — 폰·데스크톱이 공유

## 12. 남은 백로그 (미착수)
- 월드 채팅 TTS (최대 갭), 오락기 미니게임(NE섬 캐비닛+플래피), 낚시 Phase 3(병편지→우편함·전설 어종·대회)
- 퀄리티 잔여: Q2 길을 지면 텍스처에 굽기, Q3 나무 크라운 티어, Q6 광장 포석, Q7 스케일 보정
- 발열 잔여 아이디어: 간판·어닝 유니크 텍스처 아틀라스(-18콜), 포토보드·포탈 부분 베이크

## 14. ⭐ 고퀄리티로 만드는 법 (품질 방법론 — 낚시/모래놀이/집 리모델에서 검증됨)

**북극성 = 동물의 숲.** 사용자가 퀄리티를 판단하는 기준점. 막히면 "AC라면 어떻게 보일까"부터.

### 모션/안무 (낚시 9비트가 교과서 — updateFishingInstance 참조)
- **캔 모션 재활용 금지. 기능마다 전용 안무** — happy/think 돌려막기는 반드시 지적당함
- 상태를 **비트로 분해**: 준비동작(안티시페이션) → 본동작(오버슈트) → 감쇠 팔로스루. 예: 캐스팅 = 백스윙 멈칫(0.35s) → 스윙 오버슈트 → 감쇠 팔로스루
- **2차 모션이 절반**: 귀·날개·눈·부리·꼬리가 상태를 "연기"해야 살아있음 (릴링 = 몸 뒤로 + 좌우 버둥 + 낚싯대 휨 + 눈 커짐)
- **대기 시간에 微모션**: 지루한 wait에 갸웃·하품·20초 넘으면 앉아서 물멍 — 방치가 구경거리가 됨
- 스쿼시&스트레치(훅셋 0.15s), 랜딩은 상황별 3종(일반 자랑/월척 만세+폴짝/꽝 축 처짐)
- 포즈는 실무 게임 문법: 앉기 = 다리 접기(feet rot.x −1.35) + 몸 곧게 + 살짝 가라앉히기. tilt 금지

### 조형 (우체통/야자수/집 리모델이 교과서)
- **"덩어리 모음(blob-pile)" 탈피가 1원칙** — 프리미티브 쌓기 대신 통짜 프로파일: Extrude/Lathe + 베벨로 이음새 없이. 트렁크는 정점 벤딩 통짜(분절 금지)
- 정면에 **"얼굴"**을 만들 것: 문판·테두리·투입구·걸쇠 같은 정면 디테일이 소품의 인상을 결정
- 색은 단색 금지: `bakeGrad` 상하 그라디언트 + dapple 정점색 + 웜 베이지 팔레트(회색 금지)
- **비네트 소품**: 주 프롭 곁에 작은 이야기(징검돌·수건·찻잔·꽃링) — 프롭 그룹 자식으로 넣어 병합/공사모드 자동 호환
- 자연물은 **지터가 생명**: 인스턴스별 크기/키/기울기/색 흔들기 + 클러스터화(다발이 한 색). 난수는 seededRand(재현성)
- 물: 물비늘은 고주파+저진폭+패치 봉투(아니면 초록 격자 번짐), 기슭 여울 정점색, 하늘 스탑은 "보이는 띠"(UV 0.28~0.52) 기준

### 프로세스
- **퀄리티 패스는 랜드마크 단위**(잔디 전체·바다 전체·집 전체) — 소품 하나씩 찔끔 금지
- 유저에게 보이기 전 **헤드리스 스샷으로 자가 눈검사** (펫 클로즈업 clip 캡처) + E2E로 흐름 검증
- 중간에 앱 실행해서 보여주기 노노 — 사용자가 직접 켜서 확인함. 대신 검증을 완벽히
- 사용자 피드백은 같은 지점 2회 지적되면 접근 자체를 바꿀 것 (예: 앉기 float 3회 → 문법 자체 교체)

## 13. 과거에 기각된 것 (다시 제안하지 말 것)
- 외부 3D 에셋 킷(Kenney GLB) — 절차 생성 룩이 이김
- quad 풀잎 잔디 — 원뿔 3콘 다발이 최종 (자연화: 다발별 체격·키·기울기 지터)
- 나무 퍼프 변위·Lathe 트렁크 — 원래 매끈한 구+원기둥 형태 유지, 질감은 dapple 정점색만
- 앉기 자세의 몸 기울임(tilt), 포스트프로세싱 컴포저, 스프라이트 파티클, 매 프레임 computeVertexNormals
