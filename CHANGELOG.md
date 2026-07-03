# Changelog

Personal fork of super-agent-party, customized for Korean-language desktop use.
Patch notes go here — newest on top.

## [Unreleased]

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
