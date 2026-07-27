const isElectron = window.electronAPI ? true : false;
// Event-listener refactor
if (isElectron) {
    document.addEventListener('contextmenu', (e) => {
      const imgTarget = e.target.closest('img');
      
      if (imgTarget) {
        e.preventDefault();
        window.electronAPI.showContextMenu('image', { 
          src: imgTarget.src,
          x: e.x,
          y: e.y
        });
      } else {
        window.electronAPI.showContextMenu('default');
      }
    });
  
    HOST = "127.0.0.1"
    PORT = window.location.port
    document.addEventListener('click', async (event) => {
      const link = event.target.closest('a[href]');
      if (!link) return;
      const href = link.getAttribute('href');
      
      try {
        const url = new URL(href);
        
        if (url.hostname === HOST && 
            url.port === PORT &&
            url.pathname.startsWith('/uploaded_files/')) {
          event.preventDefault();
          
          // Use the preload interface to handle the path
          const filename = url.pathname.split('/uploaded_files/')[1];
          const filePath = window.electronAPI.pathJoin(
            window.electronAPI.getAppPath(), 
            'uploaded_files', 
            filename
          );
          
          await window.electronAPI.openPath(filePath);
          return;
        }
        if (['http:', 'https:'].includes(url.protocol)) {
          event.preventDefault();
          await window.electronAPI.openExternal(href); // Make sure to call electronAPI
          return;
        }
        
      } catch {
        event.preventDefault();
        window.location.href = href;
      }
    });
  }
  else {
    HOST = window.location.hostname
    PORT = window.location.port
  }
  // Determine the protocol
  const protocol = window.location.protocol;
  const backendURL = `${window.location.protocol}//${window.location.host}`;
let vue_data = {
    isMac: false,
    isWindows: false,
    partyURL:`${window.location.protocol}//${window.location.host}`,
    downloadProgress: 0,
    updateDownloaded: false,
    updateAvailable: false,
    updateInfo: null,
    updateIcon: 'fa-solid fa-download',
    system_prompt: ' ',
    SystemPromptsList: [],          // System-prompt array
    extensionsSystemPromptsDict: {}, // Extension-prompt dictionary
    showPromptDialog: false,        // Dialog visibility
    promptForm: {                   // Dialog binding
      id: null,
      name: '',
      content: ''
    },
    selectSystemPromptId: null,    // The selected system-prompt id
    wakeWindowTimer: null,   // Timer
    withinWakeWindow: false, // Whether within the 'wake-free' 30s window
    isdocker: false,
    isExpanded: true,
    isElectron: isElectron,
    isCollapse: true,
    isBtnCollapse: true,
    activeMenu: 'dashboard',
    activeLiveTab: 'live',
    isMaximized: false,
    hasUpdate: false,
    updateSuccess: false,
    audioCtx: null,          // WebAudio context
    activeSources: [], 
    audioStartTime: 0,       // The time the next frame should start
    omniQueue: [],        // [{idx, text, expressions, voice, pcmBase64}, ...]
    omniIdx: 0,           // The index currently playing
    isOmniPlaying: false, // Whether it's playing
    settings: {
      model: '',
      base_url: '',
      api_key: '',
      temperature: 1,  // Default temperature
      max_tokens: 8192,    // Default max output length
      max_rounds: 0,    // Default max rounds
      selectedProvider: null,
      top_p: 1,
      reasoning_effort: null,
      enableOmniTTS: false,// Whether omniTTS is enabled
      omniVoice: 'Cherry', // The omniTTS voice
      extra_params: [], // Extra parameters
    },
    fastSettings: {
      enabled: false, // Disabled by default
      triggerMode: 'conditional', // Default trigger mode: conditional
      model: '',
      base_url: '',
      api_key: '',
      temperature: 1,  // Default temperature
      max_tokens: 8192,    // Default max output length
      max_rounds: 0,    // Default max rounds
      selectedProvider: null,
      top_p: 1,
      reasoning_effort: null,
      enableOmniTTS: false,// Whether omniTTS is enabled
      omniVoice: 'Cherry', // The omniTTS voice
      extra_params: [], // Extra parameters
      conditionMaxLen: 200,       // Default character limit; only triggers below this count
      conditionNoNewline: true,   // Whether it requires no newlines to trigger
      conditionNoFiles: true,     // Whether it requires no images/files to trigger
    },
    reasonerSettings: {
      enabled: false, // Disabled by default
      model: '',
      base_url: '',
      api_key: '',
      selectedProvider: null,
      temperature: 1,  // Default temperature
      max_tokens: 4096,  // Default max output length
      stop_words: [',', '.', '，', '。'], // Stop-word list
      reasoning_effort: null,
    },
    target_lang: 'zh-CN',
    reasoningEfforts:[
      { value: null, label: 'reason-null' },
      { value: 'minimal', label: 'reason-minimal' },
      { value: 'low', label: 'reason-low' },
      { value: 'medium', label: 'reason-medium' },
      { value: 'high', label: 'reason-high' },
      { value: 'xhigh', label: 'reason-xhigh' },
      { value: 'max', label: 'reason-max' },
      { value: 'none', label: 'reason-none' },
    ],
    visionSettings: {
      enabled: false, // Disabled by default
      model: '',
      base_url: '',
      api_key: '',
      selectedProvider: null,
      temperature: 1,  // Default temperature
      desktopVision: false,
      wakeWord: '看\nsee\nlook\n桌面\ndesktop',
      enableWakeWord: false,
    },
    paramTypes:[
      { value: 'string', label: 'string' },
      { value: 'integer', label: 'integer' },
      { value: 'float', label: 'float' },
      { value: 'boolean', label: 'boolean' },
      { value: 'json', label: 'JSON' } // Merge into one
    ],
    ws: null,
    messages: [],
    cur_audioDatas: [],
    userInput: '',
    isTyping: false,
    currentMessage: '',
    conversationId: null, // Current conversation ID
    conversations: [], // Conversation history
    conversationGroups: [],
    collapsedConversationGroups: {},
    chatHistoryPanelOpen: true,
    chatHistoryPanelWidth: 320,
    draftConversationGroupId: 'default',
    activeConversationGroupId: 'default',
    showConversationGroupDialog: false,
    conversationGroupDialogMode: 'create',
    conversationGroupForm: {
      id: null,
      name: '',
      memoryEnabled: false,
    },
    showConversationRenameDialog: false,
    conversationRenameForm: {
      id: null,
      name: '',
    },
    showDeleteConversationDialog: false,
    deleteConversationForm: {
      id: null,
      title: '',
      deleteMemory: false,
    },
    showDeleteGroupDialog: false,
    deleteGroupForm: {
      id: null,
      name: '',
      conversationCount: 0,
    },
    showHistoryDialog: false,
    showLLMToolsDialog: false,
    showHttpToolDialog: false,
    showComfyUIDialog: false,
    showStickerPacksDialog: false,
    showGsvRefAudioPathDialog: false,
    showModelDialog: false,
    showLogoDialog: false,
    deletingConversationId: null, // The conversation ID being deleted
    jsonFile: null,
    models: [],
    modelsLoading: false,
    modelsError: null,
    isThinkOpen: false,
    showEditDialog: false,
    editContent: '',
    editType: 'system', // Or 'message'
    editIndex: null,
    asyncToolsID : [],
    TTSrunning:false,
    ASRrunning:false,
    isInputting: false,
    toolsSettings: {
      asyncTools: {
        enabled: false,
      },
      a2ui: {
        enabled: false,
      },
      time: {
        enabled: false,
        triggerMode: 'beforeThinking',
      },
      weather: {
        enabled: false
      },
      wikipedia: {
        enabled: false,
      },
      arxiv: {
        enabled: false,
      },
      hideToolResults: {
        enabled: false,
      },
      getFile: {
        enabled: false,
      },
      language: {
        enabled: false, // Disabled by default
        language: 'zh-CN',
        tone: 'normal',
      },
      inference: {
        enabled: false, // Disabled by default
      },
      deepsearch: {
        enabled: false, // Disabled by default
      },
      formula: {
        enabled: true
      },
      autoBehavior: {
        enabled: false
      },
      randomTopic: {
        enabled: false,
        baseURL:'https://topics-after-party.zeabur.app'
      },
    },
    toolForShowInfo: {"name": "", "description": ""},
    showToolInfoDialog: false,
    mcpServers: {},
    showAddMCPDialog: false,
    showMCPConfirm: false,
    deletingMCPName: null,
    newMCPJson: '',
    newMCPFormData: {
      name: 'mcp',
      command: '',
      args:'',
      env: '',
      url: '',
      apiKey: '',
    },
    newMCPType: 'stdio', // New type field
    mcpInputType: 'form', // Defaults to JSON; can also be 'form'
    currentMCPExample: '',
    mcpURLDict: {
      stdio: 'http://127.0.0.1:8000/mcp',
      sse: 'http://127.0.0.1:8000/sse',
      ws: 'ws://127.0.0.1:8000/ws',
      streamablehttp: 'http://127.0.0.1:8000/mcp'
    },
    mcpExamples: {
      stdio: `{
  "mcpServers": {
    "echo-server": {
      "command": "node",
      "args": [
        "path/to/echo-mcp/build/index.js"
      ],
      "disabled": false
    }
  }
}`,
      sse: `{
  "mcpServers": {
    "sse-server": {
      "url": "http://127.0.0.1:8000/sse",
      "headers": {
        "Content-Type": "text/event-stream",
        "Authorization": "Bearer YOUR_API_KEY"
      },
      "disabled": false
    }
  }
}`,
      ws: `{
  "mcpServers": {
    "websocket-server": {
      "url": "ws://127.0.0.1:8000/ws",
      "disabled": false
    }
  }
}`,
    streamablehttp: `{
  "mcpServers": {
    "streamablehttp-server": {
      "url": "http://127.0.0.1:8000/mcp",
      "headers": {
        "Content-Type": "application/json",
        "Authorization": "Bearer YOUR_API_KEY"
      },
      "disabled": false
    }
  }
}`
    },
    activeKbTab: 'settings', // The default active tab
    activeReadTab: 'full', // The default active tab
    webSearchSettings: {
      enabled: false,
      engine: 'tavily',
      crawler: 'mdnew',
      when: 'after_thinking',
      duckduckgo_max_results: 10, // Default value
      searxng_url: `http://127.0.0.1:8080`,
      searxng_engines: "baidu,bing,sogou,360search,quark",
      searxng_is_select:false,
      searxng_max_results: 10, // Default value
      tavily_max_results: 10, // Default value
      tavily_api_key: '',
      jina_api_key: '',
      Crawl4Ai_url: 'http://127.0.0.1:11235',
      Crawl4Ai_api_key: 'test_api_code',
      bing_max_results: 10, // Default value
      bing_api_key: '',
      bing_search_url: 'https://api.bing.microsoft.com/v7.0/search',
      google_max_results: 10, // Default value
      google_api_key: '',
      google_cse_id: '',
      brave_max_results: 10, // Default value
      brave_api_key: '',
      exa_max_results:10,
      exa_api_key: '',
      serper_max_results:10,
      serper_api_key: '',
      bochaai_max_results:10,
      bochaai_api_key: '',
      firecrawl_url: 'https://api.firecrawl.dev/v2', // Official API or self-hosted address
      firecrawl_api_key: '',
      firecrawl_mode: 'scrape', 
    },
    codeSettings: {
      enabled: false,
      engine: 'e2b',
      e2b_api_key: '',
      sandbox_url: 'http://127.0.0.1:8080',
    },
    CLISettings: {
      enabled: false,
      visibilityScope: 'workspace',
      engine: 'local',
      cc_path: '',
      shortcut: true,
      max_iterations: 100,
      mode_change: false
    },
    visionControlSettings:{
      enabled: false,
      mouse:true,
      keyboard:true,
      desktopVision: true,
      onlyNewScreen: true,
      isEnableGrid: true, // Whether the grid is enabled
      isFullScreen: true, // Whether full-screen
      ScreenSize : [0,0,1280,720], // When not full-screen, capture x1 y1 x2 y2
    },
    ccSettings: {
      enabled: false,
      selectedProvider: null,
      base_url:'',
      api_key:'',
      model:'',
      permissionMode: 'default',
    },
    qcSettings: {
      enabled: false,
      selectedProvider: null,
      base_url:'',
      api_key:'',
      model:'',
      permissionMode: 'default',
    },
    dsSettings: {
      enabled: false,
      permissionMode: 'default',
    },
    localEnvSettings: {
      enabled: false,
      permissionMode: 'default',
    },
    ocSettings: {
      enabled: false,
      selectedProvider: null,
      base_url:'',
      api_key:'',
      model:'',
      permissionMode: 'default',
    },
    HASettings: {
      enabled: false,
      api_key: '',
      url: 'http://127.0.0.1:8123',
    },
    chromeMCPSettings: {
      enabled: false,
      mcpName: 'browser-mcp', // browser-mcp or playwright-mcp
      type:"external", // external or internal
      CDPport:9222,
      browserVision: false,
      onlyNewScreen: true,
    },
    sqlSettings:{
      enabled: false,
      engine: "sqlite",
      user: "",
      password: "",
      host:"",
      port:5432,
      dbname: "",
      dbpath: "",
    },
    knowledgeBases: [],
    KBSettings: {
      when: 'after_thinking',
      is_rerank: false,
      selectedProvider: null,
      model: '',
      base_url: '',
      api_key: '',
      top_n: 5,
    },
    showAddKbDialog: false,
    showKnowledgeDialog: false,
    showMCPServerDialog: false,
    a2aServers: {},
    showA2AServerDialog: false,
    showAddA2ADialog: false,
    newA2AUrl: '',
    activeCollapse: [],
    newKb: {
      name: '',
      introduction: '',
      providerId: null,
      model: '',
      base_url: '',
      api_key: '',
      chunk_size: 2048,
      chunk_overlap: 512,
      chunk_k: 5,
      weight: 0.5,
      processingStatus: 'processing',
    },
    newKbFiles: [],
    systemSettings: {
      language: 'ko-KR',
      theme: 'light',
      fontScale: 1, // Global UI scale, 1 = 100%, range 0.85 ~ 1.5
      codeFontScale: 1, // Independent code-block scale, 1 = 100%, range 0.83 ~ 1.67
      autoCollapseInput: false, // Whether the chat input auto-collapses to 1 line when unfocused, with pills tucked to the left of the send button
      network:"local",
      proxy: 'http://127.0.0.1:7890',
      proxyMode: 'system', //system or manual or none
      isChinaProxy: false,
      chatMode:'standard', // Default chat-UI mode
    },
    networkOptions:[
      { value: 'local', label: 'local' }, 
      { value: 'global', label: 'allDevicesVisible' },
    ],
    imgHostOptions:[
      { value: 'easyImage2', label: 'easyImage2' }
    ],
    showRestartDialog: false,
    showCDPRestartDialog: false,
    agents: {},
    showAgentForm: false,
    editingAgent: null,
    showAgentDialog: false,
    mainAgent: 'super-model',
    newAgent: {
      id: '',
      name: '',
      system_prompt: ''
    },
    editingAgent: false,
    currentLanguage: 'ko-KR',
    translations: translations,
    themeValues: ['light', 'dark','midnight','desert','neon','marshmallow','ink','party',"rainbow"],
    isBrowserOpening: false,
    expandedSections: {
      settingsBase: true,
      reasonerConfig: true,
      language: true,
      superapi: true,
      webSearchConfig: true,
      duckduckgoConfig: true,
      searxngConfig: true,
      tavilyConfig: true,
      jinaConfig: true,
      Crawl4AiConfig: true,
      settingsAdvanced: true,
      reasonerAdvanced: true,
      knowledgeAdvanced: false,
    },
    abortController: null, // Controller used to abort requests
    isSending: false, // Whether sending is in progress
    showAddDialog: false,
    modelProviders: [],
    // Update-related
    updateAvailable: false,
    updateInfo: null,
    updateDownloaded: false,
    downloadProgress: 0,
    fileLinks: [],
    audioContext: null,
    mediaStream: null,
    mediaRecorder: null,
    audioChunks: [],
    isRecording: false,
    vad: null,
    speechTimeout: null,
    currentAudioChunks: [],
    currentTranscriptionId: null,
    speechStartTime: null,
    recognition: null,
    sherpaModelExists: false,             // Whether the model already exists
    sherpaDownloading: false,             // Whether a download is in progress
    sherpaPercent: 0,                     // Live progress 0-100
    sherpaEventSource: null,               // Current SSE instance
    sherpaModelName: '',                 // Model name
    minilmModelExists: false,       // Whether the model already exists
    minilmDownloading: false,       // Whether a download is in progress
    minilmPercent: 0,               // Live progress 0-100
    minilmEventSource: null,        // Current SSE instance
    mossModelExists: false,
    mossDownloading: false,
    mossDownloadSource: '',
    mossPollInterval: null,
    mossPercent: 0, // New: real progress-bar percentage

    asrSettings: {
      enabled: false,
      engine: 'sherpa',
      selectedProvider: null,
      webSpeechLanguage: 'auto',
      vendor: "OpenAI",
      model: "",
      base_url: "",
      api_key: "",
      funasr_ws_url: "ws://127.0.0.1:10095",
      funasr_mode: "offline",
      interactionMethod: "auto",
      hotkey : "Alt",
      wakeWord: "小派",
      endWord: "结束对话",
      hotwords: "小派 80\nagent party 60\n结束对话 80",
    },
    supportedLanguages: [
      { code: 'zh-CN', name: '中文' },
      { code: 'en-US', name: 'English' },
      { code: 'ja-JP', name: '日本語' },
      { code: 'ko-KR', name: '한국어' },
      { code: 'es-ES', name: 'Español' },
      { code: 'fr-FR', name: 'Français' },
      { code: 'de-DE', name: 'Deutsch' },
      { code: 'ru-RU', name: 'Русский' },
    ],
    userInputBuffer: '',
    sidePanelOpen: false,
    sidePanelHTML: '',
    chatAreaOpen: true,        // Whether the chat area is expanded
    chatAreaWidth: 50,         // Chat-area width percentage
    sidePanelWidth: 50,        // Sidebar width percentage
    isResizing: false,         // Whether resizing is in progress
    isHistoryPanelResizing: false,
    minPanelWidth: 25,         // Minimum panel-width percentage
    extensions: [],              // All discovered extensions
    currentExtension: null,      // The currently loaded extension
    sidePanelURL: '',            // The extension URL shown in the sidebar
    showExtensionsDialog: false, // Controls the extension-selection dialog's visibility
    showExtensionForm: false, // Controls the extension form's visibility
    newExtensionUrl: '',   // Bound to the input box
    remotePlugins: [], // Remote plugin list
    installedPlugins: [], // Locally installed
    installLoading: false,
    refreshing: false,
    refreshButtonText: "",
    showHistorySidebar: false,
    ttsSettings: {
      enabled: false,
      engine: 'edgetts',
      separators:["。", "\n", "？", "！", "，","～","!","?",",","~"],
      maxConcurrency: 2,
      enabledInterruption: false,
      bufferWordList: [],
      SampleText: 'super agent party가 모든 것을 연결합니다!',
      edgettsLanguage: 'zh-CN',
      edgettsGender: 'Female',
      edgettsVoice: 'XiaoyiNeural',
      edgettsRate: 1.0,
      gsvServer: "http://127.0.0.1:9880",
      gsvTextLang: 'zh',
      gsvRate: 1.0,
      gsvPromptLang: 'zh',
      gsvPromptText: '',
      gsvSample_steps: 4,
      gsvRefAudioPath: '',
      gsvAudioOptions: [],
      selectedProvider: null,
      vendor: "OpenAI",
      model: "",
      base_url: "",
      api_key: "",
      openaiVoice:"alloy",
      openaiStream: false,
      openaiSpeed: 1.0,
      customTTSserver: "http://127.0.0.1:9880",
      customTTSspeaker: "",
      customTTSspeed: 1.0,
      customStream: false,
      customTTSKeyText: 'text',
      customTTSKeySpeaker: 'speaker',
      customTTSKeySpeed: 'speed',
      systemVoiceName: null,
      systemRate: 200,
      // Tetos generic-voice list cache (refreshed when switching engines)
      tetosVoices: [],
      isFetchingVoices: false,

      // Azure
      azureSpeechKey: '',
      azureRegion: '',
      azureVoice: '',

      // Volcengine
      volcAppId: '',
      volcAccessKey: '',
      volcResourceId: 'seed-tts-2.0', // Default public-resource ID
      volcVoice: 'zh_female_vv_uranus_bigtts', // Default LLM voice
      volcRate: 1.0,

      // Baidu
      baiduApiKey: '',
      baiduSecretKey: '',
      baiduVoice: '',

      // Minimax
      minimaxApiKey: '',
      minimaxGroupId: '',
      minimaxVoice: '',

      // Xunfei
      xunfeiAppId: '',
      xunfeiApiKey: '',
      xunfeiApiSecret: '',
      xunfeiVoice: '',

      // Fish Audio
      fishApiKey: '',
      fishVoice: '',

      // Google
      googleServiceAccount: '', // JSON string
      googleVoice: '',
      newtts:{},


      // elevenLabs
      elevenLabsApiKey: '',
      elevenLabsVoice: 'JBFqnCBsd6RMkjVDRZzb',
      elevenLabsModel: 'eleven_multilingual_v2',
      elevenLabsRate: 1.0,


      // moss
      mossVoice: 'Junhao',
      mossSpeed: 1.0,
    },
    volcResourceOptions: [
        { value: 'volc_tts_release', label: '구버전/표준 (Standard)' },
        // Doubao 1.0
        { value: 'seed-tts-1.0', label: 'Doubao 모델 1.0 (문자 버전)' },
        { value: 'volc.service_type.10029', label: 'Doubao 1.0 (문자 버전-ServiceType)' },
        { value: 'seed-tts-1.0-concurr', label: 'Doubao 모델 1.0 (동시 버전)' },
        { value: 'volc.service_type.10048', label: 'Doubao 1.0 (동시 버전-ServiceType)' },
        // Doubao 2.0
        { value: 'seed-tts-2.0', label: 'Doubao 모델 2.0 (문자 버전)' },
        // Voice cloning
        { value: 'seed-icl-1.0', label: '음성 복제 1.0 (문자 버전)' },
        { value: 'seed-icl-1.0-concurr', label: '음성 복제 1.0 (동시 버전)' },
        { value: 'seed-icl-2.0', label: '음성 복제 2.0 (문자 버전)' }
    ],
    activeTTSTab: 'default', // Controls TTS tab switching
    showAddTTSDialog: false, // Controls the add-TTS dialog's visibility
    newTTSConfig: {
      name: '',
      enabled: false,
      SampleText: 'super agent party가 모든 것을 연결합니다!',
      engine: 'edgetts',
      edgettsLanguage: 'zh-CN',
      edgettsGender: 'Female',
      edgettsVoice: 'XiaoyiNeural',
      edgettsRate: 1.0,
      gsvServer: "http://127.0.0.1:9880",
      gsvTextLang: 'zh',
      gsvRate: 1.0,
      gsvSample_steps: 4,
      gsvPromptLang: 'zh',
      gsvPromptText: '',
      gsvRefAudioPath: '',
      gsvAudioOptions: [],
      selectedProvider: null,
      vendor: "OpenAI",
      model: "",
      base_url: "",
      api_key: "",
      openaiVoice:"alloy",
      openaiSpeed: 1.0,
      customTTSserver: "http://127.0.0.1:9880",
      customTTSspeaker: "",
      customTTSspeed: 1.0,
      systemVoiceName: null,
      systemRate: 200,
      // Tetos generic-voice list cache (refreshed when switching engines)
      tetosVoices: [],
      isFetchingVoices: false,

      // Azure
      azureSpeechKey: '',
      azureRegion: '',
      azureVoice: '',

      // Volcengine
      volcAppId: '',
      volcAccessKey: '',
      volcResourceId: 'seed-tts-2.0', // Default public-resource ID
      volcVoice: 'zh_female_vv_uranus_bigtts', // Default LLM voice
      volcRate: 1.0,

      // Baidu
      baiduApiKey: '',
      baiduSecretKey: '',
      baiduVoice: '',

      // Minimax
      minimaxApiKey: '',
      minimaxGroupId: '',
      minimaxVoice: '',

      // Xunfei
      xunfeiAppId: '',
      xunfeiApiKey: '',
      xunfeiApiSecret: '',
      xunfeiVoice: '',

      // Fish Audio
      fishApiKey: '',
      fishVoice: '',

      // Google
      googleServiceAccount: '', // JSON string
      googleVoice: '',

      mossVoice: 'Junhao',
      mossSpeed: 1.0,

      newtts:{}
    },
    cur_voice :'default',
    openaiVoices:['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'],
    showMoreButtonDialog: false,
    isAssistantMode: false,
    isCapsuleMode: false,
    isFixedWindow: false,
    MoreButtonDict: [
      {"name": "brieflyButton", "enabled": true},
      {"name": "forceScrollButton", "enabled": true},
      {"name": "expandButton", "enabled": true},
      {"name": "fileButton", "enabled": true},
      {"name": "fastResponseButton", "enabled": true},
      {"name": "reasonerButton", "enabled": true},
      {"name": "deepSearchButton", "enabled": false},
      {"name": "visionButton", "enabled": false},
      {"name": "screenshotButton", "enabled": true},
      {"name": "desktopVisionButton", "enabled": false},
      {"name": "text2imgButton", "enabled": false},
      {"name": "asrButton", "enabled": true},
      {"name": "ttsButton", "enabled": true},
      {"name": "knowledgeBaseButton", "enabled": true},
      {"name": "webSearchButton", "enabled": true},
      {"name": "memoryButton", "enabled": true},
      {"name": "uiButton", "enabled": true},
      {"name": "codeButton", "enabled": false},
      {"name": "CLIButton", "enabled": false},
      {"name": "visionControl", "enabled": false},
      {"name": "stickerButton", "enabled": false},
      {"name": "haButton", "enabled": false},
      {"name": "chromeButton", "enabled": false},
      {"name": "sqlButton", "enabled": false},
      {"name": "agentButton", "enabled": false},
      {"name": "llmButton", "enabled": false},
      {"name": "mcpButton", "enabled": true},
      {"name": "a2aButton", "enabled": false},
      {"name": "httpButton", "enabled": false},
      {"name": "comfyuiButton", "enabled": false},
      {"name": "vrmButton", "enabled": true},
      {"name": "behaviorBotton", "enabled": false},
      {"name": "groupChatBotton", "enabled": true},
    ],
    largeMoreButtonDict:[
      {"name": "brieflyButton", "enabled": true},
      {"name": "forceScrollButton", "enabled": true},
      {"name": "expandButton", "enabled": true},
      {"name": "fileButton", "enabled": true},
      {"name": "fastResponseButton", "enabled": true},
      {"name": "reasonerButton", "enabled": true},
      {"name": "deepSearchButton", "enabled": false},
      {"name": "visionButton", "enabled": false},
      {"name": "desktopVisionButton", "enabled": false},
      {"name": "screenshotButton", "enabled": true},
      {"name": "text2imgButton", "enabled": false},
      {"name": "asrButton", "enabled": true},
      {"name": "ttsButton", "enabled": true},
      {"name": "knowledgeBaseButton", "enabled": true},
      {"name": "webSearchButton", "enabled": true},
      {"name": "memoryButton", "enabled": true},
      {"name": "uiButton", "enabled": true},
      {"name": "codeButton", "enabled": false},
      {"name": "CLIButton", "enabled": false},
      {"name": "visionControl", "enabled": false},
      {"name": "stickerButton", "enabled": false},
      {"name": "haButton", "enabled": false},
      {"name": "chromeButton", "enabled": false},
      {"name": "sqlButton", "enabled": false},
      {"name": "agentButton", "enabled": false},
      {"name": "llmButton", "enabled": false},
      {"name": "mcpButton", "enabled": true},
      {"name": "a2aButton", "enabled": false},
      {"name": "httpButton", "enabled": false},
      {"name": "comfyuiButton", "enabled": false},
      {"name": "vrmButton", "enabled": true},
      {"name": "behaviorBotton", "enabled": false},
      {"name": "groupChatBotton", "enabled": true},
    ],
    smallMoreButtonDict:[
      {"name": "brieflyButton", "enabled": false},
      {"name": "forceScrollButton", "enabled": false},
      {"name": "expandButton", "enabled": false},
      {"name": "fileButton", "enabled": false},
      {"name": "fastResponseButton", "enabled": false},
      {"name": "reasonerButton", "enabled": false},
      {"name": "deepSearchButton", "enabled": false},
      {"name": "visionButton", "enabled": false},
      {"name": "desktopVisionButton", "enabled": true},
      {"name": "screenshotButton", "enabled": true},
      {"name": "text2imgButton", "enabled": false},
      {"name": "asrButton", "enabled": false},
      {"name": "ttsButton", "enabled": false},
      {"name": "knowledgeBaseButton", "enabled": false},
      {"name": "webSearchButton", "enabled": false},
      {"name": "memoryButton", "enabled": false},
      {"name": "uiButton", "enabled": false},
      {"name": "codeButton", "enabled": false},
      {"name": "CLIButton", "enabled": false},
      {"name": "visionControl", "enabled": false},
      {"name": "stickerButton", "enabled": false},
      {"name": "haButton", "enabled": false},
      {"name": "chromeButton", "enabled": false},
      {"name": "sqlButton", "enabled": false},
      {"name": "agentButton", "enabled": false},
      {"name": "llmButton", "enabled": false},
      {"name": "mcpButton", "enabled": false},
      {"name": "a2aButton", "enabled": false},
      {"name": "httpButton", "enabled": false},
      {"name": "comfyuiButton", "enabled": false},
      {"name": "vrmButton", "enabled": true},
      {"name": "behaviorBotton", "enabled": false},
      {"name": "groupChatBotton", "enabled": false},
    ],
    showVrmModelDialog: false,
    vrmOnline: false,   // New
    vrmPollTimer: null, // New
    newVrmModel: {
      name: '',
      displayName: '',
      file: null
    },
    showGaussSceneDialog: false, // GAUSS
    newGaussScene: { name: '', displayName: '' }, // GAUSS
    VRMConfig: {
      name: 'default',
      enabledExpressions: false,
      enabledMotions: false,
      selectedModelId: 'chick', // 기본 펫: 병아리 (앨리스·밥 제거됨)
      windowWidth: 540,
      windowHeight: 960,
      defaultModels: [], // Store the default models
      userModels: [],     // Store user-uploaded models
      defaultMotions: [], // Store the default motions
      userMotions: [],     // Store user-uploaded motions
      selectedMotionIds: [],
      selectedNewModelId: 'chick',
      selectedNewMotionIds: [],
      newVRM:{},
      gaussDefaultScenes: [],   // GAUSS
      gaussUserScenes: [],      // GAUSS
      selectedGaussSceneId: '',
      textInputHotkey: 'F13',   // Global toggle shortcut for the desktop-pet text-input box
      showPetHotkey: 'F14',     // Global shortcut to summon the desktop pet
      hidePetHotkey: 'F15',     // Global shortcut to hide the desktop pet
      idleTalkEnabled: false,   // Spontaneous preset remarks in the speech bubble
      idleTalkLines: '',        // One remark per line; a random one is shown when idle
      idleTalkInterval: 60,     // Base idle interval in seconds (jittered at runtime)
      wanderEnabled: false,     // Pet window spontaneously drifts to a nearby spot when idle
      wanderInterval: 90,       // Base wander interval in seconds (jittered at runtime)
      wanderRange: 250,         // Max wander distance in pixels per move
    },
    // 🌏 월드 펫 페르소나/시스템 지시.
    // worldConfig = 실제 저장되는 "오버라이드"만 (빈 문자열 = 서버 기본값 사용).
    // worldEdit   = 편집 박스에 보이는 값(오버라이드 or 기본값 프리필). 저장 시 기본값과 같으면
    //               worldConfig에 ''로 넣어(오버라이드 없음) 서버 상수 변경을 계속 따라가게 한다.
    worldConfig: {
      chickPersona: '', puppyPersona: '', lore: '', replyRules: '', actionSpec: '', mailPersona: '',
    },
    worldEdit: {
      chickPersona: '', puppyPersona: '', lore: '', replyRules: '', actionSpec: '', mailPersona: '',
    },
    worldPersonaDefaults: {},   // 서버 순수 기본값 (정규화 비교용)
    newAppearanceConfig: {
      name: '',
      windowWidth: 540,
      windowHeight: 960,
      selectedModelId: 'chick', // 기본 펫: 병아리 (앨리스·밥 제거됨)
      selectedMotionIds: [],
    },
    showAddAppearanceDialog: false,
    showVrmaMotionDialog: false,
    showFileDialog: false,
    newVrmaMotion: {
      name: '',
      displayName: '',
      file: null
    },
    expressionMap : [
      '<happy>', 
      '<angry>', 
      '<sad>',
      '<neutral>',
      '<surprised>', 
      '<relaxed>'],
    newGsvAudio: {
      name: '',
      path: '',
      text: '',
    },
    startTime: null,
    elapsedTime: 0,
    gsvTextLangs:["zh", "en" , "yue","ja","ko","auto","auto_yue"],
    audioPlayQueue: [],
    currentAudio: null,
    edgettsLanguage: 'zh-CN',
    edgettsGender: 'Female',
    edgettsvoices: [
    { language: "af-ZA", gender: "Female", name: "AdriNeural" },
    { language: "af-ZA", gender: "Male", name: "WillemNeural" },
    { language: "am-ET", gender: "Male", name: "AmehaNeural" },
    { language: "am-ET", gender: "Female", name: "MekdesNeural" },
    { language: "ar-AE", gender: "Female", name: "FatimaNeural" },
    { language: "ar-AE", gender: "Male", name: "HamdanNeural" },
    { language: "ar-BH", gender: "Male", name: "AliNeural" },
    { language: "ar-BH", gender: "Female", name: "LailaNeural" },
    { language: "ar-DZ", gender: "Female", name: "AminaNeural" },
    { language: "ar-DZ", gender: "Male", name: "IsmaelNeural" },
    { language: "ar-EG", gender: "Female", name: "SalmaNeural" },
    { language: "ar-EG", gender: "Male", name: "ShakirNeural" },
    { language: "ar-IQ", gender: "Male", name: "BasselNeural" },
    { language: "ar-IQ", gender: "Female", name: "RanaNeural" },
    { language: "ar-JO", gender: "Female", name: "SanaNeural" },
    { language: "ar-JO", gender: "Male", name: "TaimNeural" },
    { language: "ar-KW", gender: "Male", name: "FahedNeural" },
    { language: "ar-KW", gender: "Female", name: "NouraNeural" },
    { language: "ar-LB", gender: "Female", name: "LaylaNeural" },
    { language: "ar-LB", gender: "Male", name: "RamiNeural" },
    { language: "ar-LY", gender: "Female", name: "ImanNeural" },
    { language: "ar-LY", gender: "Male", name: "OmarNeural" },
    { language: "ar-MA", gender: "Male", name: "JamalNeural" },
    { language: "ar-MA", gender: "Female", name: "MounaNeural" },
    { language: "ar-OM", gender: "Male", name: "AbdullahNeural" },
    { language: "ar-OM", gender: "Female", name: "AyshaNeural" },
    { language: "ar-QA", gender: "Female", name: "AmalNeural" },
    { language: "ar-QA", gender: "Male", name: "MoazNeural" },
    { language: "ar-SA", gender: "Male", name: "HamedNeural" },
    { language: "ar-SA", gender: "Female", name: "ZariyahNeural" },
    { language: "ar-SY", gender: "Female", name: "AmanyNeural" },
    { language: "ar-SY", gender: "Male", name: "LaithNeural" },
    { language: "ar-TN", gender: "Male", name: "HediNeural" },
    { language: "ar-TN", gender: "Female", name: "ReemNeural" },
    { language: "ar-YE", gender: "Female", name: "MaryamNeural" },
    { language: "ar-YE", gender: "Male", name: "SalehNeural" },
    { language: "az-AZ", gender: "Male", name: "BabekNeural" },
    { language: "az-AZ", gender: "Female", name: "BanuNeural" },
    { language: "bg-BG", gender: "Male", name: "BorislavNeural" },
    { language: "bg-BG", gender: "Female", name: "KalinaNeural" },
    { language: "bn-BD", gender: "Female", name: "NabanitaNeural" },
    { language: "bn-BD", gender: "Male", name: "PradeepNeural" },
    { language: "bn-IN", gender: "Male", name: "BashkarNeural" },
    { language: "bn-IN", gender: "Female", name: "TanishaaNeural" },
    { language: "bs-BA", gender: "Male", name: "GoranNeural" },
    { language: "bs-BA", gender: "Female", name: "VesnaNeural" },
    { language: "ca-ES", gender: "Male", name: "EnricNeural" },
    { language: "ca-ES", gender: "Female", name: "JoanaNeural" },
    { language: "cs-CZ", gender: "Male", name: "AntoninNeural" },
    { language: "cs-CZ", gender: "Female", name: "VlastaNeural" },
    { language: "cy-GB", gender: "Male", name: "AledNeural" },
    { language: "cy-GB", gender: "Female", name: "NiaNeural" },
    { language: "da-DK", gender: "Female", name: "ChristelNeural" },
    { language: "da-DK", gender: "Male", name: "JeppeNeural" },
    { language: "de-AT", gender: "Female", name: "IngridNeural" },
    { language: "de-AT", gender: "Male", name: "JonasNeural" },
    { language: "de-CH", gender: "Male", name: "JanNeural" },
    { language: "de-CH", gender: "Female", name: "LeniNeural" },
    { language: "de-DE", gender: "Female", name: "AmalaNeural" },
    { language: "de-DE", gender: "Male", name: "ConradNeural" },
    { language: "de-DE", gender: "Male", name: "FlorianMultilingualNeural" },
    { language: "de-DE", gender: "Female", name: "KatjaNeural" },
    { language: "de-DE", gender: "Male", name: "KillianNeural" },
    { language: "de-DE", gender: "Female", name: "SeraphinaMultilingualNeural" },
    { language: "el-GR", gender: "Female", name: "AthinaNeural" },
    { language: "el-GR", gender: "Male", name: "NestorasNeural" },
    { language: "en-AU", gender: "Female", name: "NatashaNeural" },
    { language: "en-AU", gender: "Male", name: "WilliamNeural" },
    { language: "en-CA", gender: "Female", name: "ClaraNeural" },
    { language: "en-CA", gender: "Male", name: "LiamNeural" },
    { language: "en-GB", gender: "Female", name: "LibbyNeural" },
    { language: "en-GB", gender: "Female", name: "MaisieNeural" },
    { language: "en-GB", gender: "Male", name: "RyanNeural" },
    { language: "en-GB", gender: "Female", name: "SoniaNeural" },
    { language: "en-GB", gender: "Male", name: "ThomasNeural" },
    { language: "en-HK", gender: "Male", name: "SamNeural" },
    { language: "en-HK", gender: "Female", name: "YanNeural" },
    { language: "en-IE", gender: "Male", name: "ConnorNeural" },
    { language: "en-IE", gender: "Female", name: "EmilyNeural" },
    { language: "en-IN", gender: "Female", name: "NeerjaExpressiveNeural" },
    { language: "en-IN", gender: "Female", name: "NeerjaNeural" },
    { language: "en-IN", gender: "Male", name: "PrabhatNeural" },
    { language: "en-KE", gender: "Female", name: "AsiliaNeural" },
    { language: "en-KE", gender: "Male", name: "ChilembaNeural" },
    { language: "en-NG", gender: "Male", name: "AbeoNeural" },
    { language: "en-NG", gender: "Female", name: "EzinneNeural" },
    { language: "en-NZ", gender: "Male", name: "MitchellNeural" },
    { language: "en-NZ", gender: "Female", name: "MollyNeural" },
    { language: "en-PH", gender: "Male", name: "JamesNeural" },
    { language: "en-PH", gender: "Female", name: "RosaNeural" },
    { language: "en-SG", gender: "Female", name: "LunaNeural" },
    { language: "en-SG", gender: "Male", name: "WayneNeural" },
    { language: "en-TZ", gender: "Male", name: "ElimuNeural" },
    { language: "en-TZ", gender: "Female", name: "ImaniNeural" },
    { language: "en-US", gender: "Female", name: "AnaNeural" },
    { language: "en-US", gender: "Male", name: "AndrewMultilingualNeural" },
    { language: "en-US", gender: "Male", name: "AndrewNeural" },
    { language: "en-US", gender: "Female", name: "AriaNeural" },
    { language: "en-US", gender: "Female", name: "AvaMultilingualNeural" },
    { language: "en-US", gender: "Female", name: "AvaNeural" },
    { language: "en-US", gender: "Male", name: "BrianMultilingualNeural" },
    { language: "en-US", gender: "Male", name: "BrianNeural" },
    { language: "en-US", gender: "Male", name: "ChristopherNeural" },
    { language: "en-US", gender: "Female", name: "EmmaMultilingualNeural" },
    { language: "en-US", gender: "Female", name: "EmmaNeural" },
    { language: "en-US", gender: "Male", name: "EricNeural" },
    { language: "en-US", gender: "Male", name: "GuyNeural" },
    { language: "en-US", gender: "Female", name: "JennyNeural" },
    { language: "en-US", gender: "Female", name: "MichelleNeural" },
    { language: "en-US", gender: "Male", name: "RogerNeural" },
    { language: "en-US", gender: "Male", name: "SteffanNeural" },
    { language: "en-ZA", gender: "Female", name: "LeahNeural" },
    { language: "en-ZA", gender: "Male", name: "LukeNeural" },
    { language: "es-AR", gender: "Female", name: "ElenaNeural" },
    { language: "es-AR", gender: "Male", name: "TomasNeural" },
    { language: "es-BO", gender: "Male", name: "MarceloNeural" },
    { language: "es-BO", gender: "Female", name: "SofiaNeural" },
    { language: "es-CL", gender: "Female", name: "CatalinaNeural" },
    { language: "es-CL", gender: "Male", name: "LorenzoNeural" },
    { language: "es-CO", gender: "Male", name: "GonzaloNeural" },
    { language: "es-CO", gender: "Female", name: "SalomeNeural" },
    { language: "es-CR", gender: "Male", name: "JuanNeural" },
    { language: "es-CR", gender: "Female", name: "MariaNeural" },
    { language: "es-CU", gender: "Female", name: "BelkysNeural" },
    { language: "es-CU", gender: "Male", name: "ManuelNeural" },
    { language: "es-DO", gender: "Male", name: "EmilioNeural" },
    { language: "es-DO", gender: "Female", name: "RamonaNeural" },
    { language: "es-EC", gender: "Female", name: "AndreaNeural" },
    { language: "es-EC", gender: "Male", name: "LuisNeural" },
    { language: "es-ES", gender: "Male", name: "AlvaroNeural" },
    { language: "es-ES", gender: "Female", name: "ElviraNeural" },
    { language: "es-ES", gender: "Female", name: "XimenaNeural" },
    { language: "es-GQ", gender: "Male", name: "JavierNeural" },
    { language: "es-GQ", gender: "Female", name: "TeresaNeural" },
    { language: "es-GT", gender: "Male", name: "AndresNeural" },
    { language: "es-GT", gender: "Female", name: "MartaNeural" },
    { language: "es-HN", gender: "Male", name: "CarlosNeural" },
    { language: "es-HN", gender: "Female", name: "KarlaNeural" },
    { language: "es-MX", gender: "Female", name: "DaliaNeural" },
    { language: "es-MX", gender: "Male", name: "JorgeNeural" },
    { language: "es-NI", gender: "Male", name: "FedericoNeural" },
    { language: "es-NI", gender: "Female", name: "YolandaNeural" },
    { language: "es-PA", gender: "Female", name: "MargaritaNeural" },
    { language: "es-PA", gender: "Male", name: "RobertoNeural" },
    { language: "es-PE", gender: "Male", name: "AlexNeural" },
    { language: "es-PE", gender: "Female", name: "CamilaNeural" },
    { language: "es-PR", gender: "Female", name: "KarinaNeural" },
    { language: "es-PR", gender: "Male", name: "VictorNeural" },
    { language: "es-PY", gender: "Male", name: "MarioNeural" },
    { language: "es-PY", gender: "Female", name: "TaniaNeural" },
    { language: "es-SV", gender: "Female", name: "LorenaNeural" },
    { language: "es-SV", gender: "Male", name: "RodrigoNeural" },
    { language: "es-US", gender: "Male", name: "AlonsoNeural" },
    { language: "es-US", gender: "Female", name: "PalomaNeural" },
    { language: "es-UY", gender: "Male", name: "MateoNeural" },
    { language: "es-UY", gender: "Female", name: "ValentinaNeural" },
    { language: "es-VE", gender: "Female", name: "PaolaNeural" },
    { language: "es-VE", gender: "Male", name: "SebastianNeural" },
    { language: "et-EE", gender: "Female", name: "AnuNeural" },
    { language: "et-EE", gender: "Male", name: "KertNeural" },
    { language: "fa-IR", gender: "Female", name: "DilaraNeural" },
    { language: "fa-IR", gender: "Male", name: "FaridNeural" },
    { language: "fi-FI", gender: "Male", name: "HarriNeural" },
    { language: "fi-FI", gender: "Female", name: "NooraNeural" },
    { language: "fil-PH", gender: "Male", name: "AngeloNeural" },
    { language: "fil-PH", gender: "Female", name: "BlessicaNeural" },
    { language: "fr-BE", gender: "Female", name: "CharlineNeural" },
    { language: "fr-BE", gender: "Male", name: "GerardNeural" },
    { language: "fr-CA", gender: "Male", name: "AntoineNeural" },
    { language: "fr-CA", gender: "Male", name: "JeanNeural" },
    { language: "fr-CA", gender: "Female", name: "SylvieNeural" },
    { language: "fr-CA", gender: "Male", name: "ThierryNeural" },
    { language: "fr-CH", gender: "Female", name: "ArianeNeural" },
    { language: "fr-CH", gender: "Male", name: "FabriceNeural" },
    { language: "fr-FR", gender: "Female", name: "DeniseNeural" },
    { language: "fr-FR", gender: "Female", name: "EloiseNeural" },
    { language: "fr-FR", gender: "Male", name: "HenriNeural" },
    { language: "fr-FR", gender: "Male", name: "RemyMultilingualNeural" },
    { language: "fr-FR", gender: "Female", name: "VivienneMultilingualNeural" },
    { language: "ga-IE", gender: "Male", name: "ColmNeural" },
    { language: "ga-IE", gender: "Female", name: "OrlaNeural" },
    { language: "gl-ES", gender: "Male", name: "RoiNeural" },
    { language: "gl-ES", gender: "Female", name: "SabelaNeural" },
    { language: "gu-IN", gender: "Female", name: "DhwaniNeural" },
    { language: "gu-IN", gender: "Male", name: "NiranjanNeural" },
    { language: "he-IL", gender: "Male", name: "AvriNeural" },
    { language: "he-IL", gender: "Female", name: "HilaNeural" },
    { language: "hi-IN", gender: "Male", name: "MadhurNeural" },
    { language: "hi-IN", gender: "Female", name: "SwaraNeural" },
    { language: "hr-HR", gender: "Female", name: "GabrijelaNeural" },
    { language: "hr-HR", gender: "Male", name: "SreckoNeural" },
    { language: "hu-HU", gender: "Female", name: "NoemiNeural" },
    { language: "hu-HU", gender: "Male", name: "TamasNeural" },
    { language: "id-ID", gender: "Male", name: "ArdiNeural" },
    { language: "id-ID", gender: "Female", name: "GadisNeural" },
    { language: "is-IS", gender: "Female", name: "GudrunNeural" },
    { language: "is-IS", gender: "Male", name: "GunnarNeural" },
    { language: "it-IT", gender: "Male", name: "DiegoNeural" },
    { language: "it-IT", gender: "Female", name: "ElsaNeural" },
    { language: "it-IT", gender: "Male", name: "GiuseppeMultilingualNeural" },
    { language: "it-IT", gender: "Female", name: "IsabellaNeural" },
    { language: "iu-Cans-CA", gender: "Female", name: "SiqiniqNeural" },
    { language: "iu-Cans-CA", gender: "Male", name: "TaqqiqNeural" },
    { language: "iu-Latn-CA", gender: "Female", name: "SiqiniqNeural" },
    { language: "iu-Latn-CA", gender: "Male", name: "TaqqiqNeural" },
    { language: "ja-JP", gender: "Male", name: "KeitaNeural" },
    { language: "ja-JP", gender: "Female", name: "NanamiNeural" },
    { language: "jv-ID", gender: "Male", name: "DimasNeural" },
    { language: "jv-ID", gender: "Female", name: "SitiNeural" },
    { language: "ka-GE", gender: "Female", name: "EkaNeural" },
    { language: "ka-GE", gender: "Male", name: "GiorgiNeural" },
    { language: "kk-KZ", gender: "Female", name: "AigulNeural" },
    { language: "kk-KZ", gender: "Male", name: "DauletNeural" },
    { language: "km-KH", gender: "Male", name: "PisethNeural" },
    { language: "km-KH", gender: "Female", name: "SreymomNeural" },
    { language: "kn-IN", gender: "Male", name: "GaganNeural" },
    { language: "kn-IN", gender: "Female", name: "SapnaNeural" },
    { language: "ko-KR", gender: "Male", name: "HyunsuMultilingualNeural" },
    { language: "ko-KR", gender: "Male", name: "InJoonNeural" },
    { language: "ko-KR", gender: "Female", name: "SunHiNeural" },
    { language: "lo-LA", gender: "Male", name: "ChanthavongNeural" },
    { language: "lo-LA", gender: "Female", name: "KeomanyNeural" },
    { language: "lt-LT", gender: "Male", name: "LeonasNeural" },
    { language: "lt-LT", gender: "Female", name: "OnaNeural" },
    { language: "lv-LV", gender: "Female", name: "EveritaNeural" },
    { language: "lv-LV", gender: "Male", name: "NilsNeural" },
    { language: "mk-MK", gender: "Male", name: "AleksandarNeural" },
    { language: "mk-MK", gender: "Female", name: "MarijaNeural" },
    { language: "ml-IN", gender: "Male", name: "MidhunNeural" },
    { language: "ml-IN", gender: "Female", name: "SobhanaNeural" },
    { language: "mn-MN", gender: "Male", name: "BataaNeural" },
    { language: "mn-MN", gender: "Female", name: "YesuiNeural" },
    { language: "mr-IN", gender: "Female", name: "AarohiNeural" },
    { language: "mr-IN", gender: "Male", name: "ManoharNeural" },
    { language: "ms-MY", gender: "Male", name: "OsmanNeural" },
    { language: "ms-MY", gender: "Female", name: "YasminNeural" },
    { language: "mt-MT", gender: "Female", name: "GraceNeural" },
    { language: "mt-MT", gender: "Male", name: "JosephNeural" },
    { language: "my-MM", gender: "Female", name: "NilarNeural" },
    { language: "my-MM", gender: "Male", name: "ThihaNeural" },
    { language: "nb-NO", gender: "Male", name: "FinnNeural" },
    { language: "nb-NO", gender: "Female", name: "PernilleNeural" },
    { language: "ne-NP", gender: "Female", name: "HemkalaNeural" },
    { language: "ne-NP", gender: "Male", name: "SagarNeural" },
    { language: "nl-BE", gender: "Male", name: "ArnaudNeural" },
    { language: "nl-BE", gender: "Female", name: "DenaNeural" },
    { language: "nl-NL", gender: "Female", name: "ColetteNeural" },
    { language: "nl-NL", gender: "Female", name: "FennaNeural" },
    { language: "nl-NL", gender: "Male", name: "MaartenNeural" },
    { language: "pl-PL", gender: "Male", name: "MarekNeural" },
    { language: "pl-PL", gender: "Female", name: "ZofiaNeural" },
    { language: "ps-AF", gender: "Male", name: "GulNawazNeural" },
    { language: "ps-AF", gender: "Female", name: "LatifaNeural" },
    { language: "pt-BR", gender: "Male", name: "AntonioNeural" },
    { language: "pt-BR", gender: "Female", name: "FranciscaNeural" },
    { language: "pt-BR", gender: "Female", name: "ThalitaMultilingualNeural" },
    { language: "pt-PT", gender: "Male", name: "DuarteNeural" },
    { language: "pt-PT", gender: "Female", name: "RaquelNeural" },
    { language: "ro-RO", gender: "Female", name: "AlinaNeural" },
    { language: "ro-RO", gender: "Male", name: "EmilNeural" },
    { language: "ru-RU", gender: "Male", name: "DmitryNeural" },
    { language: "ru-RU", gender: "Female", name: "SvetlanaNeural" },
    { language: "si-LK", gender: "Male", name: "SameeraNeural" },
    { language: "si-LK", gender: "Female", name: "ThiliniNeural" },
    { language: "sk-SK", gender: "Male", name: "LukasNeural" },
    { language: "sk-SK", gender: "Female", name: "ViktoriaNeural" },
    { language: "sl-SI", gender: "Female", name: "PetraNeural" },
    { language: "sl-SI", gender: "Male", name: "RokNeural" },
    { language: "so-SO", gender: "Male", name: "MuuseNeural" },
    { language: "so-SO", gender: "Female", name: "UbaxNeural" },
    { language: "sq-AL", gender: "Female", name: "AnilaNeural" },
    { language: "sq-AL", gender: "Male", name: "IlirNeural" },
    { language: "sr-RS", gender: "Male", name: "NicholasNeural" },
    { language: "sr-RS", gender: "Female", name: "SophieNeural" },
    { language: "su-ID", gender: "Male", name: "JajangNeural" },
    { language: "su-ID", gender: "Female", name: "TutiNeural" },
    { language: "sv-SE", gender: "Male", name: "MattiasNeural" },
    { language: "sv-SE", gender: "Female", name: "SofieNeural" },
    { language: "sw-KE", gender: "Male", name: "RafikiNeural" },
    { language: "sw-KE", gender: "Female", name: "ZuriNeural" },
    { language: "sw-TZ", gender: "Male", name: "DaudiNeural" },
    { language: "sw-TZ", gender: "Female", name: "RehemaNeural" },
    { language: "ta-IN", gender: "Female", name: "PallaviNeural" },
    { language: "ta-IN", gender: "Male", name: "ValluvarNeural" },
    { language: "ta-LK", gender: "Male", name: "KumarNeural" },
    { language: "ta-LK", gender: "Female", name: "SaranyaNeural" },
    { language: "ta-MY", gender: "Female", name: "KaniNeural" },
    { language: "ta-MY", gender: "Male", name: "SuryaNeural" },
    { language: "ta-SG", gender: "Male", name: "AnbuNeural" },
    { language: "ta-SG", gender: "Female", name: "VenbaNeural" },
    { language: "te-IN", gender: "Male", name: "MohanNeural" },
    { language: "te-IN", gender: "Female", name: "ShrutiNeural" },
    { language: "th-TH", gender: "Male", name: "NiwatNeural" },
    { language: "th-TH", gender: "Female", name: "PremwadeeNeural" },
    { language: "tr-TR", gender: "Male", name: "AhmetNeural" },
    { language: "tr-TR", gender: "Female", name: "EmelNeural" },
    { language: "uk-UA", gender: "Male", name: "OstapNeural" },
    { language: "uk-UA", gender: "Female", name: "PolinaNeural" },
    { language: "ur-IN", gender: "Female", name: "GulNeural" },
    { language: "ur-IN", gender: "Male", name: "SalmanNeural" },
    { language: "ur-PK", gender: "Male", name: "AsadNeural" },
    { language: "ur-PK", gender: "Female", name: "UzmaNeural" },
    { language: "uz-UZ", gender: "Female", name: "MadinaNeural" },
    { language: "uz-UZ", gender: "Male", name: "SardorNeural" },
    { language: "vi-VN", gender: "Female", name: "HoaiMyNeural" },
    { language: "vi-VN", gender: "Male", name: "NamMinhNeural" },
    { language: "zh-CN", gender: "Female", name: "XiaoxiaoNeural" },
    { language: "zh-CN", gender: "Female", name: "XiaoyiNeural" },
    { language: "zh-CN", gender: "Male", name: "YunjianNeural" },
    { language: "zh-CN", gender: "Male", name: "YunxiNeural" },
    { language: "zh-CN", gender: "Male", name: "YunxiaNeural" },
    { language: "zh-CN", gender: "Male", name: "YunyangNeural" },
    { language: "zh-CN-liaoning", gender: "Female", name: "XiaobeiNeural" },
    { language: "zh-CN-shaanxi", gender: "Female", name: "XiaoniNeural" },
    { language: "zh-HK", gender: "Female", name: "HiuGaaiNeural" },
    { language: "zh-HK", gender: "Female", name: "HiuMaanNeural" },
    { language: "zh-HK", gender: "Male", name: "WanLungNeural" },
    { language: "zh-TW", gender: "Female", name: "HsiaoChenNeural" },
    { language: "zh-TW", gender: "Female", name: "HsiaoYuNeural" },
    { language: "zh-TW", gender: "Male", name: "YunJheNeural" },
    { language: "zu-ZA", gender: "Female", name: "ThandoNeural" },
    { language: "zu-ZA", gender: "Male", name: "ThembaNeural" }
],
    roleTiles:[
        { id: 'memory', title: 'CharacterMemory', icon: 'fa-solid fa-brain' },
        // { id: 'mind', title: 'CharacterMind', icon: 'fa-solid fa-heart' },
        { id: 'voice', title: 'CharacterVoice', icon: 'fa-solid fa-volume-high' },
        { id: 'appearance', title: 'CharacterAppearance', icon: 'fa-solid fa-person' },
        { id: 'behavior', title: 'CharacterBehavior', icon: 'fa-solid fa-person-running' },
        { id: 'vision', title: 'CharacterVision', icon: 'fa-solid fa-eye'},
        { id: 'affection', title: 'affectionSystem', icon: 'fa-solid fa-heart' },
    ],
    modelTiles: [
      { id: 'service', title: 'modelService', icon: 'fa-solid fa-cloud' },
      { id: 'main', title: 'mainModel', icon: 'fa-solid fa-microchip' },
      { id: 'fast', title: 'fastModel', icon: 'fa-solid fa-gauge-high' },
      { id: 'reasoner', title: 'reasonerModel', icon: 'fa-solid fa-atom' },
      { id: 'vision', title: 'visionModel' , icon: 'fa-solid fa-camera'},
      { id: 'text2img', title: 'imgModel', icon: 'fa-solid fa-pencil' },
      { id: 'asr', title: 'asrModel', icon: 'fa-solid fa-microphone' },
      { id: 'tts', title: 'ttsModel', icon: 'fa-solid fa-volume-high' },
    ],
    toolkitTiles: [
      { id: 'tools', title: 'utilityTools', icon: 'fa-solid fa-screwdriver-wrench' },
      { id: 'websearch', title: 'webSearch', icon: 'fa-solid fa-globe' },
      { id: 'document', title: 'knowledgeBase', icon: 'fa-solid fa-book' },
      { id: 'sticker', title: 'sticker/image', icon: 'fa-solid fa-face-smile'},
      { id: 'interpreter', title: 'interpreter', icon: 'fa-solid fa-code'},
      { id: 'CLI', title: 'CLItool', icon: 'fa-solid fa-computer'},
      { id: 'visionControl', title: 'visionControl', icon: 'fa-solid fa-arrow-pointer'},
      { id: 'HA', title: 'homeAssistant', icon: 'fa-solid fa-house'},
      { id: 'chromeMCP', title: 'browserControl', icon: 'fa-solid fa-compass' },
      { id: 'sql', title: 'sqlControl', icon: 'fa-solid fa-database' },
      { id: 'comfyui', title: 'ComfyUI', icon: 'fa-solid fa-palette'},
      { id: 'mcp', title: 'mcpServers', icon: 'fa-solid fa-server'},
      { id: 'a2a', title: 'a2aServers', icon: 'fa-solid fa-plug'},
      { id: 'llmTool', title: 'llmTools', icon: 'fa-solid fa-network-wired'},
      { id: 'customHttpTool', title: 'customHttpTool', icon: 'fa-solid fa-wifi'},
    ],
    apiTiles: [
      { id: 'openai', title: 'openaiStyleAPI', icon: 'fa-solid fa-link' },
      { id: 'mcp', title: 'MCPStyleAPI', icon: 'fa-solid fa-server' },
      { id: 'vrm', title: 'vrmAPI', icon: 'fa-solid fa-user-ninja' },
      { id: 'agents', title: 'agentSnapshot', icon: 'fa-solid fa-robot'},
      { id: 'docker', title: 'docker', icon: 'fa-brands fa-docker'},
      { id: 'browser', title: 'browserMode', icon: 'fa-solid fa-globe' },
      { id: 'develop', title: 'development', icon: 'fa-solid fa-code' },
      { id: 'extension', title: 'extension', icon: 'fa-solid fa-puzzle-piece' },
      { id: 'fastapi', title: 'fastAPIDocs', icon: 'fa-solid fa-book' },
    ],
    storageTiles: [
      { id: 'text', icon: 'fa-solid fa-file-lines', title: 'storageText' },
      { id: 'image', icon: 'fa-solid fa-image', title: 'storageImage' },
      { id: 'video', icon: 'fa-solid fa-video', title: 'storageVideo' }
    ],
    systemTiles: [
      { id: 'general', icon: 'fa-solid fa-gear', title: 'generalSettings' },
      { id: 'appearance', icon: 'fa-solid fa-palette', title: 'appearanceSettings' },
    ],
    defaultSeparators: [
      // Escape characters
      { label: '\\n', value: '\n' },
      { label: '\\n\\n', value: '\n\n' },
      { label: '\\t', value: '\t' },
      { label: ' ', value: ' ' },
      // CJK punctuation
      { label: '。', value: '。' },
      { label: '...', value: '...' },
      { label: '？', value: '？' },
      { label: '！', value: '！' },
      { label: '，', value: '，' },
      { label: '；', value: ';' },
      { label: '：', value: '：' },
      { label: '～', value: '～' },
      // English punctuation
      { label: '~', value: '~' },
      { label: '.', value: '.' },
      { label: '…', value: '…' },
      { label: '?', value: '?' },
      { label: '!', value: '!' },
      { label: ',', value: ',' },
      { label: ';', value: ';' },
      { label: ':', value: ':' },
      { label: '"', value: '"' },
      { label: '\'', value: '\'' },
      // Other
      { label: '*', value: '*' },
      { label: '`', value: '`' },
      { label: '·', value: '·' },
      { label: '-', value: '-' },
      { label: '—', value: '—' },
      { label: '/', value: '/' },
    ],
    behaviorSettings:{
      enabled: false,
      behaviorList:[]
    }, // Behavior settings
    behaviorNameDict:{
      noInput: "noInputName",
      time: "timeName",
      cycle: "cycleName"
    },
    newBehavior:{
      enabled: false,
      trigger: {
        type: "noInput",
        time:{
          timeValue: "00:00:00", // Time value, e.g. 12:00:00
          days: [] // List of weekdays, e.g. [1, 2, 3] means Mon/Tue/Wed; empty means no repeat
        },
        noInput:{
          latency: 30, // Seconds to wait when there's no input
        },
        cycle:{
          cycleValue: "00:00:30", // Time value, e.g. 00:00:30
          repeatNumber: 1, // Cycle count, e.g. 3 times
          isInfiniteLoop: false, // Whether to loop infinitely
        }
      },
      action: {
        type: "prompt",
        prompt: "", // Prompt sends a command to the model
        random:{
          events:[""],
          type:"random",
          orderIndex:0,
        },
      },
      platform:"chat",
    },
    allBriefly:false,
    telegramBotConfig: {
      TelegramAgent: 'super-model',
      memoryLimit: 20,
      separators: ['。', '\n', '？', '！'],
      reasoningVisible: false,
      quickRestart: true,
      enableTTS: false,
      bot_token: '',
      wakeWord: '',
      behaviorTargetChatIds: [],
      allowedChatIds: [],
    },
    isTelegramBotRunning: false,
    isTelegramStarting: false,
    isTelegramStopping: false,
    isTelegramReloading: false,
    discordBotConfig: {
      token: '',
      llm_model: 'super-model',
      memory_limit: 30,
      separators: ['。', '\n', '？', '！'],
      reasoning_visible: true,
      quick_restart: true,
      enable_tts: false,
      wakeWord: '',
      behaviorTargetChatIds: [],
      allowedUserIds: [],
    },
    isDiscordBotRunning: false,
    isDiscordStarting: false,
    isDiscordStopping: false,
    isDiscordReloading: false,
    isAudioSynthesizing: false, // Audio-synthesis state
    audioChunksCount: 0,        // Number of generated audio segments
    totalChunksCount: 0,        // Total number of audio segments
    isConvertingAudio: false,    // Audio-conversion state
    isConvertStopping: false, // New state
    ttsWebSocket: null,
    wsConnected: false,
    isVRMRunning: false,
    isVRMStarting: false,
    isVRMStopping: false,
    isVRMReloading: false,
    BotConfig: {
      imgHost_enabled: false,
      imgHost: 'smms',
      SMMS_api_key: '',
      EI2_base_url: '',
      EI2_api_key: '',
      gitee_repo_owner: "",
      gitee_repo_name: "",
      gitee_token: "",
      gitee_branch: "master",
      github_repo_owner: "",
      github_repo_name: "",
      github_token: "",
      github_branch: "main"
    },
    deployTiles: [
      { id: 'table_pet', title: 'tablePet', icon: "fa-solid fa-user-ninja"},
      { id: 'vts_config', title: 'vtsbot', icon: "fa-solid fa-child"},
      { id: 'live_stream', title: 'live_stream_bot', icon: "fa-solid fa-video"},
      { id: 'im_bot', title: 'imBot', icon: 'fa-solid fa-comment' },
      { id: 'read_bot', title: 'readBot', icon: "fa-solid fa-book-open-reader"}, 
      { id: 'translate_bot', title: 'translateBot', icon: "fa-solid fa-language"}, 
    ],
    activeImBotTab: 'telegram',
    sourceText: '',
    translatedText: '',
    isTranslating: false,
    targetLangSelected: 'system',   // 'System default'
    readConfig: {
      longText: "",
      longTextList: [],
    },
    longTextListIndex: 0,
    selectedFile: null,
    isReadStarting: false,
    isReadStopping: false,
    isReadRunning: false,
    readState: {
      ttsChunks: [],
      audioChunks: [],
      chunks_voice: [], 
      ttsQueue: new Set(),
      currentChunk: 0,
      isPlaying: false
    },
    segmentEditBuffer: '',  // Temporary edit area for a single segment
    segmentVoiceEditBuffer: [],  // Temporary edit area for a single segment
    activeSegmentIdx: -1,    // The index of the segment being manually edited
    _curAudio: null,        // Current Audio instance
    isReadingOnetext: false,
    liveConfig: {
      filterMode: 'danmaku_only',
      danmakuQueueLimit: 5,
      wakeWord: '',
      youtube_enabled: false,
      youtube_vedio_id:  "",
      youtube_api_key:  "",
      twitch_enabled: false,
      twitch_channel: "",
      twitch_access_token: "",
      danmakuVoice:"default",
      enableDanmakuTTS: false,
    },
    isSlackBotRunning: false,
    isSlackStarting: false,
    isSlackStopping: false,
    isSlackReloading: false,

    // Slack config object
    slackBotConfig: {
      bot_token: '',      // Slack's xoxb token
      app_token: '',      // Slack's xapp token (Socket Mode)
      llm_model: 'super-model',
      memory_limit: 30,
      separators: ['。', '\n', '？', '！'],
      reasoning_visible: true,
      quick_restart: true,
      enable_tts: false,
      wakeWord: '',
      behaviorTargetChatIds: [],
      allowedUserIds: [],
    },

    danmu: [], // Bullet-chat list
    bilibiliWs: null, // WebSocket connection
    danmuProcessTimer: null, // Bullet-chat processing timer
    isProcessingDanmu: false, // Whether bullet chats are being processed
    shouldReconnectWs :false,
    isLiveRunning: false,
    isLiveStarting: false,
    isLiveStopping: false,
    isLiveReloading: false,
    stickerPacks: [],
    showStickerDialog: false,
    newStickerPack: {
      name: '',
      stickers: [],
      tags: []
    },
    dialogVisible: false,
    imageUrl: '',
    uploadedStickers: [], // Format: { uid: string, url: string, tags: string[] }
    isStarting: false,      // Starting state
    isStopping: false,      // Stopping state
    isReloading: false,     // Reloading state
    activeMemoryTab: 'config',
    activeBehaviorTab: 'config',
    activeMemoryTabName: 'autoUpdateSetting',
    activeMCPTab: 'config',
    activeCLITab: 'config',
    quickCreatePrompt: '',
    isGenerating: false, // Whether generation is in progress
    quickCreateSystemPrompt: '',
    isSystemPromptGenerating: false, // Whether generation is in progress
    isQuickGenerating: false, // Whether generation is in progress
    memories: [],
    newMemory: {
      id: null,
      name: '',
      infer: false,
      providerId: null,
      model: '',
      base_url: '',
      api_key: '',
      vendor: '',
      description: '',
      avatar: '',
      personality: '',
      mesExample: '',
      systemPrompt: '',
      firstMes: '',
      alternateGreetings: [],
      characterBook: [{ keysRaw: '', content: '' }]
    },
    firstMes: '',
    alternateGreetings: [],
    showAddMemoryDialog: false,
    showMemoryDialog: false,
    memorySettings: {
      selectedMemory: null,
      is_memory: false,
      memoryLimit: 10,
      userName:'user',
      genericSystemPrompt: '{{char}} must communicate with {{user}} in the language {{user}} uses. For example, when {{user}} uses Korean, you must use Korean as much as possible! When {{user}} uses English, you must use English! The same applies to narration and other text!',
      globalMemory: '',
    },
    textFiles: [],
    imageFiles: [],
    videoFiles: [],
    selectedFiles: [],      // Stores unique_filename
    selectedImages: [],
    allImagesChecked: false,
    indeterminateImages: false,
    selectedVideos: [],
    allVideosChecked: false,
    indeterminateVideos: false,
    subMenu: '', // New submenu state
    isWorldviewSettingsExpanded: true,
    isRandomSettingsExpanded: true,
    isBasicCharacterExpanded: true,
    text2imgSettings: {
      enabled: false,
      engine: 'pollinations',
      pollinations_model: 'flux',
      pollinations_width: 512,
      pollinations_height: 512,
      selectedProvider: null,
      vendor: 'OpenAI',
      model: '',
      base_url: '',
      api_key: '',
      size: '1024x1024',
    },
    agentTiles: [
      { 
        id: 'agents',
        title: 'agentSnapshot',
        icon: 'fa-solid fa-robot'
      },
      {
        id: 'mcp',
        title: 'mcpServers', 
        icon: 'fa-solid fa-server'
      },
      {
        id: 'a2a',
        title: 'a2aServers',
        icon: 'fa-solid fa-plug'
      },
      {
        id: 'llmTool',
        title: 'llmTools',
        icon: 'fa-solid fa-network-wired'
      },
      {
        id: 'customHttpTool',
        title: 'customHttpTool',
        icon: 'fa-solid fa-wifi'
      },
      {
        id: 'comfyui',
        title: 'ComfyUI',
        icon: 'fa-solid fa-palette'
      },
    ],
    comfyuiServers: ['http://127.0.0.1:8188'], // Default server
    comfyuiAPIkey: '',
    workflowDescription: "",
    activeComfyUIUrl: '',
    isConnecting: false,
    customHttpTools: [],  // Array for storing custom HTTP tools
    showCustomHttpToolForm: false,
    isInputExpanded: false,
    isChatInputActive: false, // Whether the chat input is active (focused/expanded); when false it shows 1 line and tucks the model/view pills to the left of the send button
    sidebarVisible: false,
    isMobile: false,
    searchKeyword: '',
    newCustomHttpTool: {
      enabled: true,
      name: '',
      description: '',
      url: '',
      method: 'GET',
      headers: '',
      body: ''
    },
    editingCustomHttpTool: false,

    searchQuery: '', // The search-box value
    activeCategory: 'all', // The currently selected category: 'all' | 'local' | 'cloud'
    
    // Define the list of local/self-hosted providers
    localVendors:[
      'llama.cpp','Ollama', 'Vllm', 'LMstudio','SGLang', 'xinference', 
      'LocalAI', 'ttswebui', 'Dify', 'newapi'
    ],

    vendorValues: [
      'custom','customAnthropic', 'OpenAI','Anthropic', 'Gemini','Grok',
      'llama.cpp', 'Ollama','Vllm','LMstudio','SGLang','xinference','Dify','newapi',
      'LocalAI','ttswebui', 'Deepseek', 'Volcano','302.AI',
      'siliconflow', 'aliyun', 'ZhipuAI', 'moonshot', 'minimax', 
       'mistral', 'lingyi','baichuan', 'qianfan', 'hunyuan', 'stepfun', 'Github', 
      'openrouter','together', 'fireworks', '360', 'Nvidia',
      'jina', 'gitee', 'perplexity', 'infini',
      'modelscope', 'tencent', 'MiMo','longcat'
    ],
    vendorLogoList: {
      'custom': 'source/providers/logo.png',
      'customAnthropic': 'source/providers/logo.png',
      'OpenAI': 'source/providers/openai.jpeg',
      'SGLang': 'source/providers/sglang.svg',      
      'llama.cpp': 'source/providers/llamacpp.png', 
      'Ollama': 'source/providers/ollama.png',
      'Vllm': 'source/providers/vllm.png',
      'LMstudio': 'source/providers/lmstudio.png',
      'xinference': 'source/providers/xinference.png',
      'Dify': 'source/providers/dify.png',
      'newapi': 'source/providers/newapi.png',
      'LocalAI': 'source/providers/localai.png',
      'ttswebui': 'source/providers/ttswebui.jpeg',
      'Deepseek': 'source/providers/deepseek.png',
      'Volcano': 'source/providers/volcengine.png',
      'siliconflow': 'source/providers/silicon.png',
      '302.AI': 'source/providers/302.png',
      'aliyun': 'source/providers/bailian.png',
      'ZhipuAI': 'source/providers/zhipu.png',
      'moonshot': 'source/providers/moonshot.png',
      'minimax': 'source/providers/minimax.png',
      'MiMo': 'source/providers/mimo.png',
      'longcat': 'source/providers/longcat.png',
      'Gemini': 'source/providers/gemini.png',
      'Anthropic': 'source/providers/anthropic.png',
      'Grok': 'source/providers/grok.png',
      'mistral': 'source/providers/mistral.png',
      'lingyi': 'source/providers/zero-one.png',
      'baichuan': 'source/providers/baichuan.png',
      'qianfan': 'source/providers/baidu-cloud.svg',
      'hunyuan': 'source/providers/hunyuan.png',
      'stepfun': 'source/providers/step.png',
      'Github': 'source/providers/github.png',
      'openrouter': 'source/providers/openrouter.png',
      'together': 'source/providers/together.png',
      'fireworks': 'source/providers/fireworks.png',
      '360': 'source/providers/360.png',
      'Nvidia': 'source/providers/nvidia.png',
      'jina': 'source/providers/jina.png',
      'gitee': 'source/providers/gitee-ai.png',
      'perplexity': 'source/providers/perplexity.png',
      'infini': 'source/providers/infini.png',
      'modelscope': 'source/providers/modelscope.png',
      'tencent': 'source/providers/tencent-cloud-ti.png',
    },
    vendorAPIpage: {
      'OpenAI': 'https://platform.openai.com/api-keys',
      'Ollama': 'https://ollama.com/',
      'Vllm': 'https://docs.vllm.ai/en/latest/',      
      'LMstudio': 'https://lmstudio.ai/docs/app',
      'xinference': 'https://inference.readthedocs.io/zh-cn/latest/index.html',
      'SGLang': 'https://github.com/sgl-project/sglang',    
      'llama.cpp': 'https://github.com/ggerganov/llama.cpp', 
      'Dify': 'http://localhost/apps',
      'newapi': 'https://github.com/QuantumNous/new-api',
      'LocalAI': 'https://github.com/mudler/LocalAI',
      'ttswebui': 'https://github.com/rsxdalv/TTS-WebUI',
      'Deepseek': 'https://platform.deepseek.com/api_keys',
      'Volcano': 'https://www.volcengine.com/experience/ark',
      'siliconflow': 'https://cloud.siliconflow.cn/i/yGxrNlGb',
      '302.AI': 'https://share.302.ai/Mtahd4',
      'aliyun': 'https://bailian.console.aliyun.com/?tab=model#/api-key',
      'ZhipuAI': 'https://open.bigmodel.cn/usercenter/apikeys',
      'moonshot': 'https://platform.moonshot.cn/console/api-keys',
      'minimax': 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
      'MiMo': 'https://platform.xiaomimimo.com/#/console/api-keys',
      'longcat': 'https://longcat.chat/platform/api_keys',
      'Gemini': 'https://aistudio.google.com/app/apikey',
      'Anthropic': 'https://console.anthropic.com/settings/keys',
      'Grok': 'https://console.x.ai/',
      'mistral': 'https://console.mistral.ai/api-keys/',
      'lingyi': 'https://platform.lingyiwanwu.com/apikeys',
      'baichuan': 'https://platform.baichuan-ai.com/console/apikey',
      'qianfan': 'https://console.bce.baidu.com/iam/#/iam/apikey/list',
      'hunyuan': 'https://console.cloud.tencent.com/hunyuan/api-key',
      'stepfun': 'https://platform.stepfun.com/interface-key',
      'Github': 'https://github.com/settings/tokens',
      'openrouter': 'https://openrouter.ai/settings/keys',
      'together': 'https://api.together.ai/settings/api-keys',
      'fireworks': 'https://fireworks.ai/account/api-keys',
      '360': 'https://ai.360.com/platform/keys',
      'Nvidia': 'https://build.nvidia.com/meta/llama-3_1-405b-instruct',
      'jina': 'https://jina.ai/api-dashboard',
      'gitee': 'https://ai.gitee.com/dashboard/settings/tokens',
      'perplexity': 'https://www.perplexity.ai/settings/api',
      'infini': 'https://cloud.infini-ai.com/iam/secret/key',
      'modelscope': 'https://modelscope.cn/my/myaccesstoken',
      'tencent': 'https://console.cloud.tencent.com/lkeap/api',
    },
    MCPvendorValues:['MCP','awesome','docker'],
    MCPpage:{
      'MCP': 'https://github.com/modelcontextprotocol/servers',
      'awesome': 'https://github.com/punkpeye/awesome-mcp-servers',
      'docker': 'https://hub.docker.com/mcp'
    },
    MCPvendorLogoList: {
      'MCP': 'source/providers/mcp.png',
      'awesome': 'source/providers/github.png',
      'docker': 'source/providers/docker.png'
    },
    promptValues:['awesome', 'aiTool','leaked'],
    promptPage:{
      'awesome': 'https://github.com/f/awesome-chatgpt-prompts',
      'aiTool': 'https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools',
      'leaked': 'https://github.com/linexjlin/GPTs',
    },
    promptLogoList: {
      'awesome': 'source/providers/github.png',
      'aiTool': 'source/providers/github.png',
      'leaked': 'source/providers/github.png',
    },
    cardValues: ['chub', 'janitorai','pygmalion'],
    cardPage:{
      'chub': 'https://chub.ai/',
      'janitorai': 'https://janitorai.com/',
      'pygmalion': 'https://pygmalion.chat/',
    },
    cardLogoList: {
      'chub': 'source/providers/chub.png',
      'janitorai': 'source/providers/janitorai.png',
      'pygmalion': 'source/providers/pygmalion.svg',
    },
    newProviderTemp: {
      vendor: '',
      url: '',
      apiKey: '',
      modelId: ''
    },
    systemlanguageOptions:[
      { value: 'auto', label: 'auto' }, 
      { value: 'zh-CN', label: '中文' }, 
      { value: 'en-US', label: 'English' },
    ],
    toneValues: [
      'normal', 'formal', 'friendly', 'humorous', 'professional',
      'sarcastic', 'ironic', 'flirtatious', 'tsundere', 'coquettish',
      'angry', 'sad', 'excited', 'refutational'
    ],
    showUploadDialog: false,
    agentTabActive: 'knowledge',
    files: [],
    images: [],
    currentUploadType: 'file',
    selectedCodeLang: 'python',
    previewClickHandler: null,
    dockerExamples: `docker pull ailm32442/super-agent-party:latest
docker run -d \\
  -p 3456:3456 \\
  -v ./super-agent-data:/app/data \\
  ailm32442/super-agent-party:latest
`,
    dockerExamples2: `git clone https://github.com/heshengtao/super-agent-party.git
cd super-agent-party
docker-compose up -d
`,
    dockerRegistry: 'international', // Default international source; the user can switch
    
    // Mirror-address config
    dockerImages: {
      international: {
        backend: 'ailm32442/super-agent-party:latest',
        gateway: 'ailm32442/nginx-for-sap:latest',
        composeFile: 'docker-compose.yml'
      },
      china: {
        backend: 'crpi-9mgnqijkd7wc42x2.cn-shenzhen.personal.cr.aliyuncs.com/ailm32442/super-agent-party:latest',
        gateway: 'crpi-9mgnqijkd7wc42x2.cn-shenzhen.personal.cr.aliyuncs.com/ailm32442/nginx-for-sap:latest',
        composeFile: 'docker-compose-acr.yml'
      }
    },
    browserEmbedCodeExamples: `<div id="super-agent-party">
  <iframe 
    src="${backendURL}/chat.html" 
    width="100%" 
    height="100%"
    frameborder="0" 
    allowfullscreen>
  </iframe>
  <p>Powered By<a href="https://github.com/heshengtao/super-agent-party">Super Agent Party</a></p>
</div>`,
    codeExamples: {
      python: `from openai import OpenAI
client = OpenAI(
  api_key="super-secret-key",
  base_url="${backendURL}/v1"
)
response = client.chat.completions.create(
  model="super-model",
  messages=[
      {"role": "user", "content": "super agent party가 뭐야?"}
  ]
)
print(response.choices[0].message.content)`,
    javascript: `import OpenAI from 'openai';
const client = new OpenAI({
  apiKey: "super-secret-key",
  baseURL: "${backendURL}/v1"
});
async function main() {
  const completion = await client.chat.completions.create({
      model: "super-model",
      messages: [
          { role: "user", content: "super agent party가 뭐야?" }
      ]
  });
  console.log(completion.choices[0].message.content);
}
main();`,
    curl: `curl ${backendURL}/v1/chat/completions \\
-H "Content-Type: application/json" \\
-H "Authorization: Bearer super-secret-key" \\
-d '{
  "model": "super-model",
  "messages": [
    {"role": "user", "content": "super agent party가 뭐야?"}
  ]
}'`
    },  
    llmTools: [],
    showLLMForm: false,
    editingLLM: null,
    newLLMTool: {
      name: '',
      type: 'openai',
      description: '',
      base_url: '',
      api_key: '',
      model: '',
      enabled: true
    },
    llmInterfaceTypes: [
      { value: 'openai', label: 'OpenAI' },
      { value: 'ollama', label: 'Ollama' }
    ],
    modelOptions: [],
    previewVisible: false,
    previewImageUrl: '',
    workflows: [], // Store the workflow-file list
    showWorkflowUploadDialog: false, // Controls the upload dialog's visibility
    workflowFile: null, // The currently selected workflow file
    selectedTextInput: null,
    selectedImageInput: null,
    selectedTextInput2: null,
    selectedImageInput2: null,
    selectedSeedInput: null,
    selectedSeedInput2: null,
    textInputOptions: [], // Make sure this is an empty array
    imageInputOptions: [], // Make sure this is an empty array
    seedInputOptions: [], // Make sure this is an empty array
    inAutoMode: false, // In-memory variable, not saved in settings
    vectorDialogVisible: false,
    vectorDialogMemoryId: '',
    vectorDialogMemoryName: '',
    vectorLoading: false,
    vectorTable: [],       // { idx, uuid, text, created_at, timetamp }
    editRowIdx: null,      // The line number being edited (= the backend idx)
    editRowText: "",     // The text being edited
    editRowVisible: false,
    nodeInstalled: false,   // Probe result
    nodeInstalling: false,
    nodeProgress: 0,
    nodeTimer: null,
    uvInstalled: false,
    uvInstalling: false,
    uvProgress: 0,
    uvTimer: null,
    dockerInstalled: false, 
    dockerInstalling: false,
    isReadInterruption: false,
    readSettings: {
      delay:2000
    },
    isReadPaused: false, 
    currentReadAudio: null,
    showLogDialog: false,
    showWorldPersonaDialog: false,   // 🐾 월드 펫 성격·시스템 지시 다이얼로그
    logContent: '', // Log content
    systemVoices: [],        // Stores the voice list fetched from the backend
    isLoadingSystemVoices: false, // Loading state
    renderTimers: {}, // Stores a debounce timer per message
    // --- AI-browser data ---
    browserTabs: [
        // Initialize a new tab by default
        { 
            id: Date.now(), 
            title: 'New Tab', 
            url: '', // An empty URL means show the welcome page
            favicon: '', 
            isLoading: false,
            canGoBack: false,
            canGoForward: false 
        }
    ],
    currentTabId: null, // Will be initialized in created or mounted
    urlInput: '',
    showEngineDropdown: false, // Controls the dropdown's visibility
    dropdownTimer: null, // New timer variable
    isSearchFocused: false,    // Controls the search-box focus styling
    searchEngine: 'bing', // 'bing' or 'google' or 'party'
    welcomeSearchQuery: '',
    showDownloadDropdown: false,
    downloads: [], // Stores all download records { id, filename, totalBytes, receivedBytes, state, path, progress }
    dropdownTimer: null, 
    showBrowserChat: false,
    favorites: [],       // Stores the bookmark list
    showFavorites: true, // Controls the welcome-page bookmarks' show/hide state
    searchEngineplaceholder:'',
    webviewPreloadPath: '', 
    isGroupMode: false,           // Whether group-chat mode is on
    selectedGroupAgents: [], 
    showGroupSettingsDialog: false,
    voiceStack : ['default'], // Stores the voice-playback queue
    receivedMsgIds: new Set(), 
    lastProcessedContent: '', 
    approvalMap: {},
    isSubmitting: false,      // Controls the loading state inside the dialog
    isEditMode: false,        // Controls whether the dialog is in add or edit mode
    currentEditingMCPId: null, // The MCP ID currently being edited/added
    activeDialogTab: 'config', 
    activeCLITab: 'config', // Make sure this already exists
    skillsList: [],
    showAddSkillDialog: false,
    addSkillTab: 'github',
    newSkillUrl: '',
    isSkillInstalling: false,
    skillsPollingTimer: null, 
    showSkillPreviewDialog: false,
    skillPreviewLoading: false,
    renderedSkillContent: '',
    extensionsPollingTimer: null,
    skillsInProject: [], 
    projectSkillsDetails: [],
    showBehaviorDialog: false,     // Controls the dialog's visibility
    currentBehaviorIndex: -1,      // The index being edited; -1 means a new addition
    tempBehavior: null,            // Temporary edit object, to avoid mutating the original data
    minLimit: { h: 0, m: 1, s: 0 },
    activeSideView: 'list', // 'list' | 'tasks' | 'workspace' | 'toolDetail'
    taskList: [],
    taskRefreshTimer: null,
    showCreateTaskDialog: false,
    isCreatingTask: false,
    showTaskResultDialog: false,
    selectedTaskResult: '',
    selectedTaskTitle: '',
    viewingTaskDetail: null,
    isDragging: false, // New state
    isPttMode: false,      // Controls whether the input box is in push-to-talk mode
    isPttRecording: false, // Controls whether recording is in progress
    isGlobalRecording: false, 
    workspaceTreeKey: 0, // Used to force-refresh the entire tree component
    expandedNodeKeys: [], // Used to save the expanded-folder state before refreshing
    workspaceRefreshTimer: null, 
    workspaceTreeProps: {
      label: 'name',
      children: 'children',
      isLeaf: (data) => !data.isDirectory // Tell el-tree that non-folders are leaf nodes (not expandable)
    },
    loveSettings: {
      enabled: false,
      dimensions: [
          "love", 
          "familiarity"
      ],
      prompt: "Based on the user's tone, emotional tenor, and your character setting, dynamically manage the following bond values:\n1. love (affinity): represents how much you like and feel close to the user. If the user is kind, caring, or pleasant to interact with, increase it (+1 to +5); if the user is cold, abusive, or does something you find off-putting, decrease it (-1 to -5). Max 50, min -50.\n2. familiarity: represents how well you know the user. As interactions increase and information is shared, it should rise slowly and steadily (+1 to +2 each time) and usually does not drop. Max 100, min 0.\n\n*Special note: If you do not see 'current attribute values' above, this is your first interaction with this user. Based on the tone and attitude of the user's very first sentence, decide a reasonable initial value on your own (e.g., between 0 and 10) and simply output the tags. During the chat, try to vary your tone, content, and style according to the bond values.*"
    },
    // Bond-system UI state
    activeAffectionTab: 'config', // Controls which tab is active
    affectionRawData: {},         // Stores the raw JSON returned by the backend ( {"name1": {love:1}, "name2": {love:5}} )
    affectionDataList: [],        // Convert to an array for table display
    affectionSearchQuery: '',     // The value bound to the search bar
    
    // Bond-system dialog state
    showAffectionDataDialog: false,
    isEditingAffection: false,
    currentAffectionForm: { userName: '' },
    isForceScrollToBottom: false,
    activeAgentTab: 'settings',

    isHeroInputFocus: false,
    isTopicGenerating: false,
    showOmniAgentDialog: false,
    favoriteExtensionIds: JSON.parse(localStorage.getItem('favorite_extensions')) || [],
    isStartingASR: false,

    newTaskForm: {
        title: '',
        description: '',
        task_type: 'once',
        platforms: [],
        agent_type: 'default',
        trigger_config: {
            timeValue: '09:00:00',
            days: [1, 2, 3, 4, 5],
            cycleValue: '01:00:00',
            repeatNumber: 1,
            isInfiniteLoop: true
        }
    },  
    isEditing: false,
    editingTaskId: null,
    activeLogPanels: ['logs'],
    selectedTaskHistory: [],
    currentResultIdx: 0,
    extButtonVisible: false,  // Controls whether the button is shown
    extMouseTimer: null,      // Mouse-idle timer
    isVTSConnecting: false,
    
    isVTSStarting: false, // The button's loading state
    vtsOnline: false, 
    VTSConfig: {
      enabled: false,
      url: 'ws://127.0.0.1:8001',
      enabledExpressions: true,
      enabledMotions: true
    },
    acpSettings: {
      agent: 'claude',            // Default CLI agent
      permissionMode: 'default',  // Default permission mode
      model: '',                  // Model override (optional)
      extraEnv: '',              // Extra environment variables
    },
    
    // ACPX state
    acpxStatus: null,            // null | 'available' | 'unavailable'
    checkingAcpx: false,         // Checking
    openedExtensions:[], 
    searchExtensionQuery: '',
    searchManageExtensionQuery: '', // For the main page's extension search
    searchRemotePluginQuery: '',    // For the remote-plugin search inside the dialog
    scrollPending: false,              // Scroll-throttle flag
    _streamUpdateTimer: null,          // Streaming-text batch-update timer
    _streamTextBuffer: '',             // Streaming-text buffer
    _streamTargetMsg: null,            // The message object currently being stream-updated
    activeToolBlock: null,        // The block object currently being viewed { messageIndex, blockIndex, block }
    activeToolBlockMessage: null, // Reference to the owning message
    customDataPath: "",
};
