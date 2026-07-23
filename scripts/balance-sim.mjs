// 자율활동 밸런스 몬테카를로 — world.js 여가 결정 로직을 미러링해 가상 하루를 N회 돌리고
// 활동별 점유율 표를 낸다. 리팩터·튜닝의 전후 비교 게이트 (world-layout-sweep과 같은 위상).
//
//   node scripts/balance-sim.mjs                    # 현행 구성 게이트 (레지스트리 rate 0.40 · ride 150s · dur보정)
//   node scripts/balance-sim.mjs --mode chain       # 패치 전 체인 스냅샷 (ride 600s — 전/후 비교의 "전")
//   node scripts/balance-sim.mjs --mode both        # 두 모드 나란히 비교 (±편차 표)
//   node scripts/balance-sim.mjs --fit-rate         # LEISURE_RATE 역산 스윕 (7944122 마이그레이션 재현은
//                                                     동일 조건으로: --ride-sec 600 --dur-budget off)
//   옵션: --days 400 --seed 42 --rate 0.40 --ride-sec N --dur-budget off --satiety off|초 --json
// ⚠ 기본값 = world.js 현행 구성과 동기가 계약: LEISURE_RATE·SWING rideMs·weight·LEISURE_SATIETY_MS를 바꾸면 여기도 같이.
//
// ── 신규 자율활동 추가 지침 (확률이 자연스러우려면 이 8줄) ──────────────────────
// 1) 레지스트리: 펫 혼자 심심풀이 = LEISURE_ACTS(개인 롤) / 듀오·"한가한 아무나" 대리지명 = POLL_ACTS.
// 2) weight는 절대값이 아니라 앵커 비교 — 물놀이35 낚시27 그네22 트램펄린18 과일14 열기구13
//    부스간식12 잠수정11 정리·스트레칭·모래놀이10 로켓9 페리·독서·뱃놀이·라디오8. "이것보단 자주, 저것보단 드물게"로
//    자리 잡기. 총량은 LEISURE_RATE가 고정 — 추가 = 지분 재분배이지 펫 과로가 아니다.
// 3) dur(평균 지속 초)은 정직하게 — √dur 예산이 긴 활동을 자동 억제. 3분 넘는 이벤트급이면 weight 한 자리.
// 4) cd 대역: 필러 4~8분 / 보통 6~15분 / 이벤트·탈것 10~24분 + seed(부팅 직후 출발 방지 — 탈것 필수).
// 5) 시간대가 어울리면 weightAt ×1.3~×3 한 줄 (수면 22~06시는 셀렉터가 자동 차단).
// 6) fire 계약: 성공 true / 실패 false(쿨다운 안 태움·3초 재시도). 물림·성공-쿨다운·계측(actStats)은 셀렉터가 자동.
// 7) 검증 3종: 여기 ACTS에 같은 항목 추가(동기) → npm run balance:world(유효 활동 수 유지 +
//    1위 15% 밴드 + 신규 시작/일이 의도 범위) → E2E(leisureState 훅) + world-smoke. 실플레이는 ?stats=1 acts: 대조.
// 8) 신규 활동이 게이트에서 점유 10%를 넘으면 의도한 게 맞는지 재확인.
//
// 모델 노트 (실측 아님 — 코드 정적 분석 기반):
// - 시간 = "앱이 켜져 있는 활동 시간"만 흐른다 (06~22시, 하루 57,600초). 쿨다운·타이머 전부
//   활동 초 기준 — 실제 앱도 닫혀 있는 동안은 아무것도 진행되지 않으므로 이게 정직한 모델.
// - 확률·쿨다운·시드는 world.js에서 그대로 인용. 활동 지속시간은 추정치(아래 DUR 주석).
// - 미모델: 근접 트리거(포옹/쪼아나무), 비 대피(맑음 가정), 주인 조작(무빙의), 경로 막힘 실패.
// - 레지스트리 weight는 설계 의도값(물놀이 화석 지분 재설계 완료) — world.js 레지스트리와 동기 유지.

const ARG = Object.fromEntries(process.argv.slice(2).flatMap((a, i, all) => {
    if (!a.startsWith('--')) return [];
    const k = a.slice(2);
    const v = all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true;
    return [[k, v]];
}));

const DAYS = +(ARG.days || 400);
const SEED = +(ARG.seed || 42);
const MODE = ARG.mode || 'registry';            // registry(현행 기본) | chain(패치 전) | both
const RATE = +(ARG.rate || 0.40);               // registry: 여가 총량 노브 — world.js LEISURE_RATE와 동기
const rideFor = (mode) => (ARG['ride-sec'] ? +ARG['ride-sec'] : (mode === 'chain' ? 600 : 150));   // 그네 한 판 — 시대별 기본 (체인=패치 전 10분, 레지스트리=현행 2~3분 평균)
const DUR_BUDGET = ARG['dur-budget'] !== 'off'; // registry: 긴 활동 억제 보정항 — 현행 기본 on (끄기 = --dur-budget off)
const SATIETY = ARG.satiety === 'off' ? 0 : +(ARG.satiety || 1800);   // 물림 램프 초 — world.js LEISURE_SATIETY_MS(30분)와 동기 (끄기 = --satiety off)
const JSON_OUT = !!ARG.json;

// mulberry32 — 시드 고정 (재현 가능한 게이트)
function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const DAY_SEC = 16 * 3600;                       // 06:00 → 22:00
const hourAt = (t) => 6 + ((t % DAY_SEC) / 3600);
const range = (r, [a, b]) => a + r() * (b - a);

// ---- 활동 정의 — 수치는 world.js updateWander 체인(6367-6437) 인용, dur은 추정 ----
// chainP: 롤당 확률(체인 모드) · weight: 설계 의도값(레지스트리 모드 — 물놀이 재설계 반영)
// cd/seed: 초 단위 [min,max] · lock: 전역 싱글턴 키 · dur: 지속시간 초
const ACTS = [
    { id: 'dip',    ko: '물놀이',   chainP: () => 0.25,  weight: 35,  cd: [240, 480],   cdChain: [150, 300], seed: null, weightAt: (h) => (h >= 11 && h < 16 ? 1.3 : 1), dur: (r) => 30 + r() * 30 },
    { id: 'fish',   ko: '낚시',     chainP: () => 0.09,  weight: 27,  cd: [300, 600],   seed: null,       lock: 'fish',    dur: (r) => 60 + r() * 60 },
    { id: 'sub',    ko: '잠수정',   chainP: () => 0.04,  weight: 11,  cd: [600, 1200],  seed: [360, 960], lock: 'sub',     dur: (r) => 200 + r() * 80 },
    { id: 'balloon',ko: '열기구',   chainP: () => 0.05,  weight: 13,  cd: [420, 840],   seed: [240, 720], lock: 'balloon', weightAt: (h) => (h >= 17 && h < 19.5 ? 2 : 1), dur: (r) => 170 + r() * 60 },
    { id: 'rocket', ko: '로켓',     chainP: (h) => (h >= 18.5 ? 0.07 : 0.035), weight: 9, weightAt: (h) => (h >= 18.5 ? 2 : 1),
                    cd: [720, 1440], seed: [420, 1020], lock: 'rocket', dur: (r) => 420 + (r() < 0.4 ? 55 + r() * 55 : 0) },
    { id: 'tramp',  ko: '트램펄린', chainP: () => 0.06,  weight: 18,  cd: [360, 720],   seed: [180, 480], lock: 'tramp',   dur: (r) => 30 + r() * 20 },
    { id: 'fruit',  ko: '과일따기', chainP: () => 0.05,  weight: 14,  cd: [420, 900],   seed: [240, 600], lock: 'fruit',   weightAt: (h) => (h >= 6 && h < 10 ? 1.5 : 1), dur: (r) => 45 + r() * 30 },
    { id: 'tidy',   ko: '낙과정리', chainP: () => 0.04,  weight: 10,   cd: [360, 780],   seed: [300, 600], lock: 'tidy',    dur: (r) => 45 + r() * 30, needsFruit: true },
    { id: 'ferry',  ko: '페리',     chainP: () => 0.04,  weight: 8,   cd: [480, 960],   seed: [300, 780], lock: 'ferry',   weightAt: (h) => (h >= 17 && h < 19.5 ? 1.5 : 1), dur: (r) => 170 + r() * 60 },
    { id: 'swing',  ko: '그네/시소',chainP: () => 0.14,  weight: 22,  cd: [180, 360],   seed: null,       dur: () => rideNow, cdAtMount: true },
    // 신설 조 (레지스트리 모드 전용 — chainP 0: 구 체인에 없던 활동들. gym/library는 소비 블록 누락 부활, treat는 부스 간식 신설)
    { id: 'gym',    ko: '스트레칭', chainP: () => 0,     weight: 10,   cd: [600, 1200],  seed: null,       lock: 'gym',     weightAt: (h) => (h >= 6 && h < 9 ? 3 : 1), dur: (r) => 12 + r() * 6 },
    { id: 'library',ko: '독서',     chainP: () => 0,     weight: 8,   cd: [600, 1200],  seed: null,       weightAt: (h) => (h >= 19 ? 2 : 1), dur: (r) => 120 + r() * 120 },
    { id: 'treat',  ko: '부스간식', chainP: () => 0,     weight: 12,  cd: [480, 900],   seed: null,       lock: 'treat',   weightAt: (h) => ((h >= 7 && h < 10) || (h >= 14 && h < 17) ? 1.3 : 1), dur: (r) => 70 + r() * 40 },
    { id: 'sand',   ko: '모래놀이', chainP: () => 0,     weight: 10,  cd: [480, 960],   seed: null,       dur: (r) => 90 + r() * 90 },   // 자리 2개 — 락 없음
    { id: 'boat',   ko: '뱃놀이',   chainP: () => 0,     weight: 8,   cd: [600, 1200],  seed: [300, 780], lock: 'boat',    dur: (r) => 55 + r() * 50 },
    { id: 'radio',  ko: '라디오',   chainP: () => 0,     weight: 8,   cd: [600, 1200],  seed: null,       lock: 'radio',   dur: (r) => 25 + r() * 30 },
    { id: 'cook',   ko: '요리',     chainP: () => 0,     weight: 10,  cd: [600, 1200],  seed: null,       lock: 'cook',    weightAt: (h) => ((h >= 11 && h < 12) || (h >= 17 && h < 18) ? 1.3 : 1), dur: (r) => 90 + r() * 60 },   // 재고 게이트는 미모델(주석)
];
// 체인 검사 순서 = 코드 순서 (dip → fish → sub → balloon → rocket → tramp → fruit → tidy → ferry → swing)

// 전역 주기 추첨 — world.js 4648-4665 · 7149-7155 · 17050-17056 인용 (dur 추정)
const LOTTO = [
    { id: 'piano',    ko: '피아노',   every: 1200, p: 0.08, dur: (r) => 35 + r() * 15, kind: 'solo' },
    { id: 'dig',      ko: '보물발굴', every: 900,  p: 0.10, dur: (r) => 25 + r() * 15, kind: 'solo', daily: true },
    { id: 'hideseek', ko: '숨바꼭질', every: 720,  p: 0.12, dur: (r) => 130 + r() * 50, kind: 'duo', daylight: true },
];

let rideNow = 150;   // 그네 지속 — simulate가 모드별 기본으로 채운다 (dur 클로저가 읽음)
function simulate(mode, opts = {}) {
    rideNow = rideFor(mode);
    const r = rng(opts.seed ?? SEED);
    const rate = opts.rate ?? RATE;
    const stats = {};                                       // id → { starts, busy }
    const stat = (id) => (stats[id] = stats[id] || { starts: 0, busy: 0 });
    for (const a of ACTS) stat(a.id);
    for (const l of LOTTO) stat(l.id);
    stat('meal');
    let wanderSec = 0, bothFreeSec = 0;

    // 펫 상태: mode idle|walk|busy, until = 전이 시각, cd/seeded = 활동별
    const pets = [0, 1].map(() => ({
        mode: 'idle', until: range(r, [1.5, 4.5]), busyId: null,
        cd: {}, seeded: {}, last: {}, mealDone: -1, dipKind: null, dipExt: 0,
    }));
    const locks = {};                                       // 전역 싱글턴 (탈것·aiX)
    const ground = [];                                      // 낙과 { bornAt } — 정리 후보/시들기
    const lotto = LOTTO.map((l) => ({ ...l, nextAt: l.every, dug: false }));
    let duoBusyUntil = 0;
    let diveNext = 25;

    const free = (p) => p.mode !== 'busy';
    const stampCd = (p, a, t) => { p.cd[a.id] = t + range(r, (mode === 'chain' && a.cdChain) || a.cd); };   // cdChain = 패치 전 값 보존 (체인 모드는 역사 스냅샷)
    const begin = (p, a, t) => {
        const d = a.dur(r);
        p.mode = 'busy'; p.busyId = a.id; p.until = t + d;
        p.last[a.id] = t;   // 물림 스탬프 (체인 모드는 안 읽는다 — 물림 없던 시절 재현)
        if (a.lock) locks[a.lock] = true;
        if (a.id === 'dip') { p.dipKind = r() < 0.5 ? 'sea' : 'pond'; p.dipExt = 0; }
        stat(a.id).starts += 1;
        return d;
    };
    const eligible = (p, a, t, h) => {
        if (t < (p.cd[a.id] || 0)) return false;
        if (a.lock && locks[a.lock]) return false;
        if (a.needsFruit && !ground.some((g) => t - g.bornAt > 180 && t - g.bornAt < 21600)) return false;
        return true;                                        // 전 항목 !isSleepTime — 시뮬 창 자체가 06~22시
    };

    // 체인 모드 1롤 — 코드 순서·시드 관용구·쿨다운 선스탬프(버그 포함) 충실 재현
    const rollChain = (p, t, h) => {
        for (const a of ACTS) {
            if (a.seed && !p.seeded[a.id]) {                // 시드 패스가 그 틱의 검사를 소모 (else-if 재현)
                p.seeded[a.id] = true;
                p.cd[a.id] = t + range(r, a.seed);
                continue;
            }
            if (!eligibleChain(p, a, t)) continue;
            if (r() >= a.chainP(h)) continue;
            if (!a.cdAtMount) stampCd(p, a, t);             // 현행: 시작 전에 쿨다운부터 (실패도 태움)
            if (a.needsFruit) {
                const i = ground.findIndex((g) => t - g.bornAt > 180 && t - g.bornAt < 21600);
                if (i < 0) return false;                    // 낙과 없음 — 쿨다운만 타고 헛방 (현행 버그)
                ground.splice(i, 1);
            }
            if (a.cdAtMount) stampCd(p, a, t);              // 그네: 탑승 시점 앵커 (하차 땐 이미 만료)
            begin(p, a, t);
            if (a.id === 'fruit') { const n = 2 + Math.floor(r() * 3); for (let k = 0; k < n; k++) ground.push({ bornAt: t }); }
            return true;
        }
        return false;
    };
    const eligibleChain = (p, a, t) => !(t < (p.cd[a.id] || 0)) && !(a.lock && locks[a.lock]);

    // 레지스트리 모드 1롤 — 총량 게이트 + 가중 1회 추첨, 쿨다운은 성공에만 (목표 구조)
    const rollRegistry = (p, t, h) => {
        for (const a of ACTS) if (a.seed && !p.seeded[a.id]) { p.seeded[a.id] = true; p.cd[a.id] = t + range(r, a.seed); }
        if (r() >= rate) return false;
        const pool = ACTS.filter((a) => eligible(p, a, t, h));
        if (!pool.length) return false;
        const w = pool.map((a) => (a.weight * (a.weightAt ? a.weightAt(h) : 1))
            * (SATIETY ? Math.min(1, Math.max(0.2, (t - (p.last[a.id] ?? -1e9)) / SATIETY)) : 1)
            / (DUR_BUDGET ? Math.sqrt(Math.max(0.5, avgDur(a) / 60)) : 1));
        let x = r() * w.reduce((s, v) => s + v, 0);
        let pick = pool[0];
        for (let i = 0; i < pool.length; i++) { x -= w[i]; if (x <= 0) { pick = pool[i]; break; } }
        if (pick.needsFruit) {
            const i = ground.findIndex((g) => t - g.bornAt > 180 && t - g.bornAt < 21600);
            if (i < 0) return false;                        // ready()가 걸렀어야 하지만 방어적으로
            ground.splice(i, 1);
        }
        begin(p, pick, t);
        stampCd(p, pick, t);                                // 성공에만 — 실패 재시도는 ready() 필터가 대체
        if (pick.id === 'fruit') { const n = 2 + Math.floor(r() * 3); for (let k = 0; k < n; k++) ground.push({ bornAt: t }); }
        return true;
    };
    const durCache = new Map();
    const avgDur = (a) => {   // 보정항용 평균 지속시간 — 항목당 1회 샘플링 캐시 (--ride-sec 반영)
        if (!durCache.has(a.id)) { let s = 0; const rr = rng(7); for (let i = 0; i < 32; i++) s += a.dur(rr); durCache.set(a.id, s / 32); }
        return durCache.get(a.id);
    };

    const TOTAL = DAYS * DAY_SEC;
    for (let t = 0; t < TOTAL; t++) {
        const h = hourAt(t);
        const dayT = t % DAY_SEC;
        if (dayT === 0) { for (const l of lotto) l.dug = false; }

        // 전역 추첨 (피아노·발굴·숨바꼭질) — 독립 타이머, 활동 초 기준
        for (const l of lotto) {
            if (t < l.nextAt) continue;
            l.nextAt = t + l.every;
            if (l.daily && l.dug) continue;
            if (l.daylight && !(h >= 7 && h < 19)) continue;
            if (r() >= l.p) continue;
            if (l.kind === 'duo') {
                if (t < duoBusyUntil || !pets.every(free)) continue;
                const d = l.dur(r);
                for (const p of pets) { p.mode = 'busy'; p.busyId = l.id; p.until = t + d; }
                duoBusyUntil = t + d;
                stat(l.id).starts += 1;
            } else {
                const p = pets.find(free);
                if (!p) continue;
                p.mode = 'busy'; p.busyId = l.id; p.until = t + l.dur(r);
                if (l.daily) l.dug = true;
                stat(l.id).starts += 1;
            }
        }
        // 자율 잠수 — 25초 폴, 바다 물놀이 중 30% 연장 (최대 2회)
        if (t >= diveNext) {
            diveNext = t + 25;
            const p = pets.find((q) => q.mode === 'busy' && q.busyId === 'dip' && q.dipKind === 'sea' && q.dipExt < 2);
            if (p && r() < 0.3) { p.until += 15; p.dipExt += 1; }
        }
        // 밥때 8·12·18시 (30분 창, 하루 한 번)
        const meal = [8, 12, 18].find((m) => h >= m && h < m + 0.5);
        for (const p of pets) {
            if (meal !== undefined && p.mealDone !== Math.floor(t / DAY_SEC) * 10 + meal && free(p)) {
                p.mealDone = Math.floor(t / DAY_SEC) * 10 + meal;
                p.mode = 'busy'; p.busyId = 'meal'; p.until = t + 60 + r() * 60;
                stat('meal').starts += 1;
            }
        }

        if (pets.every(free)) bothFreeSec += 1;
        for (const p of pets) {
            if (p.mode === 'busy') {
                stat(p.busyId).busy += 1;
                if (t >= p.until) {
                    const a = ACTS.find((x) => x.id === p.busyId);
                    if (a && a.lock) locks[a.lock] = false;
                    p.mode = 'idle'; p.until = t + range(r, [1.5, 2.5]); p.busyId = null;   // releaseAI
                }
                continue;
            }
            wanderSec += 1;
            if (p.mode === 'walk') { if (t >= p.until) { p.mode = 'idle'; p.until = t + range(r, [2, 6]); } continue; }
            if (t < p.until) continue;                      // idle 대기
            const fired = mode === 'chain' ? rollChain(p, t, h) : rollRegistry(p, t, h);
            if (!fired) p.mode = 'walk', p.until = t + range(r, [2, 8]);   // 배회 한 걸음
        }
        // 낙과 시들기 6h — 배열 청소 (드물게)
        if (dayT % 600 === 0 && ground.length) for (let i = ground.length - 1; i >= 0; i--) if (t - ground[i].bornAt > 21600) ground.splice(i, 1);
    }

    const rows = Object.entries(stats)
        .map(([id, s]) => {
            const meta = ACTS.find((a) => a.id === id) || LOTTO.find((l) => l.id === id) || { ko: id === 'meal' ? '식사' : id };
            return {
                id, ko: meta.ko,
                perDay: s.starts / DAYS,
                minPerDay: s.busy / DAYS / 60,
                share: s.busy / (DAYS * DAY_SEC * pets.length),
            };
        })
        .sort((a, b) => b.share - a.share);
    return { rows, wanderShare: wanderSec / (DAYS * DAY_SEC * pets.length), bothFree: bothFreeSec / (DAYS * DAY_SEC) };
}

const fmt = (x, d = 1) => x.toFixed(d).padStart(6);
function printRun(label, out) {
    console.log(`\n== ${label} — ${DAYS}일 (시드 ${SEED}) ==`);
    console.log('활동         시작/일   분/일   점유율');
    for (const row of out.rows) {
        if (row.perDay < 0.005) continue;
        console.log(`${(row.ko + '          ').slice(0, 7)} ${fmt(row.perDay, 2)} ${fmt(row.minPerDay)} ${fmt(row.share * 100)}%`);
    }
    console.log(`한가로움(배회·대기) 점유율 ${(out.wanderShare * 100).toFixed(1)}% · 둘 다 한가 비율 ${(out.bothFree * 100).toFixed(1)}%`);
    // 다양성 게이지: 유효 활동 수 = 1/Σ(여가 점유 비중²) — 전부 균등하면 활동 수, 1강 과점이면 1로 수렴.
    const ls = out.rows.filter((x) => ACTS.some((a) => a.id === x.id) && x.share > 0);
    const tot = ls.reduce((s, x) => s + x.share, 0);
    const effN = 1 / ls.reduce((s, x) => s + (x.share / tot) ** 2, 0);
    const band = ls[0].share > 0.15 ? '  ← 15% 밴드 밖' : '';
    console.log(`다양성: 유효 활동 수 ${effN.toFixed(1)}종 · 1위 시간점유 ${(ls[0].share * 100).toFixed(1)}% (${ls[0].ko})${band}`);
}

if (ARG['fit-rate']) {
    // LEISURE_RATE 역산: 체인 베이스라인의 총 여가 시작 횟수에 가장 가까운 rate를 찾는다
    const base = simulate('chain');
    const target = base.rows.filter((x) => ACTS.some((a) => a.id === x.id)).reduce((s, x) => s + x.perDay, 0);
    console.log(`체인 베이스라인 여가 시작 합계: ${target.toFixed(2)}회/일 (펫 2)`);
    for (let rate = 0.1; rate <= 0.61; rate += 0.05) {
        const out = simulate('registry', { rate });
        const tot = out.rows.filter((x) => ACTS.some((a) => a.id === x.id)).reduce((s, x) => s + x.perDay, 0);
        console.log(`  rate ${rate.toFixed(2)} → ${tot.toFixed(2)}회/일 (편차 ${(100 * (tot - target) / target).toFixed(1)}%)`);
    }
    process.exit(0);
}

if (MODE === 'both') {
    const a = simulate('chain'), b = simulate('registry');
    printRun('구 체인 (패치 전 · ride 600s)', a);
    printRun(`레지스트리 (rate ${RATE}${DUR_BUDGET ? ' · dur보정' : ''} · ride ${rideFor('registry')}s)`, b);
    console.log('\n== 편차 (레지스트리 vs 체인, 시작/일 기준) ==');
    for (const row of a.rows) {
        if (!ACTS.some((x) => x.id === row.id) || row.perDay < 0.01) continue;
        const m = b.rows.find((x) => x.id === row.id);
        const dev = m ? (100 * (m.perDay - row.perDay) / row.perDay) : -100;
        const flag = Math.abs(dev) > 15 ? '  ← ±15% 밖' : '';
        console.log(`${(row.ko + '          ').slice(0, 7)} ${fmt(row.perDay, 2)} → ${fmt(m ? m.perDay : 0, 2)}  (${dev >= 0 ? '+' : ''}${dev.toFixed(1)}%)${flag}`);
    }
} else {
    const out = simulate(MODE);
    if (JSON_OUT) console.log(JSON.stringify(out, null, 1));
    else {
        printRun(MODE === 'chain' ? '구 체인 (패치 전 · ride 600s)' : `레지스트리 — 현행 구성 (rate ${RATE}${DUR_BUDGET ? ' · dur보정' : ''} · ride ${rideFor('registry')}s)`, out);
        const top = out.rows[0];
        if (top && top.share > 0.25) console.log(`⚠ 단일 활동 점유율 25% 초과: ${top.ko} ${(top.share * 100).toFixed(1)}%`);
    }
}
