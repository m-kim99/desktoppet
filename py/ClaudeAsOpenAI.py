import httpx
from typing import Optional, List, Dict, Any, AsyncIterator, Union
import functools

class AsyncClaudeAsOpenAI:
    """
    完全模拟 AsyncOpenAI 客户端，底层用 litellm.acompletion（懒加载）
    """
    
    def __init__(
        self, 
        api_key: str, 
        base_url: Optional[str] = None,
        default_model: Optional[str] = "claude-3-5-sonnet-20241022",
        http_client: Optional[httpx.AsyncClient] = None,
        timeout: Optional[float] = None,
        max_retries: Optional[int] = None,
        **kwargs
    ):
        self.api_key = api_key
        self.base_url = base_url  
        self.default_model = default_model
        self.http_client = http_client
        self.timeout = timeout
        self.max_retries = max_retries
        self._extra_kwargs = kwargs
        self._litellm_module = None  # Cache the litellm module

    @property
    def _litellm(self):
        """懒加载 litellm，第一次调用时才 import"""
        if self._litellm_module is None:
            import litellm
            self._litellm_module = litellm
            # Optional: configure litellm (e.g. disable logging)
            # litellm.set_verbose = False
            # litellm.suppress_debug_info = True
        return self._litellm_module

    @property
    def models(self):
        return self._ModelsResource(self)

    class _ModelsResource:
        def __init__(self, parent: "AsyncClaudeAsOpenAI"):
            self._parent = parent

        async def list(self):
            # Build an object compatible with the OpenAI response shape
            class ModelItem:
                def __init__(self, model_id: str):
                    self.id = model_id

            class ModelList:
                def __init__(self, data: list):
                    self.data = data

            # Handle the request URL; Anthropic's list-models endpoint is usually /v1/models
            base_url = self._parent.base_url or "https://api.anthropic.com"
            if base_url.endswith("/v1") or base_url.endswith("/v1/"):
                url = f"{base_url.rstrip('/')}/models"
            else:
                url = f"{base_url.rstrip('/')}/v1/models"

            headers = {
                "x-api-key": self._parent.api_key,
                "anthropic-version": "2023-06-01"
            }

            try:
                # Prefer reusing the global http_client so it follows the system proxy config
                client = self._parent.http_client
                need_close = False
                if not client:
                    client = httpx.AsyncClient()
                    need_close = True

                response = await client.get(url, headers=headers)
                
                if need_close:
                    await client.aclose()

                # If the API responds successfully
                if response.status_code == 200:
                    data = response.json()
                    # Parse the official format: {"type": "list", "data":[{"id": "claude-3-opus-...", ...}]}
                    models = [ModelItem(m["id"]) for m in data.get("data",[])]
                    if models:
                        return ModelList(models)
            except Exception as e:
                print(f"动态获取 Anthropic 模型列表失败 (可能代理/代理商不支持): {e}")

            # [Static fallback]: if the request errors or the provider's API doesn't implement /models, return common Claude models
            fallback_models =[]
            return ModelList([ModelItem(m) for m in fallback_models])

    def _convert_tools(self, tools: Optional[List[Dict]]) -> Optional[List[Dict]]:
        """OpenAI Tools -> Claude Tools"""
        if not tools:
            return None
            
        claude_tools = []
        for tool in tools:
            tool_type = tool.get("type")
            
            if tool_type == "custom":
                continue  # Not supported by Claude
            elif tool_type == "function":
                func = tool.get("function", {})
                claude_tools.append({
                    "name": func.get("name"),
                    "description": func.get("description", ""),
                    "input_schema": func.get("parameters", {"type": "object", "properties": {}})
                })
            elif tool_type in ["web_search_20250305", "web_search_20260209"]:
                claude_tools.append(tool)
                
        return claude_tools if claude_tools else None
    
    def _convert_tool_choice(self, tool_choice: Any) -> Any:
        """OpenAI tool_choice -> Claude tool_choice"""
        if tool_choice is None:
            return None
            
        if isinstance(tool_choice, str):
            return tool_choice
            
        if isinstance(tool_choice, dict) and tool_choice.get("type") == "function":
            func_name = tool_choice.get("function", {}).get("name")
            if func_name:
                return {"type": "tool", "name": func_name}
                    
        return tool_choice

    @property
    def chat(self):
        return self._ChatResource(self)

    class _ChatResource:
        def __init__(self, parent: "AsyncClaudeAsOpenAI"):
            self.completions = self._CompletionsResource(parent)

        class _CompletionsResource:
            def __init__(self, parent: "AsyncClaudeAsOpenAI"):
                self._parent = parent

            @staticmethod
            def _inject_cache_control(messages):
                """Attach an ephemeral cache_control breakpoint to the last system
                message so Anthropic caches the tools + system prefix. Best-effort:
                any failure leaves messages untouched."""
                try:
                    if not messages:
                        return messages
                    sys_idx = None
                    for i, m in enumerate(messages):
                        if isinstance(m, dict) and m.get("role") == "system":
                            sys_idx = i
                    if sys_idx is None:
                        return messages
                    new_messages = list(messages)
                    m = dict(new_messages[sys_idx])
                    content = m.get("content")
                    if isinstance(content, str):
                        if not content.strip():
                            return messages
                        m["content"] = [{
                            "type": "text",
                            "text": content,
                            "cache_control": {"type": "ephemeral"},
                        }]
                    elif isinstance(content, list) and content:
                        blocks = [dict(b) if isinstance(b, dict) else b for b in content]
                        for b in reversed(blocks):
                            if isinstance(b, dict) and b.get("type", "text") == "text":
                                b["cache_control"] = {"type": "ephemeral"}
                                break
                        else:
                            if isinstance(blocks[-1], dict):
                                blocks[-1]["cache_control"] = {"type": "ephemeral"}
                        m["content"] = blocks
                    else:
                        return messages
                    new_messages[sys_idx] = m
                    return new_messages
                except Exception:
                    return messages

            async def create(
                self,
                model: Optional[str] = None,
                messages: Optional[List[Dict[str, Any]]] = None,
                temperature: Optional[float] = None,
                max_tokens: Optional[int] = None,
                stream: bool = False,
                top_p: Optional[float] = None,
                stop: Optional[Union[str, List[str]]] = None,
                tools: Optional[List[Dict]] = None,
                tool_choice: Optional[Any] = None,
                **kwargs
            ):
                model = model or self._parent.default_model
                if not model:
                    raise ValueError("model is required")

                if not model.startswith("anthropic/"):
                    model = f"anthropic/{model}"

                # ===== Lazy-load litellm =====
                litellm = self._parent._litellm

                # Anthropic prompt caching: mark the (tools + system) prefix as
                # cacheable so repeated requests read it at ~0.1x cost. Only the
                # native litellm path runs this; OpenAI/other vendors are untouched.
                messages = self._inject_cache_control(messages)

                completion_kwargs = {
                    "model": model,
                    "messages": messages,
                    "api_key": self._parent.api_key,
                    "stream": stream,
                }
                
                # Tools conversion
                if tools:
                    converted_tools = self._parent._convert_tools(tools)
                    if converted_tools:
                        completion_kwargs["tools"] = converted_tools
                        
                if tool_choice:
                    completion_kwargs["tool_choice"] = self._parent._convert_tool_choice(tool_choice)
                
                # Other parameters
                if self._parent.base_url:
                    completion_kwargs["api_base"] = self._parent.base_url
                if temperature is not None:
                    completion_kwargs["temperature"] = temperature
                if max_tokens is not None:
                    completion_kwargs["max_tokens"] = max_tokens
                if top_p is not None:
                    completion_kwargs["top_p"] = top_p
                if stop is not None:
                    completion_kwargs["stop"] = stop
                if self._parent.timeout is not None:
                    completion_kwargs["timeout"] = self._parent.timeout
                if self._parent.http_client is not None:
                    completion_kwargs["client"] = self._parent.http_client

                # Filter out OpenAI-specific parameters
                safe_kwargs = {k: v for k, v in kwargs.items() 
                              if k not in ['logprobs', 'top_logprobs', 'response_format', 'n']}
                
                return await litellm.acompletion(**completion_kwargs, **safe_kwargs)