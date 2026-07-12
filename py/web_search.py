import asyncio
import json
import os
import time
from bs4 import BeautifulSoup
from langchain_community.tools import DuckDuckGoSearchResults
import requests
from tavily import TavilyClient
from py.get_setting import load_settings
from py.load_files import check_robots_txt

async def DDGsearch(query):
    settings = await load_settings()
    def sync_search():
        max_results = settings['webSearch']['duckduckgo_max_results'] or 10
        try:
            dds = DuckDuckGoSearchResults(num_results=max_results,output_format="json")
            results = dds.invoke(query)
            return results
        except Exception as e:
            print(f"An error occurred: {e}")
            return ""

    try:
        # Use the default executor to run the synchronous operation in a separate thread
        return await asyncio.get_event_loop().run_in_executor(None, sync_search)
    except Exception as e:
        print(f"Event loop error: {e}")
        return ""
    
duckduckgo_tool = {
    "type": "function",
    "function": {
        "name": "DDGsearch",
        "description": f"Get information from DuckDuckGo search using keywords.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The keywords to search for; can be multiple words, separated by spaces.",
                },
            },
            "required": ["query"],
        },
    },
}

async def searxng(query,categories="general"):
    settings = await load_settings()
    def sync_search(query):
        max_results = settings['webSearch']['searxng_max_results'] or 10
        api_url = settings['webSearch']['searxng_url'] or "http://127.0.0.1:8080"
        engines = settings['webSearch']['searxng_engines'] or None
        is_select = settings['webSearch']['searxng_is_select'] or False
        headers = {"User-Agent": "Mozilla/5.0"}
        params = {
            "q": query, 
            "categories": categories,
            "count": max_results
        }
        if engines and is_select:
            params["engines"] = engines

        try:
            response = requests.get(api_url + "/search", headers=headers, params=params)
            html_content = response.text

            soup = BeautifulSoup(html_content, 'html.parser')
            results = []

            for result in soup.find_all('article', class_='result'):
                title = result.find('h3').get_text() if result.find('h3') else 'No title'
                
                # Fix: use the correct selector
                link_elem = result.find('a', class_='url_header')
                if not link_elem:
                    # Fallback: get it from the link inside the h3
                    h3 = result.find('h3')
                    link_elem = h3.find('a') if h3 else None
                
                link = link_elem['href'] if link_elem and link_elem.get('href') else 'No link'
                
                snippet = result.find('p', class_='content').get_text() if result.find('p', class_='content') else 'No snippet'
                
                results.append({
                    'title': title,
                    'link': link,
                    'snippet': snippet
                })

            return json.dumps(results, indent=2, ensure_ascii=False)
            
        except Exception as e:
            print(f"Search error: {e}")
            return f"Search error: {e}"

    try:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, sync_search, query)
    except Exception as e:
        print(f"Async error: {e}")
        return f"Async error: {e}"

searxng_tool = {
    "type": "function",
    "function": {
        "name": "searxng",
        "description": "Fetch web information via the SearXNG open-source meta search engine.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search keywords; supports natural language and multi-keyword combined queries",
                },
                "categories": {
                    "type": "string",
                    "description": "Search category; choose the most appropriate one based on user intent. Options: 'general' (general/default, good for most encyclopedic and common-knowledge queries), 'news' (good for recent events), 'images' (good for finding images), 'videos' (good for finding video resources), 'it' (IT/tech, good for code errors and programming/development), 'science' (good for academic papers and scientific material).",
                    "enum": ["general", "news", "images", "videos", "it", "science"],
                    "default": "general"
                },
            },
            "required": ["query"],
        },
    },
}

async def bochaai_search(query):
    settings = await load_settings()
    def sync_search():
        max_results = settings['webSearch']['bochaai_max_results'] or 10
        api_key = settings['webSearch'].get('bochaai_api_key', "")
        
        if not api_key:
            return "API key not configured"

        url = "https://api.bochaai.com/v1/web-search"
        headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json'
        }
        payload = json.dumps({
            "query": query,
            "summary": True,
            "count": max_results
        })

        try:
            response = requests.post(url, headers=headers, data=payload, timeout=30)
            if response.status_code == 200:
                result_data = response.json()
                
                # Parse the new API response format
                formatted_results = []
                search_results = result_data.get('data', {}).get('webPages', {}).get('value', [])
                
                for item in search_results:
                    # Build richer result info
                    formatted_item = {
                        'title': item.get('name', 'No title'),
                        'link': item.get('url', ''),
                        'displayUrl': item.get('displayUrl', ''),
                        'snippet': item.get('snippet', 'No content summary'),
                        'siteName': item.get('siteName', 'Unknown source'),
                    }
                    # Auto-generate a concise source name
                    if not formatted_item['siteName']:
                        formatted_item['siteName'] = formatted_item['displayUrl'].split('//')[-1].split('/')[0]
                    formatted_results.append(formatted_item)
                
                return json.dumps(formatted_results, indent=2, ensure_ascii=False)
            else:
                return f"请求失败，状态码：{response.status_code}，响应内容：{response.text}"
        except Exception as e:
            print(f"Bocha search error: {str(e)}")
            return ""

    try:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, sync_search)
    except Exception as e:
        print(f"Async execution error: {e}")
        return ""

bochaai_tool = {
    "type": "function",
    "function": {
        "name": "bochaai_search",
        "description": "Fetch web information via the Bocha smart-search API, with deep semantic understanding.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The natural-language query to search for; supports complex semantics and long sentences (example: key points of Alibaba's latest earnings report)",
                }
            },
            "required": ["query"],
        },
    }
}

async def Tavily_search(query):
    settings = await load_settings()
    def sync_search():
        max_results = settings['webSearch']['tavily_max_results'] or 10
        try:
            api_key = settings['webSearch'].get('tavily_api_key', "")
            client = TavilyClient(api_key)
            response = client.search(
                query=query,
                max_results=max_results
            )
            return json.dumps(response, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"Tavily search error: {e}")
            return ""

    try:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, sync_search)
    except Exception as e:
        print(f"Async execution error: {e}")
        return ""

tavily_tool = {
    "type": "function",
    "function": {
        "name": "Tavily_search",
        "description": "Fetch high-quality web information via the Tavily professional search API; especially good for real-time data and professional analysis.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The keywords or natural-language query to search for",
                }
            },
            "required": ["query"],
        },
    },
}

from langchain_community.utilities import BingSearchAPIWrapper

async def Bing_search(query):
    settings = await load_settings()
    def sync_search():
        max_results = settings['webSearch']['bing_max_results'] or 10
        try:
            api_key = settings['webSearch'].get('bing_api_key', "")
            bing_search_url = settings['webSearch'].get('bing_search_url', "")
            client = BingSearchAPIWrapper(bing_subscription_key=api_key,bing_search_url=bing_search_url)
            response = client.results(query=query,num_results=max_results)
            return json.dumps(response, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"Bing search error: {e}")
            return ""

    try:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, sync_search)
    except Exception as e:
        print(f"Async execution error: {e}")
        return ""


bing_tool = {
    "type": "function",
    "function": {
        "name": "Bing_search",
        "description": "Fetch web information via the Bing search API.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The keywords or natural-language query to search for",
                }
            },
            "required": ["query"],
        },
    }
}

from langchain_google_community import GoogleSearchAPIWrapper

async def Google_search(query):
    settings = await load_settings()
    def sync_search():
        max_results = settings['webSearch']['google_max_results'] or 10
        try:
            api_key = settings['webSearch'].get('google_api_key', "")
            google_cse_id = settings['webSearch'].get('google_cse_id', "")
            client = GoogleSearchAPIWrapper(google_api_key=api_key,google_cse_id=google_cse_id)
            response = client.results(query=query,num_results=max_results)
            return json.dumps(response, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"Google search error: {e}")
            return ""

    try:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, sync_search)
    except Exception as e:
        print(f"Async execution error: {e}")
        return ""


google_tool = {
    "type": "function",
    "function": {
        "name": "Google_search",
        "description": "Fetch web information via the Google search API.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The keywords or natural-language query to search for",
                }
            },
            "required": ["query"],
        }
    }
}

from langchain_community.tools import BraveSearch

async def Brave_search(query):
    settings = await load_settings()
    def sync_search():
        max_results = settings['webSearch']['brave_max_results'] or 10
        try:
            api_key = settings['webSearch'].get('brave_api_key', "")
            client = BraveSearch.from_api_key(api_key=api_key, search_kwargs={"count": max_results})
            response = client.run(query)
            return response
        except Exception as e:
            print(f"Brave search error: {e}")
            return ""

    try:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, sync_search)
    except Exception as e:
        print(f"Async execution error: {e}")
        return ""
    
brave_tool = {
    "type": "function",
    "function": {
        "name": "Brave_search",
        "description": "Fetch web information via the Brave search API.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The keywords or natural-language query to search for",
                }
            },
            "required": ["query"],
        },
    }
}

from langchain_exa import ExaSearchResults
async def Exa_search(query):
    settings = await load_settings()
    def sync_search():
        max_results = settings['webSearch']['exa_max_results'] or 10
        try:
            api_key = settings['webSearch'].get('exa_api_key', "")
            client = ExaSearchResults(exa_api_key=api_key)
            response = client._run(
                query=query,
                num_results=max_results,
            )
            # Determine the response type
            if type(response) == list or type(response) == dict:
                return json.dumps(response, indent=2, ensure_ascii=False)
            elif type(response) == str:
                return response
        except Exception as e:
            print(f"Exa search error: {e}")
            return ""

    try:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, sync_search)
    except Exception as e:
        print(f"Async execution error: {e}")
        return ""

exa_tool = {
    "type": "function", 
    "function": {
        "name": "Exa_search",
        "description": "Fetch web information via the Exa search API.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The keywords or natural-language query to search for",
                }
            },
            "required": ["query"],
            }
    }
}

from langchain_community.utilities import GoogleSerperAPIWrapper

async def Serper_search(query):
    settings = await load_settings()
    def sync_search():
        max_results = settings['webSearch']['serper_max_results'] or 10
        try:
            api_key = settings['webSearch'].get('serper_api_key', "")
            client = GoogleSerperAPIWrapper(serper_api_key=api_key,k=max_results)
            response = client.results(query)
            return json.dumps(response, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"Serper search error: {e}")
            return ""

    try:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, sync_search)
    except Exception as e:
        print(f"Async execution error: {e}")
        return ""
    
serper_tool = {
    "type": "function",
    "function": {
        "name": "Serper_search",
        "description": "Fetch web information via the Serper search API.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The keywords or natural-language query to search for",
                }
            },
            "required": ["query"],
        },
    }
}

async def jina_crawler(original_url):
    settings = await load_settings()
    def sync_crawler():
        detail_url = "https://r.jina.ai/"
        url = f"{detail_url}{original_url}"
        try:
            jina_api_key = settings['webSearch'].get('jina_api_key', "")
            if jina_api_key:
                headers = {
                    'Authorization': f'Bearer {jina_api_key}',
                }
                response = requests.get(url, headers=headers)
            else:
                response = requests.get(url)
            if response.status_code == 200:
                return response.text
            else:
                return f"获取{original_url}网页信息失败，状态码：{response.status_code}"
        except requests.RequestException as e:
            return f"获取{original_url}网页信息失败，错误信息：{str(e)}"

    try:
        if not await check_robots_txt(original_url):
            raise PermissionError(f"Compliance rejection: the target site forbids scraping")
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, sync_crawler)
    except Exception as e:
        print(f"Async execution error: {e}")
        return str(e)

jina_crawler_tool = {
    "type": "function",
    "function": {
        "name": "jina_crawler",
        "description": "Fetch the web-page content of a given URL via Jina AI's web-scraping API. The URL can be a link returned by another search engine or one provided by the user. But do not pass URLs starting with localhost or intranet addresses, because Jina cannot reach them.",
        "parameters": {
            "type": "object",
            "properties": {
                "original_url": {
                    "type": "string",
                    "description": "The original URL to scrape.",
                },
            },
            "required": ["original_url"],
        },
    },
}

class Crawl4AiTester:
    def __init__(self, base_url: str = "http://localhost:11235"):
        self.base_url = base_url

    def submit_and_wait(self, request_data: dict,headers: dict = None, timeout: int = 300) -> dict:
        # Submit crawl job
        response = requests.post(f"{self.base_url}/crawl", json=request_data,headers=headers)
        task_id = response.json()["task_id"]
        print(f"Task ID: {task_id}")

        # Poll for result
        start_time = time.time()
        while True:
            if time.time() - start_time > timeout:
                raise TimeoutError(f"Task {task_id} timeout")

            result = requests.get(f"{self.base_url}/task/{task_id}",headers=headers)
            status = result.json()

            if status["status"] == "completed":
                return status

            time.sleep(2)

async def Crawl4Ai_search(original_url):
    settings = await load_settings()
    def sync_search():
        try:
            tester = Crawl4AiTester()
            api_key = settings['webSearch'].get('Crawl4Ai_api_key', "test_api_code")
            headers = {"Authorization": f"Bearer {api_key}"} if api_key else None
            request = {
                "urls": original_url,
                "priority": 10
            }
            result = tester.submit_and_wait(request, headers=headers)
            return result['result']['markdown']
        except Exception as e:
            return f"获取{original_url}网页信息失败，错误信息：{str(e)}"

    try:
        if not await check_robots_txt(original_url):
            raise PermissionError(f"Compliance rejection: the target site forbids scraping")
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, sync_search)
    except Exception as e:
        print(f"Async execution error: {e}")
        return str(e)

Crawl4Ai_tool = {
    "type": "function",
    "function": {
        "name": "Crawl4Ai_search",
        "description": "Scrape the web-page content of a given URL via the Crawl4Ai service, returning text in Markdown format.",
        "parameters": {
            "type": "object",
            "properties": {
                "original_url": {
                    "type": "string",
                    "description": "The target URL to scrape.",
                }
            },
            "required": ["original_url"],
        },
    },
}

from typing import Optional, Dict, Any

# ============== 2. Firecrawl ==============

class FirecrawlClient:
    """
    Firecrawl API client
    Supports the official API and self-hosted instances
    """
    
    def __init__(self, base_url: str, api_key: Optional[str] = None):
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.headers = {
            'Content-Type': 'application/json',
        }
        if api_key:
            self.headers['Authorization'] = f'Bearer {api_key}'
    
    def _get_api_path(self, endpoint: str) -> str:
        """Automatically determine the API version path from the base URL"""
        if '/v2/' in self.base_url:
            # Official API v2
            return f"{self.base_url}/{endpoint}"
        elif '/v1/' in self.base_url:
            # Self-hosted is usually v1
            return f"{self.base_url}/{endpoint}"
        else:
            # Default appended path
            return f"{self.base_url}/{endpoint}"
    
    def scrape(self, url: str, formats: list = None, **kwargs) -> Dict[str, Any]:
        """
        Single-page scrape
        """
        formats = formats or ["markdown"]
        endpoint = self._get_api_path("scrape")
        
        payload = {
            "url": url,
            "formats": formats,
            **kwargs
        }
        
        response = requests.post(
            endpoint,
            headers=self.headers,
            json=payload,
            timeout=60
        )
        response.raise_for_status()
        return response.json()
    
    def crawl(self, url: str, limit: int = 10, **kwargs) -> str:
        """
        Full-site crawl - asynchronous job, requires polling
        """
        # Submit the crawl task
        submit_endpoint = self._get_api_path("crawl")
        payload = {
            "url": url,
            "limit": limit,
            **kwargs
        }
        
        submit_resp = requests.post(
            submit_endpoint,
            headers=self.headers,
            json=payload,
            timeout=30
        )
        submit_resp.raise_for_status()
        job_data = submit_resp.json()
        
        if not job_data.get("success"):
            raise Exception(f"Failed to submit crawl job: {job_data}")
        
        job_id = job_data.get("id")
        check_url = job_data.get("url") or f"{self.base_url}/crawl/{job_id}"
        
        # Poll until completion
        max_wait = 300  # 5-minute timeout
        interval = 2
        start_time = time.time()
        
        while time.time() - start_time < max_wait:
            status_resp = requests.get(
                check_url,
                headers=self.headers,
                timeout=30
            )
            status_resp.raise_for_status()
            status_data = status_resp.json()
            
            if status_data.get("status") == "completed":
                return status_data
            elif status_data.get("status") == "failed":
                raise Exception(f"Crawl job failed: {status_data.get('error', 'Unknown error')}")
            
            time.sleep(interval)
        
        raise TimeoutError(f"Crawl job {job_id} timeout after {max_wait}s")
    
    def search(self, query: str, limit: int = 5, scrape_options: dict = None) -> Dict[str, Any]:
        """
        Search
        """
        endpoint = self._get_api_path("search")
        
        payload = {
            "query": query,
            "limit": limit
        }
        if scrape_options:
            payload["scrapeOptions"] = scrape_options
        
        response = requests.post(
            endpoint,
            headers=self.headers,
            json=payload,
            timeout=60
        )
        response.raise_for_status()
        return response.json()
    
    def map(self, url: str, search: str = None) -> Dict[str, Any]:
        """
        Sitemap (Map)
        """
        endpoint = self._get_api_path("map")
        
        payload = {"url": url}
        if search:
            payload["search"] = search
        
        response = requests.post(
            endpoint,
            headers=self.headers,
            json=payload,
            timeout=60
        )
        response.raise_for_status()
        return response.json()


async def firecrawl_search(original_url: str, query: str = None) -> str:
    """
    Firecrawl main function
    Supports multiple modes: scrape (single page), crawl (full site), search, map (sitemap)
    """
    settings = await load_settings()
    
    def sync_crawler():
        try:
            # Get the config
            base_url = settings['webSearch'].get('firecrawl_url', 'https://api.firecrawl.dev/v2')
            api_key = settings['webSearch'].get('firecrawl_api_key', '')
            mode = settings['webSearch'].get('firecrawl_mode', 'scrape')
            
            # Initialize the client
            client = FirecrawlClient(base_url, api_key)
            
            # Perform different actions based on the mode
            if mode == 'scrape':
                # Single-page scrape
                result = client.scrape(
                    original_url,
                    formats=["markdown", "html"],
                    onlyMainContent=True  # Get only the main content
                )
                
                if result.get("success") and result.get("data"):
                    data = result["data"]
                    markdown = data.get("markdown", "")
                    metadata = data.get("metadata", {})
                    title = metadata.get("title", "Untitled page")
                    
                    return f"# {title}\n\n{markdown}"
                else:
                    return f"Firecrawl抓取失败：{result.get('error', 'Unknown error')}"
            
            elif mode == 'crawl':
                # Full-site crawl
                result = client.crawl(
                    original_url,
                    limit=10,  # Limit the page count to avoid excessive length
                    scrapeOptions={
                        "formats": ["markdown"],
                        "onlyMainContent": True
                    }
                )
                
                if result.get("status") == "completed":
                    pages = result.get("data", [])
                    total = result.get("total", 0)
                    
                    content_parts = [f"# 站点爬取结果\n\n共获取 {total} 个页面：\n"]
                    
                    for i, page in enumerate(pages[:5], 1):  # Show at most 5 pages
                        md = page.get("markdown", "")
                        meta = page.get("metadata", {})
                        title = meta.get("title", f"页面{i}")
                        url = meta.get("sourceURL", original_url)
                        
                        content_parts.append(f"\n## {title}\n{md[:2000]}...\n[来源]({url})")
                    
                    return "\n".join(content_parts)
                else:
                    return f"Firecrawl爬取失败：{result.get('error', 'Unknown error')}"
            
            elif mode == 'search':
                # Search mode - when a query term is passed instead of a URL
                search_query = query or original_url  # If no separate query is provided, use the URL as the query term
                result = client.search(
                    search_query,
                    limit=5,
                    scrape_options={"formats": ["markdown"]}
                )
                
                if result.get("success") and result.get("data"):
                    items = result["data"]
                    content_parts = [f"# 搜索结果: {search_query}\n"]
                    
                    for i, item in enumerate(items, 1):
                        title = item.get("title", "No title")
                        url = item.get("url", "")
                        desc = item.get("description", "")
                        markdown = item.get("markdown", "")
                        
                        content_parts.append(f"\n## {i}. {title}\n{desc}\n")
                        if markdown:
                            content_parts.append(f"{markdown[:1500]}...")
                        content_parts.append(f"[来源]({url})")
                    
                    return "\n".join(content_parts)
                else:
                    return f"Firecrawl搜索失败：{result.get('error', 'Unknown error')}"
            
            elif mode == 'map':
                # Sitemap mode
                result = client.map(original_url)
                
                if result.get("success") and result.get("links"):
                    links = result["links"]
                    content_parts = [f"# 网站地图: {original_url}\n\n发现 {len(links)} 个链接：\n"]
                    
                    for link in links[:20]:  # Limit the number shown
                        title = link.get("title", "No title")
                        url = link.get("url", "")
                        desc = link.get("description", "")
                        content_parts.append(f"- [{title}]({url}) - {desc}")
                    
                    return "\n".join(content_parts)
                else:
                    return f"Firecrawl地图生成失败：{result.get('error', 'Unknown error')}"
            
            else:
                return f"未知的Firecrawl模式: {mode}"
                
        except requests.RequestException as e:
            return f"Firecrawl请求失败：{str(e)}"
        except Exception as e:
            return f"Firecrawl处理失败：{str(e)}"

    try:
        # The self-hosted Firecrawl usually doesn't need a robots.txt check (handled internally by the service)
        # But for the official API it's recommended to keep the check
        settings = await load_settings()
        base_url = settings['webSearch'].get('firecrawl_url', '')
        
        # If using the official API, check robots.txt
        if 'api.firecrawl.dev' in base_url:
            if not await check_robots_txt(original_url):
                raise PermissionError(f"Compliance rejection: the target site forbids scraping")
        
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, sync_crawler)
    except Exception as e:
        print(f"Async execution error: {e}")
        return str(e)


firecrawl_tool = {
    "type": "function",
    "function": {
        "name": "firecrawl_search",
        "description": "Fetch web-page content via the Firecrawl service. Supports single-page scrape, full-site crawl, search, and sitemap modes. Can handle JavaScript-rendered pages and returns structured Markdown content.",
        "parameters": {
            "type": "object",
            "properties": {
                "original_url": {
                    "type": "string",
                    "description": "The URL to process, or the search query (when the mode is search).",
                },
                "query": {
                    "type": "string",
                    "description": "Optional; the specific search term when using search mode. If not provided, original_url is used as the query.",
                }
            },
            "required": ["original_url"],
        },
    },
}

from bs4 import BeautifulSoup
import re

async def simple_fetch(url):
    """
    Improved web-scraping tool that returns structured, cleaned content
    Supports scraping both intranet and external pages
    """
    def sync_fetch():
        try:
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
            response = requests.get(url, headers=headers, timeout=30)
            if response.status_code == 200:
                return response.text
            else:
                return None, f"获取{url}网页信息失败，状态码：{response.status_code}"
        except requests.RequestException as e:
            return None, f"获取{url}网页信息失败，错误信息：{str(e)}"
    
    def clean_and_extract(html_content):
        """Extract and clean HTML content, returning structured data"""
        if not html_content:
            return None
        
        soup = BeautifulSoup(html_content, 'html.parser')
        
        # Remove unwanted tags
        for tag in soup(['script', 'style', 'nav', 'footer', 'header', 'aside', 'iframe', 'noscript']):
            tag.decompose()
        
        structured_content = {
            'title': '',
            'sections': []
        }
        
        # Extract the page title
        title_tag = soup.find('title')
        if title_tag:
            structured_content['title'] = title_tag.get_text().strip()
        
        # Extract the main content area (prefer main, article, or a div whose id/class contains 'content')
        main_content = soup.find('main') or soup.find('article') or \
                      soup.find('div', {'id': re.compile(r'content|main', re.I)}) or \
                      soup.find('div', {'class': re.compile(r'content|main|article', re.I)}) or \
                      soup.body or soup
        
        # Extract all headings and paragraphs
        for element in main_content.find_all(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p']):
            text = element.get_text(separator=' ', strip=True)
            
            # Clean the text: remove extra whitespace
            text = re.sub(r'\s+', ' ', text).strip()
            
            # Filter out overly short content (likely noise)
            if len(text) < 3:
                continue
            
            if element.name.startswith('h'):
                # Heading
                level = int(element.name[1])
                structured_content['sections'].append({
                    'type': 'heading',
                    'level': level,
                    'content': text
                })
            else:
                # Paragraph
                structured_content['sections'].append({
                    'type': 'paragraph',
                    'content': text
                })
        
        return structured_content
    
    try:
        # Check robots.txt compliance
        if not await check_robots_txt(url):
            return {
                'error': 'PermissionError',
                'message': 'Compliance rejection: the target site forbids scraping'
            }
        
        loop = asyncio.get_event_loop()
        html_content = await loop.run_in_executor(None, sync_fetch)
        
        if isinstance(html_content, tuple):
            # Returns an error message
            return {
                'error': 'FetchError',
                'message': html_content[1]
            }
        
        # Clean and extract structured content
        structured_data = clean_and_extract(html_content)
        
        if not structured_data or not structured_data['sections']:
            return {
                'error': 'ParseError',
                'message': 'Could not extract valid content from the page'
            }
        
        return structured_data
        
    except Exception as e:
        return {
            'error': 'UnexpectedError',
            'message': str(e)
        }


# OpenAI function definition
simple_fetch_tool = {
    "type": "function",
    "function": {
        "name": "simple_fetch",
        "description": "Scrape the web-page content of a given URL. Supports both intranet and external addresses.",
        "parameters": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The URL to scrape.",
                },
            },
            "required": ["url"],
        },
    },
}

async def markdown_new(original_url):
    """
    Convert a web page to Markdown format via the markdown.new service
    """
    
    def sync_crawler():
        # Build the markdown.new service URL
        detail_url = "https://markdown.new/"
        url = f"{detail_url}{original_url}"
        
        try:
            # Add a basic User-Agent to avoid being blocked
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
            
            # Send the request
            response = requests.get(url, headers=headers, timeout=60)
            
            if response.status_code == 200:
                # markdown.new returns plain-text markdown content directly by default
                return response.text
            else:
                return f"获取{original_url}网页信息失败，状态码：{response.status_code}"
                
        except requests.RequestException as e:
            return f"获取{original_url}网页信息失败，错误信息：{str(e)}"

    try:
        # Check robots.txt compliance (consistent with the original logic)
        if not await check_robots_txt(original_url):
            raise PermissionError(f"Compliance rejection: the target site forbids scraping")
            
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, sync_crawler)
    except Exception as e:
        print(f"Async execution error in markdown_new: {e}")
        return str(e)
    
markdown_new_tool = {
    "type": "function",
    "function": {
        "name": "markdown_new",
        "description": "Fetch the web-page content of a given URL via the markdown.new service and automatically convert it to structured Markdown text. This tool is very lightweight and efficient, suitable for external links. Do not pass localhost or intranet addresses (they will be unreachable).",
        "parameters": {
            "type": "object",
            "properties": {
                "original_url": {
                    "type": "string",
                    "description": "The original URL to scrape. Must be a complete URL starting with http or https.",
                },
            },
            "required": ["original_url"],
        },
    },
}