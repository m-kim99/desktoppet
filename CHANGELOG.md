# Changelog

Personal fork of super-agent-party, customized for Korean-language desktop use.
Patch notes go here — newest on top.

## [Unreleased]

### Changed (퀄리티 패스 ② — 지면·스캐터 🌿)
- **길 테두리 굽기**: 리본 UV의 폭 방향(y 0..1)에 맞춰 pathTex에 가장자리 어둠띠 + 은은한
  중앙 밟힘 하이라이트를 구웠다 — 모든 길·스포크가 잔디 위 스티커가 아니라 "파인 길"로
  읽힌다. 지오메트리·드로우콜 변화 0.
- **잔디 저주파 얼룩**: 섬 버텍스 컬러에 2~3m 붓터치의 웜/쿨 그린 패치를 추가 — 균일한 초록
  카펫 느낌이 깨지고 프롭이 지면에 앉는다. 곱셈 틴트라 계절/설원과 그대로 합성.
- **스캐터 클러스터화**: 잔디 콘 380개 균일 랜덤 → 68다발×4~7포기, 들꽃 75송이 → 17다발×3~6송이
  **한 다발 = 한 색**(진짜 화단처럼). 길/광장/프롭 회피는 기존 스팟 로직 그대로.

### Changed (퀄리티 패스 ① — 동숲식 조형: 최근 6종 리모델링 🎨)
- **그라디언트 굽기 범용화(`bakeGrad`)**: 나무 잎에만 있던 "위-밝음/아래-어두움 버텍스 램프"를
  아무 지오메트리에나 굽는 유틸로 일반화. 공유 재질(gradMat/gradMatWood/양면 gradMatDS)이라
  병합 후 프롭당 드로우콜도 줄어든다 (전체 430→399). 인스턴스드 장식(잔디 콘·들꽃 머리·자갈·
  심은 꽃 머리)에는 흰~회 루미넌스 램프를 구워 — instanceColor·계절 틴트와 곱해져 색은 그대로,
  밑동만 자연스럽게 그늘진다.
- **분수 재조형 + 이전**: 원기둥 스택 → Lathe 곡선(도톰하게 말린 립·잘록한 받침·치맛단은 지면
  아래로). 물방울 착수점도 수면 높이로 보정. **자리도 남쪽 뜰(0.4,-4.3)로 이전** — 원래 자리는
  자동차 기본 주차(2.5,-1.35)와 정면충돌 + 도로 링에 가장자리가 걸려 있었다(마지막 6종 겹침
  검사에 차/도로가 빠졌던 것).
- **우편함 재조형**: 테이퍼 기둥+발치 둔덕, 통통한 몸통 위 돔 뚜껑, 볼록한 투입구·손잡이.
  깃발 피벗/애니메이션은 그대로.
- **운동 공간 재조형 + 지형 패드**: 매트 더 도톰+큰 라운딩+그라디언트, 바는 그네와 같은 나무
  언어(테이퍼 기둥+둥근 캡+꿀색 봉), 아령은 통통한 코랄/민트 볼. **FLAT_SPOTS에 gym 패드 추가**
  — 구릉이 매트를 뚫고 올라오던 기존 문제 수정 (그네·시소 패드와 같은 원리).
- **도서관 재조형**: 책장 그라디언트+크라운 몰딩, 책은 더 통통하게·살짝 기울여(전부 재질 공유
  → 병합 시 1콜), 방석 더 둥글게. 좌석 좌표 불변.
- **꽃바구니 재조형**: 배불뚝이 Lathe 바구니+말린 테+속 채움판+큼직한 꽃송이·잎.
- **`?cam=px,py,pz[,tx,ty,tz]` 프리뷰 카메라**: `?hour=`처럼 개발용 — 소품 클로즈업을 헤드리스
  스크린샷으로 검증할 때 쓴다.

### Optimized (발열 잡기 🔋 — 같은 그림을 반값에)
- **펫 창 프레임 페이싱**: 데스크톱 펫(vrm.html)의 rAF가 무제한이라 ProMotion 맥북에서
  하루 종일 120fps로 돌던 것을 월드와 같은 게이트로 교체 — 활동 중(포인터·모션 재생·
  말하기·VMC·XR)엔 60fps, 가만히 숨 쉬는 idle은 30fps. 픽셀비도 2x로 캡. 호버 자동 숨김
  중(캔버스 opacity 0)엔 보이지 않는 프레임을 아예 그리지 않는다.
- **월드 입력 idle**: 창이 포커스여도 12초간 입력이 없으면 30fps 구경 모드, 입력 즉시
  60fps 복귀. 저더가 제일 잘 보이는 카메라 조작은 입력 그 자체라 언제나 60fps고, 펫이
  말을 걸어오면(말풍선·토스트) 잠깐 깨워서 대답 모션이 매끄럽게 보인다.
- **그림자 30Hz**: 그림자 맵(2048² PCFSoft)을 매 프레임 굽던 것을 2렌더에 1번으로 —
  캐스터 전부를 다시 그리는 depth 패스 비용이 반값, 소프트 블러 안이라 차이는 안 보인다.
- **바다 법선 해석적으로**: 매 프레임 4,600버텍스 computeVertexNormals(9천 삼각형 순회 +
  면 평균) → 파고 사인의 도함수로 직접 계산. 훨씬 싸고, 근사가 아니라 정확한 값이라
  스페큘러 반짝임이 오히려 매끈해졌다.
- **분수 물방울 GPU화**: 초당 20개 Sprite 생성/폐기 + 방울당 드로우콜(동시 ~24) → 강수
  패턴을 재사용한 Points 하나(드로우콜 1, CPU 0). 버텍스 셰이더가 방울마다 포물선
  (p = v·t − ½g·t²)을 제 수명 주기로 돌린다 — 분포·크기·색 동일.
- **꽃밭 인스턴싱**: 심은 꽃 송이당 메시 2개(+개별 재질) → InstancedMesh 둘(줄기·머리,
  머리 색은 instanceColor). 150송이 만발해도 드로우콜 2.
- **정적 병합**: 프롭 26종(집·울타리·부스·동굴·도서관·그네 프레임…)의 절대 안 움직이는
  부품을 재질 인스턴스별로 병합하고 구름 20로브도 1메시로. 그네 시트·시소 플랭크·우편함
  깃발·피아노 건반·텃밭 칸·눈모자처럼 움직이거나 토글되는 부품은 자동 제외 — 클릭 판정·
  공사모드·계절 틴트 전부 이전과 동일. 결과: **드로우콜 540→430 · 씬 오브젝트 884→731**
  (같은 카메라 기준). 이제 프롭이 늘어도 프레임 비용이 훨씬 완만하게 는다.
- **계측 오버레이**: ⚡ 버튼 더블클릭(또는 `?stats=1`)으로 fps · 드로우콜 · 트라이앵글 ·
  오브젝트 수를 왼쪽 위에 표시 — 다음 최적화의 전후 비교용.

### Added (마지막 6종 — 우편함 📮 · 운동 공간 🧘 · 도서관 📚 · 분수 ⛲ · 꽃심기 🌸 · 반딧불이 ⭐)
- **본섬 확장 (5.2→5.6) + NE 놀이터 섬 확장 (2.2→3.2)**: 밀도가 높아진 본섬에 서쪽 뜰을 새로
  열어 도서관을 앉혔고, 운동 공간은 그네·시소가 있는 NE 놀이터 섬으로 보내 한 존으로
  묶었다 — 이번 배치는 좌표 겹침·섬 이탈 여부를 스크립트로 전수 검사해 확정했다.
- **우편함**: 집 앞길의 빨간 우편함. 클릭해서 편지를 넣으면 병아리·강아지가 함께(서버
  LLM, 둘의 말투가 번갈아 섞인 답장) 편지를 쓰고 4~12분 뒤에야 "배달"된다 — 도착하면
  깃발이 서고 알림이 온다. 편지함은 서버(`config/world_mail.json`)에 남아 다시 읽을 수
  있다.
- **운동 공간**: 요가 매트 둘 + 스트레칭 바 + 아령. 매트 클릭 = 가까운 펫이 와서 스트레칭,
  조종 중 ⌘ = 내 펫이 직접, 한가할 땐 스스로도 한다. **스트레칭(Stretch) 신규 제작 —
  16번째 모션**: 위로 쭉 폈다가 좌우로 기울이고 탈탈 터는 4단계.
- **도서관 코너**: 책장(색색의 책 3단) + 독서 의자 둘(sit-침대) + 독서등. 앉으면 앞에 책이
  펼쳐지고 가끔 골똘히 생각에 잠긴다(💭). 조종 중 ⌘ = 내 펫이 바로 앉아 읽고, 자율
  독서는 2~4분 후 스스로 일어난다.
- **분수**: 자체 돌 둘레+물그릇을 갖춘 독립 분수 (기존 수영 연못과 겹치지 않게 별도 배치).
  물방울이 끊임없이 솟아 떨어지고, 가까이 가면 잔잔한 물소리가 커진다.
- **꽃 심기 챌린지**: 바구니를 클릭해 심기 모드를 켜고 잔디를 클릭하면 그 자리에 꽃 한
  송이 — 100송이를 심으면 축포와 함께 챌린지 달성. 심은 꽃은 서버
  (`config/world_flowers.json`)에 남아 어느 기기에서나 같은 꽃밭을 본다.
- **반딧불이**: 연못가에 초록 불빛 두 무리가 떠다니며 어긋난 위상으로 깜빡인다 — 강수
  Points 셰이더를 그대로 재사용(느린 낙하+큰 스웨이=떠다님)해 발열 비용이 사실상 0이고,
  깊은 밤 + 맑은 하늘에서만 떠오른다.

### Added (본섬 생활 4종 — 텃밭 🥕 · 피아노 🎹 · 사진 게시판 📌 · 별자리 ⭐)
- **텃밭**: 예약돼 있던 북서 뜰에 2×2 나무 밭. 빈 칸 클릭 = 씨앗 심기(당근·토마토·해바라기
  중 랜덤), 자라는 중 클릭 = 물주기(다음 단계까지 절반 단축, 단계당 1회), 다 자라면 클릭 =
  수확(반짝+펫이 좋아함). 성장은 실시간 — 씨앗→새싹 1시간, 새싹→수확 4시간. 상태는 서버
  (`config/world_garden.json`)라 폰·데스크톱이 같은 밭을 본다.
- **피아노**: 서쪽 잔디의 8건반 무지개 미니 피아노. 건반 클릭 = 그 음(건반이 폭 눌리는 애니
  +2겹 오실레이터), 몸통 클릭 = 가까운 펫이 걸어와 춤추며 펜타토닉 즉흥곡 연주, 조종 중
  ⌘ = 내 펫이 직접 연주. 한가할 때 스스로 한 곡 치기도 한다.
- **사진 게시판**: 집마당가 코르크 보드에 최근 스크린샷 6장이 핀으로 꽂힌다 (📷로 찍으면
  즉시 갱신). 클릭하면 라이트박스로 크게 — ◀ ▶로 전체 앨범 넘기기. 새 엔드포인트
  `/api/screenshots_list` + `/screenshots` 정적 마운트.
- **별자리 만들기**: 밤에 전망대를 클릭하면 별 잇기 모드 — 별을 차례로 탭해 잇고 이름을
  붙이면 그 별자리가 이름표와 함께 **매일 밤 하늘에 남는다** (서버
  `config/world_constellations.json`, 별과 함께 뜨고 진다). 이를 위해 별밭을 고정 시드로
  바꿔서(한 번의 배치 변화) 저장된 좌표가 부팅을 넘어 유효하다. Esc 취소.
- 부스러기: 클릭 디스패치가 히트 정보를 넘겨 자식 메쉬(밭 칸·건반)를 판별하고, 텃밭·피아노는
  `<goto=garden|piano>` 태그와 공사 모드 이동을 지원한다.

### Added (모험의 섬 5단계 — 워프 포탈 🌀, 섬 완성)
- **돌링 포탈 한 쌍**: 광장가 ↔ 모험의 섬. 링 안에서 청록→보라 나선이 도는 소용돌이
  셰이더(드로우콜 1)가 일렁이고, 통과하면 양끝에서 반짝이가 터지며 슝— 하는 스윕음이 난다.
- **펫도 지름길을 안다**: 경로 빌더가 걷는 길(다리 경유)과 포탈 경유를 비교해서 확실히
  짧을 때만 포탈 웨이포인트를 심는다 — "보물 파러 가자"라고 하면 광장에서 포탈로 쏙.
  조종 중인 펫은 소용돌이에 들어서면 바로 넘어간다(운전 중 제외, 2.5초 쿨다운).
- 이것으로 모험의 섬 6단계 완성: 언덕·동굴·전망대·비 피신·보물찾기·포탈.

### Added (모험의 섬 4단계 — 보물찾기 ⛏️ + 새 코디 2종)
- **매일의 보물**: 모래밭의 X 세 곳 중 매일 한 곳이 은은하게 반짝인다. 조종 중인 펫을
  데려가 ⌘/✋로 파거나, 채팅으로 "보물 파러 가자"(`<game=treasure>`)라고 시키면 펫이 달려가
  파내고, 15분에 한 번쯤은 펫이 스스로 발굴하러 가기도 한다(하루 한 번).
- **파기(Dig) 모션 신규 제작** — 15번째 모션: 웅크렸다가 좌우 갈퀴질(병아리 = 날개 갈퀴질
  + 부리 콕콕, 강아지 = 몸통 리듬 + 신난 꼬리 + 펄럭 귀), 흙먼지가 튀고, 끝나면 만족스럽게
  몸을 편다. 펫 창 모션 메뉴에서도 쓸 수 있다.
- **보상 = 코디 언락**: 첫 보물은 👒 밀짚모자, 둘째는 🎀 리본(신규 제작 액세서리 2종 —
  산타모자와 같은 시스템), 다 모으면 반짝이는 동전. 잠긴 코디는 메뉴에 🔒 ???로 보이고
  발굴하면 열린다(산타모자는 기존대로 항상 열려 있음). 발굴은 이벤트 로그에 남고 펫이
  자랑하러 오기도 한다.

### Added (모험의 섬 3단계 — 비 피신 ☔, 보류했던 날씨 펫 반응 v2)
- **비를 피하는 펫들**: 비나 뇌우가 내리기 시작하면 한가한 펫들이 동굴 쿠션(자리가 없으면
  집 소파)으로 뛰어가 앉아서 기다리고, 날이 개면 스스로 일어나 나온다. 눈은 예외 — 눈밭
  산책은 낭만이니까. 식사·탑승·조종·듀오 중인 펫은 양보하고(숨바꼭질에서 확립한 선점
  규칙), 이동·착석·기상은 전부 기존 침대 시스템 표준(mountBed/bedExit)을 재사용해서 전용
  코드가 30줄이 안 된다. 피신은 이벤트 로그에 남아 펫의 기억이 된다.

### Added (모험의 섬 1단계 — 동굴 🕳️)
- **아늑한 바위 동굴**: 언덕 남서면 포켓에 고인돌풍 바위 셸이 앉았다 — 두꺼운 셸이 해를
  등지고 스스로 내부에 그림자를 드리워서(별도 렌더 트릭 없이) 낮에도 어둑하고, 호박빛
  랜턴이 불꽃처럼 일렁이며 그 안을 데운다. 러그 위 쿠션 두 개는 앉는 침대로 등록돼 조종
  중 ⌘/✋로 앉을 수 있고, 다음 단계의 비 피신 자리가 된다(shelter 플래그).
- **연동**: 셸 바위별 충돌원(입구만 뚫림), `<goto=cave>` 태그, 위치 스냅샷 "동굴 안",
  숨바꼭질의 대형 엄폐물, 겨울 눈모자. 지형(평탄 패드+언덕 절개)과 한 몸이라 공사 모드
  이동은 불가.

### Added (모험의 섬 0단계 — 네 번째 섬 + 언덕 지형)
- **모험의 섬**: 남동쪽에 위성 최대 크기(반지름 3.5)의 새 섬이 떴다 — 본섬 남동 럼에서 세
  번째 다리로 연결(경로·다리 메쉬·배회 노드 자동 편입). 다리목 가로등, 해안 큰 나무, 새
  프롭 타입 '바위(boulder)' 셋(언덕 크래그·평지·완사면)으로 기본 드레싱. 강수 실린더도
  네 섬을 덮게 반경 12.5→14로 확장.
- **언덕(HILLS) 지형**: terrainHeight에 데이터 기반 고원형 봉우리가 생겼다 — 정상부 35%는
  평평(전망대 자리), 사면은 펫이 그냥 걸어 오르는 완경사. 평탄 패드(FLAT_SPOTS)가 언덕도
  눌러서 남서면에 동굴 포켓(1단계 예정)의 절개 벽이 자연히 생긴다. 계절 시스템(설원·짚빛)
  이 언덕에도 그대로 적용된다.

### Changed (상호작용 문법 통일 — "세상은 클릭, 펫 몸은 ⌘")
- **호버 프롬프트 (Roblox式)**: 마우스를 소품에 올리면 그 자리에서 라벨이 떠서 무엇이 되는지
  알려준다 — "🪙 소원 빌기 · 클릭", "💡 가로등 밝기 50% · 클릭", "🛝 그네 — 조종 중 ⌘/✋로
  타요". 클릭형은 커서도 손가락으로 바뀐다. 어떤 소품이 클릭인지 ⌘인지 외울 필요가 없어졌다.
  (레이캐스트는 초당 ~8회만 — 발열 예산 준수. 터치는 마크처럼 탭=실행이라 라벨 없음)
- **클릭 승격 (심즈式)**: 스위치·패널류는 이제 조종 없이도 클릭 — 라디오(패널), 가로등(밝기
  사이클+토스트), 커피/간식 부스(주문 패널). 부스에서 고르면: 조종 중인 펫이 부스 옆이면 바로
  받고, 아니면 **한가한 펫이 부스까지 걸어가 대신 받아온다**.
- **⌘ 병행 유지 (마크式)**: 기존 ⌘/✋ 경로는 전부 그대로 — 탑승·운전·손잡기는 여전히 펫의
  몸으로, 라디오·부스도 ⌘ 근접 주문이 계속 통한다. 규칙은 한 줄: 만지고 싶으면 클릭,
  태우고 싶으면 ⌘.

### Added (추억의 섬 — 쪼아쪼아나무 💗 · 소원우물 ⛲ · 타임캡슐 🕰️ + 기념비 이사)
- **SW 위성섬이 "추억의 섬"으로**: 반지름 2.0→2.9로 넓히고 중앙에 평탄한 뜰을 깔았다.
  베프 기념비가 광장에서 이 섬으로 이사해(다리 쪽을 바라봄) 다리를 건너 만나러 가는
  우리만의 성지가 됐다. 포옹 포인트는 광장에 그대로.
- **쪼아쪼아 나무**: 사시사철 장미빛 하트잎 캐노피에 하트 열매 다섯 알(겨울엔 눈모자만).
  클릭하면 "쪼아쪼아~" 네 번의 쪼기 소리와 하트가 반짝, 두 펫이 나무 아래 모이면 하트가
  터지며 포옹으로 이어진다(7분 쿨다운).
- **소원 우물**: 지붕 달린 돌우물. 클릭하면 소원 패널 — 소원을 적고 🪙 동전 던지기를 누르면
  금화가 포물선을 그리며 퐁당(물소리+반짝), 소원은 서버(config/world_wishes.json)에 쌓여
  언제든 다시 읽을 수 있다. 펫이 "무슨 소원일까" 궁금해하기도 한다.
- **타임캡슐**: 흙무덤에 반쯤 묻힌 상자. 미래의 우리에게 남길 말과 개봉 날짜를 정해 묻으면
  🔒 D-n으로 잠겨 있다가, 날이 오면 🎁 열어보기로 개봉(축포+기록). 열 때가 된 캡슐이 있으면
  월드가 알려주고 펫이 먼저 들썩인다. 저장은 config/world_capsules.json.
- **연동**: 셋 다 공사 모드로 옮길 수 있고, `<goto=pecktree|well|capsule>` 태그·위치 스냅샷·
  숨기 스팟(나무·우물 뒤)에 등록됐다. 새 엔드포인트 GET/POST `/api/world_wishes`·
  `/api/world_capsules`.

### Added (월드 광장 세트 — 베프 기념비 🗿 + 포옹 포인트 💕, P1 완성)
- **베프 기념비**: 처음부터 예약돼 있던 중앙 광장 북쪽 자리에 섰다 — 돌 받침 두 단 위 비석에
  "🐕🐣 베프 포에버 💕" 각인 판, 꼭대기엔 분홍 하트. 월드를 열면 제일 먼저 보이는 마을의
  중심이다. 숨바꼭질에서 기념비 뒤에 숨을 수도 있다.
- **포옹 포인트**: 기념비 바로 앞(광장 남쪽)에 하트 바닥 + 은은하게 숨쉬는 빛의 링. 두 펫이
  같이 올라서면 하트·반짝이가 터지며 자동 포옹이 시작되고 4음 아르페지오가 울린다(5분
  쿨다운 — 자주 터지면 마법이 아니니까). 주인이 조종해서 데려간 경우엔 조종을 뺏지 않고
  절친이 하트 포즈로 화답한다. 광장은 펫 통행량이 가장 많은 곳이라 우연한 자동 포옹이
  실제로 일어난다.
- **연동**: 둘 다 공사 모드로 옮길 수 있고(포옹 판정·꽃잎 링도 따라감), `<goto=monument|
  hugspot>` 태그와 위치 스냅샷("베프 기념비 근처")에 등록돼 펫이 그 자리를 안다. 광장
  정중앙에 살던 스포츠카는 남동쪽 길가로 기본 주차를 옮겼다(끌어서 재배치 가능).

### Added (월드 그림일기 📔)
- **펫이 쓰는 하루**: 밤 10시가 넘으면 병아리와 강아지가 각자 그날의 그림일기를 쓴다 — 하루
  동안 이벤트 로그에 쌓인 일들(밥·낮잠·그네·드라이브·날씨·숨바꼭질…)만 가지고, 페르소나와
  주인과의 장기기억(world_chat 요약)을 얹어 1인칭 4~6문장 + 마지막 줄 '기분: …'으로. 없던
  일은 지어내지 않는다.
- **노트 패널**: 독의 📔 버튼이 종이 노트 스타일 패널을 연다 — ◀ 날짜 ▶ 넘기기, 🐤/🐶 탭,
  오늘 일기는 ✍️ 버튼으로 먼저 쓰거나 다시 쓸 수 있다. 집 탁자 위에 조그만 일기장 소품도
  올라갔다.
- **보관**: 서버 `config/world_diary.json`에 날짜·펫별 저장(공사 레이아웃과 같은 방식 — 폰/
  데스크톱 공유, localStorage 초기화에도 살아남음). 새 엔드포인트 GET/POST `/api/world_diary`,
  같은 날 재요청은 저장본 반환. 일기 재료가 되도록 이벤트 로그 보관량을 40→120개로 늘렸다.

### Added (월드 숨바꼭질 🙈)
- **한 판의 흐름**: 술래가 광장 가운데서 눈을 가리고 머리 위로 숫자를 세면(10초), 상대는
  술래 반대편 프롭 뒤 — 나무·집·부스·그네·시소·울타리·라디오 — 로 뛰어가 숨는다. 술래는
  숨을 만한 자리들을 가까운 곳부터 순찰하고, "발견"은 거리 + 시야 원뿔 + **시선 판정**을
  모두 통과해야 한다. 시선은 펫이 부딪히는 것과 같은 프롭 충돌원에 대고 샘플링해서, 걸음을
  막는 것이 시야도 막고 공사 모드로 옮긴 배치도 그대로 반영된다. 찾으면 ❗와 함께 달려가
  응원 세리머니, 90초를 버티면 숨은 쪽 승리.
- **주인도 숨는다**: 펫을 조종 중일 때 시작하면 주인이 숨는 쪽 — 술래가 15초 세는 동안
  직접 뛰어가 숨는다. 집 안에 숨으면 술래가 들어와야 보이고(벽 너머로는 안 보임), 들키면
  "들켰다! 😆", 버티면 승리 토스트. 결과에 따라 술래가 먼저 말을 걸어오기도 한다.
- **세 가지 시작**: 펫 우클릭 메뉴의 🙈 숨바꼭질, 채팅 행동 태그 `<game=hideseek>`(펫에게
  "숨바꼭질 하자"라고 하면 됨), 그리고 둘 다 한가한 낮에 아주 가끔 스스로 한 판. 식사·취침·
  탑승·드라이브 중이거나 공사 모드면 시작하지 않고, 도중에 술래를 조종하면 판을 접는다.
  모든 판은 이벤트 로그에 남아 펫의 기억이 된다.

### Added (월드 오로라 — 특별한 밤)
- **오로라 커튼**: 초록→보라로 물드는 셰이더 커튼 두 장이 섬 뒤 밤하늘에 호를 그리며 일렁인다
  (이 월드의 첫 커스텀 셰이더 — 가산 블렌딩이라 별은 그대로 비친다). 맑은 밤에만 보이고,
  구름이 끼거나 해가 뜨면 스르르 사라진다. 기본 카메라에선 수평선 위로 하단이 걸리고, 시점을
  낮춰 하늘을 올려다보면 커튼 전체가 보인다. 발열 예산: 드로우콜 2개, 풀스크린 작업 없음.
- **자동 + 수동**: 자동 모드의 맑은 밤에 ~8분마다 추첨해 가끔(14%) 6~11분짜리 오로라가 뜨고
  (이벤트 로그 기록 + 강아지가 먼저 알려줄 수도), 🌦️ 패널의 오로라 항목으로 언제든 고정할 수
  있다(밤이 되면 나타남). `?weather=aurora` 미리보기. 채팅 스냅샷에도 반영되어 펫이 오로라를
  안다.

### Fixed (월드 날씨 패널 — 창 뚫림)
- **패널이 창 밖으로**: 날씨+계절 항목이 10개가 되면서 위로 자라는 패널이 작은 창에선 천장을
  뚫었다. 열 때마다 버튼 위 공간에 맞춰 최대 높이를 잡고 넘치면 스크롤하며, 행 패딩·글자도
  한 단계 줄였다.

### Added (월드 계절 — 봄벚꽃·여름·가을단풍·겨울눈)
- **사계절 시스템**: 기본은 실제 달력(3~5월 봄 / 6~8월 여름 / 9~11월 가을 / 12~2월 겨울),
  🌦️ 패널 하단의 계절 줄에서 수동 고정도 된다(계절은 모드라서 저장됨; `?season=` 미리보기).
  전환은 2.5초 크로스페이드 — 잎 버텍스 컬러를 통째로 리베이크하고 잔디·데코·바다·하늘을
  함께 갈아입힌다. 여름이 원본 룩.
- **가을**: 나무마다 금빛/주황/빨강 중 하나로 물들고(잎사귀 로브별 밝기 변주), 잔디는 짚빛,
  풀포기는 호박색, 은은한 낙엽이 하늘에서 진다. **겨울**: 잔디 텍스처가 설원으로 바뀌고
  캐노피와 집 지붕에 눈모자·눈이불이 얹히며, 꽃·풀포기는 눈 밑으로 사라지고 조약돌·바다·
  반사광이 차가워진다(접지 그림자도 옅게). 자동 날씨의 강수도 계절을 따라 겨울엔 눈.
- **벚꽃나무 (P1 ③)**: 남쪽 잔디에 대형 벚나무가 새로 심겼다 — 봄이면 분홍으로 만개하고
  나무 주변에 꽃잎이 흩날린다(나무-로컬 파티클이라 공사 모드로 옮겨도 따라간다). 여름엔
  초록, 가을엔 주홍, 겨울엔 창백한 가지색.
- **계절 낮 길이**: 일출·일몰이 계절을 따른다 — 여름 5:20~19:35, 겨울 7:20~17:25. 태양·달
  궤적, 황혼 글로우, 가로등 점등이 전부 이 창에 맞춰 움직인다.
- **펫 연동**: 채팅 스냅샷의 계절이 수동 계절을 반영하고, 주인이 계절을 바꾸면 이벤트
  로그에 남아 펫이 먼저 말을 걸 수도 있다.

### Changed (월드 날씨 — 켜면 맑음)
- **첫 화면은 항상 맑은 하늘**: 월드를 열면 무조건 맑음으로 시작한다 — 첫 자동 강수는 10~25분
  뒤에나 온다. 기존에는 스케줄러 초기화 버그(첫 맑음 에피소드의 만료 시각이 0이라 첫 프레임에
  바로 비로 굴러감)에 더해, 지난 강수 에피소드와 🌦️ 수동 선택이 저장돼 있다가 재시작 때
  복원되면서 켜자마자 비가 오곤 했다.
- **날씨는 세션 한정**: 🌦️ 버튼 선택을 포함해 창을 닫으면 날씨는 리셋되고, 다시 열면 늘
  맑음+자동 모드다. `?weather=` 미리보기는 그대로 동작하고, 예전 저장 키는 부팅 때 정리한다.

### Added (월드 펫 목소리 — 짹짹·멍멍)
- **울음소리 합성**: 빗소리·엔진음처럼 파일 없이 WebAudio 합성(sfxMaster 공유, 350ms 중복
  방지). 채팅 대답(말풍선과 동시)·메뉴의 인사(Wave)·행동 태그 인사에서 운다.
- **자연스러운 v2**: 병아리는 FM 트릴 + 몸통 공명(밴드패스)을 얹은 2~3연음 삐약, 강아지는
  톱니 성대를 두 포먼트('아' 모음 성도)로 울리고 노이즈 숨을 섞은 "왕!". 매번 음높이·길이·
  횟수·간격이 살짝 달라져 반복 티가 안 난다.
- **실녹음 우선 재생**: `static/sounds/voice/{chick|puppy}_{0..2}.(ogg|mp3)`를 넣어두면 자동
  감지해 합성 대신 재생한다(재생마다 피치 ±6% 랜덤). 진짜 소리가 필요하면 CC0 녹음을 그 이름
  으로 떨어뜨리면 끝.

### Fixed (월드 대화 패널 — 기억 초기화 버튼)
- **탭처럼 보이던 파괴 버튼**: 💬 패널 헤더의 "🧹 병아리/강아지"가 펫별 로그 전환 탭처럼 보였지만
  실제로는 기억 전체 초기화 버튼이었다. 하단의 "🧹 기억 초기화:" 줄로 내려 오해를 없앴다.
- **OS confirm() 제거**: 네이티브 확인창은 렌더 루프까지 멈추는 차단 다이얼로그라(월드가 통째로
  얼어붙음) 인페이지 2단 확인으로 교체 — 한 번 누르면 빨갛게 "정말요? 다시 탭"으로 바뀌고 2.5초
  안에 다시 누르면 실행된다.
- **초기화 피드백**: 성공 여부(res.ok)를 확인하고, 로그에 "— 기억이 초기화됐어요 —" 시스템 줄을
  남기며, 이름 생략 시 대화를 이어받던 연속성(responder)도 함께 리셋한다.

### Added (월드 채팅 P3 — 먼저 말 걸고, 둘이 떠들고, 더 놀 줄 아는 펫)
- **선제 대화**: 특별한 순간에 펫이 먼저 말을 건다 — 오랜만에(3시간+) 월드에 돌아왔을 때,
  비/눈이 내리기 시작할 때(주인이 날씨 버튼으로 바꾼 경우 포함), 비 갠 뒤 무지개가 떴을 때
  (수영 좋아하는 병아리 담당), 공사 모드로 배치를 바꾸고 나왔을 때. 8분 쿨다운에 대화·공사
  중이거나 창이 백그라운드면 건너뛰어 호출을 아끼고, 말을 건 계기는 서버 대화 기록에 남아
  펫의 기억으로 이어진다.
- **절친 거들기**: "얘들아"처럼 무리로 부르거나 두 이름을 다 부르면 반드시, 이름 없이 말하면
  가끔(35%) 다른 펫이 첫 펫의 대답을 들은 것처럼 한마디 얹는다 — 첫 말풍선의 타자 연출이
  끝날 즈음 이어받아 사람처럼 티키타카가 된다.
- **행동 태그 2종 추가**: `<swim=pond|sea>` — 기존 물놀이 시스템을 재사용하되 이제 연못
  첨벙/절벽 다이빙을 골라 지시할 수 있다. `<drive=car>` — 차까지 걸어가 올라타고 잠깐 스스로
  몰다가 내리는 자율 드라이브. 차 물리를 stepCar()로 추출해 키보드/조이스틱 조종과 공유하고,
  벽에 막히면 핸들을 반대로 꺾는다. 운전 중인 펫을 조종하면 그대로 수동 운전으로 넘어온다.

### Added (월드 공사 모드 — 동물의 숲식 사물 옮기기)
- **🔨 독 버튼 → 공사 모드**: 사물을 누르면 살짝 떠올라 손가락/마우스를 따라오고, 바닥 링이
  초록/빨강으로 배치 가능 여부(다른 사물과 겹침 · 물 · 섬 밖)를 실시간으로 보여준다. 못 놓는
  곳에 놓으면 원래 자리로 되돌아가고, 빈 땅 드래그는 평소처럼 카메라 회전 — 모바일 터치 동일.
- **상단 툴바**: ↺ 45° 회전 · 원위치 · 전부 원위치 · ✓ 완료(저장). Esc로도 종료. 진입하면 조종을
  풀고 펫을 전부 하차시키며, 공사 중엔 탑승(mountBed)이 잠긴다.
- **이동 대상 13종**: 나무 · 그네 · 시소 · 커피/간식 부스 · 라디오 · 가로등 · 선베드 · 해먹 ·
  밥그릇 · 울타리 · 자동차 · 집. 놓는 순간 충돌 원, 그네/시소/침대 탑승 좌표(bakePropBeds 재굽기),
  블롭 그림자, 가로등 불빛, 집 내부 파생물(가구 콜라이더 · 소파 · 2층 침대 · 실내등)이 함께
  이사한다 — 펫 AI는 라이브 참조라 새 위치로 알아서 찾아가고, 옮긴 사실이 월드 이벤트 로그에
  남아 펫이 대화에서 알아챈다. 집은 이동만(회전축 상수는 로드 시 고정), 연못은 지형 함몰이라 고정.
- **저장·복원**: 배치를 id(타입-순번)→{x,z,rotY}로 서버 `/api/world_layout`
  (config/world_layout.json — 폰·데스크톱 공유) + localStorage 폴백에 저장한다. 시작 시 씬을 짓기
  **전에** PROPS/HOUSE/FLAT_SPOTS에 덮어써서 지형 패드·탑승 좌표·그림자가 전부 새 위치 기준으로
  구워진다(그네·시소·집의 평탄화 패드는 follow 태그로 프롭을 따라감 — 리로드 후 적용).

### Added (월드 채팅 P1·P2 — "아는" 펫, "움직이는" 펫)
- **월드 전용 채팅 세션 (P1)**: 월드 채팅이 메인 UI 에이전트 원격조종(`/ws` 타이핑 → TTS 청크
  엿듣기)에서 전용 백엔드 `/api/world_chat`로 완전히 분리됐다. 펫별 대화 히스토리 + 페르소나
  (병아리 🐤 텐션 높은 호기심 대장 / 강아지 🐶 느긋한 맏형)가 서버에 살고, 대화가 30개를 넘으면
  오래된 절반을 LLM이 350자 요약으로 접어 장기기억화(Generative-Agents-lite). 이름을 안 부르면
  직전 대화 상대가 이어받고, 답장은 말풍선 타자기 연출로 표시(TTS는 나중에). 💬 독 버튼 =
  세션 대화 로그 + 펫별 🧹 기억 초기화.
- **상황 스냅샷 주입 (P1)**: 매 턴 시각·계절·날씨(비/눈/무지개), 두 펫의 위치("그네 근처",
  "집 2층")와 상태(수영/그네/커피 들고 있음/산타모자…), 주인의 조종 여부를 한국어로 요약해
  프롬프트에 넣는다 — Peridot처럼 "인지=텍스트 변환". 여기에 월드 이벤트 로그: 밥때·취침·기상·
  물놀이·그네/시소·커피/간식 주문·드라이브·포옹/공놀이·손잡기·조종·날씨 변화·스크린샷이
  타임스탬프와 함께 기록되고(최근 8개 주입, localStorage 유지) "아까 뭐 했어?"에 진짜로 답한다.
- **행동 태그 + 실행기 (P2)**: 답장에 `<motion=dance>` `<goto=swing>` `<mount=seesaw>`
  `<drink=latte>` `<snack=donut>` `<hat=santa-hat|off>` 태그를 심으면 월드가 화이트리스트
  검증(모션 10종·장소 12곳·탈것 6종·음료 9·간식 9) 후 말풍선에서 지우고 순서대로 실행한다.
  이동은 gotoAsync, 탑승은 mountBed, 음료/간식은 부스까지 걸어가 받기, 포옹/공놀이는 듀오
  안무 재사용 — 기존 안전장치(점유·충돌·다리 경유)가 그대로 적용된다. 새 채팅이나 🎮 조종
  시작은 실행 중인 스크립트를 즉시 무효화하고, 조종/손잡기 중인 펫은 이동류 태그를 양보한다.

### Added (월드 모바일 터치 — 마인크래프트식 조작)
- **탭 = 펫 상호작용**: 터치 기기에서 펫을 탭하면 데스크톱 우클릭과 동일하게 동작한다(앉은 펫
  일으키기 · 자는 펫 깨우기 · 모션/코디/조종 메뉴). 이벤트의 pointerType으로만 분기해서 마우스
  동작(좌클릭=카메라, 우클릭=메뉴)은 터치스크린 노트북에서도 그대로다. 손가락 떨림을 감안해
  터치 탭 판정 반경은 6→13px.
- **핀치 줌**: 두 손가락 벌림/오므림이 휠과 같은 부드러운 줌 타겟(camZoom)을 움직인다 —
  min/max 클램프·글라이드 동일. OrbitControls의 두-손가락 팬은 조종 팔로우캠과 타겟을 두고
  싸우고 섬을 화면 밖으로 밀 수 있어 터치에서만 비활성(touches.TWO=-1); 한 손가락 회전은
  기존 그대로. 두 번째 손가락이 탭으로 오인되지 않게 탭 후보를 무효화하고, iOS가 제스처를
  가로챌 때(pointercancel)도 정리한다.
- **마크식 조종 UI**: 터치 기기에서 조종 중일 때만 좌하단 가상 조이스틱 + 우하단 액션 버튼
  (✕ 해제 44px · ✋ 상호작용 · 🦘 점프 — 독 카메라 버튼과 같은 48px). 조이스틱은
  setPointerCapture로 카메라 드래그와 분리돼 왼엄지 이동 + 오른엄지 시점 회전이 동시에 되고,
  스틱을 70% 넘게 밀면 달리기(Shift 대체). 차 운전은 스틱 전후=가속·후진, 좌우=핸들. 키보드
  Space/Ctrl·⌘/Esc 인라인 블록은 doJump/doInteract/escapeAction 함수로 추출해 버튼과 공유
  (동작 불변 — 차·그네·시소·침대·손잡기·커피·간식·라디오·가로등 우선순위 그대로). 조종 힌트는
  터치에선 좌상단으로 옮기고 키 이름 대신 버튼 아이콘으로 안내한다(✋ 차 타기 등).
- **터치 UI 크기**: 독 버튼 40→48px, 메뉴 행 패딩·폰트 확대(15px), 메뉴 화면 클램프를 하드코딩
  치수 대신 실측 기반으로, 사이드 패널 폭 가드(min(…, 100vw-90px)), 채팅 입력 16px(iOS 포커스
  줌 방지), 하단 UI에 safe-area 여백(홈바 겹침 방지).
- **모바일 성능 기본값**: 터치 기기는 절전(30fps·1.5x 해상도)이 기본 — ⚡ 버튼으로 끄면 그
  선택이 저장된다. 시작 시 applyPixelRatio()를 한 번 호출해, getBattery가 없는 iOS/Safari에서
  저장된 절전 픽셀비가 리사이즈 전까지 적용되지 않던 기존 갭도 수정.
- **모바일 뷰포트 기초**(world.html): viewport 메타(maximum-scale=1·viewport-fit=cover)와
  touch-action:none 등으로 더블탭 줌·당겨서 새로고침이 월드 조작을 가로채지 않는다.
  폰 접속: 설정 networkVisible='global' 후 같은 와이파이에서 http://<PC IP>:3456/world.html

### Added (월드 날씨 — 비·눈·무지개)
- **날씨 시스템**: 실제 시계 기반으로 맑음(10~25분)과 강수(3~8분)가 오간다. 11~2월엔 비 대신
  눈이 내리고, 현재 날씨는 저장돼 창을 다시 열어도 이어진다. 흐림 계수가 낮밤 파이프라인에
  합성돼 하늘이 회색으로 내려앉고(밤엔 밝아지지 않게 감쇠) 안개가 가까워지며 해·달·별이
  가려지고 바다가 잿빛이 되는데, 비 오는 낮에는 가로등이 은은하게 켜진다(아늑함).
  미리보기·테스트: `world.html?weather=rain|snow|clear|rainbow`.
- **강수 렌더링 — 발열 예산 준수**: 비 2000방울·눈 850송이가 각각 드로우콜 1개짜리 포인트
  클라우드다. 버텍스 셰이더가 시간 유니폼 하나로 낙하를 순환시키므로(눈은 사인 드리프트 추가)
  CPU는 프레임당 아무것도 쓰지 않는다 — 게임식 단일 포워드 패스 원칙 그대로. 빗소리는 기존
  물소리처럼 노이즈 합성이라 파일이 없고, 눈은 무음.
- **무지개**: 비가 낮에 그치면 바다 위로 무지개 아치가 3초에 걸쳐 떠올라 75초 머물다 사라진다.

### Added (월드 놀이기구 — 그네·시소)
- **2인 그네 (NE 위성섬)**: A자 프레임에 좌석 두 개가 나란히 매달린 그네를 다리 건너 NE 섬에
  놓았다. 조종 중인 펫을 그네 옆으로 데려가 ⌘(상호작용)를 누르면 올라타고, 한 자리가 차 있으면
  다른 펫은 남은 자리에 앉는다. 좌석은 진자 물리로 앞뒤로 흔들리며(바닥에서 펌핑 + 가벼운 감쇠로
  잔잔한 진폭 유지), 탄 지 10분이면 스스로 내려오고, 배회하던 펫이 가끔 알아서 타러 오기도 한다.
  밤 취침 자리로는 선택되지 않는다.
- **2인 시소 (NE 위성섬)**: 그네 옆에 중앙 받침점에서 기우는 널판 시소를 추가했다. 양 끝 좌석이
  하나의 기울기를 반대로 타서 한쪽이 내려가면 반대쪽이 올라가고 두 펫이 마주본다. 탑승 방식·10분
  하차·가끔 자동 탑승은 그네와 동일하다.
- **재사용 구조**: 두 놀이기구 모두 기존 침대(BEDS) mount 시스템 위에 얹어 ⌘ 상호작용·근접 힌트·
  다리 경유 이동(gotoAsync)·approach→mount→dismount 트윈·자동 하차를 그대로 공유한다(신규 하위
  시스템 없음). 전용 코드는 진자(updateSwings)·시소 틸트(updateSeesaws) 두 함수뿐이고, 배치는
  `world-layout.js`에 데이터 두 줄 + 평탄화 패드로 끝난다.

### Changed (월드 렌더링 — 게임식 전환)
- **Post chain replaced by bake & fake**: the GTAO→bloom→SMAA composer re-rendered the whole
  scene each frame just for normals and pushed ~19 fullscreen half-float passes — the most
  expensive possible shape on Apple's tile-based GPUs, and why the world still heated MacBooks
  after the 1.5x/60fps taming below. The world now draws ONE forward pass per frame, the way
  production games handle a mostly-static scene: contact shading is baked at load as soft blob
  discs under the props, sun/moon/lamp halos are additive glow sprites (golden-hour tint and
  the 💡 slider still apply), AA went back to canvas MSAA (near-free on tile-based GPUs) at
  full retina 2x, and the ACES look is unchanged.
- **Adaptive pacing**: 60fps only while the window is focused and on mains power; 30fps when
  the world sits unfocused beside other work, when ⚡ 절전 is on (now: 30fps + 1.5x pixels,
  persisted), or automatically on battery.

### Fixed (월드 발열)
- **MacBook heat after the quality pass**: the post chain (≈15 fullscreen passes) was running
  at retina 2x AND at 120fps on ProMotion panels — several times the old GPU load. Now: pixel
  ratio capped at 1.5 (SMAA keeps it crisp), GTAO trimmed to 8/6 samples, canvas MSAA dropped
  (redundant behind SMAA), the sim+render loop capped at 60fps, and a ⚡ dock button toggles
  절전 mode (plain forward render, persisted) for hot days.

### Changed (월드 그래픽)
- **Render-quality pass**: the world now draws through a post chain — GTAO contact shading,
  a subtle bloom on the sun/lamps/moon, tone-mapped output and SMAA. Screenshots go through
  the same chain; pixel ratio is capped at 2.
- **CC0 asset-kit pilot (Kenney Nature Kit) — tried and reverted**: the six trees briefly ran
  as kit models with seven kit rocks added, but the angular kit style clashed with the chubby
  pastel world, so trees/rocks are back to the procedural look and the vendored GLBs were
  dropped. The plumbing stays for a better-matching pack later: `world-kit.js` (cached GLB
  prop loader with procedural fallback) plus `variant`/`kitScale` fields on layout entries.
  Pets (병아리/강아지) were never touched.
- **Layout data module**: islands, bridges, the house anchor, flat pads and all prop
  placements moved to `static/js/world-layout.js` — growing the world is now a data edit
  (props accept optional `scale`, `variant`, `kitScale`).

### Changed (Dock·월드 메뉴 배치)
- **Single Dock icon**: the dev Electron binary now sets the party icon on the macOS Dock via
  `app.dock.setIcon` (was the default atom icon), and the desktop launcher applet is marked
  `LSUIElement` so it never occupies the Dock — launching shows exactly one icon.
- **World pet menus no longer cover the pet**: the right-click motion/control menu opens ~80px
  to the right of the click point (clamped to the window edge), and the 먹기/마시기 chooser now
  stacks directly ABOVE the motion menu (same left edge, bottom-anchored) instead of sitting to
  its left over the character.

### Fixed (실행 안정성)
- **Blank-white windows / zombie app on launch**: launching could leave nothing but white
  sheets on screen (empty 펫 월드 window included), and re-clicking the desktop launcher then
  did nothing. Three `main.js` fixes: (1) a crashed renderer (e.g. Chromium's network service
  dying at startup) now auto-reloads its window, max 3 times/min, instead of staying a blank
  sheet; (2) `before-quit` no longer awaits `executeJavaScript` on a dead renderer — that hang
  used to leave a zombie Electron holding the single-instance lock so later launches were
  silently swallowed; (3) the pet-world/VRM windows retry `loadURL` while the backend is still
  coming up instead of failing once with `ERR_CONNECTION_REFUSED` plus an unhandled rejection.

### Changed (클릭·메뉴)
- **Pet menus are right-click only**: clicking a pet with the left button used to open the
  motion/control menu, which clashed with left-drag camera moves. The motion/control menu (and
  wake/stand-up taps) now only respond to right-click; left-click is camera-only. Holding a
  drink/snack, right-clicking the pet opens the motion menu with the 먹기 chooser shown right
  beside it (both close together) instead of replacing it.

### Added
- **Snack booth + two-handed food (🍞 간식 부스)**: a mint-striped snack stand (griddle, display
  snacks, SNACK sign) joins the plaza beside the coffee booth. Ctrl/⌘ opens a 3×3 menu of nine
  snacks — 토스트, 오므라이스, 부리또, 핫도그, 도넛, 붕어빵, 삼각김밥, 츄러스, 컵케이크 — each a
  canvas icon plus a little 3D model. The snack goes in the pet's OTHER paw/wing, so a pet can hold
  a drink and a snack at once (양손 자유도); the puppy grows a matching arm+paw on that side too,
  raycast-anchored to the fur like the drink hand. Right-clicking the pet now lists whatever it's
  holding (마시기 / 먹기); picking food runs a 2~3-bite 우적우적 sequence with a munch sound, the
  snack shrinking per bite until it's gone after ~6 bites (then a happy hop). And drinks/snacks
  ride every motion — dance, cheer, wave all work while holding, cup and snack bobbing along.
  Beds put both hands' items down before climbing in.

### Fixed (클릭·음료 후속 3)
- **Cup rim meets the beak**: while drinking, the cup group's origin (its bottom) was placed at the
  mouth, floating the whole cup above the chick's beak. Each drink now knows its rim height and the
  cup is lowered by it — the rim touches the beak/lips for every cup type (iced/hot/espresso).
- **Drink arm attaches to the body for real**: bounding-box math put the stub arm off the flank on
  the puppy's chunky shape. `giveDrink` now raycasts into the body at cup height to find the actual
  fur surface — the arm anchors just inside that hit point and the cup rests just outside it, so
  the limb is always rooted in the body regardless of shape, and stretches naturally to the mouth
  while drinking.

### Fixed (클릭·음료 후속 2)
- **먹기 popup opens on the pet and stays open**: on macOS the browser's contextmenu event fires on
  mouse-DOWN, so the popup opened and was instantly wiped by the pointer-up handler. All popup
  logic moved into the pointerup raycast: right-click ON the drink-holding driven pet → 먹기
  (background right-clicks show nothing, as requested); the contextmenu handler now only suppresses
  the browser menu. The puppy's drink arm also shrank to a chick-wing-length stub anchored at the
  cup (no more long limb from the shoulder), and the cup rests a touch closer to the body.

### Fixed (클릭·음료 후속)
- **Right-click menus are back**: the recent mouse-button separation accidentally made pet menus
  (조종하기/모션) left-click-only — both buttons open them again like before. Right-clicking empty
  ground while holding a drink is the only thing that shows the 먹기 popup (and drags never do).
- **Puppy cup/arm no longer stuck in the body**: the cup's rest position and the arm's shoulder
  anchor are now computed from the model's measured size (`pet.dims`) instead of fixed numbers, so
  they sit just outside the fur on any body shape.

### Changed (음료 리워크)
- **Drinking looks right now**: the cup's drinking position is no longer a fixed guess — it reads
  the pet's actual mouth node (chick beak / puppy tongue) live every frame and hovers just in front
  of the lips, so the cup never sinks into the body (the puppy especially). The puppy also grows a
  little arm + paw while holding a drink (a fur-toned limb stretched dynamically from the shoulder
  to wherever the cup is). Right-click now opens a small "🥤 먹기" popup instead of sipping
  instantly; picking it runs a 2~3-gulp drinking sequence — cup held to the mouth, head tipping
  rhythmically, 꿀꺽 sound per gulp — and the cup finishes after ~8 gulps total. Left/right mouse
  buttons are now cleanly separated (right never triggers pet clicks or closes menus).

### Added
- **Coffee booth takeout (☕ 커피 부스)**: a striped-awning coffee stand (espresso machine, cup
  stack, COFFEE sign) joins the plaza's west side. Drive a pet up and press Ctrl/⌘ to open a 3×3
  takeout menu of nine drinks — 아메리카노, 아이스 아메리카노, 에스프레소, 카페라떼, 카푸치노,
  초코라떼, 딸기라떼, 녹차라떼, 아이스티 — each drawn as a little canvas icon (clear cups with ice
  and a straw for iced, sleeved paper cups with lids for hot, a saucer demitasse for espresso).
  Picking one puts a matching 3D mini-cup in the pet's paw/wing, parented to the motion wrap so it
  bobs along with walking, running, even swimming. Right-click sips: the cup rises to the mouth
  with a head-tip and a gulp sound, and after four sips the cup is finished with a happy hop.
  Climbing into a bed puts the cup down first, and the world canvas no longer shows the browser
  context menu.

### Fixed
- **조종하기 always works now**: possession used to be refused while a pet was mid-anything
  (meal, dip, bed approach, duo) — which is why it often "didn't take", especially right after
  launch when the meal window or the first random swim kicks in. Taking control now forcibly and
  safely inherits the pet from ANY activity: beds/seats dismount instantly (occupancy cleared),
  a passenger hops out of the car, dips wind down on the next frame, and any director awaiting
  that pet's arrival is resolved so nothing deadlocks — their later cleanup calls no-op against
  the player state (releaseAI now respects 'player').
- **Zoom buttons actually zoom now**: the `camZoom` helper had been deleted along with the old
  camera button panel, so the ＋/－ buttons and keyboard +/- were silently throwing on every press —
  the function is back (steering the same smoothed distance target the wheel uses). Also the sports
  car now spawns in the middle of the plaza (it used to clip into the new bigger house), and it can
  cross the bridges to the satellite islands — bridge decks count as road for the car, lifting it
  over the arch (wheels overhang the narrow planks, by popular demand).

### Added
- **Two-story house + sports car + grass-sound fix (복층집·스포츠카)**: the little cottage became a
  walk-in two-story dollhouse — open front with porch posts so the camera sees inside, wooden floor,
  plastered walls with side windows, a real stair ramp along the right wall up to a loft with a
  railing (the loft edge line doubles as the under-loft partition), and a shingled roof + chimney.
  The interior is part of the world heightfield (`houseFloorY`), so pets and the player walk in,
  climb the stairs and stand on the loft; a new max-step rule stops anyone hopping ledges. Furnished
  with a sofa (Ctrl/⌘ = 앉기 — new `sit` seat mode, tap the sitter to get them up), low table with a
  reading lamp (tied to the lamp glow system), rug, bookshelf, and a loft bed that joins the
  night-time sleep pool. Outside on the driveway sits a red sports car: Ctrl/⌘ boards it (a held or
  nearby friend hops into the passenger seat 👥), arrow keys drive at 3× walking speed with
  speed-scaled steering, a synth engine that revs with the throttle, spinning wheels, and a moving
  collider so wanderers steer around it; Ctrl/⌘ hops out (Esc too). Cars are main-island only — the
  bridges are too narrow. Also fixed: grass right next to a road no longer clicks like pavement
  (footsteps now use a stricter on-road test), and house floors sound like wood.
- **Footstep & water sounds (발소리·물소리)**: the world now sounds like somewhere. Footsteps fire
  in sync with the waddle gait (a footfall per half period of the sin(t×8) leg swing) and pick the
  right sound for the ground — grass on the meadow, concrete on the roads/plaza, wood planks on
  the bridges — from the bundled Kenney "Impact Sounds" CC0 set (5 variants each, random
  pitch/volume so nothing machine-guns). Swimming plays a soft synthesized water lap loop plus a
  swish per stroke, splashes got a real splash sound, and landing a jump thumps. The driven pet is
  loudest; AI pets fade with camera distance. Personal sounds (e.g. game rips for private use) go
  in `static/sounds/custom/` with a manifest.json — that folder is git-ignored so they never reach
  the public repo, and any missing set falls back to the defaults (or a synth burst if files fail).
- **Run mode + hand-holding (달리기·손잡기)**: Shift toggles the driven pet between 걷기 and 달리기
  (2× walk speed; the hint header flips to 🏃 달리는 중 and shows the toggle). Walk up to the friend
  and press Ctrl/⌘ to take its hand — it parks in a dedicated `held` state and walks, runs and even
  swims side-by-side at your pace, staying on the side you grabbed, leaning gently into you with
  little 💕 hearts drifting up now and then. On narrow ground (bridge decks) it tucks into single
  file behind you; press the key again (or Esc) to let go, and mid-water releases snap the friend
  safely back onto land (shared `snapToLand` helper now also backs possession release). Held pets
  are excluded from duo partnering, menu motions, meals and auto-sleep; grabbing hand-offs cleanly
  when you switch which pet you drive. Interaction priority: climb-out → hand → bed → radio → lamp.
- **Radio, screenshots, follow-cam + zoom fixes (라디오·스샷·팔로우캠)**: a little radio prop sits at
  the plaza edge — drive a pet up and press Ctrl/⌘ to open a scrollable playlist of whatever audio
  files you drop into `static/music/` (new `/api/radio_list` backend endpoint; picking a track
  loops it, ⏹ stops, ✕/Esc closes). A 📷 button (top of the right-side dock) renders a fresh frame
  and saves it through the new `/api/save_screenshot` endpoint into the `screenshots/` folder,
  with a white flash + toast naming the file (both folders are git-ignored). While driving a pet
  the camera now follows it — the orbit target glides after the pet and the camera slides along,
  preserving your angle/zoom, with drag/wheel still usable mid-follow. The zoom buttons were
  rebuilt: moved above the chat-bar row (bottom:70, z-index 95) so nothing swallows their clicks,
  bigger steps and faster hold-glide, and keyboard +/− (numpad too) now zooms as well. Daytime
  pastel toned down another notch (environment 0.15, exposure 1.0).
- **Archipelago: two bridge-connected satellite islands (군도·다리)**: the world becomes three
  islands — the main one plus a NE (r2.2) and SW (r2.0) satellite, each built by the same
  grass/cliff generator (resolution scales with radius) with its own foam rings, a tree and a
  bridgehead lamp, otherwise left as open ground for future features. Wooden arched bridges
  (stepped planks, posts, rails) connect them; bridge decks count as ground everywhere — terrain
  height, blocking, particle floors, the player's support/fall logic — so anyone can walk (or
  arch-climb from a swim onto any island's rim). Pets route cross-island trips through the right
  bridge via a waypoint system used by both wandering and the approach walks (beds/meals/duos), and
  bridge nodes joined the wander destinations. Swimming leash widened to reach the satellites.
- **Lamp brightness moved onto the lamps + zoom buttons (가로등 상호작용·줌 버튼)**: the 💡 slider is
  gone from the window — walk a possessed pet up to any streetlamp and press Ctrl/⌘ to cycle its
  brightness (0→25→50→75→100%, shown in the hint, persisted). The bottom-right corner now hosts
  ＋/－ zoom buttons instead (tap = one step, hold = smooth glide — same eased zoom the wheel
  drives), for setups where scrolling is awkward. Daytime look was also toned down a notch
  (environment 0.4→0.25, exposure 1.12→1.06) — the extra brightness had crept in with the texture
  pass's IBL, not just the daylight.
- **Island expansion + road network (섬 확장·도로)**: the island grows from R3.2 to R5.2 (~2.6×
  the area) to make room for the expansion wishlist. The layout is zoned — NE house yard (+bowl),
  E rest area (sunbed), S hammock nook, SW pond, W fence lawn, four trees spread around — with the
  center kept as an open stone-tiled plaza (auto-leveled flat spot; hug point & monument land
  there next) and the N/NW meadows reserved for future features. A stone-dust loop road at
  mid-radius plus four spokes out of the plaza are terrain-hugging ribbon meshes with their own
  painted path/plaza-tile textures; six streetlamps now line the loop. Pets draw ~45% of their
  wander destinations from the road network (plaza/loop/spoke nodes) so movement between zones
  actually follows the paths; decorations (scaled up to ~380 tufts / 75 flowers / 46 pebbles)
  avoid the roads. Ocean inner radius/foam scale with the island; camera starts further out
  (zoom cap 15), shadow coverage widened, terrain grid densified to 34×96.
- **Animal Crossing-style texture pass (동숲 텍스처)**: the world graduates from flat colors to
  hand-painted-feel materials — all generated as tiling canvas textures at load, no asset files.
  The meadow wears the iconic staggered-triangle grass pattern (planar-mapped UVs on the terrain
  grid, near-white vertex tints for sunny/mossy patches), the cliff shows horizontal dirt strata
  with speckle, trunks/fence/hammock posts/door get wood grain, the house walls plaster and the
  roof scalloped shingles, the hammock becomes a striped awning and the sunbed towel striped pink,
  the pond rim sandy speckle. Tree crowns bake a vertical shade gradient into vertex colors (dark
  underside — the classic AC foliage read). Everything moves to MeshStandardMaterial with a subtle
  RoomEnvironment IBL (environmentIntensity 0.4) so materials get a soft studio sheen; emissive
  clouds/lamp globes stay Lambert. Pet models are untouched (they only pick up the gentle ambient).
- **AI pool days + adjustable streetlamps (물놀이·가로등)**: wandering pets now fancy a dip of
  their own — every few minutes (daytime only, cooldown) an idle pet walks to the pond edge or the
  cliff rim, wades in with a splash, cruises a few waypoints with the full swim stroke, then wades
  out (pond) or climbs the cliff back up (sea) — so both pets, player included, can end up swimming
  together. Dipping pets are excluded from duo partnering; sleep or possession ends a dip
  instantly. And the night got friendlier: four rim streetlamps (metal pole + glowing globe +
  warm point light) fade up through dusk, with a 💡 brightness slider (bottom-right, persisted
  across sessions) scaling both the light and the globe glow; moon/ambient night levels were also
  nudged up.
- **Translucent water + real swim strokes (물 투명도·수영 모션)**: the sea (opacity 0.85) and pond
  (0.68) are now glassy — the submerged cliff, the sandy pond basin and the swimmer's paddling legs
  all show through the surface. Swimming drops the land waddle for a dedicated procedural stroke,
  applied as a world-side overlay after the shared entity update (pet windows untouched): deep
  alternating leg kicks, rowing wing sweeps for the chick / trailing ears and a rudder-wag tail for
  the puppy, a stroke-synced body roll and bob with the head held out of the water, full strokes
  while moving vs. gentle treading when idle, and a little droplet wake kicked up behind while
  paddling. Blinking carries through; menu motions still take precedence.
- **Swimming + ⌘ interaction key (수영)**: the interaction key now accepts the Mac Command key
  alongside Ctrl everywhere (tuck-in, climb-out, hints show "Ctrl/⌘"). A possessed pet can now
  swim: wade into the pond or walk right off the cliff rim — it falls, lands with a puff of 3D
  water droplets, and switches to swim mode, floating half-submerged with a wave bob and a forward
  paddling lean (the waddle reads as a dog-paddle). Swimming is slower than trotting, Space does a
  splash-hop, and a leash keeps the swimmer from vanishing into the fog. Near the cliff the hint
  offers "Ctrl/⌘ 섬으로 올라가기" — an arced climb back onto the rim. Only the player-driven pet
  swims (wander AI still treats water as blocked), and releasing possession mid-swim returns the
  pet to solid ground so the AI never strands at sea. Splash droplets die on the sea surface
  beyond the rim (not the phantom terrain height).

### Changed (밥때 tuning)
- **Meals: 30-minute windows, random spots, huggable diners, 3D food**: the serving window shrank
  to 30 minutes; each pet now picks a random free spot around the bowl instead of a fixed side
  (retrying against colliders and the other diner's spot); and hugging an eating pet is allowed
  again — the meal is abandoned gracefully mid-bite (hijack-safe: the meal never stomps the hug
  and only releases the AI if it still owns the pet). Eating FX in the world are no longer emoji:
  each pet gets a real 3D ground prop (scattered golden grain patch for the chick, a little blue
  kibble bowl for the puppy) that is hidden when dining at the real bowl, and the nibble particles
  are tiny 3D morsels that pop from the mouth, arc under gravity and land in the grass.

### Added
- **Meal times at the bowl (밥때)**: at 8시·12시·18시 the pets trot over to the food bowl, take
  their own spot each (chick on one side, puppy on the other), turn to face the bowl and eat two
  helpings with the shared Eat motion before wandering off. Each serving window lasts 45 minutes
  and every pet eats once per serving (tracked per day); meals are skipped while possessed,
  sleeping, in bed or mid-choreography, and the duo partner filter now also excludes busy/goto pets
  so nobody gets pulled into a hug mid-bite. Preview with `?hour=12`.
- **Night auto-sleep + sunbed & hammock (자동취침·잠자리)**: two new furniture props join the island —
  a mint sunbed with a reclined backrest, towel and pillow, and a hammock with leaning posts and a
  sagging, edge-curled cloth. At 밤 10시 (22:00) the pets head to bed on their own — the chick takes
  the hammock (it rocks gently while she sleeps), the puppy the sunbed — walking to an approach
  point, hopping on with a little arc, tipping onto their backs (the lean lives on the mover so the
  shared sleep animation keeps breathing on top) and dozing until 6시, when they hop off with the
  sunrise. Waking them at night (click, chat, motion) makes them dismount; they drowsily climb back
  in ~90 seconds later. While driving a pet (🎮), walking near a free bed shows a "Ctrl 눕기" hint —
  pressing Ctrl sends it to climb in and lie down (possession hands back to the AI as it walks).
  Beds are blocking props, excluded from duo partnering, and `?hour=23` previews bedtime instantly.
- **Rippling ocean around the island (바다)**: the floating island now sits over an animated sea. A
  polar-grid ocean mesh (geometric ring spacing — dense where you look, sparse toward the horizon)
  runs four layered directional sine waves on its vertices every frame with recomputed normals, so
  the swells genuinely catch the sun/moon glints (Phong specular highlights that sweep with the
  day/night light). Wave amplitude fades toward the foggy horizon to avoid far shimmer, and the
  cliff now casts its shadow onto the water at low sun. Two foam rings lap against the cliff base,
  swelling outward and fading half a phase apart, with a gentle bob. Sea color follows the clock —
  pastel cyan by day, deep navy at night, a warm tint at golden hour — and the foam dims to a pale
  blue after dark.
- **World day/night cycle (밤낮)**: the world now follows the real clock — the sun rises at 6시 and
  sets at 18시, when the moon takes over the same east→west arc until morning; both slide along the
  sky as time passes (refreshed ~2×/min). The sky gradient blends between day pastels, a deep navy
  starfield night (240 stars fade in after dark), and a golden dawn/dusk glow that peaks exactly at
  6시/18시; fog and background follow the horizon color. The one shadow light plays the warm sun by
  day and a cool blue moon by night (hemisphere fill, cloud tint and cloud glow follow too), so
  shadows sweep across the island through the day. Preview any hour by opening
  `world.html?hour=21.5` in a browser.
- **코디 accessory system + santa hat**: pets can now wear outfit items. The shared entity module
  gains a `GLB_ACCESSORIES` registry + `setGlbPetAccessory(pet, id)` — items are built procedurally
  (no external assets), anchored to the normalized head-top via the new `pet.dims`, and parented to
  the motion wrap so every motion (nod, spin, sleep droop…) carries them. First item: 🎅 산타모자
  (white torus brim, red cone with a floppy tilted tip, pompom riding the tip). Wear/remove toggles
  live in all three pet menus — main pet, friend, and the world click menu (labels flip to "벗기"
  while worn). New items = one builder + one list entry.
- **World visual upgrade (퍼피레드 감성)**: the diorama got a pastel virtual-world glow-up.
  *Sky* — a gradient dome (zenith blue → warm pink horizon, painted on an inside-out sphere) with
  four puffy multi-lobe clouds drifting slowly around the island. *Terrain* — the flat disc became a
  gently rolling meadow: a 26×72 polar grid displaced by a `terrainHeight` function with two-tone
  vertex-color grass patches, flat pads auto-leveled under the house/pond, and a lathed faceted dirt
  cliff tapering to a rounded tip; `world.groundHeightAt` now returns the same function, so pets,
  props, the select ring and the catch ball all follow the hills. *Props* — trees grew fluffy
  sphere crowns (berries on the big one), the house got rounded walls, eaves, a chimney, a knobbed
  door, a framed window and a doorstep (RoundedBoxGeometry), the bowl gained a rim + kibbles, the
  fence turned to capped round posts, and a new pond (blocking) with sand rim, lily pad and stones
  joined the scene. *Set dressing* — ~170 instanced grass tufts, 34 color-varied flowers and 22
  pebbles scattered on unblocked ground. *Rendering* — ACES filmic tone mapping, warm sun, soft
  blurred shadows with normal-bias tuned for the curved terrain.
- **Camera buttons removed — mouse-only camera**: with drag-orbit damped and wheel zoom smoothed,
  the 📷 toggle and its button panel became redundant and are gone. Camera is now fully mouse-driven:
  drag = orbit, right-drag/two-finger = pan, wheel = smooth glide zoom (wheel deltas are normalized
  across devices — pixel/line/page modes — so trackpads and notched mice feel the same).
- **Camera panel folded into a 📷 toggle + silky zoom**: the camera buttons now live behind a single
  📷 button in the bottom-right (click to expand/collapse; the toggle glows blue while open). Mouse
  wheel zoom no longer uses OrbitControls' per-tick dolly steps — the wheel (and the ＋/－ buttons)
  steer a target distance the camera glides toward each frame (exponential ease-out), and drag
  damping/rotate speed were retuned (0.05 / 0.85), so zooming and orbiting feel smooth instead of
  notchy.
- **World camera buttons + pet keyboard control (카메라 조작·조종)**: a bottom-right button panel
  drives the camera — zoom in/out, a pan D-pad (island-clamped so the view can't drift off into the
  sky), and rotate/tilt angle buttons; tapping steps once, holding glides continuously. A pet's
  click-menu gains a pinned "🎮 조종하기" entry: the chosen pet parks its AI in a dedicated `player`
  state (excluded from duo partnering; mid-duo pets can't be grabbed), shows a golden select ring
  and a bottom-left hint, and is driven with the arrow keys (camera-relative, ↑ = away from you,
  brisker than wander pace, prop/rim collisions respected) plus Space to hop (simple gravity on the
  mover's Y so motion bobs stack cleanly). Esc or the menu releases it back to wandering; picking
  hug/play while possessed hands the pet back to its AI first. Typing in the chat bar never moves
  the pet. This is the first piece of the ③→② third-person track: the keyboard controller simply
  replaces the wander controller, exactly as the architecture planned.
- **World chat (채팅 이식)**: a bottom chat bar in the world window talks through the same backend as
  the pet windows — `/ws` (`set_user_input` → `trigger_send_message`) drives the main-UI agent, and
  the reply's `/ws/vrm` TTS chunks are re-sequenced and played in order with their text shown in a
  speech bubble anchored above the responder's head (silence chunks respected; omni streams show
  text only). The pet you name answers (병아리/삐약/chick · 강아지/멍멍/댕댕/puppy), defaulting to
  the chick; it ponders with the Think motion while the agent generates, stands still while
  speaking, and does a happy hop when the reply finishes. The world only consumes reply chunks for
  conversations it started, so chats typed in the main UI / pet windows don't echo into the world
  (the reverse still overlaps: with a pet window open, a world-initiated reply sounds in both).
  Enter respects Korean IME composition; the world window allows autoplay audio.
- **World motions + click interactions (모션 이식)**: clicking a pet in the world opens the same
  data-driven motion menu as the pet windows (clicking a sleeping pet wakes it; short unmoved press =
  click, otherwise it's an orbit drag). All 12 shared motions play per-entity; the emoji/💤💭/파이팅/
  food FX re-anchor to each pet's projected screen position and scale with its on-screen size
  (pet-window percentages are mapped so left:50/top:70 = "at the feet"). Hug and Play are
  re-choreographed in-scene with no window IPC: the two pets walk to meeting/catch spots via the
  shared steering (arrive-anyway guards prevent deadlocks), face each other, then play their synced
  halves — the catch ball is a real 3D sphere arcing between their "hands" 4 tosses with
  throw/catch/finish cues, and wander resumes afterward. Arriving pets sometimes do a happy/think
  flourish; duo directors are serialized by a `duoBusy` guard and menu input is ignored mid-choreography.
- **Pets move into the world + wander AI (입주/배회)**: the chick (0.4u) and puppy (0.5u) now load into
  the world scene as two independent entities of the shared module, greet with a wave, then live on a
  Sims-style loop — idle a few seconds, pick a reachable spot (`world.isBlocked` circle-collider +
  rim checks), turn along the shortest arc, waddle over with the existing walk animation, repeat.
  Each pet rides in a "mover" group carrying world position/heading while its wrap stays
  motion-local, so all 12 shared motions play unchanged on top; the wander controller is
  deliberately swappable (keyboard control in the 3rd-person phase, LLM planning later).
- **Pet world stage (무대)**: the world window now shows a floating grass island (grass disc + tapered
  dirt base) with primitive props — two trees, a house, a food bowl and a fence — driven by a data
  list (type/position/collider radius) so a low-poly asset kit can replace the builders later. An
  orbit camera (drag to circle, wheel to zoom, capped above the horizon) replaces the fixed view, and
  the `world.groundHeightAt(x,z)` / `world.isBlocked(x,z)` interface is in place — pets will only
  sense the ground through it, which is the swap point for heightmap (3rd-person) or voxel (sandbox)
  phases.
- **Pet world window (월드) skeleton**: the tray menu gains a "월드 열기" item (ko/en/zh) that opens a
  single normal, resizable window (re-opening focuses it) rendering the new `world.html`/`world.js`
  three.js scene — sky, hemisphere + shadow-casting sun light and the render loop. The diorama stage,
  pets, wandering and interactions land in the following world-mode steps. Desktop pet windows are
  untouched and can run alongside. Render loop pauses automatically while the window is hidden
  (Electron background throttling stays on).

### Changed
- **GLB pet code extracted into a shared entity module**: the pet loader, node discovery and all 12
  procedural motions moved from `vrm.js` into `static/js/glb-pet-entity.js` as per-entity functions
  (`createGlbPetEntity(url, {targetHeight, parent})` / `updateGlbPetEntity(pet, delta)` /
  `disposeGlbPetEntity`, plus the exported `GLB_MOTIONS` list and emoji particle helpers), so the
  upcoming world mode can run two pets in one scene. Model scale is now a `targetHeight` parameter
  (the pet window still derives it from the window height) and the 💤💭/파이팅/food overlays are
  per-entity hooks the window wires up. Step 1 of the world-mode plan — no pet-window behavior change.

### Added
- **GLB pet play motion (two pets)**: "놀이 (Play)" is a coordinated game of catch — the main process
  sets the two pet windows a catch-distance apart and tosses a ball (its own transparent window, a
  CSS-drawn sphere so it can't render as an emoji/charset artifact) back and forth ~4× in an arc, cueing
  each pet to throw/catch in sync (`vrm-play` / `vrm-play-start` / `vrm-play-cue`). The chick throws and
  catches with its wings, the puppy with its paws + a tail wag; the last catcher does a happy hop. Plays
  a solo bounce when alone. Generalizes the two-pet layer into shared `findDuoPartner` / `tweenBounds` /
  `duoFormation` helpers (Hug refactored onto them) for Heart to reuse.
- **Tray "summon desktop pet" item**: the menu-bar tray dropdown now has a "데스크탑 펫 소환" entry
  (between Show Window and Quit) that re-shows the pet if it is hidden or creates it if there is none
  (localized for ko/en/zh).
- **GLB pet hug motion (two pets)**: "포옹 (Hug)" is the first coordinated two-pet motion. Picking it
  asks the main process (new `vrm-hug` IPC) to slide the two pet windows together (approach → hold →
  part, via `setBounds` tweens), then signal both renderers (`vrm-hug-play`) to play their hug half in
  sync — the chick wraps its wings, the puppy reaches in on its paws and wags, both lean toward each
  other with 💕 hearts rising between them. Wander is blocked during the hug; plays a solo air-hug if
  there is no partner. Builds a reusable two-pet coordination layer (window pairing + synced IPC +
  role-based half-animation) that Play/Heart will reuse.
- **GLB pet eat motion**: "먹기 (Eat)" plays a ~3.2s head-down feeding loop (lean in → eat cycles → look
  up satisfied with an `outBack` pop). The chick does quick sharp ground pecks (head taps, beak opens,
  wings flick) over scattered grain; the puppy buries its head in a bowl with fast nibbles, tongue laps,
  a happy tail wag and ears flopped forward. A ground food prop (🌾 grain / 🥣 bowl, `setEat` toggle) and
  crumb/✨/❤️ particles sell it. Captures the `beak`/`tongue` nodes for the first time.
- **GLB pet celebrate motion**: "축하 (Celebrate)" does one big burst — an anticipation crouch, a leap — an anticipation crouch, a leap
  with a full spin, then a settle, with a confetti burst at the peak (new `spawnFloatEmojiBurst()`
  particle helper: many emoji fly out, fall under gravity, and fade).
- **GLB pet cheer motion**: "응원 (Cheer)" roots for you with rhythmic up-pumps, a bouncy beat and a
  forward lean while throwing ✊💪 emoji, and shows a "파이팅!" shout above the head. The shout has no
  bubble and picks a fresh random color each time the motion plays.
- **GLB pet motion menu**: a control-panel button (main pet, `fa-person-running`) opens a dropdown
  of on-demand motions to play. The list is data-driven from `GLB_MOTIONS` and `playGlbMotion(id)`
  is the play hook; Walk and Idle are default states and are intentionally excluded.
- **GLB pet sleep motion**: picking "수면 (Sleep)" from the motion menu puts the pet to sleep —
  eyes shut, slow deep breathing, head drooped with a gentle doze-bob, lazy tail, and a floating
  💤 above the head. It's a state, not a one-shot: the pet wakes when clicked or when it starts
  walking.
- **GLB pet dance motion**: "춤 (Dance)" does a beat-synced groove — on-beat bounce, side-to-side
  sway with a twist, limbs moving to the rhythm, and floating 🎵🎶 music notes (eases in/out at the
  start/end). Added a reusable `spawnFloatEmoji()` particle helper for future effect motions.
- **Motion dropdown scrolls**: the motion menu (main pet and friends) now shows ~3 items and scrolls
  for the rest (`max-height` + `overflow-y`), so the growing list stays compact.
- **GLB pet think motion**: "생각 (Think)" tilts the head side to side (pondering) with the chick
  scratching its head with a wing / the puppy lifting a paw to its chin, plus a 💭 thought bubble.
  Applies animation principles — anticipation (a still beat first), follow-through (settle with an
  `outBack` overshoot), and overlapping action (ears/tail lag behind the head). Added reusable
  easing helpers (`Ease.inOutSine/inOutQuad/outBack`).
- **GLB pet happy motion**: "기쁨 (Happy)" in the motion menu plays an excited reaction — the chick
  flaps both wings fast with bouncy hops, the puppy spins a full turn while hopping and wagging its
  tail hard (~1.8s one-shot, then back to idle).
- **Motion button on summoned friends**: friends now get the motion dropdown too (below the close
  button, revealed on hover), so you can play motions on a friend — previously they had only a close
  button.
- **GLB pet wave (greeting) motion**: the pet waves hello when it appears / is summoned, and from
  the motion menu ("인사"). It's the first timed one-shot (driven by `glbPet.action`, ~2.4s, then
  back to idle): plants the screen-left foot, leans, and waves the screen-right limb — the chick
  flaps a wing forward, the puppy waves a paw and wags its tail. (Left/right are picked by on-screen
  world position so the wrap's 180° flip doesn't mirror them.)
- **Auto-sleep**: the pet dozes off on its own after 10 min of no system-wide input (away), or
  after just 2 min at night (23:00–07:00), using Electron `powerMonitor.getSystemIdleTime`. It
  wakes instantly when input reaches the pet window, and within ~2s when you return from another
  app. A manual sleep (from the menu) is left alone — it only ends on a click. The pet won't wander
  while asleep.
- **GLB pet idle motion**: when not walking, chick/puppy now feel alive — subtle breathing bob and
  a slow sway (continuous), plus occasional eye blinks, a gentle head bow/nod, and chick wing
  flutter / puppy ear twitch. Each "occasional" action fires on its own randomized timer with a
  smooth ease-in/out pulse (not metronomic). Idle motions cross-fade out as the walk fades in;
  blinking continues while walking. All procedural on the separate GLB nodes (no rig).
- **Summon friend**: a button in the desktop pet's control panel (below the text-input button)
  spawns a second character beside the current one, loading the next model in the list as the
  friend (e.g. Chick → Puppy). New windows are staggered so they sit side by side instead of
  stacking. The friend window carries its model via `?model=...&friend=1`. Summoned friends are
  stationary, have no control panel (but the whole window is draggable), and don't grab the
  text-input hotkey. (GLB pet display size also reduced.)
- **GLB pet models** (non-VRM): the model picker now lists `.glb`/`.gltf` files from the model
  folder. Added two custom Blender characters — **Chick** and **Puppy** (extracted from
  `chick_and_puppy_cute.blend` into separate models). A lightweight loader (`loadGlbPet`) scales,
  grounds, and centers the model and skips the VRM pipeline. Since these have no humanoid rig or
  morphs, lip-sync/expressions are unavailable, but the speech bubble and wandering work.
  - **Procedural "waddle"** (`updateGlbPet`): no skeleton needed — the separate foot nodes swing
    in alternation, plus a body bob, side-to-side lean, and (puppy) tail wag, driven during idle
    wandering. Idle shows a gentle breathing bob.
- **Global memory** (`memorySettings.globalMemory`): a manual, always-injected note that is
  added as a system message on every request, regardless of the selected character or whether
  memory is on. Injected in both `generate_stream_response` and `generate_complete_response`,
  outside the character block. `{{user}}` is substituted; sub-agent requests are excluded.
- **VRM pet text input**: a bubble input box toggled by a configurable global hotkey
  (`VRMConfig.textInputHotkey`, default F13) that works even when the main window is hidden.
- **VRM show/hide global hotkeys** (`showPetHotkey` default F14 / `hidePetHotkey` default F15):
  summon or hide the desktop character even while the main window is hidden.
- **Idle remarks** (`VRMConfig.idleTalkEnabled`): the character spontaneously shows a random
  preset line in its speech bubble when idle. Configurable line list and interval (with jitter).
  Suppressed during chat/speech and while the bubble input box is open.
- **Idle wandering** (`VRMConfig.wanderEnabled`): the pet window occasionally slides to a nearby
  spot on screen when idle (plays a walk motion if one exists), clamped within the display work
  area. Configurable interval and range; suppressed during chat/speech/input.
- **Prompt caching for Claude via litellm** (`customAnthropic` path): an ephemeral
  `cache_control` breakpoint is attached to the system prefix so repeated requests read it at
  ~0.1x cost. Only the litellm path is touched; OpenAI and other providers are unaffected.

### Changed
- **Pet drag interaction is now move + rotate** (for the main pet and friends): a **left-drag** on
  the character moves the whole window across the desktop (window + character together, the standard
  desktop-pet behavior), and a **right-drag** rotates the character (rotation moved off the left
  button so the two coexist; the canvas right-click context menu is suppressed).
- **Pet windows shrunk to reduce the transparent area that blocks clicks**: capped to 280×240 (from
  540×960), roughly the character's on-screen footprint plus margin. Because the character's
  on-screen size is normalized to window height, the smaller window mostly trims empty margin rather
  than the character. To fit the short window, the main pet's control panel now wraps into columns
  (`flex-wrap`), and the friend's close (X) button moved to the top-right corner.
- **Summoned friends now behave like the main pet**: they wander on their own (previously
  stationary), and use the same drag interaction. The friend has no full control panel — just a
  close (X) button that appears on hover (top-right corner).
- **Scene lighting softened & widened**: directional key light intensity lowered (Math.PI → 2.0,
  then split to 1.4 key + 0.6 opposite-side fill light for ~30% broader coverage at the same total
  brightness), key direction nudged slightly lower (y 3 → 2.5), and ambient fill raised (0.1 →
  0.55) to reduce harsh contrast. Affects all models (VRM + GLB).
- **Context management** switched from rule-based selective pruning to a pure **sliding window**
  (keep all system messages + the most recent `max_rounds` rounds). The previous method is kept
  commented out for reference. Default `max_rounds=0` (no limit) is unchanged.
- **UI fully Korean-localized** via the `t()` locale method (ko-KR / en-US / zh-CN), including
  previously hardcoded/under-translated strings.
- **LLM-facing system prompts translated to English** (permission modes, VRM expression/motion
  tags, TTS voice/silence tags, the A2UI spec, character/memory injection, reasoner prompts),
  preserving all tags and placeholders.
- **Comments translated from Chinese to English**: 1,027 Python comments + 3,097 JS comments
  (4,124 total). Comment-only — code and string literals untouched.

### Removed
- China-only integrations and their dependencies (QQ/Feishu/WeChat/WeCom/DingTalk bots, bilibili
  live, modelscope, brotli, qrcode), without breaking core functionality. Bot support trimmed to
  Discord / Slack / Telegram.

### Fixed
- **Tray & native context menus showed Chinese**: the menu labels in `main.js` only had `zh-CN`
  and `en-US` locales, so when the renderer reported `ko-KR` the lookup failed and the menus fell
  back to the initial Chinese (the `zh-CN` default). Added a `ko-KR` locale block (tray "창 보이기/
  종료" plus the right-click menu: 잘라내기/복사/붙여넣기/이미지 저장/…) and set the default
  language to `ko-KR`.
- **Summoned friend could not be dragged upward** (could go left/right/down only). Root cause: the
  friend used the default 540×960 window, taller than the macOS work area, so it was pinned with
  its top at the menu bar (macOS clamps any visible window's top to `workArea.y`) — no room to move
  up. Friend windows are now capped to fit the work area with margin, leaving headroom.
- **Pet got clipped while being dragged**: macOS throttled the renderer during an OS window drag,
  freezing the transparent canvas mid-frame. Set `backgroundThrottling: false` on pet windows.
- **Main vs friend characters rendered at different on-screen sizes**: the same model looks bigger
  in a taller window (fixed camera FOV). GLB pet scale is now normalized to the window height, so
  the main pet and a shorter friend window show the character at the same on-screen size.
- **Tall dialogs could not be closed**: long dialogs (e.g. the "add behavior" dialog) grew past
  the viewport and their absolutely-positioned close (X) button scrolled out of view. Dialogs are
  now capped at 90vh with a scrollable body and pinned header/footer, so the X and footer buttons
  stay reachable. Applies to all non-fullscreen dialogs.

### Security
- CORS `allow_credentials=False` (was wildcard origins + credentials).
- SSRF: `sanitize_proxy_url` / `is_private_ip` now reject private/loopback/link-local/cloud-metadata
  targets (e.g. 169.254.169.254) instead of logging only.
