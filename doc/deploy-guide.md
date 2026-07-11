# 배포 가이드 — 데스크톱 앱(dmg) & 웹 백엔드

이 프로젝트는 배포 표면이 **둘**이다. 헷갈리지 말 것:

| 표면 | 내용물 | 배포 방법 |
|---|---|---|
| **A. 데스크톱 앱 (dmg)** | 펫 창 + 월드 + 트레이 — "완성된 게임" 본체 | GitHub Releases에 dmg 업로드 |
| **B. 웹 백엔드** | 브라우저로 쓰는 월드+채팅 (폰에서 어디서나) | Tailscale / Cloudflare Tunnel / Railway |

이런 개인용 데스크톱 앱은 **보통 클라우드에 배포하지 않는다** — dmg를 GitHub Releases에 올리는 게
표준이다. 웹 배포(B)는 "집 밖에서 폰으로 월드 접속"이 필요할 때만 선택하는 부가 옵션.

---

## A. 데스크톱 앱 빌드 & 배포

### A-1. dmg 빌드 (한 줄)
```bash
npm run dist:mac
```
내부적으로 두 단계가 돈다 (개별 실행도 가능):
```bash
.venv/bin/pyinstaller server.spec --noconfirm   # 서버+월드+펫GLB → dist/server (~10분)
npx electron-builder --mac                       # → release/*.dmg (~469MB)
```
- 애드혹 서명(identity '-')이라 **인증서 불요**. 받는 사람은 첫 실행만 우클릭→열기.
- 불특정 다수 공개 배포 시에만 Apple Developer($99/년) 공증 고려.

### A-2. GitHub Releases 업로드
```bash
git tag v1.0.0 && git push origin v1.0.0
gh release create v1.0.0 release/*-Mac.dmg --title "v1.0.0" --notes "CHANGELOG 참고"
```
이후 누구든(미래의 나 포함) Releases 페이지에서 다운로드.

### A-3. "업데이트마다 매번 새로 빌드해야 하나?" → 예, 하지만:
- dmg는 **배포용 스냅샷**이다. 코드가 바뀌면(월드 js 한 줄이라도) dmg 안에 박제되므로
  새 버전을 내려면 다시 빌드해야 한다 — `npm run dist:mac` 한 줄, 방치하면 끝.
- **내 맥에서 개발/플레이할 때는 dmg를 쓸 필요가 없다** — 지금처럼 `npm run dev`로 소스 실행.
  dmg는 "버전을 릴리즈하고 싶을 때"만 굽는다 (예: 월에 한 번).
- **데이터는 안전하다**: 배치·소원·기억은 전부 USER_DATA_DIR에 있어서 dmg를 지우고
  새로 설치해도 그대로 이어진다.
- 더 자동화하고 싶어지면(선택): ① GitHub Actions로 태그 푸시 시 자동 빌드+Release
  ② electron-updater로 앱 내 자동 업데이트. 지금 단계에선 과투자.

---

## B. 웹 백엔드 배포 — 상황별 3가지 길

공통 전제: 프론트는 전부 상대경로, 데이터는 파일(USER_DATA_DIR), 인증 게이트(SAP_AUTH_TOKEN)
와 PORT env는 이미 준비돼 있다. **아래 어떤 길을 골라도 코드 수정은 없다.**

### B-1. Tailscale — "내 폰에서만, 공짜, 5분" ← 대부분의 경우 정답
맥이 켜져 있을 때 내 기기들만 접속. 서버 배포가 아니라서 제일 안전하다.
1. 맥과 아이폰에 Tailscale 설치, 같은 계정 로그인
2. 앱 설정에서 networkVisible='global' (0.0.0.0 바인딩)
3. 폰에서 `http://<맥의 Tailscale IP>:3456/world.html`
- 장점: 무료·무설정·개인 데이터 노출 없음 / 한계: 맥이 켜져 있어야 함, 나만 접속

### B-2. Cloudflare Tunnel — "이 맥(미니)을 서버로, 도메인+HTTPS, 공짜"
맥을 상시 켜둘 수 있으면 클라우드 없이 진짜 도메인으로 공개 가능.
1. `brew install cloudflared` → `cloudflared tunnel login`
2. `cloudflared tunnel create pets` → 도메인 라우팅 → `cloudflared tunnel run` (localhost:3456으로)
3. **반드시** 서버 실행 시 `SAP_AUTH_TOKEN=<긴 랜덤 문자열>` 설정 — 공개망이므로
4. 접속: `https://내도메인/world.html?token=<토큰>` (첫 1회, 이후 90일 쿠키)
- 장점: 월 0원, 데이터가 집에 있음, HTTPS 자동 / 한계: 맥 상시 구동 필요

### B-3. Railway — "맥을 꺼도 도는 클라우드" (Render/Fly.io도 동일 절차)
1. Railway → New Project → **Deploy from GitHub repo** (Dockerfile 자동 감지)
2. Variables 설정:
   - `IS_DOCKER=1` (데이터가 /app/data로 가게)
   - `SAP_AUTH_TOKEN=<긴 랜덤 문자열>` — 없이 올리면 아무나 내 LLM 키로 채팅함. 필수.
3. **Volume 추가: mount path `/app/data`** ← 없으면 재배포마다 배치·기억·소원 초기화. 최다 실수.
4. 배포 후 `https://<도메인>/world.html?token=<토큰>` 접속, 설정 UI에서 LLM 키 입력
- 장점: 맥 꺼도 동작, 관리 없음 / 한계: 월 ~$5+, 이미지가 커서(ML 의존성) 첫 빌드 오래 걸림,
  콜드스타트 ~20초. **데스크톱 펫 창은 어차피 로컬 전용** — 클라우드에 올라가는 건 월드+채팅뿐.

### 선택 기준 요약
- 그냥 내 폰으로 밖에서 보고 싶다 → **B-1 Tailscale**
- 도메인 걸고 지인에게도 링크 주고 싶다, 맥은 늘 켜져 있다 → **B-2 Cloudflare Tunnel**
- 맥을 꺼도 월드가 살아있어야 한다 → **B-3 Railway**
