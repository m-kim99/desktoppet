import asyncio
from datetime import datetime
import json
from zoneinfo import ZoneInfo  # Python built-in modules
import aiohttp
import requests
from tzlocal import get_localzone
from py.get_setting import load_settings
import wikipediaapi
import arxiv
from typing import Dict, List, Optional
# Get the local timezone (a tzinfo)
local_timezone = get_localzone()  # This returns a tzinfo

async def time(timezone: str = None):
    # If no timezone is passed, use the local one
    tz = ZoneInfo(timezone) if timezone else local_timezone
    
    # Get the current time (timezone-aware)
    now = datetime.now(tz=tz)
    
    # Format the output
    time_message = f"Current time: {now.strftime('%Y-%m-%d %H:%M:%S')}, timezone: {tz}"
    return time_message

time_tool = {
    "type": "function",
    "function": {
        "name": "time",
        "description": f"Get the current time (with timezone info)",
        "parameters": {
            "type": "object",
            "properties": {
                "timezone": {
                    "type": "string",
                    "description": "The current timezone, defaulting to the local timezone, in the format: Asia/Shanghai",
                },
            },
            "required": [],
        },
    },
}

async def _get_lat_lon(city: str) -> Dict[str, float]:
    """Returns {"latitude": xx, "longitude": yy, "timezone": "Asia/Shanghai"}"""
    url = "https://geocoding-api.open-meteo.com/v1/search"
    params = {"name": city, "count": 1, "language": "zh"}
    async with aiohttp.ClientSession() as session:
        async with session.get(url, params=params) as resp:
            if resp.status != 200:
                raise RuntimeError("Geocoding request failed")
            data = await resp.json()
    if not data.get("results"):
        raise RuntimeError(f"City not found: {city}")
    r = data["results"][0]
    return {
        "latitude": r["latitude"],
        "longitude": r["longitude"],
        "timezone": r.get("timezone", "Asia/Shanghai"),
    }


async def _call_open_meteo(lat: float, lon: float, timezone: str, forecast: bool, days: int):
    """When forecast=True, returns a 7-day forecast; otherwise returns the current real-time conditions"""
    if forecast:
        url = "https://api.open-meteo.com/v1/forecast"
        params = {
            "latitude": lat,
            "longitude": lon,
            "daily": "temperature_2m_max,temperature_2m_min,weathercode",
            "timezone": timezone,
            "forecast_days": days,
        }
    else:
        url = "https://api.open-meteo.com/v1/forecast"
        params = {
            "latitude": lat,
            "longitude": lon,
            "current_weather": "true",
            "timezone": timezone,
        }

    async with aiohttp.ClientSession() as session:
        async with session.get(url, params=params) as resp:
            if resp.status != 200:
                raise RuntimeError("Weather API request failed")
            return await resp.json()


_WCODE_MAP = {
    0: "Clear",
    1: "Cloudy",
    2: "Few clouds",
    3: "Partly cloudy",
    45: "Fog",
    48: "Rime fog",
    51: "Drizzle",
    53: "Light rain",
    55: "Moderate rain",
    61: "Light rain",
    63: "Moderate rain",
    65: "Heavy rain",
    71: "Light snow",
    73: "Moderate snow",
    75: "Heavy snow",
    95: "Thunderstorm",
    96: "Thunderstorm with hail",
    99: "Severe thunderstorm with hail",
}


def _desc(code: int) -> str:
    return _WCODE_MAP.get(code, "Unknown")


async def get_weather(city: str, forecast: bool = False, days: int = 1) -> str:
    """
    Query a city's weather (real-time or forecast) -- now using Open-Meteo
    """
    try:
        # 4.1 Latitude/longitude
        geo = await _get_lat_lon(city)

        # 4.2 Weather data
        data = await _call_open_meteo(
            geo["latitude"], geo["longitude"], geo["timezone"], forecast, days
        )

        # 4.3 Format the output, reusing the original string template as much as possible
        if forecast:
            daily = data["daily"]
            result = [
                f"{days}-day weather forecast for {city}:",
                "Overview: based on the Open-Meteo global model",
                "Severity: none",
                "Daily forecast:",
            ]
            for i in range(days):
                date = daily["time"][i]
                tmax = daily["temperature_2m_max"][i]
                tmin = daily["temperature_2m_min"][i]
                code = daily["weathercode"][i]
                result.append(
                    f"- {date}: day {tmax}°C/{_desc(code)}, night {tmin}°C/{_desc(code)}"
                )
            return "\n".join(result)

        else:
            cw = data["current_weather"]
            return (
                f"Real-time weather for {city}:\n"
                f"Temperature: {cw['temperature']}°C\n"
                f"Conditions: {_desc(cw['weathercode'])}\n"
                f"Relative humidity: N/A\n"
                f"Wind speed: {cw['windspeed']} km/h"
            )

    except Exception as e:
        return f"Error querying weather: {str(e)}"
    
weather_tool = {
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Query a city's weather (real-time or forecast)",
        "parameters": {
            "type": "object",
            "properties": {
                "city": {
                    "type": "string",
                    "description": "City name, e.g.: Beijing, New York",
                },
                "forecast": {
                    "type": "boolean",
                    "description": "Whether to get a forecast (false = real-time weather)",
                    "default": False
                },
                "days": {
                    "type": "integer",
                    "description": "Number of forecast days, from 1 to 7",
                    "default": 1,
                    "minimum": 1,
                    "maximum": 7
                },
            },
            "required": ["city"],
        },
    },
}

async def get_location_coordinates(city: str) -> str:
    """
    Query a city's latitude/longitude (now using Open-Meteo GeoCoding)
    The return format is identical to before, for a painless swap.
    """
    try:
        # 1. Call the Open-Meteo geocoding API
        url = "https://geocoding-api.open-meteo.com/v1/search"
        params = {"name": city, "count": 1, "language": "zh"}

        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params) as resp:
                if resp.status != 200:
                    return f"Error querying location info: HTTP {resp.status}"
                data = await resp.json()

        if not data.get("results"):
            return f"Could not find location info for city {city}"

        r = data["results"][0]

        # 2. Assemble a string identical to the original
        return (
            f"Location info for {city}:\n"
            f"Name: {r.get('name', 'Unknown')} ({r.get('name', 'Unknown')})\n"
            f"Country: {r.get('country', 'Unknown')}\n"
            f"Region: {r.get('admin1', 'Unknown')}\n"
            f"Coordinates: {r.get('latitude', 'Unknown')}, {r.get('longitude', 'Unknown')}\n"
            f"Timezone: {r.get('timezone', 'Unknown')}"
        )

    except Exception as e:
        return f"Error querying location info: {str(e)}"

location_tool = {
    "type": "function",
    "function": {
        "name": "get_location_coordinates",
        "description": "Query a city's latitude/longitude and location info",
        "parameters": {
            "type": "object",
            "properties": {
                "city": {
                    "type": "string",
                    "description": "City name, e.g.: Beijing, New York",
                },
            },
            "required": ["city"],
        },
    },
}

async def get_weather_by_city(city: str,lang:str="zh-CN",product:str="astro") -> str:
    """
    Get 7timer weather data by city name (JSON + image URL)
    
    :param city: city name (e.g. "Beijing", "New York")
    :return: a formatted string containing the JSON data and the image URL
    """
    try:
        # 1. Get the city's latitude/longitude
        location_info = await get_location_coordinates(city)
        
        # Parse the coordinates (assumes the format contains "coords: lat, lon")
        if "Coordinates:" not in location_info:
            return f"Could not get latitude/longitude info for {city}"
        
        # Extract coordinates (example parsing logic; may need adjustment)
        geo_part = location_info.split("Coordinates:")[1].split("\n")[0].strip()
        lat, lon = map(float, geo_part.split(","))
        
        # 2. Call the 7timer API for weather data
        base_url = "http://www.7timer.info/bin/astro.php"
        
        # Get the image URL
        img_params = {
            "lon": lon,
            "lat": lat,
            "ac": 0,
            "lang": lang,
            "unit": "metric",
            "tzshift": 0,
        }
        img_url = f"{base_url}?{'&'.join([f'{k}={v}' for k, v in img_params.items()])}"
        
        # Get the JSON data
        data_params = {
            "lon": lon,
            "lat": lat,
            "ac": 0,
            "product": product,
            "lang": "en",
            "unit": "metric",
            "output": "json",
            "tzshift": 0,
        }
        data_response = requests.get(base_url, params=data_params)
        data_response.raise_for_status()
        weather_data = data_response.json()
        
        # 3. Return the formatted result
        return f"{json.dumps(weather_data, ensure_ascii=False)}\n![image]({img_url})"
    
    except Exception as e:
        return f"Error getting weather data: {str(e)}"


timer_weather_tool = {
    "type": "function",
    "function": {
        "name": "get_weather_by_city",
        "description": "More detailed weather info, including a weather-chart image. Gets 7timer weather data by city name (JSON + image URL). Return the image URL in the format ![image](image_url)",
        "parameters": {
            "type": "object",
            "properties": {
                "city": {
                    "type": "string",
                    "description": "City name, e.g.: Beijing, New York",
                },
                "lang": {
                    "type": "string",
                    "description": "Language, e.g.: zh-CN, en-US",
                },
                "product": {
                    "type": "string",
                    "description": "Product type, default 'astro'. Options: 'astro', 'civil'. With 'astro', returns a 3-day (72-hour) forecast at 3-hour intervals. With 'civil', returns a 7-day forecast (2-4 time points per day)",
                    "enum": ["astro", "civil"]
                }
            },
            "required": ["city"],
        },
    },
}



async def get_wikipedia_summary_and_sections(
    topic: str, 
    language: str = "zh"
) -> str:
    """
    Get the summary and all section names of a Wikipedia topic (returned as a string)
    
    :param topic: the topic to query
    :param language: language code, default "zh" (Chinese)
    :param user_agent: custom user agent
    :return: a string containing the summary and section list, or an error message if the page doesn't exist
    """
    wiki_wiki = wikipediaapi.Wikipedia(
        language=language,
        extract_format=wikipediaapi.ExtractFormat.WIKI,
        user_agent="super-agent-party"
    )
    
    page = wiki_wiki.page(topic)
    
    if not page.exists():
        return f"No Wikipedia page found for '{topic}' (language: {language})"
    
    result = {
        "Title": page.title,
        "Summary": page.summary,
        "URL": page.fullurl,
        "Section list": [section.title for section in page.sections]
    }
    
    return json.dumps(result, ensure_ascii=False, indent=2)

wikipedia_summary_tool = {
    "type": "function",
    "function": {
        "name": "get_wikipedia_summary_and_sections",
        "description": "Get the summary and all section names of a Wikipedia topic",
        "parameters": {
            "type": "object",
            "properties": {
                "topic": {
                    "type": "string",
                    "description": "The name of the topic to query",
                },
                "language": {
                    "type": "string",
                    "description": "Language code, e.g. zh (Chinese), en (English)",
                    "default": "zh"
                },
            },
            "required": ["topic"],
        },
    },
}

async def get_wikipedia_section_content(
    topic: str, 
    section_title: str, 
    language: str = "zh"
) -> str:
    """
    Get the detailed content of a specific section of a Wikipedia topic (returned as a string)
    
    :param topic: the topic to query
    :param section_title: the section title
    :param language: language code, default "zh" (Chinese)
    :param user_agent: custom user agent
    :return: a string containing the section's detailed content, or an error message if the page or section doesn't exist
    """
    wiki_wiki = wikipediaapi.Wikipedia(
        language=language,
        extract_format=wikipediaapi.ExtractFormat.WIKI,
        user_agent="super-agent-party"
    )
    
    page = wiki_wiki.page(topic)
    
    if not page.exists():
        return f"No Wikipedia page found for '{topic}' (language: {language})"
    
    for section in page.sections:
        if section.title == section_title:
            result = {
                "Topic": page.title,
                "Section title": section.title,
                "Content": section.text,
                "URL": page.fullurl
            }
            return json.dumps(result, ensure_ascii=False, indent=2)
    
    return f"No section titled '{section_title}' found on the '{topic}' page"

wikipedia_section_tool = {
    "type": "function",
    "function": {
        "name": "get_wikipedia_section_content",
        "description": "Get the detailed content of a specific section of a Wikipedia topic. You must first call get_wikipedia_summary_and_sections to get the section list",
        "parameters": {
            "type": "object",
            "properties": {
                "topic": {
                    "type": "string",
                    "description": "The name of the topic to query",
                },
                "section_title": {
                    "type": "string",
                    "description": "The section title to get",
                },
                "language": {
                    "type": "string",
                    "description": "Language code, e.g. zh (Chinese), en (English)",
                    "default": "zh"
                }
            },
            "required": ["topic", "section_title"],
        },
    },
}



async def search_arxiv_papers(
    query: str,
    max_results: int = 5,
    sort_by: str = "relevance",
    sort_order: str = "descending",
    return_fields: Optional[List[str]] = None
) -> str:
    """
    Search arXiv papers and return structured results
    
    :param query: search keywords or query statement
    :param max_results: maximum number of results to return (default 5)
    :param sort_by: sort method ("relevance", "submittedDate", "lastUpdatedDate")
    :param sort_order: sort order ("ascending" or "descending")
    :param return_fields: list of fields to return
    :return: search results in JSON format
    """
    # Set default return fields
    default_fields = [
        "title", "authors", "summary", "published", 
        "pdf_url", "doi", "primary_category"
    ]
    return_fields = return_fields or default_fields
    
    # Wrap the synchronous operation as async
    def sync_search():
        search = arxiv.Search(
            query=query,
            max_results=max_results,
            sort_by=arxiv.SortCriterion(sort_by),
            sort_order=arxiv.SortOrder(sort_order)
        )
        return list(search.results())
    
    results = []
    try:
        # Run the synchronous operation in a thread pool
        papers = await asyncio.to_thread(sync_search)
        
        for result in papers:
            paper_info = {
                "title": result.title,
                "authors": [author.name for author in result.authors],
                "summary": result.summary,
                "published": str(result.published),
                "pdf_url": result.pdf_url,
                "doi": result.doi or "",
                "primary_category": result.primary_category,
                "entry_id": result.entry_id
            }
            # Filter fields
            filtered = {k: v for k, v in paper_info.items() if k in return_fields}
            results.append(filtered)
            
        if not results:
            return json.dumps({"error": f"No papers found related to '{query}'"}, ensure_ascii=False)
            
        return json.dumps({
            "query": query,
            "count": len(results),
            "results": results
        }, ensure_ascii=False)
        
    except Exception as e:
        return json.dumps({"error": f"Search failed: {str(e)}"}, ensure_ascii=False)

arxiv_tool = {
    "type": "function",
    "function": {
        "name": "search_arxiv_papers",
        "description": "Search the arXiv academic-paper database to get paper titles, authors, abstracts, PDF links, and more",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "English search keywords or query statement, e.g.: 'quantum machine learning' or 'ti:transformer AND cat:cs.CL'",
                },
                "max_results": {
                    "type": "integer",
                    "description": "Number of results to return (1-100)",
                    "default": 5
                },
                "sort_by": {
                    "type": "string",
                    "enum": ["relevance", "submittedDate", "lastUpdatedDate"],
                    "description": "Sort method",
                    "default": "relevance"
                },
                "sort_order": {
                    "type": "string",
                    "enum": ["ascending", "descending"],
                    "description": "Sort order",
                    "default": "descending"
                },
                "return_fields": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Fields to return, e.g. ['title','authors','pdf_url']",
                }
            },
            "required": ["query"],
        },
    },
}