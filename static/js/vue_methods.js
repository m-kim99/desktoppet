const md = window.markdownit({
    html: true,
    linkify: true,
    typographer: true,
    highlight: function (str, lang) {
    let language = lang === 'a2ui' || (lang && hljs.getLanguage(lang)) ? lang : 'plaintext';
    const isPotentialMermaid = (code) => {
    // Detect standard-syntax features
    const mermaidPatterns = [
        // Detect chart-type declaration
        /^\s*(graph|sequenceDiagram|gantt|classDiagram|pie|stateDiagram|gitGraph|journey|flowchart|mindmap|quadrantChart|erDiagram|requirementDiagram|gitGraph|C4Context|timeline|zenuml|sankey-beta|xychart-beta|block-beta|packet-beta|kanban|architecture-beta|radar-beta)\b/i,
        // Detect node-relationship syntax
        /-->|==>|:::|\|\|/,
        // Detect style-config syntax
        /^style\s+[\w]+\s+/im,
        // Detect comment syntax
        /%%\{.*\}\n?/
    ];
    
    return mermaidPatterns.some(pattern => pattern.test(code));
    };
    // Auto-upgrade Mermaid content in plain text
    if (language === 'plaintext' && isPotentialMermaid(str)) {
    language = 'mermaid';
    };
    const previewable = ['html', 'mermaid'].includes(language);
    const downloadButton = previewable ? 
    `<button class="download-button" data-lang="${language}"><i class="fa-solid fa-download"></i></button>` : '';
    // Add the preview button
    const previewButton = previewable ? 
    `<button class="preview-button" data-lang="${language}"><i class="fa-solid fa-eye"></i></button>` : '';
    try {
    return `<pre class="code-block"><div class="code-header"><span class="code-lang">${language}</span><div class="code-actions">${previewButton}${downloadButton}<button class="copy-button"><i class="fa-solid fa-copy"></i></button></div></div><div class="code-content"><code class="hljs language-${language}">${hljs.highlight(str, { language }).value}</code></div></pre>`;
    } catch (__) {
    return `<pre class="code-block"><div class="code-header"><span class="code-lang">${language}</span><div class="code-actions">${previewButton}${downloadButton}<button class="copy-button"><i class="fa-solid fa-copy"></i></button></div></div><div class="code-content"><code class="hljs">${md.utils.escapeHtml(str)}</code></div></pre>`;
    }
}
});

// 1. Rewrite the table opening tag: output HTML with a wrapper directly
md.renderer.rules.table_open = function(tokens, idx, options, env, self) {
  // Returns: <div class="markdown-table-wrapper"><table>
  return '<div class="markdown-table-wrapper"><table' + self.renderAttrs(tokens[idx]) + '>';
};

// 2. Rewrite the table closing tag: close table, add the button, close div
md.renderer.rules.table_close = function(tokens, idx, options, env, self) {
  // Add a special class "download-xlsx-btn" here for later event delegation
  // Note: onclick doesn't carry logic here; it's handled via Vue's event delegation
  return '</table><button class="table-download-btn download-xlsx-trigger" type="button"><i class="fa-solid fa-file-excel"></i> XLSX</button></div>';
};

if (window.markdownitFootnote) {
    md.use(window.markdownitFootnote);
    
    // [New] override the default footnote render rule: return only the number, drop the brackets []
    md.renderer.rules.footnote_caption = (tokens, idx) => {
        var n = Number(tokens[idx].meta.id + 1).toString();
        return n;
    };
}

if (window.markdownitTaskLists) {
    md.use(window.markdownitTaskLists, {
        enabled: true,   // Render as <input type="checkbox">
        label: true,     // Wrap the text in a <label>
        labelAfter: true // Place the label after the checkbox
    });
} else {
    console.warn('markdown-it-task-lists 插件未加载，任务列表将不会渲染。');
}

// Check whether the plugin is already loaded
if (window.markdownitContainer) {
    
    // 1. Define the "warning" container (maps to .highlight-block-reasoning in CSS)
    // Usage: 
    // ::: warning Title
    // Content...
    // :::
    md.use(window.markdownitContainer, 'warning', {
        validate: function(params) {
            return params.trim().match(/^warning\s*(.*)$/);
        },
        render: function (tokens, idx) {
            var m = tokens[idx].info.trim().match(/^warning\s*(.*)$/);
            if (tokens[idx].nesting === 1) {
                // Opening tag: <div class="highlight-block-reasoning"> ...
                var title = m[1] ? md.utils.escapeHtml(m[1]) : '';
                var titleHtml = title ? '<strong>' + title + '</strong><br>' : '';
                return '<div class="highlight-block-reasoning">' + titleHtml;
            } else {
                // Closing tag: </div>
                return '</div>\n\n';
            }
        }
    });

    // 2. Define the "info" container (maps to .highlight-block in CSS)
    // Usage: 
    // ::: info Note
    // Content...
    // :::
    md.use(window.markdownitContainer, 'info', {
        validate: function(params) {
            return params.trim().match(/^info\s*(.*)$/);
        },
        render: function (tokens, idx) {
            var m = tokens[idx].info.trim().match(/^info\s*(.*)$/);
            if (tokens[idx].nesting === 1) {
                var title = m[1] ? md.utils.escapeHtml(m[1]) : '';
                var titleHtml = title ? '<strong>' + title + '</strong><br>' : '';
                return '<div class="highlight-block">' + titleHtml;
            } else {
                return '</div>\n\n';
            }
        }
    });
} else {
    console.warn('markdown-it-container 插件未加载，自定义容器将不会渲染。');
}

if (window.texmath) {
    md.use(window.texmath, {
        engine: window.katex, // Set the render engine to katex
        delims: 'dollars',    // Use the $...$ and $$...$$ syntax
        katexOptions: {
            throwOnError: false,
            output: 'html'    // Force HTML output; friendliest for streaming rendering
        }
    });
}

const ALLOWED_EXTENSIONS =[
  // Office documents
  'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'pdf', 'pages', 
  'numbers', 'key', 'rtf', 'odt', 'epub',

  // Programming/development
  'js', 'ts', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'go', 'rs',
  'swift', 'kt', 'dart', 'rb', 'php', 'html', 'css', 'scss', 'less',
  'vue', 'svelte', 'jsx', 'tsx', 'json', 'xml', 'yml', 'yaml', 
  'sql', 'sh',

  // Data/config
  'csv', 'tsv', 'txt', 'md', 'log', 'conf', 'ini', 'env', 'toml'
];

// MIME-type allowlist
const MIME_WHITELIST =[
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument',
  'application/pdf',
  'application/json',
  'text/csv',
  'text/x-python',
  'application/xml',
  'text/x-go',
  'text/x-rust',
  'text/x-swift',
  'text/x-kotlin',
  'text/x-dart',
  'text/x-ruby',
  'text/x-php'
];

// Image-upload-related config
const ALLOWED_IMAGE_EXTENSIONS =['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
const IMAGE_MIME_WHITELIST =[
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp'
];

// New: video-upload-related config
const ALLOWED_VIDEO_EXTENSIONS =['mp4', 'webm', 'ogg', 'mov', 'avi'];
const VIDEO_MIME_WHITELIST =[
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
  'video/x-msvideo'
];

// Change: merge the video extensions into the overall allowlist
const ALL_ALLOWED_EXTENSIONS = [...new Set([
  ...ALLOWED_EXTENSIONS, 
  ...ALLOWED_IMAGE_EXTENSIONS, 
  ...ALLOWED_VIDEO_EXTENSIONS // Add here
])];

let vue_methods = {
  stringifyEntityId(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    return String(value);
  },
  handleUpdateAction() {
    if (this.updateDownloaded) {
      window.electronAPI.quitAndInstall();
    } else if (this.updateAvailable) {
      window.electronAPI.downloadUpdate();
    }
  },
  formatFileUrl(originalUrl) {
    if (!this.isElectron) {
      try {
        const url = new URL(originalUrl);
        // Replace 0.0.0.0 with the current domain
        if (url.hostname === '0.0.0.0' || url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
          url.hostname = window.location.hostname;
          // To force HTTPS, you can add:
          url.protocol = window.location.protocol;
          url.port = window.location.port;
        }
        return url.toString();
      } catch(e) {
        return originalUrl;
      }
    }
    else {
      try {
        const url = new URL(originalUrl);
        if (url.hostname === '127.0.0.1') {
          url.hostname = "localhost";
          // To force HTTPS, you can add:
          url.protocol = window.location.protocol;
          url.port = window.location.port;
        }
        return url.toString();
      } catch(e) {
        return originalUrl;
      }
    }
    return originalUrl;
  },
  async resetMessage(index) {
    this.messages[index].content = " ";
    this.system_prompt = " ";
    await this.autoSaveSettings();
  },

  async deleteMessage(index) {
    this.stopGenerate();
    this.messages.splice(index, 1);
    if (this.conversationId === null) {
        this.conversationId = uuid.v4();
        const newConv = {
            id: this.conversationId,
            title: this.generateConversationTitle(messagesPayload),
            mainAgent: this.mainAgent,
            groupId: this.activeConversationGroupId || this.draftConversationGroupId || 'default',
            timestamp: Date.now(),
            messages: this.messages,
            fileLinks: this.fileLinks,
            system_prompt: this.system_prompt,
        };
        this.conversations.unshift(newConv);
    } else {
        const conv = this.conversations.find(conv => conv.id === this.conversationId);
        if (conv) {
            conv.messages = this.messages;
            conv.timestamp = Date.now();
            conv.fileLinks = this.fileLinks;
            conv.groupId = conv.groupId || this.activeConversationGroupId || this.draftConversationGroupId || 'default';
        }
    }
    await this.autoSaveSettings();
    await this.saveConversations();
    console.log("delete message");
  },

  openEditDialog(type, content, index = null) {
    this.editType = type;
    this.editContent = content;
    this.editIndex = index;
    this.showEditDialog = true;
    this.selectSystemPromptId =null;
  },
  async saveEdit() {
    this.showEditDialog = false;
    if (this.editType === 'system') {
      this.system_prompt = this.editContent;
      this.syncSystemPromptToMessages(this.system_prompt);
    }
    if (this.editType === 'user') {
      // Remove all messages after this.editIndex
      this.messages.splice(this.editIndex);
      this.userInput = this.editContent;
      this.stopGenerate();
      await this.sendMessage();
    }else{
      // this.messages[this.editIndex].pure_content = this.editContent; // update the message at this.editIndex
    }
    await this.autoSaveSettings();
  },
    async addParam() {
      this.settings.extra_params.push({
        name: '',
        type: 'string',  // Default type
        value: ''        // Auto-initialize based on type
      });
      await this.autoSaveSettings();
    },

    async addFastParam() {
      this.fastSettings.extra_params.push({
        name: '',
        type: 'string',  // Default type
        value: ''        // Auto-initialize based on type
      });
      await this.autoSaveSettings();
    },

    isInvalidJson(param) {
      // If it's not the json type, no JSON validation is needed
      if (param.type !== 'json') return false;
      
      // Empty or whitespace-only is treated as invalid
      if (!param.value || param.value.trim() === '') return true; 

      try {
        const parsed = JSON.parse(param.value);
        
        // Since the json type was chosen specifically, basic types (string/integer/boolean) are usually excluded.
        // We require that, once parsed, it must be an object ({}) or array ([]), and not null
        if (typeof parsed !== 'object' || parsed === null) {
          return true;
        }
        
        return false; // Parsed successfully and is an object/array; validation passes
      } catch (e) {
        return true; // JSON syntax error; validation fails
      }
    },

  getParamPlaceholder(type) {
    if (type === 'dict') return '{"type": "enabled"}';
    if (type === 'list') return '["item1", "item2"]';
    return this.t('paramValue'); // Use the translation by default
  },

    async updateParamType(index) {
      const param = this.settings.extra_params[index];
      switch(param.type) {
        case 'json':
          param.value = '{}'; // Default to an object; if the user wants an array, they can change it to [] themselves
          break;
        case 'boolean':
          param.value = false;
          break;
        case 'integer':
        case 'float':
          param.value = 0;
          break;
        default:
          param.value = '';
      }
      await this.autoSaveSettings();
    },

    async updateFastParamType(index) {
      const param = this.fastSettings.extra_params[index];
      // Initialize the value based on type
      switch(param.type) {
        case 'json':
          param.value = '{}'; // Default to an object; if the user wants an array, they can change it to [] themselves
          break;
        case 'boolean':
          param.value = false;
          break;
        case 'integer':
        case 'float':
          param.value = 0;
          break;
        default:
          param.value = '';
      }
      await this.autoSaveSettings();
    },


    async removeParam(index) {
      this.settings.extra_params.splice(index, 1);
      await this.autoSaveSettings();
    },
    async removeFastParam(index) {
      this.fastSettings.extra_params.splice(index, 1);
      await this.autoSaveSettings();
    },

    switchTollmTools() {
      this.activeMenu = 'toolkit';
      this.subMenu = 'llmTool';
    },
    switchToHttpTools() {
      this.activeMenu = 'toolkit';
      this.subMenu = 'customHttpTool';
    },
    switchToComfyui() {
      this.activeMenu = 'toolkit';
      this.subMenu = 'comfyui';
    },
    switchToStickerPacks() {
      this.activeMenu = 'toolkit';
      this.subMenu = 'sticker';
    },
    switchToMainAgent() {
      this.activeMenu = 'api-group';
      this.subMenu = 'agents';
    },
    switchToTTS() {
      this.activeMenu = 'model-config';
      this.subMenu = 'tts';
    },
    switchToExtensionPage() {
      this.activeMenu = 'api-group';
      this.subMenu = 'extension';
    },
    cancelLLMTool() {
      this.showLLMForm = false
      this.resetForm()
    },
    handleTypeChange(val) {
      this.newLLMTool.base_url = this.defaultBaseURL
      this.newLLMTool.api_key = this.defaultApikey
      this.fetchModelsForType(val)
    },
    changeImgHost(val) {
      this.BotConfig.img_host = val;
      this.autoSaveSettings()
    },
    // Get the model list
    async fetchModelsForType(type) {
      try {
        const response = await fetch(`/llm_models`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: type,
            base_url: this.newLLMTool.base_url,
            api_key: this.newLLMTool.api_key
          })
        })
        
        const { data } = await response.json()
        this.modelOptions = data.models || []
      } catch (error) {
        console.error('Failed to fetch models:', error)
      }
    },
    // Save the tool
    saveLLMTool() {
      const tool = { ...this.newLLMTool }
      // Add the tool ID
      tool.id = uuid.v4();
      if (this.editingLLM) {
        this.llmTools[this.editingLLM] = tool
      } else {
        this.llmTools.push(tool)
      }
      this.showLLMForm = false
      this.resetForm()
      this.autoSaveSettings()
    },
    // Delete the tool
    removeLLMTool(index) {
      this.llmTools.splice(index, 1)
      this.autoSaveSettings()
    },
    // Reset the form
    resetForm() {
      this.newLLMTool = {
        name: '',
        type: 'openai',
        description: '',
        base_url: '',
        api_key: '',
        model: '',
        enabled: true
      }
      this.editingLLM = null
    },
    // Type-label conversion
    toolTypeLabel(type) {
      const found = this.llmInterfaceTypes.find(t => t.value === type)
      return found ? found.label : type
    },
    // Check for updates
    async checkForUpdates() {
      if (isElectron) {
        try {
          await window.electronAPI.checkForUpdates();
        } catch (err) {
          showNotification(err.message, 'error');
        }
      }
    },

    // Download the update
    async downloadUpdate() {
      if (isElectron && this.updateAvailable) {
        try {
          await window.electronAPI.downloadUpdate();
        } catch (err) {
          showNotification(err.message, 'error');
        }
      }
    },

    // Install the update
    async installUpdate() {
      if (isElectron && this.updateDownloaded) {
        await window.electronAPI.quitAndInstall();
      }
    },

    // Handle the update-button click
    async handleUpdate() {
      if (!this.updateSuccess) {
        try {
          await this.downloadUpdate();
          this.updateSuccess = true;
          setTimeout(() => {
            this.installUpdate();
          }, 1000);
        } catch (err) {
          showNotification(err.message, 'error');
        }
      } else {
        await this.installUpdate();
      }
    },

    generateConversationTitle(messages) {
      const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
      
      if (lastUserMessage) {
        let textContent;
        
        // Determine whether content is a string or an array of objects
        if (typeof lastUserMessage.content === 'string') {
          textContent = lastUserMessage.content;
        } else if (Array.isArray(lastUserMessage.content)) {
          // Extract all text-type content and concatenate it
          textContent = lastUserMessage.content.filter(item => item.type === 'text')
                           .map(item => item.text).join(' ');
        } else {
          // If it's neither a string nor an object array, set an empty string or other default
          textContent = '';
        }
    
        // Append the fileLinks_content part, if any
        const fullContent = textContent + (lastUserMessage.fileLinks_content ?? '');
        
        return fullContent.substring(0, 30) + (fullContent.length > 30 ? '...' : '');
      }
      
      return this.t('newChat');
    },
    openDeleteConversationDialog(conversation) {
      if (!conversation?.id) return;
      this.deleteConversationForm = {
        id: conversation.id,
        title: conversation.title || this.t('untitled'),
        deleteMemory: false,
      };
      this.showDeleteConversationDialog = true;
    },
    async confirmDeleteConversation(convId) {
      const conversation = this.conversations.find(c => c.id === convId);
      if (!conversation) return;
      this.openDeleteConversationDialog(conversation);
    },
    ensureConversationGroups() {
      const defaultGroup = {
        id: 'default',
        name: this.t('defaultConversationGroup'),
        createdAt: 0,
        memoryConfig: {}
      };

      const rawGroups = Array.isArray(this.conversationGroups) ? this.conversationGroups : [];
      const groups = rawGroups
        .filter(group => group && group.id && group.id !== 'default')
        .map(group => ({
          ...group,
          memoryConfig: group.memoryConfig || {}
        }));

      this.conversationGroups = [defaultGroup, ...groups];
      if (Array.isArray(this.conversations)) {
        this.conversations.forEach(conv => {
          if (!conv.groupId) {
            conv.groupId = 'default';
          }
        });
      }
      const nextCollapsedState = { ...(this.collapsedConversationGroups || {}) };
      this.conversationGroups.forEach(group => {
        if (typeof nextCollapsedState[group.id] !== 'boolean') {
          nextCollapsedState[group.id] = false;
        }
      });
      Object.keys(nextCollapsedState).forEach(groupId => {
        if (!this.conversationGroups.some(group => group.id === groupId)) {
          delete nextCollapsedState[groupId];
        }
      });
      this.collapsedConversationGroups = nextCollapsedState;

      if (!this.conversationGroups.some(group => group.id === this.draftConversationGroupId)) {
        this.draftConversationGroupId = 'default';
      }
      if (!this.conversationGroups.some(group => group.id === this.activeConversationGroupId)) {
        this.activeConversationGroupId = this.draftConversationGroupId || 'default';
      }
    },
    setActiveConversationGroup(groupId = 'default') {
      this.ensureConversationGroups();
      const nextGroupId = this.conversationGroups.some(group => group.id === groupId) ? groupId : 'default';
      this.activeConversationGroupId = nextGroupId;
      this.draftConversationGroupId = nextGroupId;
    },
    isConversationGroupCollapsed(groupId = 'default') {
      return !!this.collapsedConversationGroups?.[groupId];
    },
    toggleConversationGroupCollapsed(groupId = 'default') {
      this.ensureConversationGroups();
      this.collapsedConversationGroups = {
        ...(this.collapsedConversationGroups || {}),
        [groupId]: !this.isConversationGroupCollapsed(groupId),
      };
    },
    toggleChatHistoryPanel() {
      if (this.isMobile) {
        this.showHistoryDialog = true;
        return;
      }
      this.chatHistoryPanelOpen = !this.chatHistoryPanelOpen;
    },
    createConversationGroup() {
      this.conversationGroupDialogMode = 'create';
      this.conversationGroupForm = {
        id: null,
        name: '',
        memoryEnabled: false,
      };
      this.showConversationGroupDialog = true;
    },
    openRenameConversationGroupDialog(group) {
      if (!group?.id || group.id === 'default') return;
      this.conversationGroupDialogMode = 'rename';
      this.conversationGroupForm = {
        id: group.id,
        name: group.name || '',
        memoryEnabled: !!group.memoryConfig?.enabled,
      };
      this.showConversationGroupDialog = true;
    },
    async submitConversationGroupDialog() {
      this.ensureConversationGroups();
      const name = String(this.conversationGroupForm?.name || '').trim();
      if (!name) {
        showNotification(this.t('groupNameRequired'), 'error');
        return;
      }

      const currentGroupId = this.conversationGroupForm?.id || null;
      const exists = this.conversationGroups.some(group =>
        group.id !== currentGroupId && (group.name || '').trim() === name
      );
      if (exists) {
        showNotification(this.t('groupNameExists'), 'error');
        return;
      }

      if (this.conversationGroupDialogMode === 'rename' && currentGroupId) {
        const targetGroup = this.conversationGroups.find(group => group.id === currentGroupId);
        if (!targetGroup) return;
        targetGroup.name = name;
        targetGroup.memoryConfig = {
          ...(targetGroup.memoryConfig || {}),
          enabled: !!this.conversationGroupForm?.memoryEnabled,
        };
        await this.saveConversations();
        this.showConversationGroupDialog = false;
        showNotification(this.t('groupRenamed'), 'success');
        return;
      }

      const newGroup = {
        id: uuid.v4(),
        name,
        createdAt: Date.now(),
        memoryConfig: {
          enabled: !!this.conversationGroupForm?.memoryEnabled,
        }
      };

      this.conversationGroups.push(newGroup);
      this.draftConversationGroupId = newGroup.id;
      this.activeConversationGroupId = newGroup.id;
      await this.saveConversations();
      this.showConversationGroupDialog = false;
      showNotification(this.t('groupCreated'), 'success');
    },
    async startConversationInGroup(groupId = null) {
      this.ensureConversationGroups();
      const targetGroupId = groupId || this.activeConversationGroupId || this.draftConversationGroupId || 'default';
      this.setActiveConversationGroup(targetGroupId);
      await this.clearMessages(targetGroupId);
    },
    async moveConversationToGroup(convId, groupId) {
      this.ensureConversationGroups();
      const targetGroupId = groupId || 'default';
      const conversation = this.conversations.find(conv => conv.id === convId);
      if (!conversation) return;

      conversation.groupId = targetGroupId;
      if (convId === this.conversationId) {
        this.draftConversationGroupId = targetGroupId;
        this.activeConversationGroupId = targetGroupId;
      }
      await this.saveConversations();
    },
    openDeleteGroupDialog(group) {
      if (!group?.id || group.id === 'default') return;
      this.deleteGroupForm = {
        id: group.id,
        name: group.name || '',
        conversationCount: this.conversations.filter(conv => (conv.groupId || 'default') === group.id).length,
      };
      this.showDeleteGroupDialog = true;
    },
    getDeleteGroupWarningText() {
      const count = this.deleteGroupForm?.conversationCount || 0;
      return String(this.t('deleteGroupWillDeleteChats')).replace('{count}', count);
    },
    async deleteConversationById(conversationId, options = {}) {
      const response = await fetch('/api/conversations/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: this.stringifyEntityId(conversationId),
          delete_memory: !!options.deleteMemory,
        }),
      });

      if (!response.ok) {
        throw new Error('delete_failed');
      }

      if (conversationId === this.conversationId) {
        this.conversationId = null;
        this.messages = [{ id: Date.now() + Math.random(), role: 'system', content: this.system_prompt }];
        this.fileLinks = [];
      }

      this.conversations = this.conversations.filter(c => c.id !== conversationId);
    },
    async clearGroupMemoriesByGroupId(groupId) {
      const response = await fetch('/api/group-memory/clear-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_id: this.stringifyEntityId(groupId),
        }),
      });

      if (!response.ok) {
        throw new Error('delete_failed');
      }
    },
    async clearAllGroupMemories() {
      const response = await fetch('/api/group-memory/clear-all', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('delete_failed');
      }
    },
    async clearAllHistoryRecords() {
      try {
        await this.$confirm(this.t('confirmClearAllHistory'), this.t('warning'), {
          confirmButtonText: this.t('confirm'),
          cancelButtonText: this.t('cancel'),
          type: 'warning'
        });

        const conversationIds = this.conversations.map(conv => conv.id);
        for (const conversationId of conversationIds) {
          await this.deleteConversationById(conversationId, {
            deleteMemory: true,
          });
        }
        await this.clearAllGroupMemories();

        this.conversationId = null;
        this.messages = [{ id: Date.now() + Math.random(), role: 'system', content: this.system_prompt }];
        this.fileLinks = [];
        this.conversationGroups = [{
          id: 'default',
          name: this.t('defaultConversationGroup'),
          createdAt: 0,
          memoryConfig: {}
        }];
        this.collapsedConversationGroups = { default: false };
        this.activeConversationGroupId = 'default';
        this.draftConversationGroupId = 'default';
        await this.saveConversations();
      } catch (error) {
        if (error?.message === 'delete_failed') {
          showNotification(this.t('deleteFailed') || 'Delete failed', 'error');
        }
      }
    },
    async pruneHistoryToLastWeek() {
      try {
        await this.$confirm(this.t('confirmKeepLastWeek'), this.t('warning'), {
          confirmButtonText: this.t('confirm'),
          cancelButtonText: this.t('cancel'),
          type: 'warning'
        });

        const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        const expiredConversationIds = this.conversations
          .filter(conv => !conv.timestamp || conv.timestamp < oneWeekAgo)
          .map(conv => conv.id);

        for (const conversationId of expiredConversationIds) {
          await this.deleteConversationById(conversationId, {
            deleteMemory: true,
          });
        }

        if (this.conversations.length === 0) {
          this.conversationId = null;
          this.messages = [{ id: Date.now() + Math.random(), role: 'system', content: this.system_prompt }];
          this.fileLinks = [];
        }

        await this.saveConversations();
      } catch (error) {
        if (error?.message === 'delete_failed') {
          showNotification(this.t('deleteFailed') || 'Delete failed', 'error');
        }
      }
    },
    async deleteConversationGroup(groupId, options = {}) {
      this.ensureConversationGroups();
      if (!groupId || groupId === 'default') return;

      const groupConversationIds = this.conversations
        .filter(conv => (conv.groupId || 'default') === groupId)
        .map(conv => conv.id);

        for (const conversationId of groupConversationIds) {
          await this.deleteConversationById(conversationId, {
            deleteMemory: true,
          });
        }
        await this.clearGroupMemoriesByGroupId(groupId);

        this.conversationGroups = this.conversationGroups.filter(group => group.id !== groupId);

      if (this.draftConversationGroupId === groupId) {
        this.draftConversationGroupId = 'default';
      }
      if (this.activeConversationGroupId === groupId) {
        this.activeConversationGroupId = 'default';
      }

      await this.saveConversations();
      if (!options.silent) {
        showNotification(this.t('groupDeleted'), 'success');
      }
    },

    async clearConversationGroupChats(groupId) {
      this.ensureConversationGroups();
      if (!groupId) return;
      try {
        await this.$confirm(this.t('clearGroupChatsConfirm'), this.t('warning'), {
          confirmButtonText: this.t('confirm'),
          cancelButtonText: this.t('cancel'),
          type: 'warning'
        });

        const groupConversationIds = this.conversations
          .filter(conv => (conv.groupId || 'default') === groupId)
          .map(conv => conv.id);

        for (const conversationId of groupConversationIds) {
          await this.deleteConversationById(conversationId, {
            deleteMemory: true,
          });
        }
        await this.clearGroupMemoriesByGroupId(groupId);

        if (this.conversationId === null) {
          this.messages = [{ id: Date.now() + Math.random(), role: 'system', content: this.system_prompt }];
          this.fileLinks = [];
        }

        await this.saveConversations();
        showNotification(this.t('groupChatsCleared'), 'success');
      } catch (error) {
        if (error?.message === 'delete_failed') {
          showNotification(this.t('deleteFailed') || 'Delete failed', 'error');
        }
      }
    },

    async confirmDeleteGroupDeletion() {
      const groupId = this.deleteGroupForm?.id;
      if (!groupId) return;
      try {
        await this.deleteConversationGroup(groupId);
        this.showDeleteGroupDialog = false;
      } catch (error) {
        showNotification(this.t('deleteFailed') || 'Delete failed', 'error');
      }
    },
    openRenameConversationDialog(conversation) {
      if (!conversation?.id) return;
      this.conversationRenameForm = {
        id: conversation.id,
        name: conversation.title || '',
      };
      this.showConversationRenameDialog = true;
    },
    async submitConversationRename() {
      const name = String(this.conversationRenameForm?.name || '').trim();
      if (!name) {
        showNotification(this.t('conversationNameRequired'), 'error');
        return;
      }
      const conversation = this.conversations.find(conv => conv.id === this.conversationRenameForm?.id);
      if (!conversation) return;
      conversation.title = name;
      await this.saveConversations();
      this.showConversationRenameDialog = false;
      showNotification(this.t('conversationRenamed'), 'success');
    },
    async confirmDeleteConversationDeletion() {
      const conversationId = this.deleteConversationForm?.id;
      if (!conversationId) return;
      try {
        await this.deleteConversationById(conversationId, {
          deleteMemory: !!this.deleteConversationForm?.deleteMemory,
        });
      } catch (error) {
        showNotification(this.t('deleteFailed') || 'Delete failed', 'error');
        return;
      }
      await this.saveConversations();
      this.showDeleteConversationDialog = false;
      showNotification(this.t('conversationDeleted'), 'success');
    },
    async loadConversation(convId) {
      const conversation = this.conversations.find(c => c.id === convId);
      if (conversation) {
        console.log("convid:"+convId);
        this.conversationId = convId;
        this.messages = [...conversation.messages];
        this.fileLinks = conversation.fileLinks;
        this.mainAgent = conversation.mainAgent;
        this.showHistoryDialog = false;
        this.system_prompt = conversation.system_prompt?conversation.system_prompt:" ";
        this.draftConversationGroupId = conversation.groupId || 'default';
        this.activeConversationGroupId = conversation.groupId || 'default';
      }
      else {
        this.system_prompt = " ";
        this.messages = [{ id: Date.now() + Math.random(), role: 'system', content: this.system_prompt }];
      }
      if(this.allBriefly){
        this.messages.forEach((m) => {
          m.briefly = true;
        })
      }else{
        this.messages.forEach((m) => {
          m.briefly = false;
        })
      }
      this.inAutoMode = false; // Reset the auto-mode state
      this.requestScrollToBottom();
      this.sendMessagesToExtension(); // Send the message to the plugin

      this.autoSaveSettings();
    },
    formatConversationTime(timestamp) {
      if (!timestamp) return '';
      const date = new Date(timestamp);
      const now = new Date();
      if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
      return date.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
    },
    // Modify getConversationPreview: drop heavy DOM/regex replacement, use minimal truncation
    getConversationPreview(conversation) {
      const messages = Array.isArray(conversation?.messages) ? conversation.messages :[];
      const firstUsefulMessage = messages.find(msg => msg && msg.role !== 'system' && msg.content);
      if (!firstUsefulMessage) return this.t('newChat');
      
      // Just do a simple string slice (most efficient), or return the first sentence's plain text
      const rawContent = Array.isArray(firstUsefulMessage.content)
        ? firstUsefulMessage.content.map(item => item?.text || '').join(' ')
        : String(firstUsefulMessage.content);
        
      // Take only the first 30 characters; skip global regex replacement
      return rawContent.substring(0, 30) + (rawContent.length > 30 ? '...' : '') || this.t('newChat');
    },
    async syncGroupMemoryAfterReply(userMessage, assistantMessage) {
      const groupId = this.activeConversationGroupId || this.draftConversationGroupId || 'default';
      if (!groupId || groupId === 'default') return;
      if (!userMessage?.id || !assistantMessage?.id) return;

      try {
        await fetch('/api/group-memory/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            group_id: this.stringifyEntityId(groupId),
            conversation_id: this.stringifyEntityId(this.conversationId),
            user_message_id: this.stringifyEntityId(userMessage.id),
            assistant_message_id: this.stringifyEntityId(assistantMessage.id),
            user_message: userMessage.pure_content ?? userMessage.content ?? '',
            assistant_message: assistantMessage.pure_content ?? assistantMessage.content ?? '',
          }),
        });
      } catch (error) {
        console.error('Failed to sync group memory:', error);
        showNotification(this.t('memorySyncFailed'), 'error');
      }
    },
    switchToagents() {
      this.activeMenu = 'api-group';
      this.subMenu = 'agents';
      this.activeAgentTab = 'add'
    },
    switchToa2aServers() {
      this.activeMenu = 'toolkit';
      this.subMenu = 'a2a';
    },
    switchToSystemPrompts() {
      this.showEditDialog = false;
      this.activeMenu = 'role';
      this.subMenu = 'memory';
      this.activeMemoryTab = 'prompts';
    },
    async syncProviderConfig(targetConfig) {
      if (targetConfig.selectedProvider) {
        const provider = this.modelProviders.find(
          p => p.id === targetConfig.selectedProvider && !p.disabled
        );
        if (provider) {
          let targetUrl = provider.url;

          // Determine whether the object being synced is ccSettings (by reference comparison)
          // If it's the CC config, apply the special vendor_list mapping logic
          if (targetConfig === this.ccSettings) {
             const vendor_list = {
              "Anthropic": "https://api.anthropic.com/",
              "Deepseek": "https://api.deepseek.com/anthropic/",
              "siliconflow": "https://api.siliconflow.cn/",
              "ZhipuAI":"https://open.bigmodel.cn/api/anthropic/",
              "moonshot":"https://api.moonshot.cn/anthropic/",
              "aliyun": "https://dashscope.aliyuncs.com/apps/anthropic/",
              "modelscope":"https://api-inference.modelscope.cn/",
              "302.AI":"https://api.302.ai/cc/",
              "MiMo":"https://api.xiaomimimo.com/anthropic/",
              "longcat":"https://api.longcat.chat/anthropic/",
              "newapi": provider.url.replace(/\/v1\/?$/, ''),
              "Ollama":provider.url.replace(/\/v1\/?$/, '')
            };
            // Use the mapped URL; fall back to the default url if there's no match
            targetUrl = vendor_list[provider.vendor] || provider.url;
          }

          // Sync the core config (note: comparison and assignment use targetUrl here)
          const shouldUpdate = 
            targetConfig.model !== provider.modelId ||
            targetConfig.base_url !== targetUrl || // Compare targetUrl
            targetConfig.api_key !== provider.apiKey;
            
          if (shouldUpdate) {
            targetConfig.model = provider.modelId || '';
            targetConfig.base_url = targetUrl || ''; // Assign targetUrl
            targetConfig.api_key = provider.apiKey || '';
            console.log(`已同步 ${provider.vendor} 配置 (CC模式: ${targetConfig === this.ccSettings})`);
          }
        } else {
          // ... (keep the original cleanup logic unchanged)
          console.warn('找不到匹配的供应商，已重置配置');
          targetConfig.selectedProvider = null;
          targetConfig.model = '';
          targetConfig.base_url = '';
          targetConfig.api_key = '';
        }
        await this.autoSaveSettings();
      }
    },
    updateMCPExample() {
      this.currentMCPExample = this.mcpExamples[this.newMCPType];
    },
    
    toggleMCPServer(name, status) {
      this.mcpServers[name].disabled = !status
      this.autoSaveSettings()
    },
    switchTomcpServers() {
      this.activeMenu = 'toolkit';
      this.subMenu = 'mcp'
    },
    // Window controls
    minimizeWindow() {
      if (isElectron) window.electronAPI.windowAction('minimize');
    },
    maximizeWindow() {
      if (isElectron) window.electronAPI.windowAction('maximize');
    },
    closeWindow() {
      if (isElectron) window.electronAPI.windowAction('close');
    },
    async handleSelect(key) {
      if (key === 'model-config') {
        this.activeMenu = 'model-config';
        this.subMenu = 'service'; // Show the first submenu by default
      }
      else if (key === 'role') {
        this.activeMenu = 'role';
        this.subMenu = 'memory'; // Show the first submenu by default
      }
      else if (key === 'toolkit') {
        this.activeMenu = 'toolkit';
        this.subMenu = 'tools'; // Show the first submenu by default
      }
      else if (key === 'api-group') {
        this.activeMenu = 'api-group';
        this.subMenu = 'openai'; // Show the first submenu by default
      }
      else if (key === 'storage') {
        this.activeMenu = 'storage';
        this.subMenu = 'text'; // Show the first submenu by default
        response = await fetch(`/update_storage`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json'
            }
        });
        if (response.ok) {
          console.log('Storage files updated successfully');
          data = await response.json();
          this.textFiles = data.textFiles;
          this.imageFiles = data.imageFiles;
          this.videoFiles = data.videoFiles;
          this.autoSaveSettings();
        }
        else {
          console.error('Failed to update storage files');
        }
      }
      else if (key === 'deploy-bot') {
        this.activeMenu = 'deploy-bot';
        this.subMenu = 'table_pet'; // Show the first submenu by default
      }
      else if (key === 'system') {
        this.activeMenu = 'system';
        this.subMenu = 'general'; // Show the general-settings subpage by default
      }
      else {
        this.activeMenu = key;
      }
      this.activeMenu = key;
    }, 
    toggleIcon() {
      this.isExpanded = !this.isExpanded; // Toggle the state on click
      this.maximizeWindow();
    },

    throttledUpdate(index, newContent) {
      // Update the source data
      this.messages[index].content = newContent;
      
      // If a timer is already running, skip (debounce)
      if (this.renderTimers[index]) return;

      this.renderTimers[index] = setTimeout(() => {
        // Run the actual render
        this.messages[index].renderedHtml = this.formatMessage(newContent, index);
        // Clear the timer
        this.renderTimers[index] = null;
      }, 80); // 80ms delay (~12fps); feels smooth without stutter to the eye
    },


    formatMessage(content, index) {
      if (!content) return '';

      let processedForRender = content.trimEnd(); 
      
      const lines = content.split('\n');
      const lastLine = lines[lines.length - 1].trim();

      if (lastLine.startsWith('|') && !lastLine.endsWith('|') && !/^[|\s-:]+$/.test(lastLine)) {
        processedForRender += ' |';
      }

      // --- Preprocessing stage ---
      // [Fix]: the original code mistakenly passed content here; changed to processedForRender so the table completion above takes effect
      const parts = this.splitCodeAndText(processedForRender);
      let inUnclosedCodeBlock = false;

      let processedContent = parts.map(part => {
        if (part.type === 'code') {
          inUnclosedCodeBlock = !part.closed;
          return part.content; 
        } else if (inUnclosedCodeBlock) {
          return part.content; 
        } else {
          let formatted = part.content;

          // ============================================================
          // [New] LaTeX formula protection mechanism
          // Prevent < and > inside formulas from being killed by the later HTML-tag-filtering regex
          // ============================================================
          // Match $$...$$ (handles multi-line and unclosed streaming output) and $...$ (inline formulas)
          formatted = formatted.replace(/\$\$([\s\S]*?)(?:\$\$|$)|\$([^\$\n]+)\$/g, function(match) {
            // Replace < with \lt and > with \gt inside formulas (KaTeX-supported and very safe)
            // Add a trailing space to avoid sticking to the next letter (e.g. accidentally becoming \ltx and erroring)
            return match.replace(/</g, '\\lt ').replace(/>/g, '\\gt ');
          });

          // ============================================================
          // Smart tag filtering
          // ============================================================
          const anyTagRegex = /<(\/?)([^\s>/>]+)([^>]*)>/g;
          formatted = formatted.replace(anyTagRegex, (match, slash, tagName, attrs) => {
            const lowerTagName = tagName.toLowerCase();
            if (lowerTagName === 'think') return match;
            const isStandardHtmlName = /^[a-zA-Z][a-zA-Z0-9-]*$/.test(tagName);
            if (isStandardHtmlName) {
              return match;
            } else {
              return ''; 
            }
          });

          // ============================================================
          // Handle the UI conversion of <think> tags
          // ============================================================
          const thinkTagRegexWithClose = /<think>([\s\S]*?)<\/think>/g;
          const thinkTagRegexOpenOnly = /<think>[\s\S]*$/;
          
          formatted = formatted
            .replace(thinkTagRegexWithClose, match => 
              match.replace('<think>', '<div class="highlight-block-reasoning">').replace('</think>', '</div>')
            )
            .replace(thinkTagRegexOpenOnly, match => 
              match.replace('<think>', '<div class="highlight-block-reasoning">')
            );

          return formatted;
        }
      }).join('');

      let rendered = md.render(processedContent);

      // --- Restore stage ---
      rendered = rendered.replace(/\\\`/g, '`').replace(/\\\$/g, '$');

      // Note: add a check that currentMsg exists
      const currentMsg = this.messages && index >= 0 ? this.messages[index] : null;
      if (currentMsg && index === this.messages.length - 1 && currentMsg.role === 'assistant' && this.isTyping && currentMsg.content !== currentMsg.pure_content) {
        rendered = `<div class="thinking-header"><i class="fa-solid fa-lightbulb"></i> ${this.t('thinking')}</div>` + rendered;
      }

      // --- Post-processing ---
      this.$nextTick(() => {
        if(typeof this.initCopyButtons === 'function') this.initCopyButtons();
        if(typeof this.initPreviewButtons === 'function') this.initPreviewButtons();
      });

      rendered = rendered.replace(/<a\s+(?:[^>]*?\s+)?href="([^"]*)"([^>]*)>/g, (match, href, otherAttrs) => {
        if (otherAttrs.includes('footnote-ref') || otherAttrs.includes('footnote-backref') || href.startsWith('#')) {
          return match; 
        }
        const formattedHref = typeof this.formatFileUrl === 'function' ? this.formatFileUrl(href) : href;
        return `<a href="${formattedHref}" target="_blank"${otherAttrs}>`;
      });

      return rendered;
    },

    formatMessageWrapper(content) {
        // Call your existing formatMessage; pass index = -1 here to avoid side effects (e.g. the thinking icon)
        return this.formatMessage(content, -1); 
    },
    copyLink(uniqueFilename) {
      const url = `${this.partyURL}/uploaded_files/${uniqueFilename}`
      navigator.clipboard.writeText(url)
        .then(() => {
          showNotification(this.t('copy_success'))
        })
        .catch(() => {
          showNotification(this.t('copy_failed'), 'error')
        })
    },
    copyApiKey(apiKey){
      navigator.clipboard.writeText(apiKey)
        .then(() => {
          showNotification(this.t('copy_success'))
        })
        .catch(() => {
          showNotification(this.t('copy_failed'), 'error')
        })
    },
    copyProvider(provider,index){
      // Insert a copy right after index in this.modelProviders
      this.modelProviders.splice(index + 1, 0, { ...provider, id: Date.now() });
      this.autoSaveSettings();
    },
    previewImage(img) {
      this.previewImageUrl = `${this.partyURL}/uploaded_files/${img.unique_filename}`
      this.previewVisible = true
      console.log(this.previewImageUrl)
    },
    copyMessageContent(message) {
      // Get the original content (copy user messages directly; copy raw markdown for AI messages)
      let content = message.role === 'user' 
        ? message.content 
        : message.pure_content || message.rawContent || message.content;
      // Handle file links
      if (message.fileLinks?.length) {
        content += '\n\n' + message.fileLinks.map(link => `[${link.name}](${link.path})`).join('\n');
      }
      navigator.clipboard.writeText(content)
        .then(() => showNotification(this.t('copy_success')))
        .catch(() => showNotification(this.t('copy_failed'), 'error'));
    },
    initPreviewButtons() {
      // Clean up old event listeners
      if (this._previewEventHandler) {
        document.body.removeEventListener('click', this._previewEventHandler);
      }
      // Main event handler
      this._previewEventHandler = (e) => {
        const button = e.target.closest('.preview-button');
        if (!button) return;
        e.preventDefault();
        e.stopPropagation();
        console.debug('🏁 预览按钮触发:', button);
        // Get the code context
        const codeBlock = button.closest('.code-block');
        if (!codeBlock) {
          console.error('❌ 未找到代码块容器');
          return;
        }
        // Get the code content
        const lang = button.dataset.lang;
        const codeContent = codeBlock.querySelector('code')?.textContent?.trim();
        if (!codeContent) {
          console.warn('⚠️ 空代码内容', codeBlock);
          this.showErrorToast('코드 내용이 비어 있습니다');
          return;
        }
        // Find/create the preview container within codeBlock
        let previewContainer = codeBlock.querySelector('.preview-container');
        const isNewContainer = !previewContainer;
        
        if (isNewContainer) {
          previewContainer = document.createElement('div');
          previewContainer.className = 'preview-container loading';
          codeBlock.appendChild(previewContainer);
        }
        // State-toggle logic
        if (previewContainer.classList.contains('active')) {
          this.collapsePreview(previewContainer, button);
        } else {
          this.expandPreview({ previewContainer, button, lang, codeContent });
        }
      };
      // Bind event listeners
      document.body.addEventListener('click', this._previewEventHandler);
      //console.log('preview-button event listeners initialized');
    },
    // Expand the preview panel
    expandPreview({ previewContainer, button, lang, codeContent }) {
      console.log('🔼 展开预览:', { lang, length: codeContent.length });
      
      const codeBlock = button.closest('.code-block');
  
      // Check whether a preview already exists
      const existingPreview = codeBlock.querySelector('.preview-container.active');
      if (existingPreview) {
        this.collapsePreview(existingPreview, button);
        return;
      }
      // Mark the code-block state
      codeBlock.dataset.previewActive = "true";
      
      // Hide the code content
      const codeContentDiv = codeBlock.querySelector('.code-content');
      codeContentDiv.style.display = 'none';
      
      // Update the button state
      button.innerHTML = '<i class="fa-solid fa-eye-slash"></i>';
      
      previewContainer.classList.add('active', 'loading');
      if (lang === 'mermaid'){
        previewContainer.style.width =  '85vw';
      }
      
      // Render the content
      requestAnimationFrame(() => {
        try {
          if (lang === 'html') {
            this.renderHtmlPreview(previewContainer, codeContent);
            // Dynamically adjust the iframe height
            const iframe = previewContainer.querySelector('iframe');
            iframe.onload = () => {
              iframe.style.height = iframe.contentWindow.document.body.scrollHeight + 'px';
            };
          } else if (lang === 'mermaid') {
            this.renderMermaidPreview(previewContainer, codeContent).then(() => {
              // Adjust the height after Mermaid finishes rendering
              const svg = previewContainer.querySelector('svg');
              if (svg) {
                previewContainer.style.minHeight = svg.getBBox().height + 'px';
              }
            });
          }
          previewContainer.classList.remove('loading');
        } catch (err) {
          console.error('🚨 预览渲染失败:', err);
          this.showPreviewError(previewContainer, err);
        }
      });
    },
    // Modify the collapsePreview method
    collapsePreview(previewContainer, button) {
      console.log('🔽 收起预览');
      
      const codeBlock = previewContainer.parentElement;
  
      // Reset the code-block state
      delete codeBlock.dataset.previewActive;
      
      // Show the code content
      const codeContentDiv = codeBlock.querySelector('.code-content');
      codeContentDiv.style.display = 'block';
      
      // Remove the preview container
      previewContainer.remove();
      
      // Reset the button state
      button.innerHTML = '<i class="fa-solid fa-eye"></i>';
    },
    // HTML renderer
    renderHtmlPreview(container, code) {
      console.log('🌐 渲染HTML预览');
      
      const sandbox = document.createElement('iframe');
      sandbox.srcdoc = `<!DOCTYPE html>
        <html>
          <head>
            <base href="/">
          </head>
          <body>${code}</body>
        </html>`;
      
      sandbox.style.cssText = `
        width: 70vw;
        height: 70vh;
        border: none;
        border-radius: 8px;
        background: transparent;
      `;
      
      container.replaceChildren(sandbox);
    },
    // Mermaid renderer (with retry mechanism)
    async renderMermaidPreview(container, code) {
      console.log('📊 渲染Mermaid图表');
      
      const diagramContainer = document.createElement('div');
      diagramContainer.className = 'mermaid-diagram';
      container.replaceChildren(diagramContainer);
      // Async render logic
      let retryCount = 0;
      const maxRetries = 3;
      
      const attemptRender = async () => {
        try {
          diagramContainer.textContent = code;
          await mermaid.run({
            nodes: [diagramContainer],
            suppressErrors: false
          });
          console.log('✅ Mermaid渲染成功');
        } catch (err) {
          if (retryCount < maxRetries) {
            retryCount++;
            console.warn(`🔄 重试渲染 (${retryCount}/${maxRetries})`);
            diagramContainer.innerHTML = '';
            await new Promise(resolve => setTimeout(resolve, 500 * retryCount));
            await attemptRender();
          } else {
            throw new Error(`Mermaid 렌더링 실패: ${err.message}`);
          }
        }
      };
      await attemptRender();
    },
    // Error handling
    showPreviewError(container, error) {
      container.classList.add('error');
      container.innerHTML = `
        <div class="error-alert">
          <i class="fa-solid fa-triangle-exclamation"></i>
          <div>
            <h4>미리보기 렌더링 실패</h4>
            <code>${error.message}</code>
          </div>
        </div>
      `;
    },
    // New method: detect unclosed code blocks
    hasUnclosedCodeBlock(parts) {
      return parts.some(p => p.type === 'code' && !p.closed);
    },

    splitCodeAndText(content) {
      const codeFenceRegex = /(```[\s\S]*?)(?:```|$)/g; // Modify the regex
      const parts = [];
      let lastIndex = 0;
      let hasUnclosed = false;

      // Handle the code block
      let match;
      while ((match = codeFenceRegex.exec(content)) !== null) {
        const textBefore = content.slice(lastIndex, match.index);
        if (textBefore) parts.push({ type: 'text', content: textBefore });

        // Determine whether it's closed
        const isClosed = match[0].endsWith('```');
        const codeContent = isClosed ? 
          match[0] : 
          match[0] + '\n```'; // Auto-complete the closing

        parts.push({
          type: 'code',
          content: codeContent,
          closed: isClosed
        });

        lastIndex = codeFenceRegex.lastIndex;
        hasUnclosed = !isClosed;
      }

      // Handle the remaining content
      const remaining = content.slice(lastIndex);
      if (remaining) {
        if (hasUnclosed) {
          // Treat the remaining content as a code block
          parts.push({
            type: 'code',
            content: remaining + '\n```',
            closed: false
          });
        } else {
          parts.push({ type: 'text', content: remaining });
        }
      }

      return parts;
    },
    initDownloadButtons() {
        document.body.addEventListener('click', async (e) => {
            const button = e.target.closest('.download-button');
            if (!button) return;
            const lang = button.dataset.lang;
            const codeBlock = button.closest('.code-block');
            const previewButton = codeBlock.querySelector('.preview-button');
            const existingPreview = codeBlock.querySelector('.preview-container.active');
            // If previewButton isn't in preview state, run the preview action
            if (!existingPreview) {
                // Trigger the preview button's click event
                previewButton.click();
                // Wait for the preview to finish
                await new Promise(resolve => setTimeout(resolve, 500)); // Adjust the delay as needed
            }
            const previewContainer = codeBlock.querySelector('.preview-container');
            try {
                if (lang === 'mermaid') {
                    // Use html2canvas to take the screenshot
                    html2canvas(previewContainer, {
                        // If the Mermaid chart panel has scrollbars, you may need to set width and height
                        width: previewContainer.offsetWidth,
                        height: previewContainer.offsetHeight,
                    }).then(canvas => {
                        canvas.toBlob(blob => {
                            this.triggerDownload(blob, 'mermaid-diagram.png');
                        });
                    }).catch(error => {
                        console.error('截图失败:', error);
                        showNotification(this.t('notifyScreenshotFailed'), 'error');
                    });
                }
                else if (lang === 'html') {
                    const iframe = previewContainer.querySelector('iframe');
                    const canvas = await html2canvas(iframe.contentDocument.body);
                    canvas.toBlob(blob => {
                        this.triggerDownload(blob, 'html-preview.png');
                    });
                }
            } catch (error) {
                console.error('下载失败:', error);
                showNotification(this.t('notifyDownloadFailedConsole'), 'error');
            }
        });
    },

    triggerDownload(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },
    
    handleCopy(event) {
      const button = event.target.closest('.copy-button')
      if (button) {
        const codeBlock = button.closest('.code-block')
        const codeContent = codeBlock?.querySelector('code')?.textContent || ''
        
        navigator.clipboard.writeText(codeContent).then(() => {
          showNotification(this.t('copy_success'))
        }).catch(() => {
          showNotification(this.t('copy_failed'), 'error')
        })
        
        event.stopPropagation()
        event.preventDefault()
      }
    },
    
    initCopyButtons() {
      // Remove the old ClipboardJS initialization code
      document.querySelectorAll('.copy-button').forEach(btn => {
        btn.removeEventListener('click', this.handleCopy)
        btn.addEventListener('click', this.handleCopy)
      })
    },  
    // Scroll to the latest message
    /* Determine whether the element is near the bottom */
    isElemNearBottom(el, threshold = 300) {
      if (!el) return true;               // If the element doesn't exist, default to 'needs to scroll to bottom'
      return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
    },

      /* ==========================================
       Scroll-region logic optimization (supports inner blocks following the scroll)
       ========================================== */
    scrollToBottom() {
      this.$nextTick(() => {
        const container = this.$refs.messagesContainer;
        if (container) {
          // 1. Scroll the outer main container
          if (this.isElemNearBottom(container) || this.isForceScrollToBottom) {
            container.scrollTop = container.scrollHeight;
          }
          
          // 2. Scroll the inner scrollable blocks (tool code blocks, thinking-process blocks)
          const innerBlocks = container.querySelectorAll('.sp-code, .type-reasoning .sp-content');
          innerBlocks.forEach(block => {
            if (block.scrollHeight > block.clientHeight) {
              // Reuse the isElemNearBottom check; if the user hasn't scrolled up on purpose, auto-stick to the bottom
              if (this.isElemNearBottom(block) || this.isForceScrollToBottom) {
                block.scrollTop = block.scrollHeight;
              }
            }
          });
        }
      });
      
      this.scrollPanelToBottom();
      // Compatible with your original approach
      if (typeof isElectron !== 'undefined' ? isElectron : this.isElectron) {
        this.browserPanelToBottom();
      }
    },

    /* Sidebar scroll */
    scrollPanelToBottom() {
      this.$nextTick(() => {
        const panel = this.$refs.messagesPanel;
        if (panel) {
          // 1. Scroll the sidebar's outer container
          if (this.isElemNearBottom(panel) || this.isForceScrollToBottom) {
            panel.scrollTop = panel.scrollHeight;
          }

          // 2. Scroll the sidebar's inner blocks
          const innerBlocks = panel.querySelectorAll('.sp-code, .type-reasoning .sp-content');
          innerBlocks.forEach(block => {
            if (block.scrollHeight > block.clientHeight) {
              if (this.isElemNearBottom(block) || this.isForceScrollToBottom) {
                block.scrollTop = block.scrollHeight;
              }
            }
          });
        }
      });
    },

    /* Standalone browser-panel scroll */
    browserPanelToBottom() {
      this.$nextTick(() => {
        const panel = this.$refs.browserMessagesContainer;
        if (panel) {
          // 1. Scroll the standalone panel's outer container
          if (this.isElemNearBottom(panel) || this.isForceScrollToBottom) {
            panel.scrollTop = panel.scrollHeight;
          }

          // 2. Scroll the standalone panel's inner blocks
          const innerBlocks = panel.querySelectorAll('.sp-code, .type-reasoning .sp-content');
          innerBlocks.forEach(block => {
            if (block.scrollHeight > block.clientHeight) {
              if (this.isElemNearBottom(block) || this.isForceScrollToBottom) {
                block.scrollTop = block.scrollHeight;
              }
            }
          });
        }
      });
    },
    changeMainAgent(agent) {
      this.mainAgent = agent;
      if (agent === 'super-model') {
        this.system_prompt = " "
      }
      else {
        this.system_prompt = this.agents[agent].system_prompt;
        console.log(this.system_prompt);
      }
      this.syncSystemPromptToMessages(this.system_prompt);
    },
    // WebSocket-related
    initWebSocket() {
      const http_protocol = window.location.protocol;
      const ws_protocol = http_protocol === 'https:' ? 'wss:' : 'ws:';
      const ws_url = `${ws_protocol}//${window.location.host}/ws`;

      this.ws = new WebSocket(ws_url);

      // Set the heartbeat and reconnect intervals (in milliseconds)
      const HEARTBEAT_INTERVAL = 10000; // Send a ping every 10 seconds
      const RECONNECT_INTERVAL = 5000;  // After disconnect, try to reconnect every 5 seconds

      let heartbeatTimer = null;
      let reconnectTimer = null;

      const startHeartbeat = () => {
        heartbeatTimer = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
              this.ws.send(JSON.stringify({ type: 'ping' })); // Send a heartbeat packet
            } catch (e) {
              console.error('Failed to send ping:', e);
            }
          }
        }, HEARTBEAT_INTERVAL);
      };

      const stopHeartbeat = () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      };

      const scheduleReconnect = () => {
        stopHeartbeat();
        if (!reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            console.log('Reconnecting WebSocket...');
            this.initWebSocket(); // Re-initialize
            reconnectTimer = null;
          }, RECONNECT_INTERVAL);
        }
      };

      // WebSocket open event
      this.ws.onopen = () => {
        console.log('WebSocket connection established');
        stopHeartbeat(); // Prevent duplicate heartbeats
        startHeartbeat();
      };

      // Receive a message
      this.ws.onmessage = async (event) => {
        let data;
        try {
          data = JSON.parse(event.data);
        } catch (e) {
          console.log('Message from server:', event.data);
          return;
        }

      if (data.type === 'pong') {
        // You can handle the pong reply here, e.g. record status
        console.log('Received pong from server.');
      } 
      else if (data.type === 'behavior') {
          this.behaviorSettings = data.data.behaviorSettings || this.behaviorSettings;
          this.autoSaveSettings();
      }
      else if (data.type === 'settings_update') {
          this.settings = {
            model: data.data.model || '',
            base_url: data.data.base_url || '',
            api_key: data.data.api_key || '',
            temperature: data.data.temperature || 0.7,
            max_tokens: data.data.max_tokens || 4096,
            max_rounds: data.data.max_rounds || 0,
            selectedProvider: data.data.selectedProvider || '',
            top_p: data.data.top_p || 1,
            reasoning_effort: data.data.reasoning_effort || null,
            enableOmniTTS: data.data.enableOmniTTS || false,
            omniVoice: data.data.omniVoice || 'Cherry',
            extra_params: data.data.extra_params || [],
          };
          this.discordBotConfig = data.data.discordBotConfig || this.discordBotConfig;
          this.telegramBotConfig = data.data.telegramBotConfig || this.telegramBotConfig;
          this.slackBotConfig = data.data.slackBotConfig || this.slackBotConfig;
          this.targetLangSelected = data.data.targetLangSelected || this.targetLangSelected;
          this.BotConfig = data.data.BotConfig || this.BotConfig;
          this.liveConfig = data.data.liveConfig || this.liveConfig;
          this.stickerPacks = data.data.stickerPacks || this.stickerPacks;
          this.toolsSettings = data.data.tools || this.toolsSettings;
          this.llmTools = data.data.llmTools || this.llmTools;
          this.reasonerSettings = data.data.reasoner || this.reasonerSettings;
          this.fastSettings = data.data.fast || this.fastSettings;
          this.visionSettings = data.data.vision || this.visionSettings;
          this.webSearchSettings = data.data.webSearch || this.webSearchSettings;
          this.codeSettings = data.data.codeSettings || this.codeSettings;
          this.CLISettings = data.data.CLISettings || this.CLISettings;
          this.acpSettings = data.data.acpSettings || this.acpSettings;
          this.visionControlSettings = data.data.visionControlSettings || this.visionControlSettings;
          this.loveSettings = data.data.loveSettings || this.loveSettings;
          this.ccSettings = data.data.ccSettings || this.ccSettings;
          this.qcSettings = data.data.qcSettings || this.qcSettings;
          this.dsSettings = data.data.dsSettings || this.dsSettings;
          this.localEnvSettings = data.data.localEnvSettings || this.localEnvSettings;
          this.ocSettings = data.data.ocSettings || this.ocSettings;
          this.HASettings = data.data.HASettings || this.HASettings;
          this.chromeMCPSettings = data.data.chromeMCPSettings || this.chromeMCPSettings;
          this.sqlSettings = data.data.sqlSettings || this.sqlSettings;
          this.KBSettings = data.data.KBSettings || this.KBSettings;
          this.mcpServers = data.data.mcpServers || this.mcpServers;
          this.a2aServers = data.data.a2aServers || this.a2aServers;
          this.memories = data.data.memories || this.memories;
          this.memorySettings = data.data.memorySettings || this.memorySettings;
          this.text2imgSettings = data.data.text2imgSettings || this.text2imgSettings;
          this.ttsSettings = data.data.ttsSettings || this.ttsSettings;
          this.behaviorSettings = data.data.behaviorSettings || this.behaviorSettings;
          this.VRMConfig = data.data.VRMConfig || this.VRMConfig;
          this.worldConfig = { ...this.worldConfig, ...(data.data.worldConfig || {}) };
          this.comfyuiServers = data.data.comfyuiServers || this.comfyuiServers;
          this.comfyuiAPIkey = data.data.comfyuiAPIkey || this.comfyuiAPIkey;
          this.workflows = data.data.workflows || this.workflows;
          this.customHttpTools = data.data.custom_http || this.customHttpTools;
      }
      else if (data.type === 'settings') {
          this.ensureConversationGroups();
          this.isdocker = data.data.isdocker || false;
          this.settings = {
            model: data.data.model || '',
            base_url: data.data.base_url || '',
            api_key: data.data.api_key || '',
            temperature: data.data.temperature || 0.7,
            max_tokens: data.data.max_tokens || 4096,
            max_rounds: data.data.max_rounds || 0,
            selectedProvider: data.data.selectedProvider || '',
            top_p: data.data.top_p || 1,
            reasoning_effort: data.data.reasoning_effort || null,
            enableOmniTTS: data.data.enableOmniTTS || false,
            omniVoice: data.data.omniVoice || 'Cherry',
            extra_params: data.data.extra_params || [],
          };
          this.isBtnCollapse = data.data.isBtnCollapse || false;
          this.showHistorySidebar = data.data.showHistorySidebar || false;
          this.system_prompt = data.data.system_prompt || '';
          this.SystemPromptsList = data.data.SystemPromptsList || [];
          this.conversations = data.data.conversations || this.conversations;
          this.conversationGroups = data.data.conversationGroups || this.conversationGroups;
          this.conversationId = data.data.conversationId || this.conversationId;
          this.agents = data.data.agents || this.agents;
          this.mainAgent = data.data.mainAgent || this.mainAgent;
          this.discordBotConfig = data.data.discordBotConfig || this.discordBotConfig;
          this.telegramBotConfig = data.data.telegramBotConfig || this.telegramBotConfig;
          this.slackBotConfig = data.data.slackBotConfig || this.slackBotConfig;
          this.targetLangSelected = data.data.targetLangSelected || this.targetLangSelected;
          this.allBriefly = data.data.allBriefly || this.allBriefly;
          this.isForceScrollToBottom = data.data.isForceScrollToBottom || this.isForceScrollToBottom;
          this.BotConfig = data.data.BotConfig || this.BotConfig;
          this.liveConfig = data.data.liveConfig || this.liveConfig;
          this.stickerPacks = data.data.stickerPacks || this.stickerPacks;
          this.toolsSettings = data.data.tools || this.toolsSettings;
          this.llmTools = data.data.llmTools || this.llmTools;
          this.reasonerSettings = data.data.reasoner || this.reasonerSettings;
          this.fastSettings = data.data.fast || this.fastSettings;
          this.visionSettings = data.data.vision || this.visionSettings;
          this.webSearchSettings = data.data.webSearch || this.webSearchSettings;
          this.codeSettings = data.data.codeSettings || this.codeSettings;
          this.CLISettings = data.data.CLISettings || this.CLISettings;
          this.acpSettings = data.data.acpSettings || this.acpSettings;
          this.visionControlSettings = data.data.visionControlSettings || this.visionControlSettings;
          this.loveSettings = data.data.loveSettings || this.loveSettings;
          this.ccSettings = data.data.ccSettings || this.ccSettings;
          this.qcSettings = data.data.qcSettings || this.qcSettings;
          this.dsSettings = data.data.dsSettings || this.dsSettings;
          this.localEnvSettings = data.data.localEnvSettings || this.localEnvSettings;
          this.ocSettings = data.data.ocSettings || this.ocSettings;
          this.HASettings = data.data.HASettings || this.HASettings;
          this.chromeMCPSettings = data.data.chromeMCPSettings || this.chromeMCPSettings;
          this.sqlSettings = data.data.sqlSettings || this.sqlSettings;
          this.KBSettings = data.data.KBSettings || this.KBSettings;
          this.textFiles = data.data.textFiles || this.textFiles;
          this.imageFiles = data.data.imageFiles || this.imageFiles;
          this.videoFiles = data.data.videoFiles || this.videoFiles;
          this.knowledgeBases = data.data.knowledgeBases || this.knowledgeBases;
          this.modelProviders = data.data.modelProviders || this.modelProviders;
          this.systemSettings = data.data.systemSettings || this.systemSettings;
          if (this.systemSettings && (this.systemSettings.fontScale === undefined || this.systemSettings.fontScale === null)) {
            this.systemSettings.fontScale = 1;
          }
          if (this.systemSettings && (this.systemSettings.codeFontScale === undefined || this.systemSettings.codeFontScale === null)) {
            this.systemSettings.codeFontScale = 1;
          }
          if (this.systemSettings && (this.systemSettings.autoCollapseInput === undefined || this.systemSettings.autoCollapseInput === null)) {
            this.systemSettings.autoCollapseInput = false;
          }
          this.showBrowserChat = data.data.showBrowserChat || this.showBrowserChat;
          this.searchEngine = data.data.searchEngine || this.searchEngine;
          if (data.data.largeMoreButtonDict) {
            this.largeMoreButtonDict = this.largeMoreButtonDict.map(existingButton => {
              const newButton = data.data.largeMoreButtonDict.find(button => button.name === existingButton.name);
              if (newButton) {
                return { ...existingButton, enabled: newButton.enabled };
              }
              return existingButton;
            });
          }
          if (data.data.smallMoreButtonDict) {
            this.smallMoreButtonDict = this.smallMoreButtonDict.map(existingButton => {
              const newButton = data.data.smallMoreButtonDict.find(button => button.name === existingButton.name);
              if (newButton) {
                return { ...existingButton, enabled: newButton.enabled };
              }
              return existingButton;
            });
          }
          this.loadConversation(this.conversationId);
          this.currentLanguage = data.data.currentLanguage || this.currentLanguage;
          this.mcpServers = data.data.mcpServers || this.mcpServers;
          this.a2aServers = data.data.a2aServers || this.a2aServers;
          this.memories = data.data.memories || this.memories;
          this.memorySettings = data.data.memorySettings || this.memorySettings;
          this.text2imgSettings = data.data.text2imgSettings || this.text2imgSettings;
          this.asrSettings = data.data.asrSettings || this.asrSettings;
          this.ttsSettings = data.data.ttsSettings || this.ttsSettings;
          this.behaviorSettings = data.data.behaviorSettings || this.behaviorSettings;
          this.VRMConfig = data.data.VRMConfig || this.VRMConfig;
          this.worldConfig = { ...this.worldConfig, ...(data.data.worldConfig || {}) };
          this.comfyuiServers = data.data.comfyuiServers || this.comfyuiServers;
          this.comfyuiAPIkey = data.data.comfyuiAPIkey || this.comfyuiAPIkey;
          this.workflows = data.data.workflows || this.workflows;
          this.customHttpTools = data.data.custom_http || this.customHttpTools;
          this.isGroupMode = data.data.isGroupMode || this.isGroupMode;
          this.selectedGroupAgents = data.data.selectedGroupAgents || this.selectedGroupAgents;
          // Ensure data consistency on init
          this.edgettsLanguage = this.ttsSettings.edgettsLanguage;
          this.edgettsGender = this.ttsSettings.edgettsGender;
          this.handleSystemLanguageChange(this.systemSettings.language);
          this.refreshButtonText = this.t('refreshList');
          if (this.HASettings.enabled) {
            this.changeHAEnabled();
          };
          await this.initChromeMCPSettings();
          if (this.chromeMCPSettings.enabled){
            this.changeChromeMCPEnabled();
          }
          if (this.sqlSettings.enabled){
            this.changeSqlEnabled();
          }
          this.changeMemory();
          // change this.target_lang to navigator.language || navigator.userLanguage;
          this.target_lang = this.targetLangSelected!="system"? this.targetLangSelected: navigator.language || navigator.userLanguage || 'zh-CN';
          this.loadDefaultModels();
          this.loadDefaultMotions();
          this.loadGaussScenes();
          this.checkMobile();
          this.checkTelegramBotStatus();
          this.checkDiscordBotStatus();
          this.checkLiveStatus();
          this.fetchRemotePlugins();
          this.fetchSkills();
          this.fetchTetosVoices(this.ttsSettings.engine);
          if (this.asrSettings.enabled && this.asrSettings.interactionMethod != 'globalKeyTriggered' && this.asrSettings.interactionMethod != 'keyTriggered') {
            this.startASR();
          }
          if (this.activeMenu === 'home') this.startDriverGuide();
        } 
          // Add inside the onmessage logic of initWebSocket()
          else if (data.type === 'task_notification') {
              // Trigger the frontend popup notification
              showNotification(`${data.data.title}\n${this.t('intask')}`, 'success');
          }
        else if (data.type === 'settings_saved') {
          if (!data.success) {
            showNotification(this.t('settings_save_failed'), 'error');
          }
        }
        // New: handle user-input updates
        else if (data.type === 'update_user_input') {
          this.userInput = data.data.text;
        }
        // Update or add the prompt
        else if (data.type === 'update_system_prompt') {
            const id = data.data.id;
            const text = data.data.text;
            this.extensionsSystemPromptsDict[id] = text; 
        }
        
        // Remove the prompt (corresponds to the backend's finally logic)
        else if (data.type === 'remove_system_prompt') {
            const id = data.data.id;
            
            if (this.extensionsSystemPromptsDict[id]) {
                delete this.extensionsSystemPromptsDict[id];
            }
        }
        // New: handle tool input
        else if (data.type === 'update_tool_input') {
          this.userInput = data.data.text;
          this.sendMessage(role = 'system')
        }
        // New: handle TTS input
        else if (data.type === 'start_tts') {
          this.readConfig.longText = data.data.text;
          // Wait 0.5s
          setTimeout(() => {
            this.startRead();
          }, 500);
        }
        // New: stop TTS
        else if (data.type === 'stop_tts') {
          this.stopTTSActivities();
          this.readConfig.longText = '';
        }
        // New: handle closing the extension sidebar
        else if (data.type === 'trigger_close_extension') {
          console.log('关闭侧边栏')
          this.resetToDefaultView();
        }
        // New: handle the send-message trigger
        else if (data.type === 'trigger_send_message') {
          this.sendMessage();
        }
        // New: clear the message list
        else if (data.type === "trigger_clear_message" ){
          this.clearMessages();
        }
        // New: respond to the request-messages event
        else if (data.type === 'request_messages') {
          // Send the current message list to the requester
          this.sendMessagesToExtension();
        }
      };

      // WebSocket close event
      this.ws.onclose = (event) => {
        console.log('WebSocket connection closed:', event.reason);
        stopHeartbeat();
        scheduleReconnect();
      };

      // WebSocket error event
      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.ws.close(); // Actively close the connection to trigger the onclose event
      };
    },

   async updateGlobalShortcut() {
      if (this.asrSettings.interactionMethod === 'globalKeyTriggered' || this.asrSettings.interactionMethod === 'keyTriggered'){
        this.stopASR();
      }else if (this.asrSettings.enabled){
        await this.startASR();
      }

      if (!window.electronAPI?.unregisterGlobalShortcut) return;
      
      // Before each update, unregister the old one first
      await window.electronAPI.unregisterGlobalShortcut();

      // If ASR is enabled and in global-shortcut mode
      if (this.asrSettings.interactionMethod === 'globalKeyTriggered') {
        const globalKeyCombo = this.getGlobalAccelerator(this.asrSettings.hotkey);
        
        const success = await window.electronAPI.registerGlobalShortcut(globalKeyCombo);
        if (!success) {
          this.$message.error(`${this.t('shortcutRegisterFailedPrefix')}${globalKeyCombo}${this.t('shortcutRegisterFailedSuffix')}`);
        } else {
          console.log(`全局快捷键已更新为: ${globalKeyCombo}`);
        }
      }
    },

    // [New] convert your single key into Electron's accelerator format
    getGlobalAccelerator(localKey) {
      if (localKey === 'Alt') return 'Alt+Space';
      if (localKey === 'Control') return 'Control+Space';
      if (localKey === 'Shift') return 'Shift+Space';
      return 'Alt+Space'; // Default fallback
    },

    // [Changed] keydown event (handles only the local keyTriggered)
    async handleKeyDown(event) {
      if (event?.repeat) return; 
      if (event.isComposing || event.keyCode === 229) return;

      // ====== Local mode (push-to-talk) ======
      if (this.asrSettings.interactionMethod === "keyTriggered") {
        // If the pressed key strictly matches the configured key (e.g. 'Alt' === 'Alt')
        if (event.key === this.asrSettings.hotkey) {
          event.preventDefault(); 
          await this.handlePttPress(event); // Start recording
          return; 
        }
      }

      // -- Below is your original playback-control and enter-to-send logic, unchanged --
      if (event.code === 'Space' && event.shiftKey) {
        event.preventDefault();
        if (this.readState.ttsChunks.length > 0 && !this.readState.isPlaying) {
          this.playNextSegmentOnce();
        }
        return;
      }
      
      const isTextArea = event.target.tagName === 'TEXTAREA';
      if (event.key === 'Enter' && (this.activeMenu === 'home' || this.activeMenu ==='ai-browser')) {
        if (isTextArea) {
            if (event.shiftKey) {
              return;
            } else {
              event.preventDefault();
              await this.sendMessage();
            }
        }
      }

      if (event.key === 'Enter' && this.activeMenu ==='dashboard') {
            if (event.shiftKey) {
              return;
            } else {
              event.preventDefault();
              this.handleDashboardSend();
            }
      }
    },

    // [Changed] keyup event (handles only the local keyTriggered)
    async handleKeyUp(event) {
      if (event?.repeat) return;

      // ====== Local mode (release to end) ======
      if (this.asrSettings.interactionMethod === "keyTriggered") {
        if (event.key === this.asrSettings.hotkey) {
          event.preventDefault();
          await this.handlePttRelease(event); // Stop recording
          return;
        }
      }  
    },
    escapeHtml(unsafe) {
      return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    },  
    // New: send the current message list to all connected clients
    sendMessagesToExtension() {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({
            type: 'broadcast_messages',
            data: {
              messages: this.messages,
              conversationId: this.conversationId
            }
          }));
        } catch (e) {
          console.error('Failed to send messages to extension:', e);
        }
      }
    },
    async syncSystemPromptToMessages(newPrompt) {
      // Case 1: the new prompt is empty
      if (!newPrompt) {
        if (this.messages.length > 0 && this.messages[0].role === 'system') {
          this.messages.splice(0, 1); // Delete the system message
        }
        return;
      }
  
      // Case 2: a system message already exists
      if (this.messages[0]?.role === 'system') {
        // Update the system message content
        this.messages[0].content = newPrompt;
        console.log('Updated system message:', this.messages[0]);
        return;
      }
  
      // Case 3: there is no system message
      this.messages.unshift({
        id: Date.now() + Math.random(), // Add a unique ID
        role: 'system',
        content: newPrompt
      });
      console.log('Added system message:', this.messages[0]);
      await this.autoSaveSettings();
    },


    // Sensitive-path detection function
    isDangerousPath(path) {
        if (!path) return false;

        // 1. Normalize the path: unify slashes, lowercase, strip trailing slash
        let normalized = path.trim().replace(/\\/g, '/').toLowerCase();
        if (normalized.length > 1 && normalized.endsWith('/')) {
            normalized = normalized.slice(0, -1);
        }

        // --- A. Absolutely forbidden disk/system root directories ---
        // Matches: "c:", "d:", "/"
        const winRootRegex = /^[a-z]:$/;
        if (winRootRegex.test(normalized) || normalized === '/' || normalized === '') {
            return true; 
        }

        // --- B. Forbid the directory itself but allow its subdirectories (user containers) ---
        // e.g. forbid selecting "C:/Users" but allow "C:/Users/YourName/Documents"
        const userContainers = [
            'c:/users',
            '/users',
            '/home'
        ];
        if (userContainers.includes(normalized)) {
            return true;
        }

        // --- C. Forbid this directory and all its subdirectories (system core) ---
        // The local engine should never be allowed to run in these places
        const strictSystemPaths = [
            'c:/windows',
            'c:/program files',
            'c:/program files (x86)',
            'c:/boot',
            'c:/recovery',
            'c:/system volume information',
            '/bin', '/boot', '/dev', '/etc', '/lib', '/lib64', '/proc', 
            '/root', '/run', '/sbin', '/sys', '/usr', '/var', '/opt',
            '/system', '/library', '/volumes'
        ];

        return strictSystemPaths.some(prefix => {
            // Only intercept when matching a system-core directory or its subpaths
            return normalized === prefix || normalized.startsWith(prefix + '/');
        });
    },

    // ==========================================
    // 1. User-action entry and dispatch function (drop-in replaceable)
    // ==========================================
    async sendMessage(role = 'user') { 
        // Basic validation
        if (!this.userInput.trim() && (!this.files || this.files.length === 0) && (!this.images || this.images.length === 0)) return;
        if (this.isTyping) return;
        if (this.CLISettings.enabled) {
            const pathToCheck = this.CLISettings.cc_path;

            if (this.isDangerousPath(pathToCheck)) {
                showNotification(
                    this.t('dangerous_path_detected'),
                    'error',
                );
                return; // Return directly; don't run the subsequent logic
            }

            // If validation passes, continue...
        }
        // [V2 new]: switch the menu
        if (this.activeMenu === 'dashboard'){
          this.activeMenu = 'home'
        }

        // Handle TTS/Read interruption
        if (this.readState.isPlaying && this.ttsSettings.enabled) { 
            if (this.isReadRunning){
                this.pauseRead();
            } else {
                this.stopSegmentTTS(isEnd=false);
            }
            this.isReadInterruption = true;
        }

        if (this.currentAudio){
            this.currentAudio.pause();
            this.currentAudio = null;
        }
        this.stopAllAudioPlayback();
        this.TTSrunning = false;

        if ((this.vrmOnline || this.vtsOnline) && this.ttsWebSocket) {
            this.ttsWebSocket.send(JSON.stringify({ type: 'ttsStarted', data: {} }));
        }

        this.isTyping = true;
        this.startTimer();

        if (typeof this.sendTTSStatusToVRM === 'function') {
            this.sendTTSStatusToVRM('ttsStarted', {});
        }

      let captureFlag = false;
      if (this.isElectron && this.visionSettings?.desktopVision) {
          if (this.visionSettings.enableWakeWord && this.visionSettings.wakeWord) {
              const wakeWords = this.visionSettings.wakeWord.split('\n');
              if (wakeWords.some(word => this.userInput.includes(word.trim()))) {
                  captureFlag = true;
              }
          } else {
              captureFlag = true;
          }
      }

        // --- File-upload handling ---
        const userInput = this.userInput.trim();
        let fileLinks = this.files || [];
        
        if (fileLinks.length > 0){
            const formData = new FormData();
            for (const file of fileLinks) {
                if (file.file instanceof Blob) { 
                    formData.append('files', file.file, file.name);
                }
            }
            try {
                const response = await fetch(`/load_file`, { method: 'POST', body: formData });
                const data = await response.json();
                if (data.success) {
                    fileLinks = data.fileLinks;
                    this.textFiles = [...this.textFiles, ...data.textFiles];
                }
            } catch (error) { console.error(error); }
        }

        let imageLinks = this.images || [];
        if (imageLinks.length > 0){
            const formData = new FormData();
              for (const file of imageLinks) {
                  if (file.file instanceof Blob) { 
                      formData.append('files', file.file, file.name , file.detectedType); // [V2 new]: detectedType
                  } 
              }
              try {
                  const response = await fetch(`/load_file`, { method: 'POST', body: formData });
                  const data = await response.json();
                  if (data.success) {
                    imageLinks = data.fileLinks;
                    this.imageFiles = [...this.imageFiles, ...data.imageFiles];
                    if(data.vedioFiles) { // [V2 new]: video support
                        this.vedioFiles = [...(this.vedioFiles || []), ...data.vedioFiles];
                    }
                  }
              } catch (error) { console.error(error); }
        }

        // --- Core fix: ensure this.fileLinks is an array ---
        if (!Array.isArray(this.fileLinks)) {
            this.fileLinks = []; 
        }

        // Build the file-links string
        const fileLinks_content = fileLinks.map(fileLink => `\n[파일명: ${fileLink.name}\n파일 링크: ${fileLink.path}]`).join('\n') || '';
        const fileLinks_list = Array.isArray(fileLinks) ? fileLinks.map(fileLink => fileLink.path).flat() : []
        this.fileLinks = this.fileLinks.concat(fileLinks_list)

        // --- Push the user message to the UI ---
        this.messages.push({
            id: Date.now() + Math.random(),
            role: role,
            content: userInput,
            fileLinks: fileLinks,
            fileLinks_content: fileLinks_content,
            imageLinks: imageLinks || [],
            hasDesktopVision: captureFlag, // New flag: tell the UI this message triggered a backend screenshot
            agentName: this.memorySettings.userName || 'User' 
        });

        this.sendMessagesToExtension();
        this.files = [];
        this.images = [];
        this.userInput = '';
        
        this.$nextTick(() => { this.requestScrollToBottom(); });

        // --- Dispatch logic: group chat vs single chat ---
        this.isSending = true; 
        this.abortController = new AbortController(); 

        try {
                if (this.isGroupMode && this.selectedGroupAgents && this.selectedGroupAgents.length > 0) {
                    // == Group-chat mode: random serial invocation ==
                    
                    // Create a copy and shuffle randomly (Fisher-Yates shuffle)
                    let executionList = [...this.selectedGroupAgents];
                    for (let i = executionList.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [executionList[i], executionList[j]] = [executionList[j], executionList[i]];
                    }

                    // Iterate the shuffled list
                    for (const targetId of executionList) {
                        if (this.abortController.signal.aborted) break;

                        let agentDisplayName = "Unknown";
                        
                        // Resolve the display name
                        if (targetId.startsWith('memory/')) {
                            const memId = targetId.split('/')[1];
                            const memRecord = this.memories.find(m => String(m.id) === String(memId));
                            agentDisplayName = memRecord ? memRecord.name : "Role";
                        } else if (targetId === 'super-model') {
                            agentDisplayName = this.t('defaultAgent');
                        } else if (this.agents[targetId]) {
                            agentDisplayName = this.agents[targetId].name;
                        }

                        // Call the generation function
                        await this.generateAIResponse(targetId, agentDisplayName);
                    }
                } else {
                // == Single-chat mode ==
                let currentName = 'Assistant';
                if (this.mainAgent === 'super-model') currentName = this.t('defaultAgent');
                else if (this.agents[this.mainAgent]) currentName = this.agents[this.mainAgent].name;

                await this.generateAIResponse(this.mainAgent, currentName);
            }
        } catch (e) {
            console.error("Chat dispatch error:", e);
        } finally {
            this.isTyping = false;
            this.isSending = false;
            this.abortController = null;
            await this.autoSaveSettings();
            await this.saveConversations();
        }
    },


    // ==========================================
    // 2. AI generation and streaming-handler function (supports human-in-the-loop approval)
    // ==========================================
    async generateAIResponse(targetAgentId, agentDisplayName = null, isResume = false) {

        if (!isResume && !this.ttsSettings.enabled && (this.vrmOnline || this.vtsOnline) && this.ttsWebSocket) {
            this.sendTTSStatusToVRM('ttsStarted', {});
        }

        this.startTimer();
        this.voiceStack = ['default'];
        let tts_buffer = '';
        let isCodeBlock = false;
        this.cur_voice = 'default';

        const toolCallStack = [];
        this.toolArgsAccumulator = this.toolArgsAccumulator || {};

        // Inner function: prepare the message history to send to the API (unchanged)
        const prepareMessages = (msgs) => {
            const rawMessages = msgs.flatMap(msg => {
                const userName = this.memorySettings?.userName || 'User';

                // --- 1. Handle human-user / group-chat messages ---
                if (this.isGroupMode && (msg.role === 'user' || (msg.role === 'assistant' && msg.agentName !== agentDisplayName))) {
                    let textContent = (msg.pure_content ?? msg.content) + (msg.fileLinks_content ?? '');
                    const prefix = msg.role === 'user' ? userName : msg.agentName;
                    const finalContent = `${prefix}: ${textContent}`;

                    if (msg.imageLinks && msg.imageLinks.length > 0) {
                        const contentArray = [{ type: "text", text: finalContent }];
                        msg.imageLinks.forEach(imageLink => {
                            const ext = imageLink.path.split('.').pop().toLowerCase();
                            const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'avi'];
                            if (videoExts.includes(ext)) {
                                contentArray.push({ type: "video_url", video_url: { url: imageLink.path } });
                            } else {
                                contentArray.push({ type: "image_url", image_url: { url: imageLink.path } });
                            }
                        });
                        return [{ role: 'user', content: contentArray }];
                    } else {
                        return [{ role: 'user', content: finalContent }];
                    }
                }

                if (msg.role === 'assistant' && msg.backend_content && msg.backend_content.length > 0) {
                    return msg.backend_content.filter(m => 
                        (m.content && String(m.content).trim() !== '') || 
                        (m.tool_calls && m.tool_calls.length > 0) || 
                        m.role === 'tool'
                    );
                }
                
                let apiRole = msg.role === 'system' ? 'system' : (msg.role === 'assistant' ? 'assistant' : 'user');
                let textContent = (msg.pure_content ?? msg.content) + (msg.fileLinks_content ?? '');
                
                // --- 2. Handle single-chat / regular messages ---
                if (msg.imageLinks && msg.imageLinks.length > 0) {
                    const contentArray = [{ type: "text", text: textContent }];
                    msg.imageLinks.forEach(imageLink => {
                        const ext = imageLink.path.split('.').pop().toLowerCase();
                        const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'avi'];
                        if (videoExts.includes(ext)) {
                            contentArray.push({ type: "video_url", video_url: { url: imageLink.path } });
                        } else {
                            contentArray.push({ type: "image_url", image_url: { url: imageLink.path } });
                        }
                    });
                    return [{ role: apiRole, content: contentArray }];
                } else {
                    return [{ role: apiRole, content: textContent }];
                }
            });

            const sanitized =[];
            for (let i = 0; i < rawMessages.length; i++) {
                const current = rawMessages[i];
                if (current.role === 'tool') {
                    let prev = sanitized.length > 0 ? sanitized[sanitized.length - 1] : null;
                    if (!prev || prev.role !== 'assistant') {
                        prev = { role: 'assistant', content: null, tool_calls:[] };
                        sanitized.push(prev);
                    }
                    if (!prev.tool_calls) prev.tool_calls =[];
                    
                    const safeToolCallId = current.tool_call_id || `call_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                    current.tool_call_id = safeToolCallId;

                    const hasMatchingId = prev.tool_calls.some(tc => tc.id === safeToolCallId);
                    if (!hasMatchingId) {
                        prev.tool_calls.push({
                            id: safeToolCallId,
                            type: 'function',
                            function: { name: current.name || 'unknown_tool', arguments: "{}" }
                        });
                    }
                }
                sanitized.push(current);
            }
            return sanitized;
        };

        // Step 1: build the payload
        let messagesPayload = prepareMessages(this.messages);
        if (this.extensionsSystemPromptsDict) {
            const combinedPrompt = Object.values(this.extensionsSystemPromptsDict).filter(Boolean).join('\n\n');
            if (messagesPayload[0]?.role === 'system') messagesPayload[0].content += '\n\n' + combinedPrompt;
            else messagesPayload.unshift({ role: 'system', content: combinedPrompt });
        }

        let currentMsg;
        let shouldSyncGroupMemory = false;
        if (isResume && this.messages.length > 0) {
            currentMsg = this.messages[this.messages.length - 1];
            currentMsg.generationFinished = false;
        } else {
            const newMsgData = {
                id: Date.now() + Math.random(),
                role: 'assistant',
                agentName: agentDisplayName,
                content: '',         // HTML is no longer used; it'll be cleared at the end
                pure_content: '',
                backend_content: [{ role: 'assistant', content: '' }],
                toolBlocks: {},
                displayBlocks: [],
                isOmni: this.settings.enableOmniTTS || this.fastSettings.enableOmniTTS,
                omniAudioChunks: [], ttsChunks: [], chunks_voice: [], audioChunks: [],
                isPlaying: false, total_tokens: 0, first_token_latency: 0, elapsedTime: 0,
                generationFinished: false
            };
            this.messages.push(newMsgData);
            currentMsg = this.messages[this.messages.length - 1];
        }
        const latestUserMessage = [...this.messages].reverse().find(msg => msg.role === 'user');

        // Helper to get a block (with freezing, supports streaming reuse)
        const getBlock = (type, id = null, name = null) => {
            if (!currentMsg.displayBlocks) currentMsg.displayBlocks = [];
            const blocks = currentMsg.displayBlocks;
           
            while (blocks.length > 0 && Object.isFrozen(blocks[0]) && blocks.length >= MAX_RENDERED_BLOCKS) {
                blocks.shift();
            }

            // If there's an id, look up an existing block first (e.g. tool_call / tool_result reuse)
            if (id) {
                const existing = blocks.find(b => b.type === type && b.id === id);
                if (existing) {
                    if (name && !existing.name) existing.name = name;
                    return existing;
                }
            }
            
            // Check whether the last block is reusable (same type and not frozen)
            const last = blocks[blocks.length - 1];
            const canReuse = last && last.type === type && !Object.isFrozen(last) && (!id || last.id === id);
            if (canReuse) {
                if (name && !last.name) last.name = name;
                return last;
            }
            
            // Not reusable: freeze the previous different-type block first (detach it from reactivity)
            if (last && !Object.isFrozen(last)) {
                Object.freeze(last);
                if (typeof last.content === 'string') Object.freeze(last.content);
                if (typeof last.args === 'string') Object.freeze(last.args);
                if (last.data) Object.freeze(last.data);
            }
            
            // Create a new block and push it into the array
            const newBlock = { type, id, name, content: '', args: '', data: null };
            blocks.push(newBlock);
            return newBlock;
        };

        this.$nextTick(() => { this.requestScrollToBottom(); });

        let audioResolve = null;
        let audioProcess = null;
        const audioPromise = new Promise((resolve) => { audioResolve = resolve; });
        if (this.ttsSettings.enabled) {
            this.startTTSProcess(currentMsg);
            this.startAudioPlayProcess(currentMsg, audioResolve);
            audioProcess = audioPromise;
        }

        const escapeHtml = (text) => {
            if (!text) return '';
            return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        };

        try {
            const response = await fetch(`/v1/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: targetAgentId,
                    messages: messagesPayload,
                    stream: true,
                    fileLinks: this.fileLinks,
                    asyncToolsID: this.asyncToolsID || [],
                    reasoning_effort: this.reasoning_effort,
                    conversation_id: this.stringifyEntityId(this.conversationId),
                    group_id: this.stringifyEntityId(this.activeConversationGroupId || this.draftConversationGroupId || 'default'),
                    user_message_id: this.stringifyEntityId(latestUserMessage?.id || null),
                }),
                signal: this.abortController.signal
            });

            if (!response.ok) {
                let errText = await response.text();
                try { const errObj = JSON.parse(errText); errText = errObj.error?.message || errText; } catch (e) { }
                throw new Error(errText);
            }

            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                let errText = await response.text();
                try { const errObj = JSON.parse(errText); errText = errObj.error?.message || errText; } catch (e) { }
                throw new Error(errText);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            // Initialize the streaming-text batch-update state
            this._streamTargetMsg = currentMsg;
            this._streamTextBuffer = '';
            this.first_token = true;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                while (buffer.includes('\n\n')) {
                    const eventEndIndex = buffer.indexOf('\n\n');
                    const eventData = buffer.slice(0, eventEndIndex);
                    buffer = buffer.slice(eventEndIndex + 2);

                    if (eventData.startsWith('data: ')) {
                        const jsonStr = eventData.slice(6).trim();
                        if (jsonStr === '[DONE]') break;
                        const parsed = JSON.parse(jsonStr);
                        const delta = parsed.choices?.[0]?.delta;
                        if (!delta) continue;

                        if (this.first_token && !isResume) {
                            this.first_token = false;
                            this.stopTimer();
                            currentMsg.first_token_latency = this.elapsedTime;
                        }

                        // A. Handle reasoning — only update displayBlocks, don't build HTML
                        if (delta.reasoning_content) {
                            const block = getBlock('reasoning');
                            block.content += delta.reasoning_content;

                            let lastBackend = currentMsg.backend_content[currentMsg.backend_content.length - 1];
                            // If the last entry isn't an assistant, or it already has content (meaning the previous assistant finished)
                            if (!lastBackend || lastBackend.role !== 'assistant' || (lastBackend.content && lastBackend.content.trim() !== '')) {
                                lastBackend = { role: 'assistant', content: '', reasoning_content: '' };
                                currentMsg.backend_content.push(lastBackend);
                            }
                            lastBackend.reasoning_content = (lastBackend.reasoning_content || '') + delta.reasoning_content;
                            // Debounce-merge into displayBlocks
                            if (this._streamUpdateTimer) clearTimeout(this._streamUpdateTimer);
                            this._streamUpdateTimer = setTimeout(() => {
                                this.flushStreamTextBuffer();
                            }, 80);
                        }

                        // B. Handle text (content) — streaming debounced update
                        if (delta.content) {

                            if (!this._streamTextBuffer) {
                                const blocks = currentMsg.displayBlocks;
                                const lastBlock = blocks && blocks.length > 0 ? blocks[blocks.length - 1] : null;
                                if (lastBlock && lastBlock.type !== 'text') {
                                    this._streamTextBuffer += '\n\n';
                                }
                            }

                            // Buffer the text; no longer manipulate the DOM directly
                            this._streamTextBuffer += delta.content;

                            // Also store the text into backend_content so multi-turn history isn't filtered out
                            const lastBackend = currentMsg.backend_content[currentMsg.backend_content.length - 1];
                            if (lastBackend && lastBackend.role === 'assistant') {
                                lastBackend.content = (lastBackend.content || '') + delta.content;
                            } else {
                                currentMsg.backend_content.push({ role: 'assistant', content: delta.content });
                            }

                            const accumulatedText = lastBackend ? (lastBackend.content || '') : '';

                            // === Core branch handling ===
                            if (this.ttsSettings.enabled) {
                                // Process immediately for TTS (keep the original audio slicing and lip-sync)
                                const parts = delta.content.split('```');
                                for (let i = 0; i < parts.length; i++) {
                                    if (!isCodeBlock) { tts_buffer += parts[i]; }
                                    if (i < parts.length - 1) { isCodeBlock = !isCodeBlock; }
                                }
                                const { chunks, chunks_voice, remaining, remaining_voice } = this.splitTTSBuffer(tts_buffer);
                                if (chunks.length > 0) {
                                    currentMsg.chunks_voice.push(...chunks_voice);
                                    currentMsg.ttsChunks.push(...chunks);
                                }
                                tts_buffer = remaining;
                                this.cur_voice = remaining_voice;
                            } else {
                                // === [New] text-and-expression sync logic when TTS is disabled ===
                                if ((this.vrmOnline || this.vtsOnline) && this.ttsWebSocket) {
                                    // Auto-detect and extract expression/motion tags from the accumulated text (e.g. [happy] or *wave*)
                                    const detectedExpressions = [];
                                    const tagRegex = /[\[\(\*]([a-zA-Z_0-9\u4e00-\u9fa5]+)[\]\)\*]/g;
                                    let match;
                                    
                                    while ((match = tagRegex.exec(accumulatedText)) !== null) {
                                        const tag = match[1].toLowerCase().trim();
                                        detectedExpressions.push(tag);
                                    }

                                    // Push the accumulated text and motion markers to VRM for rendering
                                    this.sendTTSStatusToVRM('omniStreaming', {
                                        text: accumulatedText,
                                        expressions: detectedExpressions
                                    });
                                }
                            }

                            // Debounce-merge into displayBlocks
                            if (this._streamUpdateTimer) clearTimeout(this._streamUpdateTimer);
                            this._streamUpdateTimer = setTimeout(() => {
                                this.flushStreamTextBuffer();
                            }, 80);
                        }

                        // C. Tool loading state (tool_progress) — only update displayBlocks
                        if (delta.tool_progress) {
                            const progress = delta.tool_progress;
                            let toolCallId = progress.tool_call_id || progress.id;

                            if (!toolCallId) {
                                const existingCall = toolCallStack.find(c => c.name === progress.name && !c.resolved);
                                if (existingCall) { toolCallId = existingCall.id; }
                                else {
                                    toolCallId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                                    toolCallStack.push({ id: toolCallId, name: progress.name, resolved: false });
                                }
                            } else if (!toolCallStack.find(c => c.id === toolCallId)) {
                                toolCallStack.push({ id: toolCallId, name: progress.name, resolved: false });
                            }

                            let accArgs = this.toolArgsAccumulator[toolCallId] || "";
                            if (progress.arguments !== undefined) {
                                if (progress.arguments.startsWith(accArgs) && accArgs !== "") {
                                    accArgs = progress.arguments;
                                } else {
                                    accArgs += progress.arguments;
                                }
                                this.toolArgsAccumulator[toolCallId] = accArgs;
                            }

                            const b = getBlock('tool_call', toolCallId, progress.name);
                            b.args = accArgs;
                            this.requestScrollToBottom();
                            continue;
                        }

                        // D. Tool result / error / approval — only update displayBlocks + backend_content
                        if (delta.tool_content) {
                            const tool = delta.tool_content;
                            const toolName = tool.title || 'unknown';
                            let toolCallId = delta.tool_call_id || delta.async_tool_id;

                            if (tool.type === 'call') {
                                if (!toolCallId) toolCallId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                                toolCallStack.push({ id: toolCallId, name: toolName, resolved: false });
                            } else {
                                if (!toolCallId) {
                                    const pendingCall = toolCallStack.find(c => c.name === toolName && !c.resolved);
                                    if (pendingCall) {
                                        toolCallId = pendingCall.id; pendingCall.resolved = true;
                                    } else { toolCallId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`; }
                                }
                                const callItem = toolCallStack.find(c => c.id === toolCallId);
                                if (callItem) callItem.resolved = true;
                            }

                            if (delta.async_tool_id && (tool.type === 'tool_result' || tool.type === 'error')) {
                                if (this.asyncToolsID) {
                                    const index = this.asyncToolsID.indexOf(delta.async_tool_id);
                                    if (index > -1) {
                                        this.asyncToolsID.splice(index, 1);
                                        const stackIndex = toolCallStack.findIndex(c => c.id === delta.async_tool_id);
                                        if (stackIndex > -1) toolCallStack.splice(stackIndex, 1);
                                    }
                                }
                            }

                            let isApproval = false;
                            let approvalData = null;

                            if (tool.type === 'tool_approval') {
                                isApproval = true;
                                try { approvalData = JSON.parse(tool.content); } catch (e) { }
                            } else if (tool.type === 'tool_result' && typeof tool.content === 'string' && tool.content.includes('"approval_required"')) {
                                try {
                                    const temp = JSON.parse(tool.content);
                                    if (temp.type === 'approval_required') { isApproval = true; approvalData = temp; }
                                } catch (e) { }
                            }

                            // Approval logic
                            if (isApproval && approvalData) {
                                const b = getBlock('approval', toolCallId, toolName);
                                b.data = approvalData;
                                this.approvalMap[toolCallId] = approvalData;

                                // No longer generate HTML; update backend_content directly
                                currentMsg.backend_content.push({ role: 'tool', tool_call_id: toolCallId, name: toolName, content: "{}" });
                                currentMsg.backend_content.push({ role: 'assistant', content: '' });
                                this.requestScrollToBottom();
                            }
                            else if (tool.type === 'tool_result_stream' && tool.title === "tool_result_stream") {
                                const targetBlock = getBlock('tool_result', toolCallId, toolName);
                                targetBlock.content = this.smartMergeTerminal(targetBlock.content, tool.content);
                                // Update backend_content
                                const lastToolIndex = currentMsg.backend_content.length - 1;
                                for (let i = lastToolIndex; i >= 0; i--) {
                                    if (currentMsg.backend_content[i].role === 'tool' && currentMsg.backend_content[i].tool_call_id === toolCallId) {
                                        currentMsg.backend_content[i].content += tool.content;
                                        break;
                                    }
                                }
                            } else {
                                let bType = 'tool_result';
                                if (tool.type === 'error') bType = 'error';
                                else if (tool.type === 'call') bType = 'tool_call';

                                const targetBlock = getBlock(bType, toolCallId, toolName);
                                
                                // Truncate the displayed content (affects UI display only)
                                if (tool.type === 'call') {
                                    targetBlock.args = tool.content;
                                } else {
                                    targetBlock.content = this.truncateDisplayContent(tool.content);
                                }

                                // Backend message storage uses the original content (may be truncated, to protect the AI context)
                                let rawContent = tool.content || '';
                                if (tool.type === 'call') {
                                    let last = currentMsg.backend_content[currentMsg.backend_content.length - 1];
                                    const actualArgs = rawContent || "{}"; // Extract the real arguments
                                    
                                    if (last.role === 'assistant') {
                                        if (!last.tool_calls) last.tool_calls =[];
                                        let existingCall = last.tool_calls.find(tc => tc.id === toolCallId);
                                        if (!existingCall) {
                                            last.tool_calls.push({ id: toolCallId, type: 'function', function: { name: tool.title, arguments: actualArgs } });
                                        } else {
                                            existingCall.function.arguments = actualArgs; // Overwrite the placeholder, updating to the real arguments
                                        }
                                    } else {
                                        currentMsg.backend_content.push({ role: 'assistant', content: null, tool_calls:[{ id: toolCallId, type: 'function', function: { name: tool.title, arguments: actualArgs } }] });
                                    }
                                } else if (tool.type === 'tool_result' || tool.type === 'tool_result_stream' || tool.type === 'error') {
                                    const hide = this.toolsSettings?.hideToolResults?.enabled && tool.type === 'tool_result';
                                    rawContent = hide ? '<hide to save token>' : rawContent;
                                    let updated = false;
                                    for (let i = currentMsg.backend_content.length - 1; i >= 0; i--) {
                                        if (currentMsg.backend_content[i].role === 'tool' && currentMsg.backend_content[i].tool_call_id === toolCallId) {
                                            currentMsg.backend_content[i].content = rawContent;
                                            updated = true;
                                            break;
                                        }
                                    }
                                    if (!updated) {
                                        currentMsg.backend_content.push({ role: 'tool', tool_call_id: toolCallId, name: toolName, content: rawContent });
                                    }
                                    if (currentMsg.backend_content[currentMsg.backend_content.length - 1].role !== 'assistant') {
                                        currentMsg.backend_content.push({ role: 'assistant', content: '' });
                                    }
                                }
                            }
                            this.requestScrollToBottom();
                        }

                        if (delta.audio?.data) {
                            this.playPCMChunk(delta.audio.data, currentMsg.pure_content, currentMsg);
                        }
                        if (parsed.usage?.total_tokens) {
                            currentMsg.total_tokens += parsed.usage.total_tokens;
                        }
                        if (delta.async_tool_id) {
                            if (!this.asyncToolsID) this.asyncToolsID = [];
                            if (!this.asyncToolsID.includes(delta.async_tool_id)) {
                                this.asyncToolsID.push(delta.async_tool_id);
                            }
                        }

                        this.sendMessagesToExtension();
                    }
                }
            }

            // After the loop, force-flush the remaining text in the buffer
            if (this._streamUpdateTimer) clearTimeout(this._streamUpdateTimer);
            this.flushStreamTextBuffer();

            if (tts_buffer.trim() && this.ttsSettings.enabled) {
                currentMsg.chunks_voice.push(this.cur_voice);
                currentMsg.ttsChunks.push(tts_buffer);
            }

            currentMsg.generationFinished = true;

            if (this.ttsSettings.enabled) {
                if (this.audioStartTime > this.audioCtx.currentTime) {
                    const remainingTime = (this.audioStartTime - this.audioCtx.currentTime) * 1000;
                    setTimeout(() => { this.sendTTSStatusToVRM('allChunksCompleted', {}); }, remainingTime);
                } else {
                    this.sendTTSStatusToVRM('allChunksCompleted', {});
                }
            }

        } catch (error) {
            console.error(error);
            if (error.name !== 'AbortError') {
                showNotification(error.message, 'error');
                const b = getBlock('error', 'err', 'System Error');
                b.content = this.truncateDisplayContent(error.message);
                if (currentMsg) {
                    const fallbackText = 'response error';
                    if (!currentMsg.pure_content && currentMsg.backend_content.length <= 1) {
                        currentMsg.pure_content = fallbackText;
                        currentMsg.backend_content = [{ role: 'assistant', content: fallbackText }];
                    } else {
                        const lastBackend = currentMsg.backend_content[currentMsg.backend_content.length - 1];
                        if (lastBackend && lastBackend.role === 'assistant' && lastBackend.tool_calls) {
                            delete lastBackend.tool_calls;
                        }
                        currentMsg.backend_content.push({ role: 'assistant', content: fallbackText });
                    }
                }
            }
            if (audioResolve) audioResolve();
        } finally {
            this.isSending = false;
            this.isTyping = false;
            this.voiceStack = ['default'];
            if (this.allBriefly) currentMsg.briefly = true;

            // Clear the content field (HTML is no longer needed)
            if (currentMsg) {
                currentMsg.content = '';
            }

            // Message dedup and save
            if (this.conversationId === null) {
                this.conversationId = uuid.v4();
                const newConv = {
                    id: this.conversationId,
                    title: this.generateConversationTitle(messagesPayload),
                    mainAgent: this.mainAgent,
                    groupId: this.activeConversationGroupId || this.draftConversationGroupId || 'default',
                    timestamp: Date.now(),
                    messages: this.messages,
                    fileLinks: this.fileLinks,
                    system_prompt: this.system_prompt,
                };
                this.conversations.unshift(newConv);
            } else {
                const conv = this.conversations.find(conv => conv.id === this.conversationId);
                if (conv) {
                    conv.messages = this.messages;
                    conv.timestamp = Date.now();
                    conv.fileLinks = this.fileLinks;
                    conv.groupId = conv.groupId || this.activeConversationGroupId || this.draftConversationGroupId || 'default';
                }
            }

            // Truncate overly long tool content in backend messages, to protect the AI context
            if (currentMsg && currentMsg.backend_content) {
                const AI_MAX_TOOL_LENGTH = 15000;
                currentMsg.backend_content.forEach(item => {
                    if (item.role === 'tool' && item.content && typeof item.content === 'string') {
                        if (item.content.length > AI_MAX_TOOL_LENGTH) {
                            item.content = item.content.slice(0, AI_MAX_TOOL_LENGTH) + '\n... (Truncated)';
                        }
                    }
                });
            }

            // Freeze all displayBlocks and inner strings of finished messages to reduce reactivity overhead
            if (currentMsg && Array.isArray(currentMsg.displayBlocks)) {
                currentMsg.displayBlocks.forEach(block => {
                    if (!Object.isFrozen(block)) {
                        Object.freeze(block);
                        if (typeof block.content === 'string') Object.freeze(block.content);
                        if (typeof block.args === 'string') Object.freeze(block.args);
                        if (block.data) Object.freeze(block.data);
                    }
                });
            }
            if (currentMsg && Array.isArray(currentMsg.backend_content)) {
                currentMsg.backend_content.forEach(item => {
                    if (!Object.isFrozen(item)) Object.freeze(item);
                });
            }

            if (this.ttsSettings.enabled && audioProcess) {
                await audioProcess;
            } else {
                // === [New] generation-complete notification when TTS is disabled ===
                if ((this.vrmOnline || this.vtsOnline) && this.ttsWebSocket) {
                    this.sendTTSStatusToVRM('allChunksCompleted', {});
                }
            }


            this.isThinkOpen = false;
            shouldSyncGroupMemory = !!currentMsg?.pure_content?.trim();

            setTimeout(() => {
                if (!this.isSending && this.audioStartTime <= this.audioCtx.currentTime) {
                    this.sendTTSStatusToVRM('allChunksCompleted', {});
                }
            }, 1000);

            if (shouldSyncGroupMemory && latestUserMessage?.id && currentMsg?.id) {
                await this.syncGroupMemoryAfterReply(latestUserMessage, currentMsg);
            }

            // Clean up the streaming-buffer state
            this._streamTargetMsg = null;
            this._streamTextBuffer = '';
            if (this._streamUpdateTimer) clearTimeout(this._streamUpdateTimer);
        }
    },

    // === Human-in-the-loop handler functions ===
    async processToolApproval(toolCallId, action) {
        const currentMsg = this.messages[this.messages.length - 1];
        if (!currentMsg) return;
        
        const data = this.approvalMap[toolCallId];
        const toolName = data?.tool_name || 'Tool';
        const blockId = `approval-${toolCallId}`;

        // [Optimization 2]: don't mutate targetBlock's props directly; locate the index and replace with a new object
        let targetIdx = -1;
        if (currentMsg.displayBlocks) {
            targetIdx = currentMsg.displayBlocks.findIndex(b => b.id === toolCallId && b.type === 'approval');
            if (targetIdx !== -1) {
                const originalBlock = currentMsg.displayBlocks[targetIdx];
                const updatedBlock = {
                    ...originalBlock,
                    type: 'tool_result',
                    name: action === 'deny' ? this.t('denying') : `${this.t('executing')} ${toolName}...`,
                    content: '',
                    segments: [] // Reserve a segments cache
                };
                
                // Safe replacement, bypassing the Object.freeze restriction while keeping reactivity
                if (typeof this.$set === 'function') {
                    this.$set(currentMsg.displayBlocks, targetIdx, updatedBlock);
                } else {
                    currentMsg.displayBlocks[targetIdx] = updatedBlock;
                }
            }
        }

        const escapeHtml = (text) => {
            if (!text) return '';
            return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        };

        const feedbackTitle = action === 'deny' ? (this.t('denying') || 'Denying...') : `${this.t('executing') || 'Executing'} ${toolName}...`;
        this.updateUIBlock(currentMsg, blockId, `\n`);

        this.isSending = true; 
        this.isTyping = true;
        this.abortController = new AbortController(); 

        try {
            let resultText = "";
            if (action === 'deny') {
                resultText = `User denied the execution of tool '${toolName}'.`;
            } else {
                resultText = await this.executeToolBackend(toolName, data.tool_params, action);

                // Update the result content
                if (targetIdx !== -1) {
                    const finalBlock = {
                        ...currentMsg.displayBlocks[targetIdx],
                        type: action === 'deny' ? 'error' : 'tool_result',
                        name: action === 'deny' ? this.t('tool_deny') : `${toolName} ${this.t('tool_result')}`,
                        content: resultText,
                        segments: [] 
                    };
                    if (typeof this.$set === 'function') {
                        this.$set(currentMsg.displayBlocks, targetIdx, finalBlock);
                    } else {
                        currentMsg.displayBlocks[targetIdx] = finalBlock;
                    }
                }

                const cleanedForAI = this.truncateForAI(resultText);
                if (currentMsg.backend_content) {
                    for (let i = currentMsg.backend_content.length - 1; i >= 0; i--) {
                        const item = currentMsg.backend_content[i];
                        if (item.role === 'tool' && item.tool_call_id === toolCallId) {
                            item.content = cleanedForAI;
                            break;
                        }
                    }
                } 
            }

            // Update the HTML part as a compatibility fallback
            const blockClass = action === 'deny' ? 'type-error' : 'type-result';
            const iconClass = action === 'deny' ? 'fa-xmark' : 'fa-check';
            const finalTitle = action === 'deny' ? this.t('tool_deny') : `${toolName} ${this.t('tool_result')}`;

            const resultHtml = `\n<div class="sap-process-block ${blockClass}" id="${blockId}">
                <div class="sp-header"><i class="fa-solid ${iconClass}"></i> ${escapeHtml(finalTitle)}</div>
                <pre class="sp-content sp-code">${escapeHtml(resultText)}</pre>
            </div>\n`;
            this.updateUIBlock(currentMsg, blockId, resultHtml);

            await this.generateAIResponse(this.mainAgent, currentMsg.agentName, true);

        } catch (e) {
            console.error("Approval flow failed:", e);
            if (typeof showNotification === 'function') {
                showNotification("Tool execution failed", 'error');
            }
            this.isSending = false;
            this.isTyping = false;
        }
    },

    updateUIBlock(msg, blockId, newHtml) {
        const content = msg.content;
        const startTag = `id="${blockId}"`;
        const startSearchIndex = content.indexOf(startTag);
        
        if (startSearchIndex === -1) {
            msg.content += newHtml;
            return;
        }

        const startIndex = content.lastIndexOf('<div', startSearchIndex);
        let endIndex = -1;
        const searchPart = content.substring(startIndex);
        
        if (searchPart.includes('</div></div>')) {
            endIndex = startIndex + searchPart.indexOf('</div></div>') + 12;
        } else if (searchPart.includes('</div>\n')) {
            endIndex = startIndex + searchPart.indexOf('</div>\n') + 7;
        }

        if (startIndex !== -1 && endIndex !== -1) {
            msg.content = content.substring(0, startIndex) + newHtml + content.substring(endIndex);
        } else {
            msg.content += newHtml;
        }
    },


    getVisibleBlocks(msg) {
        if (!msg.displayBlocks || !msg.displayBlocks.length) return [];
        const blocks = msg.displayBlocks;
        return blocks;
    },

    // === Helper functions ===

    // Helper: call the backend manual-execution endpoint
    async executeToolBackend(name, params, type) {
        try {
            const res = await fetch('/execute_tool_manually', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    tool_name: name, 
                    tool_params: params,
                    approval_type: type 
                })
            });
            const json = await res.json();
            return json.result || JSON.stringify(json);
        } catch (e) {
            return `System Error: ${e.message}`;
        }
    },
    

    // 1. Tool-result display with truncation
    truncateDisplayContent(content) {
        if (typeof content !== 'string') return content;
        if (content.length > MAX_DISPLAY_LENGTH) {
            return content.slice(0, MAX_DISPLAY_LENGTH) + '\n... (The result is too long and has been truncated.)';
        }
        return content;
    },

    // 2. Throttled scroll (requestAnimationFrame)
    requestScrollToBottom() {
        if (!this.scrollPending) {
            this.scrollPending = true;
            requestAnimationFrame(() => {
                // Changed to call the original scrollToBottom
                if (typeof this.scrollToBottom === 'function') {
                    this.scrollToBottom();
                }
                this.scrollPending = false;
            });
        }
    },

    // 3. Streaming-text batch update (80ms debounce)
    flushStreamTextBuffer() {
        if (this._streamTargetMsg && this._streamTextBuffer) {
            const block = this.getBlockForMsg(this._streamTargetMsg, 'text');
            if (block) {
                block.content += this._streamTextBuffer;
                
                // [Optimization 1]: pre-parse segments in JS and store them on the block, avoiding repeated template computation
                block.segments = this.splitMessageContent(block.content);
                
                this._streamTargetMsg.pure_content += this._streamTextBuffer;
                this._streamTargetMsg.content += this._streamTextBuffer;
                
                // Also keep a pre-parse cache for backward compatibility
                this._streamTargetMsg.segments = this.splitMessageContent(this._streamTargetMsg.content);
            }
            this._streamTextBuffer = '';
            this.requestScrollToBottom();
        }
    },


    isLastActiveBlock(msg, blockIndex) {
        if (!msg.displayBlocks || msg.displayBlocks.length === 0) return false;
        const lastBlock = msg.displayBlocks[msg.displayBlocks.length - 1];
        // As long as the block is the last one and the message isn't finished, treat it as the 'currently updating block'
        if (!msg.generationFinished && blockIndex === msg.displayBlocks.length - 1) {
            return true;
        }
        // Once generation is finished, treat the last block as static too; no more live expansion
        return false;
    },

    // Determine whether it's a tool-type block
    isToolBlock(block) {
        return block.type === 'tool_call' || block.type === 'tool_result' || block.type === 'reasoning';
    },

    // Open the tool-block details (when clicking a collapsed block)
    openToolBlockDetail(message, block) {
        if (!block || !this.isToolBlock(block)) return;
        
        // Store the block object and message reference directly
        this.activeToolBlock = {
            messageIndex: this.messages.indexOf(message),
            blockIndex: message.displayBlocks.indexOf(block), // Keep the original index for possible later operations
            block: block
        };
        
        this.activeSideView = 'toolDetail';
        if (!this.sidePanelOpen) {
            this.expandSidePanel();
        }
        this.updatePanelWidths();
    },

    // Close the tool details
    closeToolBlockDetail() {
        this.activeToolBlock = null;
        this.activeSideView = 'list';  // Return to the extension-list view
    },

    // Return the icon class name based on the block type
    getToolBlockIcon(type) {
        const icons = {
            'tool_call': 'fa-solid fa-wrench',
            'tool_result': 'fa-solid fa-check',
            'error': 'fa-solid fa-xmark',
            'approval': 'fa-solid fa-lock'
        };
        return icons[type] || 'fa-solid fa-file-lines';
    },

    // Format the tool-block content (handle \n and \" display)
    formatToolBlockContent(block) {
        if (!block) return '';
        if (block.type === 'approval') {
            return JSON.stringify(block.data?.tool_params, null, 2);
        }
        let content = block.type === 'tool_call' ? (block.args || '') : (block.content || '');
        if (typeof content !== 'string') content = JSON.stringify(content, null, 2);
        return content.replace(/\\n/g, '\n').replace(/\\"/g, '"');
    },

    // Get a block of a given type from a message (reuses the original logic, extracted out)
    getBlockForMsg(msg, type, id = null, name = null) {
        if (!msg.displayBlocks) msg.displayBlocks = [];
        if (id) {
            const existing = msg.displayBlocks.find(b => b.type === type && b.id === id);
            if (existing) {
                if (name && !existing.name) existing.name = name;
                return existing;
            }
        }
        let last = msg.displayBlocks[msg.displayBlocks.length - 1];
        const canReuse = last && last.type === type && (!id || last.id === id);
        if (canReuse) {
            if (name && !last.name) last.name = name;
            return last;
        }
        const newBlock = { type, id, name, content: '', args: '', data: null };
        msg.displayBlocks.push(newBlock);

        // Key: trim immediately after adding a new block, keeping only the last MAX_RENDERED_BLOCKS blocks
        if (msg.displayBlocks.length > MAX_RENDERED_BLOCKS) {
            msg.displayBlocks.splice(0, msg.displayBlocks.length - MAX_RENDERED_BLOCKS);
        }

        return newBlock;
    },

    // Add this function to methods
    smartMergeTerminal(existing, chunk) {
        if (!chunk) return existing;
        
        // If the chunk contains a carriage return \r, the current line needs to be overwritten
        if (chunk.includes('\r')) {
            let combined = existing + chunk;
            let lines = combined.split('\n');
            let lastLine = lines[lines.length - 1];

            // Handle the \r within the last line
            if (lastLine.includes('\r')) {
                let subParts = lastLine.split('\r');
                // Keep only the content after the last \r (i.e. the latest progress)
                lines[lines.length - 1] = subParts[subParts.length - 1];
            }
            return lines.join('\n');
        }
        
        // If there's no \r, just append
        return existing + chunk;
    },

    // Helper: a trimmed-down function for the AI
    truncateForAI(text) {
        if (!text) return '';
        const MAX_LIMIT = 8000; // Upper limit passed back to the AI; adjust as needed
        
        // 1. Strip progress-bar lines (lines with █ or many progress chars are useless to the AI and waste tokens)
        let lines = text.split('\n');
        let cleanedLines = lines.filter(line => {
            // Filter out lines that look like progress bars
            const isProgressBar = (line.includes('█') || line.includes('░') || (line.includes('%') && line.includes('|')));
            return !isProgressBar;
        });
        
        let cleanedText = cleanedLines.join('\n').trim();
        
        // 2. If still too long, truncate head and tail
        if (cleanedText.length > MAX_LIMIT) {
            return cleanedText.substring(0, 2000) + 
                  `\n\n... [Total ${text.length} chars. Output truncated for context. User sees full output above.] ...\n\n` + 
                  cleanedText.slice(-4000);
        }
        return cleanedText;
    },

    // Helper: escape HTML (ignore if you already have one)
    escapeHtml(text) {
        if (!text) return '';
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },
    async handleInputPaste(event) {
      const items = (event.clipboardData || window.clipboardData).items;
      
      // Config: character threshold above which content is converted to a file
      const TEXT_TO_FILE_THRESHOLD = 2000; 

      const imageFiles = []; // List of images pending upload
      const videoFiles = []; // List of videos pending upload
      const docFiles = [];   // List of regular files pending upload
      let hasValidContent = false;

      // 1. Iterate the clipboard items
      for (const item of items) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (!file) continue;

          const ext = (file.name.split('.').pop() || '').toLowerCase();
          const isImageMime = item.type.startsWith('image/');
          const isVideoMime = item.type.startsWith('video/'); // Detect video MIME types

          // --- Video-handling logic ---
          if (isVideoMime || ALLOWED_VIDEO_EXTENSIONS.includes(ext)) {
            videoFiles.push(file);
            hasValidContent = true;
          } 
          // --- Image-handling logic ---
          else if (isImageMime || ALLOWED_IMAGE_EXTENSIONS.includes(ext)) {
            if (file.name === 'image.png' || !file.name.includes('.')) {
              const fileExtension = file.type.split('/')[1] || 'png';
              const namedFile = new File([file], `pasted_image_${Date.now()}.${fileExtension}`, { type: file.type });
              imageFiles.push(namedFile);
            } else {
              imageFiles.push(file);
            }
            hasValidContent = true;
          } 
          // --- Regular-document handling logic ---
          else if (ALLOWED_EXTENSIONS.includes(ext)) {
            docFiles.push(file);
            hasValidContent = true;
          }
        }
      }

      // 2. If no actual file is detected, check whether the plain text is too long
      if (!hasValidContent) {
          const pastedText = event.clipboardData.getData('text');
          if (pastedText && pastedText.length > TEXT_TO_FILE_THRESHOLD) {
              const fileName = `paste_text_${Date.now()}.txt`;
              const textFile = new File([pastedText], fileName, { type: 'text/plain' });
              docFiles.push(textFile);
              hasValidContent = true;
          }
      }

      // 3. If valid content is found
      if (hasValidContent) {
        event.preventDefault();

        // Handle the video
        if (videoFiles.length > 0) {
          this.addFiles(videoFiles, 'video');
        }

        if (imageFiles.length > 0) {
          this.addFiles(imageFiles, 'image');
        }

        if (docFiles.length > 0) {
          this.addFiles(docFiles, 'file');
        }
      }
    },
    getRoleAvatar(name) {
        // Try looking it up in the memory list
        const mem = this.memories.find(m => m.name === name);
        if (mem && mem.avatar) return mem.avatar;
        // If needed, also try the agents list (if the agent object stores an avatar)
        // const agentKey = Object.keys(this.agents).find(key => this.agents[key].name === name);
        // if (agentKey && this.agents[agentKey].avatar) return this.agents[agentKey].avatar;
        
        return 'source/Avatar.png';
    },

    async playPCMChunk(b64, currentText = '', message = null) {
        this.isOmniPlaying = true;
        if (message) {
            message.isPlaying = true;
            if (message.omniDuration === undefined) message.omniDuration = 0;
            if (message.omniCurrentTime === undefined) message.omniCurrentTime = 0;
            if (!message.generationFinished) message.omniAudioChunks.push(b64);
        }

        try {
            if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();

            // Decode the data
            const raw = atob(b64);
            const pcm16 = new Int16Array(raw.length / 2);
            for (let i = 0; i < raw.length; i += 2) {
                pcm16[i >> 1] = raw.charCodeAt(i) | (raw.charCodeAt(i + 1) << 8);
            }

            const sampleRate = 24000;
            const buf = this.audioCtx.createBuffer(1, pcm16.length, sampleRate);
            const floatData = buf.getChannelData(0);
            for (let i = 0; i < pcm16.length; i++) floatData[i] = pcm16[i] / 32768;

            const chunkDuration = buf.duration;
            if (message && message.isOmni && !message.generationFinished) {
                message.omniDuration += chunkDuration;
            }

            // ======= [Core change: sync to VRM via binary] =======
            if ((this.vrmOnline || this.vtsOnline) && this.ttsWebSocket) {
                const pcmUint8 = new Uint8Array(raw.length);
                for(let i=0; i<raw.length; i++) pcmUint8[i] = raw.charCodeAt(i);
                
                this.sendBinaryToVRM({
                    type: 'omni_chunk',
                    text: currentText, // Pass in the current text
                    sampleRate: sampleRate
                }, pcmUint8.buffer);
            }
            // ===============================================

            const now = this.audioCtx.currentTime;
            if (this.audioStartTime < now) this.audioStartTime = now;

            const src = this.audioCtx.createBufferSource();
            src.buffer = buf;
            if (!this.activeSources) this.activeSources = [];
            this.activeSources.push(src);

            const gainNode = this.audioCtx.createGain();
            gainNode.gain.value = this.vrmOnline ? 0.000001 : 1.0;

            src.connect(gainNode);
            gainNode.connect(this.audioCtx.destination);

            src.onended = () => {
                if (this.activeSources) this.activeSources = this.activeSources.filter(s => s !== src);
                if (message && message.isOmni && !src.isForceStopped) {
                    message.omniCurrentTime += chunkDuration;
                    if (message.omniCurrentTime > message.omniDuration) message.omniCurrentTime = message.omniDuration;

                    if (message.generationFinished && this.activeSources.length === 0) {
                        message.isPlaying = false;
                        message.omniCurrentTime = message.omniDuration;
                        if (this.vrmOnline || this.vtsOnline) this.sendTTSStatusToVRM('allChunksCompleted', {});
                        this.isOmniPlaying = false;
                    }
                }
                try { src.disconnect(); gainNode.disconnect(); } catch (e) {}
            };

            src.start(this.audioStartTime);
            this.audioStartTime += buf.duration;
        } catch (error) {
            console.error('Error in playPCMChunk:', error);
            if (message) message.isPlaying = false;
        }
    },
    // --- [4] Helper: binary packer ---
    sendBinaryToVRM(metadata, audioArrayBuffer) {
        if (!this.ttsWebSocket || this.ttsWebSocket.readyState !== WebSocket.OPEN) return;
        const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata));
        const totalBuffer = new Uint8Array(4 + metadataBytes.byteLength + audioArrayBuffer.byteLength);
        const view = new DataView(totalBuffer.buffer);
        view.setUint32(0, metadataBytes.byteLength, true); // JSON length
        totalBuffer.set(metadataBytes, 4);
        totalBuffer.set(new Uint8Array(audioArrayBuffer), 4 + metadataBytes.byteLength);
        this.ttsWebSocket.send(totalBuffer);
    },

    async translateMessage(index) {
      const msg = this.messages[index];
      const originalContent = msg.content;
      if (msg.isTranslating) return;
      if (originalContent.trim() === '') return;

      // 1. Reserve the slot first
      this.messages[index] = {
        ...msg,
        content: this.t('translating') + '...',
        isTranslating: true,
        originalContent
      };

      try {
        const abortController = new AbortController();
        this.abortController = abortController;

        // 2. Assemble the TTS prompt
        let newttsList = [];
        if (this.ttsSettings?.newtts) {
          for (const key in this.ttsSettings.newtts) {
            if (this.ttsSettings.newtts[key].enabled) newttsList.push(key);
          }
        }
        const ttsMsg = (newttsList.length === 0 || !this.ttsSettings?.enabled)
          ? 'If the text to translate is already in the target language, just return it unchanged.'
          : `You must also add the corresponding voice tags while translating. If the text to translate is already in the target language, you only need to add the voice tags. Note! Do NOT use <!--  --> as it makes some text invisible! You may use the following voices:\n${newttsList.join(', ')}\n. When you generate your reply, wrap narration or character text with <VoiceName></VoiceName> to indicate that text uses that voice, so each part is converted by the matching TTS voice. Parts with no matching voice may be left unwrapped. Even if a voice name is not in English, you can still use <VoiceName>text in that voice</VoiceName> to enable it. Note! If the name of the character you are playing is in the voice list, you MUST wrap the parts spoken by your character with that voice tag! Any part not spoken by a character is treated as narration! The character voice tag should mark the start and end of the character's speech! For example: <Narrator>It is now three in the afternoon. She said:</Narrator><CharacterName>"What lovely weather!"</CharacterName><Narrator>and then she stretched.</Narrator>\n\n`;

        // 3. Start the streaming request
        const response = await fetch('/simple_chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.mainAgent,
            messages: [
              {
                role: 'system',
                content: `You are a professional translator. Strictly translate any content the user provides into ${this.target_lang}, preserving the original formatting (Markdown, line breaks, etc.) and adding nothing extra. Return only the translation result.${ttsMsg}`
              },
              {
                role: 'user',
                content: `Translate the following into ${this.target_lang}:\n\n${originalContent}`
              }
            ],
            stream: true,
            temperature: 0.1
          }),
          signal: abortController.signal
        });

        if (!response.ok) throw new Error('Translation failed');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';      // Leftover partial line
        let translated = '';  // Accumulated result

        // 4. Read chunk by chunk
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop(); // The last line may be incomplete; leave it for the next round

          for (const line of lines) {
            if (!line) continue;          // Skip empty lines
            try {
              const chunk = JSON.parse(line);
              const delta = chunk.choices?.[0]?.delta?.content ?? '';
              if (delta) {
                translated += delta;
                this.messages[index].content = translated; // Render in real time
              }
            } catch (e) {
              // Ignore parse failures
            }
          }
        }

        // 5. Translation complete
        this.messages[index].isTranslating = false;
        this.messages[index].translated = true;

      } catch (error) {
        if (error.name === 'AbortError') {
          // User interrupted; restore the original text
          this.messages[index] = { ...msg, content: originalContent, isTranslating: false };
        } else {
          this.messages[index].content = `Translation error: ${error.message}`;
          this.messages[index].isTranslating = false;
        }
      } finally {
        this.abortController = null;
      }
    },
    stopGenerate() {
      if (this.abortController) {
        this.abortController.abort();
      }
      this.isThinkOpen = false;
      this.isSending = false;
      this.isTyping = false;
      this.abortController = null;
      if(this.settings.enableOmniTTS){
        if (this.activeSources && this.activeSources.length > 0) {
          this.activeSources.forEach(src => {
            try {
              src.stop(); // Stop playback immediately
            } catch (e) {
              // Ignore errors from being already stopped or not yet started
            }
          });
          // Clear the array
          this.activeSources = [];
        }
        this.audioStartTime = 0; 
        this.stopAllAudioPlayback();
      }
    },
    async autoSaveSettings() {
      if (this.isElectron) {
        await window.electronAPI.saveChromeSettings(JSON.parse(JSON.stringify(this.chromeMCPSettings)));
      }
      return new Promise((resolve, reject) => {
        this.ensureConversationGroups();
        // Build the payload (keep the original logic)
        const payload = {
          ...this.settings,
          showHistorySidebar: this.showHistorySidebar,
          system_prompt: this.system_prompt,
          SystemPromptsList: this.SystemPromptsList,
          agents: this.agents,
          mainAgent: this.mainAgent,
          discordBotConfig: this.discordBotConfig,
          slackBotConfig: this.slackBotConfig,
          telegramBotConfig: this.telegramBotConfig,
          targetLangSelected: this.targetLangSelected,
          allBriefly: this.allBriefly,
          isForceScrollToBottom: this.isForceScrollToBottom,
          BotConfig: this.BotConfig,
          liveConfig: this.liveConfig,
          stickerPacks: this.stickerPacks,
          tools: this.toolsSettings,
          llmTools: this.llmTools,
          conversationId: this.conversationId,
          conversationGroups: this.conversationGroups,
          reasoner: this.reasonerSettings,
          fast: this.fastSettings,
          isBtnCollapse: this.isBtnCollapse,
          vision: this.visionSettings,
          webSearch: this.webSearchSettings, 
          codeSettings: this.codeSettings,
          CLISettings: this.CLISettings,
          acpSettings: this.acpSettings,
          visionControlSettings: this.visionControlSettings,
          loveSettings: this.loveSettings,
          ccSettings: this.ccSettings,
          qcSettings: this.qcSettings,
          dsSettings: this.dsSettings,
          localEnvSettings: this.localEnvSettings,
          ocSettings: this.ocSettings,
          HASettings: this.HASettings,
          chromeMCPSettings: this.chromeMCPSettings,
          sqlSettings: this.sqlSettings,
          KBSettings: this.KBSettings,
          textFiles: this.textFiles,
          imageFiles: this.imageFiles,
          videoFiles: this.videoFiles,
          knowledgeBases: this.knowledgeBases,
          modelProviders: this.modelProviders,
          systemSettings: this.systemSettings,
          largeMoreButtonDict: this.largeMoreButtonDict,
          smallMoreButtonDict: this.smallMoreButtonDict,
          currentLanguage: this.currentLanguage,
          mcpServers: this.mcpServers,
          a2aServers: this.a2aServers,
          isdocker: this.isdocker,
          memories: this.memories,
          memorySettings: this.memorySettings,
          text2imgSettings: this.text2imgSettings,
          asrSettings: this.asrSettings,
          ttsSettings: this.ttsSettings,
          behaviorSettings: this.behaviorSettings,
          VRMConfig: this.VRMConfig,
          worldConfig: this.worldConfig,
          comfyuiServers: this.comfyuiServers,
          comfyuiAPIkey: this.comfyuiAPIkey,
          workflows: this.workflows,
          custom_http: this.customHttpTools,
          showBrowserChat: this.showBrowserChat,
          searchEngine: this.searchEngine,
          isGroupMode: this.isGroupMode,
          selectedGroupAgents: this.selectedGroupAgents,
        };
        const correlationId = uuid.v4();
        // Send the save request
        this.ws.send(JSON.stringify({
          type: 'save_settings',
          data: payload,
          correlationId: correlationId // Add a unique request ID
        }));
        // Set up the response listener
        const handler = (event) => {
          const response = JSON.parse(event.data);
          
          // Match the confirmation message for the corresponding request
          if (response.type === 'settings_saved' && 
              response.correlationId === correlationId) {
            this.ws.removeEventListener('message', handler);
            resolve();
          }
          
          // Error handling (depends on the backend implementation)
          if (response.type === 'save_error') {
            this.ws.removeEventListener('message', handler);
            reject(new Error('저장 실패'));
          }
        };
        // Set a 10-second timeout
        const timeout = setTimeout(() => {
          this.ws.removeEventListener('message', handler);
          reject(new Error('저장 시간 초과'));
        }, 10000);
        this.ws.addEventListener('message', handler);
      });
    },

    getSanitizedConversations() {
      // Use map to create a new array, without affecting the original in-memory data
      return this.conversations.map(conv => ({
        ...conv,
        // Sanitize the message list
        messages: conv.messages.map(msg => {
          // Use destructuring to exclude large/temporary properties that don't need saving
          const {
            audioChunks,      // Plain-TTS audio Blob URL (no use saving it)
            omniAudioChunks,  // The huge Base64 array of the PCM stream (the main thing to strip)
            ttsQueue,         // Runtime Set queue
            isPlaying,        // Playback state
            cur_audioDatas,   // Temporary Base64 data
            ...rest           // Keep role, content, pure_content, timestamp, fileLinks, etc.
          } = msg;

          // Return a clean message object
          return {
            ...rest,
            // Explicitly clear these fields to prevent stale data from lingering
            audioChunks: [],
            omniAudioChunks: [],
            currentChunk: 0,
            omniCurrentTime: 0,
            isPlaying: false
          };
        })
      }));
    },

    async saveConversations() {
      return new Promise((resolve, reject) => {
        const sanitizedConversations = this.getSanitizedConversations();

        const payload = {
          conversations: sanitizedConversations,
          conversationGroups: this.conversationGroups
        };
        const correlationId = uuid.v4();
        // Send the save request
        this.ws.send(JSON.stringify({
          type: 'save_conversations',
          data: payload,
          correlationId: correlationId // Add a unique request ID
        }));
        // Set up the response listener
        const handler = (event) => {
          const response = JSON.parse(event.data);
          
          // Match the confirmation message for the corresponding request
          if (response.type === 'conversations_saved' && 
              response.correlationId === correlationId) {
            this.ws.removeEventListener('message', handler);
            resolve();
          }
          
          // Error handling (depends on the backend implementation)
          if (response.type === 'save_error') {
            this.ws.removeEventListener('message', handler);
            reject(new Error('저장 실패'));
          }
        };
        // Set a 10-second timeout
        const timeout = setTimeout(() => {
          this.ws.removeEventListener('message', handler);
          reject(new Error('저장 시간 초과'));
        }, 10000);
        this.ws.addEventListener('message', handler);
      });
    },

    // The modified fetchModels method
    async fetchModels() {
      this.modelsLoading = true;
      try {
        const response = await fetch(`/v1/models`);
        const result = await response.json();
        
        // Double-destructure to get the data
        const { data } = result;
        
        this.models = data.map(item => ({
          id: item.id,
          created: new Date(item.created * 1000).toLocaleDateString(),
        }));
        
      } catch (error) {
        console.error('获取模型数据失败:', error);
        this.modelsError = error.message;
        this.models = []; // Make sure to clear the data
      } finally {
        this.modelsLoading = false;
      }
    },

    // The modified copyEndpoint method
    copyEndpoint() {
      navigator.clipboard.writeText(`${this.partyURL}/v1`)
        .then(() => {
          showNotification(this.t('copy_success'), 'success');
        })
        .catch(() => {
          showNotification(this.t('copy_fail'), 'error');
        });
    },

    copyMCPEndpoint(){
      navigator.clipboard.writeText(`${this.partyURL}/mcp`)
        .then(() => {
          showNotification(this.t('copy_success'), 'success');
        })
        .catch(() => {
          showNotification(this.t('copy_fail'), 'error');
        });
    },
    copyVrmEndpoint(){
      navigator.clipboard.writeText(`${this.partyURL}/vrm.html`)
        .then(() => {
          showNotification(this.t('copy_success'), 'success');
        })
        .catch(() => {
          showNotification(this.t('copy_fail'), 'error');
        });
    },
    copyURL(url) {
      navigator.clipboard.writeText(url)
        .then(() => {
          showNotification(this.t('copy_success'), 'success');
        })
        .catch(() => {
          showNotification(this.t('copy_fail'), 'error');
        });
    },
    copyModel() {
      navigator.clipboard.writeText('super-model')
        .then(() => {
          showNotification(this.t('copy_success'));
        })
        .catch(() => {
          showNotification(this.t('copy_fail'), 'error');
        });
    },

    toggleSection(section) {
      this.expandedSections[section] = !this.expandedSections[section]
      this.autoSaveSettings()
    },
    
    // New: handle clicking the header
    handleHeaderClick(section) {
      this.toggleSection(section)
    },
    async clearMessages(groupId = null) {
      this.stopGenerate();
      const targetGroupId = groupId || this.activeConversationGroupId || this.draftConversationGroupId || 'default';
      this.activeConversationGroupId = targetGroupId;
      this.draftConversationGroupId = targetGroupId;
      if (this.system_prompt){
        this.messages = [{ role: 'system', content: this.system_prompt }];
      } else {
        this.messages = [{ role: 'system', content: ' ' }];
      }
      this.conversationId = null;
      this.fileLinks = [];
      this.isThinkOpen = false; // Reset the thinking-mode state
      this.asyncToolsID = [];
      this.inAutoMode = false; // Reset the auto-mode state
      this.randomGreetings(); // Regenerate the random greeting
      this.requestScrollToBottom();    // Trigger a UI update
      this.autoSaveSettings();
      this.sendMessagesToExtension(); // Send the message to the plugin
    },


  async browseAllFiles() {
    if (!this.isElectron) {
      // Browser environment
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = true
      // Merge the accepted file types
      input.accept = ALL_ALLOWED_EXTENSIONS.map(ext => `.${ext}`).join(',')
      
      input.onchange = (e) => {
        const files = Array.from(e.target.files)
        // Unified validation: anything in the merged list is allowed
        const validFiles = files.filter(file => {
          const ext = file.name.split('.').pop()?.toLowerCase();
          return ALL_ALLOWED_EXTENSIONS.includes(ext);
        })
        this.handleFiles(validFiles)
      }
      input.click()
    } else {
      // Electron environment
      // Assumes your electronAPI.openFileDialog supports multi-select and returns paths
      const result = await window.electronAPI.openFileDialog(); 
      if (!result.canceled) {
        const files = await Promise.all(
          result.filePaths
            .filter(path => {
              const ext = path.split('.').pop()?.toLowerCase() || '';
              return ALL_ALLOWED_EXTENSIONS.includes(ext);
            })
            .map(async path => {
              const buffer = await window.electronAPI.readFile(path);
              const blob = new Blob([buffer]);
              return new File([blob], path.split(/[\\/]/).pop());
            })
        );
        this.handleFiles(files);
      }
    }
  },

    async sendFiles() {
      this.showUploadDialog = true;
      // Set up file-upload-specific handling
      this.currentUploadType = 'file';
    },
    async sendImages() {
      this.showUploadDialog = true;
      // Set up image-upload-specific handling
      this.currentUploadType = 'image';
    },
    browseFiles() {
      if (this.currentUploadType === 'image') {
        this.browseImages();
      } else {
        this.browseDocuments();
      }
    },
    
    // Handle image selection specifically
    async browseImages() {
      if (!this.isElectron) {
        const input = document.createElement('input')
        input.type = 'file'
        input.multiple = true
        input.accept = ALLOWED_IMAGE_EXTENSIONS.map(ext => `.${ext}`).join(',')
        
        input.onchange = (e) => {
          const files = Array.from(e.target.files)
          const validFiles = files.filter(this.isValidImageType)
          this.handleFiles(validFiles)
        }
        input.click()
      } else {
        const result = await window.electronAPI.openImageDialog();
        if (!result.canceled) {
          // Convert an Electron file path into a File object
          const files = await Promise.all(
            result.filePaths
              .filter(path => {
                const ext = path.split('.').pop()?.toLowerCase() || '';
                return ALLOWED_IMAGE_EXTENSIONS.includes(ext);
              })
              .map(async path => {
                // Read the file content and convert it into a File object
                const buffer = await window.electronAPI.readFile(path);
                const blob = new Blob([buffer]);
                return new File([blob], path.split(/[\\/]/).pop());
              })
          );
          this.handleFiles(files);
        }
      }
    },

    // File-selection handler
    async browseDocuments() {
      if (!this.isElectron) {
        const input = document.createElement('input')
        input.type = 'file'
        input.multiple = true
        input.accept = ALLOWED_EXTENSIONS.map(ext => `.${ext}`).join(',')
        
        input.onchange = (e) => {
          const files = Array.from(e.target.files)
          const validFiles = files.filter(this.isValidFileType)
          this.handleFiles(validFiles)
        }
        input.click()
      } else {
        const result = await window.electronAPI.openFileDialog();
        if (!result.canceled) {
          // Convert an Electron file path into a File object
          const files = await Promise.all(
            result.filePaths
              .filter(path => {
                const ext = path.split('.').pop()?.toLowerCase() || '';
                return ALLOWED_EXTENSIONS.includes(ext);
              })
              .map(async path => {
                // Read the file content and convert it into a File object
                const buffer = await window.electronAPI.readFile(path);
                const blob = new Blob([buffer]);
                return new File([blob], path.split(/[\\/]/).pop());
              })
          );
          this.handleFiles(files);
        }
      }
    },
    // File-selection handler
    async browseReadFiles() {
      if (!this.isElectron) {
        const input = document.createElement('input')
        input.type = 'file'
        input.multiple = true
        input.accept = ALLOWED_EXTENSIONS.map(ext => `.${ext}`).join(',')
        
        input.onchange = (e) => {
          const files = Array.from(e.target.files)
          const validFiles = files.filter(this.isValidFileType)
          this.handleReadFiles(validFiles)
        }
        input.click()
      } else {
        const result = await window.electronAPI.openFileDialog();
        if (!result.canceled) {
          // Convert an Electron file path into a File object
          const files = await Promise.all(
            result.filePaths
              .filter(path => {
                const ext = path.split('.').pop()?.toLowerCase() || '';
                return ALLOWED_EXTENSIONS.includes(ext);
              })
              .map(async path => {
                // Read the file content and convert it into a File object
                const buffer = await window.electronAPI.readFile(path);
                const blob = new Blob([buffer]);
                return new File([blob], path.split(/[\\/]/).pop());
              })
          );
          this.handleReadFiles(files);
        }
      }
    },

    // File-validation method
    isValidFileType(file) {
      if (this.currentUploadType === 'image') {
        return this.isValidImageType(file);
      }
      const ext = (file.name.split('.').pop() || '').toLowerCase()
      return ALLOWED_EXTENSIONS.includes(ext) || MIME_WHITELIST.some(mime => file.type.includes(mime))
    },
    isValidImageType(file) {
      const ext = (file.name.split('.').pop() || '').toLowerCase()
      return ALLOWED_IMAGE_EXTENSIONS.includes(ext) || IMAGE_MIME_WHITELIST.some(mime => file.type.includes(mime))
    },

  // Drag-drop handler
  async handleInputDrop(event) {
    this.isDragging = false;
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) {
      await this.handleFiles(files);
    }
  },

  // Paste handler (also supports pasting screenshots)
  handleInputPaste(event) {
    const items = event.clipboardData.items;
    const files = [];
    let hasFiles = false;
    
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
        files.push(items[i].getAsFile());
        hasFiles = true;
      }
    }
    
    if (hasFiles) {
      // Prevent default when there are files
      event.preventDefault();
      this.handleFiles(files);
    }
    // When there are no files, let the browser handle text paste normally
  },


    // Handle files uniformly
    async handleFiles(files) {
      // 1. Merge all allowed extensions for an initial filter
      const allAllowed = [...ALLOWED_VIDEO_EXTENSIONS, ...ALLOWED_IMAGE_EXTENSIONS, ...ALLOWED_EXTENSIONS];
      
      // 2. Iterate and process each selected file
      files.forEach(file => {
        try {
          const filename = file.name || (file.path && file.path.split(/[\\/]/).pop()) || '';
          const ext = filename.split('.').pop()?.toLowerCase() || '';

          // Check whether it's in the allowlist
          if (ALLOWED_IMAGE_EXTENSIONS.includes(ext)) {
            // If it's an image, add it via the image logic
            this.addFiles([file], 'image');
          } else if (ALLOWED_VIDEO_EXTENSIONS.includes(ext)) {
            // If it's a document, add it via the file logic
            this.addFiles([file], 'video');
          } else if (ALLOWED_EXTENSIONS.includes(ext)) {
            // If it's a document, add it via the file logic
            this.addFiles([file], 'file');
          } else {
            // Unsupported type
            console.warn(`不支持的文件类型: ${ext}`);
            // Optional: this.showErrorAlert('file'); 
          }
        } catch (e) {
          console.error('文件分拣错误:', e);
        }
      });
    },
    // Handle files uniformly
    async handleReadFiles(files) {
      this.showFileDialog = false;
      const allowedExtensions = this.currentUploadType === 'image' ? ALLOWED_IMAGE_EXTENSIONS : ALLOWED_EXTENSIONS;

      const validFiles = files.filter(file => {
        try {
          // Safely get the file extension
          const filename = file.name || (file.path && file.path.split(/[\\/]/).pop()) || '';
          const ext = filename.split('.').pop()?.toLowerCase() || '';
          return allowedExtensions.includes(ext);
        } catch (e) {
          console.error('文件处理错误:', e);
          return false;
        }
      });

      if (validFiles.length > 0) {
        const formData = new FormData();

        for (const file of validFiles) {
          formData.append('files', file, file.name);
        }

        try {
          console.log('Uploading files...');
          const response = await fetch(`/load_file`, {
            method: 'POST',
            body: formData
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.error('Server responded with an error:', errorText);
            showNotification(this.t('file_upload_failed'), 'error');
            return;
          }

          const data = await response.json();
          if (data.success) {      
            // Add the new file info to this.textFiles
            this.textFiles = [...data.textFiles,...this.textFiles];
            this.selectedFile = data.textFiles[0].unique_filename;
            this.autoSaveSettings();
            this.parseSelectedFile();
          } else {
            showNotification(this.t('file_upload_failed'), 'error');
          }
        } catch (error) {
          console.error('Error during file upload:', error);
          showNotification(this.t('file_upload_failed'), 'error');
        }
      } else {
        this.showErrorAlert(this.currentUploadType);
      }
    },
    clearLongText() {
      this.selectedFile = null;
      this.readConfig.longTextList = [];
      this.longTextListIndex = 0;
      this.readConfig.longText = '';
    },
    removeItem(index, type) {
      if (type === 'file') {
        this.files.splice(index, 1);
      } else {
        // If it's an image, remove it from the image list, accounting for this.files length
        index = index - this.files.length;
        this.images.splice(index, 1);
      }
    },
    // Error prompt
    showErrorAlert(type = 'file') {
      const fileTypes = {
        file: this.t('file_type_error'),
        image: this.t('image_type_error')
      };
      showNotification(fileTypes[type], 'error');
    },
    // Drag-and-drop handling
    handleDrop(event) {
      event.preventDefault()
      const files = Array.from(event.dataTransfer.files)
        .filter(this.isValidFileType)
      this.handleFiles(files)
    },
        // Drag-and-drop handling
    handleReadDrop(event) {
      event.preventDefault()
      const files = Array.from(event.dataTransfer.files)
        .filter(this.isValidFileType)
      this.handleReadFiles(files)
    },
    switchToApiBox() {
      // Switch to the API key-vault view
      this.activeMenu = 'model-config';
      this.subMenu = 'service';
    },

    // Add the file to the list
    addFiles(files, type = 'file') {
      // Decide which display array to store it in (both images and videos go into this.images for visual preview)
      const targetArray = type === 'image' || type === 'video' ? this.images : this.files;

      const newFiles = files.map(file => {
        // Do precise type detection here
        let detectedType = type; 

        return {
          path: URL.createObjectURL(file),
          name: file.name,
          file: file,
          detectedType: detectedType // Store the specific type: 'video', 'image', or 'file'
        };
      });

      targetArray.push(...newFiles);
      this.showUploadDialog = false;
    },
    highlightCode() {
      this.$nextTick(() => {
        document.querySelectorAll('pre code').forEach(block => {
          hljs.highlightElement(block);
        });
        this.initCopyButtons();
      });
    },
    async addProvider() {
      this.modelProviders.push({
        id: Date.now(),
        vendor: this.newProviderTemp.vendor,
        url: this.newProviderTemp.url,
        apiKey: '',
        modelId: '',
        isNew: true
      });
      this.newProviderTemp = { vendor: '', url: '', apiKey: '', modelId: '' };
      await this.autoSaveSettings();
    },
    async fetchModelsForProvider(provider) {
      try {
        console.log('Fetching models for provider:', provider.vendor);
        const response = await fetch(`/v1/providers/models`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: provider.url,
            api_key: provider.apiKey,
            vendor: provider.vendor
          })
        });
        if (!response.ok) {
          throw new Error('Failed to fetch models');
        }
        const data = await response.json();
        provider.models = data.data;
        showNotification(this.t('fetch_models_success'));
      } catch (error) {
        showNotification(this.t('fetch_models_failed'), 'error');
      }
    },
    // Find the original removeProvider method and replace it with the following code
    async removeProvider(index) {
      // Get the info of the provider being deleted
      const removedProvider = this.modelProviders[index];
      
      // Remove it from the provider list
      this.modelProviders.splice(index, 1);

      // Clean up references in all related configs
      const providerId = removedProvider.id;
      
      // Main-model config cleanup
      if (this.settings.selectedProvider === providerId) {
        this.settings.selectedProvider = null;
        this.settings.model = '';
        this.settings.base_url = '';
        this.settings.api_key = '';
      }

      // Reasoning-model config cleanup
      if (this.reasonerSettings.selectedProvider === providerId) {
        this.reasonerSettings.selectedProvider = null;
        this.reasonerSettings.model = '';
        this.reasonerSettings.base_url = '';
        this.reasonerSettings.api_key = '';
      }

      // Trigger auto-save
      await this.autoSaveSettings();
    },
    confirmAddProvider() {
      if (!this.newProviderTemp.vendor) {
        showNotification(this.t('vendor_required'), 'warning')
        return
      }
      
      const newProvider = {
        id: Date.now(),
        vendor: this.newProviderTemp.vendor,
        url: this.newProviderTemp.url,
        apiKey: this.newProviderTemp.apiKey || '',
        modelId: this.newProviderTemp.modelId || '',
        models: []
      }
      
      this.modelProviders.push(newProvider)
      this.showAddDialog = false
      this.newProviderTemp = { vendor: '', url: '', apiKey: '', modelId: '' }
      this.autoSaveSettings()
    },
    handleVendorChange(value) {
      const defaultUrls = {
        'OpenAI': 'https://api.openai.com/v1',
        'Deepseek': 'https://api.deepseek.com/v1',
        'aliyun': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        'ZhipuAI': 'https://open.bigmodel.cn/api/paas/v4',
        'Volcano': 'https://ark.cn-beijing.volces.com/api/v3',
        'moonshot': 'https://api.moonshot.cn/v1',
        'minimax': 'https://api.minimaxi.com/v1',
        'MiMo': 'https://api.xiaomimimo.com/v1',
        'longcat':'https://api.longcat.chat/openai/v1',
        'Ollama': this.isdocker ? 'http://host.docker.internal:11434/v1' : 'http://127.0.0.1:11434/v1',
        'Vllm': this.isdocker ? 'http://host.docker.internal:8000/v1' :'http://127.0.0.1:8000/v1',
        'LMstudio': this.isdocker ? 'http://host.docker.internal:1234/v1' :'http://127.0.0.1:1234/v1',
        'xinference': this.isdocker ? 'http://host.docker.internal:9997/v1' :'http://127.0.0.1:9997/v1',
        'Dify': this.isdocker ? 'http://host.docker.internal/v1' :'http://127.0.0.1/v1',
        'newapi': this.isdocker ? 'http://host.docker.internal:3000/v1' : 'http://127.0.0.1:3000/v1',
        'LocalAI': this.isdocker ? 'http://host.docker.internal:8080/v1' : 'http://127.0.0.1:8080/v1',
        'ttswebui': this.isdocker ? 'http://host.docker.internal:7778/v1' : 'http://127.0.0.1:7778/v1',
        'SGLang': this.isdocker ? 'http://host.docker.internal:3000/v1' : 'http://127.0.0.1:3000/v1', 
        'llama.cpp': this.isdocker ? 'http://host.docker.internal:8080/v1' : 'http://127.0.0.1:8080/v1',
        'Gemini': 'https://generativelanguage.googleapis.com',
        'Anthropic': 'https://api.anthropic.com/v1',
        'Grok': 'https://api.groq.com/openai/v1',
        'mistral': 'https://api.mistral.ai/v1',
        'lingyi': 'https://api.lingyiwanwu.com/v1',
        'baichuan': 'https://api.baichuan-ai.com/v1',
        'qianfan': 'https://qianfan.baidubce.com/v2',
        'hunyuan': 'https://api.hunyuan.cloud.tencent.com/v1',
        'siliconflow': 'https://api.siliconflow.cn/v1',
        '302.AI': 'https://api.302ai.cn/v1',
        'stepfun': 'https://api.stepfun.com/v1',
        'o3': 'https://api.o3.fan/v1',
        'aihubmix': 'https://aihubmix.com/v1',
        'ocoolai': 'https://api.ocoolai.com/v1',
        'Github': 'https://models.github.ai/inference',
        'dmxapi': 'https://www.dmxapi.cn/v1',
        'openrouter': 'https://openrouter.ai/api/v1',
        'together': 'https://api.together.xyz/v1',
        'fireworks': 'https://api.fireworks.ai/inference/v1',
        '360': 'https://api.360.cn/v1',
        'Nvidia': 'https://integrate.api.nvidia.com/v1',
        'hyperbolic': 'https://api.hyperbolic.xyz/v1',
        'jina': 'https://api.jina.ai/v1',
        'gitee': 'https://ai.gitee.com/v1',
        'ppinfra': 'https://api.ppinfra.com/v3/openai/v1',
        'perplexity': 'https://api.perplexity.ai',
        'infini': 'https://cloud.infini-ai.com/maas/v1',
        'modelscope': 'https://api-inference.modelscope.cn/v1',
        'tencent': 'https://api.lkeap.cloud.tencent.com/v1',
      }
      
      if (value !== 'custom' && value !== 'customAnthropic' ) {
        this.newProviderTemp.url = defaultUrls[value] || ''
      }
      if (value === 'Ollama') {
        this.newProviderTemp.apiKey = 'ollama'
      }
      if (value === 'Vllm') {
        this.newProviderTemp.apiKey = 'Vllm'
      }
      if (value === 'LMstudio') {
        this.newProviderTemp.apiKey = 'LMstudio'
      }
      if (value === 'xinference') {
        this.newProviderTemp.apiKey = 'xinference'
      }
      if (value === 'Dify') {
        this.newProviderTemp.modelId = 'dify'
      }
      if (value === 'SGLang') {
        this.newProviderTemp.apiKey = 'SGLang' // New
      }
      if (value === 'llama.cpp') {
        this.newProviderTemp.apiKey = 'llamacpp' // New
      }
    },
    // Rerank provider
    async selectRankProvider(providerId) {
      const provider = this.modelProviders.find(p => p.id === providerId);
      if (provider) {
        this.KBSettings.model = provider.modelId;
        this.KBSettings.base_url = provider.url;
        this.KBSettings.api_key = provider.apiKey;
        await this.autoSaveSettings();
      }
    },

    // Main-model provider selection
    async selectMainProvider(providerId) {
      const provider = this.modelProviders.find(p => p.id === providerId);
      console.log(provider)
      if (provider) {
        console.log("provider")
        this.settings.model = provider.modelId;
        this.settings.base_url = provider.url;
        this.settings.api_key = provider.apiKey;
        await this.autoSaveSettings();
      }
    },

    async selectFastProvider(providerId) {
      const provider = this.modelProviders.find(p => p.id === providerId);
      console.log(provider)
      if (provider) {
        console.log("provider")
        this.fastSettings.model = provider.modelId;
        this.fastSettings.base_url = provider.url;
        this.fastSettings.api_key = provider.apiKey;
        await this.autoSaveSettings();
      }
    },

    // Claude Code provider selection
    async selectCCProvider(providerId) {
      const provider = this.modelProviders.find(p => p.id === providerId);
      let vendor_list = {
        "Anthropic": "https://api.anthropic.com/",
        "Deepseek": "https://api.deepseek.com/anthropic/",
        "siliconflow": "https://api.siliconflow.cn/",
        "ZhipuAI":"https://open.bigmodel.cn/api/anthropic/",
        "moonshot":"https://api.moonshot.cn/anthropic/",
        "aliyun": "https://dashscope.aliyuncs.com/apps/anthropic/",
        "modelscope":"https://api-inference.modelscope.cn/",
        "302.AI":"https://api.302.ai/cc/"
      };

      let cc_url = vendor_list[provider.vendor] || provider.url;

      if (provider) {
        this.ccSettings.model = provider.modelId;
        this.ccSettings.base_url = cc_url;
        this.ccSettings.api_key = provider.apiKey;
        await this.autoSaveSettings();
      }
    },
    async selectQCProvider(providerId) {
      const provider = this.modelProviders.find(p => p.id === providerId);
      if (provider) {
        this.qcSettings.model = provider.modelId;
        this.qcSettings.base_url = provider.url;
        this.qcSettings.api_key = provider.apiKey;
        await this.autoSaveSettings();
      }
    },
    async selectOCProvider(providerId) {
      const provider = this.modelProviders.find(p => p.id === providerId);
      if (provider) {
        this.ocSettings.model = provider.modelId;
        this.ocSettings.base_url = provider.url;
        this.ocSettings.api_key = provider.apiKey;
        await this.autoSaveSettings();
      }
    },
    async selectBrainProvider(providerId) {
      // 1. Look up the details in the provider list
      const provider = this.modelProviders.find(p => p.id === providerId);

      // 2. Validate: ensure the provider was found and there's a brain-region config being edited
      if (provider && this.currentBrainSettings) {
        // 3. Sync the provider's details (model, url, key) into the current brain-region settings
        this.currentBrainSettings.model = provider.modelId;
        this.currentBrainSettings.base_url = provider.url;
        this.currentBrainSettings.api_key = provider.apiKey;

        // 4. Log for easier debugging
        console.log(`[${this.currentEditingKey}] 切换模型为: ${provider.modelId}`);

        // 5. Auto-save
        if (typeof this.autoSaveSettings === 'function') {
          await this.autoSaveSettings();
        }
      }
    },
    // Reasoning-model provider selection
    async selectReasonerProvider(providerId) {
      const provider = this.modelProviders.find(p => p.id === providerId);
      if (provider) {
        this.reasonerSettings.model = provider.modelId;
        this.reasonerSettings.base_url = provider.url;
        this.reasonerSettings.api_key = provider.apiKey;
        await this.autoSaveSettings();
      }
    },
    async selectVisionProvider(providerId) {
      const provider = this.modelProviders.find(p => p.id === providerId);
      if (provider) {
        this.visionSettings.model = provider.modelId;
        this.visionSettings.base_url = provider.url;
        this.visionSettings.api_key = provider.apiKey;
        await this.autoSaveSettings();
      }
    },
    async selectText2imgProvider(providerId) {
      const provider = this.modelProviders.find(p => p.id === providerId);
      if (provider) {
        this.text2imgSettings.model = provider.modelId;
        this.text2imgSettings.base_url = provider.url;
        this.text2imgSettings.api_key = provider.apiKey;
        this.text2imgSettings.vendor = provider.vendor;
        if (this.text2imgSettings.vendor === 'siliconflow') {
          this.text2imgSettings.size = '1024x1024';
        }
        else {
          this.text2imgSettings.size = 'auto';
        }
        await this.autoSaveSettings();
      }
    },
    async selectAsrProvider(providerId) {
      const provider = this.modelProviders.find(p => p.id === providerId);
      if (provider) {
        this.asrSettings.model = provider.modelId;
        this.asrSettings.base_url = provider.url;
        this.asrSettings.api_key = provider.apiKey;
        this.asrSettings.vendor = provider.vendor;
        await this.autoSaveSettings();
      }
    },
    async selectTTSProvider(providerId) {
      const provider = this.modelProviders.find(p => p.id === providerId);
      if (provider) {
        this.ttsSettings.model = provider.modelId;
        this.ttsSettings.base_url = provider.url;
        this.ttsSettings.api_key = provider.apiKey;
        this.ttsSettings.vendor = provider.vendor;
        await this.autoSaveSettings();
      }
    },
    handleTTSProviderVisibleChange(visible) {
      if (!visible) {
        this.selectTTSProvider(this.ttsSettings.selectedProvider);
      }
    },
    handleAsrProviderVisibleChange(visible) {
      if (!visible) {
        this.selectAsrProvider(this.asrSettings.selectedProvider);
      }
    },
    handleText2imgProviderVisibleChange(visible) {
      if (!visible) {
        this.selectText2imgProvider(this.text2imgSettings.selectedProvider);
      }
    },

    handleRankProviderVisibleChange(visible) {
      if (!visible) {
        this.selectRankProvider(this.KBSettings.selectedProvider);
      }
    },

    // Add inside methods
    handleMainProviderVisibleChange(visible) {
      if (!visible) {
        this.selectMainProvider(this.settings.selectedProvider);
      }
    },
    handleFastProviderVisibleChange(visible) {
      if (!visible) {
        this.selectFastProvider(this.fastSettings.selectedProvider);
      }
    },

    handleCCProviderVisibleChange(visible) {
      if (!visible) {
        this.selectCCProvider(this.ccSettings.selectedProvider);
      }
    },
    handleQCProviderVisibleChange(visible) {
      if (!visible) {
        this.selectQCProvider(this.qcSettings.selectedProvider);
      }
    },
    handleOCProviderVisibleChange(visible) {
      if (!visible) {
        this.selectOCProvider(this.ocSettings.selectedProvider);
      }
    },
    handleReasonerProviderVisibleChange(visible) {
      if (!visible) {
        this.selectReasonerProvider(this.reasonerSettings.selectedProvider);
      }
    },
    handleVisionProviderVisibleChange(visible) {
      if (!visible) {
        this.selectVisionProvider(this.visionSettings.selectedProvider);
      }
    },
    handleBrainProviderVisibleChange(visible) {
      // When the dropdown closes (!visible) and there's a selected provider ID
      if (!visible && this.currentBrainSettings && this.currentBrainSettings.selectedProvider) {
        this.selectBrainProvider(this.currentBrainSettings.selectedProvider);
      }
    },
    // Create a knowledge base
    async createKnowledgeBase() {
      try {
        // Upload files
        let uploadedFiles = [];
        if (this.newKbFiles.length > 0) {
          if (!this.isElectron) {
            // Browser environment: upload via FormData
            const formData = new FormData();
            for (const file of this.newKbFiles) {
              if (file.file instanceof Blob) {
                formData.append('files', file.file, file.name);
              } else {
                console.error("Invalid file object:", file);
                showNotification(this.t('invalid_file'), 'error');
                return;
              }
            }
  
            try {
              console.log('Uploading files...');
              const response = await fetch(`/load_file`, {
                method: 'POST',
                body: formData
              });
  
              if (!response.ok) {
                const errorText = await response.text();
                console.error('Server responded with an error:', errorText);
                showNotification(this.t('file_upload_failed'), 'error');
                return;
              }
  
              const data = await response.json();
              if (data.success) {
                uploadedFiles = data.fileLinks; // Get the uploaded file links
                // Add data.textFiles to this.textFiles
                this.textFiles = [...this.textFiles, ...data.textFiles];
                await this.autoSaveSettings();
              } else {
                showNotification(this.t('file_upload_failed'), 'error');
                return;
              }
            } catch (error) {
              console.error('Error during file upload:', error);
              showNotification(this.t('file_upload_failed'), 'error');
              return;
            }
          } else {
            // Electron environment: upload via JSON
            try {
              console.log('Uploading Electron files...');
              const response = await fetch(`/load_file`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  files: this.newKbFiles.map(file => ({
                    path: file.path,
                    name: file.name
                  }))
                })
              });
  
              if (!response.ok) {
                const errorText = await response.text();
                console.error('Server error:', errorText);
                showNotification(this.t('file_upload_failed'), 'error');
                return;
              }
  
              const data = await response.json();
              if (data.success) {
                uploadedFiles = data.fileLinks; // Get the uploaded file links
                // Add data.textFiles to this.textFiles
                this.textFiles = [...this.textFiles, ...data.textFiles];
                await this.autoSaveSettings();
              } else {
                showNotification(this.t('file_upload_failed'), 'error');
                return;
              }
            } catch (error) {
              console.error('上传错误:', error);
              showNotification(this.t('file_upload_failed'), 'error');
              return;
            }
          }
        }
  
        // Generate a unique ID
        const kbId = uuid.v4();
  
        // Build the new knowledge-base object using the uploaded file links
        const newKb = {
          id: kbId,
          name: this.newKb.name,
          introduction: this.newKb.introduction,
          providerId: this.newKb.providerId,
          model: this.newKb.model,
          base_url: this.newKb.base_url,
          api_key: this.newKb.api_key,
          enabled: true, // Enabled by default
          chunk_size: this.newKb.chunk_size,
          chunk_overlap: this.newKb.chunk_overlap,
          chunk_k: this.newKb.chunk_k,
          weight: this.newKb.weight,
          files: uploadedFiles.map(file => ({ // Use the file links returned by the server
            name: file.name,
            path: file.path,
          })),
          processingStatus: 'processing', // Set the processing status to 'processing'
        };
  
        // Update knowledgeBases in settings
        this.knowledgeBases = [...(this.knowledgeBases || []), newKb];
        // Manually trigger a modelProviders update so it syncs with the backend in real time
        this.modelProviders = this.modelProviders
        // Save settings
        await this.autoSaveSettings();
        // post kbId to the backend's create_kb endpoint
        try {
          // 1. Trigger the task
          const startResponse = await fetch(`/create_kb`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kbId }),
          });
          
          if (!startResponse.ok) throw new Error('시작 실패');
          // 2. Poll the status
          const checkStatus = async () => {
            try {
              const statusResponse = await fetch(`/kb_status/${kbId}`);
              
              // Handle HTTP error statuses
              if (!statusResponse.ok) {
                console.error('状态检查失败:', statusResponse.status);
                return 'failed'; // Return an explicit failure status
              }
              const data = await statusResponse.json();
              return data.status || 'unknown'; // Guard against undefined
            } catch (error) {
              console.error('状态检查异常:', error);
              return 'failed';
            }
          };
          // Modify the polling logic
          const interval = setInterval(async () => {
            try {
              const status = await checkStatus() || ''; // Ensure a default value exists
              
              const targetKb = this.knowledgeBases.find(k => k.id === kbId);
              if (!targetKb) {
                clearInterval(interval);
                return;
              }
              // Safe status check
              if (status === 'completed') {
                clearInterval(interval);
                targetKb.processingStatus = 'completed';
                showNotification(this.t('kb_created_successfully'), 'success');
                await this.autoSaveSettings();
              } else if (typeof status === 'string' && status.startsWith('failed')) { // Safe check
                clearInterval(interval);
                this.knowledgeBases = this.knowledgeBases.filter(k => k.id !== kbId);
                showNotification(this.t('kb_creation_failed'), 'error');
                await this.autoSaveSettings();
              }
            } catch (error) {
              console.error('轮询异常:', error);
              clearInterval(interval);
            }
          }, 2000);
        } catch (error) {
          console.error('知识库创建失败:', error);
          showNotification(this.t('kb_creation_failed'), 'error');
        }      
        this.showAddKbDialog = false;
        this.newKb = { 
          name: '', 
          introduction: '',
          providerId: null, 
          model: '', 
          base_url: '', 
          api_key: '',
          chunk_size: 1024,
          chunk_overlap: 256,
          chunk_k: 5,
          weight: 0.5,
        };
        this.newKbFiles = [];
      } catch (error) {
        console.error('知识库创建失败:', error);
        showNotification(this.t('kb_creation_failed'), 'error');
      }
    },

    // Delete a knowledge base
    async removeKnowledgeBase(kb) {
      try {
        // Filter the knowledgeBase to delete out of settings
        this.knowledgeBases = this.knowledgeBases.filter(
          item => item.id !== kb.id
        );
        let kbId = kb.id
        // Manually trigger a modelProviders update so it syncs with the backend in real time
        this.modelProviders = this.modelProviders
        const Response = await fetch(`/remove_kb`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kbId }),
        });

        if (!Response.ok) throw new Error('삭제 실패');

        // Save settings
        await this.autoSaveSettings();

        showNotification(this.t('kb_deleted_successfully'), 'success');
      } catch (error) {
        console.error('知识库删除失败:', error);
        showNotification(this.t('kb_deletion_failed'), 'error');
      }
    },

    // Toggle a knowledge base's enabled state
    async toggleKbEnabled(kb) {
      try {
        // Update the knowledgeBase's enabled state
        const kbToUpdateIndex = this.knowledgeBases.findIndex(
          item => item.id === kb.id
        );

        if (kbToUpdateIndex !== -1) {
          this.knowledgeBases[kbToUpdateIndex].enabled = kb.enabled;
          // Manually trigger a modelProviders update so it syncs with the backend in real time
          this.modelProviders = this.modelProviders
          // Save settings
          await this.autoSaveSettings();
          showNotification(this.t('kb')+` ${kb.name} ${kb.enabled ? this.t('enabled')  : this.t('disabled')}`, 'success');
        }
      } catch (error) {
        console.error('切换知识库状态失败:', error);
        showNotification(this.t('kb_status_change_failed'), 'error');
      }
    },
    // Select a provider
    selectKbProvider(providerId) {
      if (providerId == 'paraphrase-multilingual-MiniLM-L12-v2'){
        this.newKb.model = providerId;
        this.newKb.base_url = `${backendURL}/minilm`
        this.newKb.api_key = 'MiniLM';
        return;
      }

      const provider = this.modelProviders.find(p => p.id === providerId);
      if (provider) {
        this.newKb.model = provider.modelId;
        this.newKb.base_url = provider.url;
        this.newKb.api_key = provider.apiKey;
      }
    },

    // File-upload-related methods
    async browseKbFiles() {
        if (!this.isElectron) {
          const input = document.createElement('input')
          input.type = 'file'
          input.multiple = true
          input.accept = ALLOWED_EXTENSIONS.map(ext => `.${ext}`).join(',')
          
          input.onchange = (e) => {
            const files = Array.from(e.target.files)
            const validFiles = files.filter(this.isValidFileType)
            this.handleKbFiles(validFiles)
          }
          input.click()
        } else {
          const result = await window.electronAPI.openFileDialog();
          if (!result.canceled) {
            const validPaths = result.filePaths
              .filter(path => {
                const ext = path.split('.').pop()?.toLowerCase() || ''
                return ALLOWED_EXTENSIONS.includes(ext)
              })
            this.handleKbFiles(validPaths)
          }
        }
    },

    handleKbFiles(files) {
        if (files.length > 0) {
          this.addKbFiles(files)
        } else {
          this.showErrorAlert()
        }
    },
      // Add the file to the list
    addKbFiles(files) {
      const newFiles = files.map(file => {
        if (typeof file === 'string') { // Electron path
          return {
            path: file,
            name: file.split(/[\\/]/).pop()
          }
        }
        return { // Browser File object
          path: URL.createObjectURL(file),// Generate a temporary URL
          name: file.name,
          file: file
        }
      });
      
      this.newKbFiles = [...this.newKbFiles, ...newFiles];
    },
    async handleKbDrop(event) {
      event.preventDefault();
      const files = Array.from(event.dataTransfer.files)
        .filter(this.isValidFileType);
      this.handleKbFiles(files);
    },
    removeKbFile(index) {
      this.newKbFiles.splice(index, 1);
    },
    switchToKnowledgePage() {
      this.activeMenu = 'toolkit';  // Set according to your menu item's actual configured value
      this.subMenu = 'document';   // Set according to your submenu item's actual configured value
    },
    switchToKnowledgeConfig(){
      this.activeMenu = 'toolkit';  // Set according to your menu item's actual configured value
      this.subMenu = 'document';   // Set according to your submenu item's actual configured value
      this.activeKbTab='settings';
      this.showAddKbDialog=false;
    },
    switchToMemoryConfig(){
      this.activeMenu = 'role';  // Set according to your menu item's actual configured value
      this.subMenu = 'memory';   // Set according to your submenu item's actual configured value
      this.activeMemoryTab='config';
      this.showAddMemoryDialog=false;
    },
    switchToMemory(){
      this.activeMenu = 'role';
      this.subMenu = 'memory'; 
    },
    // Add inside methods
    t(key) {
      return this.translations[this.currentLanguage][key] || this.translations[this.currentLanguage]['en-US'] || key;
    },
    // 🐾 바로가기: 월드 펫 성격 다이얼로그를 열고 편집 버퍼를 프리필.
    openWorldPersonaDialog() {
      this.showWorldPersonaDialog = true;
      this.loadWorldPersona();
    },
    // 🌏 편집 버퍼(worldEdit)에 현재 유효 텍스트를 채우고 기본값(정규화 비교용)을 받아둔다.
    // worldConfig(저장되는 오버라이드)는 여기서 건드리지 않음 — 열기만 해도 굳던 문제 방지.
    async loadWorldPersona() {
      try {
        const r = await fetch('/api/world_persona');
        if (!r.ok) return;
        const data = await r.json();
        this.worldPersonaDefaults = data.defaults || {};
        const eff = data.effective || {};
        for (const k of Object.keys(eff)) this.worldEdit[k] = eff[k];
      } catch (e) { /* 백엔드 없으면 편집 버퍼 비어있음 */ }
    },
    // 편집 박스가 바뀔 때: 기본값과 같으면 오버라이드를 비우고(=서버 상수 사용), 다르면 오버라이드로 저장.
    saveWorldPersona() {
      for (const k of Object.keys(this.worldEdit)) {
        const v = (this.worldEdit[k] || '');
        const d = (this.worldPersonaDefaults[k] || '');
        this.worldConfig[k] = (v.trim() === d.trim()) ? '' : v;
      }
      this.autoSaveSettings();
    },
    // 💾 월드 데이터(배치·일기·소원·꽃·과일·펫 대화기억 등)를 zip 하나로 내려받는다 — 맥 교체·재설치 대비.
    worldBackup() {
      const a = document.createElement('a');
      a.href = '/api/world_backup';   // Content-Disposition: attachment → 창 이탈 없이 다운로드
      document.body.appendChild(a);
      a.click();
      a.remove();
    },
    // 📥 백업 zip을 골라 복원한다. 파일 입력을 즉석에서 만들어 POST.
    worldRestore() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.zip';
      input.onchange = async () => {
        const f = input.files && input.files[0];
        if (!f) return;
        try {
          const res = await fetch('/api/world_backup', { method: 'POST', body: f });
          const j = await res.json();
          if (j && j.ok) { if (this.$message) this.$message.success(`${j.restored}개 파일 복원 — 월드를 새로고침하면 적용돼요`); }
          else if (this.$message) this.$message.error(`복원 실패: ${(j && j.error) || res.status}`);
        } catch (e) {
          if (this.$message) this.$message.error('복원 실패 — 백엔드 연결을 확인해줘');
        }
      };
      input.click();
    },
    // VRM 데스크톱 펫 소환/숨김 전역 단축키를 (재)등록. 설정 변경 시에도 호출.
    async applyVrmVisibilityShortcuts() {
      if (!this.isElectron || !window.electronAPI?.registerVrmShowShortcut) return;
      const showKey = (this.VRMConfig && this.VRMConfig.showPetHotkey) || 'F14';
      const hideKey = (this.VRMConfig && this.VRMConfig.hidePetHotkey) || 'F15';
      try {
        const okShow = await window.electronAPI.registerVrmShowShortcut(showKey);
        if (!okShow) console.warn(`[VRM] show-pet hotkey ${showKey} failed to register`);
        const okHide = await window.electronAPI.registerVrmHideShortcut(hideKey);
        if (!okHide) console.warn(`[VRM] hide-pet hotkey ${hideKey} failed to register`);
      } catch (e) {
        console.error('[VRM] visibility shortcut registration error:', e);
      }
    },
    async handleSystemLanguageChange(val) {
      this.systemSettings.language = val;
      if (val === 'auto') {
        // Get the system setting; default 'en-US', or 'zh-CN' if the system language is Chinese
        const systemLanguage = navigator.language || navigator.userLanguage || 'en-US';
        val = systemLanguage.startsWith('zh') ? 'zh-CN' : systemLanguage.startsWith('ko') ? 'ko-KR' : 'en-US';
      }
      this.currentLanguage = val; // Update the current language
      await this.autoSaveSettings();
      this.$forceUpdate();
    },
    // renderer.js enhancement methods
    async handleThemeChange(val) {
      // Update the root attribute
      document.documentElement.setAttribute('data-theme', val);
      
      this.systemSettings.theme = val;

      await this.autoSaveSettings();
    },
    // Global font scaling: base 14px, range 0.85 ~ 1.5.
    // Electron uses webFrame.setZoomFactor for better anti-aliasing; other environments fall back to CSS zoom.
    async handleFontScaleChange(val) {
      const safe = Math.max(0.85, Math.min(1.5, Number(val) || 1));
      if (this.isElectron && window.electronAPI?.setZoomFactor) {
        try {
          window.electronAPI.setZoomFactor(safe);
        } catch (e) {
          document.documentElement.style.zoom = safe;
        }
      } else {
        document.documentElement.style.zoom = safe;
      }
      document.documentElement.style.setProperty('--app-zoom', String(safe));
      this.systemSettings.fontScale = safe;
      await this.autoSaveSettings();
    },
    resetFontScale() {
      this.handleFontScaleChange(1);
    },
    // Code-font scaling is independent: base 12px (from .markdown-body pre in github-markdown.css), range 0.83 ~ 1.67.
    // Only write --code-zoom; pre.code-block's calc(--code-zoom / --app-zoom) in styles.css cancels out the global scaling.
    async handleCodeFontScaleChange(val) {
      const safe = Math.max(0.83, Math.min(1.67, Number(val) || 1));
      document.documentElement.style.setProperty('--code-zoom', String(safe));
      this.systemSettings.codeFontScale = safe;
      await this.autoSaveSettings();
    },
    resetCodeFontScale() {
      this.handleCodeFontScaleChange(1);
    },
    async handleNetworkChange(val) {
      this.systemSettings.network = val;
      await window.electronAPI.setNetworkVisibility(val);
      this.showRestartDialog = true;
      await this.autoSaveSettings();
    },

    restartApp() {
      window.electronAPI.restartApp();
    },

    // Replace the method with:
    launchBrowserMode() {
      this.isBrowserOpening = true;
      
      setTimeout(() => {
        const url = this.partyURL;
        if (isElectron) {
          window.electronAPI.openExternal(url);
        } else {
          window.open(url, '_blank');
        }
        
        // Restore the state after 2 seconds
        setTimeout(() => {
          this.isBrowserOpening = false;
        }, 2000);
      }, 500);
    },
    launchAPIKeyManager() {
      this.isBrowserOpening = true;
      
      setTimeout(() => {
        const url = this.partyURL + '/token.html';
        if (isElectron) {
          window.electronAPI.openExternal(url);
        } else {
          window.open(url, '_blank');
        }
        
        // Restore the state after 2 seconds
        setTimeout(() => {
          this.isBrowserOpening = false;
        }, 2000);
      }, 500);
    },

    async getInternalIP() {
        try {
            const response = await fetch('/api/ip'); // Assumes the endpoint is on the same domain
            const data = await response.json();
            return data.ip;
        } catch (error) {
            console.error("Failed to fetch internal IP:", error);
            return "127.0.0.1";
        }
    },
    async generateQRCode() {
      // Ensure partyURL exists and the DOM is rendered
      if (!this.partyURL) return;
      // Get the LAN IP
      const internalIP = await this.getInternalIP();

      // Replace 127.0.0.1 or localhost in the URL, keeping the port and path
      const url = new URL(this.partyURL);
      if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
        url.hostname = internalIP;
      }
      let qr_url = url.toString();
      const canvas = document.getElementById('qrcode');

      // Generate a QR code
      QRCode.toCanvas(canvas, qr_url, function(error) {
            if (error) {
                console.error(error);
            } else {
                console.log("QR Code successfully generated!");
            }
        });
    },


    /**
     * Helper: build a config object from the current form/JSON input
     * Returns { mcpId, serversObj, inputStr }
     */
    buildCurrentMCPConfig() {
      let mcpId = "mcp";
      let servers = {};
      let inputStr = "";

      if (this.mcpInputType === 'json') {
        const input = this.newMCPJson.trim();
        const parsed = JSON.parse(input.startsWith('{') ? input : `{${input}}`);
        const parsedServers = parsed.mcpServers || parsed;
        mcpId = Object.keys(parsedServers)[0];
        servers = parsedServers[mcpId];
        inputStr = input;
      } else {
        mcpId = this.newMCPFormData.name;
        
        if (this.newMCPType === 'stdio') {
          servers = { "command": this.newMCPFormData.command };
          
          // args
          let args = this.newMCPFormData.args;
          if (args) {
             servers['args'] = args.split('\n').map(arg => arg.trim()).filter(arg => arg);
          }
          
          // env
          let env = this.newMCPFormData.env;
          if (env) {
            servers['env'] = env.split('\n').map(e => e.trim()).filter(e => e).reduce((acc, cur) => {
              const parts = cur.split('=');
              if (parts.length >= 2) {
                  const key = parts[0].trim();
                  const value = parts.slice(1).join('=').trim();
                  acc[key] = value;
              }
              return acc;
            }, {});
          }
        } else {
          servers = { "url": this.newMCPFormData.url };
          let ContentType = 'application/json';
          if (this.newMCPType == 'sse') ContentType = 'text/event-stream';
          else if (this.newMCPType == 'ws') ContentType = 'text/plain';
          
          if (this.newMCPFormData.apiKey && this.newMCPFormData.apiKey.trim() != '') {
            servers['headers'] = {
              "Authorization": `Bearer ${this.newMCPFormData.apiKey.trim()}`,
              "Content-Type": ContentType
            }
          }
        }

        // Build the input string for storage
        let inputObj = { "mcpServers": {} };
        inputObj.mcpServers[mcpId] = servers;
        inputStr = JSON.stringify(inputObj, null, 2);
      }

      return { mcpId, servers, inputStr };
    },

    /**
     * The modified add method: calls buildCurrentMCPConfig directly
     */
    async addMCPServer() {
      try {
        const { mcpId, servers, inputStr } = this.buildCurrentMCPConfig();

        // Update the local state
        this.mcpServers = {
          ...this.mcpServers,
          [mcpId]: {
            ...servers, // The new config
            processingStatus: 'initializing',
            disabled: true,
            type: this.newMCPType,
            input: inputStr,
            // If editing calls addMCPServer (i.e. restart), keep the original tools just in case, or clear them as needed
            // To avoid UI flicker, if the ID is the same, keep the old tools temporarily and overwrite once ready
            tools: (this.mcpServers[mcpId] && this.mcpServers[mcpId].tools) || []
          }
        };

        this.isSubmitting = true;
        this.currentEditingMCPId = mcpId;
        
        await this.autoSaveSettings();

        // Trigger background creation
        await fetch(`/create_mcp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mcpId })
        });

        // Poll the status
        await this.pollMCPStatus(mcpId); // Reuse the poll method written earlier

        // Switch mode on success
        this.isEditMode = true;
        this.activeDialogTab = 'tools';
      } catch (error) {
        console.error('MCP Add Error:', error);
        showNotification(error.message, 'error');
        if (this.currentEditingMCPId && this.mcpServers[this.currentEditingMCPId]) {
             this.mcpServers[this.currentEditingMCPId].processingStatus = 'server_error';
        }
      } finally {
        this.isSubmitting = false;
        await this.autoSaveSettings();
      }
    },

    /**
     * Update-config logic: intelligently decide whether a restart is needed
     */
    async updateMCPServerConfig() {
      const currentId = this.currentEditingMCPId;
      const oldServer = this.mcpServers[currentId];
      
      if (!oldServer) return;

      // 1. Get the config corresponding to the new form
      // Note: we only build the object here, not yet writing to this.mcpServers
      let newConfigData;
      try {
        newConfigData = this.buildCurrentMCPConfig();
      } catch (e) {
        showNotification(this.t('invalidConfig'), 'error');
        return;
      }
      
      const { servers: newServersObj } = newConfigData;

      // 2. Compare whether key fields changed (Command, Args, Env, Url, Headers)
      // Ignore state fields like tools, processingStatus, disabled
      const isConfigurationChanged = !this.isSameMCPConfig(oldServer, newServersObj);

      if (isConfigurationChanged) {
        // A. If the config changed -> run the full restart flow (i.e. addMCPServer)
        console.log("Configuration changed, restarting MCP...");
        await this.addMCPServer();
      } else {
        // B. If the config didn't change (just toggled the switch or clicked save) -> just close
        console.log("Configuration identical, skipping restart.");
        showNotification(this.t('settingsSaved'), 'success');
        this.showAddMCPDialog = false;
      }
    },

    /**
     * Deep-compare two MCP config objects (only the core connection parameters)
     */
    isSameMCPConfig(oldSrv, newSrv) {
      // Comparison helper
      const jsonEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

      // 1. Compare basic types
      // Note: oldSrv may contain extra fields; newSrv is a clean config object
      // We only check fields present in newSrv
      
      // StdIO check
      if (newSrv.command !== oldSrv.command) return false;
      if (!jsonEq(newSrv.args, oldSrv.args)) return false;
      if (!jsonEq(newSrv.env, oldSrv.env)) return false;

      // HTTP/SSE/WS check
      if (newSrv.url !== oldSrv.url) return false;
      if (!jsonEq(newSrv.headers, oldSrv.headers)) return false;

      return true;
    },

    // Add inside methods
    // Helper to open the add dialog
    openAddDialog() {
      this.showAddMCPDialog = true;
      this.activeDialogTab = 'config';
      this.isEditMode = false;
      this.isSubmitting = false;
      this.currentEditingMCPId = null;
      this.newMCPJson = '';
      this.newMCPFormData = { name: '', command: '', args: '', env: '', url: '', apiKey: '' };
      this.updateMCPExample();
    },

    // Reset the dialog state
    resetDialogState() {
        this.newMCPJson = '';
        this.isSubmitting = false;
        // Note: don't set showAddMCPDialog = false here, because this is the 'closed' event
    },

    // Extracted polling logic
    async pollMCPStatus(mcpId) {
       return new Promise((resolve, reject) => {
          let checkCount = 0;
          const maxChecks = 30; // e.g. 60-second timeout

          const interval = setInterval(async () => {
            checkCount++;
            try {
              const statusRes = await fetch(`/mcp_status/${mcpId}`);
              const data = await statusRes.json();
              const { status, tools } = data;

              if (status === 'ready') {
                clearInterval(interval);
                this.mcpServers[mcpId] = {
                  ...this.mcpServers[mcpId],
                  processingStatus: 'ready',
                  disabled: false,
                  tools: JSON.parse(tools)    
                };
                showNotification(this.t('mcpAdded'), 'success');
                resolve(true); // Success
              } else if (status.startsWith('failed') || status === 'server_error') {
                clearInterval(interval);
                this.mcpServers[mcpId].processingStatus = 'server_error';
                showNotification(this.t('mcpCreationFailed'), 'error');
                resolve(false); // Failed, but polling is considered finished too
              } else if (checkCount >= maxChecks) {
                clearInterval(interval);
                this.mcpServers[mcpId].processingStatus = 'server_error';
                reject(new Error("Timeout waiting for MCP server"));
              }
            } catch(e) {
               // Network errors, etc.
               clearInterval(interval);
               reject(e);
            }
          }, 2000);
       });
    },

    // Edit an existing server
    editMCPServer(name) {
      this.isEditMode = true;
      this.activeDialogTab = 'config';
      this.currentEditingMCPId = name;
      this.isSubmitting = false;

      const server = this.mcpServers[name];
      this.newMCPType = server.type || 'stdio'; // Default fallback
      this.newMCPJson = server.input;
      
      // Determine inputType by type (if there's input and it's mostly JSON, it's probably json; otherwise form)
      // For simplicity, when editMCPServer is called, we try to populate the form data
      this.mcpInputType = 'form'; // Or decide based on whether an input string exists

      this.newMCPFormData = {
        name: name,
        command: server.command || '',
        args: server.args ? server.args.join('\n') : '',
        env: server.env ? Object.entries(server.env).map(([k, v]) => `${k}=${v}`).join('\n') : '',
        url: server.url || '',
        apiKey: server.headers?.Authorization?.split(' ')[1] || '',
      };
      
      this.showAddMCPDialog = true;
    },

    async restartMCPServer(name) {
       // Keep the original logic, or open the dialog to show loading
       // Reuse the original logic here, but wrap it with try/catch
       this.mcpServers[name].processingStatus = 'initializing';
       // ... existing restart logic
       // If you want to see the dialog state on restart too, call editMCPServer(name) then auto-trigger the logic
       // But restart is usually a quick action on the card, so leaving it as-is is fine.
       // Just add the polling update:
       try {
         await fetch(`/create_mcp`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ mcpId: name })
            });
         this.pollMCPStatus(name); // Don't await; let it run in the background
       } catch(e) {
         console.error(e);
       }
    },
    async removeMCPServer(name) {
      this.deletingMCPName = name
      this.showMCPConfirm = true
    },
    // New confirmation method
    async confirmDeleteMCP() {
      try {
        const response = await fetch(`/remove_mcp`, {
          method: 'DELETE',
          headers: {
              'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            serverName: this.deletingMCPName
          })
        });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.detail || '삭제 실패');
        }
        
        showNotification(this.t('mcpDeleted'), 'success')
      } catch (error) {
        console.error('Error:', error.message)
        showNotification(this.t('mcpDeleteFailed'), 'error')
      } finally {
        const name = this.deletingMCPName
        const newServers = { ...this.mcpServers }
        delete newServers[name]
        this.mcpServers = newServers
        
        this.$nextTick(async () => {
          await this.autoSaveSettings();
        })
        this.showMCPConfirm = false
      }
    },

    /**
     * Watch input-method switching (Form <-> JSON)
     */
    handleInputMethodChange(val) {
      if (val === 'json') {
        // Was in Form mode, switching to JSON -> convert the form into JSON
        this.syncFormToJson();
      } else {
        // Was in JSON mode, switching to Form -> parse the JSON into the form
        this.syncJsonToForm();
      }
    },

    /**
     * Sync the form data into the JSON string
     */
    syncFormToJson() {
      // If the form name isn't even filled in, editing probably hasn't started, so don't overwrite the JSON
      if (!this.newMCPFormData.name) return;

      try {
        // Reuse the config-object-building logic written earlier (buildCurrentMCPConfig could be reused, but written separately here for independence)
        const mcpId = this.newMCPFormData.name;
        let servers = {};
        
        if (this.newMCPType === 'stdio') {
          servers = { "command": this.newMCPFormData.command };
          if (this.newMCPFormData.args) {
             servers['args'] = this.newMCPFormData.args.split('\n').map(arg => arg.trim()).filter(arg => arg);
          }
          if (this.newMCPFormData.env) {
            servers['env'] = this.newMCPFormData.env.split('\n').map(e => e.trim()).filter(e => e).reduce((acc, cur) => {
              const parts = cur.split('=');
              if (parts.length >= 2) acc[parts[0].trim()] = parts.slice(1).join('=').trim();
              return acc;
            }, {});
          }
        } else {
          servers = { "url": this.newMCPFormData.url };
          // Build the headers
          if (this.newMCPFormData.apiKey) {
            servers['headers'] = { "Authorization": `Bearer ${this.newMCPFormData.apiKey.trim()}` };
          }
        }

        const fullConfig = { mcpServers: { [mcpId]: servers } };
        this.newMCPJson = JSON.stringify(fullConfig, null, 2);
      } catch (e) {
        console.error("Sync Form to JSON failed:", e);
      }
    },

    /**
     * Sync the JSON string into the form data
     */
    syncJsonToForm() {
      if (!this.newMCPJson || !this.newMCPJson.trim()) return;

      try {
        const input = this.newMCPJson.trim();
        // Fault tolerance: support either a plain object or a full mcpServers structure
        const parsed = JSON.parse(input.startsWith('{') ? input : `{${input}}`);
        const serversMap = parsed.mcpServers || parsed;
        const names = Object.keys(serversMap);
        
        if (names.length === 0) return;

        const name = names[0]; // Take the first server
        const config = serversMap[name];

        // 1. Fill in the name
        this.newMCPFormData.name = name;

        // 2. Determine the type and fill in the fields
        if (config.command) {
          // It's the Stdio type
          this.newMCPType = 'stdio';
          this.newMCPFormData.command = config.command;
          this.newMCPFormData.args = Array.isArray(config.args) ? config.args.join('\n') : '';
          this.newMCPFormData.env = config.env ? Object.entries(config.env).map(([k, v]) => `${k}=${v}`).join('\n') : '';
        } else if (config.url) {
          // It's the HTTP/SSE/WS type
          // If newMCPType is still stdio, switch to sse; otherwise keep the user's choice (ws/streamablehttp)
          if (this.newMCPType === 'stdio') {
             this.newMCPType = 'sse'; 
          }
          this.newMCPFormData.url = config.url;
          
          // Try to extract the API key
          if (config.headers && config.headers.Authorization) {
            this.newMCPFormData.apiKey = config.headers.Authorization.replace('Bearer ', '');
          } else {
            this.newMCPFormData.apiKey = '';
          }
        }
      } catch (e) {
        console.warn("JSON parse failed during sync:", e);
        // The JSON may be malformed; don't force-overwrite the form, to avoid losing user data
      }
    },

      // Save the agent
    truncatePrompt(text) {
      return text.length > 100 ? text.substring(0, 100) + '...' : text;
    },
    async saveAgent() {
      const payload = {
        type: 'save_agent',
        data: {
          name: this.newAgent.name,
          system_prompt: this.newAgent.system_prompt
        }
      };
      this.ws.send(JSON.stringify(payload));
      this.showAgentForm = false;
      this.newAgent = {
        id: '',
        name: '',
        system_prompt: ''
      };
    },
    copyAgentId(id) {
      navigator.clipboard.writeText(id)
      showNotification(`Agent ID: ${id} copyed`, 'success');
    },
    copyAgentName(name) {
      navigator.clipboard.writeText(name)
      showNotification(`Agent Name: ${name} copyed`, 'success');
    },
    async removeAgent(id) {
      if (this.agents.hasOwnProperty(id)) {
        delete this.agents[id]
        this.agents = { ...this.agents }
        try {
          // Send a request to /delete_file
          const response = await fetch(`/remove_agent`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentId: id })
          });
          // Handle the response
          if (response.ok) {
            console.log('Agent deleted successfully');
            showNotification(this.t('AgentDeleted'), 'success');
          }
        } catch (error) {
          console.error('Error:', error);
          showNotification(this.t('AgentDeleteFailed'), 'error');
        }
      }
      await this.autoSaveSettings();
    },
    isValidUrl(url) {
      try {
        new URL(url);
        return true;
      } catch {
        return false;
      }
    },
    async addA2AServer() {
      try {
        this.showAddA2ADialog = false;
        const newurl = this.newA2AUrl;
        this.newA2AUrl = '';
        this.a2aServers = {
          ...this.a2aServers,
          [newurl]: {
            status: 'initializing',
          }
        };
        await this.autoSaveSettings();
        const response = await fetch(`/a2a`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: newurl })
        });
        
        const data = await response.json();
        this.a2aServers[newurl] = {
          ...this.a2aServers[newurl],
          ...data
        }

        await this.autoSaveSettings();
      } catch (error) {
        console.error('A2A初始化失败:', error);
        this.a2aServers = Object.fromEntries(Object.entries(this.a2aServers).filter(([k]) => k !== newurl));
        await this.autoSaveSettings();
        showNotification(this.t('a2aInitFailed'), 'error');
      }
    },
    async removeA2AServer(url) {
      this.a2aServers = Object.fromEntries(Object.entries(this.a2aServers).filter(([k]) => k !== url));
      await this.autoSaveSettings();
    },
    formatDate(date) {
      // Convert timestamp to date
      return new Date(date).toLocaleString();
    },
    async deleteFile(file) {
      console.log('deleteFile:', file);
      this.textFiles = this.textFiles.filter(f => f !== file);
      await this.autoSaveSettings();
      fileName = file.unique_filename
      try {
        // Send a request to /delete_file
        const response = await fetch(`/delete_file`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: fileName })
        });
        // Handle the response
        if (response.ok) {
          console.log('File deleted successfully');
          showNotification(this.t('fileDeleted'), 'success');
        }
      } catch (error) {
        console.error('Error:', error);
        showNotification(this.t('fileDeleteFailed'), 'error');
      }
    },
    // Top 'select all / deselect all'
    toggleAll(checked) {
      this.selectedFiles = checked
        ? this.textFiles.map(f => f.unique_filename)
        : [];
    },
    async batchDeleteFiles() {
      if (this.selectedFiles.length === 0) return;

      try {
        const res = await fetch('/delete_files', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileNames: this.selectedFiles })
        });
        const data = await res.json();

        // As long as the backend reports 'some succeeded', show success
        if (data.success && data.successFiles?.length) {
          // Remove the files the backend reported as successfully deleted
          this.textFiles = this.textFiles.filter(
            f => !data.successFiles.includes(f.unique_filename)
          );
          this.selectedFiles = [];          // Clear the selection
          showNotification(this.t('batchDeleteSuccess'), 'success');
          await this.autoSaveSettings();
        } else {
          console.log('batchDeleteFiles error:', data);
          showNotification(this.t('batchDeleteFailed'), 'error');
        }
      } catch (e) {
        console.log('batchDeleteFiles error:', data);
        showNotification(this.t('batchDeleteFailed'), 'error');
      }
    },

    // Toggle select-all for images
    toggleAllImages(checked) {
      this.selectedImages = checked
        ? this.imageFiles.map(i => i.unique_filename)
        : []
    },
    
    // Toggle select-all for videos
    toggleAllVideos(checked) {
      this.selectedVideos = checked
        ? this.videoFiles.map(v => v.unique_filename)
        : []
    },
    
    // Batch-delete images
    async batchDeleteImages() {
      if(!this.selectedImages.length) return
      
      try {
        const res = await fetch('/delete_files', {
          method: 'DELETE',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({fileNames: this.selectedImages})
        })
        
        if(res.ok) {
          // Update the frontend list
          this.imageFiles = this.imageFiles.filter(
            img => !this.selectedImages.includes(img.unique_filename)
          )
          this.selectedImages = []
          showNotification(this.t('batchDeleteSuccess'), 'success')
          await this.autoSaveSettings();
        }
      } catch(e) {
        showNotification(this.t('batchDeleteFailed'), 'error')
      }
    },
    
    // Batch-delete videos (reuses the same API)
    async batchDeleteVideos() {
      if(!this.selectedVideos.length) return
      try {
        const res = await fetch('/delete_files', {
          method: 'DELETE',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({fileNames: this.selectedVideos})
        })
        
        if(res.ok) {
          // Update the frontend list
          this.videoFiles = this.videoFiles.filter(
            img => !this.selectedVideos.includes(img.unique_filename)
          )
          this.selectedVideos = []
          showNotification(this.t('batchDeleteSuccess'), 'success')
          await this.autoSaveSettings();
        }
      } catch(e) {
        showNotification(this.t('batchDeleteFailed'), 'error')
      }
    },
    async deleteImage(img) {
      this.imageFiles = this.imageFiles.filter(i => i !== img);
      await this.autoSaveSettings();
      fileName = img.unique_filename
      try {
        // Send a request to /delete_file
        const response = await fetch(`/delete_file`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: fileName })
        });
        // Handle the response
        if (response.ok) {
          console.log('File deleted successfully');
          showNotification(this.t('fileDeleted'), 'success');
        }
      } catch (error) {
        console.error('Error:', error);
        showNotification(this.t('fileDeleteFailed'), 'error');
      }
    },
    getVendorLogo(vendor) {
      return this.vendorLogoList[vendor] || "source/providers/logo.png";
    },
    getMCPVendorLogo(vendor) {
      return this.MCPvendorLogoList[vendor] || "source/providers/logo.png";
    },
    getPromptVendorLogo(vendor) {
      return this.promptLogoList[vendor] || "source/providers/logo.png";
    },
    getCardVendorLogo(vendor) {
      return this.cardLogoList[vendor] || "source/providers/logo.png";
    },
    handleSelectVendor(vendor) {
      this.newProviderTemp.vendor = vendor;
      this.handleVendorChange(vendor);
    },

    selectMemoryProvider(providerId) {
      if (providerId == 'paraphrase-multilingual-MiniLM-L12-v2'){
        this.newMemory.model = providerId;
        this.newMemory.base_url = `${backendURL}/minilm`
        this.newMemory.api_key = 'MiniLM';
        return;
      }

      const provider = this.modelProviders.find(p => p.id === providerId);
      if (provider) {
        this.newMemory.model = provider.modelId;
        this.newMemory.base_url = provider.url;
        this.newMemory.api_key = provider.apiKey;
      }
    },

    // Clear the world-book entry
    clearBook(idx) {
      this.newMemory.characterBook[idx].keysRaw = '';
      this.newMemory.characterBook[idx].content = '';
    },
    /* World book */
    addBook() {
      this.newMemory.characterBook.push({ keysRaw: '', content: '' });
    },
    removeBook(idx) {
      this.newMemory.characterBook.splice(idx, 1);
    },
    clearGreeting(idx) {
      this.newMemory.alternateGreetings[idx] = '';
    },
    clearFirstMes() {
      this.newMemory.firstMes = '';
    },
    /* Delete alternate greeting */
    removeGreeting(idx) {
      this.newMemory.alternateGreetings.splice(idx, 1);
    },
    /* Add alternate greeting */
    addGreeting() {
      this.newMemory.alternateGreetings.push('');
    },
    async addMemory() {
      this.selectMemoryProvider(this.newMemory.providerId);

      /* ---- 0. Back up the old data (for the update case) ---- */
      const oldMemory = this.newMemory.id
        ? this.memories.find(m => m.id === this.newMemory.id)
        : 1024;

      /* ---- 1. Generate the in-memory object immediately (so the user sees it instantly) ---- */
      const build = (dims = 1024) => ({
        id: this.newMemory.id || uuid.v4(),
        name: this.newMemory.name,
        infer: this.newMemory.infer,
        providerId: this.newMemory.providerId,
        model: this.newMemory.model,
        api_key: this.newMemory.api_key,
        base_url: this.newMemory.base_url,
        embedding_dims: dims,
        vendor: this.newMemory.providerId
          ? this.modelProviders.find(p => p.id === this.newMemory.providerId)?.vendor || ''
          : '',
        description: this.newMemory.description,
        avatar: this.newMemory.avatar,
        personality: this.newMemory.personality,
        mesExample: this.newMemory.mesExample,
        systemPrompt: this.newMemory.systemPrompt,
        firstMes: this.newMemory.firstMes,
        alternateGreetings: this.newMemory.alternateGreetings.filter(Boolean),
        characterBook: this.newMemory.characterBook.filter(e => e.keysRaw.trim() || e.content.trim())
      });

      let memory;
      let insertIdx = -1;          // Used for the update case
      if (this.newMemory.id === null) {
        memory = build();
        this.memories.push(memory);
        if (this.memorySettings.selectedMemory === null) {
          this.memorySettings.selectedMemory = memory.id;
        }
      } else {
        insertIdx = this.memories.findIndex(m => m.id === this.newMemory.id);
        if (insertIdx === -1) return;
        memory = build(oldMemory?.embedding_dims ?? 1024);
        this.memories.splice(insertIdx, 1, memory);
      }
      this.showAddMemoryDialog = false;
      if (this.newMemory.providerId != null){
        /* ---- 2. Probe the dimension asynchronously (roll back on failure) ---- */
        try {
          const resp = await fetch('/api/embedding_dims', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              api_key:  this.newMemory.api_key,
              base_url: this.newMemory.base_url,
              model:    this.newMemory.model
            })
          });

          // ******** Key point ********
          if (!resp.ok) {                           // Both 4xx and 5xx land here
            const txt = await resp.text();
            throw new Error(`Embedding 인터페이스 오류 ${resp.status}: ${txt}`);
          }

          const { dims } = await resp.json();
          memory.embedding_dims = dims;
          await this.autoSaveSettings();          // Actually persist to disk
        } catch (e) {
          /* ---- 3. Roll back & notify ---- */
          if (this.newMemory.id === null) {
            // New: pop directly
            this.memories.pop();
            if (this.memorySettings.selectedMemory === memory.id) {
              this.memorySettings.selectedMemory = null;
            }
          } else {
            // Update: write the old memory back
            if (oldMemory) this.memories.splice(insertIdx, 1, oldMemory);
          }
          // Make sure the t function is available
          showNotification(this.t('EmbeddingFailed'), 'error');
          console.error('[addMemory] 探测维度失败', e);
          return;   // Don't continue
        }
      }

      /* ---- 4. Finish up ---- */
      this.resetNewMemory();
      this.changeMemory();
    },
    
    async removeMemory(id) {
      this.memories = this.memories.filter(m => m.id !== id);
      if (this.memorySettings.selectedMemory === id){
        this.memorySettings.selectedMemory = null;
      }
      try {
        // Send a request to /delete_file
        const response = await fetch(`/remove_memory`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ memoryId: id })
        });
        // Handle the response
        if (response.ok) {
          console.log('memory deleted successfully');
          showNotification(this.t('memoryDeleted'), 'success');
        }
      } catch (error) {
        console.error('Error:', error);
        showNotification(this.t('memoryDeleteFailed'), 'error');
      }
      await this.autoSaveSettings();
    },
    editMemory(id) {
      const memory = this.memories.find(m => m.id === id);
      if (memory) {
        this.newMemory = { ...memory };
        if (this.newMemory.characterBook.length === 0){
          this.newMemory.characterBook = [{ keysRaw: '', content: '' }];
        }
        this.showAddMemoryDialog = true;
      }
    },

    
    getVendorName(providerId) {
      if (providerId == 'paraphrase-multilingual-MiniLM-L12-v2'){
        return `${this.t("model")}:${providerId}`;
      }
      const provider = this.modelProviders.find(p => p.id === providerId);
      return provider ? `${this.t("model")}:${provider.modelId}` : this.t("NoLongTermMemory");
    },
    async saveCustomHttpTool() {
      const toolData = { ...this.newCustomHttpTool };
      
      if (this.editingCustomHttpTool) {
        // Update the existing tool
        const index = this.customHttpTools.findIndex(tool => tool.id === toolData.id);
        if (index !== -1) {
          this.customHttpTools.splice(index, 1, toolData);
        }
      } else {
        // Add a new tool
        toolData.id = uuid.v4();
        this.customHttpTools.push(toolData);
      }
      
      // Sync the data with the backend
      await this.autoSaveSettings();
      
      // Reset the form
      this.newCustomHttpTool = {
        enabled: true,
        name: '',
        description: '',
        url: '',
        method: 'GET',
        headers: '',
        body: ''
      };
      this.showCustomHttpToolForm = false;
      this.editingCustomHttpTool = false;
    },
    editCustomHttpTool(id) {
      const tool = this.customHttpTools.find(tool => tool.id === id);
      if (tool) {
        this.newCustomHttpTool = { ...tool };
        this.showCustomHttpToolForm = true;
        this.editingCustomHttpTool = true;
      }
    },
    async removeCustomHttpTool(id) {
      this.customHttpTools = this.customHttpTools.filter(tool => tool.id !== id);
      await this.autoSaveSettings();
    },
async startTelegramBot() {
  this.isTelegramStarting = true;
  try {
    showNotification(this.t('notifyConnectingTelegram'), 'info');
    const res = await fetch('/start_telegram_bot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.telegramBotConfig)
    });
    const json = await res.json();
    if (json.success) {
      this.isTelegramBotRunning = true;
      showNotification(this.t('notifyTelegramStarted'), 'success');
    } else {
      showNotification(`${this.t('notifyStartFailedColon')}${json.message}`, 'error');
    }
  } catch (e) {
    showNotification(this.t('notifyNetworkErrorOrNoResponse'), 'error');
  } finally {
    this.isTelegramStarting = false;
  }
},
async stopTelegramBot() {
  this.isTelegramStopping = true;
  try {
    const res = await fetch('/stop_telegram_bot', { method: 'POST' });
    const json = await res.json();
    if (json.success) {
      this.isTelegramBotRunning = false;
      showNotification(this.t('notifyTelegramStopped'), 'success');
    } else {
      showNotification(`${this.t('notifyStopFailedColon')}${json.message}`, 'error');
    }
  } catch (e) {
    showNotification(this.t('notifyNetworkErrorOrNoResponse'), 'error');
  } finally {
    this.isTelegramStopping = false;
  }
},
async reloadTelegramBotConfig() {
  this.isTelegramReloading = true;
  try {
    const res = await fetch('/reload_telegram_bot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.telegramBotConfig)
    });
    const json = await res.json();
    if (json.success) {
      showNotification(this.t('notifyTelegramReloaded'), 'success');
    } else {
      showNotification(`${this.t('notifyReloadFailedColon')}${json.message}`, 'error');
    }
  } catch (e) {
    showNotification(this.t('notifyNetworkErrorOrNoResponse'), 'error');
  } finally {
    this.isTelegramReloading = false;
  }
},
async checkTelegramBotStatus() {
  try {
    const res = await fetch('/telegram_bot_status');
    const st = await res.json();
    this.isTelegramBotRunning = st.is_running;
  } catch (e) {
    console.error('检查 Telegram 机器人状态失败', e);
  }
},
handleCreateTelegramSeparator(val) {
  this.telegramBotConfig.separators.push(val);
},

/* ------- Discord bot ------- */
async startDiscordBot() {
  this.isDiscordStarting = true;
  try {
    showNotification(this.t('notifyConnectingDiscord'), 'info');
    const res = await fetch('/start_discord_bot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.discordBotConfig),
    });
    const json = await res.json();
    if (json.success) {
      this.isDiscordBotRunning = true;
      showNotification(this.t('notifyDiscordStarted'), 'success');
    } else {
      showNotification(`${this.t('notifyStartFailedColon')}${json.message}`, 'error');
    }
  } catch (e) {
    showNotification(this.t('notifyNetworkErrorOrNoResponse'), 'error');
  } finally {
    this.isDiscordStarting = false;
  }
},
async stopDiscordBot() {
  this.isDiscordStopping = true;
  try {
    const res = await fetch('/stop_discord_bot', { method: 'POST' });
    const json = await res.json();
    if (json.success) {
      this.isDiscordBotRunning = false;
      showNotification(this.t('notifyDiscordStopped'), 'success');
    } else {
      showNotification(`${this.t('notifyStopFailedColon')}${json.message}`, 'error');
    }
  } catch (e) {
    showNotification(this.t('notifyNetworkErrorOrNoResponse'), 'error');
  } finally {
    this.isDiscordStopping = false;
  }
},
async reloadDiscordBot() {
  this.isDiscordReloading = true;
  try {
    const res = await fetch('/reload_discord_bot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.discordBotConfig),
    });
    const json = await res.json();
    if (json.success) {
      showNotification(this.t('notifyDiscordReloaded'), 'success');
    } else {
      showNotification(`${this.t('notifyReloadFailedColon')}${json.message}`, 'error');
    }
  } catch (e) {
    showNotification(this.t('notifyNetworkErrorOrNoResponse'), 'error');
  } finally {
    this.isDiscordReloading = false;
  }
},
async checkDiscordBotStatus() {
  try {
    const res = await fetch('/discord_bot_status');
    const st = await res.json();
    this.isDiscordBotRunning = st.is_running;
  } catch (e) {
    console.error('检查 Discord 机器人状态失败', e);
  }
},
handleCreateDiscordSeparator(val) {
  this.discordBotConfig.separators.push(val);
},

async requestSlackBotStopIfRunning() {
    try {
      // 1. First confirm the Slack bot's actual running state from the backend
      const response = await fetch(`/slack_bot_status`);
      const status = await response.json();

      // 2. If the backend reports it's running (is_running is true)
      if (status.is_running) {
        // 3. Call the stopSlackBot method you wrote earlier in methods
        // That method includes the stop logic, loading-state toggle, and showNotification
        await this.stopSlackBot();
        console.log('Slack 机器人已应系统请求成功关闭');
      }
    } catch (error) {
      // Catch network errors or the case where the backend isn't started
      console.error('检查或停止 Slack 机器人失败:', error);
    }
  },

/* ------- Slack bot ------- */
async startSlackBot() {
  this.isSlackStarting = true;
  try {
    showNotification(this.t('notifyConnectingSlack'), 'info');
    // Note: this sends slackBotConfig, but the backend automatically handles the shared memorySettings state
    const res = await fetch('/start_slack_bot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...this.slackBotConfig,
        // Explicitly pass the memory config so the backend gets the latest
        memory_settings: this.memorySettings 
      }),
    });
    const json = await res.json();
    if (json.success) {
      this.isSlackBotRunning = true;
      showNotification(this.t('notifySlackStarted'), 'success');
    } else {
      showNotification(`${this.t('notifyStartFailedColon')}${json.message}`, 'error');
    }
  } catch (e) {
    showNotification(this.t('notifyNetworkErrorOrNoResponse'), 'error');
  } finally {
    this.isSlackStarting = false;
  }
},
async stopSlackBot() {
  this.isSlackStopping = true;
  try {
    const res = await fetch('/stop_slack_bot', { method: 'POST' });
    const json = await res.json();
    if (json.success) {
      this.isSlackBotRunning = false;
      showNotification(this.t('notifySlackStopped'), 'success');
    } else {
      showNotification(`${this.t('notifyStopFailedColon')}${json.message}`, 'error');
    }
  } catch (e) {
    showNotification(this.t('notifyNetworkError'), 'error');
  } finally {
    this.isSlackStopping = false;
  }
},
async reloadSlackBot() {
  this.isSlackReloading = true;
  try {
    const res = await fetch('/reload_slack_bot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...this.slackBotConfig,
        memory_settings: this.memorySettings
      }),
    });
    const json = await res.json();
    if (json.success) {
      showNotification(this.t('notifySlackReloaded'), 'success');
    } else {
      showNotification(`${this.t('notifyReloadFailedColon')}${json.message}`, 'error');
    }
  } catch (e) {
    showNotification(this.t('notifyNetworkError'), 'error');
  } finally {
    this.isSlackReloading = false;
  }
},
async checkSlackBotStatus() {
  try {
    const res = await fetch('/slack_bot_status');
    const st = await res.json();
    this.isSlackBotRunning = st.is_running;
  } catch (e) {
    console.error('检查 Slack 状态失败', e);
  }
},
handleCreateSlackSeparator(val) {
  this.slackBotConfig.separators.push(val);
},

    formatSeparator(s) {
      return s.replace(/\n/g, '\\n')
              .replace(/\t/g, '\\t')
              .replace(/\r/g, '\\r');
    },
    // New: handler for creating a separator
    async handleCreateSeparator(newSeparator) {
      const processed = this.escapeSeparator(newSeparator)
      if (!this.ttsSettings.separators.includes(processed)) {
        this.ttsSettings.separators.push(processed)
        await this.autoSaveSettings()
      }
    },

    // Handle the enter-key conflict
    handleEnter(e) {
      if (e.target.value) {
        e.stopPropagation()
      }
    },

    escapeSeparator(s) {
      return s.replace(/\\n/g, '\n').replace(/\\t/g, '\t')
    },

    // One-click reset
    resetNewMemory() {
      this.newMemory = {
        id: null,
        name: '',
        infer:false,
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
      };
    },
    copyExistingMemoryData(selectedId) {
      const src = this.memories.find(m => m.id === selectedId);
      if (src) {
        /* Map old fields to new ones; use defaults where absent */
        this.newMemory = {
          id: null,
          name: src.name || '',
          infer: src.infer || false,
          providerId: src.providerId || null,
          model: src.model || '',
          base_url: src.base_url || '',
          api_key: src.api_key || '',
          vendor: src.vendor || '',

          /* old -> new */
          description: src.basic_character || src.description || '',
          avatar: src.avatar || '',
          personality: src.personality || '',
          mesExample: src.mesExample || '',
          systemPrompt: src.systemPrompt || '',
          firstMes: src.firstMes || (Array.isArray(src.random) ? src.random[0]?.value : ''),
          alternateGreetings:
            Array.isArray(src.alternateGreetings)
              ? src.alternateGreetings
              : (src.random || []).slice(1).map(r => r.value),
          characterBook:
            Array.isArray(src.characterBook)
              ? src.characterBook
              : (src.lorebook || []).map(l => ({
                  keysRaw: l.name,
                  content: l.value
                }))  
        };
           if (this.newMemory.characterBook.length == 0 ){
              this.newMemory.characterBook = [{ keysRaw: '', content: '' }]
           }   
      } else {
        /* New: just give an empty template */
        this.resetNewMemory();
      }
    },
    colorBlend(color1, color2, ratio) {
        // Ensure ratio is within 0-1
        ratio = Math.max(0, Math.min(1, ratio));
        
        // Parse the hex color value
        const parseHex = (hex) => {
          hex = hex.replace(/^#/, '');
          // Handle the 3-digit shorthand format
          if (hex.length === 3) {
            hex = hex.split('').map(char => char + char).join('');
          }
          return {
            r: parseInt(hex.substring(0, 2), 16),
            g: parseInt(hex.substring(2, 4), 16),
            b: parseInt(hex.substring(4, 6), 16)
          };
        };

        // Convert to a two-digit hex string
        const toHex = (value) => {
          const hex = Math.round(value).toString(16);
          return hex.length === 1 ? '0' + hex : hex;
        };

        const rgb1 = parseHex(color1);
        const rgb2 = parseHex(color2);

        // Compute the blended RGB values
        const r = rgb1.r * ratio + rgb2.r * (1 - ratio);
        const g = rgb1.g * ratio + rgb2.g * (1 - ratio);
        const b = rgb1.b * ratio + rgb2.b * (1 - ratio);

        // Combine into a hex color
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
      },
      toggleInputExpand() {
        this.isInputExpanded = !this.isInputExpanded
    },
    onChatInputFocus() {
      this.isChatInputActive = true;
    },
    // After the textarea blurs, wait one frame before deciding, giving the pill/dialog click time to land
    onChatInputBlur() {
      setTimeout(() => {
        const active = document.activeElement;
        const wrappers = document.querySelectorAll('.unified-input-wrapper');
        for (const w of wrappers) {
          if (w.contains(active)) return;
        }
        this.isChatInputActive = false;
      }, 200);
    },
    checkMobile() {
      this.isMobile = window.innerWidth <= 768;
      this.isAssistantMode = window.innerWidth <= 350 && window.innerHeight <= 820;
      this.isCapsuleMode = window.innerWidth <= 220 && window.innerHeight <= 100;
      if (this.isMobile) {
        this.MoreButtonDict = this.smallMoreButtonDict;
      }
      else{
        this.MoreButtonDict = this.largeMoreButtonDict;
      }
      if (this.isAssistantMode){
        if(!this.isFixedWindow){
          this.isFixedWindow = true;
          if (isElectron){
            window.electronAPI.setAlwaysOnTop(this.isFixedWindow);
          }
        }
        
      }else{
        if(this.isFixedWindow){
          this.isFixedWindow = false;
          if (isElectron){
            window.electronAPI.setAlwaysOnTop(this.isFixedWindow);
          }
        }
      }
      if(this.isMobile) this.sidebarVisible = false;
    },
    // Add a ComfyUI server
    addComfyUIServer() {
      this.comfyuiServers.push('http://localhost:8188')
      this.autoSaveSettings()
    },

    // Remove a server
    removeComfyUIServer(index) {
      if (this.comfyuiServers.length > 1) {
        this.comfyuiServers.splice(index, 1)
        this.autoSaveSettings()
      }
    },

    // Connect to the server
    async connectComfyUI(index) {
      this.isConnecting = true
      try {
        const url = this.comfyuiServers[index]
        const response = await fetch(`${url}/history`, {
          method: 'HEAD',
          mode: 'cors'
        })
        if (response.ok) {
          this.activeComfyUIUrl = url
          showNotification(this.t('notifyServerConnected'))
        }
      } catch (e) {
        showNotification(this.t('notifyComfyuiConnectFailed'), 'error')
      }
      this.isConnecting = false
    },
    // Browse for a file
    browseWorkflowFile() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = (event) => {
        const files = event.target.files;
        if (files.length > 0) {
          this.workflowFile = files[0];
          this.loadWorkflowFile(this.workflowFile); // Make sure it's called after a file is selected
        }
      };
      input.click();
    },
    // Remove the file
    removeWorkflowFile() {
      this.workflowFile = null;
    },
    // Delete the workflow
    async deleteWorkflow(filename) {
      try {
        const response = await fetch(`/delete_workflow/${filename}`, {
          method: 'DELETE',
        });
        const data = await response.json();
        if (data.success) {
          this.workflows = this.workflows.filter(file => file.unique_filename !== filename);
          await this.autoSaveSettings();
          showNotification(this.t('notifyDeleteSuccess'));
        } else {
          this.workflows = this.workflows.filter(file => file.unique_filename !== filename);
          await this.autoSaveSettings();
          showNotification(this.t('notifyDeleteFailed'), 'error');
        }
      } catch (error) {
        console.error('删除失败:', error);
       showNotification(this.t('notifyDeleteFailed'), 'error');
      }
    },
      // Handle file drag-and-drop
  handleWorkflowDrop(event) {
    event.preventDefault();
    const files = event.dataTransfer.files;
    if (files.length > 0) {
      this.workflowFile = files[0];
      this.loadWorkflowFile(this.workflowFile); // Load the workflow file to generate the options
    }
  },
  
  // Load the workflow file
  async loadWorkflowFile(file) {
    const reader = new FileReader();
    reader.onload = (event) => {
      const workflowJson = JSON.parse(event.target.result);
      this.populateInputOptions(workflowJson);
    };
    reader.readAsText(file);
  },

  // Populate the input options
  populateInputOptions(workflowJson) {
    this.textInputOptions = [];
    this.imageInputOptions = [];
    this.seedInputOptions = [];
    
    for (const nodeId in workflowJson) {
      const node = workflowJson[nodeId];
      if (!node.inputs) continue;
      
      // Find all text-input fields containing text/value/prompt
      const textInputKeys = Object.keys(node.inputs).filter(key => 
        (key.includes('text') || key.includes('value') || key.includes('prompt')) &&
        typeof node.inputs[key] === 'string' // Ensure the value is a string
      );
      
      // Create an option for each matching field
      textInputKeys.forEach(key => {
        this.textInputOptions.push({
          label: `${node._meta.title} - ${key} (ID: ${nodeId})`,
          value: { nodeId, inputField: key, id : `${nodeId}-${key}` },
        });
      });
      
      // Find image-input fields
      if (node.class_type === 'LoadImage') {
        const imageKeys = Object.keys(node.inputs).filter(key => 
          key.includes('image') && 
          typeof node.inputs[key] === 'string' // Ensure the value is a string
        );
        
        imageKeys.forEach(key => {
          this.imageInputOptions.push({
            label: `${node._meta.title} - ${key} (ID: ${nodeId})`,
            value: { nodeId, inputField: key, id : `${nodeId}-${key}` },
          });
        });
      }

      // Find all seed-input fields containing 'seed'
      const seedInputKeys = Object.keys(node.inputs).filter(
        key => key.includes('seed') && typeof node.inputs[key] === 'number' // Ensure the value is a number
      )
      seedInputKeys.forEach(key => {
        this.seedInputOptions.push({
          label: `${node._meta.title} - ${key} (ID: ${nodeId})`,
          value: { nodeId, inputField: key, id : `${nodeId}-${key}` },
        });
      })
    }
  },

    // Upload files
    async uploadWorkflow() {
      if (!this.workflowFile) return;

      const formData = new FormData();
      formData.append('file', this.workflowFile);

      // Record the selected input position
      const workflowData = {
        textInput: this.selectedTextInput,
        textInput2: this.selectedTextInput2,
        imageInput: this.selectedImageInput,
        imageInput2: this.selectedImageInput2,
        seedInput: this.selectedSeedInput,
        seedInput2: this.selectedSeedInput2,
        description: this.workflowDescription,
      };

      // Send the JSON string as a plain field
      formData.append('workflow_data', JSON.stringify(workflowData));

      try {
        const response = await fetch(`/add_workflow`, {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) { // Check the response status
          const errorText = await response.text(); // Get the error text
          console.error("Server error:", errorText); // Output the error message
          throw new Error("Server error");
        }

        const data = await response.json();
        if (data.success) {
          this.workflows.push(data.file);
          this.showWorkflowUploadDialog = false;
          this.workflowFile = null;
          this.selectedTextInput = null; // Reset the selection
          this.selectedImageInput = null; // Reset the selection
          this.selectedTextInput2 = null; // Reset the selection
          this.selectedImageInput2 = null; // Reset the selection
          this.selectedSeedInput = null; // Reset the selection
          this.selectedSeedInput2 = null; // Reset the selection
          this.workflowDescription = ''; // Clear the description
          await this.autoSaveSettings();
          showNotification(this.t('notifyUploadSuccess'));
        } else {
          showNotification(this.t('notifyUploadFailed'), 'error');
        }
      } catch (error) {
        console.error('上传失败:', error);
        showNotification(this.t('notifyUploadFailed'), 'error');
      }
    },
    cancelWorkflowUpload() {
      this.showWorkflowUploadDialog = false;
      this.workflowFile = null;
      this.selectedTextInput = null; // Reset the selection
      this.selectedImageInput = null; // Reset the selection
      this.selectedTextInput2 = null; // Reset the selection
      this.selectedImageInput2 = null; // Reset the selection
      this.selectedSeedInput = null; // Reset the selection
      this.selectedSeedInput2 = null; // Reset the selection
      this.workflowDescription = ''; // Clear the description
    },
    async deleteVideo(video) {
      this.videoFiles = this.videoFiles.filter(i => i !== video);
      await this.autoSaveSettings();
      fileName = video.unique_filename
      try {
        // Send a request to /delete_file
        const response = await fetch(`/delete_file`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: fileName })
        });
        // Handle the response
        if (response.ok) {
          console.log('File deleted successfully');
          showNotification(this.t('fileDeleted'), 'success');
        }
      } catch (error) {
        console.error('Error:', error);
        showNotification(this.t('fileDeleteFailed'), 'error');
      }
    },

    goToURL(provider) {
        if (provider.vendor === 'custom') {
          url = provider.url;
          // Remove the trailing /v1 from the URL
          if (url.endsWith('/v1')) {
            url = url.slice(0, -3);
          }
        }
        else if (provider.vendor === 'customAnthropic'){
          url = provider.url;
        }
        else {
          url = this.vendorAPIpage[provider.vendor];
        }
        if (isElectron) {
          window.electronAPI.openExternal(url);
        } else {
          window.open(url, '_blank');
        }
    },
    goToMCPURL(value) {
        url = this.MCPpage[value]
        if (isElectron) {
          window.electronAPI.openExternal(url);
        } else {
          window.open(url, '_blank');
        }
    },
    goToPromptURL(value) {
        url = this.promptPage[value]
        if (isElectron) {
          window.electronAPI.openExternal(url);
        } else {
          window.open(url, '_blank');
        }
    },
    goToCardURL(value) {
        url = this.cardPage[value]
        if (isElectron) {
          window.electronAPI.openExternal(url);
        } else {
          window.open(url, '_blank');
        }
    },
    handleBeforeUpload(file) {
      const reader = new FileReader()
      reader.readAsDataURL(file)
      reader.onload = () => {
        this.uploadedStickers.push({
          uid: file.uid,
          url: reader.result,
          description: "",
          file: file
        })
      }
      return false // Prevent auto-upload
    },

    handleStickerRemove(file) {
      this.uploadedStickers = this.uploadedStickers.filter(f => f.uid !== file.uid)
    },

    async createStickerPack() {
      try {
        // Validate the input
        if (!this.newStickerPack.name || this.uploadedStickers.length === 0) {
          showNotification(this.t('fillAllFields'), 'warning');
          return;
        }
        

        // Create a FormData object
        const formData = new FormData();
        
        // Add the sticker-pack name
        formData.append('pack_name', this.newStickerPack.name);
        
        // Add all sticker descriptions
        this.uploadedStickers.forEach(sticker => {
          formData.append('descriptions', sticker.description);
        });
        
        // Add all sticker files
        this.uploadedStickers.forEach(sticker => {
          formData.append('files', sticker.file);
        });

        // Send the request
        const response = await fetch(`/create_sticker_pack`, {
          method: 'POST',
          body: formData
        });
        
        // Handle the response
        if (!response.ok) {
          const errorData = await response.json();
          console.error("服务器错误详情:", errorData);
          
          let errorMsg = this.t('uploadFailed');
          if (errorData.detail) {
            if (typeof errorData.detail === 'string') {
              errorMsg = errorData.detail;
            } else if (errorData.detail[0]?.msg) {
              errorMsg = errorData.detail[0].msg;
            }
          }
          
          throw new Error(errorMsg);
        }

        const data = await response.json();
        if (data.success) {
          // Update the frontend state
          this.stickerPacks.push({
            id: data.id,
            name: data.name,
            stickers: data.stickers,
            cover: data.cover,
            enabled: true
          });
          
          this.imageFiles = [...this.imageFiles, ...data.imageFiles];
          this.resetStickerForm();
          await this.autoSaveSettings();
          
          showNotification(this.t('stickerPackCreated'));
          this.showStickerDialog = false;
        } else {
          showNotification(data.message || this.t('createFailed'), 'error');
          this.showStickerDialog = false;
        }
      } catch (error) {
        console.error('创建失败:', error);
        showNotification(
          error.message || this.t('createFailed'), 
          'error'
        );
        this.showStickerDialog = false;
      }
    },

    deleteStickerPack(stickerPack) {
      this.stickerPacks = this.stickerPacks.filter(pack => pack.id !== stickerPack.id);
      this.autoSaveSettings();
      showNotification(this.t('stickerPackDeleted'));
    },
    cancelStickerUpload() {
      this.showStickerDialog = false;
      this.resetStickerForm();
    },

    resetStickerForm() {
      this.newStickerPack = {
        name: '',
        stickers: [],
      };
      this.uploadedStickers = [];
    },
    handlePictureCardPreview(file) {
      this.imageUrl = file.url || URL.createObjectURL(file.raw)
      this.dialogVisible = true
    },
    downloadMemory(memory) {
      // Export only the fields SillyTavern V3 needs; strip all sensitive info
      const card = {
        spec: 'chara_card_v3',
        spec_version: '3.0',
        name: memory.name,
        description: memory.description || '',
        avatar: memory.avatar || '',
        personality: memory.personality || '',
        mes_example: memory.mesExample || '',
        first_mes: memory.firstMes || '',
        system_prompt: memory.systemPrompt || '',
        alternate_greetings: Array.isArray(memory.alternateGreetings)
          ? memory.alternateGreetings.filter(Boolean)
          : [],
        character_book: {
          name: memory.name,
          entries: Array.isArray(memory.characterBook)
            ? memory.characterBook
                .filter(e => e.keysRaw?.trim() && e.content?.trim())
                .map((e, idx) => ({
                  id: idx,
                  keys: e.keysRaw
                    .split(/\r?\n/)
                    .map(k => k.trim())
                    .filter(Boolean),
                  secondary_keys: [],
                  content: e.content,
                  comment: '',
                  constant: false,
                  selective: true,
                  insertion_order: 100,
                  enabled: true,
                  position: 'before_char',
                  use_regex: true,
                  extensions: {}
                }))
            : []
        }
        // Other fields like avatar, tags, scenario... are left empty as needed
      };

      const blob = new Blob([JSON.stringify(card, null, 2)], {
        type: 'application/json'
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${memory.name}_v3.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    changeMemory() {
      if (this.memorySettings.is_memory){
        // Get the matching memory from memories based on selectedMemory
        let curMemory = this.memories.find(memory => memory.id === this.memorySettings.selectedMemory);
        this.firstMes = curMemory.firstMes;
        this.alternateGreetings= curMemory.alternateGreetings;
      }
      else{
        this.firstMes = '';
        this.alternateGreetings = [];
      }
      this.randomGreetings();
      this.autoSaveSettings(); // Save settings
    },
    randomGreetings() {
      let greetings = [this.firstMes, ...this.alternateGreetings];
      // Filter out empty strings
      greetings = greetings.filter(greeting => greeting.trim() !== '');
      // Replace all {{user}} in the greeting with this.memorySettings.userName
      greetings = greetings.map(greeting => greeting.replace(/{{user}}/g, this.memorySettings.userName));
      // Get the matching memory from memories based on selectedMemory
      let curMemory = this.memories.find(memory => memory.id === this.memorySettings.selectedMemory);
      // Replace all {{char}} in the greeting with curMemory.name
      greetings = greetings.map(greeting => greeting.replace(/{{char}}/g, curMemory.name));
      if (greetings.length > 0) {
        let randomIndex = Math.floor(Math.random() * greetings.length);
        // Add the random greeting to this.messages immediately
        // If the second element of this.messages is a greeting, replace it; otherwise insert after the first element
        if (this.messages.length > 1 && this.messages[1].role === 'assistant') {
          this.messages[1].content = greetings[randomIndex];
          this.messages[1].pure_content = greetings[randomIndex];
        } else {
          this.messages.splice(1, 0, {
            role: 'assistant',
            content: greetings[randomIndex],
            pure_content: greetings[randomIndex],
          });
        }
      } 
      else{
        // If the second element of this.messages is a greeting, remove it
        if (this.messages.length > 1 && this.messages[1].role === 'assistant') {
          this.messages.splice(1, 1);
        }
      }
    },
    browseJsonFile() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,.png';          // Key: also provide a png
      input.onchange = (event) => {
        const file = event.target.files[0];
        if (!file) return;
        if (file.name.toLowerCase().endsWith('.png')) {
          this.handlePngAsJson(file);        // New branch
        } else {
          this.handleFileUpload(file);       // The original JSON branch
        }
      };
      input.click();
    },

    handleJsonDrop(event) {
      const file = event.dataTransfer.files[0];
      if (!file) return;
      const isPng = file.type === 'image/png' ||
                    file.name.toLowerCase().endsWith('.png');
      const isJson = file.type === 'application/json' ||
                    file.name.toLowerCase().endsWith('.json');

      if (isPng) {
        this.handlePngAsJson(file);
      } else if (isJson) {
        this.handleFileUpload(file);
      } else {
        showNotification('Please upload a valid JSON or PNG character card.', 'error');
      }
    },

    async handlePngAsJson(file) {
      // 1. Upload the PNG as a regular image first to get an external link
      const formData = new FormData();
      formData.append('files', file);   // Keep the field name consistent with the /load_file endpoint

      let imageUrl;
      try {
        const up = await fetch('/load_file', { method: 'POST', body: formData });
        if (!up.ok) throw new Error('upload failed');
        const res = await up.json();
        if (!res.success || !res.fileLinks || !res.fileLinks[0])
          throw new Error('no url returned');
        imageUrl = res.fileLinks[0].path;          // The full URL returned by the backend
        // Optional: also push this image into the imageFiles list to keep the UI in sync
        this.imageFiles = [...this.imageFiles, ...res.imageFiles];
      } catch (e) {
        console.error(e);
        showNotification('PNG upload failed', 'error');
        return;
      }

      // 2. Unpack to get the JSON
      const jsonText = await this.extractJsonFromPng(file);
      if (!jsonText) return;   // The notification was already shown internally

      // 3. Replace the avatar with the just-uploaded URL
      let jsonData;
      try {
        jsonData = JSON.parse(jsonText);
      } catch {
        showNotification('Invalid JSON inside PNG', 'error');
        return;
      }
      // Compatible with V2/V3
      const target = jsonData.data || jsonData;
      target.avatar = imageUrl;   // Overwrite directly

      // 4. Use the existing logic to populate the form
      this.importMemoryData(jsonData);
      this.jsonFile = file;       // Keep the file object so the remove button works
      showNotification('Character card imported from PNG', 'success');
    },

    async extractJsonFromPng(file) {
      const buffer = await file.arrayBuffer();
      const png = new Uint8Array(buffer);
      const sign = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
      if (!sign.every((b, i) => b === png[i])) {
        showNotification('Not a valid PNG file', 'error');
        return null;
      }

      let pos = 8;
      const view = new DataView(buffer);
      let jsonText = null;

      while (pos < png.length) {
        const len  = view.getUint32(pos);
        const type = String.fromCharCode(...png.slice(pos + 4, pos + 8));
        const start = pos + 8;
        const end   = start + len;

        if (type === 'tEXt') {
          const data = png.slice(start, end);
          const zero = data.indexOf(0);
          if (zero > 0) {
            const key = new TextDecoder().decode(data.slice(0, zero)).toLowerCase();
            if (key === 'chara' || key === 'ccv3') {
              const b64 = new TextDecoder().decode(data.slice(zero + 1));
              try {
                jsonText = new TextDecoder().decode(
                  Uint8Array.from(atob(b64), c => c.charCodeAt(0))
                );
                if (key === 'ccv3') break;
              } catch {}
            }
          }
        }
        if (type === 'IEND') break;
        pos = end + 4; // Skip the CRC
      }

      if (!jsonText) showNotification('No character data found in PNG', 'error');
      return jsonText;
    },


    // Open the file picker
    triggerAvatarUpload() {
      this.$refs.avatarInput.click();
    },

    // Handle the file upload
    async handleAvatarUpload(event) {
      const file = event.target.files[0];
      if (!file) return;

      // Reset the input value so selecting the same file again still fires the change event
      event.target.value = '';

      const formData = new FormData();
      // Note: the 'files' field name here must match what's defined in the backend's @app.post("/load_file")
      formData.append('files', file, file.name);

      try {
        // Optional: show a loading animation here
        // const loading = this.$loading({ lock: true, text: 'Uploading...' });

        const response = await fetch('/load_file', {
          method: 'POST',
          body: formData
        });

        const data = await response.json();
        
        // loading.close(); // close the loading animation

        if (data.success && data.fileLinks && data.fileLinks.length > 0) {
          // Get the full URL returned by the backend
          const uploadedUrl = data.fileLinks[0].path;
          
          // Assign it to newMemory.avatar
          this.newMemory.avatar = uploadedUrl;
          
          // If you have a global notification component
          showNotification(this.t('uploadSuccess') || 'Upload successful', 'success');
        } else {
          showNotification(this.t('uploadFailed') || 'Upload failed', 'error');
        }
      } catch (error) {
        console.error('Avatar upload error:', error);
        showNotification(error.message || 'Upload error', 'error');
      }
    },

    handleFileUpload(file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const jsonData = JSON.parse(event.target.result); // Parse the JSON data
          this.importMemoryData(jsonData); // Call the import method
          this.jsonFile = file; // Save the file info
        } catch (error) {
          showNotification('Invalid JSON file.', 'error'); // Error prompt
        }
      };

      reader.readAsText(file); // Read the file content
    },

    importMemoryData(jsonData) {
      // Compatible with V2/V3: extract data uniformly
      const data = jsonData.data || jsonData;

      this.newMemory = {
        ...this.newMemory,                      // Keep old fields like providerId
        name: data.name || '',
        description: data.description || '',
        avatar: data.avatar || '',
        personality: data.personality || '',
        mesExample: data.mes_example || '',
        systemPrompt: data.system_prompt || '',
        firstMes: data.first_mes || '',
        alternateGreetings: Array.isArray(data.alternate_greetings)
          ? data.alternate_greetings
          : [''],
        characterBook:
          Array.isArray(data.character_book?.entries) &&
          data.character_book.entries.length
            ? data.character_book.entries.map(e => ({
                keysRaw: (e.keys || []).join('\n'),
                content: e.content || ''
              }))
            : [{ keysRaw: '', content: '' }]
      };
    },

    removeJsonFile() {
      this.jsonFile = null; // Clear the file
    },
    // Initialize the ASR WebSocket connection (modified version, supports the Web Speech API)
    async initASRWebSocket() {
      if (this.asrSettings.engine === 'webSpeech') return;
      
      // Key: if there's already a connection or one is connecting, clean it up first
      if (this.asrWs) {
        this.asrWs.onclose = null;
        this.asrWs.close();
        this.asrWs = null;
      }

      const ws_protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws_url = `${ws_protocol}//${window.location.host}/ws/asr`;

      console.log('Initializing ASR WebSocket...');
      this.asrWs = new WebSocket(ws_url);
      
      this.asrWs.onopen = () => {
        if (this.asrWs && this.asrWs.readyState === WebSocket.OPEN) {
          console.log('ASR WebSocket connection established');
          this.asrWs.send(JSON.stringify({ type: 'init' }));
        }
      };

      this.asrWs.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleASRResult(data);
        } catch (e) {
          console.error('Invalid JSON from ASR server:', event.data);
        }
      };

      this.asrWs.onclose = (event) => {
        // Only reconnect when ASR is enabled and we didn't manually destroy asrWs
        if (this.asrSettings.enabled && this.asrWs !== null) {
          console.log('ASR WebSocket unexpected closed, reconnecting in 3s...');
          setTimeout(() => {
            if (this.asrSettings.enabled) this.initASRWebSocket();
          }, 3000);
        }
      };

      this.asrWs.onerror = (error) => {
        console.error('ASR WebSocket error observed');
      };
    },

    // Change: initialize the Web Speech API (without auto-starting)
    initWebSpeechAPI() {
      if(isElectron){
        showNotification(this.t('webSpeechNotSupportedInElectron'), 'error');
        this.asrSettings.enabled = false;
        this.autoSaveSettings();
        return false;
      }

      // Check whether the browser supports the Web Speech API
      if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        showNotification(this.t('webSpeechNotSupported'), 'error');
        this.asrSettings.enabled = false;
        return false;
      }

      // Create the speech-recognition object
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      this.recognition = new SpeechRecognition();

      // Configure the speech-recognition parameters
      this.recognition.continuous = true; // Switch to non-continuous recognition, controlled by VAD
      this.recognition.interimResults = true;
      if (this.asrSettings.webSpeechLanguage != 'auto'){
        this.recognition.lang = this.asrSettings.webSpeechLanguage;
      }
      // Handle recognition results
      this.recognition.onresult = (event) => {
        let finalTranscript = '';
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript;
          } else {
            interimTranscript += transcript;
          }
        }

        // Handle interim results
        if (interimTranscript) {
          this.handleASRResult({
            type: 'transcription',
            text: interimTranscript,
            is_final: false
          });
        }

        // Handle final results
        if (finalTranscript) {
          this.handleASRResult({
            type: 'transcription',
            text: finalTranscript,
            is_final: true
          });
        }
      };

      // Error handling
      this.recognition.onerror = (event) => {
        console.error('Web Speech API error:', event.error);
        let errorMessage = null;
        
        switch (event.error) {
          case 'no-speech':
            errorMessage = null;
            break;
          case 'audio-capture':
            errorMessage = this.t('microphoneError');
            break;
          case 'not-allowed':
            errorMessage = this.t('micPermissionDenied');
            break;
          case 'network':
            errorMessage = this.t('networkError');
            break;
        }
        if (errorMessage) {
          showNotification(errorMessage, 'error');
        }
        
        // Reset the recognition state
        this.isWebSpeechRecognizing = false;
      };

      // Handle recognition end
      this.recognition.onend = () => {
        console.log('Web Speech API recognition ended');
        this.isWebSpeechRecognizing = false;
        // No longer auto-restart; controlled by VAD
      };

      // Handle recognition start
      this.recognition.onstart = () => {
        console.log('Web Speech API recognition started');
        this.isWebSpeechRecognizing = true;
      };

      return true;
    },
    openWakeWindow() {
      this.withinWakeWindow = true;
      this.wakeWindowTimer = setTimeout(() => {
        this.withinWakeWindow = false;
      }, 30_000);
    },

    /* Refresh the 30s window (call after each successful interaction) */
    resetWakeWindow() {
      clearTimeout(this.wakeWindowTimer);
      this.openWakeWindow();
    },

    /* Clear the timer; can be called on component destroy */
    clearWakeWindow() {
      clearTimeout(this.wakeWindowTimer);
      this.withinWakeWindow = false;
    },

    // Change: unified ASR-result handler
    handleASRResult(data) {
      if (data.type === 'transcription') {
        const lastMessage = this.messages[this.messages.length - 1];
        if (!this.ttsSettings.enabledInterruption && (this.ttsSettings.enabled||this.settings.enableOmniTTS)) {
          // If TTS is running and interruption isn't allowed, don't process the ASR result
          if(this.TTSrunning){
            if ((!lastMessage || (lastMessage?.currentChunk ?? 0) >= (lastMessage?.ttsChunks?.length ?? 0)) && !this.isTyping) {
              console.log('All audio chunks played');
              lastMessage.currentChunk = 0;
              this.TTSrunning = false;
              this.cur_audioDatas = [];
              // Notify VRM that all audio playback is complete
              this.sendTTSStatusToVRM('allChunksCompleted', {});
            }
            else{
              console.log('Audio chunks still playing');
              return;
            }
          }
        }
        else if (this.ttsSettings.enabledInterruption && this.ttsSettings.enabled) {
            console.log('All audio chunks played');
            lastMessage.currentChunk = 0;
            this.TTSrunning = false;
            this.cur_audioDatas = [];
            // Notify VRM that all audio playback is complete
            this.sendTTSStatusToVRM('allChunksCompleted', {});
        }
        else if(this.settings.enableOmniTTS && this.ttsSettings.enabledInterruption){
            this.stopAllAudioPlayback();
            this.sendTTSStatusToVRM('allChunksCompleted', {});
        }
        if (data.is_final) {
          // Final result
          if (this.userInputBuffer.length > 0) {
            // Replace the last this.userInputBuffer in this.userInput with data.text
            this.userInput = this.userInput.slice(0, -this.userInputBuffer.length) + data.text;
            this.userInputBuffer = '';
          } else {
            // If there's no interim result, append directly to userInput
            this.userInput += data.text;
            this.userInputBuffer = '';
          }
          
          if (this.isPttMode || this.waitingForPttResult) {
            console.log("PTT 识别完成，自动发送:", data.text);
            this.sendMessage(); 
            this.userInput = ''; // Clear after sending
            this.waitingForPttResult = false; // Reset the flag
            return;
          }

          // Handle based on the interaction mode
          if (this.asrSettings.interactionMethod == "auto") {
            if (this.ttsSettings.enabledInterruption) {
              this.sendMessage();
            } else if (!this.TTSrunning ||  !this.ttsSettings.enabled) {
              this.sendMessage();
            }
          }
          
          if (this.asrSettings.interactionMethod == "wakeWord") {
            const lowerInput = this.userInput.toLowerCase();
            const hasWakeWord = lowerInput.includes(this.asrSettings.wakeWord.toLowerCase());

            /* 1. If within the 30s wake-free window, send directly */
            if (this.withinWakeWindow) {
              this.sendMessage();
              this.resetWakeWindow();          // Refresh the 30s
              return;
            }

            /* 2. Otherwise, the wake word must be detected */
            if (hasWakeWord) {
              this.sendMessage();
              this.openWakeWindow();           // Enter the 30s wake-free window
            } else {
              this.userInput = '';             // Not woken; clear the input
            }
          }
          
          if (this.asrSettings.interactionMethod == "wakeWordAndEndWord") {
            const userInputLower = this.userInput.toLowerCase();
            const wakeWordLower = this.asrSettings.wakeWord.toLowerCase();
            const endWordLower = this.asrSettings.endWord.toLowerCase();
            
            // Check whether it contains the end word
            if (userInputLower.includes(endWordLower)) {
              this.inAutoMode = false;
              console.log('End word detected, exiting auto mode');
              showNotification(this.t('endWordDetected'));
              // You can choose to send the message including the end word, or clear it without sending
              this.userInput = '';
            }
            // Check whether it contains the wake word
            else if (userInputLower.includes(wakeWordLower)) {
              this.inAutoMode = true;
              console.log('ake word detected, entering auto mode');
              // Send the message including the wake word
              if (this.ttsSettings.enabledInterruption) {
                this.sendMessage();
              } else if (!this.TTSrunning ||  !this.ttsSettings.enabled) {
                this.sendMessage();
              }
            }
            // In auto mode, all messages are sent automatically
            else if (this.inAutoMode) {
              if (this.ttsSettings.enabledInterruption) {
                this.sendMessage();
              } else if (!this.TTSrunning ||  !this.ttsSettings.enabled) {
                this.sendMessage();
              }
            }
            else{
              this.userInput = '';             // Not woken; clear the input
            }
          }
        } else {
          if (this.asrSettings.engine === 'webSpeech'){
            this.userInput = data.text;
            this.userInputBuffer = data.text;
          }else {
            // Interim result
            this.userInput += data.text;
            this.userInputBuffer += data.text;
          }

        }
      } else if (data.type === 'error') {
        console.error('ASR error:', data.message);
        showNotification(this.t('transcriptionFailed'), 'error');
      } else if (data.type === 'init_response') {
        if (data.status === 'ready') {
          
        }
      }
    },

    // Change: toggle the ASR feature
    async toggleASR() {
      this.asrSettings.enabled = !this.asrSettings.enabled;
      this.autoSaveSettings();
      if (this.asrSettings.enabled === true && this.asrSettings.engine === 'sherpa'){
        if (!this.sherpaModelExists){
          showNotification(this.t('autoDownloadModel'), 'info');
          this.asrSettings.enabled = false;
          let source = await this.getAutoSource();
          await this.sherpaDownload(source);
          this.autoSaveSettings();
          return;
        }
      }
      if (this.asrSettings.enabled) {
        await this.startASR();
      } else {
        this.stopASR();
      }
    },

    // Change: handle ASR setting changes
    async handleASRchange() {
      // Lock guard: if it's starting up, return immediately to prevent rapid clicking
      if (this.isStartingASR) return;
      
      // Fully stop first
      await this.stopASR(); 
      if (this.asrSettings.enabled === true && this.asrSettings.engine === 'sherpa'){
        if (!this.sherpaModelExists){
          showNotification(this.t('autoDownloadModel'), 'info');
          this.asrSettings.enabled = false;
          let source = await this.getAutoSource();
          await this.sherpaDownload(source);
          this.autoSaveSettings();
          return;
        }
      }

      if (this.asrSettings.enabled) {
        // Give the system 200ms to reclaim resources
        await new Promise(resolve => setTimeout(resolve, 200));
        await this.startASR();
      }

      this.autoSaveSettings();
    },

    // Change: start ASR
    async startASR() {
      if (!this.asrSettings.enabled) return;
      if (this.asrSettings.interactionMethod === 'globalKeyTriggered' || this.asrSettings.interactionMethod === 'keyTriggered') return;
      
      // Engage the startup lock
      if (this.isStartingASR) return;
      this.isStartingASR = true;

      try {
        // 1. Acquire the stream uniformly
        if (!this.mediaStream) {
          this.mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
          });
        }

        // 2. Initialize VAD
        await this.initVAD();

        // 3. Initialize the engine
        if (this.asrSettings.engine === 'webSpeech') {
          this.initWebSpeechAPI();
        } else {
          // Ensure the old connection is dead before creating a new one
          await this.initASRWebSocket();
        }

        if (this.vad) {
          await this.vad.start();
        }
        
        this.isRecording = true;
      } catch (error) {
        console.error('Start ASR Error:', error);
        this.stopASR();
      } finally {
        // Release the startup lock
        this.isStartingASR = false;
      }
    },

    // Change: stop ASR
    async stopASR() {
      console.log('Stopping ASR...');
      this.isRecording = false;
      this.isStartingASR = false;

      // 1. Fully cut the WebSocket (key: remove the listeners first)
      if (this.asrWs) {
        this.asrWs.onclose = null; // Remove the listeners to avoid triggering an auto-reconnect infinite loop
        this.asrWs.onerror = null;
        this.asrWs.onmessage = null;
        this.asrWs.onopen = null;
        if (this.asrWs.readyState !== WebSocket.CLOSED) {
          this.asrWs.close();
        }
        this.asrWs = null;
      }

      // 2. Stop Web Speech
      if (this.recognition) {
        try {
          this.recognition.onend = null;
          this.recognition.onerror = null;
          this.recognition.abort();
        } catch (e) {}
        this.recognition = null;
        this.isWebSpeechRecognizing = false;
      }

      // 3. Stop VAD
      if (this.vad) {
        try {
          this.vad.pause();
          if (this.vad.destroy) await this.vad.destroy();
        } catch (e) {}
        this.vad = null;
      }

      // 4. Release the microphone hardware
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(track => {
          track.stop();
        });
        this.mediaStream = null;
      }

      // 5. Release the audio context
      if (this.audioContext) {
        try {
          await this.audioContext.close();
        } catch (e) {}
        this.audioContext = null;
      }
      
      this.ASRrunning = false;
    },

    // Change: initialize VAD (Web Speech mode uses VAD too)
    async initVAD() {
      if (!this.mediaStream) return;

      const min_probabilities = this.asrSettings.engine === 'webSpeech' ? 0.7 : 0.2;

      this.vad = await vad.MicVAD.new({
        stream: this.mediaStream,
        preSpeechPadFrames: 10,
        onSpeechStart: () => {
          this.ASRrunning = true;
          this.handleSpeechStart();
        },
        onFrameProcessed: (probabilities, frame) => {
          if (probabilities["isSpeech"] > min_probabilities) {
            // Interruption logic
            if (this.ttsSettings.enabledInterruption) {
              if (this.currentAudio) {
                this.currentAudio.pause();
                this.currentAudio = null;
              }
              this.stopGenerate();
              this.sendTTSStatusToVRM('stopSpeaking', {});
            }

            if (!this.currentAudio || this.currentAudio.paused) {
              if (this.asrSettings.engine === 'webSpeech') {
                this.handleWebSpeechFrameProcessed();
              } else {
                this.handleFrameProcessed(frame);
              }
            }
          }
        },
        onSpeechEnd: (audio) => {
          this.ASRrunning = false;
          if (this.asrSettings.engine === 'webSpeech') {
            this.handleWebSpeechEnd();
          } else {
            this.handleSpeechEnd(audio);
          }
        },
      });
    },

    handleWebSpeechSpeechStart() {
      console.log('VAD detected speech start for Web Speech API');
      if (!this.isWebSpeechRecognizing && this.recognition) {
        try {
          this.recognition.start();
        } catch (error) {
          // Ignore the 'already started' error
        }
      }
    },

    async handleFrameProcessed(frame) {
      if (!frame || !(frame instanceof Float32Array)) return;

      // Add an extremely strict check: never send data unless the connection is in the OPEN state
      if (!this.asrWs || this.asrWs.readyState !== WebSocket.OPEN) {
        return;
      }

      try {
        const int16Pcm = new Int16Array(frame.length);
        for (let i = 0; i < frame.length; i++) {
          int16Pcm[i] = Math.max(-32768, Math.min(32767, frame[i] * 32767));
        }

        const base64Audio = btoa(
          String.fromCharCode(...new Uint8Array(int16Pcm.buffer))
        );

        this.asrWs.send(JSON.stringify({
          type: 'audio_stream',
          id: this.currentTranscriptionId,
          audio: base64Audio,
          format: 'pcm',
          sample_rate: 16000
        }));
      } catch (e) {
        // If sending fails, the connection most likely just dropped
        console.warn('Failed to send audio frame');
      }
    },

    handleWebSpeechEnd() {
      console.log('VAD detected speech end for Web Speech API');
      if (this.isWebSpeechRecognizing && this.recognition) {
        try {
          this.recognition.stop();
        } catch (error) {
          console.error('Failed to stop Web Speech API:', error);
        }
      }
    },


    // Change: start recording (needed in both modes)
    async startRecording() {
      try {
        // Request microphone permission
        this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Initialize the audio context
        this.audioContext = new AudioContext();
        const source = this.audioContext.createMediaStreamSource(this.mediaStream);
        
        // Set the VAD parameters
        this.vad.start();
        
        this.isRecording = true;
      } catch (error) {
        console.error('Error starting recording:', error);
        this.asrSettings.enabled = false;
        showNotification(this.t('micPermissionDenied'), 'error');
      }
    },

    // Change: stop recording (needed in both modes)
    stopRecording() {
      if (this.vad) {
        this.vad.pause();
      }
      
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(track => track.stop());
        this.mediaStream = null;
      }
      
      if (this.audioContext) {
        this.audioContext.close();
        this.audioContext = null;
      }
      
      this.isRecording = false;
    },
    // Change: unified speech-start handling

    async handleSpeechStart() {
      if (this.asrSettings.engine === 'webSpeech') {
        this.handleWebSpeechSpeechStart();
      } else {
        if (!this.asrWs || this.asrWs.readyState !== WebSocket.OPEN) return;
        
        this.currentTranscriptionId = uuid.v4();
        this.asrWs.send(JSON.stringify({
          type: 'audio_start',
          id: this.currentTranscriptionId,
        }));
      }
    },

    async handleFrameProcessed(frame) {
      if (!frame || !(frame instanceof Float32Array)) return;

      // Fix: add a WebSocket-state check to avoid send errors
      if (!this.asrWs || this.asrWs.readyState !== WebSocket.OPEN) {
        return;
      }

      try {
        const int16Pcm = new Int16Array(frame.length);
        for (let i = 0; i < frame.length; i++) {
          int16Pcm[i] = Math.max(-32768, Math.min(32767, frame[i] * 32767));
        }

        const base64Audio = btoa(
          String.fromCharCode(...new Uint8Array(int16Pcm.buffer))
        );

        this.asrWs.send(JSON.stringify({
          type: 'audio_stream',
          id: this.currentTranscriptionId,
          audio: base64Audio,
          format: 'pcm',
          sample_rate: 16000 
        }));
      } catch (e) {
        console.error('Frame processing error:', e);
      }
    },

    async handleSpeechEnd(audio) {
      // Handling when speech ends
      if (!this.asrWs || this.asrWs.readyState !== WebSocket.OPEN) return;
      
        // Non-streaming mode: send the complete audio data
        // Convert the audio data to WAV format
        const wavFile = await this.audioToWav(audio);
        
        // Convert the WAV file to base64
        const reader = new FileReader();
        reader.readAsDataURL(wavFile);
        reader.onloadend = () => {
          const base64data = reader.result.split(',')[1]; // Remove the prefix
          
          // Send the complete audio data
          this.asrWs.send(JSON.stringify({
            type: 'audio_complete',
            id: this.currentTranscriptionId,
            audio: base64data,
            format: 'wav'
          }));
        };
    },
  // 1. Press: start recording
  async handlePttPress(event) {
    this.stopAllAudioPlayback(); // Stop all currently playing audio
    this.TTSrunning = false; // Stop any currently playing TTS
    // Manually prevent the default event to fix the _withMods error
    if (event && event.preventDefault) {
      if (event.type !== 'touchstart') {
        event.preventDefault();
      }
    }

    if (this.isPttRecording || this.isProcessingPtt) return;
    this.isPttRecording = true;

    // ==========================================
    // Branch A: Web Speech API mode (reuses your existing initWebSpeechAPI)
    // ==========================================
    if (this.asrSettings.engine === 'webSpeech') {
      // If the recognition object isn't initialized yet, initialize it
      if (!this.recognition) {
        const success = this.initWebSpeechAPI();
        if (!success) {
          this.isPttRecording = false;
          return;
        }
      }
      
      try {
        this.recognition.start();
        if (navigator.vibrate) navigator.vibrate(50);
      } catch (e) {
        // Catch the 'already started' error to avoid console errors
        console.warn("Web Speech already started:", e);
      }
      return; // Key: break out directly; don't run the MediaRecorder logic below
    }

    // ==========================================
    // Branch B: other ASR modes (binary-stream mode: Sherpa/FunASR/OpenAI)
    // ==========================================
    this.audioChunks = []; // Reset the data buffer

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.pttStream = stream;

      let options = { mimeType: 'audio/webm' };
      if (!MediaRecorder.isTypeSupported('audio/webm')) {
        options = { mimeType: 'audio/mp4' }; // Safari compatibility
      }
      
      this.pttMediaRecorder = new MediaRecorder(stream, options);

      this.pttMediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          this.audioChunks.push(e.data);
        }
      };

      this.pttMediaRecorder.start();
      
      if (navigator.vibrate) navigator.vibrate(50);

    } catch (error) {
      console.error("PTT Start Error:", error);
      // Call showNotification if defined; otherwise fall back to alert
      if (typeof showNotification === 'function') {
        showNotification(this.t('micPermissionDenied'), 'error');
      }
      this.isPttRecording = false;
    }
  },

  // 2. Release: stop recording -> transcode -> send
  async handlePttRelease(event) {
    // Manually prevent the default event
    if (event && event.preventDefault && event.type !== 'touchend') {
       event.preventDefault();
    }

    if (!this.isPttRecording) return;
    this.isPttRecording = false;

    // ==========================================
    // Branch A: Web Speech API mode
    // ==========================================
    if (this.asrSettings.engine === 'webSpeech') {
      if (this.recognition) {
        // [Core fix]: create a one-time listener to ensure sending only after recognition fully completes
        const sendAfterRecognition = () => {
          // Remove the listener to avoid re-triggering next time
          this.recognition.removeEventListener('end', sendAfterRecognition);
          
          // Add a small delay (100ms) to ensure handleASRResult has updated the final text into userInput
          setTimeout(() => {
            if (this.userInput && this.userInput.trim() !== '') {
              this.sendMessage(); // Trigger the send logic
            }
          }, 100);
        };

        // Bind a one-time end listener
        this.recognition.addEventListener('end', sendAfterRecognition);
        
        this.recognition.stop(); // Stop recognition
        if (navigator.vibrate) navigator.vibrate(30);
      }
      return; 
    }

    // ==========================================
    // Branch B: other ASR modes (binary-stream stop logic)
    // ==========================================
    if (!this.pttMediaRecorder) return;

    this.isProcessingPtt = true;

    // Stop recording
    if(this.pttMediaRecorder.state !== 'inactive') {
        this.pttMediaRecorder.stop();
    }
    
    // Turn off the mic indicator
    if (this.pttStream) {
      this.pttStream.getTracks().forEach(track => track.stop());
      this.pttStream = null;
    }
    
    if (navigator.vibrate) navigator.vibrate(30);

    // Wait for recording to fully end and merge the data
    await new Promise(resolve => {
      this.pttMediaRecorder.onstop = () => resolve();
    });

    // Audio-handling logic (the original processAndSendPttAudio)
    await this.processAndSendPttAudio();
    
    this.isProcessingPtt = false;
    this.pttMediaRecorder = null;
  },

  // 3. Audio-handling logic
  async processAndSendPttAudio() {
    if (this.audioChunks.length === 0) return;

    try {
      // Merge the recorded segments
      const mimeType = this.pttMediaRecorder ? this.pttMediaRecorder.mimeType : 'audio/webm';
      const rawBlob = new Blob(this.audioChunks, { type: mimeType });

      // Core conversion: convert WebM/MP4 to 16000Hz WAV
      // This is the most reliable format the backend ASR usually recognizes
      const wavBlob = await this.convertBlobToWav(rawBlob, 16000);

      // Send
      await this.sendPttToBackend(wavBlob);

    } catch (error) {
      console.error("PTT Process Error:", error);
    }
  },

  // 4. Send to the backend (reuses the WebSocket)
  async sendPttToBackend(wavBlob) {
    // Ensure the connection
    if (!this.asrWs || this.asrWs.readyState !== WebSocket.OPEN) {
      try {
        await this.initASRWebSocket();
        await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        showNotification(this.t('notifyVoiceServerConnectFailed'), 'error');
        return;
      }
    }

    const reader = new FileReader();
    reader.readAsDataURL(wavBlob);
    reader.onloadend = () => {
      const base64data = reader.result.split(',')[1];
      const reqId = uuid.v4();

      // Send the complete audio packet
      this.asrWs.send(JSON.stringify({
        type: 'audio_complete', 
        id: reqId,
        audio: base64data,
        format: 'wav',
        sample_rate: 16000
      }));
      
      // Mark that we're waiting for the PTT result
      this.waitingForPttResult = true;
    };
  },

  // 5. Audio-format conversion utility (required)
  async convertBlobToWav(blob, targetSampleRate = 16000) {
    const arrayBuffer = await blob.arrayBuffer();
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // Offline resampling
    const offlineCtx = new OfflineAudioContext(1, audioBuffer.duration * targetSampleRate, targetSampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start();
    
    const renderedBuffer = await offlineCtx.startRendering();
    
    return this.bufferToWav(renderedBuffer);
  },

  // 6. Buffer-to-WAV wrapper (required)
  bufferToWav(abuffer) {
    const numOfChan = abuffer.numberOfChannels;
    const length = abuffer.length * numOfChan * 2 + 44;
    const buffer = new ArrayBuffer(length);
    const view = new DataView(buffer);
    const channels = [];
    let i, sample, offset = 0, pos = 0;

    // Write the WAV header
    setUint32(0x46464952); // "RIFF"
    setUint32(length - 8); // file length - 8
    setUint32(0x45564157); // "WAVE"
    setUint32(0x20746d66); // "fmt " chunk
    setUint32(16); // length = 16
    setUint16(1); // PCM (uncompressed)
    setUint16(numOfChan);
    setUint32(abuffer.sampleRate);
    setUint32(abuffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
    setUint16(numOfChan * 2); // block-align
    setUint16(16); // 16-bit

    setUint32(0x61746164); // "data" - chunk
    setUint32(length - pos - 4); // chunk length

    for (i = 0; i < abuffer.numberOfChannels; i++)
      channels.push(abuffer.getChannelData(i));

    while (pos < abuffer.length) {
      for (i = 0; i < numOfChan; i++) {
        sample = Math.max(-1, Math.min(1, channels[i][pos]));
        sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
        view.setInt16(44 + offset, sample, true);
        offset += 2;
      }
      pos++;
    }

    function setUint16(data) { view.setUint16(pos, data, true); pos += 2; }
    function setUint32(data) { view.setUint32(pos, data, true); pos += 4; } // Note: pos+=4 is corrected here

    return new Blob([buffer], { type: 'audio/wav' });
  },


    // The WAV conversion function stays unchanged
    async audioToWav(audioData) {
      try {
        // Audio-parameter config
        const sampleRate = 16000; // 16kHz sample rate, suitable for speech recognition
        const numChannels = 1;    // Mono
        const bitsPerSample = 16; // 16-bit sample depth
        
        // Convert Float32Array to Int16Array (16-bit PCM)
        const int16Array = new Int16Array(audioData.length);
        for (let i = 0; i < audioData.length; i++) {
          // Convert floats in [-1.0, 1.0] to integers in [-32768, 32767]
          const sample = Math.max(-1, Math.min(1, audioData[i])); // Clamp the range
          int16Array[i] = sample < 0 ? sample * 32768 : sample * 32767;
        }
        
        // Compute the file size
        const byteLength = int16Array.length * 2; // 2 bytes per sample
        const buffer = new ArrayBuffer(44 + byteLength); // 44-byte WAV header + audio data
        const view = new DataView(buffer);
        
        // Write the WAV file header
        const writeString = (offset, string) => {
          for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
          }
        };
        
        // RIFF chunk descriptor
        writeString(0, 'RIFF');
        view.setUint32(4, 36 + byteLength, true); // File size minus 8
        writeString(8, 'WAVE');
        
        // fmt sub-chunk
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true); // fmt chunk size
        view.setUint16(20, 1, true);  // Audio format (PCM)
        view.setUint16(22, numChannels, true); // Number of channels
        view.setUint32(24, sampleRate, true);  // Sample rate
        view.setUint32(28, sampleRate * numChannels * bitsPerSample / 8, true); // Byte rate
        view.setUint16(32, numChannels * bitsPerSample / 8, true); // Block align
        view.setUint16(34, bitsPerSample, true); // Bit depth
        
        // data sub-chunk
        writeString(36, 'data');
        view.setUint32(40, byteLength, true); // Data size
        
        // Write the audio data
        const offset = 44;
        for (let i = 0; i < int16Array.length; i++) {
          view.setInt16(offset + i * 2, int16Array[i], true);
        }
        
        // Create a Blob and return a File object
        const blob = new Blob([buffer], { type: 'audio/wav' });
        const file = new File([blob], 'audio.wav', { type: 'audio/wav' });
        
        return file;
        
      } catch (error) {
        console.error('Audio conversion error:', error);
        throw new Error('Failed to convert audio to WAV format');
      }
    },

    // Utility to auto-detect the download source
    async getAutoSource() {
      return 'huggingface'; // Default source
    },

    async changeTTSstatus() {
      if (!this.ttsSettings.enabled) {
        this.TTSrunning = false;
      }
      if (this.ttsSettings.enabled === true && this.settings.enableOmniTTS === true) {
        this.settings.enableOmniTTS = false;
        showNotification(this.t('autoDisableOmniControlSettings'), 'warning');
      }
      await this.autoSaveSettings();
    },
    /**
     * Split the buffer by separators + <voice> tags
     * @returns {
     *   chunks: string[]        // plain-text chunks (tags removed, cleaned)
     *   chunks_voice: string[]  // voice key corresponding 1:1 to chunks
     *   remaining: string       // unfinished text
     *   remaining_voice: string // voice key for the remaining text
     * }
     */
    splitTTSBuffer(buffer) {
        // 0. Basic cleanup logic (unchanged)
        buffer = buffer
            .replace(/#{1,6}\s/gm, '')
            .replace(/[*~`]+/g, '')
            .replace(/^\s*[-*]\s/gm, '')
            .replace(/[\u{2600}-\u{27BF}\u{2700}-\u{27BF}\u{1F300}-\u{1F9FF}]/gu, '')
            .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
            .replace(/!\[.*?\]\(.*?\)/g, '')
            .replace(/\[(.*?)\]\(.*?\)/g, '$1');

        if (!buffer) {
            return {
                chunks: [],
                chunks_voice: [],
                remaining: '',
                remaining_voice: this.voiceStack[this.voiceStack.length - 1] // Return the top of the stack
            };
        }

        // 1. Initialize the stack (defensive)
        if (!this.voiceStack) this.voiceStack = ['default'];

        // 2. Build the regex
        const separators = (this.ttsSettings.separators || [])
            .map(s => s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r'));

        const voiceKeys = ['default', 'silence', ...Object.keys(this.ttsSettings.newtts || {})].filter(Boolean);
        const openTagRe = new RegExp(`<(${voiceKeys.join('|')})>`, 'gi');
        const closeTagRe = /<\/\w+>/gi; // Match any closing tag
        const sepRe = separators.length
            ? new RegExp(separators.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
            : /$^/;

        // 3. Scan all markers and sort them
        const tokens = [];
        let m;
        openTagRe.lastIndex = 0;
        while ((m = openTagRe.exec(buffer)) !== null) tokens.push({ type: 'open', value: m[1], index: m.index, raw: m[0] });

        closeTagRe.lastIndex = 0;
        while ((m = closeTagRe.exec(buffer)) !== null) tokens.push({ type: 'close', value: m[0], index: m.index, raw: m[0] });

        sepRe.lastIndex = 0;
        while ((m = sepRe.exec(buffer)) !== null) tokens.push({ type: 'sep', value: m[0], index: m.index, raw: m[0] });

        tokens.sort((a, b) => a.index - b.index);

        // 4. Iterate and process
        const chunks = [];
        const chunks_voice = [];
        let segmentStart = 0;

        const emitText = (endIdx) => {
            const text = buffer.slice(segmentStart, endIdx);
            const cleaned = text.replace(/\s+/g, ' ').trim();
            if (cleaned && !/^[\s\p{P}]*$/u.test(cleaned)) {
                chunks.push(cleaned);
                // Key: always use the voice at the top of the stack
                chunks_voice.push(this.voiceStack[this.voiceStack.length - 1]);
            }
        };

        for (const tok of tokens) {
            switch (tok.type) {
                case 'open':
                    emitText(tok.index);
                    this.voiceStack.push(tok.value); // Push the new voice
                    segmentStart = tok.index + tok.raw.length;
                    break;
                case 'close':
                    emitText(tok.index);
                    if (this.voiceStack.length > 1) {
                        this.voiceStack.pop(); // Pop the current voice, returning to the previous level
                    }
                    segmentStart = tok.index + tok.raw.length;
                    break;
                case 'sep':
                    emitText(tok.index);
                    segmentStart = tok.index + tok.raw.length;
                    break;
            }
        }

        // 5. Remaining text
        const remaining = buffer.slice(segmentStart);
        // Tell the outside which voice state we're in (the stack top)
        const remaining_voice = this.voiceStack[this.voiceStack.length - 1];

        return { chunks, chunks_voice, remaining, remaining_voice };
    },

    // TTS-processing routine - uses a streaming response
    // Modify the notification at the start of TTS processing
    async startTTSProcess(message) {
      if (!this.ttsSettings.enabled) return;
      this.TTSrunning = true;
      this.cur_audioDatas = [];
      
      // Use the passed-in message object
      const lastMessage = message; 

      this.sendTTSStatusToVRM('ttsStarted', {
        totalChunks: lastMessage.ttsChunks.length
      });
      
      lastMessage.audioChunks = lastMessage.audioChunks || [];
      lastMessage.ttsQueue = lastMessage.ttsQueue || new Set();
      
      let max_concurrency = 1;
      let nextIndex = 0;
      while (this.TTSrunning) {
        if (nextIndex == 0){
          let remainingText = lastMessage.ttsChunks?.[0] || '';
          let newttsList = [];
          if (remainingText && this.ttsSettings.newtts){
            for (const key in this.ttsSettings.newtts) {
              if (this.ttsSettings.newtts[key].enabled) {
                newttsList.push(key);
              }
            }
          }
          
          if (remainingText && this.ttsSettings.bufferWordList.length > 0  && newttsList == []){
            for (const exp of this.expressionMap) {
              const regex = new RegExp(exp, 'g');
              if (remainingText.includes(exp)) {
                remainingText = remainingText.replace(regex, '').trim(); 
              }
            }
            remainingText = remainingText.replace(/<[^>]+>/g, '');
            const hasChinese = /[\u4e00-\u9fa5]/.test(remainingText);

            if ((hasChinese && remainingText?.length > 5) || 
                (!hasChinese && remainingText?.length > 10)) {
                if (this.ttsSettings.bufferWordList.length > 0) {
                    const bufferWord = this.ttsSettings.bufferWordList[
                        Math.floor(Math.random() * this.ttsSettings.bufferWordList.length)
                    ];
                    lastMessage.ttsChunks.unshift(bufferWord);
                }
            }
          }
        }

        max_concurrency = this.ttsSettings.maxConcurrency || 1; 
        while (lastMessage.ttsQueue.size < max_concurrency && 
              nextIndex < lastMessage.ttsChunks.length) {
          if (!this.TTSrunning) break;
          const index = nextIndex++;
          lastMessage.ttsQueue.add(index);
          
          this.processTTSChunk(lastMessage, index).finally(() => {
            lastMessage.ttsQueue.delete(index);
          });
          if (index == 0){
            this.stopTimer();
            console.log(`TTS chunk 0 start in ${this.elapsedTime}ms`);
            await new Promise(resolve => setTimeout(resolve, 800));
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      this.messages[this.messages.length - 1].currentChunk = 0;
      console.log('TTS queue processing completed');
    },
    startTimer() {
      this.startTime = Date.now();
    },
    stopTimer() {
      this.elapsedTime = Date.now() - this.startTime;
    },
    async processTTSChunk(message, index) {
        let voice = message.chunks_voice[index];
        const chunk = message.ttsChunks[index];
        
        // Parse the markers
        const isVrmSilent = voice.startsWith('danmaku_vrm_silent:');
        if (isVrmSilent) {
            voice = voice.replace('danmaku_vrm_silent:', ''); // Restore the real voice ID
        }

        let chunk_text = chunk;
        let chunk_expressions = [];

        if (chunk.indexOf('<') !== -1) {
            const tagReg = /<[^>]+>/g;
            chunk_expressions = (chunk.match(tagReg) || []).map(t => t.slice(1, -1));
            chunk_text = chunk.replace(tagReg, '').trim();
        }

        const offset = message.chunks_voice.filter(v => v.startsWith('danmaku_vrm_silent:')).length;
        const vrmIndex = index - offset; // Compute the virtual index sent to VRM

        try {
            if (voice === 'silence') {
                // Silence chunks send commands via the text channel
                const cmd = JSON.stringify({
                    type: 'startSpeaking',
                    data: { chunkIndex: index, text: chunk_text, voice: 'silence', expressions: chunk_expressions }
                });
                if (this.ttsWebSocket && (this.vrmOnline || this.vtsOnline)) this.ttsWebSocket.send(cmd);
                message.audioChunks[index] = { url: null, expressions: chunk_expressions, text: chunk_text, index };
                this.checkAudioPlayback();
            } else {
                const response = await fetch(`/tts`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ttsSettings: this.ttsSettings, text: chunk_text, index, voice })
                });

                if (response.ok) {
                    const audioBlob = await response.blob();
                    const audioUrl = URL.createObjectURL(audioBlob);
                    
                    // --- Change: pre-convert and store the binary, but don't send yet ---
                    const audioBuffer = await audioBlob.arrayBuffer();

                    message.audioChunks[index] = { 
                        url: audioUrl, 
                        buffer: audioBuffer, // Temporarily store the binary data
                        mimeType: audioBlob.type,
                        expressions: chunk_expressions, 
                        text: chunk_text, 
                        index 
                    };
                    this.checkAudioPlayback();
                }
            }
        } catch (error) {
            console.error(`TTS Chunk ${index} error:`, error);
        }
    },

    // Audio-playback routine
    async startAudioPlayProcess(message, resolve) {
      if (!this.ttsSettings.enabled) {
          if(resolve) resolve();
          return;
      }
      
      const lastMessage = message;
      lastMessage.currentChunk = lastMessage.currentChunk || 0;
      lastMessage.isPlaying = false;
      
      this.audioPlayQueue = [];
      console.log('Audio playback monitor started for:', message.agentName);
      
      // Start the recursive check
      this.checkAudioPlayback(message, resolve);
    },

    async checkAudioPlayback(message, resolve) {
        if (!message) { if(resolve) resolve(); return; }
        const lastMessage = message;

        if (lastMessage.isPlaying) {
            setTimeout(() => this.checkAudioPlayback(message, resolve), 50);
            return;
        }

        const currentIndex = lastMessage.currentChunk;
        const audioChunk = lastMessage.audioChunks[currentIndex];
        
        // If this chunk isn't synthesized yet, keep waiting
        if (!audioChunk) {
            // If all existing chunks have finished playing
            const allLocalChunksPlayed = currentIndex >= (lastMessage.ttsChunks?.length || 0);
            
            if (allLocalChunksPlayed) {
                // If generation has ended, or we've waited a long time (e.g. 5s) with no new content, force-end
                if (lastMessage.generationFinished) {
                    console.log("播放全部完成，正常退出");
                    this.TTSrunning = false;
                    try { fetch('/api/overlay/danmaku/clear', { method: 'POST' }).catch(()=>{}); } catch(e){}
                    if (resolve) resolve();
                    return;
                } else {
                    // If generation isn't marked finished but there's nothing left to play, wait a bit more
                    // Add a safety counter (optional), or just check whether it's still generating
                    if (!this.isSending) { 
                        // If even the network request has ended but it's not marked finished, the state is definitely wrong
                        console.warn("检测到生成已停止但未标记完成，强行释放锁");
                        lastMessage.generationFinished = true; // Remediate the state
                        this.TTSrunning = false;
                        try { fetch('/api/overlay/danmaku/clear', { method: 'POST' }).catch(()=>{}); } catch(e){}
                        if (resolve) resolve();
                        return;
                    }
                    setTimeout(() => this.checkAudioPlayback(message, resolve), 50);
                    return;
                }
            }
            setTimeout(() => this.checkAudioPlayback(message, resolve), 50);
            return;
        }

        const rawVoice = lastMessage.chunks_voice[currentIndex] || '';
        const isVrmSilent = rawVoice.startsWith('danmaku_vrm_silent:');
        const actualVoice = isVrmSilent ? rawVoice.replace('danmaku_vrm_silent:', '') : rawVoice;
        
        // Compute the offset
        const offset = lastMessage.chunks_voice.filter(v => v.startsWith('danmaku_vrm_silent:')).length;
        const vrmIndex = currentIndex - offset;

        if (!lastMessage.isPlaying) {
            lastMessage.isPlaying = true;
            if (currentIndex == 0){
              this.stopTimer();
              lastMessage.first_sentence_latency = this.elapsedTime;
            }

            try {

                if (!audioChunk.buffer && audioChunk.url) {
                    try {
                        const res = await fetch(audioChunk.url);
                        audioChunk.buffer = await res.arrayBuffer();
                        if (!audioChunk.mimeType) {
                            audioChunk.mimeType = res.headers.get('content-type') || 'audio/wav';
                        }
                    } catch (err) {
                        console.warn("Failed to fetch buffer for history audio", err);
                    }
                }

                // --- Core sync change: only send the binary data at this moment for non-bullet-chat chunks when VRM is online ---
                if (!isVrmSilent && vrmIndex >= 0 && (this.vrmOnline || this.vtsOnline) && audioChunk.buffer) {
                    const metadata = {
                        type: 'audio_chunk',
                        chunkIndex: vrmIndex,
                        text: audioChunk.text,
                        expressions: audioChunk.expressions,
                        mimeType: audioChunk.mimeType
                    };

                    console.log(`Sending audio chunk ${currentIndex} to VRM with metadata:`, metadata);
                    // Sending now makes the VRM plugin start playing immediately, perfectly synced with the browser's 'silent playback' logic
                    this.sendBinaryToVRM(metadata, audioChunk.buffer);
                }

                this.currentAudio = new Audio(audioChunk.url);
                
                if (isVrmSilent) {
                    this.currentAudio.volume = 1.0; // Bullet-chat audio comes from the browser
                    console.log("正在播放弹幕:", audioChunk.text);
                } else {
                    this.currentAudio.volume = this.vrmOnline ? 0.0000001 : 1.0; // AI audio comes from VRM
                }
                
                // Send a command telling VRM to update its state (UI display, expressions, etc.)
                if (!isVrmSilent && vrmIndex >= 0) {
                    this.sendTTSStatusToVRM('startSpeaking', {
                        chunkIndex: vrmIndex,
                        totalChunks: lastMessage.ttsChunks.length - offset,
                        text: audioChunk.text,
                        expressions: audioChunk.expressions,
                        voice: actualVoice
                    });
                }
                
                // Wait for the current audio segment to finish (whether voiced or silent)
                await new Promise((r) => {
                    this.currentAudio.onended = r;
                    this.currentAudio.onerror = r; // Release even on error
                    this.currentAudio.play().catch(e => {
                        console.error("播放失败", e);
                        r(); // Release even when intercepted
                    });
                    setTimeout(r, 20000); // Force-skip a single chunk after 20s to prevent hangs
                });
                
            } catch (error) {
                console.error(`Playback error: ${error}`);
            } finally {
                lastMessage.currentChunk++;
                lastMessage.isPlaying = false;
                // Only after the current audio (bullet chat) fully fires onended do we recursively trigger the next one (the AI reply)
                setTimeout(() => this.checkAudioPlayback(message, resolve), 0);
            }
        }
    },
    // Modify the polling function
    pollVRMStatus() {
      this.vrmPollTimer = setInterval(async () => {
        try {
          const r = await fetch('/tts/status').then(r => r.json())
          this.vrmOnline = r.vrm_connections > 0;
          this.vtsOnline = r.vts_active; // Get whether VTS is active
        } catch (e) {
          this.vrmOnline = false;
          this.vtsOnline = false;
        }
      }, 3000)
    },
    // Stop audio playback (used when stopping generation)
    stopAudioPlayback() {
      // You can add logic here to stop the currently playing audio
      const lastMessage = this.messages[this.messages.length - 1];
      if (lastMessage) {
        lastMessage.isPlaying = false;
      }
    },
    toggleTTS(message) {
      if (message.isPlaying) {
        // If playing, clicking stops it
        message.isPlaying = false;
        this.stopAllAudioPlayback();
        this.sendTTSStatusToVRM('stopSpeaking', {});
      } else {
        // If not playing
        this.stopAllAudioPlayback();
        
        if (message.isOmni) {
          // --- Omni logic stays unchanged ---
          if ((message.omniCurrentTime || 0) >= (message.omniDuration || 0) - 0.1) {
            console.log('Omni audio at end, restarting from beginning');
            message.omniCurrentTime = 0; 
          }
          message.isPlaying = true;
          this.playOmniFromTime(message, message.omniCurrentTime);
        } else {
          // --- Plain-TTS logic: reuse the streaming-playback function uniformly ---
          message.isPlaying = false; // Set to false first, letting checkAudioPlayback take over and set it to true
          message.currentChunk = 0;  // Play from the beginning
          
          // Ensure generationFinished is true, since this is a replay of a historical message
          message.generationFinished = true; 
          
          // Call the core audio-queue monitor function directly
          this.checkAudioPlayback(message);
        }
      }
    },
    // Progress-bar seek
    seekOmniTTS(message, time) {
      this.stopAllAudioPlayback();
      message.omniCurrentTime = time;
      if (message.isPlaying || true) { // After seeking, usually play directly
        message.isPlaying = true;
        this.playOmniFromTime(message, time);
      }
    },

    // Core playback logic
    async playOmniFromTime(message, startTime = 0) {
      if (!message.omniAudioChunks || message.omniAudioChunks.length === 0) return;
      
      if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();
      
      // At the start of each new playback, set the scheduling origin to the current time
      this.audioStartTime = this.audioCtx.currentTime;

      let accumulated = 0;
      for (const b64 of message.omniAudioChunks) {
        // If the user clicks pause midway, break out of the loop and stop scheduling
        if (!message.isPlaying) break;

        const chunkDuration = (atob(b64).length / 2) / 24000;
        
        // Only play chunks at or after startTime
        if (accumulated + chunkDuration > startTime) {
          this.playPCMChunk(b64, message.pure_content, message);
        }
        accumulated += chunkDuration;
      }
    },

    // Stop all currently playing audio
    stopAllAudioPlayback() {
      // 1. Stop HTML5 Audio (plain TTS)
      if (this.currentAudio) {
        this.currentAudio.pause();
        this.currentAudio = null;
      }
      
      // 2. Stop the read-aloud audio
      if (this.currentReadAudio) {
        this.currentReadAudio.pause();
        this.currentReadAudio = null;
      }
      
      // 3. [Core fix] stop all Omni nodes of the Web Audio API
      if (this.activeSources && this.activeSources.length > 0) {
        this.activeSources.forEach(src => {
          // New: mark the node as force-killed so onended doesn't disturb the progress bar
          src.isForceStopped = true; 
          try {
            src.stop(); // Stop playback immediately
          } catch (e) {
            // Ignore errors from being already stopped or not yet started
          }
        });
        // Clear the array
        this.activeSources = [];
      }
      
      this.isOmniPlaying = false; // New: reset the global playback state
      this.audioStartTime = 0; 
      
      // 4. Reset all message states
      this.messages.forEach(message => {
        message.isPlaying = false;
      });

      // 6. Send the stop signal to VRM
      this.sendTTSStatusToVRM('stopSpeaking', {});
    },

    async playAudioChunk(message) {
      if (!this.ttsSettings.enabled){
        message.isPlaying = false; // If there are no audio chunks, stop playback
        message.currentChunk = 0; // Reset the index
        return;
      }

      // Initialize the cur_audioDatas object (if it doesn't exist)
      if (!this.cur_audioDatas) {
        this.cur_audioDatas = {};
      }

      // Create a unique key per message using the message ID
      const base64Key = `msg_${message.id}_chunk_${message.currentChunk}`;

      const audioChunk = message.audioChunks[message.currentChunk];
      if (audioChunk) {
        // Check whether there's an audio URL to play
        if (!audioChunk.url) {
          console.log(`Audio chunk ${message.currentChunk} has no URL, skipping`);
          message.currentChunk++;
          this.playAudioChunk(message);
          return;
        }

        const audio = new Audio(audioChunk.url);
        this.currentAudio = audio; // Save the current audio object

        // Set volume: mute when VRM is online (let VRM play); play normally when it's offline
        audio.volume = this.vrmOnline ? 0.0000001 : 1;

        // If there's no base64 data, try generating it from the blob URL
        if (!this.cur_audioDatas[base64Key] && audioChunk.url) {
          try {
            const response = await fetch(audioChunk.url);
            const blob = await response.blob();
            const base64 = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result.split(',')[1]);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
            this.cur_audioDatas[base64Key] = `data:${blob.type};base64,${base64}`;
            console.log(`Generated base64 for ${base64Key}, length: ${this.cur_audioDatas[base64Key].length}`);
          } catch (error) {
            console.warn(`Failed to generate base64 for ${base64Key}:`, error);
            this.cur_audioDatas[base64Key] = '';
          }
        }

        // Send the startSpeaking state to VRM (needs to be sent for every chunk)
        // Only send startSpeaking when base64 data is available
        const audioDataUrl = this.cur_audioDatas[base64Key];
        if (audioDataUrl && audioDataUrl.length > 0) {
          console.log(`Sending startSpeaking with base64 data for ${base64Key}`);
          this.sendTTSStatusToVRM('startSpeaking', {
            audioDataUrl: audioDataUrl,
            chunkIndex: message.currentChunk,
            totalChunks: message.audioChunks.length,
            text: audioChunk.text || '',
            expressions: audioChunk.expressions || [],
            voice: message.chunks_voice ? message.chunks_voice[message.currentChunk] || 'default' : 'default',
          });
        } else {
          console.warn(`No base64 data available for ${base64Key}, skipping startSpeaking`);
        }

        try {
          await audio.play();
          audio.onended = () => {
            // Send the chunkEnded state to VRM
            this.sendTTSStatusToVRM('chunkEnded', {
              chunkIndex: message.currentChunk
            });

            message.currentChunk++; // After playback ends, increment the index
            this.playAudioChunk(message); // Recursively call to play the next audio chunk
          };
          audio.onerror = (error) => {
            console.error(`Error playing audio chunk ${message.currentChunk}:`, error);
            message.isPlaying = false; // Stop playback on error
          };
        } catch (error) {
          console.error(`Error playing audio chunk ${message.currentChunk}:`, error);
          message.currentChunk++; // After playback ends, increment the index
          this.playAudioChunk(message); // Recursively call to play the next audio chunk
        }
      } else {
        message.isPlaying = false; // If there are no audio chunks, stop playback
        message.currentChunk = 0; // Reset the index
        // Send the all-chunks-completed state to VRM
        this.sendTTSStatusToVRM('allChunksCompleted', {});
      }
    },
    backwardTTS(message) {
      if (message.currentChunk > 0) {
        message.currentChunk--; // Decrement the current index
      }
    },

    forwardTTS(message) {
      if (message.currentChunk < message.audioChunks.length - 1) {
        message.currentChunk++; // Increment the current index
      }
    },

    updateLanguages() {
      // Update the language in ttsSettings
      this.ttsSettings.edgettsLanguage = this.edgettsLanguage;
      
      // Update the gender and voice
      this.updateGenders(); 
      this.autoSaveSettings();
    },
    // Update gender and voice when the language changes
    updateGenders() {
      // Update the gender in ttsSettings
      this.ttsSettings.edgettsGender = this.edgettsGender;
      // Update to the first voice
      this.ttsSettings.edgettsVoice = this.filteredVoices[0].name;

      // Update the voice
      this.updateVoices();
      this.autoSaveSettings();
    },


    // Update the voice when the gender changes
    updateVoices() {
      this.autoSaveSettings();
    },

    updateNewLanguages() {
      // Update the language in ttsSettings
      this.newTTSConfig.edgettsVoice = this.filteredNewVoices[0].name;
    },
    // Update gender and voice when the language changes
    updateNewGenders() {
      // Update the gender in ttsSettings
      this.newTTSConfig.edgettsVoice = this.filteredNewVoices[0].name;
    },
    async startVRM() {
    if (this.isElectron) {
      this.VRMConfig.name = 'default';
      await this.autoSaveSettings();
      // Electron environment
      try {
        this.isVRMStarting = true;
        const windowConfig = {
          width: this.VRMConfig.windowWidth,
          height: this.VRMConfig.windowHeight,
        };
        await window.electronAPI.startVRMWindow(windowConfig);
      } catch (error) {
        console.error('启动失败:', error);
      } finally {
        this.isVRMStarting = false;
      }
    } else {
      // Browser environment
      window.open(`${this.partyURL}/vrm.html`, '_blank');
    }
  },
    async startNewVRM(name) {
    try {
      this.isVRMStarting = true;
      this.VRMConfig.name = name;
      this.VRMConfig.selectedNewModelId = this.VRMConfig.newVRM[name].selectedModelId;
      this.VRMConfig.selectedNewMotionIds = this.VRMConfig.newVRM[name].selectedMotionIds;
      await this.autoSaveSettings();
    if (this.isElectron) {
      // Electron environment
        const windowConfig = {
          width: this.VRMConfig.newVRM[name].windowWidth,
          height: this.VRMConfig.newVRM[name].windowHeight,
        };
        await window.electronAPI.startVRMWindow(windowConfig);
    } else {
      // Browser environment
      window.open(`${this.partyURL}/vrm.html`, '_blank');
    }      
  } catch (error) {
    console.error('启动失败:', error);
  } finally {
    this.isVRMStarting = false;
  }
  },
  async startVRMweb() {
    if (this.isElectron) {
      window.electronAPI.openExternal(`${this.partyURL}/vrm.html`);
    }else {
      // Browser environment
      window.open(`${this.partyURL}/vrm.html`, '_blank');
    }
  },
    async checkServerPort() {
      try {
        // Approach 1: use a dedicated method
        const serverInfo = await window.electronAPI.getServerInfo()
        
        
        if (!serverInfo.isDefaultPort) {
          const message = `默认端口 ${serverInfo.defaultPort} 被占用，已自动切换到端口 ${serverInfo.port}`
          showNotification(message, 'warning')
        }
      } catch (error) {
        console.error('获取服务器信息失败:', error)
      }
    },
    // Initialize the WebSocket connection
    initTTSWebSocket() {
      const http_protocol = window.location.protocol;
      const ws_protocol = http_protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${ws_protocol}//${window.location.host}/ws/tts`;
      this.ttsWebSocket = new WebSocket(wsUrl);
      
      this.ttsWebSocket.onopen = () => {
        console.log('TTS WebSocket connected');
        this.wsConnected = true;
      };
      
      // Core feedback handling: listen for JSON messages from the backend
      this.ttsWebSocket.onmessage = async (event) => {
        try {
          // Determine the message type: handle text (JSON)
          if (typeof event.data === 'string') {
            const msg = JSON.parse(event.data);
            
            // Match the VTS status feedback
            if (msg.type === 'vts_connection_status') {
              this.isVTSStarting = false; // Message received; stop loading
              
              if (msg.data.success) {
                // Actually connected successfully
                this.VTSConfig.enabled = true;
                showNotification(msg.data.message || this.t('notifyVtsConnected'), 'success', 'VTS');
              } else {
                // Connection failed: revert the toggle state
                this.VTSConfig.enabled = false;
                // Show an error prompt guiding the user to enable VTS
                showNotification(
                  msg.data.message || 'VTube Studio에서 API 접근 권한을 켰는지 확인하세요', 
                  'error', 
                  'VTS connection failed'
                );
              }
              this.autoSaveSettings(); // Sync-save to the local config
            }
          } 
          // Handle binary (audio stream): if it's audio, forward or play it
          else if (event.data instanceof Blob) {
            // You can keep your original logic here, e.g. hand it to the VRM player
            // this.handleAudioBlob(event.data); 
          }
        } catch (e) {
          console.error('解析 WebSocket 消息出错:', e);
        }
      };
      
      this.ttsWebSocket.onclose = () => {
        console.log('TTS WebSocket disconnected');
        this.wsConnected = false;
        this.isVTSStarting = false; // Stop loading on disconnect
        
        // Auto-reconnect
        setTimeout(() => {
          if (!this.wsConnected) {
            this.initTTSWebSocket();
          }
        }, 3000);
      };
      
      this.ttsWebSocket.onerror = (error) => {
        console.error('TTS WebSocket error:', error);
        this.isVTSStarting = false;
      };
    },
    
    // Send the TTS state to VRM
    async sendTTSStatusToVRM(type, data) {
      if (this.ttsWebSocket && this.wsConnected) {
        this.ttsWebSocket.send(JSON.stringify({
          type,
          data,
          timestamp: Date.now()
        }));
      }
    },
  // Browse for a VRM model file
  browseVrmModelFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.vrm';
    input.onchange = (event) => {
      const files = event.target.files;
      if (files.length > 0) {
        const file = files[0];
        // Check the file extension
        if (!file.name.toLowerCase().endsWith('.vrm')) {
          showNotification(this.t('notifyOnlyVrm'), 'error');
          return;
        }
        this.newVrmModel.name = file.name;
        this.newVrmModel.file = file;
        // Auto-set the display name (without the extension)
        this.newVrmModel.displayName = file.name.replace(/\.vrm$/i, '');
      }
    };
    input.click();
  },
  
  // Handle VRM-model drag-and-drop
  handleVrmModelDrop(event) {
    event.preventDefault();
    const files = event.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      // Check the file extension
      if (!file.name.toLowerCase().endsWith('.vrm')) {
        showNotification(this.t('notifyOnlyVrm'), 'error');
        return;
      }
      this.newVrmModel.name = file.name;
      this.newVrmModel.file = file;
      // Auto-set the display name (without the extension)
      this.newVrmModel.displayName = file.name.replace(/\.vrm$/i, '');
    }
  },
  
  // Remove the selected VRM model
  removeNewVrmModel() {
    this.newVrmModel.name = '';
    this.newVrmModel.displayName = '';
    this.newVrmModel.file = null;
  },
  
  // Cancel the upload
  cancelVrmModelUpload() {
    this.showVrmModelDialog = false;
    this.newVrmModel.name = '';
    this.newVrmModel.displayName = '';
    this.newVrmModel.file = null;
  },
  
  
  // Handle model-selection changes
  handleModelChange(value) {
    // Auto-save settings
    this.autoSaveSettings();
  },
  
 
    // Load the default model list
  async loadDefaultModels() {
    try {
      const response = await fetch(`/get_default_vrm_models`);
      const result = await response.json();
      
      if (result.success) {
        this.VRMConfig.defaultModels = result.models;
        console.log(this.VRMConfig.defaultModels);
        // If no model is selected, default to the first default model
        if (!this.VRMConfig.selectedModelId && result.models.length > 0) {
          this.VRMConfig.selectedModelId = result.models[0].id;
        }
        await this.autoSaveSettings();
      }
    } catch (error) {
      console.error('加载默认模型失败:', error);
    }
  },

  // The modified upload-VRM-model method
  async uploadVrmModel() {
    if (!this.newVrmModel.file) {
      showNotification(this.t('notifySelectVrmFirst'), 'error');
      return;
    }
    
    if (!this.newVrmModel.displayName.trim()) {
      showNotification(this.t('notifyEnterModelName'), 'error');
      return;
    }
    
    const formData = new FormData();
    formData.append('file', this.newVrmModel.file);
    formData.append('display_name', this.newVrmModel.displayName.trim());
    
    try {
      const response = await fetch(`/upload_vrm_model`, {
        method: 'POST',
        body: formData
      });
      
      const result = await response.json();
      
      if (result.success) {
        // Add the new model to the user-model list
        const newModelOption = {
          id: result.file.unique_filename,
          name: result.file.display_name,
          path: result.file.path,
          type: 'user' // Mark it as a user-uploaded model
        };
        
        this.VRMConfig.userModels.push(newModelOption);
        
        // Close the dialog and reset the state
        this.cancelVrmModelUpload();
        
        // Auto-save settings
        await this.autoSaveSettings();
        
        showNotification(this.t('notifyVrmUploaded'));
      } else {
        showNotification(`${this.t('notifyUploadFailedColon')}${result.message}`, 'error');
      }
    } catch (error) {
      console.error('上传VRM模型失败:', error);
      showNotification(this.t('notifyUploadFailedNetwork'), 'error');
    }
  },
  
  // The modified delete-model-option method (only user-uploaded models can be deleted)
  async deleteModelOption(modelId) {
    try {
      // Find the model option to delete (only among user models)
      const modelIndex = this.VRMConfig.userModels.findIndex(
        model => model.id === modelId
      );
      
      if (modelIndex === -1) {
        showNotification(this.t('notifyCannotDeleteDefaultModel'), 'error');
        return;
      }
      
      // Call the backend API to delete the file
      const response = await fetch(`/delete_vrm_model/${modelId}`, {
        method: 'DELETE'
      });
      
      const result = await response.json();
      
      if (result.success) {
        // Remove it from the user-model list
        this.VRMConfig.userModels.splice(modelIndex, 1);
        
        // If the currently selected model is deleted, reset to the default model
        if (this.VRMConfig.selectedModelId === modelId) {
          if (this.VRMConfig.defaultModels.length > 0) {
            this.VRMConfig.selectedModelId = this.VRMConfig.defaultModels[0].id;
          } else {
            this.VRMConfig.selectedModelId = '';
          }
        }
        
        // Auto-save settings
        await this.autoSaveSettings();
        
        showNotification(this.t('notifyVrmDeleted'));
      } else {
        showNotification(`${this.t('notifyDeleteFailedColon')}${result.message}`, 'error');
      }
    } catch (error) {
      console.error('删除VRM模型失败:', error);
      showNotification(this.t('notifyDeleteFailedRetry'), 'error');
    }
  },
  
  // Get the info of the currently selected model
  getCurrentSelectedModel() {
    // Look in the default models first
    let selectedModel = this.VRMConfig.defaultModels.find(
      model => model.id === this.VRMConfig.selectedModelId
    );
    
    // If not found, look among the user models
    if (!selectedModel) {
      selectedModel = this.VRMConfig.userModels.find(
        model => model.id === this.VRMConfig.selectedModelId
      );
    }
    
    return selectedModel;
  },
  // Start live-stream monitoring
  async startLive() {
    if (!this.isLiveConfigValid || this.isLiveRunning || this.isLiveStarting) {
      return;
    }

    this.isLiveStarting = true;
    
    try {
      // Send the start request to the FastAPI backend
      const response = await fetch('/api/live/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          config: this.liveConfig
        })
      });

      const result = await response.json();
      
      if (result.success) {
        this.isLiveRunning = true;
        this.shouldReconnectWs = true; // Allow reconnection at startup
        this.connectLiveWebSocket();
        this.startDanmuProcessor(); // Start the bullet-chat processor
        showNotification(result.message || this.t('live_started_successfully'));
      } else {
        showNotification(result.message || this.t('failed_to_start_live'), 'error');
      }
    } catch (error) {
      console.error('启动直播监听失败:', error);
      showNotification(this.t('failed_to_start_live'), 'error');
    } finally {
      this.isLiveStarting = false;
    }
  },

  // Stop live-stream monitoring
  async stopLive() {
    if (!this.isLiveRunning || this.isLiveStopping) {
      return;
    }

    this.isLiveStopping = true;
    
    try {
      // Set the state first to block WebSocket reconnection
      this.shouldReconnectWs = false;
      this.isLiveRunning = false;
      
      // Stop the bullet-chat processor
      this.stopDanmuProcessor();
      
      // Close the WebSocket connection
      this.disconnectLiveWebSocket();
      
      // Send the stop request to the FastAPI backend
      const response = await fetch('/api/live/stop', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      const result = await response.json();
      
      if (result.success) {
        this.danmu = []; // Clear the bullet-chat data
        showNotification(result.message || this.t('live_stopped_successfully'));
      } else {
        showNotification(result.message || this.t('failed_to_stop_live'), 'error');
        // If the backend stop fails, restore the state
        this.isLiveRunning = true;
        this.shouldReconnectWs = true;
        this.startDanmuProcessor(); // Restart the bullet-chat processor
      }
    } catch (error) {
      console.error('停止直播监听失败:', error);
      showNotification(this.t('failed_to_stop_live'), 'error');
      // On error, restore the state
      this.isLiveRunning = true;
      this.shouldReconnectWs = true;
      this.startDanmuProcessor(); // Restart the bullet-chat processor
    } finally {
      this.isLiveStopping = false;
    }
  },

  // Reload the live-stream config
  async reloadLiveConfig() {
    if (!this.isLiveRunning || this.isLiveReloading) {
      return;
    }

    this.isLiveReloading = true;
    
    try {
      const response = await fetch('/api/live/reload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          config: this.liveConfig
        })
      });

      const result = await response.json();
      
      if (result.success) {
        // Reconnect the WebSocket
        this.shouldReconnectWs = false; // Block reconnection first
        this.disconnectLiveWebSocket();
        
        setTimeout(() => {
          this.shouldReconnectWs = true; // Re-allow reconnection
          this.connectLiveWebSocket();
        }, 1000);
        
        showNotification(result.message || this.t('live_config_reloaded_successfully'));
      } else {
        showNotification(result.message || this.t('failed_to_reload_live_config'), 'error');
      }
    } catch (error) {
      console.error('重载直播配置失败:', error);
      showNotification(this.t('failed_to_reload_live_config'), 'error');
    } finally {
      this.isLiveReloading = false;
    }
  },

  // Start the bullet-chat processor
  startDanmuProcessor() {
    console.log('启动弹幕处理器');
    
    // If a timer is already running, clear it first
    if (this.danmuProcessTimer) {
      clearInterval(this.danmuProcessTimer);
    }
    
    // Check the bullet-chat queue once per second
    this.danmuProcessTimer = setInterval(async () => {
      await this.processDanmuQueue();
    }, 1000);
  },

  // Stop the bullet-chat processor
  stopDanmuProcessor() {
    console.log('停止弹幕处理器');
    
    if (this.danmuProcessTimer) {
      clearInterval(this.danmuProcessTimer);
      this.danmuProcessTimer = null;
    }
    
    this.isProcessingDanmu = false;
  },

// 1. Copy-URL method
  copyDanmakuOverlayEndpoint() {
    const url = this.partyURL + '/danmaku_overlay';
    navigator.clipboard.writeText(url).then(() => {
      if(typeof showNotification === 'function') showNotification(this.t('copySuccess') || 'Copied!', 'success');
    }).catch(() => {
      if(typeof showNotification === 'function') showNotification('Copy failed', 'error');
    });
  },

copySubtitleOverlayEndpoint(){
  const url =  this.partyURL + '/subtitle_overlay';
  navigator.clipboard.writeText(url).then(() => {
    if(typeof showNotification === 'function') showNotification(this.t('copySuccess') || 'Copied!', 'success');
  }).catch(() => {
    if(typeof showNotification === 'function') showNotification('Copy failed', 'error');
  });
},

// Handle the bullet-chat queue - new version
  async processDanmuQueue() {
    try {
      // Basic checks (unchanged)
      if (!this.isLiveRunning || this.danmu.length === 0 || this.isTyping || 
          (this.TTSrunning && this.ttsSettings.enabled) || this.isProcessingDanmu) {
        return;
      }

      this.isProcessingDanmu = true;
      const oldestDanmu = this.danmu[this.danmu.length - 1];
      
      if (oldestDanmu && oldestDanmu.content) {
        if (this.lastProcessedContent === oldestDanmu.content) {
            this.danmu.pop();
            this.isProcessingDanmu = false;
            return;
        }

        console.log('开始处理弹幕:', oldestDanmu.content);
        this.lastProcessedContent = oldestDanmu.content;
        
        // [Key fix 1]: store the bullet chat in a temp variable, ready to inject into the TTS queue
        this.pendingDanmakuToRead = oldestDanmu.content;

        // Set the LLM input
        this.userInput = oldestDanmu.content;
        
        // Trigger the OBS popup display (call the backend API)
        try {
            fetch('/api/overlay/danmaku', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(oldestDanmu)
            }).catch(()=>{});
        } catch(e) {}

        // Send the message to kick off the AI-generation flow
        await this.sendMessage();
        
        this.danmu.pop(); 
      }
    } catch (error) {
      console.error('处理弹幕出错:', error);
      this.danmu.pop(); 
    } finally {
      this.isProcessingDanmu = false;
    }
  },
  // Connect the WebSocket
  connectLiveWebSocket() {
    try {
      // Choose ws or wss based on the current protocol
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/live/danmu`;
      
      this.liveWs = new WebSocket(wsUrl);
      
      this.liveWs.onopen = (event) => {
        console.log('WebSocket连接已建立');
      };
      
      this.liveWs.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleDanmuMessage(data);
        } catch (error) {
          console.error('解析WebSocket消息失败:', error);
        }
      };
      
      this.liveWs.onclose = (event) => {
        console.log('WebSocket连接已关闭');
        
        // Only reconnect when reconnection is allowed and the stream is still running
        if (this.shouldReconnectWs && this.isLiveRunning) {
          console.log('准备重连WebSocket...');
          setTimeout(() => {
            // Re-check the state to make sure reconnection is still needed
            if (this.shouldReconnectWs && this.isLiveRunning) {
              console.log('开始重连WebSocket');
              this.connectLiveWebSocket();
            } else {
              console.log('取消重连WebSocket');
            }
          }, 3000);
        } else {
          console.log('不需要重连WebSocket');
        }
      };
      
      this.liveWs.onerror = (error) => {
        console.error('WebSocket连接错误:', error);
      };
    } catch (error) {
      console.error('创建WebSocket连接失败:', error);
    }
  },

  // Disconnect the WebSocket
  disconnectLiveWebSocket() {
    console.log('断开WebSocket连接');
    
    if (this.liveWs) {
      // Set it to null first to avoid the reconnect logic in the onclose event
      const ws = this.liveWs;
      this.liveWs = null;
      
      // Then close the connection
      ws.close();
    }
  },

  async checkLiveStatus() {
    try {
      const response = await fetch('/api/live/status');
      const result = await response.json();
      
      // Update the state
      this.isLiveRunning = result.is_running;

      // Key: if the backend is running, the frontend must re-mount the WebSocket and processor after a refresh
      if (this.isLiveRunning) {
        console.log('检测到后台直播监听正在运行，正在恢复连接...');
        this.shouldReconnectWs = true;
        
        // Reconnect the WebSocket to receive bullet chats
        this.connectLiveWebSocket();
        
        // Restart the bullet-chat-queue processing timer
        this.startDanmuProcessor();
      }
    } catch (error) {
      console.error('检查直播状态失败:', error);
    }
  },

  // Handle bullet-chat messages
  handleDanmuMessage(data) {
    if (data.type !== 'message') {
      if (data.type === 'error') showNotification(data.message, 'error');
      return;
    }

    // --- 1. ID-level dedup ---
    if (data.id) {
      if (this.receivedMsgIds.has(data.id)) return;
      this.receivedMsgIds.add(data.id);
      if (this.receivedMsgIds.size > 500) {
        const firstVal = this.receivedMsgIds.values().next().value;
        this.receivedMsgIds.delete(firstVal);
      }
    }

    // --- 2. Define message properties uniformly ---
    const danmuType = data.danmu_type; // danmaku, super_chat, gift, buy_guard, enter_room, follow, like
    const isDanmaku = (danmuType === "danmaku" || danmuType === "super_chat");
    const isPaid = (danmuType === "gift" || danmuType === "buy_guard" || danmuType === "super_chat");
    const isInteraction = (danmuType === "enter_room" || danmuType === "follow" || danmuType === "like");

    // --- 3. Mode-filter check ---
    let modePass = false;
    const mode = this.liveConfig.filterMode || 'all';

    if (mode === 'all') {
      modePass = true;
    } else if (mode === 'danmaku_paid') {
      modePass = (isDanmaku || isPaid);
    } else if (mode === 'danmaku_only') {
      modePass = isDanmaku;
    }

    if (!modePass) return;

    // --- 4. Wake-word validation (text messages only) ---
    const wakeStr = this.liveConfig.wakeWord || "";
    const wakeKeywords = wakeStr.split(/[\r\n]+/).map(k => k.trim()).filter(k => k.length > 0);
    
    const isMatchWakeWord = (text) => {
      if (wakeKeywords.length === 0) return true;
      return wakeKeywords.some(keyword => text.includes(keyword));
    };

    let shouldAdd = false;
    if (isDanmaku) {
      // Bullet chats and super chats must match the wake word
      if (isMatchWakeWord(data.content)) shouldAdd = true;
    } else {
      // Interactions like gifts, captains, follows pass through directly (not blocked by the wake word)
      shouldAdd = true;
    }

    // --- 5. Enqueue ---
    if (shouldAdd) {
      const danmuItem = {
        id: data.id,
        content: data.content,
        type: danmuType,
        platform: data.platform || 'live',
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false })
      };

      // Prevent consecutive duplicate content from spamming
      if (this.danmu.length > 0 && this.danmu[0].content === danmuItem.content) return;

      this.danmu.unshift(danmuItem);
      if (this.danmu.length > this.liveConfig.danmakuQueueLimit) {
        this.danmu = this.danmu.slice(0, this.liveConfig.danmakuQueueLimit);
      }
    }
  },
  toggleBriefly(index){
    if (this.messages[index].briefly){
      this.messages[index].briefly = !this.messages[index].briefly;
    }else{
      this.messages[index].briefly = true;
    }
  },
  async rewrite(index){
      if (index != 1){
        // 1. Back up the user message to be rewritten (this.messages[index-1])
        const targetMsg = this.messages[index - 1];

        // 2. Delete index and all messages after it
        this.messages.splice(index);

        // 3. Restore the text content
        this.userInput = this.messages[index-1]?.pure_content ?? this.messages[index-1]?.content ?? '';

        // 4. Restore file/image info (extracted from the backup as Blob-free objects, to avoid re-uploading)
        this.files = targetMsg.fileLinks
          ? targetMsg.fileLinks.map(link => ({ name: link.name, path: link.path }))
          : [];
        this.images = targetMsg.imageLinks
          ? targetMsg.imageLinks.map(link => ({
              name: link.name,
              path: link.path,
              detectedType: link.detectedType   // Keep the type info
            }))
          : [];

        // 5. Delete the original user message (now the last element of the array)
        this.messages.pop();
      } else {
        // Replace the greeting
        this.randomGreetings();
      }

      await this.sendMessage();
  },
  async updateProxy(){
    await this.autoSaveSettings();
    const response = await fetch('/api/update_proxy',{
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    if (response.ok) {
      const data = await response.json();
      console.log(data);
    }else {
      console.error('更新代理失败');
    }
  },
  async openUserfile(){
    const response = await fetch('/api/get_userfile',{
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    if (response.ok) {
      // Get the user file
      const data = await response.json();
      let userfile = data.userfile;    // Open the folder
      if (this.isElectron){
        window.electronAPI.openPath(userfile);
      }
    }
  },
  async openLogfile(){
    const response = await fetch('/api/get_userfile',{
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    if (response.ok) {
      // Get the user file
      const data = await response.json();
      let userfile = data.userfile;    // Open the folder
      if (this.isElectron){
        window.electronAPI.openPath(userfile+'/logs');
      }
    }
  },
  async openExtfile(){
    const response = await fetch('/api/get_extfile',{
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    if (response.ok) {
      // Get the ext file
      const data = await response.json();
      let extfile = data.extfile;    // Open the folder
      if (this.isElectron){
        window.electronAPI.openPath(extfile);
      }
    }
  },
  async changeHAEnabled(){
    if (this.HASettings.enabled){
      const response = await fetch('/start_HA',{
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          data: this.HASettings
        })
      });
      if (response.ok) {
        const data = await response.json();
        console.log(data);
        showNotification(this.t('success_start_HA'));
      }else {
        this.HASettings.enabled = false;
        console.error('启动HA失败');
        showNotification(this.t('error_start_HA'), 'error');
      }
    }else{
      const response = await fetch('/stop_HA',{
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      if (response.ok) {
        const data = await response.json();
        console.log(data);
        showNotification(this.t('success_stop_HA'));
      }else {
        this.HASettings.enabled = true;
        console.error('停止HA失败');
        showNotification(this.t('error_stop_HA'), 'error');
      }
    }
    this.autoSaveSettings();
  },
  async changeChromeMCPEnabled(){

    if (this.chromeMCPSettings.enabled && this.chromeMCPSettings.type === 'internal' && this.isElectron) {
        if (!window.electronAPI) return;
        await this.autoSaveSettings();
        // Get the main process's actual state
        const cdpInfo = await window.electronAPI.getInternalCDPInfo();

        if (!cdpInfo.active) {
            // Serious case: the frontend wants it on, but the main process didn't open the port (meaning no restart)
            // this.chromeMCPSettings.enabled = false; // revert the toggle
            this.showCDPRestartDialog = true;
            
            return; // Abort the subsequent flow
        }

        // The main process has opened the port -> key step: sync the random port!
        // This way the CDPport in the JSON sent to the backend is the port the main process actually listens on (e.g. 9527)
        this.chromeMCPSettings.CDPport = cdpInfo.port;
        console.log(`[CDP] 准备启动 MCP，使用实际端口: ${cdpInfo.port}`);
        
        // Save the latest port to the config file (optional, for safety)
        await this.autoSaveSettings();
        showNotification(this.t('success_start_browserControl'));
    }
    if (this.chromeMCPSettings.enabled && this.chromeMCPSettings.type === 'external'){
      const response = await fetch('/start_ChromeMCP',{
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          data: this.chromeMCPSettings
        })
      });
      if (response.ok){
        const data = await response.json();
        console.log(data);
        showNotification(this.t('success_start_browserControl'));
      }else {
        this.chromeMCPSettings.enabled = false;
        console.error('启动ChromeMCP失败');
        showNotification(this.t('error_start_browserControl'), 'error');
      }
    }else{
      const response = await fetch('/stop_ChromeMCP',{
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
      });
      if (response.ok){
        const data = await response.json();
        console.log(data);
        if (this.chromeMCPSettings.type === 'external'||!this.chromeMCPSettings.enabled){
          showNotification(this.t('success_stop_browserControl'));
        }
      }else {
        this.chromeMCPSettings.enabled = true;
        console.error('停止ChromeMCP失败');
        if (this.chromeMCPSettings.type === 'external'||!this.chromeMCPSettings.enabled){
          showNotification(this.t('error_stop_browserControl'), 'error');
        }
      }
    }
    this.autoSaveSettings();
  },

  async changeSqlEnabled() {
    if (this.sqlSettings.enabled) {
      
      // ==========================================
      // 1. Pre-start validation (new logic)
      // ==========================================
      const settings = this.sqlSettings;
      let errorMsg = '';

      if (settings.engine === 'sqlite') {
        // SQLite only needs to validate dbpath
        if (!settings.dbpath?.trim()) {
          errorMsg = this.t('pleaseConfigSqliteDbpath');
        }
      } else {
        // Other databases validate host, port, user, password, dbname
        if (!settings.host?.trim()) {
          errorMsg = this.t('pleaseConfigSqlHost');
        } else if (settings.port === undefined || settings.port === null || settings.port === '') {
          errorMsg = this.t('pleaseConfigSqlPort');
        } else if (!settings.user?.trim()) {
          errorMsg = this.t('pleaseConfigSqlUser');
        } else if (!settings.password?.trim()) {
          errorMsg = this.t('pleaseConfigSqlPassword');
        } else if (!settings.dbname?.trim()) {
          errorMsg = this.t('pleaseConfigSqlDbname');
        }
      }

      // Validation failed: show an error, reset the toggle, and block execution
      if (errorMsg) {
        const errorTitle = this.t ? this.t('configIncomplete') : 'Configuration Incomplete';
        showNotification(errorMsg, 'error', errorTitle);

        this.$nextTick(() => {
          this.sqlSettings.enabled = false;
        });
        
        return; // Must return to prevent the fetch request below from running
      }

      // ==========================================
      // 2. The original start logic (runs after validation passes)
      // ==========================================
      const response = await fetch('/start_sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          data: this.sqlSettings
        })
      });
      if (response.ok) {
        const data = await response.json();
        console.log(data);
        showNotification(this.t('success_start_sqlControl'));
      } else {
        this.sqlSettings.enabled = false;
        console.error('启动sql失败');
        showNotification(this.t('error_start_sqlControl'), 'error');
      }

    } else {
      
      // ==========================================
      // 3. The original stop logic (runs when the user turns off the toggle)
      // ==========================================
      const response = await fetch('/stop_sql', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
      });
      if (response.ok) {
        const data = await response.json();
        console.log(data);
        showNotification(this.t('success_stop_sqlControl'));
      } else {
        this.sqlSettings.enabled = true;
        console.error('停止sql失败');
        showNotification(this.t('error_stop_sqlControl'), 'error');
      }
    }
    
    // ==========================================
    // 4. Save the config after the operation succeeds
    // ==========================================
    this.autoSaveSettings();
  },
  
    // Load the default motion list
  async loadDefaultMotions() {
    try {
      const response = await fetch(`/get_default_vrma_motions`);
      const result = await response.json();
      
      if (result.success) {
        this.VRMConfig.defaultMotions = result.motions;
        console.log('默认动作列表:', this.VRMConfig.defaultMotions);
        await this.autoSaveSettings();
      }
    } catch (error) {
      console.error('加载默认动作失败:', error);
    }
  },

  // Handle motion-selection changes
  handleMotionChange(value) {
    console.log('选中的动作:', value);
    // Auto-save settings
    this.autoSaveSettings();
  },

  // Browse for a VRMA motion file
  browseVrmaMotionFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.vrma';
    input.multiple = true; // Allow multi-select
    input.onchange = (event) => {
      const files = event.target.files;
      if (files.length > 0) {
        // If multiple files are selected, only process the first (or modify this to support batch upload)
        const file = files[0];
        // Check the file extension
        if (!file.name.toLowerCase().endsWith('.vrma')) {
          showNotification(this.t('notifyOnlyVrma'), 'error');
          return;
        }
        this.newVrmaMotion.name = file.name;
        this.newVrmaMotion.file = file;
        // Auto-set the display name (without the extension)
        this.newVrmaMotion.displayName = file.name.replace(/\.vrma$/i, '');
      }
    };
    input.click();
  },

  // Handle VRMA-motion drag-and-drop
  handleVrmaMotionDrop(event) {
    event.preventDefault();
    const files = event.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      // Check the file extension
      if (!file.name.toLowerCase().endsWith('.vrma')) {
        showNotification(this.t('notifyOnlyVrma'), 'error');
        return;
      }
      this.newVrmaMotion.name = file.name;
      this.newVrmaMotion.file = file;
      // Auto-set the display name (without the extension)
      this.newVrmaMotion.displayName = file.name.replace(/\.vrma$/i, '');
    }
  },

  // Remove the selected VRMA motion
  removeNewVrmaMotion() {
    this.newVrmaMotion.name = '';
    this.newVrmaMotion.displayName = '';
    this.newVrmaMotion.file = null;
  },

  // Cancel the VRMA-motion upload
  cancelVrmaMotionUpload() {
    this.showVrmaMotionDialog = false;
    this.newVrmaMotion.name = '';
    this.newVrmaMotion.displayName = '';
    this.newVrmaMotion.file = null;
  },

  // Upload the VRMA motion
  async uploadVrmaMotion() {
    if (!this.newVrmaMotion.file) {
      showNotification(this.t('notifySelectVrmaFirst'), 'error');
      return;
    }
    
    if (!this.newVrmaMotion.displayName.trim()) {
      showNotification(this.t('notifyEnterMotionName'), 'error');
      return;
    }
    
    const formData = new FormData();
    formData.append('file', this.newVrmaMotion.file);
    formData.append('display_name', this.newVrmaMotion.displayName.trim());
    
    try {
      const response = await fetch(`/upload_vrma_motion`, {
        method: 'POST',
        body: formData
      });
      
      const result = await response.json();
      
      if (result.success) {
        // Add the new motion to the user-motion list
        const newMotionOption = {
          id: result.file.unique_filename,
          name: result.file.display_name,
          path: result.file.path,
          type: 'user' // Mark it as a user-uploaded motion
        };
        
        this.VRMConfig.userMotions.push(newMotionOption);
        
        // Auto-select the newly uploaded motion
        if (!this.VRMConfig.selectedMotionIds.includes(newMotionOption.id)) {
          this.VRMConfig.selectedMotionIds.push(newMotionOption.id);
        }
        
        // Close the dialog and reset the state
        this.cancelVrmaMotionUpload();
        
        // Auto-save settings
        await this.autoSaveSettings();
        
        showNotification(this.t('notifyVrmaUploaded'));
      } else {
        showNotification(`${this.t('notifyUploadFailedColon')}${result.message}`, 'error');
      }
    } catch (error) {
      console.error('上传VRMA动作失败:', error);
      showNotification(this.t('notifyUploadFailedNetwork'), 'error');
    }
  },

  // Delete a motion option (only user-uploaded motions can be deleted)
  async deleteMotionOption(motionId) {
    try {
      // Find the motion option to delete (only among user motions)
      const motionIndex = this.VRMConfig.userMotions.findIndex(
        motion => motion.id === motionId
      );
      
      // Call the backend API to delete the file
      const response = await fetch(`/delete_vrma_motion/${motionId}`, {
        method: 'DELETE'
      });
      
      const result = await response.json();
      
      if (result.success) {
        // Remove it from the user-motion list
        this.VRMConfig.userMotions.splice(motionIndex, 1);
        
        // If the deleted motion is in the current selection, remove it from the selected list
        const selectedIndex = this.VRMConfig.selectedMotionIds.indexOf(motionId);
        if (selectedIndex > -1) {
          this.VRMConfig.selectedMotionIds.splice(selectedIndex, 1);
        }
        
        // Auto-save settings
        await this.autoSaveSettings();
        
        showNotification(this.t("VRMAactionDeleted"));
      } else {
        showNotification(`error: ${result.message}`, 'error');
      }
    } catch (error) {
      console.error('删除VRMA动作失败:', error);
      showNotification(error, 'error');
    }
  },

  // Get the info of the currently selected motions
  getCurrentSelectedMotions() {
    const selectedMotions = [];
    
    // Look among the default motions
    this.VRMConfig.defaultMotions.forEach(motion => {
      if (this.VRMConfig.selectedMotionIds.includes(motion.id)) {
        selectedMotions.push(motion);
      }
    });
    
    // Look among the user motions
    this.VRMConfig.userMotions.forEach(motion => {
      if (this.VRMConfig.selectedMotionIds.includes(motion.id)) {
        selectedMotions.push(motion);
      }
    });
    
    return selectedMotions;
  },

  // Get all available motions (default + user-uploaded)
  getAllAvailableMotions() {
    return [...this.VRMConfig.defaultMotions, ...this.VRMConfig.userMotions];
  },

  // Get motion info by ID
  getMotionById(motionId) {
    // Look in the default motions first
    let motion = this.VRMConfig.defaultMotions.find(m => m.id === motionId);
    
    // If not found, look among the user motions
    if (!motion) {
      motion = this.VRMConfig.userMotions.find(m => m.id === motionId);
    }
    
    return motion;
  },

/* Lifecycle: read the scene list */
async loadGaussScenes() {
  const [def, user] = await Promise.all([
    fetch('/get_default_gauss_scenes').then(r => r.json()),
    fetch('/get_user_gauss_scenes').then(r => r.json())
  ]);
  this.VRMConfig.gaussDefaultScenes = def.scenes || [];
  this.VRMConfig.gaussUserScenes   = user.scenes || [];
  console.log("默认场景：",this.VRMConfig.gaussDefaultScenes);
  if (!this.VRMConfig.selectedGaussSceneId) {
    this.VRMConfig.selectedGaussSceneId = 'transparent';
  }
  this.autoSaveSettings();
},
/* Switch the background in real time after selecting a scene */
async handleGaussSceneChange(sceneId) {
  // Similar to switching VRM models: write the scene id into VRMConfig
  this.VRMConfig.selectedGaussSceneId = sceneId;

  this.autoSaveSettings();
},

/* Upload-area click */
browseGaussSceneFile() {
  const ipt = document.createElement('input');
  ipt.type = 'file';
  ipt.accept = '.ply,.spz,.splat,.ksplat,.sog';
  ipt.onchange = e => {
    const file = e.target.files[0];
    if (file) {
      this.newGaussScene.name = file.name;
      this.newGaussScene.file = file;   // Save the original File object
      this.newGaussScene.displayName = this.newGaussScene.displayName || this.newGaussScene.name;
    }
  };
  ipt.click();
},

/* Drag-and-drop upload */
handleGaussSceneDrop(e) {
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['ply','spz','splat','ksplat','sog'].includes(ext)) {
    return showNotification(this.t('notifyUnsupportedFileType'), 'error');
  }
  this.newGaussScene.name = file.name;
  this.newGaussScene.file = file;
  this.newGaussScene.displayName = this.newGaussScene.displayName || this.newGaussScene.name;
},

/* Remove the file pending upload */
removeNewGaussScene() {
  this.newGaussScene = { name: '', displayName: '' };
},

/* Actually upload */
async uploadGaussScene() {
  const fd = new FormData();
  fd.append('file', this.newGaussScene.file);
  fd.append('display_name', this.newGaussScene.displayName || this.newGaussScene.name);
  console.log("上传场景：",fd);
  const res = await fetch('/upload_gauss_scene', {
    method: 'POST',
    body: fd
  }).then(r => r.json());

  if (res.success) {
    showNotification(this.t('notifySceneUploaded'));
    this.showGaussSceneDialog = false;
    // Add the new motion to the user-motion list
    const newgaussScenes = {
      id: res.file.unique_filename,
      name: res.file.display_name,
      path: res.file.path,
      type: 'user' // Mark it as a user-uploaded motion
    };
        
    this.VRMConfig.gaussUserScenes.push(newgaussScenes);
    // Auto-select the newly uploaded scene
    if (newgaussScenes) this.handleGaussSceneChange(newgaussScenes.id);
  } else {
    showNotification(res.message || this.t('notifyUploadFailed'), 'error');
  }
},

/* Cancel the upload */
cancelGaussSceneUpload() {
  this.showGaussSceneDialog = false;
  this.removeNewGaussScene();
},

/* Delete a user scene */
async deleteGaussSceneOption(sceneId) {
  const scene = this.VRMConfig.gaussUserScenes.find(s => s.id === sceneId);
  if (!scene) return;

  // Extract the uuid filename
  const filename = scene.path.split('/').pop();
  const res = await fetch(`/delete_gauss_scene/${filename}`, {
    method: 'DELETE'
  }).then(r => r.json());

  if (res.success) {
    showNotification(this.t('notifySceneDeleted'));
    // If the scene being deleted is in use, switch back to the first default scene
    if (this.VRMConfig.selectedGaussSceneId === sceneId) {
      const firstDef = this.VRMConfig.gaussDefaultScenes[0];
      if (firstDef) this.handleGaussSceneChange(firstDef.id);
    }
    await this.loadGaussScenes();
  } else {
    showNotification(res.message || this.t('notifyDeleteFailed'), 'error');
  }
},


  async confirmClearAll() {
    await this.clearAllHistoryRecords();
  },

  async keepLastWeek() {
    try {
      await this.$confirm(this.t('confirmKeepLastWeek'), this.t('warning'), {
        confirmButtonText: this.t('confirm'),
        cancelButtonText: this.t('cancel'),
        type: 'warning'
      });

      const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
      this.conversations = this.conversations.filter(conv => 
        conv.timestamp && conv.timestamp >= oneWeekAgo
      );
      if (this.conversations == []){
        this.conversationId = null; // Clear the current conversation ID
      }
      
      await this.saveConversations();
    } catch (error) {
      // The user canceled the operation
    }
  },
    /* ===============  Read-aloud main flow  =============== */
toggleRead() {
  if (this.isReadRunning) {
    if (this.isReadPaused) {
      this.resumeRead();
    } else {
      this.pauseRead();
    }
  } else {
    this.startRead();
  }
},

// The modified startRead method
async startRead() {
  if (!this.readConfig.longText.trim()) return;
  
  this.stopSegmentTTS();
  this.readState.currentChunk = 0;
  this.isReadStarting = true;
  this.isReadRunning  = true;
  this.isReadPaused   = false;  // Reset the pause state
  this.isReadStopping = false;

  /* Clear leftovers from last time */
  this.readState.ttsChunks  = [];
  this.readState.audioChunks = [];
  this.readState.currentChunk = 0;
  this.readState.isPlaying = false;
  this.readState.chunks_voice = [];
  this.cur_voice = 'default';
  
  /* Reset the audio-count state */
  this.audioChunksCount = 0;
  this.totalChunksCount = 0;

  /* Segmentation logic (unchanged) */
  const {
    chunks,
    chunks_voice,
    remaining,
    remaining_voice
  } = this.splitTTSBuffer(this.readConfig.longText);

  if (remaining) {
    chunks.push(remaining);
    chunks_voice.push(remaining_voice);
  }

  /* Strip tags + whitespace and delete in sync */
  const cleanedChunks = chunks.map(txt => txt.replace(/<\/?[^>]+>/g, '').trim());
  const finalChunks = [];
  const finalChunksVoice = [];

  cleanedChunks.forEach((txt, idx) => {
    if (txt) {
      finalChunks.push(txt);
      finalChunksVoice.push(chunks_voice[idx]);
    }
  });

  if (!finalChunks.length) {
    this.isReadRunning  = false;
    this.isReadStarting = false;
    return;
  }

  this.readState.ttsChunks   = finalChunks;
  this.readState.chunks_voice = finalChunksVoice;
  this.totalChunksCount = finalChunks.length;

  /* Notify VRM that read-aloud is starting */
  this.sendTTSStatusToVRM('ttsStarted', {
    totalChunks: this.readState.ttsChunks.length
  });

  this.isReadStarting = false;

  /* Concurrent TTS */
  this.isAudioSynthesizing = true;
  await this.startReadTTSProcess();
},

// New: pause read-aloud
pauseRead() {
  if (!this.isReadRunning || this.isReadPaused) return;
  
  this.isReadPaused = true;
  
  // Pause the current audio
  if (this.currentReadAudio) {
    this.currentReadAudio.pause();
  }
  
  // Notify VRM to pause
  this.sendTTSStatusToVRM('pauseSpeaking', {});
},

// New: resume read-aloud
resumeRead() {
  if (!this.isReadRunning || !this.isReadPaused) return;
  
  this.isReadPaused = false;
  
  // Resume the current audio playback
  if (this.currentReadAudio) {
    this.currentReadAudio.play().catch(console.error);
  }
  
  // Notify VRM to resume
  this.sendTTSStatusToVRM('resumeSpeaking', {});
  
  // Try to continue playing the subsequent audio
  this.checkReadAudioPlayback();
},

    // The modified processReadTTSChunk method
    async processReadTTSChunk(index) {
      try {
        const chunk = this.readState.ttsChunks[index];
        const voice = this.readState.chunks_voice[index];
        const cachedAudio = this.readState.audioChunks[index];

        // --- Change 1: switch the cache check from base64 to buffer ---
        if (cachedAudio?.url && cachedAudio?.buffer && cachedAudio?.text === chunk && cachedAudio?.voice === voice){
          // this.cur_audioDatas[index] = cachedAudio.buffer; // can be omitted; just use readState
        }
        else{
          let chunk_text = chunk;
          let  chunk_expressions = [];
          if (chunk.indexOf('<') !== -1) {
              const tagReg = /<[^>]+>/g;
              chunk_expressions = (chunk.match(tagReg) || []).map(t => t.slice(1, -1));
              chunk_text = chunk.replace(tagReg, '').trim();
          }

          const res = await fetch('/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ttsSettings: this.ttsSettings, text: chunk_text, index, voice })
          });

          if (!res.ok) throw new Error('TTS failed');

          const blob = await res.blob();
          const url  = URL.createObjectURL(blob);

          // --- Change 2: drop Base64, use ArrayBuffer instead ---
          const audioBuffer = await blob.arrayBuffer();

          this.readState.audioChunks[index] = {
            url,                       
            expressions: chunk_expressions,
            buffer: audioBuffer, // <--- cache the binary
            mimeType: blob.type, // <--- save the real type
            text: chunk_text,
            index,
            voice
          };
        }

        this.audioChunksCount++;
        if (this.audioChunksCount >= this.totalChunksCount) {
          this.isAudioSynthesizing = false;
          this.audioChunksCount = this.totalChunksCount; 
        }

        this.checkReadAudioPlayback();
      } catch (e) {
        console.error(`Read TTS chunk ${index} error`, e);
        this.readState.audioChunks[index] = { url: null, expressions: [], text: "", index };
        this.audioChunksCount++;
        if (this.audioChunksCount >= this.totalChunksCount) {
          this.isAudioSynthesizing = false;
          this.audioChunksCount = this.totalChunksCount; 
        }
        this.checkReadAudioPlayback();
      }
    },

    async ClickToListen(SampleText,voice='default') {
      if (!SampleText) {
        SampleText ='super agent party가 모든 것을 연결합니다!'
      }

    try {
      // Create a copy to avoid mutating this.ttsSettings directly
      let Settings = { ...this.ttsSettings };

      if (this.showAddTTSDialog) {
        Settings = { ...Settings, ...this.newTTSConfig };
      } else if (voice !== 'default' && this.ttsSettings.newtts && this.ttsSettings.newtts[voice]) {
        // Called from a character voice card: merge the character config
        Settings = { ...Settings, ...this.ttsSettings.newtts[voice] };
      }

      // Key fix: include modelProviders so the backend can look up the API key
      // Backend logic: if the character config lacks an api_key but has a selectedProvider, it looks here
      if (this.modelProviders && Array.isArray(this.modelProviders)) {
        Settings.modelProviders = this.modelProviders;
      }

        const res = await fetch('/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ttsSettings: Settings,
            text: SampleText,
            index: 0,          // Pass any index; the backend doesn't care
            voice: voice || 'default'
          })
        });
        if (!res.ok) throw new Error('TTS failed');

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);

        /* Play directly */
        const audio = new Audio(url);
        audio.play().catch(console.error);

        /* Clear memory after playback finishes */
        audio.onended = () => URL.revokeObjectURL(url);
      } catch (e) {
        console.error('ClickToListen error', e);
      }
    },

    // Add the download method
    downloadAudio() {
      // Ensure there are audio segments to download
      if (this.audioChunksCount === 0) {
        showNotification(this.t('noAudioToDownload'));
        return;
      }

      // Check whether there are valid audio segments
      const validChunks = this.readState.audioChunks.filter(chunk => chunk && chunk.url);
      if (validChunks.length === 0) {
        showNotification(this.t('noValidAudioChunks'));
        return;
      }

      try {
        // Create a merged audio file containing only valid segments
        this.createCombinedAudio(validChunks, this.getAudioMimeType());
      } catch (error) {
        console.error('Audio download failed:', error);
        showNotification(this.t('audioDownloadFailed'));
      }
    },



    // 1. Modify downloadAudio: no longer pass a MIME type; let it auto-detect internally
    downloadAudio() {
      if (this.audioChunksCount === 0) {
        showNotification(this.t('noAudioToDownload'));
        return;
      }

      // Filter out invalid segments
      const validChunks = this.readState.audioChunks.filter(chunk => chunk && chunk.url);
      if (validChunks.length === 0) {
        showNotification(this.t('noValidAudioChunks'));
        return;
      }

      try {
        // Call directly without arguments; the function detects the format itself
        this.createCombinedAudio(validChunks);
      } catch (error) {
        console.error('Audio download failed:', error);
        showNotification(this.t('audioDownloadFailed'));
      }
    },

    // 2. Rewrite createCombinedAudio: the core change is 'auto-detecting the real format'
    async createCombinedAudio(chunks) {
      if (!chunks || chunks.length === 0) return;

      showNotification(this.t('audioProcessingStarted') || '오디오 처리 중...');

      try {
        // ================= Key step: detect the real format =================
        // Fetch the first segment first, checking the HTTP header or Blob type as the source of truth
        const firstResponse = await fetch(chunks[0].url);
        const firstBlob = await firstResponse.blob();
        
        // Get the real MIME (e.g. "audio/ogg; codecs=opus" -> "audio/ogg")
        const realMimeType = firstBlob.type.split(';')[0]; 
        
        console.log('Detected Real Audio Format:', realMimeType);

        // Derive the extension and handling logic from the real MIME
        let extension = 'mp3'; // Default
        let isWav = false;

        if (realMimeType.includes('wav')) {
          extension = 'wav';
          isWav = true;
        } else if (realMimeType.includes('ogg')) {
          extension = 'ogg';
        } else if (realMimeType.includes('aac')) {
          extension = 'aac';
        } else if (realMimeType.includes('flac')) {
          extension = 'flac';
        } else if (realMimeType.includes('webm')) {
          extension = 'webm';
        } else if (realMimeType.includes('mp4') || realMimeType.includes('m4a')) {
          extension = 'm4a';
        }

        // ================= Start fetching all data =================
        // Reuse the first Blob to save one request
        const firstBuffer = await firstBlob.arrayBuffer();
        
        // Fetch the remaining segments concurrently
        const restPromises = chunks.slice(1).map(async (chunk) => {
          const response = await fetch(chunk.url);
          return response.arrayBuffer();
        });
        
        const restBuffers = await Promise.all(restPromises);
        const allBuffers = [firstBuffer, ...restBuffers];

        // ================= Merge based on the real format =================
        let combinedBuffer;

        if (isWav) {
          // WAV-specific handling: strip the header
          combinedBuffer = this.mergeWavBuffers(allBuffers);
        } else {
          // Other formats (MP3, OGG, etc.): concatenate directly
          // Note: concatenating OGG directly may only play the first sentence in the browser (chained Ogg),
          // but it's complete when downloaded and played in a local player (VLC/PotPlayer). That's a property of lossless concatenation.
          combinedBuffer = this.mergeGeneralBuffers(allBuffers);
        }

        // ================= Download the file =================
        const blob = new Blob([combinedBuffer], { type: realMimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        
        a.href = url;
        // Use the detected real extension
        a.download = `tts-merged-${timestamp}.${extension}`; 
        
        document.body.appendChild(a);
        a.click();
        
        // Cleanup
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 100);
        
        showNotification(this.t('audioDownloadStarted'));

      } catch (error) {
        console.error('Audio merging failed:', error);
        showNotification(this.t('audioMergeFailed'));
      }
    },

    // --- Helper functions stay unchanged ---
    
    // Generic concatenation (MP3/OGG/AAC)
    mergeGeneralBuffers(buffers) {
      const totalLength = buffers.reduce((acc, buffer) => acc + buffer.byteLength, 0);
      const result = new Uint8Array(totalLength);
      
      let offset = 0;
      buffers.forEach(buffer => {
        result.set(new Uint8Array(buffer), offset);
        offset += buffer.byteLength;
      });
      
      return result;
    },

    // WAV-specific concatenation
    mergeWavBuffers(buffers) {
      if (buffers.length === 0) return new Uint8Array(0);
      if (buffers.length === 1) return new Uint8Array(buffers[0]);

      const HEADER_SIZE = 44; 
      let totalDataLength = 0;
      
      buffers.forEach((buffer, index) => {
        if (index === 0) totalDataLength += buffer.byteLength;
        else totalDataLength += Math.max(0, buffer.byteLength - HEADER_SIZE);
      });

      const result = new Uint8Array(totalDataLength);
      
      // Write the first file (with header)
      result.set(new Uint8Array(buffers[0]), 0);
      let offset = buffers[0].byteLength;

      // Write the subsequent files (header stripped)
      for (let i = 1; i < buffers.length; i++) {
        const buffer = new Uint8Array(buffers[i]);
        if (buffer.byteLength > HEADER_SIZE) {
            const dataChunk = buffer.subarray(HEADER_SIZE);
            result.set(dataChunk, offset);
            offset += dataChunk.byteLength;
        }
      }

      // Fix the WAV header
      const view = new DataView(result.buffer);
      view.setUint32(4, result.byteLength - 8, true); 
      view.setUint32(40, result.byteLength - HEADER_SIZE, true);

      return result;
    },


// The modified stopRead method
stopRead() {
  if (!this.isReadRunning) return;
  
  this.isReadStopping = true;
  this.isReadRunning  = false;
  this.isReadPaused   = false;  // Reset the pause state
  this.readState.isPlaying = false;

  /* Stop the current audio */
  if (this.currentReadAudio) {
    this.currentReadAudio.pause();
    this.currentReadAudio = null;
  }
  
  this.sendTTSStatusToVRM('stopSpeaking', {});
  
  /* Reset the audio-count state */
  this.isAudioSynthesizing = false;
  this.audioChunksCount = 0;
  this.totalChunksCount = 0;
  
  this.isReadStopping = false;
},

// The modified stopTTSActivities method
stopTTSActivities() {
  // Stop the read-aloud flow
  if (this.isReadRunning) {
    this.isReadStopping = true;
    this.isReadRunning = false;
    this.isReadPaused = false;  // Reset the pause state
    this.readState.isPlaying = false;
    
    /* Stop the current audio */
    if (this.currentReadAudio) {
      this.currentReadAudio.pause();
      this.currentReadAudio = null;
    }
    this.sendTTSStatusToVRM('stopSpeaking', {});
    
    /* Reset the audio-count state */
    this.isAudioSynthesizing = false;
    
    this.isReadStopping = false;
  }
  
  // Stop the audio-conversion flow (unchanged)
  if (this.isConvertingAudio) {
    this.isConvertStopping = true;
    this.isConvertingAudio = false;
    this.isAudioSynthesizing = false;
    showNotification(this.t('audioConversionStopped'));
    this.isConvertStopping = false;
  }
},
  /* ===============  Reused / tweaked TTS flow  =============== */
  async startReadTTSProcess() {
    let max_concurrency = this.ttsSettings.maxConcurrency || 1;
    let nextIndex = 0;

    /* The only difference from the chat version: readState replaces messages[last] */
    while (this.isReadRunning) {
      while (
        this.readState.ttsQueue.size < max_concurrency &&
        nextIndex < this.readState.ttsChunks.length
      ) {
        if (!this.isReadRunning) break;

        const index = nextIndex++;
        this.readState.ttsQueue.add(index);

        this.processReadTTSChunk(index).finally(() => {
          this.readState.ttsQueue.delete(index);
        });

        /* First-packet acceleration */
        if (index === 0) await new Promise(r => setTimeout(r, 800));
      }
      await new Promise(r => setTimeout(r, 10));
    }
    console.log('Read TTS queue processing completed');
  },

  // The modified convertAudioOnly method
  async convertAudioOnly() {
    if (!this.readConfig.longText.trim()) {
      showNotification(this.t('noTextToConvert'));
      return;
    }

    this.isConvertingAudio = true;
    
    try {
      // 1. Clear leftovers from last time
      this.readState.ttsChunks = [];
      this.readState.audioChunks = [];
      this.readState.chunks_voice = [];
      this.audioChunksCount = 0;
      this.totalChunksCount = 0;

  /* 2. Segment */
      const {
        chunks,
        chunks_voice,
        remaining,
        remaining_voice
      } = this.splitTTSBuffer(this.readConfig.longText);

      // Append the remaining
      if (remaining) {
        chunks.push(remaining);
        chunks_voice.push(remaining_voice);
      }

      /* ================= New: strip tags + whitespace and delete in sync ================= */
      // 1. Strip HTML tags
      const cleanedChunks = chunks.map(txt => txt.replace(/<\/?[^>]+>/g, '').trim());

      // 2. Filter out whitespace and delete the corresponding chunks_voice entries in sync
      const finalChunks       = [];
      const finalChunksVoice  = [];

      cleanedChunks.forEach((txt, idx) => {
        if (txt) {                      // Keep only non-empty ones
          finalChunks.push(txt);
          finalChunksVoice.push(chunks_voice[idx]);
        }
      });

      // 3. Overwrite the original array
      chunks.length       = 0;
      chunks_voice.length = 0;
      chunks.push(...finalChunks);
      chunks_voice.push(...finalChunksVoice);
      /* ================================================================ */
      
      if (!chunks.length) {
        this.isConvertingAudio = false;
        return;
      }
      
      this.readState.ttsChunks = chunks;
      this.readState.chunks_voice = chunks_voice;
      this.totalChunksCount = chunks.length;

      // 3. Start conversion (reuse processReadTTSChunk but with playback disabled)
      this.isAudioSynthesizing = true;
      
      // Process all segments with concurrency control
      const maxConcurrency = this.ttsSettings.maxConcurrency || 1;
      let nextIndex = 0;
      const activeTasks = new Set();
      
      // Use a Promise to wait for all tasks to finish
      await new Promise((resolve) => {
        const processNext = async () => {
          // Check whether the user stopped it
          if (!this.isConvertingAudio) {
            resolve();
            return;
          }
          
          // All tasks complete
          if (nextIndex >= chunks.length && activeTasks.size === 0) {
            resolve();
            return;
          }
          
          // Add a new task (if there's a free slot and remaining tasks)
          while (activeTasks.size < maxConcurrency && nextIndex < chunks.length) {
            const index = nextIndex++;
            activeTasks.add(index);
            
            this.processTTSChunkWithoutPlayback(index)
              .finally(() => {
                activeTasks.delete(index);
                processNext(); // Check whether a new task can be added
              });
          }
        };
        
        processNext();
      });
      
      // Only show the completion notification if it wasn't stopped
      if (this.isConvertingAudio) {
        this.isAudioSynthesizing = false;
        showNotification(this.t('audioConversionCompleted', { count: chunks.length }));
      }
      
    } catch (error) {
      console.error('Audio conversion failed:', error);
      showNotification(this.t('audioConversionFailed'));
    } finally {
      this.isConvertingAudio = false;
    }
  },

    // Process the TTS segment without playing it
    async processTTSChunkWithoutPlayback(index) {
      const chunk = this.readState.ttsChunks[index];
      const voice = this.readState.chunks_voice[index];
      console.log(`Processing TTS chunk ${index}`);
      // Text cleaning
      let chunk_text = chunk;
      let chunk_expressions =[];
      if (chunk.indexOf('<') !== -1) {
        const tagReg = /<[^>]+>/g;
        chunk_expressions = (chunk.match(tagReg) || []).map(t => t.slice(1, -1)); // Strip the <> from both ends
        chunk_text = chunk.replace(tagReg, '').trim(); // Remove the tags from the body text
      }

      try {
        const res = await fetch('/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ttsSettings: this.ttsSettings,
            text: chunk_text,
            index,
            voice
          })
        });

        if (!res.ok) throw new Error('TTS failed');

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audioBuffer = await blob.arrayBuffer();
        /* Base64 for VRM */
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload  = () => resolve(reader.result.split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        this.cur_audioDatas[index] = `data:${blob.type};base64,${base64}`;
        /* Cache two things */
        this.readState.audioChunks[index] = {
          url,                       // For local playback
          expressions: chunk_expressions,
          buffer: audioBuffer, 
          mimeType: blob.type, 
          text: chunk_text,
          index,
          voice
        };
        // Increment the count
        this.audioChunksCount++;
        if (this.audioChunksCount >= this.totalChunksCount) {
          this.isAudioSynthesizing = false;
          this.audioChunksCount = this.totalChunksCount; // Reset the count
        }
      } catch (e) {
        console.error(`TTS chunk ${index} error`, e);
        this.readState.audioChunks[index] = { 
          url: null, 
          expressions: chunk_expressions, 
          text: chunk_text, 
          index 
        };
        
        // Increment the count on error too
        this.audioChunksCount++;
        if (this.audioChunksCount >= this.totalChunksCount) {
          this.isAudioSynthesizing = false;
          this.audioChunksCount = this.totalChunksCount; // Reset the count
        }
      }
    },

  /* ===============  Playback monitoring  =============== */
  async startReadAudioPlayProcess() {
    /* Identical to the chat version's startAudioPlayProcess, just with readState swapped in */
    this.readState.currentChunk = 0;
    this.readState.isPlaying   = false;
    this.audioPlayQueue = [];
  },

  async checkReadAudioPlayback() {
    if (this.isReadPaused) return;
    if (!this.isReadRunning || this.readState.isPlaying) return;

    const curIdx = this.readState.currentChunk;
    const total  = this.readState.ttsChunks.length;
    if (curIdx >= total) {
      console.log('All read audio chunks played');
      this.readState.currentChunk = 0;
      this.isReadRunning = false;
      this.cur_audioDatas = [];
      this.sendTTSStatusToVRM('allChunksCompleted', {});
      return;
    }

    const audioChunk = this.readState.audioChunks[curIdx];
    if (!audioChunk) return;

    this.readState.isPlaying = true;
    console.log(`Playing read audio chunk ${curIdx}`);
    this.scrollToCurrentChunk(curIdx);
    
    try {
      // --- Change 5: send binary data to VRM (copies the core logic of chat playback) ---
      if ((this.vrmOnline || this.vtsOnline) && audioChunk.buffer) {
          const metadata = {
              type: 'audio_chunk',
              chunkIndex: curIdx,
              text: audioChunk.text,
              expressions: audioChunk.expressions,
              mimeType: audioChunk.mimeType || 'audio/wav'
          };
          this.sendBinaryToVRM(metadata, audioChunk.buffer);
      }

      this.currentReadAudio = new Audio(audioChunk.url);
      this.currentReadAudio.volume = this.vrmOnline ? 0.0000001 : 1; // Mute when VRM is online

      // --- Change 6: drop audioDataUrl, send only the status command ---
      this.sendTTSStatusToVRM('startSpeaking', {
        chunkIndex: curIdx,
        totalChunks: total,
        text: audioChunk.text,
        expressions: audioChunk.expressions,
        voice: this.readState.chunks_voice[curIdx]
      });

      await new Promise(resolve => {
        this.currentReadAudio.onended = () => {
          this.sendTTSStatusToVRM('chunkEnded', { chunkIndex: curIdx });
          resolve();
        };
        this.currentReadAudio.onerror = resolve;
        this.currentReadAudio.play().catch(console.error);
      });
    } catch (e) {
      console.error('Read playback error', e);
    } finally {
      this.readState.currentChunk++;
      this.readState.isPlaying = false;
      setTimeout(() => this.checkReadAudioPlayback(), 0);
    }
  },
    async parseSelectedFile() {
        this.readConfig.longText = '';
        this.readConfig.longTextList = [];
        this.longTextListIndex = 0;
        // Look up the file info in textFiles by the selected file's unique_filename
        const selectedFile = this.textFiles.find(file => file.unique_filename === this.selectedFile);
        try {
          if (selectedFile) {
            // Build the full request URL
            const url = `/get_file_content?file_url=${selectedFile.unique_filename}`;
            
            // Send a request to get the file content
            const response = await fetch(url, {
              method: 'GET',
              headers: { 'Content-Type': 'application/json' }
            });
            const data = await response.json();
            if (selectedFile.unique_filename.toLowerCase().endsWith('.epub')){
              // Convert data.content to a dict
              let data_json = JSON.parse(data.content);
              this.readConfig.longTextList = data_json.chapters || [];
              if (this.readConfig.longTextList.length > 0){
                this.longTextListIndex = 0;
                this.readConfig.longText = this.readConfig.longTextList[0];
              }else{
                this.readConfig.longText = data.content;
              }
            }else{
              this.readConfig.longText = data.content;
            }
            // If this.readConfig.longText is too long, take only the first 100000 characters
            // if (this.readConfig.longText.length > 100000) {
            //   this.readConfig.longText = this.readConfig.longText.substring(0, 100000);
            //   showNotification(this.t('contentTooLong'))
            // }
          }
        }
        catch (error) {
          console.error('Error:', error);
        }
    },
  NextPage() {
    if (this.longTextListIndex < this.readConfig.longTextList.length - 1) {
      this.longTextListIndex++;
      this.readConfig.longText = this.readConfig.longTextList[this.longTextListIndex];
    }
  },
  PrevPage() {
    if (this.longTextListIndex > 0) {
      this.longTextListIndex--;
      this.readConfig.longText = this.readConfig.longTextList[this.longTextListIndex];
    }
  },
  openAddTTSDialog() {
    this.newTTSConfig = {
      name: '',
      enabled: true,
      SampleText: 'super agent party가 모든 것을 연결합니다!',
      engine: 'edgetts',
      edgettsLanguage: 'zh-CN',
      edgettsGender: 'Female',
      edgettsVoice: 'XiaoyiNeural',
      edgettsRate: 1.0,
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
    };
    this.showAddTTSDialog = true;
  },

  saveNewTTSConfig() {
    const name = this.newTTSConfig.name;
    if (!name) return;

    this.ttsSettings.newtts[name] = { ...this.newTTSConfig };
    this.showAddTTSDialog = false;
    this.autoSaveSettings();
  },

  deleteTTS(name) {
    delete this.ttsSettings.newtts[name];
  },

  editTTS(name) {
    this.newTTSConfig = { ...this.ttsSettings.newtts[name] };
    this.showAddTTSDialog = true;
  },

  openAddAppearanceDialog() {
    this.newAppearanceConfig = {
      name: '',
      windowWidth: 540,
      windowHeight: 960,
      selectedModelId: 'chick', // 기본 펫: 병아리 (앨리스·밥 제거됨)
      selectedMotionIds: [],
    };
    this.showAddAppearanceDialog = true;
  },
  editAppearance(name) {
    this.newAppearanceConfig = { ...this.VRMConfig.newVRM[name] };
    this.showAddAppearanceDialog = true;
  },
  deleteAppearance(name) {
    delete this.VRMConfig.newVRM[name];
  },
  saveNewAppearanceConfig() {
    const name = this.newAppearanceConfig.name;
    if (!name) return;

    this.VRMConfig.newVRM[name] = { ...this.newAppearanceConfig };
    this.showAddAppearanceDialog = false;
    this.autoSaveSettings();
  },
  addBehavior() {
    // Deep-copy the default template
    this.behaviorSettings.behaviorList.push(JSON.parse(JSON.stringify(this.newBehavior)));
    this.autoSaveSettings();
  },
  removeBehavior(idx) {
    this.behaviorSettings.behaviorList[idx].enabled = false;
    this.behaviorSettings.behaviorList.splice(idx, 1);
    showNotification(this.t('deleteBehaviorSuccess'))
    this.autoSaveSettings();
  },
  resetBehavior(idx) {
    this.behaviorSettings.behaviorList[idx] = JSON.parse(JSON.stringify(this.newBehavior));
    this.autoSaveSettings();
  },
  removeAllBehavior() {
    this.behaviorSettings.behaviorList.forEach((b) => {
      b.enabled = false;
    });
    this.behaviorSettings.behaviorList = [];
    showNotification(this.t('deleteAllBehaviorSuccess'))
    this.autoSaveSettings();
  },
    /* Actually perform the behavior */
    runBehavior(b) {
      if (!b.enabled) return
      if (!this.noInputFlag){
        this.stopGenerate()
      }
      if (b.action.type === 'prompt' && b.action.prompt) {
        console.log('Prompt:', b.action.prompt)
        this.userInput= '[system]:'+ b.action.prompt
        // Just send the prompt to your model here, for example:
        this.sendMessage();
      }
      if (b.action.type === 'random' && b.action.random) {
        if(b.action.random.events.length > 0){
          if (b.action.random.type === 'random'){
            let randomEvent = b.action.random.events[Math.floor(Math.random() * b.action.random.events.length)];
            if(randomEvent){
              this.userInput= '[system]:'+randomEvent;
              // Just send the prompt to your model here, for example:
              this.sendMessage();
            }
          }else if( b.action.random.type === 'order'){
            if(b.action.random.orderIndex >= b.action.random.events.length){
              b.action.random.orderIndex = 0;
            }
            if(b.action.random.events[b.action.random.orderIndex]){
              let randomEvent = b.action.random.events[b.action.random.orderIndex];
              b.action.random.orderIndex += 1;
              if(randomEvent){
                this.userInput= '[system]:'+randomEvent;
                // Just send the prompt to your model here, for example:
                this.sendMessage();
              }
            }
          }
        }
      }
    },

    /* After firing once, if it's 'no repeat', turn enabled off */
    disableOnceBehavior(b) {
      if (b.trigger.type === 'time' && !b.trigger.time.days.length && b.platform === 'chat') {
        b.enabled = false
        this.autoSaveSettings()
      }
    },
    handleAllBriefly(){
      this.allBriefly = !this.allBriefly;
      if(this.allBriefly){
        this.messages.forEach((m) => {
          m.briefly = true;
        })
      }else{
        this.messages.forEach((m) => {
          m.briefly = false;
        })
      }
    },
    async handleDownload(file) {
      // Build the file URL (make sure it's a full URL)
      const fileUrl = `${this.partyURL}/uploaded_files/${file.unique_filename}`;
      console.log(fileUrl);
      if (isElectron) {
        try {
          await window.electronAPI.downloadFile({
            url: fileUrl,
            filename: file.original_filename || file.unique_filename
          });
        } catch (e) {
          console.error(e);
        }
      } else {
        // Keep the original logic in non-Electron environments
        const link = document.createElement('a');
        link.href = fileUrl;
        link.download = file.unique_filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    },
  removeEvent(idx,index) {
    this.behaviorSettings.behaviorList[idx].action.random.events.splice(index, 1);
    this.autoSaveSettings(); // Also trigger auto-save after deletion
  },
  addNewEvent(idx) {
    this.behaviorSettings.behaviorList[idx].action.random.events.push(''); // Add a new empty event, thereby adding a new input box
    this.autoSaveSettings();
  },

  // Initialize the cyclic timers
initCycleTimer(behavior, index) {
  if (this.cycleTimers[index]) {
    clearInterval(this.cycleTimers[index]);
  }
  const [hours, minutes, seconds] = behavior.trigger.cycle.cycleValue.split(':').map(Number);
  const cycleMs = (hours * 3600 + minutes * 60 + seconds) * 1000;
  let currentCount = 0;
  
  this.cycleTimers[index] = setInterval(() => {
    // Re-confirm the enabled state and platform before running
    if (!behavior || !behavior.enabled || !this.isTargetPlatform(behavior, 'chat')) return;
    
    if (behavior.trigger.cycle.isInfiniteLoop || currentCount < behavior.trigger.cycle.repeatNumber) {
      this.runBehavior(behavior);
      currentCount++;
      if (!behavior.trigger.cycle.isInfiniteLoop && currentCount >= behavior.trigger.cycle.repeatNumber) {
        clearInterval(this.cycleTimers[index]);
        this.cycleTimers[index] = null;
        behavior.enabled = false;
      }
    }
  }, cycleMs);
},

// --- Modify the reset logic ---
resetCycleTimers() {
  // Guard: if settings aren't loaded yet, or the list doesn't exist, just skip
  if (!this.behaviorSettings || !Array.isArray(this.behaviorSettings.behaviorList)) {
    return;
  }

  // Ensure cycleTimers is an array
  if (!Array.isArray(this.cycleTimers)) {
    this.cycleTimers = [];
  }

  // Clear the old timers
  this.cycleTimers.forEach((timer, index) => {
    if (timer) clearInterval(timer);
    this.cycleTimers[index] = null;
  });

  // Re-initialize
  this.behaviorSettings.behaviorList.forEach((b, index) => {
    // Add a b && b.trigger check
    if (b && b.enabled && b.trigger && b.trigger.type === 'cycle' && this.isTargetPlatform(b, 'chat')) {
      this.initCycleTimer(b, index);
    }
  });
},


isTargetPlatform(behavior, platformKey) {
  // 1. If the behavior itself doesn't exist
  if (!behavior) return false;

  // 2. Check the new field platforms (array)
  // Must check Array.isArray and length > 0 before reading [0]
  if (behavior.platforms && Array.isArray(behavior.platforms) && behavior.platforms.length > 0) {
    if (behavior.platforms.includes('all')) return true;
    return behavior.platforms.includes(platformKey);
  }

  // 3. Backward compatibility: check the old field platform (string)
  if (behavior.platform && typeof behavior.platform === 'string') {
    return behavior.platform === 'all' || behavior.platform === platformKey;
  }

  // 4. Fallback logic
  return platformKey === 'chat';
},

    startDriverGuide() {
      const KEY = 'driver_guide_shown';
      if (localStorage.getItem(KEY)) return;
      localStorage.setItem(KEY, '1');

      const driver = window.driver.js.driver;

      const d = driver({
        allowClose: true,
        disableActiveInteraction: false,
        showProgress: true,
        nextBtnText: this.t('next'),
        prevBtnText: this.t('prev'),
        doneBtnText: this.t('done'),
        steps: [
          {
            element: '#driver-guide-btn',
            popover: {
              title: this.t('guide.driver-guide-btn'),
              description: this.t('guide.driver-guide-btn-notice'),
              side: 'right',
              align: 'start',
            },
          },
          {
            element: '#model-config',
            popover: {
              title: this.t('guide.model-config'),
              description: this.t('guide.model-config-notice'),
              side: 'right',
              // Use onNextClick instead of onNext
              onNextClick: async () => {
                await this.handleSelect('model-config');
                // Manually trigger the next-step navigation
                d.moveNext();
              }
            },
          },
          {
            element: '#add-provider-card',
            popover: {
              title: this.t('guide.add-provider-card'),
              description: this.t('guide.add-provider-card-notice'),
              side: 'right',
              // Use onNextClick instead of onNext
              onNextClick: () => {
                this.showAddDialog = true;
                setTimeout(() => d.moveNext(), 100); // Manually trigger the next-step navigation
              }
            }
          },
          {
            element: '#show-Add-Dialog',
            popover: {
              title: this.t('guide.show-Add-Dialog'),
              description: this.t('guide.show-Add-Dialog-notice'),
              side: 'top',
              // Add the onNextClick handling logic
              onNextClick: async () => {
                // 1. Determine whether a provider is selected (assume an empty newProviderTemp.vendor means none)
                if (!this.newProviderTemp.vendor) {
                  // 2. Ensure the provider list has at least 3 entries to avoid errors
                  if (this.vendorOptions && this.vendorOptions.length >= 3) {
                    // Take the third provider's value (array indices start at 0, so it's 2)
                    const thirdVendorValue = this.vendorOptions[2].value;
                    
                    // Call your selection method, or assign directly
                    // this.newProviderTemp.vendor = thirdVendorValue; 
                    this.handleSelectVendor(thirdVendorValue);
                    
                    // 3. Wait for Vue to update the DOM (this matters because the next step highlights the 'confirm' button,
                    // and we need the button's disabled state to be removed first)
                    await this.$nextTick(); 
                  }
                }
                
                // 4. Manually trigger the next step
                d.moveNext();
              }
            }
          },
          {
            element: '#confirm-Add-Provider-Button',
            popover: {
              title: this.t('guide.confirm-Add-Provider-Button'),
              side: 'right',
              // Use onNextClick instead of onNext
              onNextClick: async () => {
                this.confirmAddProvider();
                // Manually trigger the next-step navigation
                d.moveNext();
              }
            }
          },
          {
            element: '#get-API-key',
            popover: {
              title: this.t('guide.get-API-key'),
              description: this.t('guide.get-API-key-notice'),
              side: 'right',
              onPrevClick: () => {
                this.showAddDialog = true;
                setTimeout(() => d.moveNext(), 100); // Manually trigger the next-step navigation
              },
            }
          },
          {
            element: '#input-api-Key',
            popover: {
              title: this.t('guide.input-api-Key'),
              description: this.t('guide.input-api-Key-notice'),
              side: 'right',
            }
          },
          {
            element: '#get-Models-List',
            popover: {
              title: this.t('guide.get-Models-List'),
              description: this.t('guide.get-Models-List-notice'),
              side: 'right',
            }
          },
          {
            element: '#model-Id',
            popover: {
              title: this.t('guide.model-Id'),
              description: this.t('guide.model-Id-notice'),
              side: 'right',
            }
          },
        ]
      });

      // Listen for clicks on the highlighted element
      const checkClick = (e) => {
        if (e.target.closest('#model-config')) {
          d.moveNext();
        }
        if (e.target.closest('#add-provider-card')) {
          d.moveNext();
        }
        if (e.target.closest('#confirm-Add-Provider-Button')) {
          d.moveNext();
        }
        if (e.target.closest('#get-API-key')) {
          d.moveNext();
        }
        if (e.target.closest('#get-Models-List')) {
          d.moveNext();
        }
        if (e.target.closest('#vendor-Option')) {
          setTimeout(() => d.moveNext(), 100); // Manually trigger the next-step navigation
        }
      };
      document.addEventListener('click', checkClick);

      // Clean up the listener
      d.onDestroyed = () => document.removeEventListener('click', checkClick);

      setTimeout(() => d.drive(), 300);
    },


  // Manually reopen the guide (can be bound to a button)
  restartDriverGuide() {
    localStorage.removeItem('driver_guide_shown');
    this.startDriverGuide();
  },
  showToolInfo(tool) {
    this.toolForShowInfo = tool;
    this.showToolInfoDialog = true;
  },
  toggleAssistantMode() {
    if (this.activeMenu != 'home' && this.activeMenu != 'dashboard'){
      this.activeMenu = 'home';
    }

    this.isPttMode = false;
    console.log('切换助手模式，当前状态:', this.isAssistantMode);

    if (this.isAssistantMode && !this.isMac) {
      // Exit assistant mode, maximize the window
      console.log('退出助手模式，最大化窗口');
      window.electronAPI.windowAction('maximize'); // Restore the default size
    } else {
      // Enter assistant mode, set to 300 x screen height
      console.log('进入助手模式，设置大小为:', 340, 800);
      window.electronAPI.toggleWindowSize(340, 800);
    }

    this.sidePanelOpen = false;
    this.isAssistantMode = !this.isAssistantMode;
    console.log('切换完成，新状态:', this.isAssistantMode);
  },
    fixedWindow() {
    // Invert to the new state
    const next = !this.isFixedWindow;
    // Tell the main process to set always-on-top
    window.electronAPI.setAlwaysOnTop(next);
    // Sync the local state
    this.isFixedWindow = next;
  },
  handleScreenshotCommand(command) {
    if (command === 'hide') {
      // Clicked 'screenshot with window hidden' -> pass true
      this.toggleScreenshot(true);
    } else if (command === 'no-hide') {
      // Clicked 'screenshot current window' -> pass false
      this.toggleScreenshot(false);
    }
  },

  // Change: keep the original screenshot logic; the hideMainWindow param decides whether to hide
  async toggleScreenshot(hideMainWindow = true) {
    try {
      // 1. Invoke the overlay
      const rect = await window.electronAPI.showScreenshotOverlay(hideMainWindow)
      
      if (!rect) return // User canceled

      // 2. Crop
      const buf = await window.electronAPI.cropDesktop({ rect })

      // 3. Create the Blob and File
      const blob = new Blob([buf], { type: 'image/png' })
      const file = new File([blob], `desktop_${Date.now()}.png`, { type: 'image/png' })

      // 4. Key fix: create a local URL for preview and push it into the images array
      const localUrl = URL.createObjectURL(blob)
      
      // Push into the images array (assuming allItems is a computed property that includes images)
      this.images.push({ 
        file, 
        name: file.name, 
        path: localUrl,  // Use a blob URL instead of an empty string
        type: 'image'    // Explicitly mark the type so allItems can handle it
      })

      // If allItems is a separate array, push to it in sync too
      // this.allItems.push({
      //   name: file.name,
      //   path: localUrl,
      //   type: 'image',
      //   file: file
      // })

    } catch (e) {
      console.error('截图失败:', e)
    } finally {
      // 5. Clean up and restore the window
      await window.electronAPI.cancelScreenshotOverlay();
      window.electronAPI.windowAction('show');
    }
  },
  async toggleCapsuleMode() {
    this.activeMenu = 'home';
    this.isPttMode = false;
    if (this.isCapsuleMode && !this.isMac) {
      window.electronAPI.windowAction('maximize') // Restore the default size
    } else{
      window.electronAPI.toggleWindowSize(210, 80);
    }
    this.sidePanelOpen = false;
    this.isCapsuleMode = !this.isCapsuleMode;
  },
  addPrompt() {
    this.promptForm = { id: null, name: '', content: '' };
    this.showPromptDialog = true;
  },
  editPrompt(row) {
    this.promptForm = { ...row };
    this.showPromptDialog = true;
  },
  savePrompt() {
    if (!this.promptForm.name || !this.promptForm.content) {
      showNotification(this.t('pleaseCompleteForm'), 'warning')
      return
    }
    if (!this.promptForm.id) {
      // New
      this.SystemPromptsList.push({
        id: Date.now(),
        name: this.promptForm.name,
        content: this.promptForm.content
      })
    } else {
      // Edit: find the index and replace directly
      const idx = this.SystemPromptsList.findIndex(p => p.id === this.promptForm.id)
      if (idx > -1) {
        // Just assign directly; no need for $set
        this.SystemPromptsList[idx] = { ...this.promptForm }
      }
    }
    this.showPromptDialog = false
    this.autoSaveSettings()
  },

  removePrompt(id) {
    const idx = this.SystemPromptsList.findIndex(p => p.id === id);
    if (idx > -1) this.SystemPromptsList.splice(idx, 1);
    this.autoSaveSettings();
  },
  /* Click the 'Use' button */
  usePrompt(content) {
    this.messages[0].content = content;
    this.activeMenu = 'home';      // Switch to the main view
    this.showEditDialog = false;
  },
  /* Main entry */
  async handleTranslate() {
    if (!this.sourceText.trim() || this.isTranslating) return;
    this.isTranslating = true;
    this.translatedText = this.t('translating') + '…';

    const controller = new AbortController();
    this.translateAbortController = controller;

    // Build the TTS prompt (consistent with translateMessage)
    let newttsList = [];
    if (this.ttsSettings?.newtts) {
      for (const key in this.ttsSettings.newtts) {
        if (this.ttsSettings.newtts[key].enabled) newttsList.push(key);
      }
    }
    const ttsPrompt = 'If the text to translate is already in the target language, just return it unchanged.'

    try {
      const res = await fetch('/simple_chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.mainAgent,
          messages: [
            {
              role: 'system',
              content: `You are a professional translator. Strictly translate any content the user provides into ${this.target_lang}, preserving the original formatting (Markdown, line breaks, etc.) and adding nothing extra. Return only the translation result.${ttsPrompt}`
            },
            {
              role: 'user',
              content: `Translate the following into ${this.target_lang}:\n\n${this.sourceText}`
            }
          ],
          stream: true,
          temperature: 0.1
        }),
        signal: controller.signal
      });

      if (!res.ok) throw new Error('Network error');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = ''; // Leftover partial line
      let result = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // The last line may be incomplete; leave it for the next round

        for (const line of lines) {
          if (!line) continue; // Skip empty lines
          try {
            const chunk = JSON.parse(line);
            const delta = chunk.choices?.[0]?.delta?.content ?? '';
            if (delta) {
              result += delta;
              this.translatedText = result; // Render in real time
            }
          } catch {
            // Ignore parse failures
          }
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        this.translatedText = `Translation error: ${e.message}`;
      }
    } finally {
      this.isTranslating = false;
      this.translateAbortController = null;
    }
  },

  abortTranslate () {
    this.translateAbortController?.abort()
    this.isTranslating = false
  },

  clearAll () {
    this.sourceText = ''
    this.translatedText = ''
  },
  changeLanguage() {
    this.target_lang = this.targetLangSelected!="system"? this.targetLangSelected: navigator.language || navigator.userLanguage || 'zh-CN';
    this.autoSaveSettings()
  },
  copyTranslated() {
    if (!this.translatedText) return
    navigator.clipboard.writeText(this.translatedText)
    showNotification(this.t('copy_success'))
  },
  handleShowAddMemoryDialog() {
    if (this.isGenerating){
      showNotification(this.t('AIgening'))
       return;
    }
    this.showAddMemoryDialog = true
  },
  async handleQuickGen() {
    if (!this.quickCreatePrompt.trim() || this.isGenerating) return;

    this.isGenerating = true;
    showNotification(this.t('startGen'));

    const controller = new AbortController();
    this.QuickGenAbortController = controller;

    const systemPrompt = `You are a professional character designer.  
  The generated character-card content must match the language the user inputs. For example, if the user inputs Korean, the content must be Korean; if English, it must be English; and so on!
  The user will provide a short concept. You must reply with only a single piece of **valid JSON**, placed inside a standard Markdown code block.  
  JSON values must be wrapped in double quotes; if content inside a value needs quotes, always change them to single quotes.
  mesExample contains 5-10 example turns, alternateGreetings contains 5-10 opening lines, and characterBook contains 10 or more keyword entries with content.
  The JSON structure must be:

    {
      "name": "Character name",
      "description": "Brief background / worldview, as detailed as possible",
      "personality": "Personality traits",
      "mesExample": "Show 5-10 chat example turns. Non-dialogue expressions are forbidden in the examples (no inner-thought or action descriptions, etc.—only the spoken parts). Format: User:xxx\nCharacter:xxx",
      "systemPrompt": "System prompt used to drive the character",
      "firstMes": "The character's first greeting; the greeting must not contain non-dialogue expressions (no inner-thought or action descriptions, etc.—only the spoken parts)",
      "alternateGreetings": ["Optional greeting 2","Optional greeting 3"],
      "characterBook": [
          {"keysRaw":"Keyword1\nKeyword2","content":"Content to return to the AI when the user mentions Keyword1 or Keyword2..."},
          {"keysRaw":"Keyword3","content":"Content to return to the AI when the user mentions Keyword3..."}
      ]
    }

  All fields are required; make characterBook as rich as possible—ideally 10+ entries, though each can be short. alternateGreetings should ideally have 5+ entries too.
  Never include an avatar field.`;

    try {
      const res = await fetch('/simple_chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: this.quickCreatePrompt }
          ],
          stream: true,   // Enable streaming
          temperature: 0.8
        }),
        signal: controller.signal
      });

      if (!res.ok) throw new Error('Network error');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';      // Leftover partial line
      let fullText = '';    // Accumulate the full reply

      // 1. Read the stream in real time
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // The last line may be incomplete

        for (const line of lines) {
          if (!line) continue;
          try {
            const chunk = JSON.parse(line);
            const delta = chunk.choices?.[0]?.delta?.content ?? '';
            if (delta) {
              fullText += delta;
              this.quickCreatePrompt = fullText; // Display in real time
            }
          } catch {
            // Ignore parse failures
          }
        }
      }

      // 2. After the stream ends, run the original parsing logic
      let raw = fullText.trim();

      // Strip the code-block
      const codeBlock = raw.match(/^```json\s*([\s\S]*?)```$/);
      if (codeBlock) raw = codeBlock[1];
      const tildeBlock = raw.match(/^```\s*([\s\S]*?)```$/);
      if (tildeBlock) raw = tildeBlock[1];

      // Parse the JSON
      let json;
      try {
        json = JSON.parse(raw);
      } catch (e) {
        throw new Error('AI가 올바른 JSON을 반환하지 않았습니다: ' + e.message);
      }

      // 3. Write into newMemory and save
      Object.assign(this.newMemory, {
        name: json.name ?? '',
        infer:false,
        providerId: null,
        model: '',
        base_url: '',
        api_key: '',
        vendor: '',
        description: json.description ?? '',
        personality: json.personality ?? '',
        mesExample: json.mesExample ?? '',
        systemPrompt: json.systemPrompt ?? '',
        firstMes: json.firstMes ?? '',
        alternateGreetings: json.alternateGreetings?.filter(Boolean) ?? [],
        characterBook: (json.characterBook ?? []).map(b => ({
          keysRaw: b.keysRaw ?? '',
          content: b.content ?? ''
        })),
        avatar: ''
      });
      this.newMemory.id = null;
      this.addMemory();
      showNotification(this.t('genSuccess'));

    } catch (e) {
      if (e.name === 'AbortError') {
        console.log('QuickGen aborted');
      } else {
        showNotification(this.t('genFailed') + ': ' + e.message, 'error');
      }
    } finally {
      this.isGenerating = false;
      this.QuickGenAbortController = null;
      this.quickCreatePrompt = '';
    }
  },
  stopQuickGen() {
    this.QuickGenAbortController?.abort()
    this.isGenerating = false
  },
  async handleSystemPromptQuickGen() {
    if (!this.quickCreateSystemPrompt.trim() || this.isSystemPromptGenerating) return;
    
    this.isSystemPromptGenerating = true;
    this.promptForm.name = this.quickCreateSystemPrompt;
    showNotification(this.t('startGen'));
    
    const controller = new AbortController();
    this.QuickGenSystemPromptAbortController = controller;
    
    try {
      const res = await fetch('/simple_chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.mainAgent,
          messages: [
            {
              role: 'system',
              content: `You must optimize the short system prompt the user sends into a detailed system prompt that drives the LLM to perform better.
  Note! The generated system prompt must match the language the user inputs. If the user speaks English, you must generate an English system prompt; if the user speaks Chinese, you must generate a Chinese one; and so on!
  You may write from (but are not limited to) these aspects: character name, character positioning, core abilities, answer style, constraints, and output-format examples.`,
            },
            {
              role: 'user',
              content: `${this.quickCreateSystemPrompt}`,
            },
          ],
          stream: true,
          temperature: 0.8
        }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error('Network error');
      
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let result = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        
        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          
          try {
            const data = JSON.parse(line);
            
            // Adapt to the new streaming-response format
            if (data.choices && data.choices[0]) {
              const choice = data.choices[0];
              
              // Handle the incremental content in the streaming response
              if (choice.delta && choice.delta.content) {
                result += choice.delta.content;
                this.quickCreateSystemPrompt = result;
              }
              // Or handle the final response where finish_reason is 'stop'
              else if (choice.finish_reason === 'stop') {
                // Finally complete; no extra handling needed
              }
            }
          } catch (e) {
            console.warn('Failed to parse SSE line:', line, e);
          }
        }
        
        buffer = lines[lines.length - 1];
      }
      
      // Handle any remaining buffered data
      if (buffer.trim()) {
        try {
          const data = JSON.parse(buffer);
          if (data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.content) {
            result += data.choices[0].delta.content;
            this.quickCreateSystemPrompt = result;
          }
        } catch (e) {
          console.warn('Failed to parse remaining buffer:', buffer, e);
        }
      }
      
      // Save the generated prompt
      this.promptForm.content = this.quickCreateSystemPrompt;
      this.promptForm.id = null;
      await this.savePrompt();
      
      showNotification(this.t('genSuccess'));
      this.quickCreateSystemPrompt = '';
      
    } catch (e) {
      if (e.name === 'AbortError') {
        // The user canceled generation; no need to show an error
        console.log('System prompt generation was aborted');
      } else {
        console.error('System prompt generation failed:', e);
        showNotification(this.t('genFailed') + ': ' + e.message, 'error');
      }
    } finally {
      this.isSystemPromptGenerating = false;
      this.QuickGenSystemPromptAbortController = null;
    }
  },
  stopSystemPromptQuickGen() {
    this.QuickGenSystemPromptAbortController?.abort()
    this.isSystemPromptGenerating = false
  },
  async toggleQuickGen(index) {
    let systemPrompt = this.messages[index].content;
    if (!systemPrompt.trim()) {
      showNotification(this.t('noSystemPromptToExtend'), 'error');
      return;
    }
    
    showNotification(this.t('startGen'));
    this.isQuickGenerating = true;
    const abortController = new AbortController();
    this.abortController = abortController;
    
    try {
      const res = await fetch('/simple_chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.mainAgent,
          messages: [
            {
              role: 'system',
              content: `You must optimize the short system prompt the user sends into a detailed system prompt that drives the LLM to perform better.
  Note! The generated system prompt must match the language the user inputs. If the user speaks English, you must generate an English system prompt; if the user speaks Chinese, you must generate a Chinese one; and so on!
  You may write from (but are not limited to) these aspects: character name, character positioning, core abilities, answer style, constraints, and output-format examples.`
            },
            {
              role: 'user',
              content: `${systemPrompt}`,
            },
          ],
          stream: true,
          temperature: 0.8
        }),
        signal: this.abortController.signal,
      });

      if (!res.ok) throw new Error('Network error');
      
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let result = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        
        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          
          try {
            const data = JSON.parse(line);
            
            // Adapt to the new streaming-response format
            if (data.choices && data.choices[0]) {
              const choice = data.choices[0];
              
              // Handle the incremental content in the streaming response
              if (choice.delta && choice.delta.content) {
                result += choice.delta.content;
                this.messages[index].content = result;
                this.requestScrollToBottom();
              }
              // Or handle the final response where finish_reason is 'stop'
              else if (choice.finish_reason === 'stop') {
                // Finally complete; no extra handling needed
              }
            }
          } catch (e) {
            console.warn('Failed to parse SSE line:', line, e);
          }
        }
        
        buffer = lines[lines.length - 1];
      }
      
      // Handle any remaining buffered data
      if (buffer.trim()) {
        try {
          const data = JSON.parse(buffer);
          if (data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.content) {
            result += data.choices[0].delta.content;
            this.messages[index].content = result;
            this.requestScrollToBottom();
          }
        } catch (e) {
          console.warn('Failed to parse remaining buffer:', buffer, e);
        }
      }
      
      showNotification(this.t('genSuccess'));
      
    } catch (e) {
      if (e.name === 'AbortError') {
        // The user canceled generation; no need to show an error
        console.log('Quick generation was aborted');
      } else {
        console.error('Quick generation failed:', e);
        showNotification(this.t('genFailed') + ': ' + e.message, 'error');
      }
    } finally {
      this.isQuickGenerating = false;
      this.abortController = null;
    }
  },
  saveSystemPrompt(index) {
    let systemPrompt = this.messages[index].content;
    this.activeMenu = 'role';
    this.subMenu = 'memory';
    this.activeMemoryTab = 'prompts';
    this.promptForm = { id: null, name: '', content: systemPrompt };
    this.showPromptDialog = true;
  },
  async browseDirectory() {
    if (!this.isElectron) {
      // Browser environment
      return;
    } else {
      // Electron environment
      try {
        const result = await window.electronAPI.openDirectoryDialog();
        if (!result.canceled && result.filePaths.length > 0) {
          this.CLISettings.cc_path = result.filePaths[0];
          this.autoSaveSettings();
        }
      } catch (error) {
        console.error('选择目录出错:', error);
        showNotification(this.t('notifySelectDirFailed'), 'error');
      }
    }
  },
  
  _toggleHighlight(e) {
    const blk = e.target.closest('.highlight-block');
    if (!blk) return;
    blk.classList.toggle('expanded');
  },
  changeSystemPrompt() {
    this.editContent = this.SystemPromptsList.find(prompt => prompt.id === this.selectSystemPromptId)?.content;
  },
/* -------------------------------------------------- */
/* 1. Auto-segment (reuses the full-text algorithm)                       */
/* -------------------------------------------------- */
reSegment() {
  this.stopSegmentTTS();          // Stop the old audio
    const {
      chunks,
      chunks_voice,
      remaining,
      remaining_voice
    } = this.splitTTSBuffer(this.readConfig.longText);

    if (remaining) {
      chunks.push(remaining);
      chunks_voice.push(remaining_voice);
    }

      /* ================= New: strip tags + whitespace and delete in sync ================= */
      // 1. Strip HTML tags
      const cleanedChunks = chunks.map(txt => txt.replace(/<\/?[^>]+>/g, '').trim());

      // 2. Filter out whitespace and delete the corresponding chunks_voice entries in sync
      const finalChunks       = [];
      const finalChunksVoice  = [];

      cleanedChunks.forEach((txt, idx) => {
        if (txt) {                      // Keep only non-empty ones
          finalChunks.push(txt);
          finalChunksVoice.push(chunks_voice[idx]);
        }
      });

      // 3. Overwrite the original array
      chunks.length       = 0;
      chunks_voice.length = 0;
      chunks.push(...finalChunks);
      chunks_voice.push(...finalChunksVoice);
      /* ================================================================ */

  this.readState.ttsChunks = chunks;
  this.readState.chunks_voice = chunks_voice;
  this.readState.audioChunks  = new Array(this.readState.ttsChunks.length);
  this.readState.currentChunk = -1;
},

/* -------------------------------------------------- */
/* 2. Play a single sentence (with VRM sync)                        */
/* -------------------------------------------------- */
async playSingleSegment(idx) {
  try{
    if (!this.readState.ttsChunks[idx]) return;
    this.isReadingOnetext = true;
    this.readState.currentChunk = idx;
    const chunk = this.readState.ttsChunks[idx];
    const voice = this.readState.chunks_voice[idx];
    const cachedAudio = this.readState.audioChunks[idx];

    // Key fix: treat standalone playback as a brand-new session too
    this.sendTTSStatusToVRM('stopSpeaking', {});
    this.readState.vrmIndex = 0; // No matter which line is clicked, VRM always receives 0 
    this.sendTTSStatusToVRM('ttsStarted', { totalChunks: 1 });

    if (cachedAudio?.url && cachedAudio?.buffer && cachedAudio?.text === chunk && cachedAudio?.voice === voice) {
      this.doPlayAudio(this.readState.audioChunks[idx].url, idx, false);
      return;
    }
    
    // Synthesize first on a cache miss
    await this.synthSegment(idx);
    this.doPlayAudio(this.readState.audioChunks[idx].url, idx, false);
  } finally {
    this.isReadingOnetext = false;
  }
},

/* -------------------------------------------------- */
/* 3. Continuous-playback toggle                                   */
/* -------------------------------------------------- */
async toggleContinuousPlay() {
  if (this.readState.isPlaying) {          
    this.stopSegmentTTS(false);
    return;
  }
  this.readState.isPlaying = true;
  if (this.readState.currentChunk < 0 || this.readState.currentChunk >= this.readState.ttsChunks.length) { 
    this.readState.currentChunk = 0;         
  }

  // Key fix: forcibly abort the previous state (whether finished or not) and reset VRM's expected index
  this.sendTTSStatusToVRM('stopSpeaking', {});
  this.readState.vrmIndex = 0; // Reset the virtual index
  this.sendTTSStatusToVRM('ttsStarted', {
    totalChunks: this.readState.ttsChunks.length - this.readState.currentChunk
  });

  await this.playNextInQueue(true);
},

/* -------------------------------------------------- */
/* 4. New: play only the next sentence (stop when done)                  */
/* -------------------------------------------------- */
async playNextSegmentOnce() {
  let next = this.readState.currentChunk + 1;
  this.readState.currentChunk = next;
  if (next >= this.readState.ttsChunks.length) {
    next = 0;
    this.readState.currentChunk = next;
  }
  this.readState.isPlaying = false;      // Ensure no auto-continue
  await this.playSingleSegment(next);    // Stop when done
},

/* -------------------------------------------------- */
/* 5. Stop all segmented audio                               */
/* -------------------------------------------------- */
stopSegmentTTS(isEnd = true) {
  this.stopTTSActivities();
  if (isEnd){
    this.readState.currentChunk = -1;
  }
  if (this._curAudio) {
    this._curAudio.pause();
    this._curAudio = null;
  }
  this.readState.isPlaying   = false;
},
/* -------------------------------------------------- */
/* 6. Edit the segment text                                      */
/* -------------------------------------------------- */
toggleEditSegment(idx) {
  if (this.activeSegmentIdx === idx) {
    // Save: write the temp value back into the official field
    this.readState.ttsChunks[idx] = this.segmentEditBuffer
    this.readState.chunks_voice[idx] = this.segmentVoiceEditBuffer[idx] ?? this.readState.chunks_voice[idx]
    this.activeSegmentIdx = -1
  } else {
    // Enter editing: first put an initial value into the corresponding slot of the 'temp voice array'
    this.segmentEditBuffer = this.readState.ttsChunks[idx]
    // Vue3 allows direct assignment
    this.segmentVoiceEditBuffer[idx] = this.readState.chunks_voice[idx]
    this.activeSegmentIdx = idx
  }
},

/* 1. Convert to base64 while synthesizing */
async synthSegment(idx) {
  try {
    const text  = this.readState.ttsChunks[idx];
    const voice = this.readState.chunks_voice[idx] || 'default';
    /* —— Text cleaning —— */
    let chunk_text = text;
    let chunk_expressions =[];
    if (text.indexOf('<') !== -1) {
      const tagReg = /<[^>]+>/g;
      chunk_expressions = (text.match(tagReg) || []).map(t => t.slice(1, -1));
      chunk_text = text.replace(tagReg, '').trim(); 
    }
    const res = await fetch('/tts', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ ttsSettings: this.ttsSettings, text, index: idx, voice }),
    });
    if (!res.ok) throw new Error('TTS failed');

    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);

    /* Key change: get the binary ArrayBuffer directly, no Base64 conversion */
    const audioBuffer = await blob.arrayBuffer();

    /* Cache the data */
    this.readState.audioChunks[idx] = {
      url,                       // For local playback
      expressions: chunk_expressions,
      buffer: audioBuffer,       // For VRM binary playback
      mimeType: blob.type,       // Record the real format
      text: chunk_text,
      idx,
      voice
    };
  } catch (e) {
    console.error(`TTS chunk ${idx} error`, e);
    this.readState.audioChunks[idx] = { 
      url: null, 
      buffer: null,
      expressions: [],
      text: "",
      idx 
    };
  }
},
scrollToCurrentChunk(idx) {
  // Use nextTick to ensure the DOM update is complete
  this.$nextTick(() => {
    const segmentList = document.querySelector('.segment-list');
    const segmentItem = document.querySelector(`.segment-item:nth-child(${idx + 1})`);
    if (segmentList && segmentItem) {
      segmentItem.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }
  });
},

async doPlayAudio(url, idx, continuous = false) {
  // 1. Safely clean up the previous audio segment
  if (this._curAudio) {
    // Only notify VRM to stop when the audio was forcibly interrupted (not finished/not paused). Don't send on natural completion!
    const isActuallyPlaying = !this._curAudio.paused && !this._curAudio.ended;
    this._curAudio.pause();
    if (isActuallyPlaying) {
      this.sendTTSStatusToVRM('stopSpeaking', {});
    }
    this._curAudio = null;
  }

  try {
    const audio = new Audio(url);
    this._curAudio = audio;

    // Scroll to the current line
    this.scrollToCurrentChunk(idx);

    const chunk = this.readState.audioChunks[idx];

    // 2. Prevent the binary from being consumed by the lower layer, which would make a second click silent
    if (!chunk.buffer || chunk.buffer.byteLength === 0) {
        if (chunk.url) {
            try {
                const res = await fetch(chunk.url);
                chunk.buffer = await res.arrayBuffer();
                if (!chunk.mimeType) chunk.mimeType = res.headers.get('content-type') || 'audio/wav';
            } catch(e) {
                console.warn("Failed to restore buffer", e);
            }
        }
    }

    // 3. Key fix: get a dedicated VRM virtual index
    if (this.readState.vrmIndex === undefined) {
        this.readState.vrmIndex = 0;
    }
    const currentVrmIndex = this.readState.vrmIndex;

    // 4. Send the raw binary data to VRM (using the virtual index)
    if ((this.vrmOnline || this.vtsOnline) && chunk.buffer && chunk.buffer.byteLength > 0) {
        const metadata = {
            type: 'audio_chunk',
            chunkIndex: currentVrmIndex, // <--- use the virtual index
            text: chunk.text,
            expressions: chunk.expressions,
            mimeType: chunk.mimeType || 'audio/wav'
        };
        this.sendBinaryToVRM(metadata, chunk.buffer.slice(0));
    }

    this._curAudio.volume = this.vrmOnline ? 0.0000001 : 1; // Mute when VRM is online

    // 5. Send only the status command (using the virtual index)
    this.sendTTSStatusToVRM('startSpeaking', {
      chunkIndex: currentVrmIndex, // <--- use the virtual index
      totalChunks: this.readState.ttsChunks.length,
      text: chunk.text,
      expressions: chunk.expressions || [],
      voice: this.readState.chunks_voice[idx] || 'default',
    });

    // 6. Increment the index, preparing a perfect 0,1,2 order for the next sentence in continuous playback
    this.readState.vrmIndex++;

    // Listen for error events
    audio.addEventListener('error', (e) => {
      console.error('Audio load error', e);
      this.readState.currentChunk++;
      if (this.readState.currentChunk < this.readState.ttsChunks.length && continuous) {
        this.playNextInQueue(true);
      } else {
        this.stopSegmentTTS(false);
      }
    });

    await new Promise(resolve => {
      this._curAudio.addEventListener('ended', () => {
        // Notify completion using the same virtual index
        this.sendTTSStatusToVRM('chunkEnded', { chunkIndex: currentVrmIndex });
        
        if (continuous && this.readState.isPlaying) {
          this.readState.currentChunk++;
          if (this.readState.currentChunk < this.readState.ttsChunks.length) {
            this.playNextInQueue(true);
          } else {
            this.stopSegmentTTS(false);
          }
        } else {
          this.stopSegmentTTS(false);
        }
        resolve();
      });
      
      console.log('play audio', `${idx + 1}`);
      audio.play().catch(e => {
        console.error('Audio play error', e);
        this.readState.currentChunk++;
        if (this.readState.currentChunk < this.readState.ttsChunks.length && continuous) {
          this.playNextInQueue(true);
        } else {
          this.stopSegmentTTS(false);
        }
        resolve(); 
      });
    });
  } catch (e) {
    console.error('Read playback error', e);
    this.readState.currentChunk++;
    if (this.readState.currentChunk < this.readState.ttsChunks.length && continuous) {
      this.playNextInQueue(true);
    } else {
      this.stopSegmentTTS(false);
    }
  } finally {
      this.isReadingOnetext = false;
  }
},

// Continuous-playback only: auto-synthesize & play the next frame
async playNextInQueue(continuous) {
  const idx = this.readState.currentChunk;   // The index currently to be played
  const chunk = this.readState.ttsChunks[idx];
  const voice = this.readState.chunks_voice[idx];
  const cachedAudio = this.readState.audioChunks[idx];

  // --- Core fix: switch base64 to buffer ---
  if (cachedAudio?.url && cachedAudio?.buffer && cachedAudio?.text === chunk && cachedAudio?.voice === voice) {
    // Nothing happens on a cache hit
  } else {
    await this.synthSegment(idx);
  }
  this.doPlayAudio(this.readState.audioChunks[idx].url, idx, continuous);
},

// Clear the segments
clearSegments() {
  this.stopSegmentTTS();
  this.readState.ttsChunks   = [];
  this.readState.chunks_voice = [];
  this.readState.audioChunks  = [];
  this.readState.currentChunk = -1;
},
  // Scan extensions without auto-loading
  async scanExtensions() {
    try {
      // Use the API to get the extension list
      const response = await fetch('/api/extensions/list');
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || '확장 목록 가져오기 실패');
      }
      
      const data = await response.json();
      this.extensions = data.extensions || [];
      
      // No longer auto-load the first extension
      // Show the sidePanelText content by default
      this.currentExtension = null;
      this.sidePanelURL = '';
    } catch (error) {
      console.error('扫描扩展出错:', error);
    }
  },
  
    // Load the specified extension
  async loadExtension(extension) {
    if (!extension) {
      this.currentExtension = null;
      this.sidePanelURL = '';
      return;
    }
    
    /* 1. Try Node mode */
    try {
      const r = await fetch(`/api/extensions/${extension.id}/start-node`, { method: 'POST' });
      const res = await r.json();

      if (res.mode === 'node') {
        // Node succeeded
        this.currentExtension = extension;
        this.sidePanelURL = `/api/extensions/${extension.id}/node/`;
        showNotification(`${this.t('loadExtension(node)')}: ${extension.name}`, 'success');
        return;
      } else if (res.mode === 'error') {
        // Node service failed to start! Must intercept and show the error, can't continue
        showNotification(`${this.t('notifyPluginStartFailedColon')}${res.message}`, 'error');
        console.error("【Node Extension 报错】:", res.message);
        return; 
      }
      
      // Only when res.mode === 'static' may we break out of the if and fall back to the static route below
    } catch (e) {
      // Network failure or parse exception should also be intercepted
      showNotification(`${this.t('notifyPluginRequestError')}${e.message}`, 'error');
      console.error(e);
      return; 
    }

    /* 2. Fall back to the static route */
    this.currentExtension = extension;
    this.sidePanelURL = `/ext/${extension.id}/index.html`;
    showNotification(`${this.t('loadExtension(static)')}: ${extension.name}`, 'success');
    this.extensionsSystemPromptsDict[extension.id] = extension.systemPrompt || ""; // Update the prompt
  },
  
// Switch to the default view (home bookmarks)
  resetToDefaultView() {
    // 1. Set focus to null, using v-show to hide all iframes and show the home content
    this.currentExtension = null;
    this.sidePanelURL = ''; // Clear the old global URL state to prevent pollution
    this.activeSideView = 'list'; // Ensure the sidebar's internal route switches back to 'list'

    // 2. Close any popups that might be open
    this.showExtensionsDialog = false;

    // 3. Core change: remove the two lines below!
    // this.expandChatArea();     // don't force-expand the chat area
    // this.collapseSidePanel();  // don't force-collapse the sidebar; the user just switched back to the main tab, the sidebar should stay open!

    // 4. Reset the current conversation's extra prompt (switching back to the default conversation, clearing the extension's system prompt is reasonable)
    this.extensionsSystemPromptsDict = {}; 

    // 5. If leaving the task center, clear the task-refresh timer to save performance (unchanged)
    if (this.taskRefreshTimer) {
      clearInterval(this.taskRefreshTimer);
      this.taskRefreshTimer = null; // Nulling it out while we're at it is good practice
    }

    console.log('已切换到侧边栏主视图 (Home Tab)');
  },
  // Open the extension-selection dialog
  openExtensionsDialog() {
    this.showExtensionsDialog = true;
  },
  
// Switch to (or open) an extension tab
  async switchExtension(extension) {
    // 1. Close the extension popup, expand the sidebar
    this.showExtensionsDialog = false; 
    const sidePanel = this.$refs.sidePanelRef;
    if (sidePanel.style.width == 0 ){
        this.expandSidePanel();
    }

    // 2. Check whether this extension is already in the multi-open array
    const existingExt = this.openedExtensions.find(e => e.id === extension.id);

    if (existingExt) {
      // [Already opened]: just switch focus, don't reload, preserve the page state!
      this.currentExtension = existingExt;
      this.activeSideView = 'iframe'; // Ensure the view mode is iframe
      
      // If your underlying code still relies on the global sidePanelURL, sync it here
      if (existingExt.iframeUrl) {
        this.sidePanelURL = existingExt.iframeUrl;
      }
      
    } else {
      // [First open]: needs to go through the load logic
      // To make the loading animation appear immediately, point the current extension at it first
      this.currentExtension = extension;
      this.activeSideView = 'iframe';
      this.sidePanelURL = ''; // Clear the global URL to avoid flashing the old screen
      
      // Add it to the top tab-bar array
      this.openedExtensions.push(extension);

      // Run your original logic to fetch the URL/token
      await this.loadExtension(extension);

      // A crucial step: after loadExtension runs, it usually assigns this.sidePanelURL.
      // We need to save this generated dedicated URL onto the current extension object so it isn't lost when switching back!
      const targetExt = this.openedExtensions.find(e => e.id === extension.id);
      if (targetExt) {
        // Permanently bind the globally generated URL to this tab
        targetExt.iframeUrl = this.sidePanelURL; 
      }
    }
  },

  // New companion: close an extension tab
  closeExtensionTab(extId) {
    // 1. Remove it from the opened array
    const index = this.openedExtensions.findIndex(e => e.id === extId);
    if (index === -1) return;
    
    this.openedExtensions.splice(index, 1);

    // 2. If the closed tab is the one currently being viewed, handle focus fallback
    if (this.currentExtension && this.currentExtension.id === extId) {
      if (this.openedExtensions.length > 0) {
        // If other tabs remain, jump to the last one
        const lastExt = this.openedExtensions[this.openedExtensions.length - 1];
        this.switchExtension(lastExt);
      } else {
        // If all are closed, return to the default list home
        this.resetToDefaultView();
      }
    }
  },

  // Utility: return the address the extension can actually reach (Node > static)
  async getExtensionURL(ext) {
    console.log('获取扩展URL', ext);
    // 1. Try starting Node first
    try {
      const r = await fetch(`/api/extensions/${ext.id}/start-node`, { method: 'POST' });
      const res = await r.json();
      if (res.mode === 'node') {
        return `/api/extensions/${ext.id}/node/`;   // Node proxy path
      }
      console.log('启动 Node 失败，回退静态',res);
    } catch { 
     }
    // 2. Fall back to static
    return `/ext/${ext.id}/index.html`;
  }, 

    async openExtension(extension) {
      const url = await this.getExtensionURL(extension);   // <- get the address asynchronously
      console.log('打开扩展', `${this.partyURL}${url}`);
      if (isElectron) {
        window.electronAPI.openExternal(`${this.partyURL}${url}`);
      } else {
        window.open(url, '_blank');
      }
    },
    // Delete the extension
    async removeExtension(ext) {
      // If it's Node mode, stop the process; ignore errors
      await fetch(`/api/extensions/${ext.id}/stop-node`, { method: 'POST' }).catch(() => {});
      try {
        const res = await fetch(`/api/extensions/${ext.id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('삭제 실패');
        showNotification(this.t('deleteSuccess'), 'success');
        this.scanExtensions(); // Refresh the list
      } catch (e) {

         showNotification(e.message, 'error');
      }
    },

    // Open the 'Add extension' dialog
    openAddExtensionDialog() {
      this.newExtensionUrl = '';
      this.showExtensionForm = true;
      this.fetchRemotePlugins();
    },

    async pollInstallStatus(extId, onSuccess, onError) {
      const poll = async () => {
        try {
          const res = await fetch(`/api/extensions/task-status/${extId}`);
          const data = await res.json();

          if (data.status === 'success') {
            // Installation succeeded
            onSuccess(data.detail);
          } else if (data.status === 'error') {
            // Installation failed
            onError(data.detail);
          } else if (data.status === 'installing') {
             // Still installing; keep polling (you could also update the UI hint here if you have one)
             // e.g.: console.log(data.detail); 
             setTimeout(poll, 1000); // Check again after 1 second
          } else {
             // Unknown status; maybe it restarted or the ID is wrong
             onError("작업 상태 손실");
          }
        } catch (e) {
          onError("네트워크 요청 오류");
        }
      };
      // Start the first poll
      poll();
    },

    // The actual 'Install' button trigger
    async addExtension() {
      const url = this.newExtensionUrl.trim();
      if (!url) return showNotification(this.t('notifyEnterGithubUrl'), 'error');
      
      this.installLoading = true; // Show the loading overlay
      
      try {
        const res = await fetch('/api/extensions/install-from-github', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            url,
            backupUrl: ""  
          }),
        });
        
        if (res.status === 409) throw new Error(this.t('extensionExists'));
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.detail || this.t('deleteFailed'));
        }

        const resData = await res.json();
        const extId = resData.ext_id;

        // --- Core change: start polling ---
        showNotification(this.t('notifyDownloadingBackground'), 'info');
        
        this.pollInstallStatus(
          extId,
          (msg) => {
            // Success callback
            this.installLoading = false;
            showNotification(msg || this.t('notifyInstallSuccess'), 'success');
            this.showExtensionForm = false; // Close the popup
            this.scanExtensions(); // Refresh the list immediately
          },
          (errMsg) => {
            // Failure callback
            this.installLoading = false;
            showNotification(`${this.t('notifyInstallFailedColon')}${errMsg}`, 'error');
          }
        );

      } catch (e) {
        this.installLoading = false;
        showNotification(e.message, 'error');
      }
    },
    // Open the file picker
    selectLocalZip() {
      this.$refs.zipInput.click();
    },

    // Auto-upload after a file is selected
    async onZipSelected(e) {
      const file = e.target.files?.[0];
      if (!file) return;
      
      this.installLoading = true;
      const form = new FormData();
      form.append('file', file);
      
      try {
        const res = await fetch('/api/extensions/upload-zip', {
          method: 'POST',
          body: form,
        });
        
        if (res.status === 409) throw new Error(this.t('extensionExists'));
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.detail || '업로드 실패');
        }
        
        const resData = await res.json();
        const extId = resData.ext_id;
        
        // Start polling, same as the GitHub install
        showNotification(this.t('waitExtensionInstall'), 'info');
        this.showExtensionForm = false;
        
        this.pollInstallStatus(
          extId,
          (msg) => {
            this.installLoading = false;
            showNotification(msg || this.t('installSuccess'), 'success');
            this.scanExtensions();
          },
          (errMsg) => {
            this.installLoading = false;
            showNotification(`${this.t('installFailed')}: ${errMsg}`, 'error');
          }
        );
        
      } catch (err) {
        this.installLoading = false;
        showNotification(err.message, 'error');
      } finally {
        e.target.value = '';
      }
    },

    async fetchRemotePlugins() {
      try {
        await this.scanExtensions(); // Refresh
        const res = await fetch('/api/extensions/remote-list');
        const { plugins } = await res.json();   // Extract the plugins array
        console.log(plugins);
        const localRes = await fetch('/api/extensions/list');
        const { extensions } = await localRes.json();
        console.log(extensions);
        this.remotePlugins = plugins.map(r => ({
          ...r,
          installed: extensions.some(l => l.repository.trim() === r.repository.trim()),
        }));
      } catch (e) {
        
      }
    },
async togglePlugin(plugin) {
    if (plugin.installed) {
      // Uninstall logic stays unchanged...
      await this.removeExtension(plugin);
      plugin.installed = false;
    } else {
      // --- Install logic ---
      
      // 1. Set a local loading state (if your plugin object supports it)
      // If there's no local loading, use the global this.installLoading = true
      plugin.installing = true
      this.installLoading = true; 

      try {
        const res = await fetch('/api/extensions/install-from-github', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            url: plugin.repository,
            backupUrl: plugin.backupRepository || "" 
          }),
        });

        if (res.status === 409) throw new Error('플러그인이 이미 존재합니다');
        if (!res.ok) throw new Error('요청 실패');
        
        const resData = await res.json();
        const extId = resData.ext_id;

        showNotification(this.t('notifyDownloadStarted'), 'info');

        // --- Core change: start polling ---
        this.pollInstallStatus(
          extId,
          (msg) => {
            // Success
            this.installLoading = false;
            if (plugin) plugin.installing = false;
            plugin.installed = true; // Update the frontend state
            showNotification(this.t('notifyInstallSuccess'), 'success');
            this.scanExtensions(); // Refresh the full list to ensure data consistency
          },
          (errMsg) => {
            // Failed
            this.installLoading = false;
            if (plugin) plugin.installing = false;
            showNotification(`${this.t('notifyInstallFailedColon')}${errMsg}`, 'error');
          }
        );

      } catch (e) {
        this.installLoading = false;
        if (plugin) plugin.installing = false;
        showNotification(e.message, 'error');
      }
    }
  },
  handleRefreshClick() {
    this.refreshing = true;
    
    // Call the original refresh method
    this.fetchRemotePlugins().then(() => {
      // After the request completes
      this.refreshing = false;
      this.refreshButtonText = this.t('refreshedSuccess') || '새로고침됨';
      
      // Restore the button text after 2 seconds
      setTimeout(() => {
        this.refreshButtonText = this.t('refreshList');
      }, 2000);
    }).catch(error => {
      // Handle the error case
      this.refreshing = false;
      this.refreshButtonText = this.t('refreshFailed') || '새로고침 실패';
      
      // Restore the button text after 2 seconds
      setTimeout(() => {
        this.refreshButtonText = this.t('refreshList');
      }, 2000);
    });
  },
  openRepository(url) {
    if (isElectron) {
      window.electronAPI.openExternal(url)   // The main process creates a closable standalone window
    } else {
      window.open(url, '_blank')
    }
  },
  startChatHistoryResize(e) {
    if (this.isMobile || !this.chatHistoryPanelOpen) return;

    const container = this.$refs.chatWrapperRef;
    const panel = this.$refs.chatHistoryPanelRef;
    if (!container || !panel) return;

    this.isHistoryPanelResizing = true;
    const containerRect = container.getBoundingClientRect();
    const minWidth = 220;
    const maxWidth = Math.max(minWidth, Math.min(520, containerRect.width - 320));

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (event) => {
      if (!this.isHistoryPanelResizing) return;
      const nextWidth = Math.max(minWidth, Math.min(event.clientX - containerRect.left, maxWidth));
      this.chatHistoryPanelWidth = nextWidth;
    };

    const handleMouseUp = () => {
      this.isHistoryPanelResizing = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  },
  // Start drag-resizing
  startResize(e) {
    if (!this.chatAreaOpen || !this.sidePanelOpen) return;
    
    const container = this.$refs.chatWrapperRef;
    // Get whether the history sidebar is visible and its width
    const historySidebar = container.querySelector('.chat-history-sidebar');
    const isSidebarVisible = this.showHistorySidebar && !this.isMobile;
    const sidebarWidth = isSidebarVisible ? historySidebar.offsetWidth : 0;

    this.isResizing = true;
    const containerRect = container.getBoundingClientRect();
    const availableWidth = containerRect.width - sidebarWidth; // Subtract the history-bar width
    
    container.classList.add('resizing');

    const handleMouseMove = (e) => {
      if (!this.isResizing) return;
      
      // Here mouseX must be relative to the left edge of the chat area
      const mouseXInChat = e.clientX - (containerRect.left + sidebarWidth);
      const clampedMouseX = Math.max(0, Math.min(mouseXInChat, availableWidth));
      
      const leftWidth = clampedMouseX;
      const rightWidth = availableWidth - clampedMouseX - 10; // 10 is the splitter width
      
      const leftPercent = (leftWidth / availableWidth) * 100;
      const rightPercent = (rightWidth / availableWidth) * 100;
      
      if (leftPercent < this.minPanelWidth) {
        this.collapseChatArea();
        handleMouseUp();
        return;
      }
      
      if (rightPercent < this.minPanelWidth) {
        this.collapseSidePanel();
        handleMouseUp();
        return;
      }
      
      this.updatePanelWidthsWithPixels(leftWidth, rightWidth);
    };

    const handleMouseUp = () => {
      this.isResizing = false;
      container.classList.remove('resizing');
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      this.recalculatePercentages(availableWidth);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  },

  handleHistoryToggle() {
      this.showHistorySidebar = !this.showHistorySidebar;
      console.log('showHistorySidebar:',this.showHistorySidebar)
      // Force a recalculate so the right chat area re-adapts to the remaining width
      this.$nextTick(() => {
          this.handleResize(); 
      });
      this.autoSaveSettings();
  },

  // Update the panel using pixel width
  updatePanelWidthsWithPixels(leftWidth, rightWidth) {
    this.$nextTick(() => {
      const chatArea = this.$refs.chatAreaRef;
      const sidePanel = this.$refs.sidePanelRef;
      
      if (!chatArea || !sidePanel) {
        return;
      }
      
      if (this.chatAreaOpen && this.sidePanelOpen) {
        chatArea.style.width = `${leftWidth}px`;
        sidePanel.style.width = `${rightWidth}px`;
      }
    });
  },

  // Recompute the percentage (for saving state and reactivity)
  recalculatePercentages(providedAvailableWidth) {
    const container = this.$refs.chatWrapperRef;
    const historySidebar = container?.querySelector('.chat-history-sidebar');
    const sidebarWidth = (historySidebar && !this.isMobile) ? historySidebar.offsetWidth : 0;
    
    // If no width is passed, compute it live
    const availableWidth = providedAvailableWidth || (container.offsetWidth - sidebarWidth);
    
    const chatArea = this.$refs.chatAreaRef;
    const sidePanel = this.$refs.sidePanelRef;
    
    if (chatArea && sidePanel && this.chatAreaOpen && this.sidePanelOpen) {
      const chatAreaWidthPx = chatArea.offsetWidth;
      const sidePanelWidthPx = sidePanel.offsetWidth;
      
      // Compute the ratio based on the available width
      this.chatAreaWidth = (chatAreaWidthPx / availableWidth) * 100;
      this.sidePanelWidth = (sidePanelWidthPx / availableWidth) * 100;
    }
  },  

  // Handle splitter clicks
  handleResizerClick(e) {
    if (e.target.closest('.expand-chat-btn') || e.target.closest('.expand-side-btn')) {
      return;
    }
    
    // Double-click to reset to 50:50
    if (e.detail === 2) {
      this.resetPanelSizes();
    }
  },

  // Collapse the chat area
// Collapse the left chat area (letting the right panel fill leftward)
collapseChatArea() {
  const sidePanel = this.$refs.sidePanelRef;
  const chatArea = this.$refs.chatAreaRef;

  // 1. Core fix: before hiding the left side, clear the right side's pixel constraint first
  if (sidePanel) sidePanel.style.width = '';
  if (chatArea) chatArea.style.width = '';

  // 2. Update the state
  this.chatAreaOpen = false;
  this.sidePanelOpen = true; 
  this.sidePanelWidth = 100;
  this.chatAreaWidth = 0;

  // 3. Apply the percentage layout
  this.updatePanelWidths();
},

// Collapse the right sidebar (letting the left chat area fill rightward)
collapseSidePanel() {
  const chatArea = this.$refs.chatAreaRef;
  const sidePanel = this.$refs.sidePanelRef;

  if (chatArea) chatArea.style.width = '';
  if (sidePanel) sidePanel.style.width = '';

  this.sidePanelOpen = false;
  this.chatAreaOpen = true;
  this.chatAreaWidth = 100;
  this.sidePanelWidth = 0;

  this.updatePanelWidths();
},

  // Expand the chat area
  expandChatArea() {
    this.chatAreaOpen = true;
    this.chatAreaWidth = 50;
    this.sidePanelWidth = 50;
    this.updatePanelWidths();
  },

  // Expand the sidebar
  expandSidePanel() {
    this.sidePanelOpen = true;
    this.chatAreaWidth = 50;
    this.sidePanelWidth = 50;
    this.updatePanelWidths();
  },

  // Reset the panel size
  resetPanelSizes() {
    this.chatAreaWidth = 50;
    this.sidePanelWidth = 50;
    this.chatAreaOpen = true;
    this.sidePanelOpen = true;
    this.updatePanelWidths();
  },

  // Update the panel-width style
  updatePanelWidths() {
    this.$nextTick(() => {
      const chatArea = this.$refs.chatAreaRef;
      const sidePanel = this.$refs.sidePanelRef;
      
      if (!chatArea || !sidePanel) return;
      
      // Clear any leftover px width
      chatArea.style.width = '';
      sidePanel.style.width = '';
      
      if (this.chatAreaOpen && this.sidePanelOpen) {
        chatArea.style.width = `${this.chatAreaWidth}%`;
        sidePanel.style.width = `${this.sidePanelWidth}%`;
      } else if (this.chatAreaOpen) {
        chatArea.style.width = '100%';
      } else if (this.sidePanelOpen) {
        sidePanel.style.width = '100%';
      }
      
      // Key fix: force a browser reflow (read a layout property)
      sidePanel.offsetWidth;   // Or chatArea.offsetWidth
    });
  },

  // Handle window-resize changes
  handleResize() {
    if (this.chatAreaOpen && this.sidePanelOpen) {
      this.updatePanelWidths();
    }
  },
  // The modified openExtensionInWindow method
  async openExtensionInWindow(extension) {
    const url = await this.getExtensionURL(extension);   // <- likewise, start/get the address first

    // The logic below is yours already; just swap url for the asynchronously obtained one
    this.showExtensionsDialog = false;
    let windowWidth = 800;
    let windowHeight = 600;
    if (window.electronAPI && window.electronAPI.openExtensionWindow) {
      try {
        if (extension.enableVrmWindowSize){
          console.log('VRM window size enabled')
          windowWidth = this.VRMConfig.windowWidth;
          windowHeight = this.VRMConfig.windowHeight
        }
        else{
          windowWidth = extension.width || 800;
          windowHeight = extension.height || 600;
        }
        const windowId = await window.electronAPI.openExtensionWindow(`${this.partyURL}${url}`, {
          id: extension.id,
          name: extension.name,
          transparent: extension.transparent || false,
          width: windowWidth,
          height: windowHeight,
        });
        console.log(`Extension window opened with ID: ${windowId}`);
      } catch (error) {
        console.error('Failed to open extension window:', error);
        window.open(`${this.partyURL}${url}`, '_blank');
      }
    } else {
      window.open(`${this.partyURL}${url}`, '_blank');
    }
  },
  async sherpaModelStatus() {
    const res = await fetch('/sherpa-model/status')
    if (!res.ok) return
    const { exists, model } = await res.json()
    this.sherpaModelExists = exists
    this.sherpaModelName  = model ?? ''   // Leave empty when the backend returns nothing
  },

  async sherpaDownload(source = 'huggingface') {
      if (this.sherpaEventSource) this.sherpaEventSource.close()
      this.sherpaDownloading = true
      this.sherpaPercent = 0
      
      // Make sure to set the state before instantiating EventSource
      this.sherpaEventSource = null

      const es = new EventSource(`/sherpa-model/download/${source}`)
      this.sherpaEventSource = es
      
      // Listen to the message stream
      es.onmessage = e => {
          let data
          try {
              data = JSON.parse(e.data)
          } catch (error) {
              console.error('Failed to parse download progress data:', e.data, error)
              return
          }

          // --------------------------------------
          // Core fix logic: handle aggregated multi-file progress
          // --------------------------------------
          
          // 1. Check whether the download is complete or failed
          if (data.status === 'complete') {
              es.close()
              this.sherpaDownloading = false
              this.sherpaPercent = 100
              this.sherpaModelStatus()
              showNotification(this.t('modelDownloadSuccess'))
              return
          }

          if (data.status === 'failed') {
              es.close()
              this.sherpaDownloading = false
              showNotification(this.t('modelDownloadFailed') + (data.error || ''), 'error')
              return
          }

          // 2. Aggregate the progress of all files
          let totalDone = 0
          let grandTotal = 0

          if (data.files && data.files.length > 0) {
              data.files.forEach(file => {
                  totalDone += file.done || 0
                  grandTotal += file.total || 0
                  // Check whether any single file failed
                  if (file.failed) {
                      es.close()
                      this.sherpaDownloading = false
                      showNotification(this.t('modelDownloadFailed') + `: ${file.filename}`, 'error')
                  }
              })
          }

          // 3. Compute the overall percentage
          this.sherpaPercent = grandTotal > 0 ? Math.round((totalDone / grandTotal) * 100) : 0
      }
      
      // Listen for errors
      es.onerror = () => {
          // If EventSource closes without receiving a close message, it usually means an error
          es.close()
          this.sherpaDownloading = false
          showNotification(this.t('modelDownloadFailed'), 'error')
          this.sherpaModelStatus() // Re-check the state in case it actually finished downloading
      }
  },

  async sherpaRemove() {
    try {
      const res = await fetch('/sherpa-model/remove', { method: 'DELETE' })
      if (!res.ok) throw new Error()
      showNotification(this.t('deleteSuccess'))
      this.sherpaModelStatus()
    } catch {
      showNotification(this.t('deleteFailed'),'error')
    }
  },

  async loadSherpaStatus() {
    await this.sherpaModelStatus()
  },


    /**
     * Check the MiniLM model status (whether it exists)
     */
    async minilmModelStatus() {
        try {
            const res = await fetch('/minilm-model/status');
            if (!res.ok) throw new Error('Failed to fetch status');
            const data = await res.json();
            this.minilmModelExists = data.exists;
        } catch (error) {
            console.error("Error checking MiniLM model status:", error);
            this.minilmModelExists = false; // Assume a network error preventing the check also means it doesn't exist
        }
    },

    /**
     * Download the MiniLM model
     * @param {string} source - download source: 'modelscope' or 'huggingface'
     */
    async minilmDownload(source = 'huggingface') {
        if (this.minilmEventSource) this.minilmEventSource.close();
        
        this.minilmDownloading = true;
        this.minilmPercent = 0;
        this.minilmEventSource = null;

        const es = new EventSource(`/minilm-model/download/${source}`);
        this.minilmEventSource = es;
        
        // Listen to the message stream
        es.onmessage = async e => {
            let data;
            try {
                // The backend sends progress data in JSON format
                data = JSON.parse(e.data);
            } catch (error) {
                // The backend may send a non-JSON message like 'close'
                if (e.data === 'close') {
                    es.close();
                }
                console.error('Failed to parse download progress data:', e.data, error);
                return;
            }

            // 1. Check whether the download is complete or failed
            if (data.status === 'complete') {
                es.close();
                this.minilmDownloading = false;
                this.minilmPercent = 100;

                // 1. Tell the backend to hot-reload
                await fetch('/minilm/reload', { method: 'POST' });

                // 2. Refresh the existence status once more (it must be true now)
                await this.minilmModelStatus();

                if (typeof showNotification === 'function') {
                    showNotification(this.t('modelDownloadSuccess'));
                }
                return;
            }

            if (data.status === 'failed') {
                es.close();
                this.minilmDownloading = false;
                // Try to extract the specific error message from the files list
                const firstError = data.files.find(f => f.failed)?.error || '';
                if (typeof showNotification === 'function') {
                    showNotification(this.t('modelDownloadFailed') + (firstError ? `: ${firstError}` : ''), 'error');
                }
                return;
            }

            // 2. Aggregate the progress of all files
            let totalDone = 0;
            let grandTotal = 0;

            if (data.files && data.files.length > 0) {
                let hasFailedFile = false;
                data.files.forEach(file => {
                    totalDone += file.done || 0;
                    grandTotal += file.total || 0;
                    
                    // Check whether any single file failed (the backend already handles status='failed'; this is a redundant check)
                    if (file.failed) {
                        hasFailedFile = true;
                    }
                });

                if (hasFailedFile) {
                      // If a file failure is detected but the backend hasn't updated status to 'failed', manually close and error out
                      es.close();
                      this.minilmDownloading = false;
                      const failedFile = data.files.find(f => f.failed);
                      if (typeof showNotification === 'function') {
                        showNotification(this.t('modelDownloadFailed') + `: ${failedFile.filename}`, 'error');
                      }
                      return;
                }
            }

            // 3. Compute the overall percentage
            this.minilmPercent = grandTotal > 0 ? Math.round((totalDone / grandTotal) * 100) : 0;
        };
        
        // Listen for errors
        es.onerror = () => {
            // If EventSource closes without receiving a close message, it usually means an error
            if (this.minilmEventSource) {
                this.minilmEventSource.close();
            }
            this.minilmDownloading = false;
            if (typeof showNotification === 'function') {
                showNotification(this.t('modelDownloadFailed') + ' (Network/Connection Error)', 'error');
            }
            this.minilmModelStatus(); // Re-check the state in case it actually finished downloading
        };
    },

    /**
     * Delete the local MiniLM model
     */
    async minilmRemove() {
        try {
            // Use the Element Plus confirm dialog for extra safety (if available)
            // Example: await this.$confirm('Delete the MiniLM model?', 'Warning', { type: 'warning' })

            const res = await fetch('/minilm-model/remove', { method: 'DELETE' });
            if (!res.ok) throw new Error();
            
            if (typeof showNotification === 'function') {
                showNotification(this.t('deleteSuccess'));
            }
            this.minilmModelStatus(); // Refresh the model's existence status
        } catch (error) {
            if (typeof showNotification === 'function') {
                showNotification(this.t('deleteFailed') + (error.message || ''), 'error');
            }
        }
    },

  async updatePlugin(plugin) {
    // Temporary reactivity flag
    plugin._updating = true // Send the update request
    try {
      const res = await fetch(`/api/extensions/${plugin.id}/update`, { method: 'PUT' })
      if (!res.ok) throw new Error(await res.text())
      showNotification(this.t('updateSuccess'))
      // After updating, refresh the local list and re-mark the installed status
      this.fetchRemotePlugins();
    } catch (e) {
      showNotification(this.t('updateFailed') + ': ' + e.message, 'error')
    } finally {
      plugin._updating = false
    }
  },

    // Open the main vector-store interaction dialog
    async openVectorDialog(mid) {
      this.vectorDialogVisible = true
      this.vectorDialogMemoryId = mid
      // Get the memory name only for the title display
      this.vectorDialogMemoryName = this.memories.find(m => m.id === mid)?.name || mid
      await this.loadVectorTable(mid)
    },

    // Read the memory content
    async loadVectorTable(mid) {
      this.vectorLoading = true
      try {
        const res = await fetch(`/memory/${mid}`)
        if (!res.ok) throw new Error(await res.text())
        // The backend already flattened it; assign directly
        this.vectorTable = await res.json()
      } catch (e) {
        this.vectorTable = []
        console.error(e)
      } finally {
        this.vectorLoading = false
      }
    },

    // Add a memory
    async addVectorRow() {
      if (!this.newVectorText.trim()) return
      try {
        const mid = this.vectorDialogMemoryId
        const res = await fetch(`/memory/${mid}`, {
          
        })
      } finally {
        this.vectorLoading = false
      }
    },

  startEditRow(tableIndex) {
    const row = this.vectorTable[tableIndex]
    this.editRowIdx = row.idx
    this.editRowText = row.text
    this.editRowVisible = true
  },
  async submitEditRow() {
    if (!this.editRowText.trim()) return
    try {
      const mid = this.vectorDialogMemoryId
      const res = await fetch(`/memory/${mid}/${this.editRowIdx}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_text: this.editRowText.trim() })
      })
      if (!res.ok) throw new Error(await res.text())
      this.editRowVisible = false
      await this.loadVectorTable(mid)
    } catch (e) {
      showNotification(e.message, 'error')
    }
  },
  async deleteVectorRow(idx) {
    try {
      const mid = this.vectorDialogMemoryId
      const res = await fetch(`/memory/${mid}/${idx}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text())
      await this.loadVectorTable(mid)
    } catch (e) {
      showNotification(e.message, 'error')
    }
  },
  /* Probe */
  async probeNode() {
    const res = await fetch('/api/node/probe');
    const { installed } = await res.json();
    this.nodeInstalled = installed;
  },

    /* ===== uv-related ===== */
  async probeUv() {
    const res = await fetch('/api/uv/probe');
    const { installed } = await res.json();
    this.uvInstalled = installed;
  },

  async openLogDialog() {
    this.showLogDialog = true;
    await this.fetchLogs();
    // Auto-scroll to the bottom
    this.$nextTick(() => {
      if (this.$refs.logContainer) {
        this.$refs.logContainer.scrollTop = this.$refs.logContainer.scrollHeight;
      }
    });
  },

  async fetchLogs() {
    if (window.electronAPI) {
      try {
        this.logContent = await window.electronAPI.getBackendLogs();
      } catch (e) {
        this.logContent = 'Failed to load logs: ' + e.message;
      }
    }
  },
  async fetchSystemVoices() {
      this.isLoadingSystemVoices = true;
      try {
        // Use the fetch API to call the backend endpoint
        const response = await fetch('/system/voices'); // Adjust according to your API prefix
        
        if (!response.ok) {
            // Handle HTTP error statuses (e.g. 404, 500)
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data && data.voices) {
          this.systemVoices = data.voices;
          
          // If no voice is selected, or the selected one isn't in the list, default to the first
          const currentVoiceValid = this.systemVoices.some(v => v.id === this.ttsSettings.systemVoiceName);
          if (!this.ttsSettings.systemVoiceName || !currentVoiceValid) {
             if (this.systemVoices.length > 0) {
               this.ttsSettings.systemVoiceName = this.systemVoices[0].id;
               this.autoSaveSettings(); // Save the default selection
             }
          }
        }
      } catch (error) {
        console.error("获取系统音色失败:", error);
        if (this.$message) {
           this.$message.error(`${this.t('getVoiceListFailed')}${error.message}`);
        }
      } finally {
        this.isLoadingSystemVoices = false;
      }
    },

  addTableEnhancements() {
    this.$nextTick(() => {
      const tables = document.querySelectorAll('.markdown-body table');
      
      tables.forEach((table) => {
        if (table.parentElement.classList.contains('markdown-table-wrapper')) return;

        // 1. Create the container
        const wrapper = document.createElement('div');
        wrapper.className = 'markdown-table-wrapper';
        table.parentNode.insertBefore(wrapper, table);
        wrapper.appendChild(table);

        // 2. Create the button
        const btn = document.createElement('button');
        btn.className = 'table-download-btn';
        // Use the fa-file-excel icon; more intuitive
        btn.innerHTML = '<i class="fa-solid fa-file-excel"></i> XLSX';
        btn.title = 'Excel 파일로 내보내기';
        
        // 3. Bind the click event (calls the new exceljs logic)
        btn.onclick = async (e) => {
          e.stopPropagation();
          // Add loading-state feedback (optional)
          const originalText = btn.innerHTML;
          btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 내보내는 중...';
          btn.disabled = true;
          
          try {
            await this.downloadTableAsXLSX(table);
          } catch (error) {
            console.error('Excel 导出失败:', error);
            this.$message?.error(this.t('exportFailedRetry'));
          } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
          }
        };

        wrapper.appendChild(btn);
      });
    });
  },

  // Global click-event delegation
  handleGlobalClick(event) {
    // 1. Check whether the click was on the Excel-export button
    // closest handles the case where the user clicks the icon <i>
    const btn = event.target.closest('.download-xlsx-trigger');
    
    if (btn) {
      event.preventDefault();
      event.stopPropagation();
      
      // Find the previous sibling at the same level (i.e. the table)
      // Based on the markdown-it structure above: <table>...</table> <button>...</button>
      // So button.previousElementSibling is the table
      const table = btn.previousElementSibling;
      
      if (table && table.tagName === 'TABLE') {
        this.exportTable(btn, table);
      }
    }
  },

    handleMessageLinkClick(event) {
        // 1. If your original handleGlobalClick has logic (e.g. clicking blank space to close a menu), call it here
        this.handleGlobalClick(event); 

        if(isElectron){

          const link = event.target.closest('a');

          if (link && link.href) {
              const href = link.href;

              // 2. Filter logic: only intercept http/https web links
              if (href.startsWith('http') || href.startsWith('https')) {
                  
                  // Key: call both stopPropagation and preventDefault
                  event.preventDefault();  // Prevent the link's default navigation
                  event.stopPropagation(); // Stop the event from propagating further
                  
                  // 3. Open the internal browser
                  console.log('拦截到链接，正在内部浏览器打开:', href);
                  this.openUrlInNewTab(href);
              }
          }
        
        }

    },

  // The logic here is similar to your original click, just with different arguments
  async exportTable(btn, tableElement) {
    if (btn.disabled) return; // Prevent duplicate clicks

    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 내보내는 중...';
    btn.disabled = true;

    try {
      await this.downloadTableAsXLSX(tableElement);
    } catch (error) {
      console.error('导出失败', error);
      // If Element Plus is available
      if (this.$message) this.$message.error(this.t('exportFailed'));
    } finally {
      btn.innerHTML = originalHtml;
      btn.disabled = false;
    }
  },

  /**
   * Use ExcelJS to generate a real .xlsx file
   */
  async downloadTableAsXLSX(tableElement) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('데이터 내보내기');

    // --- 1. Extract the HTML table data ---
    const rows = tableElement.querySelectorAll('tr');
    
    // Iterate the HTML rows
    rows.forEach((row, rowIndex) => {
      const cells = row.querySelectorAll('td, th');
      const rowData = [];
      
      cells.forEach(cell => {
        // Get the plain text
        rowData.push(cell.innerText.trim());
      });
      
      // Add to the worksheet
      const excelRow = worksheet.addRow(rowData);
    });

    // --- 2. Beautify the Excel styling (pro mode) ---
    
    // 2.1 Style the header row (first row)
    const headerRow = worksheet.getRow(1);
    headerRow.font = { 
      name: 'Malgun Gothic',
      bold: true, 
      color: { argb: 'FFFFFFFF' } // White text
    };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E849B' } // Use your theme color (dark cyan)
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

    // 2.2 Auto-compute column widths
    worksheet.columns.forEach(column => {
      let maxLength = 0;
      column.eachCell({ includeEmpty: true }, cell => {
        const columnLength = cell.value ? cell.value.toString().length : 10;
        if (columnLength > maxLength) maxLength = columnLength;
      });
      // Cap the max width to avoid it being too wide
      column.width = maxLength < 10 ? 10 : (maxLength > 50 ? 50 : maxLength + 2);
    });

    // 2.3 Add borders
    worksheet.eachRow((row, rowNumber) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFDCDFE6' } },
          left: { style: 'thin', color: { argb: 'FFDCDFE6' } },
          bottom: { style: 'thin', color: { argb: 'FFDCDFE6' } },
          right: { style: 'thin', color: { argb: 'FFDCDFE6' } }
        };
        // Vertically center the content
        cell.alignment = { ...cell.alignment, vertical: 'middle', wrapText: true };
      });
    });

    // --- 3. Generate and download the file ---
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[-T:]/g, "");
    link.href = URL.createObjectURL(blob);
    link.download = `table_export_${timestamp}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  },

    // [A2UI new] handle the user's click action
    handleA2UIAction(msg) {
      console.log('A2UI Action Triggered:', msg);
      this.userInput = msg;
      this.sendMessage();
    },

    // [A2UI new] split the message content into text/UI segments
    splitMessageContent(content) {
      if (!content) return [];
      const segments = [];
      const regex = /```a2ui\s*([\s\S]*?)\s*```/g;
      
      let lastIndex = 0;
      let match;

      while ((match = regex.exec(content)) !== null) {
        if (match.index > lastIndex) {
          const textPart = content.slice(lastIndex, match.index);
          if (textPart) segments.push({ type: 'text', content: textPart });
        }

        try {
          const uiConfig = JSON.parse(match[1]);
          segments.push({ type: 'ui', content: uiConfig });
        } catch (e) {
          segments.push({ type: 'text', content: match[0] });
        }
        lastIndex = regex.lastIndex;
      }

      if (lastIndex < content.length) {
        segments.push({ type: 'text', content: content.slice(lastIndex) });
      }

      return segments;
    },

    async fetchTetosNewVoices(provider) {
        this.newTTSConfig.isFetchingVoices = true;
        this.newTTSConfig.tetosVoices = []; // Clear the existing list
        
        let config = {};
        const s = this.newTTSConfig;

        // Build the config based on the provider
        switch(provider) {
            case 'azure':
                config = { speech_key: s.azureSpeechKey, speech_region: s.azureRegion };
                break;
            case 'fish':
                config = { api_key: s.fishApiKey };
                break;
            case 'google':
                // Try to parse the JSON string
                try {
                    if (s.googleServiceAccount) {
                         config = { service_account: JSON.parse(s.googleServiceAccount) };
                    }
                } catch (e) {
                    this.newTTSConfig.isFetchingVoices = false;
                    return;
                }
                break;
        }

        try {
            const response = await fetch('/tts/tetos/list_voices', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider: provider, config: config })
            });
            const result = await response.json();
            
            if (result.status === 'success') {
                this.newTTSConfig.tetosVoices = result.data;
            } else {
                console.error(result);
            }
        } catch (error) {
            console.error('Error fetching voices:', error);
        } finally {
            this.newTTSConfig.isFetchingVoices = false;
        }
    },

    async fetchTetosVoices(provider) {
        this.ttsSettings.isFetchingVoices = true;
        this.ttsSettings.tetosVoices = []; // Clear the existing list
        
        let config = {};
        const s = this.ttsSettings;

        // Build the config based on the provider
        switch(provider) {
            case 'azure':
                config = { speech_key: s.azureSpeechKey, speech_region: s.azureRegion };
                break;
            case 'fish':
                config = { api_key: s.fishApiKey };
                break;
            case 'google':
                // Try to parse the JSON string
                try {
                    if (s.googleServiceAccount) {
                         config = { service_account: JSON.parse(s.googleServiceAccount) };
                    }
                } catch (e) {
                    this.ttsSettings.isFetchingVoices = false;
                    return;
                }
                break;
        }

        try {
            const response = await fetch('/tts/tetos/list_voices', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider: provider, config: config })
            });
            const result = await response.json();
            
            if (result.status === 'success') {
                this.ttsSettings.tetosVoices = result.data;
            } else {
                console.error(result);
            }
        } catch (error) {
            console.error('Error fetching voices:', error);
        } finally {
            this.ttsSettings.isFetchingVoices = false;
        }
    },

    // 1. Get the voice display name (label)
    getVoiceLabel(v) {
        // Case A: the data is a plain string (the case you just showed)
        if (typeof v === 'string') return v;
        
        // Case B: the data is an object (Azure, etc.)
        if (v && typeof v === 'object') {
            // Prefer the display name; if absent, look for id or name
            return v.DisplayName || v.local_name || v.name || v.Name || v.id || v.Id || v.ShortName || 'Unknown Voice';
        }
        return 'Unknown';
    },

    // 2. Get the voice's actual value (the value passed to the backend)
    getVoiceValue(v) {
        // Case A: plain string
        if (typeof v === 'string') return v;
        
        // Case B: object
        if (v && typeof v === 'object') {
            return v.ShortName || v.id || v.Id || v.name || '';
        }
        return '';
    },

    // 3. Get the auxiliary info (the gray text on the right, e.g. language)
    getVoiceDesc(v) {
        // A plain string has no extra info; return empty
        if (typeof v === 'string') return '';
        
        // An object may contain language info
        if (v && typeof v === 'object') {
            const lang = v.Locale || v.locale || v.Language || v.language || (v.language_codes ? v.language_codes[0] : '');
            return lang ? `[${lang}]` : '';
        }
        return '';
    },


    // AI-browser-related
    openUrlInNewTab(url) {
        // If the url is empty or invalid, you could check it, or just open it
        if (!url) return;

        const newTab = {
            id: Date.now(),
            title: 'Loading...',
            url: url,
            favicon: '',
            isLoading: true,
            canGoBack: false,
            canGoForward: false
        };
        this.browserTabs.push(newTab);
        this.switchTab(newTab.id);
        this.activeMenu = 'ai-browser';
    },

    // Switch tabs
    switchTab(id) {
        this.currentTabId = id;
        const tab = this.browserTabs.find(t => t.id === id);
        if (tab) {
            // --- Modified here ---
            // Prefer showing the page's actual currentUrl; otherwise show tab.url
            this.urlInput = tab.currentUrl || tab.url;
            
            // If it's the welcome page, clear the address-bar display
            if (!tab.url) this.urlInput = '';
        }
    },

    // Add a new tab
    addNewTab() {
        const newTab = {
            id: Date.now(),
            title: 'New Tab',
            url: '',
            favicon: '',
            isLoading: false,
            canGoBack: false,
            canGoForward: false
        };
        this.browserTabs.push(newTab);
        this.switchTab(newTab.id);
    },

    // Close a tab
    closeTab(id, event) {
        if (event) event.stopPropagation(); // Prevent triggering a click-switch
        
        const index = this.browserTabs.findIndex(t => t.id === id);
        if (index === -1) return;

        // If the closed tab is the current one, switch to another
        if (this.currentTabId === id) {
            if (this.browserTabs.length > 1) {
                // Prefer switching right; if there's none, switch left
                const nextTab = this.browserTabs[index + 1] || this.browserTabs[index - 1];
                this.currentTabId = nextTab.id;
                this.urlInput = nextTab.url;
            } else {
                // If it's the only one left, reset it instead of deleting
                this.addNewTab(); // Add a new one
                this.browserTabs.splice(index, 1); // Delete the old one
                return;
            }
        }
        
        this.browserTabs.splice(index, 1);
    },

    // Address-bar enter
    handleUrlEnter() {
        let val = this.urlInput.trim();
        if (!val) return;

        // Simple URL-completion logic
        if (!/^https?:\/\//i.test(val)) {
            // If it looks like a domain
            if (/^([\w-]+\.)+[\w-]+/.test(val) && !val.includes(' ')) {
                val = 'https://' + val;
            } else {
                // Otherwise treat it as a search
                if (this.searchEngine === 'google') {
                    val = `https://www.google.com/search?q=${encodeURIComponent(val)}`;
                } else if (this.searchEngine === 'bing') {
                    val = `https://www.bing.com/search?q=${encodeURIComponent(val)}`;
                } else {
                    if (this.chromeMCPSettings.enabled == false || this.chromeMCPSettings.type != 'internal') {
                        showNotification(this.t('notEnabledInternalBrowserBontrol'), 'error')
                    }
                    this.showBrowserChat = true;
                    this.userInput = val;
                    this.sendMessage();
                    return;
                }
            }
        }

        this.navigateTo(val);
    },

    getTabIdByIndex(index) {
        if (index >= 0 && index < this.browserTabs.length) {
            return this.browserTabs[index].id;
        }
        return null;
    },

    // Welcome-page search enter
    handleWelcomeSearch() {
        const query = this.welcomeSearchQuery.trim();
        this.welcomeSearchQuery = ''; // Clear the input box
        if (!query) return;

        // --- New logic: URL detection and direct navigation ---
        if (this.isUrl(query)) {
            let targetUrl = query;
            // If it doesn't start with http:// or https://, prepend https:// by default
            if (!/^https?:\/\//i.test(targetUrl)) {
                targetUrl = 'https://' + targetUrl;
            }
            this.navigateTo(targetUrl);
            return;
        }
        // ------------------------------------

        let searchUrl = '';
        if (this.searchEngine === 'google') {
            searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        } else if (this.searchEngine === 'bing') {
            searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
        } else {
            if (this.chromeMCPSettings.enabled == false || this.chromeMCPSettings.type != 'internal') {
                showNotification(this.t('notEnabledInternalBrowserBontrol'), 'error')
            }
            this.showBrowserChat = true;
            this.userInput = query;
            this.sendMessage();
            return;
        }

        this.navigateTo(searchUrl);
    },

    /**
     * Helper: determine whether a string is a URL
     * Rules:
     * 1. Starts with http/https
     * 2. Or matches domain.suffix (e.g. google.com)
     * 3. Or is localhost
     * 4. Or is an IP address
     * 5. And contains no spaces
     */
    isUrl(str) {
        // Simple check: if it contains spaces, it's usually a search term (unless it's an encoded URL, but user input usually has spaces)
        if (str.includes(' ')) return false;

        // Regex explanation:
        // ^(https?:\/\/)?  -> optional http:// or https://
        // (
        //   ([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}  -> standard domain (e.g. a.com, b.co.uk)
        //   | localhost                     -> local localhost
        //   | (\d{1,3}\.){3}\d{1,3}         -> IP address (e.g. 192.168.1.1)
        // )
        // (:\d+)?          -> optional port (e.g. :8080)
        // (\/.*)?$         -> optional path
        const pattern = /^(https?:\/\/)?(([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}|localhost|(\d{1,3}\.){3}\d{1,3})(:\d+)?(\/.*)?$/i;
        
        return pattern.test(str);
    },

    // Core navigation method
    navigateTo(url) {
        if (!this.currentTab) return;
        
        // If refreshing the current page (URL unchanged)
        // Note: it's best to also compare currentUrl here
        const activeUrl = this.currentTab.currentUrl || this.currentTab.url;
        
        if (activeUrl === url) {
            // ... (keep the original reload logic)
            const wv = document.getElementById('webview-' + this.currentTabId);
            if (wv) wv.reload();
            return;
        }

        // 2. If it's a new URL
        this.currentTab.url = url;      // This triggers a :src update and starts loading
        this.currentTab.currentUrl = url; // Sync-update the actual address state
        this.urlInput = url;
    },
    
    // Return to the home page (new tab)
    goHome() {
        if(this.currentTab) {
            this.currentTab.url = '';
            this.currentTab.title = 'New Tab';
            this.currentTab.favicon = '';
            this.urlInput = '';
        }
    },

    // --- Webview navigation control ---
    getWebview(id) {
        const wv = document.getElementById('webview-' + (id || this.currentTabId));
        
        // 1. Basic non-null check
        if (!wv) {
            console.warn("getWebview: Element not found for ID", id || this.currentTabId);
            return null;
        }

        // 2. Core change: check whether the element is actually connected to the DOM tree
        // If the element exists but isConnected is false, Vue is destroying it or it isn't mounted yet
        // Return null in that case, so the Python side catches the "No active webview" error and retries
        if (!wv.isConnected) {
            console.warn("getWebview: Element found but detached from DOM (Zombie node).");
            return null;
        }

        // 3. (Optional) check Electron's internal state
        // getWebContentsId is a native Electron webview method; an error means it's not initialized internally
        try {
            if (typeof wv.getWebContentsId !== 'function') {
                return null;
            }
        } catch (e) {
            return null;
        }

        return wv;
    },

    browserGoBack() {
        const wv = this.getWebview();
        if (wv && wv.canGoBack()) wv.goBack();
    },

    browserGoForward() {
        const wv = this.getWebview();
        if (wv && wv.canGoForward()) wv.goForward();
    },

    browserReload() {
        const wv = this.getWebview();
        if(!wv) return;
        if (this.currentTab.isLoading) {
            wv.stop();
        } else {
            wv.reload();
        }
    },

    // --- Webview event listeners ---
    // Note: these events are bound in the HTML via @did-start-loading="..."
    
    onDidStartLoading(id) {
        const tab = this.browserTabs.find(t => t.id === id);
        if (tab) tab.isLoading = true;
    },

    // Before the change
    onDidStopLoading(id) {
        const tab = this.browserTabs.find(t => t.id === id);
        if (tab) {
            tab.isLoading = false;
            const wv = document.getElementById('webview-' + id);
            if (wv) {
                tab.canGoBack = wv.canGoBack();
                tab.canGoForward = wv.canGoForward();
                
                // --- The corrected code ---
                if (wv.getURL()) {
                    // 1. Store the actual URL in a new field, without touching tab.url (src)
                    tab.currentUrl = wv.getURL(); 
                    
                    // 2. Only update the top address-bar UI
                    if (this.currentTabId === id) {
                        this.urlInput = tab.currentUrl;
                    }
                }
            }
        }
    },

    onPageTitleUpdated(id, event) {
        const tab = this.browserTabs.find(t => t.id === id);
        if (tab) tab.title = event.title;
    },

    onPageFaviconUpdated(id, event) {
        const tab = this.browserTabs.find(t => t.id === id);
        if (tab && event.favicons && event.favicons.length > 0) {
            tab.favicon = event.favicons[0];
        }
    },

    // Handle in-page window.open
    onNewWindow(id, event) {
        // Open in a new in-app tab instead of popping up a new window
        const { url } = event;
        const newTab = {
            id: Date.now(),
            title: 'Loading...',
            url: url,
            favicon: '',
            isLoading: true,
            canGoBack: false,
            canGoForward: false
        };
        this.browserTabs.push(newTab);
        this.switchTab(newTab.id);
    },
    
    // Add or modify onDomReady inside methods
    onDomReady(tabId) {
        const webview = document.getElementById('webview-' + tabId);
        if (!webview) return;

        webview.addEventListener('context-menu', (e) => {
            // Key debug point: print all the arguments Electron passed in
            console.log('Webview Context Menu Params:', e.params);
            
            const params = e.params;
            let menuType = 'default';
            let data = {};

            // Re-examine and reorder the checks so the most specific match comes first
            if (params.mediaType === 'image' && params.srcURL && params.srcURL.length > 0) {
                menuType = 'image';
                data = { src: params.srcURL };
                console.log('Detected Image Context:', data); // Debug
            } else if (params.linkURL && params.linkURL.length > 0) {
                menuType = 'link';
                data = { 
                    url: params.linkURL, 
                    text: params.linkText || params.selectionText || '' 
                };
                console.log('Detected Link Context:', data); // Debug
            } else if (params.selectionText && params.selectionText.length > 0) {
                menuType = 'text';
                data = { text: params.selectionText };
                console.log('Detected Text Context:', data); // Debug
            } else {
                menuType = 'default';
                console.log('Detected Default Context'); // Debug
            }

            // Print the final type and data to be sent, again
            console.log(`Sending context menu request: Type = ${menuType}, Data =`, data);

            window.electronAPI.showContextMenu(menuType, data);
        });
        webview.send('set-i18n', {
            translate: this.t('translate') || '번역',
            askAI: this.t('ask_ai') || 'AI에게 질문',
            read: this.t('read') || '읽어주기',
            copy: this.t('copy') || '복사'
        });
        //webview.openDevTools();
    },

    // 1. Modify the IPC message handler
    async handleWebviewIpcMessage(event) {
        if (event.channel === 'ai-toolbar-action') {
            const { action, text } = event.args[0];
            if (!text) return;

            // Get the webview instance for sending data back
            // Note: event.target is the webview element
            const webview = event.target; 

            switch (action) {
                case 'translate':
                    // --- 1. Translate/summarize: call the backend directly + stream back ---
                    // Don't open the sidebar; display in place within the webview
                    this.streamTranslateInWebview(webview, text);
                    break;

                case 'ask':
                    // --- 2. Ask AI: keep the original logic, go to the sidebar ---
                    this.showBrowserChat = true;
                    // If you want to add the prompt automatically:
                    this.userInput = `${text}`; 
                    // this.sendMessage(); // i.e. let the user click send themselves, or uncomment to auto-send
                    break;

                case 'read':
                    // --- 3. Read aloud: call TTS ---
                    this.handleBrowserTTS(text);
                    break;
            }
        }
    },

    // 2. New: stream-request the backend and send to the webview
    async streamTranslateInWebview(webview, text) {
        if (!webview) return;
        
        console.log('开始请求翻译:', text);
        webview.send('ai-stream-start');

        try {
            const host = window.electron?.server?.host || '127.0.0.1';
            const port = window.electron?.server?.port || 3456;
            const apiUrl = `http://${host}:${port}/simple_chat`;
            const targetLang = this.target_lang || 'Simplified Chinese';
            const sysPrompt = `You are a helpful translation assistant. Translate the following text to ${targetLang}. Only output the translated text.`;

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [
                        { role: "system", content: sysPrompt },
                        { role: "user", content: text }
                    ],
                    stream: true
                })
            });

            if (!response.ok) throw new Error(`API Error: ${response.status}`);

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); 

                for (const line of lines) {
                    let trimmed = line.trim();
                    if (!trimmed || trimmed === 'data: [DONE]') continue;
                    
                    // --- Core change: handle multiple formats ---
                    
                    // 1. If it starts with 'data:' (standard SSE format), strip the prefix
                    if (trimmed.startsWith('data:')) {
                        trimmed = trimmed.replace(/^data:\s?/, '');
                    }
                    
                    // 2. Try to parse JSON (now both plain JSON and JSON after stripping 'data:' parse fine)
                    try {
                        const data = JSON.parse(trimmed);
                        const content = data.choices?.[0]?.delta?.content;
                        
                        if (content) {
                            // console.log('Chunk:', content); 
                            webview.send('ai-stream-chunk', content);
                        }
                    } catch (e) {
                        // Ignore non-JSON lines (e.g. heartbeats or comments)
                        // console.log('Json parse failed for line:', trimmed);
                    }
                }
            }
            
            webview.send('ai-stream-end');
            console.log('流式传输结束');

        } catch (error) {
            console.error('Translation error:', error);
            webview.send('ai-stream-chunk', `\n[Error: ${error.message}]`);
        }
    },

    // 3. Change: TTS-handling logic
    handleBrowserTTS(text) {
        // Stop the previous playback (if any)
        this.stopTTSActivities();
        
        // Set the long-text content
        this.readConfig.longText = text;
        
        // Delay slightly to ensure the state updates, then start reading aloud
        setTimeout(() => {
            this.startRead();
            
            // Notify the user (optional)
            // showNotification(this.t('tts_started'), 'success');
        }, 500);
    },

    // Toggle the engine dropdown
    toggleEngineDropdown() {
        this.showEngineDropdown = !this.showEngineDropdown;
    },

    // Set the engine and close the dropdown
    setSearchEngine(engine) {
        this.searchEngine = engine;
        this.showEngineDropdown = false;
        // If you want to auto-focus the input box after switching
        this.$nextTick(() => {
            const input = document.querySelector('.ios-search-input');
            if(input) input.focus();
        });
    },

    // Search-box blur handling (delay closing the dropdown so clicking a menu item doesn't dismiss it first)
    handleSearchBlur() {
        this.isSearchFocused = false;
        setTimeout(() => {
            this.showEngineDropdown = false;
        }, 200);
    },

    // Modify the original addNewTab to ensure correct styling
    addNewTab() {
        const newTab = {
            id: Date.now(),
            title: 'New Tab',
            url: '',
            favicon: '',
            isLoading: false,
            canGoBack: false,
            canGoForward: false
        };
        this.browserTabs.push(newTab);
        this.switchTab(newTab.id);
        
        // Auto-focus the welcome-page search box
        this.$nextTick(() => {
             const input = document.querySelector('.ios-search-input');
             if(input) input.focus();
        });
    },

    handleSelectorEnter() {
        if (this.dropdownTimer) clearTimeout(this.dropdownTimer);
        this.showEngineDropdown = true;
    },

    // Mouse leaves the area: close after a 200ms delay to give the user time to move the mouse
    handleSelectorLeave() {
        this.dropdownTimer = setTimeout(() => {
            this.showEngineDropdown = false;
        }, 200); // 200ms delay
    },

    // Core: handle edge scrolling
    handleTabsMouseMove(e) {
      // In the Options API, access the DOM via this.$refs
      const container = this.$refs.tabsContainerRef;
      
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left; // The mouse's distance from the container's left edge
      const width = rect.width;
      const threshold = 60; // The edge range that triggers scrolling (px)
      const speed = 8;      // Scroll speed

      // Clear any existing old timer first
      this.stopEdgeScroll();

      // Define the scroll function
      const scroll = (direction) => {
        if (direction === 'left') {
          container.scrollLeft -= speed;
        } else {
          container.scrollLeft += speed;
        }
        // Keep looping
        this.scrollInterval = requestAnimationFrame(() => scroll(direction));
      };

      // Determine the mouse position
      if (x < threshold) {
        // Mouse at the left edge -> scroll left
        scroll('left');
      } else if (x > width - threshold) {
        // Mouse at the right edge -> scroll right
        scroll('right');
      } else {
        // In the middle -> stop scrolling
        this.stopEdgeScroll();
      }
    },

    // Stop scrolling
    stopEdgeScroll() {
      if (this.scrollInterval) {
        cancelAnimationFrame(this.scrollInterval);
        this.scrollInterval = null;
      }
    },


    controlDownload(id, action) {
        window.downloadAPI.controlDownload(id, action);
    },

    handleStopOrRemove(item) {
        if (item.state === 'progressing' || item.state === 'paused') {
            // If still downloading, this cancels it
            this.controlDownload(item.id, 'cancel');
        } else {
            // If already finished or canceled, this removes the record from the list
            this.downloads = this.downloads.filter(d => d.id !== item.id);
        }
    },

    openFileFolder(path) {
        if(path) window.downloadAPI.showItemInFolder(path);
    },

    clearFinishedDownloads() {
        // Keep only the items currently downloading
        this.downloads = this.downloads.filter(d => d.state === 'progressing' || d.state === 'paused');
    },

    // Byte-formatting utility
    formatBytes(bytes, decimals = 1) {
        if (!bytes) return '0 B';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    },
    handleDropdownEnter() {
        // 1. If a close timer is counting down, cancel it immediately!
        if (this.dropdownTimer) {
            clearTimeout(this.dropdownTimer);
            this.dropdownTimer = null;
        }
        // 2. Show the panel
        this.showDownloadDropdown = true;
    },

    // Mouse leaves
    handleDropdownLeave() {
        // Give the user 300ms to react
        this.dropdownTimer = setTimeout(() => {
            this.showDownloadDropdown = false;
            this.dropdownTimer = null;
        }, 300); 
    },

    async initChromeMCPSettings() {
        if (!window.electronAPI) return;

        // 1. Ask the main process: is CDP open now? What's the port?
        const cdpInfo = await window.electronAPI.getInternalCDPInfo();
        
        // 2. If the main process really has internal mode on
        if (cdpInfo.active) {
            console.log(`[Frontend] 检测到内部 CDP 已激活，端口: ${cdpInfo.port}`);
            
            // Force-sync the frontend data
            this.chromeMCPSettings.type = 'internal'; 
            this.chromeMCPSettings.CDPport = cdpInfo.port;
            
            // Don't necessarily force enabled = true here, since enabled means 'whether the Python service is running'
            // But if Electron opened the port, it usually means enabled is true in the config
            // We update the config file to ensure the port is current
            await this.autoSaveSettings();
        }
    },
    // ===============================================
    // Python-Agent-specific interface (Electron API bridge)
    // ===============================================

    // --- Basic info and navigation ---

    getPagesInfo() {
        const info = this.browserTabs.map((tab, index) => ({
            index: index,
            id: tab.id,
            title: tab.title || 'Loading...',
            url: tab.url || '',
            active: tab.id === this.currentTabId
        }));
        return JSON.stringify(info);
    },

    closeTabByIndex(index) {
        const tabId = this.getTabIdByIndex(index);
        if (tabId) {
            this.closeTab(tabId);
            return "Closed tab index " + index;
        }
        return "Error: Tab index " + index + " not found";
    },

    switchTabByIndex(index) {
        const tabId = this.getTabIdByIndex(index);
        if (tabId) {
            this.switchTab(tabId);
            this.activeMenu = 'ai-browser';
            return "Selected tab index " + index;
        }
        return "Error: Tab index " + index + " not found";
    },

    browserNavigate(type, url, ignoreCache) {
        const wv = this.getWebview();
        if (!wv) return "Error: No active webview";

        try {
            this.activeMenu = 'ai-browser'; // Switch to the AI Browser menu
            switch (type) {
                case 'url':
                    if (!url) return "Error: URL is required";
                    this.navigateTo(url);
                    return "Navigating to " + url;
                case 'back':
                    if (wv.canGoBack()) {
                        wv.goBack();
                        return "Navigated Back";
                    }
                    return "Error: Cannot go back";
                case 'forward':
                    if (wv.canGoForward()) {
                        wv.goForward();
                        return "Navigated Forward";
                    }
                    return "Error: Cannot go forward";
                case 'reload':
                    if (ignoreCache) wv.reloadIgnoringCache();
                    else wv.reload();
                    return "Reloaded";
                default:
                    // Default to URL navigation
                    if (url) {
                        this.navigateTo(url);
                        return "Navigated to " + url;
                    }
                    return "Error: Unknown navigation type";
            }
        } catch (e) {
            return "Navigation Exception: " + e.message;
        }
    },

    // ===============================================
    // Python-Agent-specific interface (stable JS-injection version)
    // ===============================================

    // --- 0. Human-like delay helper ---
    async _humanDelay() {
        // Random delay 100ms to 1000ms (0.1s - 1s)
        const delay = Math.floor(Math.random() * 900) + 100;
        await new Promise(resolve => setTimeout(resolve, delay));
    },

    // --- 1. Snapshot disguised as an A11y tree (no delay; the faster the read, the better) ---
    async getWebviewSnapshot(verbose = false) {
        const wv = this.getWebview();
        if (!wv) return "Error: No active webview";
        if (wv.isLoading()) return "Error: Page is loading...";

        const script = `
        (function() {
            try {
                if (!window._ai_uid_counter) window._ai_uid_counter = 1;
                const interactiveSelector = 'a, button, input, textarea, select, details, label, summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [onclick]';
                
                function isVisible(el) {
                    const style = window.getComputedStyle(el);
                    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && el.offsetWidth > 0;
                }

                function getSafeText(el) {
                    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
                    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return el.value || el.getAttribute('placeholder') || '';
                    if (el.tagName === 'SELECT') return el.options[el.selectedIndex]?.text || '';
                    return el.innerText ? el.innerText.slice(0, 50).replace(/[\\r\\n]+/g, ' ').trim() : '';
                }

                function getRole(el) {
                    if (el.getAttribute('role')) return el.getAttribute('role');
                    return el.tagName.toLowerCase();
                }

                const elements = document.querySelectorAll(interactiveSelector);
                const lines = [];

                elements.forEach(el => {
                    if (!isVisible(el)) return;
                    let uid = el.getAttribute('data-ai-id');
                    if (!uid) {
                        uid = 'ai-' + window._ai_uid_counter++;
                        el.setAttribute('data-ai-id', uid);
                    }
                    const role = getRole(el);
                    const name = getSafeText(el);
                    const value = (el.value && el.value !== name) ? el.value : '';
                    
                    let line = \`[\${uid}] \${role}\`;
                    if (name) line += \` "\${name}"\`;
                    if (value) line += \` Value: "\${value}"\`;

                    lines.push(line);
                });

                if (lines.length === 0) return "Page empty or no interactive elements found.";
                return lines.join('\\n');
            } catch (e) {
                return "Snapshot Script Error: " + e.message;
            }
        })()
        `;
        
        try {
            return await wv.executeJavaScript(script);
        } catch (e) {
            return "Vue Snapshot Error: " + e.message;
        }
    },

    // --- 2. Click (with delay) ---
    async webviewClick(uid, dblClick = false) {
        const wv = this.getWebview();
        if (!wv) return "Error: No active webview";
        wv.focus();
        const script = `
        (async function() {
            const el = document.querySelector('[data-ai-id="${uid}"]');
            if (!el) return "Element not found: ${uid}";
            
            // 1. 滚动到可见 (平滑滚动更像人)
            el.scrollIntoView({behavior: "smooth", block: "center", inline: "center"});
            
            // 等待一小会儿让滚动完成
            await new Promise(r => setTimeout(r, 200));

            // 2. 计算随机坐标 (核心改进)
            const rect = el.getBoundingClientRect();
            // 不点边缘，只在中心 80% 区域内随机
            // Math.random() - 0.5 生成 -0.5 到 0.5 的数
            const randomX = (Math.random() - 0.5) * (rect.width * 0.8); 
            const randomY = (Math.random() - 0.5) * (rect.height * 0.8);
            
            // 加上 rect.left 等于视口绝对坐标，加上 rect.width/2 等于中心点
            // clientX/Y 是相对于视口的
            const clientX = rect.left + (rect.width / 2) + randomX;
            const clientY = rect.top + (rect.height / 2) + randomY;

            // 3. 构造事件对象 (带真实坐标)
            const opts = { 
                bubbles: true, 
                cancelable: true, 
                view: window, 
                buttons: 1,
                clientX: clientX,
                clientY: clientY,
                screenX: clientX + window.screenX, // 模拟屏幕坐标
                screenY: clientY + window.screenY
            };

            // 4. 触发完整的事件链
            el.dispatchEvent(new MouseEvent('mouseover', opts));
            el.dispatchEvent(new MouseEvent('mousedown', opts));
            // 鼠标按下和抬起之间极短的停顿
            await new Promise(r => setTimeout(r, Math.floor(Math.random() * 50) + 10)); 
            el.dispatchEvent(new MouseEvent('mouseup', opts));
            el.dispatchEvent(new MouseEvent('click', opts));
            
            if (${dblClick}) {
                el.dispatchEvent(new MouseEvent('dblclick', opts));
            }
            return "Clicked " + "${uid}";
        })()
        `;
        
        try {
            const result = await wv.executeJavaScript(script);
            // A large post-action delay (simulating thinking about the next step)
            await this._humanDelay();
            return result;
        } catch (e) {
            return "Click Error: " + e.message;
        }
    },

    // --- 3. Type (with delay) ---
    async webviewFill(uid, value) {
        const wv = this.getWebview();
        if (!wv) return "Error: No active webview";
        wv.focus();
        // Note: the value needs to be passed to JS here; use JSON.stringify for safety
        const script = `
        (async function() {
            const el = document.querySelector('[data-ai-id="${uid}"]');
            if (!el) return "Element not found: ${uid}";
            
            el.focus();
            
            const text = ${JSON.stringify(value)};
            
            // 获取原生 Setter (解决 React/Vue 无法监听 js 赋值的问题)
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
            
            // 清空现有内容 (如果需要追加模式，可以去掉这行)
            if (nativeInputValueSetter) {
                nativeInputValueSetter.call(el, '');
            } else {
                el.value = '';
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));

            // ★ 核心：逐字输入循环
            for (let i = 0; i < text.length; i++) {
                const char = text[i];
                
                // 1. 模拟按键按下 (keydown)
                el.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
                el.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));

                // 2. 更新值 (模拟输入进去的效果)
                const currentVal = el.value + char;
                if (nativeInputValueSetter && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
                    nativeInputValueSetter.call(el, currentVal);
                } else {
                    el.value = currentVal;
                }

                // 3. 触发 input 事件 (让框架知道值变了)
                el.dispatchEvent(new InputEvent('input', { data: char, inputType: 'insertText', bubbles: true }));
                
                // 4. 模拟按键抬起 (keyup)
                el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));

                // ★ 5. 随机打字延迟 (30ms - 150ms)
                // 模拟人打字忽快忽慢
                const delay = Math.floor(Math.random() * 120) + 30;
                await new Promise(r => setTimeout(r, delay));
            }

            // 完成后的 change 事件
            el.dispatchEvent(new Event('change', { bubbles: true }));
            
            // 稍微停顿后失焦
            await new Promise(r => setTimeout(r, 200));
            el.blur();

            return "Filled " + "${uid}";
        })()
        `;
        
        try {
            const result = await wv.executeJavaScript(script);
            // A large post-action delay
            await this._humanDelay();
            return result;
        } catch (e) {
            return "Fill Error: " + e.message;
        }
    },

    // --- 4. Batch form-fill (with delay) ---
    async webviewFillForm(elements) {
        const wv = this.getWebview();
        if (!wv) return "Error: No active webview";
        wv.focus();
        const dataStr = JSON.stringify(elements); 

        const script = `
        (function() {
            const items = ${dataStr};
            const log = [];
            items.forEach(item => {
                const el = document.querySelector('[data-ai-id="' + item.uid + '"]');
                if (el) {
                    el.focus();
                    el.value = item.value;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    log.push(item.uid);
                }
            });
            return "Filled elements: " + log.join(', ');
        })()
        `;
        
        const result = await wv.executeJavaScript(script);
        
        // Wait after the batch operation
        await this._humanDelay();
        
        return result;
    },

    // --- 5. Drag (with delay) ---
    async webviewDrag(fromUid, toUid) {
        const wv = this.getWebview();
        if (!wv) return "Error: No active webview";
        wv.focus();
        const script = `
        (function() {
            const src = document.querySelector('[data-ai-id="${fromUid}"]');
            const tgt = document.querySelector('[data-ai-id="${toUid}"]');
            if (!src || !tgt) return "Elements not found";

            const srcRect = src.getBoundingClientRect();
            const tgtRect = tgt.getBoundingClientRect();
            const clientX = srcRect.left + srcRect.width / 2;
            const clientY = srcRect.top + srcRect.height / 2;
            const targetX = tgtRect.left + tgtRect.width / 2;
            const targetY = tgtRect.top + tgtRect.height / 2;

            const emit = (type, x, y) => {
                const ev = new MouseEvent(type, { 
                    bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, buttons: 1 
                });
                (type === 'mouseup' ? tgt : src).dispatchEvent(ev);
            };

            emit('mousedown', clientX, clientY);
            emit('mousemove', clientX + 5, clientY + 5); 
            emit('mousemove', targetX, targetY);         
            emit('mouseup', targetX, targetY);           

            return "Dragged " + "${fromUid}" + " to " + "${toUid}";
        })()
        `;
        
        const result = await wv.executeJavaScript(script);
        
        // Dragging is a large motion, so the wait can be a bit longer (reuses the random wait here)
        await this._humanDelay();
        
        return result;
    },

    // --- 6. Hover (with delay) ---
    async webviewHover(uid) {
        const wv = this.getWebview();
        if (!wv) return "Error: No active webview";
        wv.focus();
        const script = `
        (function() {
            const el = document.querySelector('[data-ai-id="${uid}"]');
            if (!el) return "Element not found";
            el.scrollIntoView({block: "center"});
            el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            return "Hovered " + "${uid}";
        })()
        `;
        
        const result = await wv.executeJavaScript(script);
        
        // Hovering is usually to look at something, so a short wait is reasonable
        await this._humanDelay();
        
        return result;
    },

    // --- 8. Handle dialogs (no delay) ---
    async webviewHandleDialog(action, promptText) {
        // ... (code unchanged; dialog handling is usually instantaneous) ...
        const wv = this.getWebview();
        if (!wv) return "Error: No active webview";
        wv.focus();
        const script = `
        (function() {
            window.__ai_dialog_action = "${action}"; 
            window.__ai_dialog_text = ${JSON.stringify(promptText || "")};
            window.alert = function() { return true; };
            window.confirm = function() { return window.__ai_dialog_action === 'accept'; };
            window.prompt = function() { return window.__ai_dialog_action === 'accept' ? window.__ai_dialog_text : null; };
            return "Dialog handlers patched";
        })()
        `;
        return await wv.executeJavaScript(script);
    },

    // --- 9. Key press (with delay) ---
    async webviewPressKey(keyCombo, uid) {
        const wv = this.getWebview();
        if (!wv) return "Error: No active webview";
        wv.focus();

        // 1. Get the element's coordinates (JS just tells us where it is)
        const rectScript = `
        (function() {
            const el = document.querySelector('[data-ai-id="${uid}"]');
            if (!el) return null;
            
            // 滚动到屏幕中间
            el.scrollIntoView({behavior: "auto", block: "center", inline: "center"});
            
            // 获取相对于视口的精确坐标
            const rect = el.getBoundingClientRect();
            return {
                x: rect.left + (rect.width / 2),
                y: rect.top + (rect.height / 2)
            };
        })()
        `;

        try {
            const rect = await wv.executeJavaScript(rectScript);
            if (!rect) return "Element not found: " + uid;

            // Key fix: use sendInputEvent to send a real mouse click
            // This forces the OS to move focus to the input box under that coordinate
            // Note: x, y are relative to the webview's top-left corner
            
            // 1. Move and press the mouse
            wv.sendInputEvent({ 
                type: 'mouseDown', 
                x: rect.x, 
                y: rect.y, 
                button: 'left', 
                clickCount: 1 
            });
            
            // 2. Release the mouse (completing the click)
            wv.sendInputEvent({ 
                type: 'mouseUp', 
                x: rect.x, 
                y: rect.y, 
                button: 'left', 
                clickCount: 1 
            });

            // Wait for the click to take effect and the input box to activate its cursor
            await new Promise(r => setTimeout(r, 400));

            // 3. Handle the key press
            const parts = keyCombo.split('+').map(k => k.trim());
            let key = parts.pop(); 
            const modifiers = parts.map(m => m.toLowerCase());
            
            if (key.toLowerCase() === 'enter') key = 'Enter';

            // 4. Send the native key press
            // Simulate key-down
            wv.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers });
            
            // Add the char event: the Enter key often needs an accompanying char code 13 (\r)
            // Many pages (especially older ones or React-wrapped) rely on this char event to trigger form submission
            if (key === 'Enter') {
                wv.sendInputEvent({ type: 'char', keyCode: '\r', modifiers });
            } else if (key.length === 1) {
                wv.sendInputEvent({ type: 'char', keyCode: key, modifiers });
            }

            // Simulate the hold pause
            await new Promise(r => setTimeout(r, Math.floor(Math.random() * 50) + 30));

            // Simulate key-up
            wv.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers });
            
            await this._humanDelay();
            
            return "Pressed (Native) " + keyCombo + " on " + uid;
        } catch (e) {
            return "PressKey Error: " + e.message;
        }
    },

    // --- 10. Wait for text (no delay; this is a polling operation) ---
    async webviewWaitFor(text, timeout) {
        const wv = this.getWebview();
        if (!wv) return "Error: No active webview";
        
        const script = `
        (function() {
            return new Promise((resolve) => {
                const start = Date.now();
                const check = () => {
                    // 1. 优先检查文本是否存在
                    if (document.body.innerText.includes(${JSON.stringify(text)})) {
                        resolve("Found: " + ${JSON.stringify(text)});
                    } 
                    // 2. 检查是否超时
                    else if (Date.now() - start > ${timeout}) {
                        // 3. 关键修改：超时后，检查页面加载状态
                        if (document.readyState === 'complete') {
                            // 页面已加载完毕，但文本未找到
                            resolve("Page loaded");
                        } else {
                            // 页面还在加载中，且超时
                            resolve("Timeout waiting for text");
                        }
                    } 
                    // 4. 继续轮询
                    else {
                        setTimeout(check, 100);
                    }
                };
                check();
            });
        })()
        `;
        return await wv.executeJavaScript(script);
    },

    // --- 11. Screenshot (no delay) ---
    async captureWebviewScreenshot(fullPage = false, uid = null) {
        const wv = this.getWebview();
        if (!wv) return "Error: No active webview";
        wv.focus();
        try {
            // 1. Scroll (if an element is specified)
            if (uid) {
                await this.webviewClick(uid);
                await this._humanDelay();
            }

            // 2. Capture the page
            const image = await wv.capturePage();

            // 3. Scale down (the AI doesn't need 4K; 1280 wide is enough and saves tokens)
            const size = image.getSize();
            let resized = image;
            if (size.width > 1280) {
                resized = image.resize({ width: 1280 });
            }

            // 4. Convert to a JPEG Buffer (quality 70)
            const buffer = resized.toJPEG(70);

            // 5. Call the main process to save the file
            // Note: transferring a Buffer over IPC is very fast, much faster than a Base64 string
            const filename = await window.electronAPI.saveScreenshotDirect(buffer);
            
            // 6. Build the URL
            // window.electron.server.port is the backend port exposed in preload
            const host = window.electron.server.host || '127.0.0.1';
            const port = window.electron.server.port || 3456;
            
            const fileUrl = `http://${host}:${port}/uploaded_files/${filename}`;
            
            return fileUrl;

        } catch (e) {
            return "Screenshot Error: " + e.message;
        }
    },
    
    // --- 12. Generic JS execution (with delay) ---
    async executeInActiveWebview(codeStr, args = []) {
        const wv = this.getWebview();
        if (!wv) return "Error: No active webview";
        wv.focus();
        try {
            const script = `(${codeStr})(...${JSON.stringify(args || [])})`;
            const result = await wv.executeJavaScript(script);
            
            // Wait after custom-script execution too, to prevent the agent from calling rapidly in succession
            await this._humanDelay();

            if (result === undefined) return "undefined";
            if (result === null) return "null";
            if (typeof result === 'object') return JSON.stringify(result);
            return String(result);

        } catch (e) {
            return "JS Execution Error: " + e.message;
        }
    },
    getFaviconUrl(tab) {
      // 1. Use what the browser already provides
      if (tab.favicon) return tab.favicon;

      // 2. Use Chrome's official 'easter-egg' API, zero cost
      //    Note: this API needs no extra permissions and triggers no network request; it just reads the cache
      if (chrome && chrome.tabs && typeof chrome.tabs.get === 'function') {
        // Read the cache synchronously; no error if it can't be read
        try {
          const url = new URL(tab.url);
          return `chrome://favicon/size/16@2x/${url.origin}`;
        } catch (_) {}
      }

      // 3. Fallback: construct the most likely address
      try {
        const u = new URL(tab.url);
        return `${u.origin}/favicon.ico`;
      } catch (_) {}

      // 4. If there's really nothing, use an empty string
      return '';
    },

    // Toggle the current tab's bookmark state
    toggleFavorite(tab) {
        if (!tab || !tab.url) return;

        const index = this.favorites.findIndex(f => f.url === tab.url);
        if (index !== -1) {
            // Already exists -> remove
            this.favorites.splice(index, 1);
            showNotification(this.t('favoriteRemoved') || 'Favorite removed', 'info');
        } else {
            // Doesn't exist -> add
            this.favorites.push({
                title: tab.title || 'New Tab',
                url: tab.url,
                favicon: this.getFaviconUrl(tab)
            });
            showNotification(this.t('favoriteAdded') || 'Favorite added', 'success');
        }
        this.saveFavorites();
    },

    // Remove a specific bookmark from the grid
    removeFavorite(url) {
        const index = this.favorites.findIndex(f => f.url === url);
        if (index !== -1) {
            this.favorites.splice(index, 1);
            this.saveFavorites();
        }
    },

    // When a bookmark icon is clicked, load the URL in the current tab
    loadUrlInCurrentTab(url) {
        if (this.currentTab) {
            // Update the current tab's URL
            this.currentTab.url = url;
            // Update the address-bar input display
            this.urlInput = url; 
            // Trigger the loading state (if your webview logic depends on it)
            this.currentTab.isLoading = true;
        } else {
            // If there's no current tab, create a new one
            this.addNewTab(url);
        }
    },

    // Persist: save bookmarks to local storage
    saveFavorites() {
        try {
            localStorage.setItem('browser_favorites', JSON.stringify(this.favorites));
            // Save the display-state config
            localStorage.setItem('browser_show_favorites', JSON.stringify(this.showFavorites));
        } catch (e) {
            console.error('Failed to save favorites:', e);
        }
    },

    // Persist: load from local storage
    loadFavorites() {
        try {
            const storedFavs = localStorage.getItem('browser_favorites');
            if (storedFavs) {
                this.favorites = JSON.parse(storedFavs);
            }
            
            const storedShow = localStorage.getItem('browser_show_favorites');
            if (storedShow !== null) {
                this.showFavorites = JSON.parse(storedShow);
            }
        } catch (e) {
            console.error('Failed to load favorites:', e);
        }
    },

    openBrainEdit(brainKey) {
      this.currentEditingKey = brainKey;
      this.showBrainEditDialog = true;
    },
    handleFirecrawlPresetChange(val) {
      if (val === 'official') {
        this.webSearchSettings.firecrawl_url = 'https://api.firecrawl.dev/v2';
      } else {
        this.webSearchSettings.firecrawl_url = 'http://localhost:3002/v1';
      }
      this.autoSaveSettings();
    },

// Methods

// 1. Get the skill list
async fetchSkills() {
  try {
    const response = await fetch('/api/skills/list');
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    const data = await response.json();
    this.skillsList = data.skills;
  } catch (error) {
    showNotification(this.t('fetchSkillsFailed'), 'error');
  }
},

// 2. Delete a skill
async removeSkill(id) {
  try {
    const response = await fetch(`/api/skills/${id}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      throw new Error('Delete failed');
    }
    
    showNotification(this.t('deleteSuccess'), 'success');
    this.fetchSkills(); // Refresh
  } catch (error) {
    showNotification(this.t('deleteFailed'), 'error');
  }
},

// 3. GitHub install
async installSkillFromGithub() {
  if (!this.newSkillUrl) return;
  this.isSkillInstalling = true;
  showNotification(this.t('waitSkillInstall'), 'success');
  try {
    const response = await fetch('/api/skills/install-from-github', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: this.newSkillUrl
      })
    });

    if (!response.ok) {
      // Try to parse the JSON error message returned by the backend
      const errorData = await response.json().catch(() => ({})); 
      const errorMessage = errorData.detail || response.statusText || 'Unknown Error';
      throw new Error(errorMessage);
    }

    showNotification(this.t('installSuccess'), 'success');
    this.showAddSkillDialog = false;
    this.newSkillUrl = '';
    // Refresh after a slight delay; it's a background task but may finish quickly
    setTimeout(() => this.fetchSkills(), 2000);
  } catch (error) {
    showNotification(this.t('installFailed') + ': ' + error.message, 'error');
  } finally {
    this.isSkillInstalling = false;
  }
},

// 4. When the DIV is clicked, simulate clicking the hidden input
triggerSkillFileSelect() {
  // Note: with Vue 3 <script setup>, you'd need const skillFileInput = ref(null) and skillFileInput.value.click()
  // If using the Options API (export default):
  this.$refs.skillFileInput.click();
},

// 5. Handle the file change after 'click to select'
handleSkillFileChange(e) {
  const files = e.target.files;
  if (files && files.length > 0) {
    this.processSkillUpload(files[0]);
  }
  // Clear the input so selecting the same file can trigger change again
  e.target.value = ''; 
},

// 6. Handle the file after 'drag and drop'
handleSkillDrop(e) {
  const files = e.dataTransfer.files;
  if (files && files.length > 0) {
    this.processSkillUpload(files[0]);
  }
},

// 7. Unified upload logic (core)
async processSkillUpload(file) {
  // Validate the file type
  if (!file.name.toLowerCase().endsWith('.zip')) {
    // The original ElMessage.error here was changed to showNotification
    showNotification(this.t('skillZipNote'), 'error'); 
    return;
  }

  this.isUploading = true; // Show the overlay

  const formData = new FormData();
  formData.append('file', file);

  try {
    const response = await fetch('/api/skills/upload-zip', {
      method: 'POST',
      body: formData
      // Note: when sending FormData with fetch, never set Content-Type manually!
      // The browser auto-computes the boundary and sets multipart/form-data
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || this.t('installFailed'));
    }

    showNotification(this.t('installSuccess'), 'success');
    this.showAddSkillDialog = false;
    this.fetchSkills(); // Refresh the list
  } catch (error) {
    showNotification(error.message, 'error');
  } finally {
    this.isUploading = false; // Hide the overlay
  }
},

isSkillInProject(skillId) {
  return this.skillsInProject && this.skillsInProject.includes(skillId);
},

    // 1. Upgrade fetching the project status: also save the detailed info
    async fetchProjectSkillsStatus() {
      if (!this.CLISettings.cc_path) {
        this.skillsInProject = [];
        this.projectSkillsDetails = [];
        return;
      }
      try {
        const res = await fetch(`/api/skills/project-status?path=${encodeURIComponent(this.CLISettings.cc_path)}`);
        if (res.ok) {
          const data = await res.json();
          this.skillsInProject = data.installed_ids || [];
          this.projectSkillsDetails = data.project_skills || []; // Store the details
        }
      } catch (e) {
        console.error("获取项目技能状态失败", e);
      }
    },

    // 2. Reverse sync: from project -> global
    async syncToGlobal(skillId) {
      try {
        const response = await fetch('/api/skills/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skill_id: skillId, project_path: this.CLISettings.cc_path, action: 'sync_to_global' })
        });
        const data = await response.json();
        if (response.ok && data.status === 'success') {
          showNotification('Skill synced to Global', 'success');
          this.fetchSkills(); // Just refresh the global state
        } else {
          throw new Error(data.detail || 'Sync failed');
        }
      } catch (e) {
        showNotification(e.message, 'error');
      }
    },

    // 3. Forward sync: from global -> project (original logic, slightly simplified)
    async syncToProject(skillId) {
      if (!this.CLISettings.cc_path) return;
      try {
        const response = await fetch('/api/skills/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skill_id: skillId, project_path: this.CLISettings.cc_path, action: 'install' })
        });
        if (response.ok) {
          showNotification('Skill synced to Workspace', 'success');
          this.fetchProjectSkillsStatus(); // Refresh the project state
        } else {
          throw new Error('Sync failed');
        }
      } catch (e) {
        showNotification(e.message, 'error');
      }
    },

    // 4. Delete from global (smart prompt)
    async removeGlobalSkill(skill) {
      const execDelete = async () => {
        try {
          const response = await fetch(`/api/skills/${encodeURIComponent(skill.id)}`, { method: 'DELETE' });
          if (response.ok) {
            showNotification('Removed globally', 'success');
            await this.fetchSkills(); 
          } else {
            throw new Error('Remove failed');
          }
        } catch (e) {
          showNotification(e.message, 'error');
        }
      };

      // Core check: if it's gone from the project too, this is a full deletion, so warn!
      if (!skill.isProject) {
        this.$confirm(this.t('deleteSkillConfirm'), this.t('warning'), { type: 'warning' })
          .then(execDelete).catch(() => {});
      } else {
        // Still present in the project, so it's a safe operation; delete silently
        execDelete();
      }
    },

    // 5. Delete from project (smart prompt)
    async removeProjectSkill(skill) {
      const execDelete = async () => {
        try {
          const response = await fetch('/api/skills/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ skill_id: skill.id, project_path: this.CLISettings.cc_path, action: 'remove' })
          });
          if (response.ok) {
            showNotification('Removed from Workspace', 'success');
            await this.fetchProjectSkillsStatus(); 
          } else {
            throw new Error('Remove failed');
          }
        } catch (e) {
          showNotification(e.message, 'error');
        }
      };

      // Core check: if it's gone from global too, this is a full deletion, so warn!
      if (!skill.isGlobal) {
        this.$confirm(this.t('confirmDeleteSkillFile'), this.t('warning') || 'Warning', { type: 'warning' })
          .then(execDelete).catch(() => {});
      } else {
        // Still present globally, so it's a safe operation; delete silently
        execDelete();
      }
    },

// Toggle the skill-sync state
async toggleSkillInProject(skillId, isInstall) {
  if (!this.CLISettings.cc_path) return;

  const action = isInstall ? 'install' : 'remove';
  try {
    const response = await fetch('/api/skills/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skill_id: skillId,
        project_path: this.CLISettings.cc_path,
        action: action
      })
    });

    if (!response.ok) throw new Error('Sync failed');

    // Update the local state list
    if (isInstall) {
      if (!this.skillsInProject.includes(skillId)) this.skillsInProject.push(skillId);
    } else {
      this.skillsInProject = this.skillsInProject.filter(id => id !== skillId);
    }
    
    showNotification(this.t('operationSuccess'), 'success');
  } catch (error) {
    showNotification(this.t('operationFailed'), 'error');
    // Refresh the state to roll back the UI toggle
    this.fetchProjectSkillsStatus();
  }
},

// --- Enhance the original watchers and initialization ---

// Modify handleSkillsPolling to also refresh the project state when entering the skills tab
handleSkillsPolling(activeMenu, menu, tab) {
  if (activeMenu === 'toolkit' && menu === 'CLI' && tab === 'skills') {
    this.fetchProjectSkillsStatus(); // Run this extra step
    this.startSkillsPolling();
  } else {
    this.stopSkillsPolling();
  }
},

  // Start polling
  startSkillsPolling() {
    if (this.skillsPollingTimer) return; // If already polling, don't start again
    
    // Run once immediately; don't wait the first 5 seconds
    this.fetchSkills(); 

    // Run once every 5 seconds
    this.skillsPollingTimer = setInterval(() => {
      console.log('正在轮询获取 Skills...');
      this.fetchSkills();
    }, 5000);
  },

  // Stop polling
  stopSkillsPolling() {
    if (this.skillsPollingTimer) {
      clearInterval(this.skillsPollingTimer);
      this.skillsPollingTimer = null;
      console.log('已停止轮询 Skills');
    }
  },
// Core logic: decide and control the extension-page polling
  handleExtensionsPolling(menu, sub) {
    if (menu === 'api-group' && sub === 'extension') {
      this.startExtensionsPolling();
    } else {
      this.stopExtensionsPolling();
    }
  },

  // Start extension polling
  startExtensionsPolling() {
    if (this.extensionsPollingTimer) return;
    
    // Run a refresh immediately
    this.scanExtensions(); 

    this.extensionsPollingTimer = setInterval(() => {
      console.log('正在轮询获取 Extensions...');
      this.scanExtensions();
    }, 5000);
  },

  // Stop extension polling
  stopExtensionsPolling() {
    if (this.extensionsPollingTimer) {
      clearInterval(this.extensionsPollingTimer);
      this.extensionsPollingTimer = null;
      console.log('已停止轮询 Extensions');
    }
  },

  // Refresh the extension list, then compare version states afterward
  async scanExtensions() {
    try {
      const response = await fetch('/api/extensions/list');
      if (!response.ok) throw new Error('Fetch failed');
      const data = await response.json();
      this.extensions = data.extensions;
      
      // Sync the 'installed' and 'updatable' states between local and remote
      this.syncExtensionUpdateStatus();
    } catch (e) {
      console.error('刷新扩展列表失败', e);
    }
  },
  
  // Helper: compare local and remote, syncing the update states
  syncExtensionUpdateStatus() {
    if (!this.extensions || !this.remotePlugins) return;

    // 1. Iterate the remote list, marking the 'installed' and 'hasUpdate' states
    this.remotePlugins = this.remotePlugins.map(r => {
      const local = this.extensions.find(l => 
          (l.repository && r.repository && l.repository.trim().toLowerCase() === r.repository.trim().toLowerCase()) || 
          (l.id && r.id && l.id === r.id)
      );
      let installed = !!local;
      let hasUpdate = false;
      
      if (local && local.version && r.version) {
        if (this.compareVersions(local.version, r.version) < 0) {
          hasUpdate = true;
        }
      }
      return { ...r, installed, hasUpdate };
    });

    // 2. Iterate the local list, marking the 'hasUpdate' state
    this.extensions = this.extensions.map(l => {
      const remote = this.remotePlugins.find(r => 
          (l.repository && r.repository && l.repository.trim().toLowerCase() === r.repository.trim().toLowerCase()) || 
          (l.id && r.id && l.id === r.id)
      );
      let hasUpdate = false;
      if (remote && l.version && remote.version) {
        if (this.compareVersions(l.version, remote.version) < 0) {
          hasUpdate = true;
        }
      }
      return { ...l, hasUpdate };
    });
  },

  // Helper: semantic version comparison
  compareVersions(v1, v2) {
    if (!v1 || !v2) return 0;
    const parts1 = v1.toString().replace(/[^0-9.]/g, '').split('.').map(Number);
    const parts2 = v2.toString().replace(/[^0-9.]/g, '').split('.').map(Number);
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const num1 = parts1[i] || 0;
      const num2 = parts2[i] || 0;
      if (num1 < num2) return -1;
      if (num1 > num2) return 1;
    }
    return 0;
  },
// Preview the skill
async previewSkill(id) {
  this.showSkillPreviewDialog = true;
  this.skillPreviewLoading = true;
  this.renderedSkillContent = '';

  try {
    const response = await fetch(`/api/skills/${id}/content`);
    if (!response.ok) throw new Error('Fetch failed');
    const data = await response.json();
    let rawContent = data.content || '';

    // 1. Strip the YAML frontmatter (--- ... ---)
    // So the preview doesn't show redundant metadata
    const yamlRegex = /^---\s*\n([\s\S]*?)\n---\s*\n?/;
    const contentToRender = rawContent.replace(yamlRegex, '');

    // 2. Render using your existing md instance
    // Note: this calls md.render directly.
    // If you want logic identical to the chat box (including LaTeX, think-tag handling, etc.),
    // you can call your this.formatMessage(contentToRender)
    this.renderedSkillContent = this.formatMessage(contentToRender);

  } catch (error) {
    showNotification(this.t('fetchFailed'), 'error');
    this.showSkillPreviewDialog = false;
  } finally {
    this.skillPreviewLoading = false;
  }
},

  handleRemoteMCPInstall(data) {
    console.log('handleRemoteMCPInstall', data);

    // 1. Auto-switch the route/menu to the MCP-management page
    this.activeMenu = 'toolkit'; 
    this.subMenu = 'mcp';

    // 2. Initialize the dialog state to 'add mode'
    this.isEditMode = false;
    this.activeDialogTab = 'config'; // Show the config tab by default
    
    if (data.mcpType) {
        this.newMCPType = data.mcpType;
    } else {
        this.newMCPType = 'stdio'; // Default value
    }

    // 3. Set the input mode to JSON (since what comes from remote is usually a full config object)
    this.mcpInputType = 'json';
    this.updateMCPExample(); // Update the example config
    // data now contains { type: 'mcp', config: '...', repo: null }
    let configStr = data.config;
    
    // 1. Try decoding (since the main process sends raw URL params, possibly still encoded)
    try {
      configStr = decodeURIComponent(configStr);
    } catch(e) {}

    this.newMCPJson = configStr; // Fill it into the text box
    this.showAddMCPDialog = true; // Popup
  },
// Add inside methods
async openSkillsFolder() {
  try {
    const response = await fetch('/api/skills/get_path', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    if (response.ok) {
      const data = await response.json();
      if (this.isElectron && data.path) {
        // Call the Electron API to open a local path
        window.electronAPI.openPath(data.path);
      }
    }
  } catch (error) {
    console.error("Failed to open skills folder:", error);
  }
},

async handleRefreshSkills() {
  this.skillsLoading = true;
  try {
    // Assumes you've defined a fetchSkills method to get the list
    await this.fetchSkills(); 
  } finally {
    this.skillsLoading = false;
  }
},

    // Open the edit/add dialog
    openBehaviorDialog(index) {
      this.currentBehaviorIndex = index;
      if (index === -1) {
        // Add mode: create a deep copy of the default template
        this.tempBehavior = this.createDefaultBehavior();
      } else {
        // Edit mode: create a deep copy of the existing data (cutting the reference)
        // Assumes your data is in behaviorSettings.behaviorList
        this.tempBehavior = JSON.parse(JSON.stringify(this.behaviorSettings.behaviorList[index]));
      }
      
      this.showBehaviorDialog = true;
    },

    // Create the default behavior template
    createDefaultBehavior() {
      return {
        enabled: true,
        trigger: {
          type: 'time',
          time: { timeValue: '08:00:00', days: [1, 2, 3, 4, 5] },
          noInput: { latency: 60 },
          cycle: { cycleValue: '00:30:00', repeatNumber: 1, isInfiniteLoop: true }
        },
        action: {
          type: 'prompt',
          prompt: '',
          random: { type: 'random', events: [''] }
        },
        platforms: ["chat"],  // New multi-select channel field (array of strings)
      };
    },

    // Cleanup after closing the dialog
    resetBehaviorDialogState() {
      this.tempBehavior = null;
      this.currentBehaviorIndex = -1;
    },

    // Save the behavior settings (add or update)
    saveBehavior() {
      if (!this.tempBehavior) return;

      // 1. Core fix: ensure the platforms field is always an array with values
      if (!Array.isArray(this.tempBehavior.platforms)) {
        // If there's no array, convert from the old single-select field, or use a default
        let oldVal = this.tempBehavior.platform || 'chat';
        this.tempBehavior.platforms = [oldVal];
      }
      
      // If the user selected none (empty array), force 'chat'
      if (this.tempBehavior.platforms.length === 0) {
        this.tempBehavior.platforms = ['chat'];
      }

      // 2. Sync the old platform field, taking the first array element
      this.tempBehavior.platform = this.tempBehavior.platforms[0];

      // 3. Save logic
      if (this.isEditingBehavior) {
        // Find and replace the old item
        const idx = this.behaviorSettings.behaviorList.findIndex(b => b === this.editingItemOrigin);
        if (idx !== -1) {
          this.behaviorSettings.behaviorList[idx] = JSON.parse(JSON.stringify(this.tempBehavior));
        }
      } else {
        // New item
        this.behaviorSettings.behaviorList.push(JSON.parse(JSON.stringify(this.tempBehavior)));
      }

      this.showBehaviorDialog = false;
      
      // 4. Refresh the timers after saving
      this.$nextTick(() => {
        this.resetCycleTimers();
      });
    },

    // Confirm deleting the behavior
    confirmRemoveBehavior(index) {
      this.$confirm(
        this.t('confirmDeleteBehavior') || 'Are you sure you want to delete this behavior?',
        this.t('warning') || 'Warning',
        {
          confirmButtonText: this.t('confirm'),
          cancelButtonText: this.t('cancel'),
          type: 'warning',
        }
      ).then(() => {
        this.removeBehavior(index);
      }).catch(() => {});
    },

    // Perform the deletion
    removeBehavior(index) {
      this.behaviorSettings.behaviorList.splice(index, 1);
      this.resetCycleTimers();
      this.autoSaveSettings();
    },

    // Handle the global-toggle change
    handleGlobalSwitchChange() {
      this.resetCycleTimers();
      this.autoSaveSettings();
    },

    // Handle a single behavior's toggle change
    handleBehaviorChange() {
      this.resetCycleTimers();
      this.autoSaveSettings();
    },

    // --- Helper methods inside the dialog (random events) ---

    // Add a temporary random-event entry
    addTempEvent() {
      if (this.tempBehavior && this.tempBehavior.action.random) {
        this.tempBehavior.action.random.events.push('');
      }
    },

    // Delete a temporary random-event entry
    removeTempEvent(eIdx) {
      if (this.tempBehavior && 
          this.tempBehavior.action.random && 
          this.tempBehavior.action.random.events.length > 1) {
        this.tempBehavior.action.random.events.splice(eIdx, 1);
      }
    },

    // --- UI-display helper methods ---

    // Return the icon class name based on the trigger type
    getTriggerIcon(type) {
      const map = {
        'time': 'fa-regular fa-clock',
        'noInput': 'fa-solid fa-hourglass-half',
        'cycle': 'fa-solid fa-arrows-spin'
      };
      return map[type] || 'fa-solid fa-bolt';
    },

    // Generate the summary text on the card
    getBehaviorSummary(b) {
      if (!b || !b.trigger) return '';
      
      if (b.trigger.type === 'time') {
        const time = b.trigger.time.timeValue;
        const days = b.trigger.time.days.length;
        const daysText = this.t('repeatDays') || 'Days'; // Simplified handling; actually depends on your t-function logic
        return `${time} (${daysText}: ${days})`;
      } else if (b.trigger.type === 'noInput') {
        return `${this.t('noInputLatency') || 'Latency'}: ${b.trigger.noInput.latency}s`;
      } else if (b.trigger.type === 'cycle') {
        const loopText = b.trigger.cycle.isInfiniteLoop ? '∞' : b.trigger.cycle.repeatNumber;
        return `${this.t('cycleValue') || 'Cycle'}: ${b.trigger.cycle.cycleValue} (x${loopText})`;
      }
      return '';
    },
  // Add a new event row
  addTempEvent() {
    if (this.tempBehavior && this.tempBehavior.action.random) {
      this.tempBehavior.action.random.events.push(''); // Add an empty string (i.e. an empty input box)
    }
  },

  // Delete the specified row
  removeTempEvent(index) {
    if (this.tempBehavior && this.tempBehavior.action.random) {
      // Check: if only one remains, don't allow deleting it (or remove this check to allow deleting all)
      if (this.tempBehavior.action.random.events.length > 1) {
        this.tempBehavior.action.random.events.splice(index, 1);
      } else {
        // If only one remains, clear its content instead of deleting the row
        this.tempBehavior.action.random.events[0] = '';
      }
    }
  },

    // Helper: generate an array of a numeric range
    makeRange(start, end) {
      const result = [];
      for (let i = start; i <= end; i++) {
        result.push(i);
      }
      return result;
    },

    // Disable hours
    disabledHours() {
      // Only need to disable when the minimum value's hour is greater than 0
      // If the minimum is 00:00:01, don't disable any hour
      return this.makeRange(0, 23).filter(h => h < this.minLimit.h);
    },

    // Disable minutes (selectedHour is the hour currently selected in the picker)
    disabledMinutes(selectedHour) {
      // Only restrict minutes when the selected hour equals the minimum value's hour
      if (selectedHour === this.minLimit.h) {
        return this.makeRange(0, 59).filter(m => m < this.minLimit.m);
      }
      return [];
    },

    // Disable seconds (selectedHour and selectedMinute are the currently selected hour and minute)
    disabledSeconds(selectedHour, selectedMinute) {
      // Only restrict seconds when both hour and minute are at the minimum-value boundary
      if (selectedHour === this.minLimit.h && selectedMinute === this.minLimit.m) {
        return this.makeRange(0, 59).filter(s => s < this.minLimit.s);
      }
      return [];
    },

    async probeDocker() {
      try {
        const res = await fetch('/api/docker/probe');
        const data = await res.json();
        this.dockerInstalled = data.installed;
      } catch (error) {
        console.error("Docker 探测失败:", error);
        this.dockerInstalled = false;
      }
    },

    // Open the task center
    openTaskCenter() {
        this.activeSideView = 'tasks';
        this.sidePanelURL = ''; // Ensure the iframe is closed
        this.currentExtension = null;
        this.showExtensionsDialog = false; // Close the dialog
        this.expandSidePanel();
        this.fetchTasks();
        // Start polling
        if (this.taskRefreshTimer) clearInterval(this.taskRefreshTimer);
        this.taskRefreshTimer = setInterval(this.fetchTasks, 3000);
    },
    openWorkspace() {
        this.activeSideView = 'workspace'
        this.sidePanelURL = ''; // Ensure the iframe is closed
        this.currentExtension = null;
        this.showExtensionsDialog = false; // Close the dialog
        this.expandSidePanel();
    },
    // Close the task center (return to the list)
    closeTaskCenter() {
        this.activeSideView = 'list';
        if (this.taskRefreshTimer) clearInterval(this.taskRefreshTimer);
    },

    // Get the task list
    async fetchTasks() {
        if (!this.hasWorkspacePath || !this.sidePanelOpen || this.activeSideView !== 'tasks') return;
        
        try {
            const res = await fetch(`/v1/tasks/list`);
            const data = await res.json();
            if (data.tasks) {
                this.taskList = data.tasks;
            }
        } catch (e) {
            console.error("Failed to fetch tasks", e);
        }
    },

    // Create a task
    async submitCreateTask() {
        if (!this.newTaskForm.title || !this.newTaskForm.description) {
            showNotification(this.t('fillRequired'), 'error');
            return;
        }

        this.isCreatingTask = true;
        try {
            console.log(this.newTaskForm); // Print the form data
            const res = await fetch(`/v1/tasks/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: this.newTaskForm.title,
                    description: this.newTaskForm.description,
                    agent_type: this.newTaskForm.agent_type,
                    task_type: this.newTaskForm.task_type,
                    platforms: this.newTaskForm.platforms,
                    trigger_config: this.newTaskForm.trigger_config // Send the full config
                })
            });
            const data = await res.json();
            
            if (data.success) {
                showNotification(this.t('success'));
                this.showCreateTaskDialog = false;
                // Reset the form
                this.newTaskForm = { 
                    title: '', description: '', task_type: 'once', agent_type: 'default',
                    trigger_config: { timeValue: '09:00:00', days: [1,2,3,4,5], cycleValue: '01:00:00', repeatNumber: 1, isInfiniteLoop: true }
                };
                this.fetchTasks();
            } else {
                showNotification(data.error, 'error');
            }
        } catch (e) {
            showNotification(this.t('networkError'), 'error');
        } finally {
            this.isCreatingTask = false;
        }
    },


    // Cancel the task
    async handleCancelTask(taskId) {
        try {
            await fetch(`/v1/tasks/cancel/${taskId}`, { method: 'POST' });
            showNotification(this.t('cancelSuccess') || '작업 취소 성공');
            this.fetchTasks();
        } catch (e) { console.error(e); }
    },

    // Delete the task
    async handleDeleteTask(taskId) {
        try {
            this.handleCancelTask(taskId);
            const res = await fetch(`/v1/tasks/${taskId}`, { 
                method: 'DELETE' 
            });
            
            if (res.ok) {
                showNotification(this.t('deleteSuccess') || '작업 삭제 성공');
                this.fetchTasks(); // Refresh the list
            } else {
                console.error("Delete failed with status:", res.status);
            }
        } catch (e) { 
            console.error("Network error during delete:", e); 
        }
    },

    // Jump to settings
    jumpToCLIConfig() {
        this.activeMenu = 'toolkit';
        this.subMenu = 'CLI';
    },

    formatTaskTime(isoStr) {
        if (!isoStr) return '-';
        const date = new Date(isoStr);
        return date.toLocaleString();
    },

    getTaskStatusType(status) {
        const map = {
            'pending': 'info',
            'running': 'primary',
            'completed': 'success',
            'failed': 'danger',
            'cancelled': 'warning'
        };
        return map[status] || 'info';
    },
  // Open the task-result dialog
// Inside the Vue component's methods
openTaskResult(task) {
    this.selectedTaskTitle = task.title;
    
    // 1. Get all historical output records for this task
    // If there's no history (e.g. an old task), fabricate a pseudo-record containing the current result
    const rawHistory = task.context?.results_history || [];
    
    if (rawHistory.length === 0 && task.result) {
        this.selectedTaskHistory = [{
            time: task.updated_at || task.created_at,
            result: task.result
        }];
    } else {
        // Sort the history in reverse order (newest on top)
        this.selectedTaskHistory = [...rawHistory].reverse();
    }
    
    // 2. Select the first item by default (i.e. the newest one)
    this.currentResultIdx = 0;
    
    // 3. Open the dialog
    this.showTaskResultDialog = true;
},
    
    getModeIcon(type) {
        const iconMap = {
            'once': 'fa-solid fa-bolt-lightning',
            'time': 'fa-regular fa-clock',
            'cycle': 'fa-solid fa-arrows-rotate'
        };
        // If type is empty or not in the map, return the default icon
        return iconMap[type] || 'fa-solid fa-terminal';
    },


    // Reset the form to its initial state
    resetTaskForm() {
        this.newTaskForm = {
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
        };
        this.isEditing = false;
        this.editingTaskId = null;
    },

    // Open the create window
    openCreateTaskDialog() {
        this.resetTaskForm(); // Ensure a clean slate before each creation
        this.showCreateTaskDialog = true;
    },

    openEditTaskDialog(task) {
        // 1. Reset first to clear any state left over from last time
        this.resetTaskForm();
        
        // 2. Mark as edit mode
        this.isEditing = true;
        this.editingTaskId = task.task_id;
        
        // 3. Fill in the basic data
        this.newTaskForm.title = task.title;
        this.newTaskForm.description = task.description;
        this.newTaskForm.platforms = task.platforms || [];
        this.newTaskForm.agent_type = task.agent_type || 'default';
        this.newTaskForm.task_type = task.context?.task_type || task.task_type || 'once';
        
        // 4. Fill in the trigger config
        const savedConfig = task.context?.trigger_config;
        if (savedConfig) {
            // Use assign or spread to ensure a reactive update
            Object.assign(this.newTaskForm.trigger_config, JSON.parse(JSON.stringify(savedConfig)));
        }
        
        this.showCreateTaskDialog = true;
    },

    // 2. Unified submit handler
    async submitTaskForm() {
        if (!this.newTaskForm.title || !this.newTaskForm.description) {
            showNotification(this.t('fillRequired'), 'error');
            return;
        }

        this.isCreatingTask = true;

        try {
            // In edit mode, stop and delete the old task first
            if (this.isEditing && this.editingTaskId) {
                // A. Stop the original task
                await fetch(`/v1/tasks/cancel/${this.editingTaskId}`, { method: 'POST' });
                // B. Delete the original task
                await fetch(`/v1/tasks/${this.editingTaskId}`, { method: 'DELETE' });
                console.log(`Old task ${this.editingTaskId} removed for re-creation`);
            }

            // C. Create the new task (both new creation and the 'rebuild' after editing use this endpoint)
            const res = await fetch(`/v1/tasks/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.newTaskForm)
            });
            const data = await res.json();
            
            if (data.success) {
                showNotification(this.t('success'));
                this.showCreateTaskDialog = false; // Close the window
                this.resetTaskForm();             // Reset the form after a successful submit
                this.fetchTasks();                // Refresh the list
            } else {
                showNotification(data.error, 'error');
            }
        } catch (e) {
            showNotification(this.t('networkError'), 'error');
        } finally {
            this.isCreatingTask = false;
            // Reset the edit state after submitting
            this.isEditing = false;
            this.editingTaskId = null;
        }
    },

    // 3. This reset function is called when the dialog closes (el-dialog's @closed event)
    resetTaskForm() {
        this.isEditing = false;
        this.editingTaskId = null;
        this.newTaskForm = {
            title: '', description: '', task_type: 'once', agent_type: 'default',
            trigger_config: { timeValue: '09:00:00', days: [1,2,3,4,5], cycleValue: '01:00:00', repeatNumber: 1, isInfiniteLoop: true }
        };
    },
// Open the detail page
openTaskDetailView(task) {
    this.viewingTaskDetail = task;
},

// Close the detail page and return to the list
closeTaskDetail() {
    this.viewingTaskDetail = null;
},

// Modify the fetchTasks method to add detail-sync logic
async fetchTasks() {
    if (!this.hasWorkspacePath || !this.sidePanelOpen || this.activeSideView !== 'tasks') return;
    
    try {
        const res = await fetch(`/v1/tasks/list`);
        const data = await res.json();
        if (data.tasks) {
            this.taskList = data.tasks;
            
            // Core logic: if a task's detail is currently being viewed, update it live
            if (this.viewingTaskDetail) {
                const updatedTask = data.tasks.find(t => t.task_id === this.viewingTaskDetail.task_id);
                if (updatedTask) {
                    this.viewingTaskDetail = updatedTask;
                }
            }
        }
    } catch (e) {
        console.error("Failed to fetch tasks", e);
    }
},

// Reset the task-center state (called on close)
closeTaskCenter() {
    this.activeSideView = 'list';
    this.viewingTaskDetail = null; // Clear the detail state
    if (this.taskRefreshTimer) clearInterval(this.taskRefreshTimer);
},

  // Handle the start-toggle click event
  handleEnableToggle(newValue) {
    // Only validate when the user tries to turn the toggle on (newValue === true)
    if (newValue === true) {
      // Check whether cc_path is empty
      if (!this.CLISettings.cc_path || this.CLISettings.cc_path.trim() === '') {
        
        // 1. Call the error function you provided 
        // This message uses the ready-made t('pleaseSelectWorkspaceFirst') from your template
        const errorMsg = this.t ? this.t('pleaseSelectWorkspaceFirst') : '먼저 Workspace 경로를 설정하세요';
        showNotification(errorMsg, 'error', 'Error');

        // 2. Force the toggle back to off (blocking startup)
        // Use $nextTick to ensure Vue updates the DOM correctly
        this.$nextTick(() => {
          this.CLISettings.enabled = false;
        });

        // 3. Intercept execution; return directly without triggering the subsequent save
        return; 
      }
    }

    // If validation passes (or the user is just turning the toggle off), run the original save logic normally
    this.autoSaveSettings();
  },

  handleVisionControlEnableToggle(newValue){
    if (newValue === true && this.visionSettings.enabled === true) {
      this.visionSettings.enabled = false;
      showNotification(this.t('autoDisableVisionSettings'), 'warning');
    }
    this.autoSaveSettings();
  },
  handleVisionEnableToggle(newValue){
    if (newValue === true && this.visionControlSettings.enabled === true) {
      this.visionControlSettings.enabled = false;
      showNotification(this.t('autoDisableVisionControlSettings'), 'warning');
    }
    this.autoSaveSettings();
  },

  handleWebSearchToggle(newValue) {
    if (newValue === true) {
      const settings = this.webSearchSettings;
      let errorMsg = '';

      // --- 1. Validate the search-engine config ---
      switch (settings.engine) {
        case 'searxng':
          if (!settings.searxng_url?.trim()) errorMsg = this.t('pleaseConfigSearxngUrl');
          break;
        case 'tavily':
          if (!settings.tavily_api_key?.trim()) errorMsg = this.t('pleaseConfigTavilyApiKey');
          break;
        case 'bing':
          if (!settings.bing_api_key?.trim()) errorMsg = this.t('pleaseConfigBingApiKey');
          else if (!settings.bing_search_url?.trim()) errorMsg = this.t('pleaseConfigBingSearchUrl');
          break;
        case 'google':
          if (!settings.google_api_key?.trim()) errorMsg = this.t('pleaseConfigGoogleApiKey');
          else if (!settings.google_cse_id?.trim()) errorMsg = this.t('pleaseConfigGoogleCseId');
          break;
        case 'brave':
          if (!settings.brave_api_key?.trim()) errorMsg = this.t('pleaseConfigBraveApiKey');
          break;
        case 'exa':
          if (!settings.exa_api_key?.trim()) errorMsg = this.t('pleaseConfigExaApiKey');
          break;
        case 'serper':
          if (!settings.serper_api_key?.trim()) errorMsg = this.t('pleaseConfigSerperApiKey');
          break;
        case 'bochaai':
          if (!settings.bochaai_api_key?.trim()) errorMsg = this.t('pleaseConfigBochaaiApiKey');
          break;
        // duckduckgo needs no mandatory config; let it through
      }

      // --- 2. Validate the web-parser config (assuming the search engine already passed) ---
      if (!errorMsg) {
        switch (settings.crawler) {
          case 'crawl4ai':
            if (!settings.Crawl4Ai_url?.trim()) errorMsg = this.t('pleaseConfigCrawl4aiUrl');
            break;
          case 'firecrawl':
            if (!settings.firecrawl_url?.trim()) errorMsg = this.t('pleaseConfigFirecrawlUrl');
            // If you think Firecrawl's API key should also be required, uncomment the line below:
            // else if (!settings.firecrawl_api_key?.trim()) errorMsg = this.t('pleaseConfigFirecrawlApiKey');
            break;
          
          // Note: the jina API key is optional, so there's no case 'jina' error logic here; let it through
          // simpleRequest and mdnew have no required fields either; let them through
        }
      }

      // --- 3. Interception and error reporting ---
      if (errorMsg) {
        // Show the error; the title is localized too
        const errorTitle = this.t ? this.t('configIncomplete') : 'Config Incomplete';
        showNotification(errorMsg, 'error', errorTitle);

        // Force the toggle back to off
        this.$nextTick(() => {
          this.webSearchSettings.enabled = false;
        });

        // Block execution; don't trigger the save
        return;
      }
    }

    // If all validation passes, or the user is turning the toggle off, run the save normally
    this.autoSaveSettings();
  },

  // Interception handling for the code-interpreter start toggle
  handleInterpreterToggle(newValue) {
    if (newValue === true) {
      const settings = this.codeSettings;
      let errorMsg = '';

      // Validate the required fields based on the selected engine
      switch (settings.engine) {
        case 'e2b':
          if (!settings.e2b_api_key?.trim()) {
            errorMsg = this.t('pleaseConfigE2bApiKey');
          }
          break;
        case 'sandbox':
          if (!settings.sandbox_url?.trim()) {
            errorMsg = this.t('pleaseConfigSandboxUrl');
          }
          break;
      }

      // If there's an error message, intercept
      if (errorMsg) {
        // Show the error (reuses the configIncomplete added earlier)
        const errorTitle = this.t ? this.t('configIncomplete') : 'Config Incomplete';
        showNotification(errorMsg, 'error', errorTitle);

        // Force the toggle back to off
        this.$nextTick(() => {
          this.codeSettings.enabled = false;
        });

        // Block execution; don't trigger the save
        return;
      }
    }

    // If validation passes or the toggle is being turned off, run the save normally
    this.autoSaveSettings();
  },
// 1. Lazy-load the file directory
  async loadWorkspaceNode(node, resolve) {
    // Top-level node: load the workspace root directory
    if (node.level === 0) {
      if (!this.CLISettings || !this.CLISettings.cc_path) {
        return resolve([]); 
      }
      
      // Brute-force trigger: as soon as the root node loads, start the watcher immediately!
      console.log('准备启动文件监听:', this.CLISettings.cc_path);
      this.setupWorkspaceWatcher(this.CLISettings.cc_path);

      try {
        const res = await window.electronAPI.readDirectory(this.CLISettings.cc_path);
        if (res.success) {
          return resolve(res.data);
        } else {
          this.$message?.error(this.t('readDirError') || '워크스페이스 디렉토리 읽기 실패: ' + res.error);
          return resolve([]);
        }
      } catch (error) {
        console.error(error);
        return resolve([]);
      }
    }

    // Child node: load the clicked subdirectory
    if (node.level > 0 && node.data.isDirectory) {
      try {
        const res = await window.electronAPI.readDirectory(node.data.path);
        if (res.success) {
          return resolve(res.data);
        } else {
          this.$message?.error(this.t('readDirError') || '하위 디렉토리 읽기 실패: ' + res.error);
          return resolve([]);
        }
      } catch (error) {
        console.error(error);
        return resolve([]);
      }
    }
    
    resolve([]);
  },

  // 2. Open the file with the system's default program
  openWorkspaceFile(filePath) {
    if (window.electronAPI && window.electronAPI.openPath) {
      window.electronAPI.openPath(filePath);
    }
  },

  // 3. Delete a file/folder
  async deleteWorkspaceFile(data, node) {
    try {
      // Show a confirm dialog (compatible with Element Plus's this.$confirm)
      await this.$confirm(
        (this.t('confirmDelete') || '이 파일을 휴지통으로 보낼까요?') + `\n${data.name}`,
        this.t('warning') || '경고',
        { 
          confirmButtonText: this.t('confirm') || '확인', 
          cancelButtonText: this.t('cancel') || '취소', 
          type: 'warning' 
        }
      );
      
      const res = await window.electronAPI.deleteWorkspaceFile(data.path);
      if (res.success) {
        showNotification(this.t('deleteSuccess'),'success');
        // Dynamically remove the node from the frontend, avoiding re-reading the whole directory tree
        const parent = node.parent;
        const children = parent.data.children || parent.childNodes;
        const index = children.findIndex(d => d.data.path === data.path);
        if (index !== -1) {
          children.splice(index, 1);
        }
        
      } else {
        showNotification(this.t('deleteFailed'),'error');
      }
    } catch (error) {
      // The user clicked cancel; do nothing
    }
  },

  // 5. Refresh the entire workspace tree
  refreshWorkspaceTree() {
    // Changing the key makes Vue destroy and rebuild el-tree, re-triggering load()
    this.workspaceTreeKey += 1;
  },

    // Core upload logic
    async executeUpload(targetPath) {
        try {
            // 1. Open the file-picker dialog
            const result = await window.electronAPI.openFileDialog();
            
            if (result.canceled || result.filePaths.length === 0) return;

            // 2. Perform the upload
            const uploadRes = await window.electronAPI.uploadToWorkspace(targetPath, result.filePaths);
            
            if (uploadRes.success) {
                showNotification(this.t('uploadSuccess'),'success');
                this.refreshWorkspaceTree(); // Refresh to show the new files
            } else {
                showNotification(this.t('uploadFailed'),'error');
            }
        } catch (err) {
            console.error('Upload Error:', err);
            this.$message.error(this.t('operationFailedConsole'));
        }
    },

    // Top button: upload to the root directory
    handleRootUpload() {
        const rootPath = this.CLISettings.cc_path;
        if (!rootPath) {
            showNotification(this.t('pleaseConfigWorkspace'),'error');
            return;
        }
        this.executeUpload(rootPath);
    },

    // Folder button: upload to a subdirectory
    handleFolderUpload(folderPath) {
        console.log("正在上传到子目录:", folderPath);
        this.executeUpload(folderPath);
    },

  // Add an affection dimension
  addLoveDimension() {
    if (!this.loveSettings.dimensions) {
      this.loveSettings.dimensions = [];
    }
    this.loveSettings.dimensions.push(""); // Push an empty string
    this.autoSaveSettings();
  },

  // Delete an affection dimension
  removeLoveDimension(idx) {
    if (this.loveSettings.dimensions && this.loveSettings.dimensions.length > 1) {
      this.loveSettings.dimensions.splice(idx, 1);
      this.autoSaveSettings();
    }
  },

  // ---------------- Bond system: system-config related ----------------
  addLoveDimension() {
    if (!this.loveSettings.dimensions) this.loveSettings.dimensions = [];
    this.loveSettings.dimensions.push("");
    this.autoSaveSettings();
  },
  removeLoveDimension(idx) {
    if (this.loveSettings.dimensions && this.loveSettings.dimensions.length > 1) {
      this.loveSettings.dimensions.splice(idx, 1);
      this.autoSaveSettings();
    }
  },

  // ---------------- Bond system: data-management related ----------------
  
  handleAffectionTabChange(tabName) {
    if (tabName === 'data') {
      this.fetchAffectionData();
    }
  },

  async fetchAffectionData() {
    try {
      // Call the FastAPI route we just wrote
      const response = await fetch('/api/affection/get_data');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      
      this.affectionRawData = data || {};
      
      // Convert the object to an array for el-table to render
      this.affectionDataList = Object.keys(this.affectionRawData).map(userName => {
        return {
          userName: userName,
          ...this.affectionRawData[userName]
        };
      });
      
      console.log("✅ 羁绊数据加载成功:", this.affectionDataList); // Debug log; visible in the console via F12
    } catch (error) {
      console.error("❌ 获取羁绊数据失败:", error);
      if (this.$message) this.$message.error(this.t('affectionLoadFailed'));
    }
  },

  // 3. Sync-save the frontend changes to the backend
  async syncAffectionDataToBackend() {
    try {
      // Convert the array back to the object structure {"name": {love: 10}}
      const newData = {};
      this.affectionDataList.forEach(item => {
        const { userName, ...dimensionsData } = item;
        newData[userName] = dimensionsData;
      });

      this.affectionRawData = newData; // Update the local cache

      // Send a POST request via fetch
      const response = await fetch('/api/affection/save_data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(newData)
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      if (this.$message) this.$message.success(this.t('affectionSynced'));
    } catch (error) {
      console.error("❌ 保存羁绊数据失败:", error);
      if (this.$message) this.$message.error(this.t('affectionSaveFailed'));
    }
  },

  // 3. Open the add/edit dialog
  openAffectionDataDialog(row = null) {
    this.isEditingAffection = !!row; // If a row is passed, it's an edit
    
    if (row) {
      // Edit: deep-copy the current row's data
      this.currentAffectionForm = JSON.parse(JSON.stringify(row));
    } else {
      // Add: initialize the form, defaulting all dimensions to 0
      const newForm = { userName: '' };
      if (this.loveSettings.dimensions) {
        this.loveSettings.dimensions.forEach(dim => {
          newForm[dim] = 0;
        });
      }
      this.currentAffectionForm = newForm;
    }
    
    this.showAffectionDataDialog = true;
  },

  // 4. Save the dialog form
  saveAffectionData() {
    const form = this.currentAffectionForm;
    if (!form.userName) return;

    if (this.isEditingAffection) {
      // Find and replace
      const index = this.affectionDataList.findIndex(item => item.userName === form.userName);
      if (index !== -1) {
        this.affectionDataList.splice(index, 1, { ...form });
      }
    } else {
      // Dedup check: prevent duplicate usernames
      const exists = this.affectionDataList.find(item => item.userName === form.userName);
      if (exists) {
        this.$message.warning(this.t('usernameExists'));
        return;
      }
      // Append the new user
      this.affectionDataList.push({ ...form });
    }

    this.showAffectionDataDialog = false;
    this.syncAffectionDataToBackend(); // Trigger a network request to sync to the backend
  },

  // 5. Delete a user's data
  deleteAffectionData(userName) {
    this.$confirm(this.t('confirmDelete') || '이 사용자 데이터를 삭제할까요?', this.t('warning') || '경고', {
      confirmButtonText: this.t('confirm') || '확인',
      cancelButtonText: this.t('cancel') || '취소', 
      type: 'warning'
    }).then(() => {
      const index = this.affectionDataList.findIndex(item => item.userName === userName);
      if (index !== -1) {
        this.affectionDataList.splice(index, 1);
        this.syncAffectionDataToBackend(); // Trigger a network request to sync to the backend
      }
    }).catch(() => {});
  },

    // Handle single-clicking a file to auto-add an @ shortcut
    handleFileShortcut(fullPath) {
        if (!fullPath) return;

        // 1. Get the workspace root path
        const rootPath = this.CLISettings.cc_path;
        let relativePath = fullPath;

        // 2. Convert the absolute path to one relative to the workspace
        if (rootPath && fullPath.startsWith(rootPath)) {
            // Cut off the root part and strip the extra leading slash from the path
            relativePath = fullPath.substring(rootPath.length).replace(/^[/\\]+/, '');
        }

        // 3. Replace path separators with forward slashes / (for AI readability and cross-platform consistency)
        relativePath = relativePath.replace(/\\/g, '/');

        // 4. Build the shortcut-command string
        const shortcut = `@${relativePath} `;

        // 5. Append the command to the input box
        if (!this.userInput) {
            // If the input box is empty, just assign
            this.userInput = shortcut;
        } else if (this.userInput.endsWith(' ')) {
            // If there's already a trailing space, just append the content
            this.userInput += shortcut;
        } else {
            // If there's no trailing space, add a space first, then the content
            this.userInput += ' ' + shortcut;
        }

        // 6. (Optional) auto-focus the chat input box so the user can keep typing
        // If your input component has ref="chatInput"
        this.$nextTick(() => {
            if (this.$refs.chatInput) {
                // For el-input, you need to access its inner input element
                const inputEl = this.$refs.chatInput.$el.querySelector('input') || this.$refs.chatInput.$el.querySelector('textarea');
                if (inputEl) inputEl.focus();
                else this.$refs.chatInput.focus();
            }
        });
    },

    handleOmniTTSenabled(newValue){
      if (newValue === true && this.ttsSettings.enabled === true) {
        this.ttsSettings.enabled = false;
        showNotification(this.t('autoDisableTtsSettings'), 'warning');
      }
      this.autoSaveSettings();
    },

    async handleFullScreenChange(val) {
      if (!val) {
        // If the toggle becomes false (full-screen off), actively bring up the region-selection UI
        await this.reselectRegion();
      } else {
        // If the toggle becomes true (full-screen on), just save the settings
        this.autoSaveSettings();
      }
    },

    /**
     * Bring up the selection frame so the user can re-select a screen region
     */
    async reselectRegion() {
      try {
        // Call the preload-exposed method, passing true to temporarily hide the main window
        const rect = await window.electronAPI.showScreenshotOverlay(true);
        
        // After the selection finishes, restore the main window
        window.electronAPI.windowAction('show');
        
        if (rect) {
          // The user selected successfully; record the region: [x, y, width, height]
          this.visionControlSettings.ScreenSize = [
            Math.floor(rect.x), 
            Math.floor(rect.y), 
            Math.floor(rect.width), 
            Math.floor(rect.height)
          ];
          this.visionControlSettings.isFullScreen = false;
        } else {
          // If rect is empty (e.g. the user pressed Esc to cancel), auto-revert to full-screen mode
          this.visionControlSettings.isFullScreen = true;
        }
        
        // Trigger auto-save
        this.autoSaveSettings();
        
      } catch (error) {
        console.error("选区失败:", error);
        // On error, ensure the main window reappears and the state is restored
        window.electronAPI.windowAction('show');
        this.visionControlSettings.isFullScreen = true;
        this.autoSaveSettings();
      }
    },

    // Start workspace monitoring
    setupWorkspaceWatcher(path) {
      if (window.electronAPI && window.electronAPI.startWorkspaceWatch) {
        window.electronAPI.startWorkspaceWatch(path);
        
        window.electronAPI.onWorkspaceChanged((data) => {
          console.log('前端收到文件系统变化:', data.action, data.path);
          
          // Key fix: use a native timer to fully solve the lost-this problem
          if (this.workspaceRefreshTimer) {
            clearTimeout(this.workspaceRefreshTimer);
          }
          
          this.workspaceRefreshTimer = setTimeout(() => {
            console.log('触发防抖更新 UI ...');
            this.refreshWorkspaceTreeKeepExpanded();
          }, 500);
        });
      }
    },

    // Preserve the expanded state before refreshing
    refreshWorkspaceTreeKeepExpanded() {
      const treeRef = this.$refs.workspaceTreeRef;
      if (treeRef) {
        const store = treeRef.store;
        const expandedKeys = [];
        for (const key in store.nodesMap) {
          if (store.nodesMap[key].expanded) {
            expandedKeys.push(key);
          }
        }
        this.expandedNodeKeys = expandedKeys;
        console.log('当前记录的展开文件夹节点:', this.expandedNodeKeys);
      } else {
        console.warn('未找到 el-tree 的引用 (workspaceTreeRef)');
      }
      
      this.refreshWorkspaceTree();
    },

// 1. The modified streaming random-topic generation logic
async generateRandomTopic() {
  if (this.isTopicGenerating) return;
  this.isTopicGenerating = true;
  
  // Clear the input box before starting, to better see the typewriter effect
  this.userInput = ''; 

  try {
    const res = await fetch('/simple_chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.mainAgent,
        messages: [
          {
            role: 'system',
            content: 'You are an engaging topic starter. Based on current trending technology, sci-fi, philosophy, or everyday life, generate a short, fun conversation opener or question that sparks discussion. Return only the topic text itself, with no extra decoration.'
          },
          {
            role: 'user',
            content: `Give me an interesting topic, in ${this.currentLanguage}.`
          }
        ],
        temperature: 1,
        stream: true // Enable streaming
      })
    });

    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Decode and merge into the buffer
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // Leave the possibly-incomplete last line in the buffer
      buffer = lines.pop(); 

      for (const line of lines) {
        let trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;

        // Handle the SSE format (strip the 'data:' prefix)
        if (trimmed.startsWith('data:')) {
          trimmed = trimmed.replace(/^data:\s?/, '');
        }

        try {
          const data = JSON.parse(trimmed);
          const content = data.choices?.[0]?.delta?.content;
          if (content) {
            // Append to userInput in real time for the typewriter effect
            this.userInput += content;
          }
        } catch (e) {
          // Ignore lines that fail to parse
        }
      }
    }

  } catch (e) {
    console.error("生成话题失败", e);
    // Fallback: just show a random topic
    const fallbackTopics = ["Will future AI have emotions?", "Recommend a book you've read recently", "If you could teleport instantly, where would you want to go?"];
    this.userInput = fallbackTopics[Math.floor(Math.random() * fallbackTopics.length)];
  } finally {
    this.isTopicGenerating = false;
  }
},

// 2. Dashboard send logic
handleDashboardSend() {
  if (!this.userInput.trim()) return;
  // Jump to the chat page
  this.activeMenu = 'home';
  this.clearMessages();
  // Call the original send method
  this.$nextTick(() => {
    this.sendMessage();
  });
},

// 3. Universal-agent confirmation
confirmOmniAgent() {
  if (!this.CLISettings.cc_path) {
    showNotification(this.t('pleaseSelectWorkspaceFirst'), 'error');
    return;
  }
  // Enable the CLI
  this.CLISettings.enabled = true;
  this.handleEnableToggle(true);
  // Close the popup and jump
  this.showOmniAgentDialog = false;
  this.activeMenu = 'home';
  showNotification(this.t('omniAgentEnabled'));
},

// 4. Extension-favorite logic
toggleFavoriteExtension(ext) {
  const index = this.favoriteExtensionIds.indexOf(ext.id);
  if (index > -1) {
    this.favoriteExtensionIds.splice(index, 1);
  } else {
    this.favoriteExtensionIds.push(ext.id);
  }
  // Persistent storage
  localStorage.setItem('favorite_extensions', JSON.stringify(this.favoriteExtensionIds));
},

createNewTask(){
  this.activeMenu = 'home';
  this.expandSidePanel();
  this.activeSideView = 'tasks';

},
openAiBrowser(){
  this.activeMenu = 'ai-browser';
  this.chromeMCPSettings.type = 'internal';
  this.chromeMCPSettings.enabled = true;
  this.changeChromeMCPEnabled();
},

connectToChatApp(){
  this.activeMenu = 'deploy-bot';
  this.subMenu = 'im_bot';
},

startLiveStream(){
  this.activeMenu = 'deploy-bot';
  this.subMenu = 'live_stream';
},

gotoAddExtension(){
  this.activeMenu = 'api-group';
  this.subMenu = 'extension';
  this.openAddExtensionDialog();
},

  // 2. Add these two methods to handle the mouse state
  handleExtMouseMove() {
    this.extButtonVisible = true;
    
    // Clear the previous timer
    if (this.extMouseTimer) {
      clearTimeout(this.extMouseTimer);
    }
    
    // If the mouse stops moving for 1.5 seconds, auto-hide the button
    this.extMouseTimer = setTimeout(() => {
      this.extButtonVisible = false;
    }, 1500);
  },
  
  hideExtButton() {
    this.extButtonVisible = false;
    if (this.extMouseTimer) {
      clearTimeout(this.extMouseTimer);
    }
  },

  async toggleVTSConnection() {
    // If a connection is in progress, block duplicate clicks
    if (this.isVTSStarting) return;
    
    this.isVTSStarting = true; // Show the loading animation (button spinner)
    
    try {
      if (this.VTSConfig.enabled) {
        // Action: stop the connection
        // Note: don't set enabled = false directly here; wait for backend confirmation first
        this.sendTTSStatusToVRM('stopVTS_Driver', {});
      } else {
        // Action: initiate the connection
        this.sendTTSStatusToVRM('startVTS_Driver', this.VTSConfig);
        
        // Set up a 10-second timeout
        // If the backend doesn't return any status message via WS within 10 seconds, auto-revert the state
        setTimeout(() => {
          if (this.isVTSStarting) {
            this.isVTSStarting = false;
            showNotification(this.t('notifyVtsTimeout'), 'warning', this.t('connectionTimeout'));
          }
        }, 10000);
      }
    } catch (e) {
      console.error("VTS 操作失败:", e);
      this.isVTSStarting = false;
      showNotification(this.t('notifyCommandSendFailed'), 'error');
    }
  },
  
  async startVTS() {
    // Simulate or actually send the WS command
    this.sendTTSStatusToVRM('startVTS_Driver', this.VTSConfig);
    this.VTSConfig.enabled = true;
    this.autoSaveSettings();
  },
  
  async stopVTS() {
    this.sendTTSStatusToVRM('stopVTS_Driver', {});
    this.VTSConfig.enabled = false;
    this.autoSaveSettings();
  },


  connectToVTS() {
      this.activeMenu = 'deploy-bot';
      this.subMenu = 'vts_config';
      if(!this.VTSConfig.enabled){
        this.toggleVTSConnection();
      }
  },

  async checkAcpxStatus() {
    this.checkingAcpx = true
    try {
      const host = window.location.hostname || '127.0.0.1'
      const port = window.location.port || '3456'
      const res = await fetch(`http://${host}:${port}/api/acpx/status`)
      const data = await res.json()
      
      if (data.available) {
        this.acpxStatus = 'available'
        showNotification(`ACPM Ready - Environment: ${data.environment}`)
      } else {
        this.acpxStatus = 'unavailable'
        showNotification(`ACPM Not Found: ${data.error}`,'error')
      }
    } catch (err) {
      this.acpxStatus = 'unavailable'
      showNotification('Failed to check ACPX status','error')
    } finally {
      this.checkingAcpx = false
    }
  },

  // 1. Initialize by getting the current path
  async fetchDataPath() {
    try {
      const response = await fetch('/api/system/data-path');
      if (response.ok) {
        const data = await response.json();
        this.customDataPath = data.path;
        this.isDocker = data.is_docker;
      }
    } catch (error) {
      console.error("fetchDataPath Error:", error);
    }
  },

  // 2. Browse for a directory (call the Electron dialog)
  async browseDataDirectory() {
    if (!this.isElectron) {
      showNotification(this.t('notifyDesktopOnly'), 'warning');
      return;
    }
    try {
      // Note: per your main.js definitions, call the corresponding preload-mapped method here
      // If your preload maps to dialog:openDirectory, use the following:
      const result = await window.electronAPI.openDirectoryDialog(); 
      if (!result.canceled && result.filePaths.length > 0) {
        this.customDataPath = result.filePaths[0];
      }
    } catch (error) {
      console.error('选择目录出错:', error);
      showNotification(this.t('notifySelectDirFailed'), 'error');
    }
  },

  // 3. Apply and save the path
  async saveDataPath() {
    if (!this.customDataPath || !this.customDataPath.trim()) {
      showNotification(this.t('pathCannotBeEmpty'), 'warning');
      return;
    }
    try {
      await this.$confirm(this.t('confirmChangePathText'), this.t('warning'), {
        confirmButtonText: this.t('confirm'),
        cancelButtonText: this.t('cancel'),
        type: 'warning'
      });

      const response = await fetch('/api/system/set-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: this.customDataPath.trim() })
      });

      const data = await response.json();
      if (response.ok && data.success) {
        showNotification(this.t('pathUpdateSuccess'), 'success');
        this.showRestartDialog = true; // Trigger the restart-confirmation dialog
      } else {
        showNotification(data.detail || this.t('notifyModifyFailed'), 'error');
      }
    } catch (error) {
      if (error !== 'cancel') showNotification(error.message, 'error');
    }
  },

  // 4. Reset the path
  async resetDataPath() {
    try {
      await this.$confirm(this.t('confirmResetPathText'), this.t('warning'), {
        confirmButtonText: this.t('confirm'),
        cancelButtonText: this.t('cancel'),
        type: 'warning'
      });

      const response = await fetch('/api/system/reset-path', { method: 'POST' });
      const data = await response.json();

      if (response.ok && data.success) {
        showNotification(this.t('pathResetSuccess'), 'success');
        this.customDataPath = data.path;
        this.showRestartDialog = true;
      }
    } catch (error) {
      if (error !== 'cancel') showNotification(this.t('notifyResetFailed'), 'error');
    }
  },

  // 5. Open the current folder directly in the file explorer
  async openDataFolder() {
    if (this.customDataPath) {
      if (this.isElectron) {
        // Use openPath under electronAPI 
        // It calls shell.openPath underneath, which opens and enters the directory directly
        window.electronAPI.openPath(this.customDataPath);
      } else {
        showNotification(this.t('notifyDesktopOnly'), 'warning');
      }
    } else {
      showNotification(this.t('notifyPathNotLoaded'), 'warning');
    }
  },

}
