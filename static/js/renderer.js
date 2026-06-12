// Add the content-loaded class after the page finishes loading
document.addEventListener('DOMContentLoaded', function() {
  // Set a short delay to ensure all resources are loaded
  setTimeout(function() {
    document.body.classList.add('content-loaded');
  }, 100);
});

// ==========================================
// 1. Define the A2UI render component (supports Markdown rendering)
// ==========================================
const A2UIRendererComponent = {
  name: 'A2UIRenderer',
  components: {}, 
  template: `
    <div :class="['a2ui-root', isSelfContained ? 'a2ui-root-clean' : 'a2ui-root-boxed']">
      
      <!-- 根标题 -->
      <div v-if="uiConfig.props && uiConfig.props.title && !isSelfContained" class="a2ui-title">
        {{ uiConfig.props.title }}
      </div>
      <!-- 根描述 (也支持 MD) -->
      <div 
        v-if="uiConfig.props && uiConfig.props.description && !isSelfContained" 
        class="a2ui-text-content markdown-body" 
        style="color: var(--el-text-color-secondary); font-size: 13px; margin-bottom: 15px;"
        v-html="renderMarkdown(uiConfig.props.description)"
      ></div>

      <el-form :model="formData" label-position="top" size="default" @submit.prevent>
        
        <div :class="containerClass">
          
          <template v-for="(item, index) in normalizedChildren" :key="index">
            
            <!-- 1. Input -->
            <el-form-item 
              v-if="item.type === 'Input'" 
              :label="item.props.label" 
              style="margin-bottom: 15px; flex: 1; min-width: 200px;"
            >
              <el-input 
                v-model="formData[item.props.key || ('input_'+index)]" 
                :placeholder="item.props.placeholder || '请输入...'"
                size="large"
              >
                <template #append v-if="item.props.action === 'search'">
                  <el-button @click="handleAction(item, formData[item.props.key || ('input_'+index)])">
                    <i class="fa-solid fa-magnifying-glass"></i>
                  </el-button>
                </template>
              </el-input>
            </el-form-item>

            <!-- 2. Select -->
            <el-form-item 
              v-if="item.type === 'Select'" 
              :label="item.props.label"
              style="margin-bottom: 15px; flex: 1;"
            >
              <el-select 
                v-model="formData[item.props.key]" 
                :placeholder="item.props.placeholder || '请选择'" 
                style="width: 100%"
                size="large"
              >
                <el-option 
                  v-for="(opt, oIdx) in item.props.options" 
                  :key="oIdx" 
                  :label="isObj(opt) ? opt.label : opt" 
                  :value="isObj(opt) ? opt.value : opt" 
                />
              </el-select>
            </el-form-item>

            <!-- 3. Text (★ 修复点：使用 v-html + Markdown) -->
            <!-- 添加 markdown-body 类以复用你的全局 MD 样式 -->
            <div 
              v-if="item.type === 'Text'" 
              class="a2ui-text-content markdown-body"
              v-html="renderMarkdown(item.props.content)"
            ></div>

            <!-- 4. Divider -->
            <el-divider 
              v-if="item.type === 'Divider'" 
              style="margin: 18px 0; border-color: var(--el-border-color-lighter);" 
            />

            <!-- 5. Group -->
            <div v-if="item.type === 'Group'" class="a2ui-group-container">
               <div v-if="item.props && item.props.title" style="width: 100%; font-weight: bold; margin-bottom: 8px; font-size: 14px;">
                  {{ item.props.title }}
               </div>
              <!-- ★ 修改点：添加 :shared-form-data="formData" -->
              <a2-u-i-renderer 
                v-for="(child, cIdx) in item.children" 
                :key="cIdx" 
                :config="child"
                :shared-form-data="formData" 
                @action="relayAction"
                style="flex: 1; min-width: auto;" 
              />
            </div>

            <!-- 6. List -->
            <div v-if="item.type === 'List'" class="a2ui-list">
              <div 
                v-for="(listItem, lIdx) in item.props.items" 
                :key="lIdx" 
                class="a2ui-list-item"
                @click="handleManualAction('点击条目', listItem.title)"
              >
                <div class="a2ui-list-title">{{ listItem.title }}</div>
                <div class="a2ui-list-desc">{{ listItem.description }}</div>
                <div class="a2ui-list-meta">
                  <span v-if="listItem.source" class="tag">{{ listItem.source }}</span>
                  <span class="time">{{ listItem.timestamp }}</span>
                </div>
              </div>
            </div>

            <!-- 7. Card -->
            <el-card 
              v-if="item.type === 'Card'" 
              shadow="hover" 
              class="a2ui-inner-card"
            >
              <template #header v-if="item.props.title">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-weight: bold; font-size: 16px;">{{ item.props.title }}</span>
                  <span v-if="item.props.subtitle" style="font-size: 12px; color: #909399; font-weight: normal;">{{ item.props.subtitle }}</span>
                </div>
              </template>
              
              <!-- ★ 修复点 1：独立渲染 Card 的 content，不再使用 v-else -->
              <!-- 这样，无论有没有 children，只要 content 存在就会显示 -->
              <div 
                v-if="item.props.content || item.props.description" 
                class="a2ui-card-desc markdown-body"
                style="margin-bottom: 15px;"
              >
                <div v-if="Array.isArray(item.props.content)">
                    <div v-for="(line, lIdx) in item.props.content" :key="lIdx" v-html="renderMarkdown(line)"></div>
                </div>
                <div v-else-if="item.props.content" v-html="renderMarkdown(item.props.content)"></div>
                <div v-else-if="item.props.description" v-html="renderMarkdown(item.props.description)"></div>
              </div>

              <!-- ★ 修复点 2：独立渲染 Card 的 children -->
              <div v-if="item.children && item.children.length > 0">
                 <!-- ★ 修改点：添加 :shared-form-data="formData" -->
                 <a2-u-i-renderer 
                    v-for="(child, ccIdx) in item.children" 
                    :key="ccIdx" 
                    :config="child"
                    :shared-form-data="formData"
                    @action="relayAction"
                 />
              </div>

              <div class="tags" v-if="item.props.tags" style="margin-top: 12px;">
                <el-tag v-for="tag in item.props.tags" :key="tag" size="default" effect="plain" style="margin-right: 6px;">
                  {{ tag }}
                </el-tag>
              </div>

              <div v-if="item.props.actions" class="a2ui-card-actions">
                <el-button 
                    v-for="(btn, bIdx) in item.props.actions"
                    :key="bIdx"
                    :type="bIdx === item.props.actions.length - 1 ? 'primary' : ''"
                    size="default"
                    @click="handleManualAction(btn.label, item.props.title)"
                >
                    {{ btn.label }}
                </el-button>
              </div>
            </el-card>

            <!-- 8. Button (Description 也支持 Markdown) -->
            <div 
              v-if="item.type === 'Button'" 
              :style="buttonStyle"
            >
              <el-button 
                v-if="item.props.description"
                :type="resolveBtnType(item.props)"
                @click="handleAction(item)" 
                :disabled="isSubmitted"
                size="large"
                style="height: auto; padding: 12px 20px; text-align: left; display: inline-flex; flex-direction: column; align-items: flex-start; line-height: 1.4; width: 100%;"
              >
                <span style="font-weight: 600; font-size: 15px;">{{ item.props.label }}</span>
                <span style="font-size: 12px; opacity: 0.8; font-weight: normal; margin-top: 4px;" v-html="renderMarkdown(item.props.description)"></span>
              </el-button>

              <el-button 
                v-else
                :type="resolveBtnType(item.props)" 
                @click="handleAction(item)" 
                :disabled="isSubmitted"
                size="large" 
                style="width: 100%; font-weight: 500;"
              >
                {{ item.props.label }}
              </el-button>
            </div>

            <!-- 9. Slider (滑块) -->
            <el-form-item 
              v-if="item.type === 'Slider'" 
              :label="item.props.label"
              style="margin-bottom: 15px; flex: 1; min-width: 200px;"
            >
              <div style="display: flex; align-items: center; width: 100%;">
                <el-slider 
                  v-model="formData[item.props.key]" 
                  :min="item.props.min || 0" 
                  :max="item.props.max || 100"
                  :step="item.props.step || 1"
                  show-input
                  size="default"
                  style="flex: 1; margin-right: 10px;"
                />
                <span v-if="item.props.unit" style="font-size: 12px; color: #909399;">{{ item.props.unit }}</span>
              </div>
            </el-form-item>

            <!-- 10. Switch (开关) -->
            <el-form-item 
              v-if="item.type === 'Switch'" 
              :label="item.props.label"
              style="margin-bottom: 15px;"
            >
              <el-switch 
                v-model="formData[item.props.key]" 
                :active-text="item.props.activeText || '开'"
                :inactive-text="item.props.inactiveText || '关'"
              />
            </el-form-item>

            <!-- 11. Radio (单选组) -->
            <el-form-item 
              v-if="item.type === 'Radio'" 
              :label="item.props.label"
              style="margin-bottom: 15px;"
            >
              <el-radio-group v-model="formData[item.props.key]">
                <el-radio 
                  v-for="(opt, oIdx) in item.props.options" 
                  :key="oIdx" 
                  :label="isObj(opt) ? opt.value : opt"
                  border
                >
                  {{ isObj(opt) ? opt.label : opt }}
                </el-radio>
              </el-radio-group>
            </el-form-item>

            <!-- 12. Checkbox (多选组) -->
            <el-form-item 
              v-if="item.type === 'Checkbox'" 
              :label="item.props.label"
              style="margin-bottom: 15px;"
            >
              <el-checkbox-group v-model="formData[item.props.key]">
                <el-checkbox 
                  v-for="(opt, oIdx) in item.props.options" 
                  :key="oIdx" 
                  :label="isObj(opt) ? opt.value : opt"
                >
                  {{ isObj(opt) ? opt.label : opt }}
                </el-checkbox>
              </el-checkbox-group>
            </el-form-item>

            <!-- 13. DatePicker (日期选择) -->
            <el-form-item 
              v-if="item.type === 'DatePicker'" 
              :label="item.props.label"
              style="margin-bottom: 15px;"
            >
              <el-date-picker
                v-model="formData[item.props.key]"
                :type="item.props.subtype || 'date'" 
                :placeholder="item.props.placeholder || '选择日期'"
                value-format="YYYY-MM-DD HH:mm:ss"
                style="width: 100%;"
              />
            </el-form-item>
            
            <!-- 14. Rate (评分) -->
            <el-form-item 
              v-if="item.type === 'Rate'" 
              :label="item.props.label"
              style="margin-bottom: 15px;"
            >
              <el-rate 
                v-model="formData[item.props.key]" 
                allow-half 
                show-text
                :texts="['极差', '失望', '一般', '满意', '惊喜']"
              />
            </el-form-item>

             <!-- 15. Alert (提示条) -->
             <div v-if="item.type === 'Alert'" style="margin-bottom: 15px; width: 100%;">
                <el-alert
                    :title="item.props.title"
                    :type="item.props.variant || 'info'"
                    :show-icon="item.props.showIcon !== false"
                    :closable="false"
                >
                    <template #default v-if="item.props.content">
                        <div v-html="renderMarkdown(item.props.content)"></div>
                    </template>
                </el-alert>
             </div>

            <!-- 16. Code (代码块 - 独立渲染，无额外 wrapper) -->
            <div 
              v-if="item.type === 'Code'" 
              class="a2ui-code-block"
            >
              <div class="code-header">
                <span class="lang-tag">{{ item.props.language || 'text' }}</span>
                <div class="copy-btn" @click="copyToClipboard(item.props.content, $event)">
                  <i class="fa-regular fa-copy"></i>
                  <span>copy</span>
                </div>
              </div>
              <div class="code-body">
                <pre><code>{{ item.props.content }}</code></pre>
              </div>
            </div>

            <!-- 17. Table (表格组件) -->
            <div 
              v-if="item.type === 'Table'" 
              class="a2ui-table-wrapper"
            >
              <div class="a2ui-table-scroll">
                <table class="a2ui-table">
                  <thead>
                    <tr>
                      <th v-for="(head, hIdx) in item.props.headers" :key="hIdx">
                        {{ head }}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(row, rIdx) in item.props.rows" :key="rIdx">
                      <!-- 支持简单 HTML 或纯文本 -->
                      <td v-for="(cell, cIdx) in row" :key="cIdx" v-html="renderMarkdown(String(cell))"></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- 18. 朗读文本块 -->
            <div 
              v-if="item.type === 'TTSBlock'" 
              class="a2ui-tts-block"
              @click="handleTTS(item.props.content, item.props.voice)"
              title="点击播放语音"
            >
              <div class="tts-icon">
                <i class="fa-solid fa-volume-high"></i>
              </div>
              <div class="tts-body">
                <div class="tts-label" v-if="item.props.label">{{ item.props.label }}</div>
                <div class="tts-content markdown-body" v-html="renderMarkdown(item.props.content)"></div>
              </div>
              <div class="tts-action-hint">
                <i class="fa-solid fa-play"></i>
              </div>
            </div>

            <div 
              v-if="item.type === 'Audio'" 
              class="a2ui-audio-player"
              style="margin-bottom: 15px; width: 100%;"
            >
              <div v-if="item.props.title" style="font-weight: bold; margin-bottom: 5px; font-size: 14px;">
                {{ item.props.title }}
              </div>
              <audio controls style="width: 100%; height: 40px;" :src="item.props.src">
                您的浏览器不支持音频元素。
              </audio>
              <div v-if="item.props.description" style="font-size: 12px; color: #909399; margin-top: 4px;">
                {{ item.props.description }}
              </div>
            </div>

          </template>
        </div>
      </el-form>
    </div>
  `,
  props: {
    config: { type: Object, required: true, default: () => ({}) },
    sharedFormData: { type: Object, default: null } 
  },
  data() {
    return { internalFormData: {}, isSubmitted: false };
  },
  computed: {
    activeDownloadCount() {
        return this.downloads.filter(d => d.state === 'progressing').length;
    },
    formData() {
      return this.sharedFormData || this.internalFormData;
    },
    uiConfig() {
      if (Array.isArray(this.config)) return { children: this.config };
      return this.config || {};
    },
    isSelfContained() {
      return ['Card', 'Group', 'List', 'Divider'].includes(this.uiConfig.type);
    },
    normalizedChildren() {
        const conf = this.uiConfig;
        if (conf.children && Array.isArray(conf.children)) {
            return conf.children;
        }
        if (conf.type) {
            return [conf];
        }
        return [];
    },
    containerClass() {
      if (this.uiConfig.type === 'Group') {
        return 'a2ui-group-container';
      }
      return 'a2ui-form-container';
    },
    buttonStyle() {
      if (this.uiConfig.type === 'Group') {
        return { margin: '0 5px', flex: '1' };
      }
      return { textAlign: 'right', marginTop: '10px', width: '100%' };
    }
  },
  created() {
    this.normalizedChildren.forEach((child, idx) => {
      // List of components that need data binding
      const formComponents = ['Input', 'Select', 'Slider', 'Switch', 'Radio', 'Checkbox', 'DatePicker', 'Rate'];
      
      if (formComponents.includes(child.type)) {
         const key = (child.props && child.props.key) || (child.type.toLowerCase() + '_' + idx);
         
         if (this.formData[key] === undefined) {
            // Initialize defaults based on the component type
            if (child.type === 'Checkbox') {
                this.formData[key] = []; // Multi-select must be initialized as an array
            } else if (child.type === 'Slider' || child.type === 'Rate') {
                this.formData[key] = child.props.min || 0; // Number type
            } else if (child.type === 'Switch') {
                this.formData[key] = child.props.defaultValue || false; // Boolean type
            } else {
                this.formData[key] = ''; // String type
            }
         }
      }
    });
  },
  methods: {
    resetForm() {
      // Define a recursive function: traverse all levels to find form items
      const traverseAndReset = (items) => {
        if (!Array.isArray(items)) return;

        items.forEach(item => {
          // Recurse: if it's a container component (Group, Card, etc.), keep searching deeper
          if (item.children && Array.isArray(item.children)) {
            traverseAndReset(item.children);
          }

          // Handle: if it's a form component, perform a reset
          const formComponents = ['Input', 'Select', 'Slider', 'Switch', 'Radio', 'Checkbox', 'DatePicker', 'Rate'];
          
          if (formComponents.includes(item.type)) {
             // Get the bound key
             const key = (item.props && item.props.key);
             if (!key) return; // Ignore components without a key
             
             // Restore the default value based on the component type
             if (item.type === 'Checkbox') {
                 this.formData[key] = []; // Multi-select -> empty array
             } else if (item.type === 'Slider' || item.type === 'Rate') {
                 this.formData[key] = item.props.min || 0; // Number -> 0
             } else if (item.type === 'Switch') {
                 this.formData[key] = item.props.defaultValue || false; // Switch -> false
             } else {
                 this.formData[key] = ''; // Other text types -> empty string
             }
          }
        });
      };

      // Recurse starting from the current component's root child node
      traverseAndReset(this.normalizedChildren);

      // Reset the submit state
      this.isSubmitted = false;
      
      // UI feedback
      if (typeof showNotification === 'function') {
          showNotification(this.t('notifyResetAllOptions'), 'success');
      }
    },
    handleTTS(text, voice) {
      // Try calling the root component's ClickToListen method
      if (this.$root && typeof this.$root.ClickToListen === 'function') {
        this.$root.ClickToListen(text, voice);
      } else {
        console.warn('A2UI: 根实例上未找到 ClickToListen 方法。');
        this.$emit('action', `TTS播放请求: ${text}`); // Fallback handling
      }
    },

    async copyToClipboard(text, event) {
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        
        // Simple interaction feedback: change the button text
        const btn = event.currentTarget;
        const originalHtml = btn.innerHTML;
        const span = btn.querySelector('span');
        if(span) span.innerText = 'Copied!';
        
        setTimeout(() => {
          btn.innerHTML = originalHtml;
        }, 2000);
        
        // If you have a global notification component, you could also use:
        // showNotification('Code copied', 'success');
      } catch (err) {
        console.error('复制失败:', err);
      }
    },

    // The core method for rendering Markdown
    renderMarkdown(text) {
        if (!text) return '';
        // Try using the globally defined md object
        if (typeof md !== 'undefined' && md.render) {
            return md.render(text);
        }
        // Fallback: if there's no md, do simple newline handling
        return text.replace(/\n/g, '<br>');
    },
    isObj(val) {
      return val && typeof val === 'object';
    },
    resolveBtnType(props) {
        if (props.variant === 'primary') return 'primary';
        if (props.variant === 'danger') return 'danger';
        return props.type || 'default';
    },
handleAction(item, extraValue) {
      // ... (keep the earlier Clear/Reset interception logic) ...
      if (item.props.action === 'clear' || item.props.action === 'reset') {
          if (this.sharedFormData) {
              this.$emit('action', '_A2UI_RESET_ALL_'); 
          } else {
              this.resetForm();
          }
          return; 
      }

      // ---------------------------------------------------------
      // Regular business logic (Submit / Search)
      // ---------------------------------------------------------
      this.isSubmitted = true;
      let payload = item.props.label;
      
      if (item.props.action === 'search' && extraValue) {
          payload = `搜索：${extraValue}`;
      }
      else if (item.props.action === 'submit') {
        const formDataKeys = Object.keys(this.formData);
        
        // Case A: single-field form, send "label: value" directly
        if (formDataKeys.length === 1 && this.formData[formDataKeys[0]]) {
            const singleValue = this.formData[formDataKeys[0]];
            payload = `${item.props.label}：${singleValue}`;
        } 
        // Case B: multi-field form, send the aggregated details
        else {
            let details = [];
            const findFieldLabel = (nodes, targetKey) => {
                for (const node of nodes) {
                    if (node.props && node.props.key === targetKey) return node.props.label;
                    if (node.children) {
                        const found = findFieldLabel(node.children, targetKey);
                        if (found) return found;
                    }
                }
                return targetKey; 
            };

            for (const [key, val] of Object.entries(this.formData)) {
                 if (val === undefined || val === '' || val === null || (Array.isArray(val) && val.length === 0)) continue;
                 
                 const label = findFieldLabel(this.normalizedChildren, key);
                 let displayVal = val;
                 details.push(`${label}：${displayVal}`);
            }
            
            if (details.length > 0) {
                // ============================================================
                // The key fix is here
                // Original code: payload = `Form submission:\n${details.join('\n')}`;
                // Changed to: explicitly prepend the button name (item.props.label) to the message header
                // ============================================================
                payload = `提交操作：${item.props.label}\n表单数据：\n${details.join('\n')}`;
            } else {
                // If the form is entirely empty, keep the button name
                payload = `${item.props.label} (空表单提交)`;
            }
        }
      } 
      else if (item.props.data) {
          payload = `选择操作：${item.props.label} (ID:${item.props.data})`;
      }
      
      // Send the final payload to the parent
      this.$emit('action', payload);
    },

    handleManualAction(actionName, title) {
        this.$emit('action', `选择了：${title} - ${actionName}`);
    },
    relayAction(payload) {
        // Intercept the special signal: _A2UI_RESET_ALL_
        if (payload === '_A2UI_RESET_ALL_') {
            if (this.sharedFormData) {
                // I'm still a child component; keep passing it up like a relay baton
                this.$emit('action', '_A2UI_RESET_ALL_');
            } else {
                // I'm the root component! It finally reached me; perform the clear
                this.resetForm();
            }
            return; // Interception done; don't trigger sendMessage
        }

        // Normal message: pass it straight up, ultimately triggering handleA2UIAction
        this.$emit('action', payload);
    }
  }
};

const MAX_DISPLAY_LENGTH = 50000;   // Frontend display truncation length for tool results / error messages
const MAX_RENDERED_BLOCKS = 10;
// ==========================================
// 2. Create the Vue app
// ==========================================
const app = Vue.createApp({
  data() {
    return vue_data
  },
  // Clear the timer on component destroy
  beforeDestroy() {
    this.stopEdgeScroll();
    if (this.behaviorTimeTimer)   clearInterval(this.behaviorTimeTimer)
    if (this.behaviorNoInputTimer) clearInterval(this.behaviorNoInputTimer)
    if (this.vrmPollTimer) clearInterval(this.vrmPollTimer)
    clearInterval(this.behaviorCycleTimer);
    this.cycleTimers.forEach(timer => {
      if (timer) clearInterval(timer);
    });
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
    }
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('resize', this.checkMobile);
    this.shouldReconnectWs = false; // Set the flag
    this.stopDanmuProcessor(); // Stop the bullet-chat processor
    this.disconnectWebSocket();
  },
  async mounted() {
    try {
      // Only register global shortcuts in the Electron environment
      if (isElectron && window.electronAPI?.onGlobalShortcutTriggered) {
          window.electronAPI.onGlobalShortcutTriggered(async () => {
            // Only takes effect when ASR is enabled and the mode is global-shortcut
            if (this.asrSettings.interactionMethod !== 'globalKeyTriggered') return;

            if (!this.isGlobalRecording) {
              // First press of the hotkey: start recording
              this.isGlobalRecording = true;
              await this.handlePttPress(); 
              // Optional: show a hint so the user knows background recording started
              showNotification(this.t('globalRecordingStarted'), 'success')
            } else {
              // Second press of the hotkey: stop recording
              this.isGlobalRecording = false;
              await this.handlePttRelease(); 
            }
          });
        }

      // Register the VRM-pet show/hide global shortcuts (registered in the main window; works even when it's hidden)
      if (isElectron && window.electronAPI?.registerVrmShowShortcut) {
        this.applyVrmVisibilityShortcuts();
      }

      // Only register the IPC listener in the Electron environment
      if (isElectron && window.electron && window.electron.ipcRenderer) {
          window.electron.ipcRenderer.on('trigger-search', (text) => {
              // 1. Fill the selected text into the address-bar variable
              this.urlInput = text;
              
              // 2. Call your existing enter-handling logic directly
              // This fully reuses your regex check and Google/Bing/Party engine-selection logic
              this.handleUrlEnter();
          });
      }
      this.fetchDataPath();
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 24000
      });
      this.audioStartTime = this.audioCtx.currentTime;
      
      // Only get the app path in the Electron environment
      let fileUrl = '';
      if (isElectron && window.electronAPI) {
        const appPath = await window.electronAPI.getAppPath();
        // Build the path: app root + static/js/webview-preload.js
        const fullPath = await window.electronAPI.pathJoin(appPath, 'static', 'js', 'webview-preload.js');
        
        // 2. Convert to a file:// protocol URL
        // Note: on Windows paths use backslashes \, which must be replaced with forward slashes / for a URL
        fileUrl = 'file://' + (this.isWindows ? '/' : '') + fullPath.replace(/\\/g, '/');
        
        console.log('Webview Preload URL:', fileUrl); // For debugging
      }
      
      this.webviewPreloadPath = fileUrl;
      
    } catch (e) {
      console.error('获取 Preload 路径失败:', e);
    }

    window.handleToolApproval = (toolCallId, action) => {
        console.log('Global approval triggered:', toolCallId, action); // Debug log
        this.processToolApproval(toolCallId, action);
    };
    
    // Listen for the 'open new tab' command from the main process (Electron only)
    if (isElectron && window.electronAPI && window.electronAPI.onNewTab) {
        window.electronAPI.onNewTab((url) => {
            console.log('收到新标签页请求:', url);
            this.openUrlInNewTab(url);
        });
    }
    
    // Listen for download events (Electron only)
    if (isElectron && window.downloadAPI) {
        window.downloadAPI.onDownloadStarted((data) => {
            console.log('🔥前端已收到下载任务:', data);
            // Put the new download item at the front
            this.downloads.unshift({
                ...data,
                state: 'progressing',
                receivedBytes: 0,
                progress: 0
            });
            // Auto-open the dropdown to notify the user (optional)
            // this.showDownloadDropdown = true; 
        });

        window.downloadAPI.onDownloadUpdated((data) => {
            const item = this.downloads.find(d => d.id === data.id);
            if (item) {
                Object.assign(item, data); // Update the status and progress
            }
        });

        window.downloadAPI.onDownloadDone((data) => {
            const item = this.downloads.find(d => d.id === data.id);
            if (item) {
                item.state = data.state;

                if (data.path) {
                    item.path = data.path; 
                }
                if (data.state === 'completed') {
                    item.progress = 1;
                    item.receivedBytes = item.totalBytes;
                }
            }
        });
    }
    
    await this.probeNode();
    await this.probeUv(); 
    await this.probeDocker();
    this.checkMobile();
    this.loadSherpaStatus();
    this.loadMossStatus();
    this.minilmModelStatus();
    window.addEventListener('resize', this.handleResize);
    
    if (isElectron) {
      this.checkServerPort();
    }
    
    window.addEventListener('keydown', this.handleKeyDown)
    window.addEventListener('keyup', this.handleKeyUp)
    window.addEventListener('resize', this.checkMobile);
    this.pollVRMStatus()   // Start polling
    
    if (isElectron) {
      this.isMac = window.electron.isMac;
      this.isWindows = window.electron.isWindows;
    }
    
    this.initWebSocket();
    this.highlightCode();
    this.initDownloadButtons();
    
    if (isElectron) {
      // Check for updates
      this.checkForUpdates();
      // Listen for update events
      window.electronAPI.onUpdateAvailable((_, info) => {
        this.updateAvailable = true;
        this.updateInfo = info;
        showNotification(this.t('updateAvailable'), 'info');
      });
      window.electronAPI.onUpdateNotAvailable(() => {
        this.updateAvailable = false;
        this.updateInfo = null;
      });
      window.electronAPI.onUpdateError((_, err) => {
        showNotification(err, 'error');
      });
      window.electronAPI.onDownloadProgress((_, progress) => {
        this.downloadProgress = progress.percent;
        this.updateIcon = 'fa-solid fa-spinner fa-spin';
      });
      window.electronAPI.onUpdateDownloaded(() => {
        this.updateDownloaded = true;
        this.updateIcon = 'fa-solid fa-rocket';
      });
    }
    
    this.$nextTick(() => {
      this.initPreviewButtons();
    });
    this.$nextTick(() => {               // Ensure the DOM is rendered
      document.addEventListener('click', this._toggleHighlight, false);
    });
    document.documentElement.setAttribute('data-theme', this.systemSettings.theme);
    // On startup, sync the initial values of the global scale and code-block scale
    {
      const scale = Number(this.systemSettings.fontScale) || 1;
      if (this.isElectron && window.electronAPI?.setZoomFactor) {
        try { window.electronAPI.setZoomFactor(scale); } catch (e) { document.documentElement.style.zoom = scale; }
      } else {
        document.documentElement.style.zoom = scale;
      }
      document.documentElement.style.setProperty('--app-zoom', String(scale));
      const codeScale = Number(this.systemSettings.codeFontScale) || 1;
      document.documentElement.style.setProperty('--code-zoom', String(codeScale));
    }
    
    if (isElectron) {
      window.stopDiscordBotHandler = this.requestDiscordBotStopIfRunning;
      window.stopTelegramBotHandler = this.requestTelegramBotStopIfRunning;
      window.stopSlackBotHandler = this.requestSlackBotStopIfRunning;
      window.electronAPI.onWindowState((_, state) => {
        this.isMaximized = state === 'maximized'
      });
    }
    
    this.initTTSWebSocket();
    if (isElectron) {
      window.aiBrowser = this;
      this.$nextTick(() => {
        this.generateQRCode(); // Generate a QR code
      });
    }
    
    // 1. Time trigger
    this.behaviorTimeTimer = setInterval(() => {
      if (!this.behaviorSettings.enabled) return
      const now = new Date()
      const hm = now.toLocaleTimeString('zh-CN', { hour12: false }) 
      const d  = now.getDay() 
      this.behaviorSettings.behaviorList.forEach(b => {
        // Key change: use isTargetPlatform to check whether it belongs to the current web (chat) task
        if (!b.enabled || b.trigger.type !== 'time' || !this.isTargetPlatform(b, 'chat')) return
        const tv = b.trigger.time.timeValue
        const ds = b.trigger.time.days
        if (tv === hm) {
          if (ds.length === 0 || ds.includes(d)) {
            this.runBehavior(b)
            this.disableOnceBehavior(b)
          }
        }
      })
    }, 1000)

    // 2. No-input trigger
    this.noInputSec = 0 
    this.behaviorNoInputTimer = setInterval(() => {
      if (!this.behaviorSettings.enabled) return
      this.behaviorSettings.behaviorList.forEach(b => {
        // Key change: check the platform
        if (!b.enabled || b.trigger.type !== 'noInput' || !this.isTargetPlatform(b, 'chat')) return
        const need = b.trigger.noInput.latency
        if (this.noInputFlag) {
          this.noInputSec++
          if (this.noInputSec >= need) {
            this.runBehavior(b)
            this.noInputSec = 0 
          }
        } else {
          this.noInputSec = 0
        }
      })
    }, 1000)

    // 3. Cyclic trigger
    this.behaviorCycleTimer = setInterval(() => {
      // Core defense: layered checks
      if (!this.behaviorSettings) return;
      if (this.behaviorSettings.enabled !== true) return;
      if (!Array.isArray(this.behaviorSettings.behaviorList)) return;

      this.behaviorSettings.behaviorList.forEach((b, index) => {
        // Check that b and its trigger exist, to avoid an error reading b.trigger.type
        if (!b || !b.enabled || !b.trigger) return;
        
        // Only handle cyclic-type tasks
        if (b.trigger.type !== 'cycle') return;

        // Check the platform (this calls the safe function above)
        if (!this.isTargetPlatform(b, 'chat')) return;

        // Ensure the array storing the timers exists
        if (!this.cycleTimers) this.cycleTimers = [];

        if (!this.cycleTimers[index]) {
          this.initCycleTimer(b, index);
        }
      });
    }, 1000);

    this.scanExtensions(); // Scan extensions
    if (this.ttsSettings && this.ttsSettings.engine === 'systemtts') {
      this.fetchSystemVoices();
    }
    document.addEventListener('click', (e) => {
        const selector = document.querySelector('.engine-selector');
        if (selector && !selector.contains(e.target)) {
            this.showEngineDropdown = false;
        }
    });
    this.loadFavorites();

    const handleRemoteInstall = (data) => {
      // 1. Auto-switch the menu and submenu based on type
      if (data.type === 'mcp') {
          this.handleRemoteMCPInstall(data);
          return;
      }
      const { repo, type } = data;
      if (!repo) return;
      if (type === 'skill') {
        this.activeMenu = 'toolkit'; // Assume Skills is in this group
        this.subMenu = 'CLI';      // Switch to the Skills submenu
        this.activeCLITab = 'skills';
        this.newSkillUrl = repo;      
      } else {
        this.activeMenu = 'api-group';
        this.subMenu = 'extension';
        this.newExtensionUrl = repo;
      }

      // 2. Confirmation dialog
      const confirmMsg = type === 'skill' 
        ? `${this.t('confirmInstallSkillFrom')}：\n${repo}`
        : `${this.t('confirmInstallExtensionFrom')}：\n${repo}`;

      this.$confirm(
        confirmMsg, 
        this.t('confirmInstall'), 
        { 
          confirmButtonText: this.t('confirm'), 
          cancelButtonText: this.t('cancel'),
          type: 'info' 
        }
      ).then(() => {
        // 3. Run the corresponding install method
        if (type === 'skill') {
          this.installSkillFromGithub();
        } else {
          this.addExtension(); // Run the install-extension method
        }
      }).catch(() => {
        console.log('用户取消了安装');
      });
    };

    // --- Mount listeners (Electron only) ---
    if (isElectron && window.electronAPI) {
      // Triggered while the app is running
      window.electronAPI.onRemoteInstall((payload) => {
        // The payload here contains { repo, type }
        handleRemoteInstall(payload);
      });

      // Check at app startup
      setTimeout(async () => {
        const pendingData = await window.electronAPI.checkPendingInstall();
        if (pendingData) {
          handleRemoteInstall(pendingData);
        }
      }, 1000);
    }

    this.$nextTick(() => {
      setTimeout(() => {
        if (isElectron) {
          this.updateGlobalShortcut();
        }
      }, 1000); // Delay 500ms to ensure the main process is fully ready
    });
  },
  beforeUnmount() {
    this.stopEdgeScroll();
    this.stopSkillsPolling();
    this.stopExtensionsPolling();
    clearInterval(this.nodeTimer);
    clearInterval(this.uvTimer); 
    if (window.electronAPI?.unregisterGlobalShortcut) {
      window.electronAPI.unregisterGlobalShortcut();
    }
    if (isElectron) {
      delete window.stopDiscordBotHandler;
      delete window.stopTelegramBotHandler;
      delete window.stopSlackBotHandler;
    }
    if (this.ttsWebSocket) {
      this.ttsWebSocket.close();
    }
    document.removeEventListener('click', this._toggleHighlight, false);
    window.removeEventListener('resize', this.handleResize);
    if (window.electronAPI && window.electronAPI.stopWorkspaceWatch) {
      window.electronAPI.stopWorkspaceWatch();
    }

  },
  watch: {
    'CLISettings.cc_path': {
      handler(newPath) {
        if (newPath) {
          console.log('工作区路径更新，准备启动文件监听:', newPath);
          this.setupWorkspaceWatcher(newPath);
        } else if (window.electronAPI && window.electronAPI.stopWorkspaceWatch) {
          window.electronAPI.stopWorkspaceWatch();
        }
      },
      immediate: true
    },

    showHistorySidebar() {
      this.$nextTick(() => {
        // If the sidebar disappears/appears, the chat area and sidebar should keep their ratio while filling the remaining space
        this.updatePanelWidths();
      });
    },

    'asrSettings.interactionMethod': {
      handler() { this.updateGlobalShortcut(); }
    },
    'asrSettings.enabled': {
      handler() { this.updateGlobalShortcut(); }
    },

    sidePanelOpen(val) {
        if (!val && this.taskRefreshTimer) {
            clearInterval(this.taskRefreshTimer);
        } else if (val && this.activeSideView === 'tasks') {
            this.fetchTasks();
            this.taskRefreshTimer = setInterval(this.fetchTasks, 3000);
        }
    },
    'tempBehavior.trigger.cycle.cycleValue'(newVal) {
      if (newVal === '00:00:00') {
        this.tempBehavior.trigger.cycle.cycleValue = '00:00:01';
      }
    },
    activeMenu(newVal) {
      this.handleExtensionsPolling(newVal, this.subMenu);
      this.handleSkillsPolling(newVal, this.subMenu, this.activeCLITab);
    },
    // Watch the submenu
    subMenu(newVal) {
      this.handleExtensionsPolling(this.activeMenu, newVal);
      this.handleSkillsPolling(this.activeMenu,newVal, this.activeCLITab);
    },
    // Watch the tab inside the CLI
    activeCLITab(newVal) {
      this.handleSkillsPolling(this.activeMenu,this.subMenu, newVal);
    },
    'CLISettings.cc_path': function(newPath) {
      console.log('工作区路径变化，更新技能状态');
      this.fetchProjectSkillsStatus();
    },
    'searchEngine': function(newVal) {
      if (newVal === 'party') {
        this.searchEngineplaceholder = this.t('searchWithParty')
      }else if (newVal === 'bing') {
        this.searchEngineplaceholder = this.t('searchWithBing')
      }else if (newVal === 'google') {
        this.searchEngineplaceholder = this.t('searchWithGoogle')
      }
    },
    currentTheme: {
      handler(newVal) {
        // Wait for the DOM update to ensure the CSS variables have changed
        this.$nextTick(() => {
          // Iterate all tabs and update the styles
          this.browserTabs.forEach(tab => {
            this.updateWebviewTheme(tab.id);
          });
        });
      },
      immediate: false // No need to run immediately on init, since dom-ready handles it
    },
    'ttsSettings.engine': function(newVal) {
      if (newVal === 'systemtts') {
        // If the list is empty, go fetch it
        if (this.systemVoices.length === 0) {
          this.fetchSystemVoices();
        }
      }
    },
    'readConfig.longText': {
      immediate: true,
      async handler(val) {          // <- add async
        await this.$nextTick();     // <- ensure the component finished its previous render
        if (!val?.trim()) {
          this.clearSegments();
          return;
        }
        this.reSegment();
      }
    },
    selectedCodeLang() {
      this.highlightCode();
    },
    modelProviders: {
      deep: true,
      handler(newProviders) {
        const existingIds = new Set(newProviders.map(p => p.id));
        // Auto-clean up an invalid selectedProvider
        [this.settings, this.reasonerSettings,this.visionSettings,
          this.KBSettings,this.text2imgSettings,this.ccSettings,
          this.qcSettings,this.fastSettings
        ].forEach(config => {
          if (config.selectedProvider && !existingIds.has(config.selectedProvider)) {
            config.selectedProvider = null;
            // Optional: also reset the related fields
            config.model = '';
            config.base_url = '';
            config.api_key = '';
          }
          if (!config.selectedProvider && newProviders.length > 0) {
            config.selectedProvider = newProviders[0].id;
          }
        });
        [this.settings, this.reasonerSettings,this.visionSettings,
          this.KBSettings,this.text2imgSettings,this.ccSettings,
          this.qcSettings,this.fastSettings
        ].forEach(config => {
          if (config.selectedProvider) this.syncProviderConfig(config);
        });
      }
    },
    'systemSettings.theme': {
      handler(newVal) {
        document.documentElement.setAttribute('data-theme', newVal);
        
        // Update the mermaid theme
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'loose',
          theme : ['dark','midnight','neon'].includes(newVal) ? 'dark' : 'default'
        });

        // The complete theme-color mapping
        const themeColors = {
          light: '#21859c',      // Default
          dark: '#ee7e00',       // Orange
          midnight: '#21859c',   // Midnight blue
          desert: '#d98236',     // Desert yellow
          neon: '#ff2d95' ,       // Neon pink
          marshmallow: '#f5a5c3',  // Marshmallow pink
          ink: '#2c3e50',        // Ink blue
          party: '#ed7d00',        // Party yellow
          rainbow: '#845ec2',        // Rainbow
        };

        // Get the current theme color
        const themeColor = themeColors[newVal] || themeColors.light;
        const root = document.documentElement;

        // Set the primary color and its derivatives (Element Plus needs a full color ramp)
        root.style.setProperty('--el-color-primary', themeColor);
        root.style.setProperty('--el-color-primary-light-9', this.colorBlend(themeColor, '#ffffff', 0.1));
        root.style.setProperty('--el-color-primary-light-8', this.colorBlend(themeColor, '#ffffff', 0.2));
        root.style.setProperty('--el-color-primary-light-7', this.colorBlend(themeColor, '#ffffff', 0.3));
        root.style.setProperty('--el-color-primary-light-6', this.colorBlend(themeColor, '#ffffff', 0.4));
        root.style.setProperty('--el-color-primary-light-5', this.colorBlend(themeColor, '#ffffff', 0.5));
        root.style.setProperty('--el-color-primary-light-4', this.colorBlend(themeColor, '#ffffff', 0.6));
        root.style.setProperty('--el-color-primary-light-3', this.colorBlend(themeColor, '#ffffff', 0.7));
        root.style.setProperty('--el-color-primary-light-2', this.colorBlend(themeColor, '#ffffff', 0.8));
        root.style.setProperty('--el-color-primary-light-1', this.colorBlend(themeColor, '#ffffff', 0.9));
        root.style.setProperty('--el-color-primary-dark-1', this.colorBlend(themeColor, '#000000', 0.3));
        root.style.setProperty('--el-color-primary-dark-2', this.colorBlend(themeColor, '#000000', 0.2));
        root.style.setProperty('--el-color-primary-dark-3', this.colorBlend(themeColor, '#000000', 0.1));

        // Force-refresh the Element Plus theme
        if (window.__ELEMENT_PLUS_INSTANCE__) {
          window.__ELEMENT_PLUS_INSTANCE__.config.globalProperties.$ELEMENT.reload();
        }
      },
      immediate: true
    },
    'systemSettings.fontScale': {
      handler(newVal) {
        const safe = Math.max(0.85, Math.min(1.5, Number(newVal) || 1));
        if (this.isElectron && window.electronAPI?.setZoomFactor) {
          try { window.electronAPI.setZoomFactor(safe); } catch (e) { document.documentElement.style.zoom = safe; }
        } else {
          document.documentElement.style.zoom = safe;
        }
        document.documentElement.style.setProperty('--app-zoom', String(safe));
      },
      immediate: true
    },
    'systemSettings.codeFontScale': {
      handler(newVal) {
        const safe = Math.max(0.83, Math.min(1.67, Number(newVal) || 1));
        document.documentElement.style.setProperty('--code-zoom', String(safe));
      },
      immediate: true
    },
    'systemSettings.language': {
      handler(newVal) {
        if (this.isElectron) {
          window.electronAPI.sendLanguage(newVal);
        }
      },
      immediate: true
    },
  },
  computed: {

    getEiditDialogTitle() {
      if (this.editType === 'system'){
        return this.t('editSystemPrompt');
      }else if (this.editType === 'user'){
        return this.t('editMessage');
      }else{
        return this.t('viewOriginalMessage');
      }
    },

    // New: main-page extension-list filtering logic
    filteredManageExtensions() {
      if (!this.searchManageExtensionQuery) {
        return this.extensions;
      }
      const query = this.searchManageExtensionQuery.toLowerCase();
      return this.extensions.filter(ext => {
        const matchName = ext.name && ext.name.toLowerCase().includes(query);
        const matchDesc = ext.description && ext.description.toLowerCase().includes(query);
        const matchAuthor = ext.author && ext.author.toLowerCase().includes(query);
        return matchName || matchDesc || matchAuthor; // Add author matching
      });
    },

    // New: dialog remote-plugin-list filtering logic
    filteredRemotePlugins() {
      if (!this.searchRemotePluginQuery) {
        return this.remotePlugins;
      }
      const query = this.searchRemotePluginQuery.toLowerCase();
      return this.remotePlugins.filter(plugin => {
        const matchName = plugin.name && plugin.name.toLowerCase().includes(query);
        const matchDesc = plugin.description && plugin.description.toLowerCase().includes(query);
        return matchName || matchDesc;
      });
    },

    // Dynamically return the filtered extension list
    filteredExtensions() {
      // If the search box is empty, return the original extension list
      if (!this.searchExtensionQuery) {
        return this.extensions; 
      }
      
      const query = this.searchExtensionQuery.toLowerCase();
      
      // Fuzzy-match by the extension's name or description
      return this.extensions.filter(ext => {
        const matchName = ext.name && ext.name.toLowerCase().includes(query);
        const matchDesc = ext.description && ext.description.toLowerCase().includes(query);
        return matchName || matchDesc;
      });
    },

  favoriteExtensions() {
    return this.extensions.filter(ext => this.favoriteExtensionIds.includes(ext.id));
  },

  dockerBasicCommand() {
    const img = this.dockerImages[this.dockerRegistry].backend;
    return `docker pull ${img}
docker run -d \\
  -p 3456:3456 \\
  -v ./super-agent-data:/app/data \\
  ${img}`;
  },
  
  dockerComposeCommand() {
    const composeFile = this.dockerImages[this.dockerRegistry].composeFile;
    return `git clone https://github.com/heshengtao/super-agent-party.git
cd super-agent-party
docker-compose -f ${composeFile} up -d`;
  },

    // Dynamically filter the table data
    filteredAffectionData() {
      console.log("计算属性触发，当前数据长度:", this.affectionDataList.length);
      // Check that the base data exists
      if (!this.affectionDataList || this.affectionDataList.length === 0) {
        return [];
      }
      
      // If there's no search term, return the full array
      if (!this.affectionSearchQuery) {
        return this.affectionDataList;
      }
      
      const query = this.affectionSearchQuery.toLowerCase();
      return this.affectionDataList.filter(item => {
        // Ensure userName exists before filtering
        return item.userName && item.userName.toLowerCase().includes(query);
      });
    },
    computedSkillsList() {
      const skillMap = new Map();
      
      // 1. Load in the global skills
      this.skillsList.forEach(skill => {
        skillMap.set(skill.id, {
          ...skill,
          isGlobal: true,
          isProject: false
        });
      });

      // 2. Load in the project skills (filling in those missing globally, or marking ones present in the project)
      this.projectSkillsDetails.forEach(skill => {
        if (skillMap.has(skill.id)) {
          skillMap.get(skill.id).isProject = true;
        } else {
          skillMap.set(skill.id, {
            ...skill,
            isGlobal: false,
            isProject: true
          });
        }
      });

      return Array.from(skillMap.values());
    },
    hasWorkspacePath() {
        return this.CLISettings && 
               this.CLISettings.cc_path && 
               this.CLISettings.cc_path.trim() !== '';
    },
    dynamicUserAgent() {
      // 1. Define a fairly recent Chrome version (updating this periodically keeps the best compatibility)
      // Currently Chrome 124+ is fairly universal
      const chromeVersion = '124.0.0.0'; 
      
      // 2. Base template
      const baseUA = `Mozilla/5.0 ({os_info}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
      
      // 3. Get the current platform
      // In the Electron renderer, you can usually tell via global.process or navigator
      let platform = '';
      
      // Try using node's process.platform (most accurate)
      if (typeof window.process !== 'undefined' && window.process.platform) {
        platform = window.process.platform;
      } else {
        // Fallback: analyze navigator.userAgent
        const navUA = navigator.userAgent.toLowerCase();
        if (navUA.indexOf('mac') > -1) platform = 'darwin';
        else if (navUA.indexOf('win') > -1) platform = 'win32';
        else platform = 'linux';
      }

      // 4. Set the OS info based on the platform
      let osInfo = '';
      switch (platform) {
        case 'darwin': // macOS
          // Emulate a generic macOS Intel/M1 identifier
          osInfo = 'Macintosh; Intel Mac OS X 10_15_7';
          break;
        case 'win32': // Windows
          // Emulate Windows 10/11 64-bit
          osInfo = 'Windows NT 10.0; Win64; x64';
          break;
        case 'linux': // Linux
          // Emulate standard Linux x64
          osInfo = 'X11; Linux x86_64';
          break;
        default:
          // Default fallback to Windows
          osInfo = 'Windows NT 10.0; Win64; x64';
      }

      // 5. Return the fully substituted string
      return baseUA.replace('{os_info}', osInfo);
    },

    isCurrentTabFavorite() {
        // If there's no current tab, or it has no URL (e.g. a new tab), return false
        if (!this.currentTab || !this.currentTab.url) return false;
        // Check whether the current URL is in the bookmark list
        return this.favorites.some(f => f.url === this.currentTab.url);
    },

    sidePanelText() {
      if (this.messages.length === 0) {
        return '';
      }
      
      // Filter all assistant messages and sort them in reverse chronological order
      const assistantMessages = this.messages
        .filter(msg => msg.role === 'assistant')
        .reverse();
      
      // Find the first non-empty message
      for (const msg of assistantMessages) {
        if (msg.pure_content && msg.pure_content.trim() !== '') {
          return msg.pure_content;
        }
      }
      
      // If no matching message is found
      return '';
    },
    currentViewName() {
      return this.currentExtension ? this.currentExtension.name : this.t('defaultView');
    },
    /* Computed property: default template */
    defaultSidePanelHTML() {
      // If the user provided a custom template, use it directly
      if (this.sidePanelHTML) return this.sidePanelHTML;

      return `
        <div class="side-panel-default">
          <div class="side-panel-content markdown-body" v-data-mjx-disabled="true">
            ${this.formatMessage(this.sidePanelText)}
          </div>
        </div>`;
    },
    noInputFlag() {
      return !this.TTSrunning &&
             !this.ASRrunning &&
             !this.isInputting &&
             !this.isTyping &&
             !this.isOmniPlaying
    },
    // Compute the processing percentage
    processingPercentage() {
      if (this.totalChunksCount === 0) return 0;
      return Math.round((this.audioChunksCount / this.totalChunksCount) * 100);
    },
    
    // Generate the progress text
    processingProgressText() {
      if (this.totalChunksCount === 0) return this.t('waiting');
      
      return `${this.audioChunksCount} / ${this.totalChunksCount} (${this.processingPercentage}%)`;
    },
    
    // Set the progress-bar color based on the status
    progressStatus() {
      if (this.isReadRunning || this.isConvertingAudio) {
        if (this.processingPercentage >= 90) return 'success';
        if (this.processingPercentage >= 50) return '';
        return 'exception';
      }
      return 'success';
    },

    allChecked: {
      get() {
        return this.textFiles.length > 0 && this.selectedFiles.length === this.textFiles.length;
      },
      set(val) {
        this.selectedFiles = val ? this.textFiles.map(f => f.unique_filename) : [];
      }
    },
    indeterminate() {
      return (
        this.selectedFiles.length > 0 &&
        this.selectedFiles.length < this.textFiles.length
      );
    },
    // Image select-all state
    allImagesChecked: {
      get() {
        return this.imageFiles.length > 0 && 
              this.selectedImages.length === this.imageFiles.length
      },
      set(val) {
        this.selectedImages = val 
          ? this.imageFiles.map(i => i.unique_filename) 
          : []
      }
    },
    
    // Image indeterminate state: selected count is greater than 0 and less than the total
    indeterminateImages() {
      return (
        this.selectedImages.length > 0 &&
        this.selectedImages.length < this.imageFiles.length
      );
    },

    // Video select-all state
    allVideosChecked: {
      get() {
        return this.videoFiles.length > 0 && 
              this.selectedVideos.length === this.videoFiles.length
      },
      set(val) {
        this.selectedVideos = val 
          ? this.videoFiles.map(v => v.unique_filename) 
          : []
      }
    },
    // The select-all checkbox's indeterminate state
    indeterminateVideos() {
      return (
        this.selectedVideos.length > 0 &&
        this.selectedVideos.length < this.videoFiles.length
      );
    },
    sidebarStyle() {
      return {
        width: this.isMobile ? 
          (this.sidebarVisible ? '200px' : '0') : 
          (this.isCollapse ? '64px' : '200px')
      }
    },
    filteredSeparators() {
      const current = this.ttsSettings.separators;
      const defaults = this.defaultSeparators;
      const custom = current
        .filter(s => !defaults.some(d => d.value === s))
        .map(s => ({
          label: `(${this.formatSeparator(s)})`,
          value: s
        }));
      return [...this.defaultSeparators, ...custom];
    },
    filteredClaudeModelProviders() {
      let vendors = ["Anthropic", "Deepseek", "siliconflow", "ZhipuAI", "moonshot", "aliyun", "modelscope","302.AI","MiMo","newapi","Ollama"];
      // From this.modelProviders, add those whose vendor is in vendors to filteredClaudeModelProviders
      return this.modelProviders.filter((item) => vendors.includes(item.vendor));
    },

    // Computed property determining whether the config is valid
    isTelegramBotConfigValid() {
      return this.telegramBotConfig.bot_token;
    },
    filteredTelegramSeparators() {
      const current = this.telegramBotConfig.separators;
      const defaults = this.defaultSeparators;
      const custom = current
        .filter(s => !defaults.some(d => d.value === s))
        .map(s => ({
          label: `(${this.formatSeparator(s)})`,
          value: s
        }));
      return [...this.defaultSeparators, ...custom];
    },
    isDiscordBotConfigValid() {
      return !!this.discordBotConfig.token;
    },
    filteredDiscordSeparators() {
      const current = this.discordBotConfig.separators;
      const defaults = this.defaultSeparators;
      const custom = current
        .filter(s => !defaults.some(d => d.value === s))
        .map(s => ({
          label: `(${this.formatSeparator(s)})`,
          value: s
        }));
      return [...this.defaultSeparators, ...custom];
    },
    isSlackBotConfigValid() {
      // Slack needs both tokens to run
      return !!this.slackBotConfig.bot_token && !!this.slackBotConfig.app_token;
    },
    filteredSlackSeparators() {
      const current = this.slackBotConfig.separators;
      const defaults = this.defaultSeparators;
      const custom = current
        .filter(s => !defaults.some(d => d.value === s))
        .map(s => ({
          label: `(${this.formatSeparator(s)})`,
          value: s
        }));
      return [...this.defaultSeparators, ...custom];
    },
    isLiveConfigValid() {
        if (this.liveConfig.youtube_enabled) {
          return this.liveConfig.youtube_video_id !== '' &&
          this.liveConfig.youtube_api_key !== '';
        }
        else if (this.liveConfig.twitch_enabled) {
          return this.liveConfig.twitch_channel !== '' &&
          this.liveConfig.twitch_access_token !== '';
        }
        return false;
    },
    updateButtonText() {
      if (this.updateDownloaded) return this.t('installNow');
      if (this.downloadProgress > 0) return this.t('downloading');
      return this.t('updateAvailable');
    },
    allItems() {
      return [
        ...this.files.map(file => ({ ...file, type: 'file' })),
        ...this.images.map(image => ({ ...image, type: 'image' }))
      ];
    },
    sortedConversations() {
      return [...this.conversations].sort((a, b) => b.timestamp - a.timestamp);
    },
    filteredConversations() {
        const keyword = (this.searchKeyword || '').toLowerCase();
        // 1. Ensure conversations exists and is an array
        if (!Array.isArray(this.conversations)) return [];

        return [...this.conversations]
            .filter(conv => {
                if (!conv) return false;
                // 2. Safely check title
                const titleMatch = (conv.title || '').toLowerCase().includes(keyword);
                
                // 3. [Core fix] safely check the messages array and its content
                const contentMatch = (conv.messages || []).some(msg => 
                    msg && msg.content && String(msg.content).toLowerCase().includes(keyword)
                );
                
                return titleMatch || contentMatch;
            })
            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    },
    groupedFilteredConversations() {
      const groups = Array.isArray(this.conversationGroups) ? this.conversationGroups : [];
      const conversations = Array.isArray(this.filteredConversations) ? this.filteredConversations : [];
      const keyword = (this.searchKeyword || '').trim().toLowerCase();

      return groups
        .map(group => ({
          ...group,
          conversations: conversations.filter(conv => (conv.groupId || 'default') === group.id)
        }))
        .filter(group => {
          if (!keyword) return true;
          return group.conversations.length > 0 || (group.name || '').toLowerCase().includes(keyword);
        });
    },
    iconClass() {
      return this.isExpanded ? 'fa-solid fa-compress' : 'fa-solid fa-expand';
    },
    hasEnabledA2AServers() {
      return Object.values(this.a2aServers).some(server => server.enabled);
    },
    hasEnabledLLMTools() {
      return this.llmTools.some(tool => tool.enabled);
    },
    hasEnabledKnowledgeBases() {
      return this.knowledgeBases.some(kb => kb.enabled)
    },
    hasEnabledMCPServers() {
      // Check whether any server in this.mcpServers has disabled set to false
      return Object.values(this.mcpServers).some(server => !server.disabled);
    },
    hasEnabledHttpTools() {
      return this.customHttpTools.some(tool => tool.enabled);
    },
    hasEnabledComfyUI() {
      return this.workflows.some(tool => tool.enabled);
    },
    hasEnabledStickerPacks() {
      return this.stickerPacks.some(pack => pack.enabled);
    },
    hasFiles() {
      return this.files.length > 0
    },
    hasImages() {
      return this.images.length > 0
    },
    formValid() {
      return !!this.newLLMTool.name && !!this.newLLMTool.type
    },
    isEditingBehavior() {
      return this.currentBehaviorIndex !== -1;
    },
    defaultBaseURL() {
      switch(this.newLLMTool.type) {
        case 'openai': 
          return 'https://api.openai.com/v1'
        case 'ollama':
          return this.isdocker ? 
            'http://host.docker.internal:11434' : 
            'http://127.0.0.1:11434'
        default:
          return ''
      }
    },
    defaultApikey() {
      switch(this.newLLMTool.type) {
        case 'ollama':
          return 'ollama'
        default:
          return ''
      }
    },
    validProvider() {
      if (!this.newProviderTemp.vendor) return false
      if (this.newProviderTemp.vendor === 'custom' || this.newProviderTemp.vendor === 'customAnthropic') {
        return this.newProviderTemp.url.startsWith('http')
      }
      return true
    },
    vendorOptions() {
      return this.vendorValues.map(value => ({
        label: this.t(`vendor.${value}`), // Use a unified translation key
        value
      }));
    },
  // New: the provider list filtered by search term and category
  filteredVendorOptions() {
    return this.vendorOptions.filter(item => {
      // 1. Search filter (case-insensitive match on value or the translated label)
      const keyword = this.searchQuery.toLowerCase();
      const matchSearch = 
        item.value.toLowerCase().includes(keyword) || 
        item.label.toLowerCase().includes(keyword);

      // 2. Category filter
      const isLocal = this.localVendors.includes(item.value);
      let matchCategory = true;
      
      if (this.activeCategory === 'local') {
        matchCategory = isLocal;
      } else if (this.activeCategory === 'cloud') {
        matchCategory = !isLocal;
      }

      // Satisfies both the search and category conditions
      return matchSearch && matchCategory;
    });
  },

    MCPvendorOptions() {
      return this.MCPvendorValues.map(value => ({
        label: this.t(`MCPvendor.${value}`), // Use a unified translation key
        value
      }));
    },
    PromptOptions() {
      return this.promptValues.map(value => ({
        label: this.t(`prompt.${value}`), // Use a unified translation key
        value
      }));
    },
    CardOptions() {
      return this.cardValues.map(value => ({
        label: this.t(`card.${value}`), // Use a unified translation key
        value
      }));
    },
    themeOptions() {
      return this.themeValues.map(value => ({
        label: this.t(`theme.${value}`),
        value // Keep the original value (recommended)
      }));
    },
    // Global font base 14px
    currentFontPx() {
      return Math.round((Number(this.systemSettings.fontScale) || 1) * 14);
    },
    // Code-block base 12px (matches .markdown-body pre in github-markdown.css)
    currentCodeFontPx() {
      return Math.round((Number(this.systemSettings.codeFontScale) || 1) * 12);
    },
    // The dropdown exposes px externally but stores the zoom ratio internally
    fontPxModel: {
      get() { return this.currentFontPx; },
      set(px) { this.handleFontScaleChange(px / 14); }
    },
    codeFontPxModel: {
      get() { return this.currentCodeFontPx; },
      set(px) { this.handleCodeFontScaleChange(px / 12); }
    },
    fontSizeOptions() {
      return [12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
    },
    codeFontSizeOptions() {
      return [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    },
    // The code-block preview on the appearance-settings page. Its DOM structure must match the output of highlight() in vue_methods.js,
    // so it can inherit the zoom / theme / highlight styles on .code-block.
    codeBlockPreviewHtml() {
      const sample =
`function greet(name) {
  const message = \`Hello, \${name}!\`;
  console.log(message);
  return message;
}

greet('Super Agent Party');`;
      const escape = s => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]);
      try {
        const highlighted = window.hljs
          ? window.hljs.highlight(sample, { language: 'javascript' }).value
          : escape(sample);
        return `<pre class="code-block"><div class="code-header"><span class="code-lang">javascript</span></div><div class="code-content"><code class="hljs language-javascript">${highlighted}</code></div></pre>`;
      } catch (e) {
        return `<pre class="code-block"><div class="code-header"><span class="code-lang">text</span></div><div class="code-content"><code class="hljs">${escape(sample)}</code></div></pre>`;
      }
    },
    hasAgentChanges() {
      return this.mainAgent !== 'super-model' || 
        Object.values(this.agents).some(a => a.enabled)
    },
    // Get all unique languages
    uniqueLanguages() {
      const languages = [...new Set(this.edgettsvoices.map(voice => voice.language))];
      return languages.sort();
    },
    
    // Get the available genders based on the selected language
    uniqueGenders() {
      const voicesForLanguage = this.edgettsvoices.filter(voice => 
        voice.language === this.edgettsLanguage
      );
      const genders = [...new Set(voicesForLanguage.map(voice => voice.gender))];
      return genders.sort();
    },
    
    // Filter voices based on the selected language and gender
    filteredVoices() {
      return this.edgettsvoices.filter(voice => 
        voice.language === this.edgettsLanguage && 
        voice.gender === this.edgettsGender
      );
    },
    uniqueNewLanguages() {
      const languages = [...new Set(this.edgettsvoices.map(voice => voice.language))];
      return languages.sort();
    },
    uniqueNewGenders() {
      const voicesForLanguage = this.edgettsvoices.filter(voice => 
        voice.language === this.newTTSConfig.edgettsLanguage
      );
      const genders = [...new Set(voicesForLanguage.map(voice => voice.gender))];
      return genders.sort();
    },
    filteredNewVoices() {
      return this.edgettsvoices.filter(voice => 
        voice.language === this.newTTSConfig.edgettsLanguage && 
        voice.gender === this.newTTSConfig.edgettsGender
      );
    },
    selectedVendor() {
      return this.modelProviders.find(
        p => p.id === this.settings.selectedProvider
      );
    },
    currentTab() {
        return this.browserTabs.find(t => t.id === this.currentTabId);
    },
    allItems() {
      // 1. Document type
      const filesWithType = (this.files || []).map(f => ({
        ...f,
        uiCategory: 'file' // Rename to avoid clashing with file.type
      }));

      // 2. Visual type (includes images and videos)
      const visualsWithType = (this.images || []).map(img => ({
        ...img,
        uiCategory: 'image' 
      }));

      return [...filesWithType, ...visualsWithType];
    },
    hasAttachments() {
      return this.allItems && this.allItems.length > 0;
    },
  },
  methods: {
    ...vue_methods,
  },
directives: {
    morph: {
      mounted(el, binding, vnode) {
        const vm = binding.instance; 
        el._update = (content) => {
           // 1. Parse the Markdown
          const html = vm.formatMessage(content, -1);
          const wrapper = document.createElement('div');
          wrapper.innerHTML = html;
           
           // 2. Update the real DOM
           morphdom(el, wrapper, { 
               childrenOnly: true,
               onBeforeElUpdated: (fromEl, toEl) => {
                   const tag = fromEl.tagName || '';
                   if (tag.startsWith('MJX-') || fromEl.classList.contains('MathJax')) return false;
                   if (fromEl.tagName === 'PRE' && fromEl.isEqualNode(toEl)) return false;
                   return true;
               }
           });
           
            // [Core fix] call directly without requestAnimationFrame, letting scrollToBottom's own setTimeout handle the timing
            if (vm && typeof vm.scrollToBottom === 'function') {
                vm.scrollToBottom();
            }
        };
        el._update(binding.value);
      },
      updated(el, binding) {
        if (binding.value !== binding.oldValue) {
           el._update(binding.value);
        }
      }
    }
},
  created() {
      if (this.browserTabs.length > 0) {
          this.currentTabId = this.browserTabs[0].id;
      }
      this.scrollInterval = null;
  },
});

// FontAwesome icon mapping
const NOTIFICATION_ICONS = {
    success: 'fa-solid fa-circle-check',
    error: 'fa-solid fa-circle-xmark',
    warning: 'fa-solid fa-triangle-exclamation',
    info: 'fa-solid fa-circle-info'
};

let notificationTimeout;

function showNotification(message, type = 'success', title = '') {
    // Remove the old notification (singleton mode, to avoid stacking too many in the top-right)
    const existingNotification = document.querySelector('.notification');
    if (existingNotification) {
        existingNotification.remove();
        clearTimeout(notificationTimeout);
    }

    const iconClass = NOTIFICATION_ICONS[type] || NOTIFICATION_ICONS.info;
    const duration = (type === 'error'|| type === 'warning') ? 5000 : 3000;

    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    
    notification.innerHTML = `
        <div class="notif-icon-box">
            <i class="${iconClass}"></i>
        </div>
        <div class="notif-content">
            ${title ? `<div class="notif-title">${title}</div>` : ''}
            <div class="notif-desc" style="${!title ? 'color: var(--el-text-color-primary);' : ''}">${message}</div>
        </div>
        <div class="notif-progress" style="transition-duration: ${duration}ms"></div>
    `;

    document.body.appendChild(notification);
    
    // Force a repaint
    void notification.offsetWidth;

    requestAnimationFrame(() => {
        notification.classList.add('show');
    });

    notificationTimeout = setTimeout(() => {
        notification.classList.remove('show');
        notification.classList.add('hide');
        setTimeout(() => {
            if (notification.parentNode) notification.remove();
        }, 400); 
    }, duration);
}

// Backward-compatible with old call styles (if your code only passes a message)
// showNotification("Saved"); -> defaults to success
// showNotification("Save failed", "error");
function removeNonAsciiTags(html) {
  // Match all tags (both opening and closing)
  // e.g. <narration> and </narration>
  const regex = /<\/?([^\s>]+)[^>]*>/g;
  
  return html.replace(regex, (match, tagName) => {
    // Check whether the tag name contains non-ASCII characters
    const hasNonAscii = [...tagName].some(char => char.charCodeAt(0) > 127);
    
    // If the tag name contains non-ASCII characters, remove the tag (but keep the content)
    if (hasNonAscii) {
      return '';
    }
    
    // Otherwise, keep the tag
    return match;
  });
}

// Modify the icon-registration approach (full example)
app.use(ElementPlus);

// ==========================================
// Change: register the A2UI component
// ==========================================
app.component('a2-u-i-renderer', A2UIRendererComponent);

// Register all icons correctly (in a single loop)
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

// Mount the app
app.mount('#app');
