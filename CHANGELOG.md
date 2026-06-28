# Changelog

Personal fork of super-agent-party, customized for Korean-language desktop use.
Patch notes go here — newest on top.

## [Unreleased]

### Added
- **GLB pet motion menu**: a control-panel button (main pet, `fa-person-running`) opens a dropdown
  of on-demand motions to play. The list is data-driven from `GLB_MOTIONS` and `playGlbMotion(id)`
  is the play hook; Walk and Idle are default states and are intentionally excluded.
- **GLB pet sleep motion**: picking "수면 (Sleep)" from the motion menu puts the pet to sleep —
  eyes shut, slow deep breathing, head drooped with a gentle doze-bob, lazy tail, and a floating
  💤 above the head. It's a state, not a one-shot: the pet wakes when clicked or when it starts
  walking.
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
