# Railway(등 PaaS) 배포 가이드 — 월드+채팅을 웹으로

로컬 Electron 앱은 그대로 두고, **브라우저로 쓰는 월드+채팅 백엔드**를 클라우드에 올리는 시나리오다.
(데스크톱 펫 창은 어차피 로컬 전용. 집 밖에서 폰 접속만 필요하면 Tailscale이 더 간단하다.)

## 준비돼 있는 것
- `Dockerfile` — Railway가 그대로 빌드한다. `PORT` env 자동 존중.
- 프론트는 전부 상대경로(fetch/WS) → 도메인이 무엇이든 동작.
- `IS_DOCKER=1`이면 모든 사용자 데이터가 `/app/data`로 간다 (`py/get_setting.py`).
- 월드 개인 데이터(world_*.json)는 USER_DATA_DIR/world 에 저장된다 (Docker에선 `/app/data/...`).

## Railway 설정 (한 번만)
1. **New Project → Deploy from GitHub repo** (Dockerfile 자동 감지)
2. **Variables**:
   - `IS_DOCKER=1`
   - `SAP_AUTH_TOKEN=<긴 랜덤 문자열>`  ← 이거 없이 공개망에 올리면 아무나 LLM 키로 채팅하고
     개인 데이터(소원·기억)를 읽는다. 반드시 설정.
   - LLM 키 등은 배포 후 설정 UI에서 넣으면 `/app/data`에 저장됨 (볼륨 덕에 유지)
3. **Volume**: Service → Volumes → mount path `/app/data`
   (없으면 재배포 때마다 배치·기억·소원이 초기화된다 — 제일 흔한 함정)
4. 배포 후 접속: `https://<앱도메인>/world.html?token=<SAP_AUTH_TOKEN>`
   - 토큰은 첫 1회만 — 90일 쿠키가 심어져 이후엔 그냥 접속. WS도 쿠키로 통과.
   - API 직접 호출은 `Authorization: Bearer <토큰>` 헤더.

## 로컬 동작은 변하지 않는다
`SAP_AUTH_TOKEN`을 설정하지 않으면 인증 게이트는 완전히 꺼져 있고,
`PORT`/`HOST` env가 없으면 기존 기본값(127.0.0.1:3456)이다.
