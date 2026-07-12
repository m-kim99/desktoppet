import base64
import json
import aiohttp
from urllib.parse import urlparse
from py.get_setting import load_settings, get_host, get_port # Make sure these two functions are imported
from openai import AsyncOpenAI

from py.load_files import check_robots_txt, is_private_ip, sanitize_url

# ================= Security config =================

# Recommended to include the project URL so site owners can identify it
USER_AGENT = "Mozilla/5.0 (compatible; OpenSourceImageBot/1.0)"
ROBOTS_CACHE = {}

# ================= Core feature changes =================

async def get_image_base64(image_url: str) -> str:
    """
    Download an image and convert it to base64
    - Internal: only allow the 'uploaded_files' path and redirect to local
    - External: respect robots.txt and block intranet IPs (allow fake-IPs)
    """
    parsed_url = urlparse(image_url)
    
    # --- Scenario 1: internal file-path handling ---
    if 'uploaded_files' in parsed_url.path:
        HOST = get_host()
        PORT = get_port()
        if HOST == '0.0.0.0': HOST = '127.0.0.1'
        
        # [Security action] use sanitize_url to force-rewrite netloc, cutting off the raw input flow
        safe_target_url = sanitize_url(image_url, force_netloc=f"{HOST}:{PORT}")
    
    # --- Scenario 2: public-internet URL crawling ---
    else:
        # A. SSRF security block
        if is_private_ip(parsed_url.hostname):
            raise PermissionError(f"安全拒绝: 不允许从内部网络获取图像 ({parsed_url.hostname})")
        
        # B. Robots.txt check
        if not await check_robots_txt(image_url):
            raise PermissionError(f"合规拒绝: 目标网站禁止爬虫抓取该图像")
            
        # C. [Security action] sanitize the external URL into a scanner-approved safe_url
        safe_target_url = sanitize_url(image_url)

    # --- Perform the download ---
    async with aiohttp.ClientSession() as session:
        # Always issue the request using safe_target_url
        headers = {'User-Agent': USER_AGENT}
        try:
            async with session.get(safe_target_url, headers=headers, timeout=20) as response:
                if response.status != 200:
                    raise ValueError(f"无法下载图片: HTTP {response.status}")
                    
                image_data = await response.read()
                return base64.b64encode(image_data).decode('utf-8')
        except Exception as e:
            raise RuntimeError(f"图像获取失败: {str(e)}")

async def get_llm_tool(settings):
    llm_list = []

    llmTools = settings['llmTools']

    for llmTool in llmTools:
        if llmTool['enabled']:
            llm_list.append({"name": llmTool['name'], "description": llmTool['description']})
    if len(llm_list) > 0:
        llm_list = json.dumps(llm_list, ensure_ascii=False, indent=4)
        llm_tool = {
            "type": "function",
            "function": {
                "name": "custom_llm_tool",
                "description": f"The custom_llm_tool tool can call the general tools in the tool list. Do not confuse custom_llm_tool with the tool name to fill in the tool_name field. Here is the tool list:\n{llm_list}\n\nIf an LLM tool returns content containing an image, write the returned image URL or local path directly as ![image](image URL) and send it to the user so they can see the image",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "tool_name": {
                            "type": "string",
                            "description": "The name of the tool to call",
                        },
                        "query": {
                            "type": "string",
                            "description": "The question to send to the tool",
                        },
                        "image_url": {
                            "type": "string",
                            "description": "The image URL to send to the tool, optional. A URL from the local server can also be provided (e.g. http://127.0.0.1:3456/xxx.jpg) and will be automatically converted to base64 before sending",
                        }
                    },
                    "required": ["tool_name","query"]
                }
            }
        }
        return llm_tool
    else:
        return None
        
async def get_image_media_type(image_url: str) -> str:
    # Adjust based on the image_url type
    if image_url.endswith('.png'):
        media_type = 'image/png'
    elif image_url.endswith('.jpg') or image_url.endswith('.jpeg'):
        media_type = 'image/jpeg'
    elif image_url.endswith('.webp'):
        media_type = 'image/webp'
    elif image_url.endswith('.gif'):
        media_type = 'image/gif'
    elif image_url.endswith('.bmp'):
        media_type = 'image/bmp'
    elif image_url.endswith('.tiff'):
        media_type = 'image/tiff'
    elif image_url.endswith('.ico'):
        media_type = 'image/x-icon'
    elif image_url.endswith('.svg'):
        media_type = 'image/svg+xml'
    else:
        media_type = 'image/png'
    return media_type

async def custom_llm_tool(tool_name, query, image_url=None):
    print(f"Calling LLM tool:{tool_name}")
    settings = await load_settings()
    llmTools = settings['llmTools']
    for llmTool in llmTools:
        if llmTool['enabled'] and llmTool['name'] == tool_name:
            if llmTool['type'] == 'ollama':
                from ollama import AsyncClient as OllamaClient
                client = OllamaClient(host=llmTool['base_url'])
                try:
                    content = query
                    
                    # Handle image input
                    if image_url:
                        base64_image = await get_image_base64(image_url)
                        media_type = await get_image_media_type(image_url)
                        content = [
                            {"type": "text", "text": query},
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": media_type,
                                    "data": base64_image
                                }
                            }
                        ]

                    # Call the Ollama API
                    response = await client.chat(
                        model=llmTool['model'],
                        messages=[{"role": "user", "content": content}],
                    )
                    return response.message.content
                except Exception as e:
                    return str(e)
            else:
                client = AsyncOpenAI(api_key=llmTool['api_key'],base_url=llmTool['base_url'])
                try:
                    if image_url:
                        base64_image = await get_image_base64(image_url)
                        # Adjust based on the image_url type
                        media_type = await get_image_media_type(image_url)
                        prompt = [
                            {
                                "type": "image",
                                "image_url": {"url": f"data:{media_type};base64,{base64_image}"},
                            },
                            {
                                "type": "text",
                                "text": query
                            }
                        ]
                        response = await client.chat.completions.create(
                            model=llmTool['model'],
                            messages=[
                                {"role": "user", "content": prompt},
                            ],
                        )
                    else:
                        response = await client.chat.completions.create(
                            model=llmTool['model'],
                            messages=[
                                {"role": "user", "content": query},
                            ],
                        )
                    return response.choices[0].message.content
                except Exception as e:
                    return str(e)