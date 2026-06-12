import requests
from typing import List, Optional, Union
from py.get_setting import load_settings


# Default base URL
DEFAULT_BASE_URL = "https://topics-after-party.zeabur.app"

async def get_random_topics(
    locale: str = "en-US",
    limit: int = 1,
    mood: Optional[str] = None,
    depth: Optional[int] = None,
    category: Optional[str] = None,
    exclude: Optional[Union[str, List[str]]] = None
) -> str:  # Note: the return type hint changed from dict to str
    """
    Get a random topic and return formatted Markdown text
    """
    try:
        settings = await load_settings() # Assume this is your config-loading logic
        base_url = settings["tools"]["randomTopic"].get("baseURL", DEFAULT_BASE_URL)
        endpoint = f"{base_url}/api/topic"
        
        if isinstance(exclude, list):
            exclude = ",".join(exclude)

        params = {
            "locale": locale,
            "limit": limit,
            "mood": mood,
            "depth": depth,
            "category": category,
            "exclude": exclude
        }
        
        params = {k: v for k, v in params.items() if v is not None}

        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }

        # Send the request
        response = requests.get(endpoint, params=params, headers=headers)
        response.raise_for_status()
        
        # --- Parsing logic begins ---
        res_json = response.json()
        
        # 1. Check the API status code
        if res_json.get("code") != 200:
            return f"❌ 获取话题失败: API 返回错误代码 {res_json.get('code')}"

        data_list = res_json.get("data", [])
        
        # 2. If there's no data
        if not data_list:
            return "📭 No matching topic found."

        # 3. Format as Markdown
        md_output = []
        for idx, item in enumerate(data_list, 1):
            # Extract fields
            text = item.get("text", "")
            cat = item.get("category", "Unknown")
            tags = item.get("tags", [])
            follow_ups = item.get("follow_ups", [])
            # mood = item.get("mood", "") # Optional: whether to display mood

            # Build a single topic block
            # Format: 1. [category] topic content
            topic_str = f"\n\n{idx}. **[{cat}]** {text}"
            
            # Add tags (optional)
            if tags:
                tag_str = " ".join([f"`#{t}`" for t in tags])
                topic_str += f"\n\n   > 🏷️ {tag_str}"
            
            # Add follow-up questions (optional)
            if follow_ups:
                topic_str += "\n\n   > 🗣️ **Follow-up reference**: "
                for fu in follow_ups:
                    topic_str += f"\n\n   > - {fu}"

            md_output.append(topic_str)

        # Join with double newlines to keep paragraph spacing
        return "\n\n".join(md_output)
        # --- Parsing logic ends ---

    except requests.exceptions.RequestException as e:
        print(f"请求发生错误: {e}")
        return f"⚠️ 网络请求错误: {str(e)}"
    except Exception as e:
        return f"⚠️ 处理数据时发生错误: {str(e)}"
    
async def get_categories(
    locale: str = "en-US"
) -> List[str]:
    """
    Get Category List
    
    Args:
        locale (str): the language for returned category names, either 'zh-CN' or 'en-US'. Default 'en-US'.
        base_url (str): the API base URL.

    Returns:
        List[str]: the list of category names.
    """
    try:
        settings = await load_settings()

        base_url = settings["tools"]["randomTopic"].get("baseURL", DEFAULT_BASE_URL)
        endpoint = f"{base_url}/api/categories"
        
        params = {
            "locale": locale
        }

        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }

        response = requests.get(endpoint, params=params, headers=headers)
        response.raise_for_status()
        data = response.json()
        return data.get("data", [])
    except requests.exceptions.RequestException as e:
        print(f"请求发生错误: {e}")
        return []
    

random_topics_tools = [
    {
        "type": "function",
        "function": {
            "name": "get_random_topics",
            "description": "Get a random chat topic, icebreaker question, or deep conversation theme. Use it when the user wants to start a conversation, feels bored, or wants to get to know someone better.",
            "parameters": {
                "type": "object",
                "properties": {
                    "locale": {
                        "type": "string",
                        "enum": ["zh-CN", "en-US"],
                        "description": "The topic's locale. Use 'zh-CN' for Chinese and 'en-US' for English. Default 'en-US'.",
                        "default": "en-US"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "The number of topics to get at once, default 1.",
                        "default": 1
                    },
                    "mood": {
                        "type": "string",
                        "enum": ["positive", "neutral", "curious", "flirty"],
                        "description": "The emotional tone of the topic. positive: upbeat; neutral: neutral/general; curious: curious/exploratory; flirty: flirtatious."
                    },
                    "depth": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 5,
                        "description": "The topic's depth level (1-5). 1 is light small talk, 5 is a deep soul-searching question."
                    },
                    "category": {
                        "type": "string",
                        "description": "A specific topic category (e.g. 'Life', 'Love'). It's recommended to call get_categories first to get the available categories."
                    }
                },
                "required": [] 
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_categories",
            "description": "Get the list of currently available topic categories. When the user wants to choose a specific type of chat topic, call this function first to see which categories exist.",
            "parameters": {
                "type": "object",
                "properties": {
                    "locale": {
                        "type": "string",
                        "enum": ["zh-CN", "en-US"],
                        "description": "The language for category names. Use 'zh-CN' for Chinese and 'en-US' for English.",
                        "default": "en-US"
                    }
                },
                "required": []
            }
        }
    }
]    