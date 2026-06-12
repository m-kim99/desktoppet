# Changelog

Personal fork of super-agent-party, customized for Korean-language desktop use.
Patch notes go here — newest on top.

## [Unreleased]

### Added
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

### Security
- CORS `allow_credentials=False` (was wildcard origins + credentials).
- SSRF: `sanitize_proxy_url` / `is_private_ip` now reject private/loopback/link-local/cloud-metadata
  targets (e.g. 169.254.169.254) instead of logging only.
