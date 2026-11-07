// Autonomous activity balance Monte Carlo — mirrors the world.js leisure decision logic, runs a virtual day N times
// and prints a per-activity share table. Before/after comparison gate for refactors and tuning (same tier as world-layout-sweep).
//
//   node scripts/balance-sim.mjs                    # current-config gate (registry rate 0.40 · ride 150s · dur correction)
//   node scripts/balance-sim.mjs --mode chain       # pre-patch chain snapshot (ride 600s — the "before" of before/after)
//   node scripts/balance-sim.mjs --mode both        # compare both modes side by side (±delta table)
//   node scripts/balance-sim.mjs --fit-rate         # LEISURE_RATE back-solve sweep (to reproduce the 7944122 migration,
//                                                     use the same conditions: --ride-sec 600 --dur-budget off)
//   node scripts/balance-sim.mjs --day 2026-08-08     # day sampler: roll one "abstract day" for an absent day
//                                                       seeded by the date and emit event JSON (diary daemon material)
//   options: --days 400 --seed 42 --rate 0.40 --ride-sec N --dur-budget off --satiety off|seconds --json
// ⚠ Contract: defaults stay in sync with the current world.js config — if you change LEISURE_RATE · SWING rideMs · weight · LEISURE_SATIETY_MS, change them here too.
//
// ── Guidelines for adding a new autonomous activity (these 8 lines keep the odds natural) ──────────────────────
// 1) Registry: a pet's solo pastime = LEISURE_ACTS (per-pet roll) / duo or "whoever is idle" delegation = POLL_ACTS.
// 2) weight is not absolute but relative to anchors — swim 35, fishing 27, swing 22, trampoline 18, fruit 14, balloon 13,
//    booth snack 12, submarine 11, tidy/stretch/sand play 10, rocket 9, ferry/reading/boat ride/radio 8. Settle it in by "more often than this, rarer than that".
//    The total is fixed by LEISURE_RATE — adding one redistributes shares, it does not overwork the pet.
// 3) Be honest with dur (mean duration in seconds) — the √dur budget automatically suppresses long activities. Event-class ones over 3 minutes get a single-digit weight.
// 4) cd bands: filler 4~8 min / normal 6~15 min / event·vehicle 10~24 min + seed (prevents departing right after boot — mandatory for vehicles).
// 5) If a time of day fits, one weightAt line of ×1.3~×3 (sleep 22~06 is blocked automatically by the selector).
// 6) fire contract: success true / failure false (no cooldown burned · retry in 3s). Satiety, success-cooldown and metrics (actStats) are handled by the selector.
// 7) Three checks: add the same entry to ACTS here (sync) → npm run balance:world (effective activity count kept +
//    top-1 within the 15% band + new starts/day in the intended range) → E2E (leisureState hook) + world-smoke. For real play, compare against ?stats=1 acts:.
//    + one diary line in the day sampler LINES below — without it, the activity never shows in diaries for absent days (days without a session).
// 8) If the new activity exceeds a 10% share at the gate, double-check that is intended.
//
// Model notes (not measured — based on static code analysis):
// - Time = only "active time with the app running" elapses (06~22, 57,600 s per day). All cooldowns and timers
//   are in active seconds — nothing progresses in the real app while it is closed either, so this is the honest model.
// - Probabilities, cooldowns and seeds are quoted verbatim from world.js. Activity durations are estimates (see DUR comments below).
// - Not modeled: proximity triggers (hug / pecking tree), rain shelter (assumes clear weather), owner input (no possession), blocked-path failures.
// - Registry weights are the design intent values (the fossilized swim share has been redesigned) — keep in sync with the world.js registry.

const ARG = Object.fromEntries(process.argv.slice(2).flatMap((a, i, all) => {
    if (!a.startsWith('--')) return [];
    const k = a.slice(2);
    const v = all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true;
    return [[k, v]];
}));

const DAYS = +(ARG.days || 400);
const SEED = +(ARG.seed || 42);
const MODE = ARG.mode || 'registry';            // registry (current default) | chain (pre-patch) | both
const RATE = +(ARG.rate || 0.40);               // registry: total leisure knob — in sync with world.js LEISURE_RATE
const rideFor = (mode) => (ARG['ride-sec'] ? +ARG['ride-sec'] : (mode === 'chain' ? 600 : 150));   // One swing session — per-era default (chain = pre-patch 10 min, registry = current 2~3 min average)
const DUR_BUDGET = ARG['dur-budget'] !== 'off'; // registry: correction term suppressing long activities — on by default now (disable = --dur-budget off)
const SATIETY = ARG.satiety === 'off' ? 0 : +(ARG.satiety || 1800);   // Satiety ramp seconds — in sync with world.js LEISURE_SATIETY_MS (30 min) (disable = --satiety off)
const JSON_OUT = !!ARG.json;

// mulberry32 — fixed seed (reproducible gate)
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

// ---- Activity definitions — numbers quoted from the world.js updateWander chain (6367-6437), dur is estimated ----
// chainP: probability per roll (chain mode) · weight: design intent value (registry mode — reflects the swim redesign)
// cd/seed: [min,max] in seconds · lock: global singleton key · dur: duration in seconds
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
    // New group (registry mode only — chainP 0: activities absent from the old chain. gym/library revived after their missing consume block, treat is the new booth snack)
    { id: 'gym',    ko: '스트레칭', chainP: () => 0,     weight: 10,   cd: [600, 1200],  seed: null,       lock: 'gym',     weightAt: (h) => (h >= 6 && h < 9 ? 3 : 1), dur: (r) => 12 + r() * 6 },
    { id: 'library',ko: '독서',     chainP: () => 0,     weight: 8,   cd: [600, 1200],  seed: null,       weightAt: (h) => (h >= 19 ? 2 : 1), dur: (r) => 120 + r() * 120 },
    { id: 'treat',  ko: '부스간식', chainP: () => 0,     weight: 12,  cd: [480, 900],   seed: null,       lock: 'treat',   weightAt: (h) => ((h >= 7 && h < 10) || (h >= 14 && h < 17) ? 1.3 : 1), dur: (r) => 70 + r() * 40 },
    { id: 'sand',   ko: '모래놀이', chainP: () => 0,     weight: 10,  cd: [480, 960],   seed: null,       dur: (r) => 40 + r() * 35 },   // 2 seats — no lock (40~75s, in sync with world.js _sandUntil)
    { id: 'meadow', ko: '동산소풍', chainP: () => 0,     weight: 10,  cd: [480, 960],   seed: null,       weightAt: (h) => (h >= 10 && h < 17 ? 1.5 : 1), dur: (r) => 70 + r() * 80 },   // 🌸 Chick Meadow bench — 2 seats (duo), in sync with world.js startMeadowPicnic
    { id: 'boat',   ko: '뱃놀이',   chainP: () => 0,     weight: 8,   cd: [600, 1200],  seed: [300, 780], lock: 'boat',    dur: (r) => 55 + r() * 50 },
    { id: 'radio',  ko: '라디오',   chainP: () => 0,     weight: 8,   cd: [600, 1200],  seed: null,       lock: 'radio',   dur: (r) => 25 + r() * 30 },
    { id: 'cook',   ko: '요리',     chainP: () => 0,     weight: 10,  cd: [600, 1200],  seed: null,       lock: 'cook',    weightAt: (h) => ((h >= 11 && h < 12) || (h >= 17 && h < 18) ? 1.3 : 1), dur: (r) => 90 + r() * 60 },   // Stock gate not modeled (see comment)
];
// Chain check order = code order (dip → fish → sub → balloon → rocket → tramp → fruit → tidy → ferry → swing)

// Global periodic draws — quoted from world.js 4648-4665 · 7149-7155 · 17050-17056 (dur estimated)
const LOTTO = [
    { id: 'piano',    ko: '피아노',   every: 1200, p: 0.08, dur: (r) => 35 + r() * 15, kind: 'solo' },
    { id: 'dig',      ko: '보물발굴', every: 900,  p: 0.10, dur: (r) => 25 + r() * 15, kind: 'solo', daily: true },
    { id: 'hideseek', ko: '숨바꼭질', every: 720,  p: 0.12, dur: (r) => 130 + r() * 50, kind: 'duo', daylight: true },
];

let rideNow = 150;   // Swing duration — simulate fills it with the per-mode default (read by the dur closure)
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

    // Pet state: mode idle|walk|busy, until = transition time, cd/seeded = per activity
    const pets = [0, 1].map(() => ({
        mode: 'idle', until: range(r, [1.5, 4.5]), busyId: null,
        cd: {}, seeded: {}, last: {}, mealDone: -1, dipKind: null, dipExt: 0,
    }));
    const locks = {};                                       // Global singletons (vehicles · aiX)
    const ground = [];                                      // Fallen fruit { bornAt } — tidy candidates / withering
    const lotto = LOTTO.map((l) => ({ ...l, nextAt: l.every, dug: false }));
    let duoBusyUntil = 0;
    let diveNext = 25;

    const free = (p) => p.mode !== 'busy';
    const stampCd = (p, a, t) => { p.cd[a.id] = t + range(r, (mode === 'chain' && a.cdChain) || a.cd); };   // cdChain = preserves pre-patch values (chain mode is a historical snapshot)
    const begin = (p, a, t) => {
        const d = a.dur(r);
        p.mode = 'busy'; p.busyId = a.id; p.until = t + d;
        p.last[a.id] = t;   // Satiety stamps (chain mode does not read them — reproduces the pre-satiety era)
        if (a.lock) locks[a.lock] = true;
        if (a.id === 'dip') { p.dipKind = r() < 0.5 ? 'sea' : 'pond'; p.dipExt = 0; }
        stat(a.id).starts += 1;
        if (opts.log) opts.log.push({ t, id: a.id, pet: pets.indexOf(p) });   // Footprints for the day sampler
        return d;
    };
    const eligible = (p, a, t, h) => {
        if (t < (p.cd[a.id] || 0)) return false;
        if (a.lock && locks[a.lock]) return false;
        if (a.needsFruit && !ground.some((g) => t - g.bornAt > 180 && t - g.bornAt < 21600)) return false;
        return true;                                        // All entries !isSleepTime — the sim window itself is 06~22
    };

    // Chain mode, 1 roll — faithfully reproduces code order, seed idiom and pre-stamped cooldown (bug included)
    const rollChain = (p, t, h) => {
        for (const a of ACTS) {
            if (a.seed && !p.seeded[a.id]) {                // The seed pass consumes that tick's check (reproduces the else-if)
                p.seeded[a.id] = true;
                p.cd[a.id] = t + range(r, a.seed);
                continue;
            }
            if (!eligibleChain(p, a, t)) continue;
            if (r() >= a.chainP(h)) continue;
            if (!a.cdAtMount) stampCd(p, a, t);             // Current: cooldown first, before starting (burned even on failure)
            if (a.needsFruit) {
                const i = ground.findIndex((g) => t - g.bornAt > 180 && t - g.bornAt < 21600);
                if (i < 0) return false;                    // No fallen fruit — burns the cooldown and whiffs (current bug)
                ground.splice(i, 1);
            }
            if (a.cdAtMount) stampCd(p, a, t);              // Swing: anchored at boarding time (already expired by dismount)
            begin(p, a, t);
            if (a.id === 'fruit') { const n = 2 + Math.floor(r() * 3); for (let k = 0; k < n; k++) ground.push({ bornAt: t }); }
            return true;
        }
        return false;
    };
    const eligibleChain = (p, a, t) => !(t < (p.cd[a.id] || 0)) && !(a.lock && locks[a.lock]);

    // Registry mode, 1 roll — total gate + one weighted draw, cooldown only on success (target structure)
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
            if (i < 0) return false;                        // ready() should have filtered this, but be defensive
            ground.splice(i, 1);
        }
        begin(p, pick, t);
        stampCd(p, pick, t);                                // Only on success — the ready() filter replaces failure retries
        if (pick.id === 'fruit') { const n = 2 + Math.floor(r() * 3); for (let k = 0; k < n; k++) ground.push({ bornAt: t }); }
        return true;
    };
    const durCache = new Map();
    const avgDur = (a) => {   // Mean duration for the correction term — sampled once per entry and cached (honors --ride-sec)
        if (!durCache.has(a.id)) { let s = 0; const rr = rng(7); for (let i = 0; i < 32; i++) s += a.dur(rr); durCache.set(a.id, s / 32); }
        return durCache.get(a.id);
    };

    const days = opts.days ?? DAYS;                     // Day sampler runs 1 day — the gate default stays DAYS
    const TOTAL = days * DAY_SEC;
    for (let t = 0; t < TOTAL; t++) {
        const h = hourAt(t);
        const dayT = t % DAY_SEC;
        if (dayT === 0) { for (const l of lotto) l.dug = false; }

        // Global draws (piano · digging · hide-and-seek) — independent timers, in active seconds
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
                if (opts.log) opts.log.push({ t, id: l.id, pet: -1 });   // Duo — the two together
            } else {
                const p = pets.find(free);
                if (!p) continue;
                p.mode = 'busy'; p.busyId = l.id; p.until = t + l.dur(r);
                if (l.daily) l.dug = true;
                stat(l.id).starts += 1;
                if (opts.log) opts.log.push({ t, id: l.id, pet: pets.indexOf(p) });
            }
        }
        // Autonomous dive — 25s poll, 30% extension while swimming in the sea (max 2 times)
        if (t >= diveNext) {
            diveNext = t + 25;
            const p = pets.find((q) => q.mode === 'busy' && q.busyId === 'dip' && q.dipKind === 'sea' && q.dipExt < 2);
            if (p && r() < 0.3) { p.until += 15; p.dipExt += 1; }
        }
        // Mealtimes 8·12·18 h (30-min window, once a day)
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
            if (t < p.until) continue;                      // idle wait
            const fired = mode === 'chain' ? rollChain(p, t, h) : rollRegistry(p, t, h);
            if (!fired) p.mode = 'walk', p.until = t + range(r, [2, 8]);   // One wander step
        }
        // Fallen fruit withers in 6h — array cleanup (rarely)
        if (dayT % 600 === 0 && ground.length) for (let i = ground.length - 1; i >= 0; i--) if (t - ground[i].bornAt > 21600) ground.splice(i, 1);
    }

    const rows = Object.entries(stats)
        .map(([id, s]) => {
            const meta = ACTS.find((a) => a.id === id) || LOTTO.find((l) => l.id === id) || { ko: id === 'meal' ? '식사' : id };
            return {
                id, ko: meta.ko,
                perDay: s.starts / days,
                minPerDay: s.busy / days / 60,
                share: s.busy / (days * DAY_SEC * pets.length),
            };
        })
        .sort((a, b) => b.share - a.share);
    return { rows, wanderShare: wanderSec / (days * DAY_SEC * pets.length), bothFree: bothFreeSec / (days * DAY_SEC) };
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
    // Diversity gauge: effective activity count = 1/Σ(leisure share²) — equals the activity count if all are even, converges to 1 under a single dominant one.
    const ls = out.rows.filter((x) => ACTS.some((a) => a.id === x.id) && x.share > 0);
    const tot = ls.reduce((s, x) => s + x.share, 0);
    const effN = 1 / ls.reduce((s, x) => s + (x.share / tot) ** 2, 0);
    const band = ls[0].share > 0.15 ? '  ← 15% 밴드 밖' : '';
    console.log(`다양성: 유효 활동 수 ${effN.toFixed(1)}종 · 1위 시간점유 ${(ls[0].share * 100).toFixed(1)}% (${ls[0].ko})${band}`);
}

// ---- Day sampler (--day YYYY-MM-DD) — one "abstract day" for an absent day. The server diary daemon (server.py)
// calls it as a node subprocess. The date is the seed: the same date yields the same day whenever rolled (retroactive reproducibility —
// filling in a day the app was off later gives the same result "as if rolled that day"). Output = {date, events:[{t(ms), text}]}.
// Line text makes no state claims (no "caught"/"found") — only records that cannot contradict the codex/collections.
if (ARG.day) {
    const dateStr = String(ARG.day);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) { console.error('--day YYYY-MM-DD'); process.exit(2); }
    // xmur3 string hash — avalanche seed (so consecutive dates do not cluster into similar days; the 3 rngT seed commandments)
    const seedOf = (s) => {
        let h = 1779033703 ^ s.length;
        for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        return (h ^= h >>> 16) >>> 0;
    };
    const log = [];
    simulate('registry', { days: 1, seed: seedOf(dateStr), log });
    const PET_KO = ['병아리', '강아지'];
    const LINES = {
        dip:      (p) => `${p}가 물가에서 첨벙첨벙 물놀이를 했다 💦`,
        fish:     (p) => `${p}가 부둣가에 앉아 한가로이 낚싯대를 드리웠다 🎣`,
        sub:      (p) => `${p}가 노랑호 잠수정을 타고 해저를 구경하고 왔다 🤿`,
        balloon:  (p) => `${p}가 열기구를 타고 하늘을 둥실 떠다녔다 🎈`,
        rocket:   (p) => `${p}가 별똥호 로켓을 타고 우주에 다녀왔다 🚀`,
        tramp:    (p) => `${p}가 트램펄린에서 폴짝폴짝 뛰었다 🤸`,
        fruit:    (p) => `${p}가 과일나무 아래를 기웃거리며 과일을 땄다 🍎`,
        tidy:     (p) => `${p}가 떨어진 낙과를 주워 바구니에 정리했다 🧺`,
        ferry:    (p) => `${p}가 통통호 페리를 타고 섬을 한 바퀴 돌았다 ⛴️`,
        swing:    (p) => `${p}가 그네를 타고 바람을 갈랐다`,
        gym:      (p) => `${p}가 스트레칭으로 몸을 쭉쭉 풀었다 🤸`,
        library:  (p) => `${p}가 도서관에서 그림책을 뒤적였다 📖`,
        meadow:   (p) => `${p}가 병아리 동산 벤치에 앉아 꽃바람을 쐬었다 🌸`,
        treat:    (p) => `${p}가 간식 부스 앞을 서성이다 간식을 먹었다 🍡`,
        sand:     (p) => `${p}가 모래섬에서 모래를 쌓으며 놀았다 🏖️`,
        boat:     (p) => `${p}가 나룻배를 타고 천천히 노를 저었다 🚣`,
        radio:    (p) => `${p}가 라디오 앞에서 음악을 들으며 몸을 흔들었다 📻`,
        cook:     (p) => `${p}가 주방에서 뚝딱뚝딱 요리 연습을 했다 🍳`,
        piano:    (p) => `${p}가 피아노를 콩콩 연주했다 🎹`,
        dig:      (p) => `${p}가 보물 모래밭을 신나게 파헤쳐 봤다 ⛏️`,
        hideseek: () => `둘이서 숨바꼭질을 하며 월드를 뛰어다녔다 🙈`,
    };
    // Selection: per (pet, activity), pick one random representative among that day's occurrences — using only the first bunches everything into the morning.
    // Special activities (vehicles · draws) only 1~2 per day ("an occasional outing"), the rest 4~9 lines of everyday activities.
    const r2 = rng(seedOf(dateStr + '#pick'));
    const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(r2() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
    const byKey = new Map();
    for (const e of log) {
        if (!LINES[e.id]) continue;
        const k = e.pet + ':' + e.id;
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k).push(e);
    }
    const uniq = [...byKey.values()].map((arr) => arr[Math.floor(r2() * arr.length)]);
    const RARE = new Set(['rocket', 'sub', 'ferry', 'balloon', 'boat', 'hideseek', 'dig', 'piano']);
    const rare = shuffle(uniq.filter((e) => RARE.has(e.id)));
    const common = shuffle(uniq.filter((e) => !RARE.has(e.id)));
    const picked = [...rare.slice(0, 1 + Math.floor(r2() * 2)), ...common].slice(0, 4 + Math.floor(r2() * 6));
    picked.sort((a, b) => a.t - b.t);
    const base = new Date(dateStr + 'T06:00:00').getTime();   // Sim t=0 ↔ 06:00 that day (sleep 22~06 is outside the sim window)
    const events = picked.map((e) => ({ t: base + e.t * 1000, text: LINES[e.id](PET_KO[e.pet] ?? '둘이서') }));
    console.log(JSON.stringify({ date: dateStr, seed: seedOf(dateStr), events }));
    process.exit(0);
}

if (ARG['fit-rate']) {
    // LEISURE_RATE back-solve: find the rate closest to the chain baseline's total leisure start count
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
