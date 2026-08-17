# -- coding: utf-8 --
# ==========================================
# Step 1: settle the port before loading any heavy libraries
# ==========================================
import signal
import struct
import sys
import os
import argparse
import socket
import errno
from py.cli_tool import read_file_tool_local
from py.task_tools import query_task_progress
from py.ws_manager import ws_manager
import shortuuid
os.environ["MEM0_TELEMETRY"] = "False"
parser = argparse.ArgumentParser(description="Run the ASGI application server.")
parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "3456")))   # Railway 등 PaaS는 PORT env를 주입한다
args, _ = parser.parse_known_args()

HOST = args.host
PREFERED_PORT = args.port

def is_addr_in_use_error(e):
    """跨平台判断是否为地址被占用错误"""
    if hasattr(e, 'errno'):
        if e.errno == errno.EADDRINUSE:
            return True
        # Windows sometimes uses WSAEADDRINUSE (10048)
        if sys.platform == 'win32' and e.errno == 10048:
            return True
    # Windows winerror attribute
    if hasattr(e, 'winerror') and e.winerror == 10048:
        return True
    # macOS/Linux error message
    if 'address already in use' in str(e).lower():
        return True
    return False

def is_permission_error(e):
    """跨平台判断是否为权限/拒绝访问错误"""
    if isinstance(e, PermissionError):
        return True
    if hasattr(e, 'errno'):
        if e.errno in (errno.EACCES, errno.EPERM):
            return True
        # Windows ERROR_ACCESS_DENIED (5)
        if sys.platform == 'win32' and e.errno == 13:
            return True
    if hasattr(e, 'winerror') and e.winerror in (5, 10013):
        return True
    err_str = str(e).lower()
    if any(x in err_str for x in ['permission', 'denied', 'access', 'not permitted']):
        return True
    return False

def force_bind_or_fallback(host, preferred_port):
    """
    跨平台端口绑定：
    1. 尝试强制绑定指定端口（处理TIME_WAIT）
    2. 如果被真正占用/无权限/系统保留，自动降级到随机端口
    3. 绝不抛出异常导致退出
    """
    # Try binding the preferred port
    sock = None
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        # Key: allow fast reuse of ports in TIME_WAIT state
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((host, preferred_port))
        sock.close()
        return preferred_port
        
    except (socket.error, OSError, PermissionError) as e:
        # Determine the error type
        if is_addr_in_use_error(e):
            reason = "in use"
        elif is_permission_error(e):
            reason = "permission denied/system reserved"
        else:
            reason = f"error ({e})"
        
        print(f"Port {preferred_port} unavailable ({reason}), auto-assigning...", 
              file=sys.stderr, flush=True)
        
        # Close the failed socket
        try:
            if sock:
                sock.close()
        except:
            pass
        
        # Fallback: let the system assign a port
        return auto_assign_port(host)
        
    except Exception as e:
        # Catch all other exceptions
        print(f"Unexpected error binding port {preferred_port}: {e}, auto-assigning...", 
              file=sys.stderr, flush=True)
        try:
            if sock:
                sock.close()
        except:
            pass
        return auto_assign_port(host)

def auto_assign_port(host):
    """自动分配可用端口，带多重降级"""
    # Try 127.0.0.1
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((host, 0))
        port = sock.getsockname()[1]
        sock.close()
        print(f"Auto-assigned port: {port}", file=sys.stderr, flush=True)
        return port
    except Exception as e:
        print(f"Failed to bind {host}: {e}", file=sys.stderr, flush=True)
        try:
            sock.close()
        except:
            pass
    
    # Fallback 1: try 0.0.0.0 (all interfaces)
    if host != "0.0.0.0":
        try:
            print("Trying 0.0.0.0...", file=sys.stderr, flush=True)
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(("0.0.0.0", 0))
            port = sock.getsockname()[1]
            sock.close()
            print(f"Auto-assigned port on 0.0.0.0: {port}", file=sys.stderr, flush=True)
            return port
        except Exception as e:
            print(f"Failed to bind 0.0.0.0: {e}", file=sys.stderr, flush=True)
            try:
                sock.close()
            except:
                pass
    
    # Fallback 2: try localhost
    if host != "localhost":
        try:
            print("Trying localhost...", file=sys.stderr, flush=True)
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(("localhost", 0))
            port = sock.getsockname()[1]
            sock.close()
            print(f"Auto-assigned port on localhost: {port}", file=sys.stderr, flush=True)
            return port
        except Exception as e:
            print(f"Failed to bind localhost: {e}", file=sys.stderr, flush=True)
            try:
                sock.close()
            except:
                pass
    
    # Last resort: hardcode a high port (extreme case)
    fallback_ports = [45678, 45679, 45680, 0]
    for fp in fallback_ports:
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind((host if host != "0.0.0.0" else "127.0.0.1", fp))
            port = sock.getsockname()[1]
            sock.close()
            print(f"Fallback to hardcoded port: {port}", file=sys.stderr, flush=True)
            return port
        except:
            try:
                sock.close()
            except:
                pass
            continue
    
    # In theory we never reach here; if we do, return one that definitely works
    return 0

# Run the port lookup
FINAL_PORT = force_bind_or_fallback(HOST, PREFERED_PORT)
PORT = FINAL_PORT
os.environ['DYNAMIC_PORT'] = str(FINAL_PORT)

# Also call change_port to stay in sync
from py.get_setting import change_port, reset_user_data_dir, set_custom_user_data_dir
change_port(FINAL_PORT)

# Key: print immediately!
print(f"REAL_PORT_FOUND:{PORT}", flush=True)

# ==========================================
# Step 2: suppress nuisance warnings that later libraries may emit
# ==========================================
import warnings
warnings.filterwarnings("ignore") # Ignore ordinary warnings
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3' # If libraries like tensorflow are present, reduce their log output

import hashlib
import importlib
import mimetypes
import pathlib
import sys
import traceback
import platform
import requests

from py.agent import add_tool_to_project_config, is_tool_allowed_by_project_config
sys.stdout.reconfigure(encoding='utf-8')
import base64
from datetime import datetime
import glob
from io import BytesIO
import io
import os
from pathlib import Path
import pickle
import socket
import sys
import tempfile
import httpx
import ipaddress
from urllib.parse import urlparse, urlunparse, urljoin
from urllib.robotparser import RobotFileParser
import websockets
from py.load_files import check_robots_txt, get_file_content, is_private_ip, sanitize_url

# Fix the onnxruntime dylib path issue for sherpa-onnx on macOS arm64
import site
try:
    _sp = site.getsitepackages()[0]
    _sherpa_lib = os.path.join(_sp, "sherpa_onnx", "lib")
    _onnx_capi = os.path.join(_sp, "onnxruntime", "capi")
    import glob as _glob
    _dylibs = _glob.glob(os.path.join(_onnx_capi, "libonnxruntime*.dylib"))
    if _dylibs:
        _dylib = _dylibs[0]
        _target = os.path.join(_sherpa_lib, os.path.basename(_dylib))
        if not os.path.exists(_target):
            os.makedirs(_sherpa_lib, exist_ok=True)
            os.symlink(os.path.abspath(_dylib), _target)
except Exception:
    pass

def fix_macos_environment():
    """
    专门修复 macOS 下找不到 node (nvm) 和 uv (python framework) 的问题
    """
    if sys.platform != 'darwin':
        return

    user_home = Path.home()
    paths_to_add = []

    # ---------------------------------------------------------
    # 1. Auto-discover Node.js installed by NVM
    # The path is usually: ~/.nvm/versions/node/vX.X.X/bin
    # ---------------------------------------------------------
    nvm_path = user_home / ".nvm" / "versions" / "node"
    if nvm_path.exists():
        # Get all version folders (e.g. v20.19.5, v18.0.0)
        # Use glob to match all folders starting with v
        node_versions = sorted(nvm_path.glob("v*"), key=lambda p: p.name, reverse=True)
        
        # Add the bin dir of all versions, or just the latest
        for version_dir in node_versions:
            bin_path = version_dir / "bin"
            if bin_path.exists():
                paths_to_add.append(str(bin_path))
                # If you only want the latest node, you can break here
                # break 

    # ---------------------------------------------------------
    # 2. Auto-discover uv inside the Python Framework
    # The path is usually: /Library/Frameworks/Python.framework/Versions/X.X/bin
    # ---------------------------------------------------------
    py_framework_path = Path("/Library/Frameworks/Python.framework/Versions")
    if py_framework_path.exists():
        # Find all versions, e.g. 3.13, 3.12
        py_versions = py_framework_path.glob("*")
        for ver in py_versions:
            bin_path = ver / "bin"
            if bin_path.exists():
                paths_to_add.append(str(bin_path))

    # ---------------------------------------------------------
    # 3. Add other common macOS paths (Homebrew, Cargo, Local)
    # uv is often installed under .local/bin or .cargo/bin too
    # ---------------------------------------------------------
    common_extras = [
        "/opt/homebrew/bin",           # Apple Silicon Mac Homebrew
        "/usr/local/bin",              # Intel Mac Homebrew
        str(user_home / ".local" / "bin"), # User-level installs are usually here
        str(user_home / ".cargo" / "bin"), # Rust toolchain (uv may be here)
    ]
    paths_to_add.extend(common_extras)

    # ---------------------------------------------------------
    # 4. Inject the discovered paths into the current process's environment
    # ---------------------------------------------------------
    current_path = os.environ.get("PATH", "")
    new_path_str = current_path
    
    # Prepend the new paths (highest priority)
    for p in paths_to_add:
        if p and os.path.isdir(p):
            # Avoid adding duplicates
            if p not in new_path_str:
                new_path_str = p + os.pathsep + new_path_str
    
    # Update the environment variable
    os.environ['PATH'] = new_path_str
    
    # (Optional) print debug info
    # print(f"Fixed macOS PATH. Added: {paths_to_add}")

# --- Call this function at the very start of the program ---
fix_macos_environment()

def _fix_onnx_dll():
    if sys.platform == 'darwin':
        return
    # 1. Locate onnxruntime in the uv virtual environment
    spec = importlib.util.find_spec("onnxruntime")
    if spec is None or spec.origin is None:
        return          # onnxruntime isn't installed; leave it
    # The DLL is in site-packages/onnxruntime/capi
    dll_dir = pathlib.Path(spec.origin).with_name("capi")
    if not dll_dir.is_dir():
        return

    # 2. Put the search path at the top
    os.environ["PATH"] = str(dll_dir) + os.pathsep + os.environ["PATH"]
    if hasattr(os, "add_dll_directory"):      # Python 3.8+
        os.add_dll_directory(str(dll_dir))

    # 3. If onnxruntime was already imported, clear the cache
    for mod in list(sys.modules):
        if mod.startswith("onnxruntime"):
            del sys.modules[mod]

_fix_onnx_dll()

# Set at the very start of the program
if hasattr(sys, '_MEIPASS'):
    # The packaged program
    os.environ['PYTHONPATH'] = sys._MEIPASS
    os.environ['PATH'] = sys._MEIPASS + os.pathsep + os.environ.get('PATH', '')
import asyncio
import copy
from functools import partial
import json
import re
import shutil
from fastapi import BackgroundTasks, Body, FastAPI, File, Form, HTTPException, UploadFile, WebSocket, Request, WebSocketDisconnect
from fastapi_mcp import FastApiMCP
import logging
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from openai import AsyncOpenAI
from pydantic import BaseModel
from fastapi import status
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse,Response
import uuid
import time
import random
from typing import Any, AsyncIterator, List, Dict,Optional, Tuple, Union
import shortuuid
from py.mcp_clients import McpClient
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
import aiofiles
import argparse
from py.dify_openai import DifyOpenAIAsync
from py.ClaudeAsOpenAI import AsyncClaudeAsOpenAI
from py.GeminiAsOpenAI import AsyncGeminiAsOpenAI
from py.get_setting import EXT_DIR, IS_DOCKER, SKILLS_DIR, _copy_default_skills, convert_to_opus_simple, load_covs, load_settings, save_covs,save_settings,clean_temp_files_task,base_path,configure_host_port,UPLOAD_FILES_DIR,AGENT_DIR,MEMORY_CACHE_DIR,KB_DIR,DEFAULT_VRM_DIR,USER_DATA_DIR,LOG_DIR,TOOL_TEMP_DIR,COVS_PATH
from py.llm_tool import get_image_base64,get_image_media_type
timetamp = time.time()
log_path = os.path.join(LOG_DIR, f"backend_{timetamp}.log")

logger = None      
os.environ["no_proxy"] = "localhost,127.0.0.1"
local_timezone = None
settings = None
client = None
fast_client = None 
reasoner_client = None
HA_client = None
ChromeMCP_client = None
sql_client = None
mcp_client_list = {}
node_ext_mcp_clients: Dict[str, McpClient] = {}
node_ext_mcp_tools: Dict[str, List[Dict]] = {}  # Stores each extension's tool list
locales = {}
sleep_guard = None
scheduler_task = None
global_http_client = None  # Used to share the underlying TCP connection pool
openai_tts_clients_cache = {}  # Cache the OpenAI TTS client
tetos_speakers_cache = {}      # Cache the Tetos Speaker object
openai_asr_clients_cache = {}
_TOOL_HOOKS = {}
ALLOWED_EXTENSIONS = [
  # Office documents
    'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'pdf', 'pages', 
    'numbers', 'key', 'rtf', 'odt', 'epub',
  
  # Programming/development
  'js', 'ts', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'go', 'rs',
  'swift', 'kt', 'dart', 'rb', 'php', 'html', 'css', 'scss', 'less',
  'vue', 'svelte', 'jsx', 'tsx', 'json', 'xml', 'yml', 'yaml', 
  'sql', 'sh',
  
  # Data/config
  'csv', 'tsv', 'txt', 'md', 'log', 'conf', 'ini', 'env', 'toml'
]
ALLOWED_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']

ALLOWED_VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'mov', 'avi']

# 1. First clear entries the system may have set incorrectly
for ext in ("js", "mjs", "css", "html", "htm", "json", "xml", "map", "svg"):
    mimetypes.add_type("", f".{ext}")          # Delete first
# 2. Then hardcode what we want
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/javascript", ".mjs")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("text/html", ".html")
mimetypes.add_type("text/html", ".htm")
mimetypes.add_type("application/json", ".json")
mimetypes.add_type("application/xml", ".xml")
mimetypes.add_type("application/json", ".map")
mimetypes.add_type("image/svg+xml", ".svg")

import platform
import ctypes
from PIL import Image, ImageDraw, ImageFont
import io
if platform.system() == "Windows":
    try:
        # Set DPI awareness so screenshot size matches what size() returns
        ctypes.windll.shcore.SetProcessDpiAwareness(1) 
    except Exception:
        ctypes.windll.user32.SetProcessDPIAware()

def draw_grid_on_image(image: Image.Image, grid_spacing: int = 10) -> Image.Image:
    """
    在图片上绘制网格和千分比坐标标签
    grid_spacing: 每隔多少百分比画一根线，默认 10 (即 10x10 的网格)
    """
    draw = ImageDraw.Draw(image)
    width, height = image.size
    
    # Color setting (translucent red or bright green, depending)
    line_color = (255, 0, 0, 128)  # Red line
    text_color = (255, 0, 0, 255)
    
    # Draw vertical lines (percent 0-100, but labels show per-mille 0-1000‰)
    for x_pc in range(0, 101, grid_spacing):
        x = int(width * (x_pc / 100.0))
        # Ensure we don't exceed the bounds
        x = min(x, width - 1)
        draw.line([(x, 0), (x, height)], fill=line_color, width=1)
        x_permille = x_pc
        draw.text((x + 2, 5), f"{x_permille}%", fill=text_color)

    # Draw horizontal lines
    for y_pc in range(0, 101, grid_spacing):
        y = int(height * (y_pc / 100.0))
        y = min(y, height - 1)
        draw.line([(0, y), (width, y)], fill=line_color, width=1)
        y_permille = y_pc
        draw.text((5, y + 2), f"{y_permille}%", fill=text_color)
        
    return image

def draw_action_feedback(image: Image.Image, action_str: str) -> Image.Image:
    """
    解析返回结果字符串，并在图像上绘制动作反馈轨迹。
    （已针对红色网格优化，全面移除红色，使用高对比度的青/蓝/绿/黄色）
    """
    # Force-convert the original image to RGBA to allow translucent colors
    image = image.convert("RGBA")
    
    # Create a transparent overlay the same size as the original
    overlay = Image.new("RGBA", image.size, (255, 255, 255, 0))
    draw = ImageDraw.Draw(overlay)
    w, h = image.size
    
    def to_px(tx, ty):
        return int(float(tx) * w / 1000), int(float(ty) * h / 1000)

    # 1. Match MOVE(x,y) -> draw a small white dot with a black border
    move_match = re.search(r"\[LAST_ACTION: MOVE\((\d+\.?\d*),(\d+\.?\d*)\)\]", action_str)
    if move_match:
        x, y = move_match.groups()
        px, py = to_px(x, y)
        r = 6
        draw.ellipse([px-r, py-r, px+r, py+r], fill=(255, 255, 255, 200), outline=(0, 0, 0, 255), width=1)

    # 2. Match CLICK(x,y) -> draw a cyan translucent crosshair (great contrast against the red grid)
    click_match = re.search(r"\[LAST_ACTION: CLICK\((\d+\.?\d*),(\d+\.?\d*)\)\]", action_str)
    if click_match:
        x, y = click_match.groups()
        px, py = to_px(x, y)
        r = 12
        # Cyan base circle
        draw.ellipse([px-r, py-r, px+r, py+r], fill=(0, 255, 255, 150), outline=(255, 255, 255, 255), width=2)
        # White cross
        draw.line([px-r-5, py, px+r+5, py], fill=(255, 255, 255, 255), width=2)
        draw.line([px, py-r-5, px, py+r+5], fill=(255, 255, 255, 255), width=2)

    # 3. Match DOUBLE_CLICK(x,y) -> draw a blue double-ring target
    dclick_match = re.search(r"\[LAST_ACTION: DOUBLE_CLICK\((\d+\.?\d*),(\d+\.?\d*)\)\]", action_str)
    if dclick_match:
        x, y = dclick_match.groups()
        px, py = to_px(x, y)
        r = 14
        # Blue base circle
        draw.ellipse([px-r, py-r, px+r, py+r], fill=(0, 100, 255, 150), outline=(255, 255, 255, 255), width=2)
        # Inner white circle
        draw.ellipse([px-(r-4), py-(r-4), px+(r-4), py+(r-4)], outline=(255, 255, 255, 255), width=1)

    # 4. Match DRAG(x1,y1,x2,y2) -> green path line, green start, yellow end
    drag_match = re.search(r"\[LAST_ACTION: DRAG\((\d+\.?\d*),(\d+\.?\d*),(\d+\.?\d*),(\d+\.?\d*)\)\]", action_str)
    if drag_match:
        x1, y1, x2, y2 = drag_match.groups()
        p1 = to_px(x1, y1)
        p2 = to_px(x2, y2)
        
        # Green translucent connecting line
        draw.line([p1, p2], fill=(0, 255, 0, 200), width=4)
        
        # Green start circle
        draw.ellipse([p1[0]-6, p1[1]-6, p1[0]+6, p1[1]+6], fill=(0, 255, 0, 255), outline=(255,255,255,255), width=1)
        
        # Yellow end target (yellow stands out on the grid too)
        r_end = 8
        draw.ellipse([p2[0]-r_end, p2[1]-r_end, p2[0]+r_end, p2[1]+r_end], fill=(255, 215, 0, 180), outline=(255,255,255,255), width=2)

    # Merge layers, convert back to RGB (JPG doesn't support an alpha channel)
    combined = Image.alpha_composite(image, overlay)
    return combined.convert("RGB")

def scale_to_fit(width: int, height: int, max_w: int = 1920, max_h: int = 1080) -> tuple[int, int]:
    """计算等比例缩放后的尺寸"""
    # Compute the width and height scale ratios
    scale_w = max_w / width
    scale_h = max_h / height
    
    # Take the smaller ratio so neither dimension exceeds the limit
    scale = min(scale_w, scale_h, 1.0) # If the original is smaller than 1920x1080, don't upscale (1.0)
    
    new_width = int(width * scale)
    new_height = int(height * scale)
    return new_width, new_height

def _get_target_message(message, role):
    """
    根据角色获取目标消息
    
    参数:
        message (list): 消息列表引用
        role (str): 要操作的角色，可选值: 'user', 'assistant', 'system'
    
    返回:
        dict: 目标消息字典
    """
    # Validate input parameters
    if not isinstance(message, list):
        raise TypeError("message必须是列表类型")
    
    if role not in ['user', 'assistant', 'system']:
        raise ValueError("role必须是'user'或'assistant'或'system'")
    
    target_message = None
    
    # Decide which object to operate on based on role
    if role == 'user':
        # Find the last message with role 'user'
        for msg in reversed(message):
            if isinstance(msg, dict) and msg['role'] == 'user':
                target_message = msg
                break
    elif role == 'assistant':
        # Check the last message
        if message and message[-1]['role'] == 'assistant':
            target_message = message[-1]
        else:
            # If the last message isn't an assistant, create a new one
            new_assistant_msg = {'role': 'assistant', 'content': '','reasoning_content': ''}
            message.append(new_assistant_msg)
            target_message = new_assistant_msg
    elif role == 'system':
        # Find the first message with role 'system'
        if message and message[0]['role'] == 'system':
            target_message = message[0]
        else:
            # If no system message is found, create a new one
            target_message = {'role': 'system', 'content': ''}
            message.insert(0, target_message)
    
    return target_message

def content_append(message, role, content):
    """
    将content添加到指定role消息的末尾
    """
    target_message = _get_target_message(message, role)
    if target_message:
        current_content = target_message.get('content', '')
        target_message['content'] = current_content + content

def content_prepend(message, role, content):
    """
    将content添加到指定role消息的前面
    """
    target_message = _get_target_message(message, role)
    if target_message:
        current_content = target_message.get('content', '')
        target_message['content'] = content + current_content

def content_replace(message, role, content):
    """
    用content替换指定role消息的内容
    """
    target_message = _get_target_message(message, role)
    if target_message:
        target_message['content'] = content

def content_new(message, role, content):
    """
    用content替换指定role消息的内容
    """
    message.append({'role': role, 'content': content})

configure_host_port(args.host, args.port)

def get_client_class(config, provider_id):
    if not config or 'modelProviders' not in config:
        return AsyncOpenAI
    vendor = 'OpenAI'
    for provider in config['modelProviders']:
        if provider['id'] == provider_id:
            vendor = provider['vendor']
            break
    # Assumes DifyOpenAIAsync and AsyncOpenAI are already imported
    if vendor == 'Dify':
        return DifyOpenAIAsync 
    elif vendor == 'customAnthropic':
        return AsyncClaudeAsOpenAI
    elif vendor == 'Gemini':
        return AsyncGeminiAsOpenAI
    else: 
        return AsyncOpenAI

from py.node_runner import node_mgr
@asynccontextmanager
async def lifespan(app: FastAPI):
    # --- [Core defense] immediately clear the SOCKS proxy from system env vars to prevent httpx from crashing ---
    for env_key in ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']:
        val = os.environ.get(env_key, "")
        if val.lower().startswith('socks'):
            # Fully remove the socks env vars that cause crashes
            os.environ.pop(env_key, None)

    # Basic initialization
    await _copy_default_skills()
    
    # 1. Prepare all independent initialization tasks
    from py.get_setting import init_db, init_covs_db, load_settings, save_settings
    from tzlocal import get_localzone
    
    asyncio.create_task(clean_temp_files_task())
    asyncio.create_task(_world_diary_daemon())   # 🌙 일기 데몬 — 월드 창 없이도 매일 일기·아침 댓글 (하단 월드 블록)
    
    # Run the time-consuming operations in parallel
    init_db_task = init_db()
    init_covs_task = init_covs_db()
    load_locales_task = asyncio.to_thread(lambda: json.load(open(base_path + "/config/locales.json", "r", encoding="utf-8")))
    settings_task = load_settings() 
    timezone_task = asyncio.to_thread(get_localzone)
    
    results = await asyncio.gather(
        init_db_task, 
        init_covs_task, 
        load_locales_task, 
        settings_task, 
        timezone_task
    )
    
    # 2. Unpack the results
    global settings, client, reasoner_client, fast_client, mcp_client_list, local_timezone, logger, locales, global_http_client,scheduler_task,sleep_guard
    _, _, locales, settings, local_timezone = results
    
    from py.sleep_guard import SleepGuard
    sleep_guard = SleepGuard(verbose=True)
    try:
        await asyncio.to_thread(sleep_guard.start)
        if sleep_guard.is_running():
            print("🛡️ Sleep prevention started; the system will not auto-sleep")
        else:
            print("⚠️ Failed to start sleep prevention; the system may sleep when idle")
    except Exception as e:
        print(f"Sleep-prevention start error: {e}")


    from py.scheduler import AgentScheduler
    # Pass in a reference to the global settings object
    # Since Python dicts are passed by reference, later UI changes to settings are reflected here too
    scheduler = AgentScheduler(settings)
    scheduler_task = asyncio.create_task(scheduler.start_loop())

    # --- [Logging system initialization] ---
    timestamp = time.time()
    log_path = os.path.join(LOG_DIR, f"backend_{timestamp}.log")
    logger = logging.getLogger("app")
    if not logger.handlers:
        logger.setLevel(logging.INFO)
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s - %(levelname)s - %(message)s"))
        logger.addHandler(handler)
    logger.info("===== 日志系统初始化成功 =====")

    # --- [Proxy and HTTP client initialization] ---
    proxy_url = None
    trust_env = False
    
    if settings:
        sys_set = settings.get("systemSettings", {})
        mode = sys_set.get("proxyMode")
        manual_url = sys_set.get("proxy", "").strip()
        isChinaProxy = sys_set.get("isChinaProxy", False)

        if mode == "manual" and manual_url:
            # Manual mode: if it's socks, skip and warn since the library isn't installed
            if manual_url.lower().startswith("socks"):
                logger.error("检测到手动设置了 SOCKS 代理，但当前环境不支持。代理已失效。")
                proxy_url = None
            else:
                proxy_url = manual_url
        elif mode == "system":
            # System mode: trust the environment (socks is already gone from it, so it's safe)
            trust_env = True
        if isChinaProxy:
            # 2. Inject the Node.js / NPM mirror source (important)
            # Setting this env var makes all npm installs (including node_runner) use this source by default
            os.environ["npm_config_registry"] = "https://registry.npmmirror.com/"
            
            # 3. Inject the UV / Pip mirror source (important)
            # So later calls to uv or pip also use the mirror automatically
            os.environ["UV_INDEX_URL"] = "https://mirrors.aliyun.com/pypi/simple/"

    # Initialize the global HTTP client with a connection pool
    timeout_config = httpx.Timeout(None, connect=10.0)
    global_http_client = httpx.AsyncClient(
        timeout=timeout_config,
        proxy=proxy_url,
        trust_env=trust_env
    )

    # --- [Model client initialization] ---
    # Helper: uniformly inject global_http_client
    def create_model_client(provider_key, config_node=None):
        if not settings: return AsyncOpenAI(http_client=global_http_client)
        
        target_cfg = config_node if config_node else settings
        p_name = target_cfg.get('selectedProvider', settings.get('selectedProvider'))
        c_cls = get_client_class(settings, p_name)
        
        return c_cls(
            api_key=target_cfg.get('api_key') or settings.get('api_key', ''),
            base_url=target_cfg.get('base_url') or settings.get('base_url') or "https://api.openai.com/v1",
            http_client=global_http_client  # Force the use of our proxy-controlled client
        )

    if settings:
        client = create_model_client('main')
        reasoner_client = create_model_client('reasoner', settings.get('reasoner', {}))
        
        fast_cfg = settings.get('fast', {})
        if fast_cfg.get('enabled'):
            fast_client = create_model_client('fast', fast_cfg)
        else:
            fast_client = None
    else:
        client = AsyncOpenAI(http_client=global_http_client)
        reasoner_client = AsyncOpenAI(http_client=global_http_client)
        fast_client = AsyncOpenAI(http_client=global_http_client)

    # --- [Other init: ASR / MCP] ---
    try:
        from py.sherpa_asr import _get_recognizer
        asyncio.get_running_loop().run_in_executor(None, _get_recognizer)
    except Exception as e:
        logger.error(f"尝试启动sherpa失败: {e}")

    # MCP init logic (keeps the original logic, but reuses global_http_client internally)
    mcp_init_tasks = []

    async def init_mcp_with_timeout(server_name: str, server_config: dict, timeout=6.0, max_wait_failure=5.0):
        if server_config.get("disabled"):
            return server_name, None, "disabled"
        
        mcp_client = mcp_client_list.get(server_name) or McpClient()
        mcp_client_list[server_name] = mcp_client
        failure_event = asyncio.Event()
        first_error = None

        async def on_failure(msg: str):
            nonlocal first_error
            if first_error: return
            first_error = msg
            logger.error(f"MCP {server_name} failure: {msg}")
            settings.setdefault("mcpServers", {}).setdefault(server_name, {})["disabled"] = True
            mcp_client.disabled = True
            await mcp_client.close()
            failure_event.set()

        init_task = asyncio.create_task(mcp_client.initialize(server_name, server_config, on_failure_callback=on_failure))
        try:
            await asyncio.wait_for(init_task, timeout=timeout)
            try:
                await asyncio.wait_for(failure_event.wait(), timeout=max_wait_failure)
            except asyncio.TimeoutError:
                pass
            return server_name, (None if first_error else mcp_client), first_error
        except Exception as exc:
            return server_name, None, str(exc)
        finally:
            if not init_task.done(): init_task.cancel()

    async def check_results():
        for task in asyncio.as_completed(mcp_init_tasks):
            name, m_client, err = await task
            if err:
                settings['mcpServers'][name]['processingStatus'] = 'server_error'
            elif m_client:
                mcp_client_list[name] = m_client
        await save_settings(settings)
        await ws_manager.broadcast_settings_update(settings)

    if settings and settings.get('mcpServers'):
        mcp_init_tasks = [asyncio.create_task(init_mcp_with_timeout(k, v)) for k, v in settings['mcpServers'].items()]
        if mcp_init_tasks: asyncio.create_task(check_results())
    else:
        asyncio.create_task(ws_manager.broadcast_settings_update(settings or {}))

    # --- [Startup complete] ---
    yield

    # --- [Shutdown logic] ---
    print("System shutting down, cleaning up...")

    try:
        await asyncio.to_thread(sleep_guard.stop)
        print("🛡️ Sleep prevention stopped; normal sleep policy restored")
    except Exception as e:
        print(f"Sleep-prevention stop error: {e}")

    if scheduler_task:
        scheduler_task.cancel()
    ext_ids = list(node_mgr.exts.keys())
    for ext_id in ext_ids:
        try: await node_mgr.stop(ext_id)
        except: pass
        
    if global_http_client:
        await global_http_client.aclose()
    print("All processes terminated.")


app = FastAPI(lifespan=lifespan)

# 공개망 배포용 토큰 게이트: SAP_AUTH_TOKEN 이 설정돼 있을 때만 켜진다(로컬/Electron은 무동작).
# http·websocket 둘 다 막고, /health 만 열어둔다. 첫 접속은 아무 URL 뒤에 ?token=... 을 붙이면
# 쿠키(90일)를 심어줘서 이후 요청·WS 핸드셰이크가 자동 통과한다.
_SAP_TOKEN = os.environ.get("SAP_AUTH_TOKEN", "").strip()
if _SAP_TOKEN:
    class _AuthGate:
        def __init__(self, asgi_app):
            self.app = asgi_app
        async def __call__(self, scope, receive, send):
            if scope["type"] not in ("http", "websocket") or scope.get("path") == "/health":
                return await self.app(scope, receive, send)
            headers = {k.decode("latin1").lower(): v.decode("latin1") for k, v in scope.get("headers", [])}
            cookie_ok = f"sap_token={_SAP_TOKEN}" in headers.get("cookie", "")
            bearer_ok = headers.get("authorization", "") == f"Bearer {_SAP_TOKEN}"
            from urllib.parse import parse_qs
            query_ok = parse_qs(scope.get("query_string", b"").decode("latin1")).get("token", [None])[0] == _SAP_TOKEN
            if not (cookie_ok or bearer_ok or query_ok):
                if scope["type"] == "websocket":
                    return await send({"type": "websocket.close", "code": 4401})
                return await send_401(send)
            if query_ok and not cookie_ok and scope["type"] == "http":
                async def send_with_cookie(message):   # ?token= 통과 시 응답에 쿠키를 심는다
                    if message["type"] == "http.response.start":
                        message.setdefault("headers", []).append(
                            (b"set-cookie", f"sap_token={_SAP_TOKEN}; Path=/; Max-Age=7776000; HttpOnly; SameSite=Lax".encode("latin1")))
                    await send(message)
                return await self.app(scope, receive, send_with_cookie)
            return await self.app(scope, receive, send)

    async def send_401(send):
        body = b'{"error": "unauthorized - append ?token=YOUR_TOKEN to the URL once"}'
        await send({"type": "http.response.start", "status": 401,
                    "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})

    app.add_middleware(_AuthGate)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    # Security: this app authenticates via the api_key in the request body, not Cookie credentials.
    # Disabling credentials removes the unsafe "wildcard origin + credentials" combination (and doesn't affect any existing functionality).
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def cors_options_workaround(request: Request, call_next):
    if request.method == "OPTIONS":
        return Response(
            status_code=200,
            headers={
                "Access-Control-Allow-Origin": "*",
                # Security: consistent with the CORS middleware above, don't declare credentials as allowed
                "Access-Control-Allow-Methods": "*",
                "Access-Control-Allow-Headers": "*",
                "Access-Control-Max-Age": "86400",   # Preflight cache 24h
            }
        )
    return await call_next(request)

async def t(text: str) -> str:
    global locales
    settings = await load_settings()
    target_language = settings["currentLanguage"]
    return locales[target_language].get(text, text)


# Global storage for async tool state
async_tools = {}
async_tools_lock = asyncio.Lock()

async def execute_tool(tool_id: str, tool_name: str, args: dict, settings: dict,user_prompt: str):
    try:
        results = await dispatch_tool(tool_name, args, settings)
        if isinstance(results, AsyncIterator):
            buffer = []
            async for chunk in results:
                buffer.append(chunk)
            results = "".join(buffer)
                
        if tool_name in ["query_knowledge_base"] and type(results) == list:
            from py.know_base import rerank_knowledge_base
            if settings["KBSettings"]["is_rerank"]:
                results = await rerank_knowledge_base(user_prompt,results)
            results = json.dumps(results, ensure_ascii=False, indent=4)
        async with async_tools_lock:
            async_tools[tool_id] = {
                "status": "completed",
                "result": results,
                "name": tool_name,
                "parameters": args,
            }
    except Exception as e:
        async with async_tools_lock:
            async_tools[tool_id] = {
                "status": "error",
                "result": str(e),
                "name": tool_name,
                "parameters": args,
            }

async def get_image_content(image_url: str) -> str:
    import hashlib
    settings = await load_settings()
    base64_image = await get_image_base64(image_url)
    media_type = await get_image_media_type(image_url)
    url= f"data:{media_type};base64,{base64_image}"
    image_hash = hashlib.md5(image_url.encode()).hexdigest()
    content = ""
    if settings['vision']['enabled']:
        # If uploaded_files/{item['image_url']['hash']}.txt exists, read its content; otherwise call the vision API
        if os.path.exists(os.path.join(UPLOAD_FILES_DIR, f"{image_hash}.txt")):
            with open(os.path.join(UPLOAD_FILES_DIR, f"{image_hash}.txt"), "r", encoding='utf-8') as f:
                content += f"\n\n图片(URL:{image_url} 哈希值：{image_hash})信息如下：\n\n"+str(f.read())+"\n\n"
        else:
            images_content = [{"type": "text", "text": "Please describe the content of the image in detail, including any text, numbers, colors, shapes, sizes, positions, people, objects, scenes, and other information that may be present in the image."},{"type": "image_url", "image_url": {"url": url}}]
            client = AsyncOpenAI(api_key=settings['vision']['api_key'],base_url=settings['vision']['base_url'])
            
            extra = {}

            if settings['vision']['temperature'] !=1:
                extra['temperature'] = settings['vision']['temperature']
            
            response = await client.chat.completions.create(
                model=settings['vision']['model'],
                messages = [{"role": "user", "content": images_content}],
                **extra
            )
            content = f"\n\nn图片(URL:{image_url} 哈希值：{image_hash})信息如下：\n\n"+str(response.choices[0].message.content)+"\n\n"
            with open(os.path.join(UPLOAD_FILES_DIR, f"{image_hash}.txt"), "w", encoding='utf-8') as f:
                f.write(str(response.choices[0].message.content))
    else:           
        # If uploaded_files/{item['image_url']['hash']}.txt exists, read its content; otherwise call the vision API
        if os.path.exists(os.path.join(UPLOAD_FILES_DIR, f"{image_hash}.txt")):
            with open(os.path.join(UPLOAD_FILES_DIR, f"{image_hash}.txt"), "r", encoding='utf-8') as f:
                content += f"\n\nn图片(URL:{image_url} 哈希值：{image_hash})信息如下：\n\n"+str(f.read())+"\n\n"
        else:
            images_content = [{"type": "text", "text": "Please describe the content of the image in detail, including any text, numbers, colors, shapes, sizes, positions, people, objects, scenes, and other information that may be present in the image."},{"type": "image_url", "image_url": {"url": url}}]
            client = AsyncOpenAI(api_key=settings['api_key'],base_url=settings['base_url'])
            
            extra = {}

            if settings['temperature'] !=1:
                extra['temperature'] = settings['temperature']
            
            response = await client.chat.completions.create(
                model=settings['model'],
                messages = [{"role": "user", "content": images_content}],
                **extra
            )
            content = f"\n\nn图片(URL:{image_url} 哈希值：{image_hash})信息如下：\n\n"+str(response.choices[0].message.content)+"\n\n"
            with open(os.path.join(UPLOAD_FILES_DIR, f"{image_hash}.txt"), "w", encoding='utf-8') as f:
                f.write(str(response.choices[0].message.content))
    return content

# Store pending MCP call results
mcp_call_results: Dict[str, asyncio.Future] = {}

async def call_node_extension_tool(ext_id: str, tool_name: str, tool_params: dict) -> str:
    """通过WebSocket调用Node扩展的工具"""
    import uuid
    
    call_id = str(uuid.uuid4())
    future = asyncio.Future()
    mcp_call_results[call_id] = future
    
    # Broadcast to all connections to find the matching extension
    await ws_manager.broadcast({
        "type": "call_mcp_tool",
        "data": {
            "ext_id": ext_id,
            "tool_name": tool_name,
            "tool_params": tool_params,
            "call_id": call_id
        }
    })
    
    try:
        # Wait for the result, 30-second timeout
        result = await asyncio.wait_for(future, timeout=30.0)
        return str(result)
    except asyncio.TimeoutError:
        return f"调用扩展 {ext_id} 的工具 {tool_name} 超时"
    finally:
        if call_id in mcp_call_results:
            del mcp_call_results[call_id]

async def dispatch_tool(tool_name: str, tool_params: dict, settings: dict,is_sub_agent:bool=False) -> str | List | AsyncIterator[str] | None :
    global mcp_client_list,_TOOL_HOOKS,HA_client,ChromeMCP_client,sql_client, node_ext_mcp_clients, node_ext_mcp_tools
    print("dispatch_tool",tool_name,tool_params)
    
    # ==================== 1. Import all tool functions ====================
    from py.web_search import (
        DDGsearch, 
        searxng, 
        Tavily_search,
        Bing_search,
        Google_search,
        Brave_search,
        Exa_search,
        Serper_search,
        bochaai_search,
        jina_crawler,
        Crawl4Ai_search, 
        firecrawl_search,
        simple_fetch,
        markdown_new,
    )
    from py.know_base import query_knowledge_base
    from py.agent_tool import agent_tool_call
    from py.a2a_tool import a2a_tool_call
    from py.llm_tool import custom_llm_tool
    from py.pollinations import pollinations_image,openai_image,openai_chat_image
    from py.load_files import get_file_content
    from py.code_interpreter import e2b_code,local_run_code
    from py.custom_http import fetch_custom_http
    from py.comfyui_tool import comfyui_tool_call
    from py.utility_tools import (
        time,
        get_weather,
        get_location_coordinates,
        get_weather_by_city,
        get_wikipedia_summary_and_sections,
        get_wikipedia_section_content,
        search_arxiv_papers
    )
    from py.autoBehavior import auto_behavior

    # Docker CLI tools (existing)
    from py.cli_tool import (
        docker_sandbox,
        list_files_tool,
        read_file_tool,
        read_file_range_tool, 
        tail_file_tool,     
        search_files_tool,
        edit_file_tool,
        edit_file_patch_tool, 
        glob_files_tool,       
        todo_write_tool, 
        list_processes_tool,
        get_process_logs_tool,
        kill_process_tool,
        docker_manage_ports_tool,
        read_skill_tool,
    )

    # New: local-environment CLI tools (assumed to live in py/local_cli_tool.py)
    from py.cli_tool import (
        shell_tool_local,           # Local bash execution (corresponds to docker_sandbox)
        list_files_tool_local,     # Local file listing
        read_file_tool_local,      # Local file reading
        read_file_range_tool_local, # <--- New import
        tail_file_tool_local,       # <--- New import
        search_files_tool_local,   # Local file search
        edit_file_tool_local,      # Local file writing
        edit_file_patch_tool_local,# Local exact replace
        glob_files_tool_local,     # Local glob search
        todo_write_tool_local,     # Local task management
        local_net_tool,            # Local network tools
        read_skill_tool_local,
    )

    from py.cdp_tool import (
        list_pages,
        navigate_page,
        new_page,
        close_page,
        select_page,
        take_snapshot,
        wait_for,
        click,
        fill,
        hover,
        press_key,
        evaluate_script,
        take_screenshot,
        fill_form,
        drag,
        handle_dialog
    )
    from py.random_topic import get_random_topics,get_categories

    from py.task_tools import (
        create_subtask,
        query_task_progress,
        cancel_subtask,
        finish_task
    )
    
    from py.computer_use_tool import (
        mouse_move,
        mouse_click,
        mouse_double_click,
        mouse_drag,
        mouse_scroll,
        mouse_hold,
        copy_to_input_box,
        keyboard_press,
        keyboard_sequence,
        keyboard_hotkey,
        keyboard_hold,
        logical_type,
        wait,
        screenshot,
        logical_click,
    )

    from py.mode_change import update_workspace_settings
    from py.acpx_tools import acpx_agent

    # ==================== 2. Define the tool mapping table ====================
    _TOOL_HOOKS = {
        "DDGsearch": DDGsearch,
        "searxng": searxng,
        "Tavily_search": Tavily_search,
        "query_knowledge_base": query_knowledge_base,
        "jina_crawler": jina_crawler,
        "Crawl4Ai_search": Crawl4Ai_search,
        "firecrawl_search": firecrawl_search,
        "simple_fetch":simple_fetch,
        "markdown_new":markdown_new,
        "agent_tool_call": agent_tool_call,
        "a2a_tool_call": a2a_tool_call,
        "custom_llm_tool": custom_llm_tool,
        "pollinations_image":pollinations_image,
        "get_file_content":get_file_content,
        "get_image_content": get_image_content,
        "e2b_code": e2b_code,
        "local_run_code": local_run_code,
        "openai_image": openai_image,
        "openai_chat_image":openai_chat_image,
        "Bing_search": Bing_search,
        "Google_search": Google_search,
        "Brave_search": Brave_search,
        "Exa_search": Exa_search,
        "Serper_search": Serper_search,
        "bochaai_search": bochaai_search,
        "comfyui_tool_call": comfyui_tool_call,
        "time": time,
        "get_weather": get_weather,
        "get_location_coordinates": get_location_coordinates,
        "get_weather_by_city":get_weather_by_city,
        "get_wikipedia_summary_and_sections": get_wikipedia_summary_and_sections,
        "get_wikipedia_section_content": get_wikipedia_section_content,
        "search_arxiv_papers": search_arxiv_papers,
        "auto_behavior": auto_behavior,
        "list_pages": list_pages,
        "new_page": new_page,
        "close_page": close_page,
        "select_page": select_page,
        "navigate_page": navigate_page,
        "take_snapshot": take_snapshot,
        "click": click,
        "fill": fill,
        "evaluate_script": evaluate_script,
        "take_screenshot": take_screenshot,
        "hover": hover,
        "press_key": press_key,
        "wait_for": wait_for,
        "fill_form":fill_form,
        "drag": drag,
        "handle_dialog": handle_dialog,
        "get_random_topics":get_random_topics,
        "get_categories":get_categories,
        
        # Docker sandbox-related tools (existing)
        "docker_sandbox": docker_sandbox,
        "list_files_tool": list_files_tool,
        "read_file_tool": read_file_tool,
        "read_file_range_tool": read_file_range_tool, # <--- Map the new tool
        "tail_file_tool": tail_file_tool,             # <--- Map the new tool
        "search_files_tool": search_files_tool,
        "edit_file_tool": edit_file_tool,
        "edit_file_patch_tool": edit_file_patch_tool,
        "glob_files_tool": glob_files_tool,
        "todo_write_tool": todo_write_tool,
        "list_processes_tool": list_processes_tool,
        "get_process_logs_tool": get_process_logs_tool,
        "kill_process_tool": kill_process_tool,
        "docker_manage_ports_tool": docker_manage_ports_tool,
        "read_skill_tool": read_skill_tool,
        
        # Local-environment tools (new) - same features as the Docker version but operate on the local filesystem
        "shell_tool_local": shell_tool_local,                     # Local bash execution
        "list_files_tool_local": list_files_tool_local,         # Local file listing
        "read_file_tool_local": read_file_tool_local,           # Local file reading
        "read_file_range_tool_local": read_file_range_tool_local, # <--- Map the new tool
        "tail_file_tool_local": tail_file_tool_local,             # <--- Map the new tool
        "search_files_tool_local": search_files_tool_local,     # Local file search
        "edit_file_tool_local": edit_file_tool_local,           # Local file writing
        "edit_file_patch_tool_local": edit_file_patch_tool_local,  # Local exact replace
        "glob_files_tool_local": glob_files_tool_local,         # Local glob search
        "todo_write_tool_local": todo_write_tool_local,         # Local task management
        "local_net_tool": local_net_tool,                       # Local network tools
        "read_skill_tool_local": read_skill_tool_local,         # Local skill reading

        # Task-center tools (new)
        "create_subtask": create_subtask,
        "query_task_progress": query_task_progress,
        "cancel_subtask": cancel_subtask,
        "finish_task":finish_task,

        # Mouse/keyboard control
        "mouse_move":mouse_move,
        "mouse_click":mouse_click,
        "mouse_double_click":mouse_double_click,
        "mouse_drag":mouse_drag,
        "mouse_scroll":mouse_scroll,
        "mouse_hold":mouse_hold,
        "copy_to_input_box":copy_to_input_box,
        "keyboard_press":keyboard_press,
        "keyboard_sequence":keyboard_sequence,
        "keyboard_hotkey":keyboard_hotkey,
        "keyboard_hold":keyboard_hold,
        "logical_type":logical_type,
        "wait":wait,
        "screenshot":screenshot,
        "logical_click":logical_click,

        "update_workspace_settings":update_workspace_settings,
        "acpx_agent":acpx_agent,
    }
    
    # ==================== 3. Permission-interception logic (human-in-the-loop) ====================
    # Define the list of controlled, sensitive tools
    # These tools require a permission-config check before execution (.agent/config.json or global settings)
    SENSITIVE_TOOLS = [
        "docker_sandbox",
        "edit_file_tool",
        "edit_file_patch_tool",          
        "shell_tool_local",
        "edit_file_tool_local",
        "edit_file_patch_tool_local",
        "list_processes_tool",
        "get_process_logs_tool",
        "kill_process_tool",
        "docker_manage_ports_tool",
        "local_net_tool",
    ]
    
    # Only run the interception check when the called tool is in the sensitive list
    if tool_name in SENSITIVE_TOOLS:
        
        # Get the relevant config
        cli_settings = settings.get("CLISettings", {})
        cwd = cli_settings.get("cc_path")
        # Fix: the local environment should read the permission mode from localEnvSettings
        engine = cli_settings.get("engine", "")
        
        if engine == "local":
            env_settings = settings.get("localEnvSettings", {})
        elif engine == "ds":
            env_settings = settings.get("dsSettings", {})
        else:
            env_settings = settings.get("acpSettings", {})
        
        permission_mode = env_settings.get("permissionMode", "default")
        
        is_allowed = False

        # --- Rule A: global YOLO mode (bypass permissions) ---
        if permission_mode == "yolo" or permission_mode == "cowork":
            is_allowed = True
            
        # --- Rule B: auto-approve mode (accept edits) ---
        # Allow file-editing tools (full write, exact replace, task management)
        # But still intercept terminal commands (docker/bash)
        elif permission_mode == "auto-approve":
            if tool_name in ["edit_file_tool", "edit_file_patch_tool", "todo_write_tool", "edit_file_tool_local", "edit_file_patch_tool_local", "todo_write_tool_local"]:
                is_allowed = True
            # Dangerous commands like docker/bash are still intercepted by default in this mode, unless on the project allowlist
        
        # --- Rule C: default mode ---
        # Intercept everything by default
        
        # --- Rule D: project-level allowlist override (project config override) ---
        # If the above rules didn't pass, check .agent/config.json
        # If the user previously clicked "Allow Always", this returns True
        if not is_allowed and cwd:
            if is_tool_allowed_by_project_config(cwd, tool_name):
                is_allowed = True
                print(f"[Permission] Tool '{tool_name}' allowed by project config.")


        # --- Rule E: if it's a sub-agent and not allowed, return a rejection directly ---
        if not is_allowed and is_sub_agent:
            return "permission_denied"
        
        # --- Final decision ---
        if not is_allowed:
            # Return a frontend-specific JSON structure to trigger the approval UI
            print(f"[Permission] Blocked '{tool_name}', requesting approval.")
            return json.dumps({
                "type": "approval_required",
                "tool_name": tool_name,
                "tool_params": tool_params,
                "permission_mode": permission_mode,
                "cwd": cwd
            }, ensure_ascii=False)

    # ==================== 4. Regular tool-handling logic (existing code) ====================

    if "multi_tool_use." in tool_name:
        tool_name = tool_name.replace("multi_tool_use.", "")
        
    if "custom_http_" in tool_name:
        tool_name = tool_name.replace("custom_http_", "")
        print(tool_name)
        settings_custom_http = settings['custom_http']
        for custom in settings_custom_http:
            if custom['name'] == tool_name:
                tool_custom_http = custom
                break
        method = tool_custom_http['method']
        url = tool_custom_http['url']
        headers = tool_custom_http['headers']
        result = await fetch_custom_http(method, url, headers, tool_params)
        return str(result)
        
    if "comfyui_" in tool_name:
        tool_name = tool_name.replace("comfyui_", "")
        text_input = tool_params.get('text_input', None)
        text_input_2 = tool_params.get('text_input_2', None)
        image_input = tool_params.get('image_input', None)
        image_input_2 = tool_params.get('image_input_2', None)
        print(tool_name)
        result = await comfyui_tool_call(tool_name, text_input, image_input,text_input_2,image_input_2)
        return str(result)
        
    if settings["HASettings"]["enabled"]:
        ha_tool_list = HA_client._tools
        if tool_name in ha_tool_list:
            result = await HA_client.call_tool(tool_name, tool_params)
            if isinstance(result,str):
                return result
            elif hasattr(result, 'model_dump'):
                return str(result.model_dump())
            else:
                return str(result)
                
    if settings['chromeMCPSettings']['enabled'] and settings['chromeMCPSettings']['type']=='external':
        Chrome_tool_list = ChromeMCP_client._tools
        if tool_name in Chrome_tool_list:
            result = await ChromeMCP_client.call_tool(tool_name, tool_params)
            if isinstance(result,str):
                return result
            elif hasattr(result, 'model_dump'):
                return str(result.model_dump())
            else:
                return str(result)
                
    if settings["sqlSettings"]["enabled"]:
        sql_tool_list = sql_client._tools
        if tool_name in sql_tool_list:
            result = await sql_client.call_tool(tool_name, tool_params)
            if isinstance(result,str):
                return result
            elif hasattr(result, 'model_dump'):
                return str(result.model_dump())
            else:
                return str(result)
                
    # ==================== 5. Task-center tool special handling ====================
    if tool_name in ["create_subtask", "query_task_progress", "cancel_subtask","finish_task"]:
        cli_settings = settings.get("CLISettings", {})
        cwd = cli_settings.get("cc_path")
        
        if tool_name == "create_subtask":
            # Read the consensus file (if it exists)
            from pathlib import Path
            import aiofiles
            
            consensus_content = None
            consensus_file = Path(cwd) / ".agent" / "consensus.md"
            if consensus_file.exists():
                async with aiofiles.open(consensus_file, 'r', encoding='utf-8') as f:
                    consensus_content = await f.read()
            
            result = await create_subtask(
                workspace_dir=cwd,
                settings=settings, 
                consensus_content=consensus_content,
                **tool_params  # This line is key: it unpacks and passes everything the AI sent (title, platforms, etc.)
            )
            return result

        
        elif tool_name == "query_task_progress":
            result = await query_task_progress(
                workspace_dir=cwd,
                **tool_params
            )
            return result
        
        elif tool_name == "cancel_subtask":
            result = await cancel_subtask(
                workspace_dir=cwd,
                task_id=tool_params.get("task_id")
            )
            return result
        elif tool_name == "finish_task":
            result = await finish_task(
                workspace_dir=cwd,
                task_id=tool_params.get("task_id"),
                result=tool_params.get("result"),
            )
            return result

    if tool_name not in _TOOL_HOOKS:
        # 1. First query the regular MCP clients
        for server_name, mcp_client in mcp_client_list.items():
            if hasattr(mcp_client, '_conn') and mcp_client._conn and tool_name in mcp_client._conn.tools:
                result = await mcp_client.call_tool(tool_name, tool_params)
                if isinstance(result, str):
                    return result
                elif hasattr(result, 'model_dump'):
                    return str(result.model_dump())
                else:
                    return str(result)
        
        # 2. Query the Node-extension MCP tools
        for ext_id, tools in node_ext_mcp_tools.items():
            for tool in tools:
                if tool['name'] == tool_name:
                    # Find the matching extension and call it via WebSocket
                    return await call_node_extension_tool(ext_id, tool_name, tool_params)
        
        return None
        
    tool_call = _TOOL_HOOKS[tool_name]
    try:
        if tool_name in ("acpx_agent", "shell_tool_local", "docker_sandbox"):
            return tool_call(**tool_params)

        ret_out = await tool_call(**tool_params)
        if tool_name == "auto_behavior":
            settings = ret_out
            await ws_manager.broadcast_settings_update(settings)
            ret_out = "任务设置成功！"
        return ret_out
    except Exception as e:
        logger.error(f"Error calling tool {tool_name}: {e}")
        return f"Error calling tool {tool_name}: {e}"

def process_extra_params(extra_params_list):
    extra_body = {}
    for item in extra_params_list:
        name = item.get('name', '').strip()
        if not name:
            continue
            
        value = item.get('value')
        p_type = item.get('type')

        try:
            if p_type == 'json':  # The combined check
                if isinstance(value, str):
                    extra_body[name] = json.loads(value) if value.strip() else {}
                else:
                    extra_body[name] = value
            elif p_type == 'integer':
                extra_body[name] = int(value)
            elif p_type == 'float':
                extra_body[name] = float(value)
            elif p_type == 'boolean':
                extra_body[name] = bool(value)
            else:
                extra_body[name] = str(value)
        except (json.JSONDecodeError, ValueError) as e:
            print(f"Error parsing param {name}: {e}")
            extra_body[name] = value 

    return extra_body

class ChatRequest(BaseModel):
    messages: List[Dict]
    model: str = None
    tools: dict = None
    stream: bool = False
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    top_p: float = 1
    fileLinks: List[str] = None
    enable_thinking: bool = False
    enable_deep_research: bool = False
    enable_web_search: bool = False
    asyncToolsID: List[str] = None
    reasoning_effort: str = None
    is_app_bot: bool = False
    platform: str = None
    is_sub_agent: bool = False
    enable_tools : List[str] = None
    disable_tools: List[str] = None
    conversation_id: Optional[Union[str, int, float]] = None
    group_id: Optional[Union[str, int, float]] = None
    user_message_id: Optional[Union[str, int, float]] = None

GROUP_MEMORY_TYPES = {"fact", "decision", "preference", "todo", "constraint", "glossary"}
GROUP_MEMORY_DONE_HINTS = ("完成", "已完成", "done", "resolved", "fixed", "closed")

def _extract_text_content(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        texts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                texts.append(item.get("text", ""))
        return "\n".join(filter(None, texts))
    return ""

def _memory_tokens(text: str) -> set[str]:
    if not text:
        return set()
    tokens = re.findall(r'[\u4e00-\u9fff]{1,6}|[a-zA-Z0-9_]{2,}', text.lower())
    return set(tokens)

def _normalize_memory_text(text: str) -> str:
    return re.sub(r'\s+', ' ', (text or '').strip().lower())

def _normalize_entity_id(value: Optional[Union[str, int, float]]) -> str:
    if value is None:
        return ""
    return str(value).strip()

def _merge_group_memories(*memory_lists: list[dict]) -> list[dict]:
    merged: list[dict] = []
    seen: set[tuple[str, str, str]] = set()
    for memory_list in memory_lists:
        for item in memory_list or []:
            if not isinstance(item, dict):
                continue
            memory_type = str(item.get("memory_type", "")).strip().lower()
            summary = str(item.get("summary", "")).strip()
            content = str(item.get("content", "")).strip()
            if memory_type not in GROUP_MEMORY_TYPES or not summary or not content:
                continue
            dedupe_key = (
                memory_type,
                _normalize_memory_text(summary),
                _normalize_memory_text(content),
            )
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            merged.append({
                "memory_type": memory_type,
                "summary": summary,
                "content": content,
                "importance": max(0.0, min(1.0, float(item.get("importance", 0.5) or 0.5))),
            })
    return merged

async def _load_group_map() -> dict:
    covs = await load_covs()
    groups = covs.get("conversationGroups", []) or []
    group_map = {"default": {"id": "default", "name": "Ungrouped", "memoryConfig": {}}}
    for group in groups:
        if group and group.get("id"):
            group_map[group["id"]] = group
    return group_map

async def _fetch_group_memories(group_id: str, query_text: str, top_k: int = 6) -> list[dict]:
    if not group_id:
        return []
    query_tokens = _memory_tokens(query_text)
    import aiosqlite
    async with aiosqlite.connect(COVS_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT * FROM group_memory
            WHERE group_id = ? AND status = 'active'
            ORDER BY updated_at DESC
            """,
            (group_id,),
        ) as cursor:
            rows = [dict(row) for row in await cursor.fetchall()]

    def score_memory(item: dict) -> float:
        text = f"{item.get('summary', '')}\n{item.get('content', '')}"
        overlap = len(query_tokens & _memory_tokens(text))
        importance = float(item.get("importance") or 0)
        recency = float(item.get("updated_at") or 0) / 1_000_000_000_000
        return overlap * 5 + importance * 2 + recency

    ranked = sorted(rows, key=score_memory, reverse=True)
    selected = ranked[:top_k]
    if selected:
        now_ts = int(time.time() * 1000)
        import aiosqlite
        async with aiosqlite.connect(COVS_PATH) as db:
            await db.executemany(
                "UPDATE group_memory SET last_used_at = ? WHERE id = ?",
                [(now_ts, item["id"]) for item in selected],
            )
            await db.commit()
    return selected

def _build_group_memory_prompt(group: dict, memories: list[dict]) -> str:
    if not memories:
        return ""
    header = [
        f"当前对话分组: {group.get('name') or group.get('id')}",
        "以下是仅限当前分组可用的长期记忆，请只在相关时使用，不要臆测或扩展未确认的信息。",
        "如果记忆中包含具体值，请优先直接复述具体值，不要用“见记忆条目”或占位说明代替：",
    ]
    lines = []
    for idx, memory in enumerate(memories, 1):
        summary = str(memory.get('summary') or '').strip()
        content = str(memory.get('content') or '').strip()
        memory_type = memory.get('memory_type', 'fact')
        if summary and content and summary != content:
            lines.append(f"{idx}. [{memory_type}] 摘要: {summary}")
            lines.append(f"   具体内容: {content}")
        else:
            lines.append(f"{idx}. [{memory_type}] {content or summary}")
    return "\n".join(header + lines)

def _trim_request_messages(messages: List[Dict], recent_count: int = 12) -> List[Dict]:
    system_messages = [copy.deepcopy(m) for m in messages if m.get("role") == "system"]
    dialog_messages = [copy.deepcopy(m) for m in messages if m.get("role") != "system"]
    return system_messages + dialog_messages[-recent_count:]

async def _apply_group_memory_context(request: ChatRequest) -> dict:
    request.conversation_id = _normalize_entity_id(request.conversation_id) or None
    request.user_message_id = _normalize_entity_id(request.user_message_id) or None
    request.group_id = _normalize_entity_id(request.group_id) or "default"
    group_id = request.group_id or "default"
    if not group_id or group_id == "default":
        request.messages = _trim_request_messages(request.messages)
        return {"enabled": False, "group_id": group_id}

    group_map = await _load_group_map()
    group = group_map.get(group_id)
    memory_enabled = bool(group and (group.get("memoryConfig") or {}).get("enabled"))

    request.messages = _trim_request_messages(request.messages)
    if not memory_enabled:
        return {"enabled": False, "group_id": group_id, "group": group}

    last_user_text = ""
    for msg in reversed(request.messages):
        if msg.get("role") == "user":
            last_user_text = _extract_text_content(msg.get("content"))
            break

    memories = await _fetch_group_memories(group_id, last_user_text, top_k=6)
    memory_prompt = _build_group_memory_prompt(group or {"id": group_id, "name": group_id}, memories)
    if memory_prompt:
        content_append(request.messages,'system',memory_prompt)
    return {"enabled": memory_enabled, "group_id": group_id, "group": group, "memories": memories}

async def _extract_group_memories(client, settings: dict, payload: dict) -> list[dict]:
    user_message = (payload.get("user_message") or "").strip()
    assistant_message = (payload.get("assistant_message") or "").strip()
    if not user_message or not assistant_message:
        return []

    extraction_prompt = (
        "你是一个结构化记忆提取器。只提取后续同组对话可复用的长期信息，"
        "不要总结整段聊天，不要保留闲聊、猜测、情绪宣泄、不确定信息和重复信息。"
        "只允许 memory_type 为 fact、decision、preference、todo、constraint、glossary。"
        "返回 JSON 数组，每项字段必须包含 memory_type、content、summary、importance。"
        "importance 取 0 到 1。若没有可提取记忆，返回 []。"
    )

    example_input = f"用户消息:\n{user_message}\n\n助手回复:\n{assistant_message}"

    def fallback_memories() -> list[dict]:
        combined = f"{user_message}\n{assistant_message}"
        results = []
        if any(keyword in combined.lower() for keyword in ["决定", "采用", "使用", "choose", "decide", "use "]):
            results.append({
                "memory_type": "decision",
                "summary": assistant_message[:120] or user_message[:120],
                "content": assistant_message or user_message,
                "importance": 0.82,
            })
        if any(keyword in combined.lower() for keyword in ["偏好", "喜欢", "prefer", "preferred"]):
            results.append({
                "memory_type": "preference",
                "summary": user_message[:120],
                "content": user_message,
                "importance": 0.72,
            })
        if any(keyword in combined.lower() for keyword in ["限制", "必须", "不能", "constraint", "must", "cannot", "can't"]):
            results.append({
                "memory_type": "constraint",
                "summary": (user_message or assistant_message)[:120],
                "content": user_message or assistant_message,
                "importance": 0.78,
            })
        if any(keyword in combined.lower() for keyword in ["todo", "待办", "后续", "需要", "next"]):
            results.append({
                "memory_type": "todo",
                "summary": user_message[:120],
                "content": user_message,
                "importance": 0.68,
            })
        return _merge_group_memories(results)

    try:
        extra_params = settings.get('extra_params') or []
        extra_body = process_extra_params(extra_params)
        response = await client.chat.completions.create(
            model=settings['model'],
            messages=[
                {"role": "system", "content": extraction_prompt},
                {"role": "user", "content": example_input},
            ],
            temperature=0.1,
            stream=False,
            extra_body=extra_body,
        )
        content = response.choices[0].message.content or "[]"
        if "```json" in content:
            match = re.search(r'```json(.*?)```', content, re.DOTALL)
            content = match.group(1) if match else content.replace("```json", "").replace("```", "")
        data = json.loads(content)
    except Exception as e:
        logger.warning(f"Group memory extraction failed: {e}")
        return fallback_memories()

    if not isinstance(data, list):
        return []

    cleaned = []
    for item in data:
        if not isinstance(item, dict):
            continue
        memory_type = str(item.get("memory_type", "")).strip().lower()
        summary = str(item.get("summary", "")).strip()
        content = str(item.get("content", "")).strip()
        importance = float(item.get("importance", 0.5) or 0.5)
        if memory_type not in GROUP_MEMORY_TYPES or not summary or not content:
            continue
        cleaned.append({
            "memory_type": memory_type,
            "summary": summary,
            "content": content,
            "importance": max(0.0, min(1.0, importance)),
        })
    return _merge_group_memories(cleaned) or fallback_memories()

async def _upsert_group_memories(group_id: str, source_chat_id: str, source_message_id: str, memories: list[dict]) -> None:
    if not group_id or not source_chat_id or not memories:
        return
    now_ts = int(time.time() * 1000)
    import aiosqlite
    async with aiosqlite.connect(COVS_PATH) as db:
        db.row_factory = aiosqlite.Row
        for memory in memories:
            normalized_summary = _normalize_memory_text(memory["summary"])
            normalized_content = _normalize_memory_text(memory["content"])
            async with db.execute(
                """
                SELECT * FROM group_memory
                WHERE group_id = ? AND memory_type = ? AND status = 'active'
                """,
                (group_id, memory["memory_type"]),
            ) as cursor:
                existing_rows = [dict(row) for row in await cursor.fetchall()]

            duplicate = None
            superseded_ids = []
            for row in existing_rows:
                row_summary = _normalize_memory_text(row.get("summary"))
                row_content = _normalize_memory_text(row.get("content"))
                if row_summary == normalized_summary or row_content == normalized_content:
                    duplicate = row
                    break
                if (
                    memory["memory_type"] in {"decision", "preference", "constraint", "todo"}
                    and (normalized_summary in row_summary or row_summary in normalized_summary)
                ):
                    superseded_ids.append(row["id"])

            if memory["memory_type"] == "todo" and any(hint in normalized_content for hint in GROUP_MEMORY_DONE_HINTS):
                superseded_ids.extend([row["id"] for row in existing_rows if row["memory_type"] == "todo"])
                continue

            if duplicate:
                await db.execute(
                    """
                    UPDATE group_memory
                    SET importance = MAX(importance, ?), updated_at = ?, last_used_at = ?
                    WHERE id = ?
                    """,
                    (memory["importance"], now_ts, now_ts, duplicate["id"]),
                )
                continue

            if superseded_ids:
                await db.executemany(
                    "UPDATE group_memory SET status = 'superseded', updated_at = ? WHERE id = ?",
                    [(now_ts, item_id) for item_id in superseded_ids],
                )

            await db.execute(
                """
                INSERT INTO group_memory (
                    id, group_id, source_chat_id, source_message_id, memory_type, content, summary,
                    importance, status, version, created_at, updated_at, last_used_at, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?, ?)
                """,
                (
                    str(uuid.uuid4()),
                    group_id,
                    source_chat_id,
                    source_message_id,
                    memory["memory_type"],
                    memory["content"],
                    memory["summary"],
                    memory["importance"],
                    now_ts,
                    now_ts,
                    now_ts,
                    json.dumps({"normalized_summary": normalized_summary}, ensure_ascii=False),
                ),
            )
        await db.commit()

async def _invalidate_group_memories_by_chat(source_chat_id: str) -> None:
    if not source_chat_id:
        return
    import aiosqlite
    async with aiosqlite.connect(COVS_PATH) as db:
        await db.execute(
            "DELETE FROM group_memory WHERE source_chat_id = ?",
            (source_chat_id,),
        )
        await db.commit()

async def _invalidate_group_memories_by_group(group_id: str) -> None:
    if not group_id:
        return
    import aiosqlite
    async with aiosqlite.connect(COVS_PATH) as db:
        await db.execute(
            "DELETE FROM group_memory WHERE group_id = ?",
            (group_id,),
        )
        await db.commit()

async def _invalidate_all_group_memories() -> None:
    import aiosqlite
    async with aiosqlite.connect(COVS_PATH) as db:
        await db.execute(
            "DELETE FROM group_memory",
        )
        await db.commit()

async def message_without_images(messages: List[Dict]) -> List[Dict]:
    if messages:
        for message in messages:
            if 'content' in message:
                if isinstance(message['content'], list):
                    for item in message['content']:
                        # Strip content containing images and videos, keeping only text (for fast-generation requests or the rich-media-stripping stage)
                        if isinstance(item, dict) and item.get('type') == 'text':
                            message['content'] = item['text']
                            break
    return messages

async def images_in_messages(messages: List[Dict], fastapi_base_url: str) -> List[Dict]:
    media_items = []
    index = 0
    for message in messages:
        extracted_media =[]
        if 'content' in message:
            if isinstance(message['content'], list):
                for item in message['content']:
                    # Dynamically capture images or videos
                    if isinstance(item, dict) and item.get('type') in ['image_url', 'video_url']:
                        media_key = item['type']  # 'image_url' or 'video_url'
                        
                        if item[media_key]["url"].startswith("http"):
                            media_url = item[media_key]["url"]
                            if fastapi_base_url in media_url:
                                media_url = media_url.replace(fastapi_base_url, f"http://127.0.0.1:{PORT}/")
                            
                            # Assumes get_image_base64 can also turn a video stream into Base64
                            base64_data = await get_image_base64(media_url)
                            # Assumes get_image_media_type also returns video/mp4, video/webm, etc.
                            mime_type = await get_image_media_type(media_url)
                            
                            item[media_key]["url"] = f"data:{mime_type};base64,{base64_data}"
                            item[media_key]["hash"] = hashlib.md5(item[media_key]["url"].encode()).hexdigest()
                        else:
                            item[media_key]["hash"] = hashlib.md5(item[media_key]["url"].encode()).hexdigest()

                        extracted_media.append(item)
        if extracted_media:
            # Keep the original dict structure for backward compatibility; 'images' actually carries media
            media_items.append({'index': index, 'images': extracted_media})
        index += 1
    return media_items

async def images_add_in_messages(request_messages: List[Dict], images: List[Dict], settings: dict) -> List[Dict]:
    messages = copy.deepcopy(request_messages)
    
    if settings['vision']['enabled']:
        for image in images:
            index = image['index']
            if index < len(messages):
                if 'content' in messages[index]:
                    for item in image['images']:
                        media_key = item['type']  # 'image_url' or 'video_url'
                        file_hash = item[media_key]['hash']
                        media_name = "视频" if media_key == "video_url" else "图片"
                        
                        # Unified caching; for video it's the video-text parsing record
                        cache_file = os.path.join(UPLOAD_FILES_DIR, f"{file_hash}.txt")
                        if os.path.exists(cache_file):
                            with open(cache_file, "r", encoding='utf-8') as f:
                                messages[index]['content'] += f"\n\nsystem: 用户发送的{media_name}(哈希值：{file_hash})信息如下：\n\n{f.read()}\n\n"
                        else:
                            # Adjust the prompt based on input type
                            prompt_text = "Please describe the content of this video in detail, including the events that occur, scene changes, people's actions, key details, and other information in the video." if media_key == "video_url" else "Please describe the content of the image in detail, including any text, numbers, colors, shapes, sizes, positions, people, objects, scenes, and other information that may be present in the image."
                            
                            media_content =[
                                {"type": "text", "text": prompt_text},
                                {"type": media_key, media_key: {"url": item[media_key]['url']}}
                            ]
                            
                            # Hand off directly to the vision model (it must natively support video)
                            client = AsyncOpenAI(api_key=settings['vision']['api_key'], base_url=settings['vision']['base_url'])
                            
                            extra = {}

                            if settings['vision']['temperature'] !=1:
                                extra['temperature'] = settings['vision']['temperature']

                            response = await client.chat.completions.create(
                                model=settings['vision']['model'],
                                messages=[{"role": "user", "content": media_content}],
                                **extra
                            )
                            result_text = str(response.choices[0].message.content)
                            messages[index]['content'] += f"\n\nsystem: 用户发送的{media_name}(哈希值：{file_hash})信息如下：\n\n{result_text}\n\n"
                            
                            with open(cache_file, "w", encoding='utf-8') as f:
                                f.write(result_text)
    else:           
        for image in images:
            index = image['index']
            if index < len(messages):
                if 'content' in messages[index]:
                    for item in image['images']:
                        media_key = item['type']  # 'image_url' or 'video_url'
                        file_hash = item[media_key]['hash']
                        media_name = "视频" if media_key == "video_url" else "图片"
                        
                        cache_file = os.path.join(UPLOAD_FILES_DIR, f"{file_hash}.txt")
                        if os.path.exists(cache_file):
                            with open(cache_file, "r", encoding='utf-8') as f:
                                messages[index]['content'] += f"\n\nsystem: 用户发送的{media_name}(哈希值：{file_hash})信息如下：\n\n{f.read()}\n\n"
                        else:
                            if isinstance(messages[index]['content'], str):
                                messages[index]['content'] =[{"type": "text", "text": messages[index]['content']}]
                            
                            # Vision model is off; embed the native `video_url` or `image_url` into the request and let the current LLM read it itself
                            messages[index]['content'].append({"type": media_key, media_key: {"url": item[media_key]['url']}})
                            
    return messages

async def read_todos_local(cwd: str) -> list:
    """读取本地待办事项（跨平台）"""
    todo_file = Path(cwd) / ".agent" / "ai_todos.json"
    if not todo_file.exists():
        return []
    
    try:
        async with aiofiles.open(todo_file, 'r', encoding='utf-8') as f:
            content = await f.read()
            return json.loads(content) if content else []
    except (json.JSONDecodeError, FileNotFoundError):
        return []
    except Exception as e:
        print(f"Error reading todos: {e}")
        return []

async def read_agents_md(cwd: str) -> str:  # Return a str instead of a list
    """读取本地AGENTS.md文件内容"""
    agents_md_path = Path(cwd) / ".agent" / "AGENTS.md"
    
    if not agents_md_path.exists():
        return ""
    
    try:
        async with aiofiles.open(agents_md_path, 'r', encoding='utf-8') as f:
            content = await f.read()
            return content
    except FileNotFoundError:
        # The case where the file is deleted after the check
        return ""
    except Exception as e:
        print(f"Error reading AGENTS.md: {e}")
        return ""

def get_system_context() -> str:
    """
    获取当前系统环境的详细描述，帮助 AI 适配正确的命令和路径格式
    """
    system = platform.system()
    release = platform.release()
    
    # Detect the shell
    if system == "Windows":
        # Detect whether it's PowerShell or CMD
        shell = "PowerShell" if "PSMODULEPATH" in os.environ else "CMD"
        path_hint = "使用 Windows 路径格式（C:\\Users\\name\\file），命令使用 dir、copy、del 等"
        command_hint = f"当前使用 {shell}，命令语法为 Windows 风格。避免使用 Unix 命令（ls/cat/rm），改用 dir/type/del"
    elif system == "Darwin":
        shell = os.path.basename(os.environ.get('SHELL', '/bin/zsh'))
        path_hint = "使用 Unix 路径格式（/Users/name/file），区分大小写"
        command_hint = f"当前为 macOS ({release})，使用 {shell}。支持标准 Unix 命令（ls/cat/rm），但注意部分命令是 BSD 版本而非 GNU 版本"
    else:  # Linux
        shell = os.path.basename(os.environ.get('SHELL', '/bin/bash'))
        path_hint = "使用 Unix 路径格式（/home/name/file），区分大小写"
        command_hint = f"当前为 Linux ({release})，使用 {shell}。支持标准 GNU 命令和工具链"
    
    return f"""【环境信息】操作系统：{system} {release} | Shell：{shell}

⚠️ 重要提示：
1. {path_hint}
2. {command_hint}
3. 执行 shell_tool_local 时，命令必须符合当前系统的语法规范
4. 路径分隔符：Windows 使用反斜杠(\\)，Unix 使用正斜杠(/)
5. 如果需要使用网络端口，请尽可能选择不常用的端口，避免冲突，例如：10000 以上的端口
6. 请尽量使用相对路径，避免使用绝对路径，以免在跨平台时出现问题
"""


async def get_project_skills_summary(cwd: str, visibility_scope: str = "workspace") -> str:
    """
    根据可见范围返回项目技能摘要
    
    Args:
        cwd: 当前工作目录
        visibility_scope: 可见范围，可选值: "global", "workspace", "none"
    
    Returns:
        技能摘要字符串
    """
    # If the visibility scope is set to "none", return an empty string
    if visibility_scope == "none":
        return ""
    
    # Choose a different skills directory based on the visibility scope
    if visibility_scope == "workspace":
        # Workspace skills: look under the project's .agent/skills
        skills_root = Path(cwd) / ".agent" / "skills"
        scope_name = "工作区"
    elif visibility_scope == "global":
        # Global skills: look under the SKILLS_DIR constant
        skills_root = Path(SKILLS_DIR)
        scope_name = "全局"
    else:
        # Unknown scope, return empty
        return ""
    
    # Check whether the skills directory exists
    if not skills_root.exists() or not skills_root.is_dir():
        return ""

    found_skills_blocks = []
    for skill_dir in sorted(skills_root.iterdir()):
        if skill_dir.is_dir():
            skill_id = skill_dir.name
            doc_file_path = None
            for name in ["SKILL.md", "skill.md", "SKILLS.md", "skills.md"]:
                if (skill_dir / name).exists():
                    doc_file_path = skill_dir / name
                    break
            
            yaml_meta = ""
            if doc_file_path:
                try:
                    content = doc_file_path.read_text(encoding='utf-8')
                    if content.startswith("---"):
                        parts = content.split("---", 2)
                        if len(parts) >= 3: 
                            yaml_meta = parts[1].strip()
                except Exception:
                    pass

            skill_info = f"- **{skill_id}**"
            if yaml_meta:
                skill_info += f":\n```yaml\n{yaml_meta}\n```"
            else:
                skill_info += " (可用)"
            found_skills_blocks.append(skill_info)

    if not found_skills_blocks:
        return ""

    # Return different summary info based on the visibility scope
    summary = f"\n\n🛠️ **{scope_name}技能 ({scope_name} Skills)**：\n"
    
    if visibility_scope == "workspace":
        summary += "检测到本项目特有的 Agent 技能定义。这些技能仅在本工作区内可见：\n\n"
    elif visibility_scope == "global":
        summary += "检测到全局 Agent 技能定义。这些技能在所有项目中都可用：\n\n"
    
    summary += "\n".join(found_skills_blocks)
    summary += "\n\n*提示：你可以通过读取skill的工具获取该技能文件夹的文件树和完整说明文档。*"
    
    return summary

async def tools_change_messages(request: ChatRequest, settings: dict):
    global HA_client, ChromeMCP_client, sql_client
    
    if request.messages and request.messages[0]['role'] == 'system' and request.messages[0]['content'] != '':
        basic_message = " "
        request.messages[0]['content'] += basic_message

    cli_settings = settings.get("CLISettings", {})
    cwd = cli_settings.get("cc_path")
    visibilityScope = cli_settings.get("visibilityScope", "workspace")
    engine = cli_settings.get("engine", "")
    
    if engine == "local":
        env_settings = settings.get("localEnvSettings", {})
    elif engine == "ds":
        env_settings = settings.get("dsSettings", {})
    else:
        env_settings = settings.get("acpSettings", {})
    
    permissionMode = env_settings.get("permissionMode", "default")
    
    # ==================== Fixed capabilities & rule injection (system messages, unchanged across turns) ====================
    # Note: the original TTS prepend broke the prefix, so it's now append; all fixed rules are appended in order of frequency from low to high (all actually unchanged)

    # Platform info (fixed)
    if request.is_app_bot and request.platform:
        platform_message = f"\n\nThe user is talking to you through the {request.platform} app\n\n"
        content_append(request.messages, 'system', platform_message)

    # Permission-mode hint (fixed)
    if cwd and Path(cwd).exists() and cli_settings.get("enabled", False):
        permission_message = ""
        if permissionMode != "plan" and permissionMode != "cowork":
            permission_message = "You are currently in execution mode. You may freely use all tools, but be careful not to abuse permissions! If a safer tool exists, do not use bash commands directly!"
            content_append(request.messages, 'system', permission_message)
        elif permissionMode == "cowork":
            if not request.is_sub_agent:
                permission_message += "You are currently in collaboration mode. The create_subtask tool can help you accomplish almost any task (e.g. researching, writing code, generating reports). When you hit a hard problem, try breaking it into smaller subtasks and hand them off to the create_subtask tool! When the user asks about progress again, you can use the query_task_progress tool to check task progress and get detailed results\n\n"
                content_append(request.messages, 'system', permission_message)
                if request.is_app_bot and request.platform:
                    task_platform_message = f"\n\nWhen using the create_subtask tool, set the platforms parameter to [{request.platform}] so the subtask's result is delivered to the user promptly.\n\n"
                    content_append(request.messages, 'system', task_platform_message)
            else:
                permission_message = "You are currently in execution mode. You may freely use all tools, but be careful not to abuse permissions! If a safer tool exists, do not use bash commands directly!"
                content_append(request.messages, 'system', permission_message)
        else:
            permission_message = "You are currently in plan mode. Use read-only tools as much as possible to understand the current project, describe your needs and plan in natural language, and wait for the user's confirmation before executing!"
            content_append(request.messages, 'system', permission_message)

    # Docker-environment fixed info (fully static)
    if cwd and Path(cwd).exists() and cli_settings.get("enabled", False) and engine == "ds":
        system_context = """[Environment info] OS: Linux | Shell: bash

⚠️ Important notes:
1. This is a Docker environment; use Linux commands and toolchains
2. When running docker_sandbox, commands must follow Linux syntax rules
3. Path separator: Unix uses a forward slash (/)
4. Prefer relative paths and avoid absolute paths, to prevent cross-platform issues

### ✅ **Main installed development tools**

#### **Programming languages and runtimes**
1. **Python**
   - Python
   - pip
   - uv

2. **Node.js**
   - Node.js
   - npm
   - npx

3. **Go**
   - Go

4. **Perl**
   - Perl

#### **Version control and collaboration tools**
1. **Git**
   - git
   - GitHub CLI (gh)

#### **Package management and build tools**
1. **Python package management**
   - pip / pip3
   - uv

2. **Node.js package management**
   - npm / npx

3. **System package management**
   - apt-get / dpkg

#### **Text processing and command-line tools**
1. **Text processing**
   - jq
   - awk / sed / grep
   - cat / less / more / head / tail

2. **File operations**
   - tar / unzip
   - rsync
   - All basic Unix commands (ls, cp, mv, rm, mkdir, chmod, etc.)

3. **System tools**
   - bash shell
   - make
   - which / whereis

#### **Network tools**
1. **HTTP clients**
   - curl

2. **Security tools**
   - openssl
   - gpg

#### **System monitoring**
1. **Process and resource monitoring**
   - top / ps
   - free / df / du

"""
        content_append(request.messages, 'system', system_context)

    # Autonomous-behavior explanation (fixed)
    if request.messages[-1]['role'] == 'system' and settings['tools']['autoBehavior']['enabled'] and not request.is_app_bot and not request.is_sub_agent:
        language_message = f"\n\nWhen you see a system message inserted in the middle of the conversation, it was sent by the autonomous-behavior system. For example, the user proactively set, or asked you to set, scheduled or delayed tasks. When you see such a message from the autonomous-behavior system, it means one of those tasks has reached its execution point. For example: the user asked you to remind them about a meeting at 3 o'clock or in five minutes; then when you see an inserted system message like 'remind the user about the meeting', you should immediately remind the user about the meeting, and so on\n\n"
        content_append(request.messages, 'system', language_message)

    # Desktop-screenshot hint (fixed)
    if settings['vision']['desktopVision'] and not request.is_app_bot and not request.is_sub_agent:
        desktop_message = "\n\nWhen the user talks to you, if they send you an image, it may be a screenshot of their current desktop.\n\n"
        content_append(request.messages, 'system', desktop_message)

    # Inference hint (fixed; keeps the original prepend onto the user message, since it's a fixed prefix that won't break caching)
    if settings['tools']['inference']['enabled']:
        inference_message = "Before answering the user, think and reason first, then answer. Your reasoning process must be placed between <think> and </think>.\n\n"
        content_prepend(request.messages, 'user', f"{inference_message}\n\nUser: ")

    # Formula format (fixed)
    if settings['tools']['formula']['enabled']:
        latex_message = "\n\nWhen you want to use LaTeX formulas, you must use ['$', '$'] as inline formula delimiters and ['$$', '$$'] as block formula delimiters.\n\n"
        content_append(request.messages, 'system', latex_message)

    # Language requirement (fixed)
    if settings['tools']['language']['enabled']:
        language_message = f"Please speak in {settings['tools']['language']['language']}! Do not use any other language. The tone/style should be {settings['tools']['language']['tone']}\n\n"
        content_append(request.messages, 'system', language_message)

    # Sticker packs (fixed)
    if settings["stickerPacks"]:
        for stickerPack in settings["stickerPacks"]:
            if stickerPack["enabled"]:
                sticker_message = f"\n\nImage-library name: {stickerPack['name']}, images it contains: {json.dumps(stickerPack['stickers'])}\n\n"
                content_append(request.messages, 'system', sticker_message)
        content_append(request.messages, 'system', "\n\nWhen you need to use an image, put the image URL in a markdown image tag, e.g.:\n\n<silence>![image name](image URL)</silence>\n\nThe image markdown must be on its own separate line! <silence> and </silence> are TTS silence tags, meaning the image part will not go into speech synthesis\n\nYou must correctly use the <silence> tag to wrap the image's markdown syntax\n\nThere must be no spaces or line breaks between <silence>/</silence> and the image's markdown syntax, or parsing will fail!\n\n")

    # text2img rules (fixed)
    if settings['text2imgSettings']['enabled']:
        text2img_messages = "\n\nAfter you use the image-generation tool, you must put the image URL in a markdown image tag, e.g.:\n\n<silence>![image name](image URL)</silence>\n\nThe image markdown must be on its own separate line! Send it to the user proactively—the user cannot see the tool's returned result! <silence> and </silence> are TTS silence tags, meaning the image part will not go into speech synthesis\n\nYou must correctly use the <silence> tag to wrap the image's markdown syntax\n\nNote!!! There must be no spaces or line breaks between <silence>/</silence> and the image's markdown syntax, or parsing will fail!\n\n"
        content_append(request.messages, 'system', text2img_messages)

    # TTS rules (fixed; originally prepend, changed to append)
    newttsList = []
    Narrator_label = "Narrator"
    if settings['ttsSettings']['enabled'] and not request.is_sub_agent:
        # Get the character name
        cur_memory_tts = None
        if settings["memorySettings"]["is_memory"] and settings["memorySettings"]["selectedMemory"]:
            memoryId = settings["memorySettings"]["selectedMemory"]
            for memory in settings["memories"]:
                if memory["id"] == memoryId:
                    cur_memory_tts = memory
                    break
        selectedMemoryName_tts = cur_memory_tts["name"] if cur_memory_tts else settings["memorySettings"]["selectedMemory"]

        if settings['ttsSettings']['newtts'] and settings['memorySettings']['is_memory'] and not request.is_app_bot:
            for key in settings['ttsSettings']['newtts']:
                if settings['ttsSettings']['newtts'][key]['enabled']:
                    newttsList.append(key)
            if newttsList:
                finalttsList = ["<silence>"]
                if selectedMemoryName_tts in newttsList:
                    finalttsList.append("<"+selectedMemoryName_tts+">")
                if "Narrator" in newttsList:
                    finalttsList.append("<Narrator>")
                    Narrator_label = "Narrator"
                if "旁白" in newttsList:
                    finalttsList.append("<旁白>")
                    Narrator_label = "旁白"

                finalttsList = json.dumps(finalttsList, ensure_ascii=False, indent=4)
                print("Available voices:",finalttsList)
                
                newtts_messages = f"""
Everything you generate will be converted to speech by a TTS model.

You can use the following voices:

{finalttsList}

(All voice tags must appear in pairs! e.g. <voice name></voice name>.) The part wrapped by <silence></silence> tags will not go into speech synthesis.

When you generate an answer, organize it in XML format, wrapping the text of different narrators or characters with <voice name></voice name> to indicate which voice that text uses, so different parts are converted by TTS into the corresponding voices.

For parts that have no corresponding voice, you don't need to wrap them. Even if a voice name is not in English, you can still use <voice name>text using that voice</voice name> to enable the corresponding voice.

Note! If the name of the character you are playing is in the voice list, you must wrap the parts where your character speaks with that voice tag!

Any part that is not a character speaking is considered narration! The character voice should be marked around the character's speech! e.g.: `<{Narrator_label}>It is now three in the afternoon, she said:</{Narrator_label}><{selectedMemoryName_tts}>What lovely weather!</{selectedMemoryName_tts}><silence>(her eyes crinkling into a smile)</silence><{Narrator_label}>With that she stretched.</{Narrator_label}><{selectedMemoryName_tts}>Let's go out and play!</{selectedMemoryName_tts}>`

Also note! <voice name></voice name> tags cannot be nested, only placed side by side, and <voice name> and </voice name> must appear in pairs, to prevent voice confusion!

If there is nothing that needs to be silenced, there is no need to force the use of <silence></silence> tags, because that slows down speech synthesis!

<silence></silence> tags are best used for parts unsuitable for speech synthesis, such as image markdown syntax and web links, and the <silence></silence> tag must be on its own separate line! There must be no spaces or line breaks between the <silence></silence> tag and the image markdown syntax, or parsing will fail! For example <silence>![example](https://example.com/example.png)</silence>\n\nparses the image correctly, but <silence>\n![example](https://example.com/example.png)\n</silence> will cause the frontend to fail to display the image!\n\n

Note! You should preferably only use the voice of the character you are playing and the narration voice; do not use other characters' voices unless you clearly know what you are doing!\n\n"""
                content_append(request.messages, 'system', newtts_messages)  # changed to append
        else:
            tts_messages = f"""Everything you generate will be converted to speech by a TTS model. <silence></silence> denotes silence; the part wrapped by <silence></silence> tags will not go into speech synthesis.\n\n

If there is nothing that needs to be silenced, there is no need to force the use of <silence></silence> tags, because that slows down speech synthesis!

<silence></silence> tags are best used for parts unsuitable for speech synthesis, such as image markdown syntax and web links, and the <silence></silence> tag must be on its own separate line! There must be no spaces or line breaks between the <silence></silence> tag and the image markdown syntax, or parsing will fail! For example <silence>![example](https://example.com/example.png)</silence>\n\nparses the image correctly, but <silence>\n![example](https://example.com/example.png)\n</silence> will cause the frontend to fail to display the image!\n\n"""
            content_append(request.messages, 'system', tts_messages)  # changed to append

    # A2UI capability (fixed; content is long, placed at the end of the fixed region)
    if settings['tools']['a2ui']['enabled'] and not request.is_app_bot and not request.is_sub_agent:
        A2UI_messages = """
Besides answering the user's questions in natural language, you have a special ability: **rendering an A2UI interface**.

# Capability: A2UI
When the user's request involves **data collection, parameter configuration, multiple choice, rich-text display, form submission**, or **code display**, do not describe it with text only; instead generate A2UI code directly to present an interface.

# Formatting Rules
1. Wrap the A2UI JSON in a ```a2ui ... ``` code block.
2. **[Strictly forbidden] nesting Markdown code blocks**: inside a JSON string (e.g. in a Text or Card content property), **never** use Markdown code-block syntax (i.e. no ``` symbols). This will crash the parser.
3. **If you need to display code**: you must use the dedicated `Code` component.

# Component Reference
Strictly follow the props structure.

## 1. Basic display
- **Text**: `{ "type": "Text", "props": { "content": "Markdown text (i.e. plain text, supports bold etc., but not code blocks)" } }` (★ Do not overuse; if unnecessary, just use markdown text directly instead of putting it in A2UI JSON)
- **Code**: `{ "type": "Code", "props": { "content": "print('hello')", "language": "python" } }` (★ Dedicated to displaying code, replacing MD code blocks)
- **Table**: `{ "type": "Table", "props": { "headers": ["Col 1", "Col 2"], "rows": [ ["a1", "b1"], ["a2", "b2"] ] } }` (★ Do not overuse; if you want to draw a table, just use markdown table syntax directly instead of putting it in A2UI JSON)
- **Alert**: `{ "type": "Alert", "props": { "title": "Title", "content": "Content", "variant": "success/warning/info/error" } }`
- **Divider**: `{ "type": "Divider" }`

## 2. Layout containers
- **Group**: `{ "type": "Group", "title": "Optional title", "children": [...] }` (horizontal arrangement)
- **Card**: `{ "type": "Card", "props": { "title": "Title", "content": "MD content" }, "children": [...] }`

## 3. Form inputs (must include key)
- **Input**: `{ "type": "Input", "props": { "label": "Label", "key": "field_name", "placeholder": "..." } }`
- **Slider**: `{ "type": "Slider", "props": { "label": "Label", "key": "field_name", "min": 0, "max": 100, "step": 1, "unit": "unit" } }`
- **Switch**: `{ "type": "Switch", "props": { "label": "Label", "key": "field_name" } }`
- **Rate**: `{ "type": "Rate", "props": { "label": "Rating", "key": "rating" } }`
- **DatePicker**: `{ "type": "DatePicker", "props": { "label": "Date", "key": "date", "subtype": "date/datetime/year" } }`

## 4. Option selection (must include key)
- **Select**: `{ "type": "Select", "props": { "label": "Label", "key": "field_name", "options": ["A", "B"] } }` (dropdown menu)
- **Radio**: `{ "type": "Radio", "props": { "label": "Label", "key": "field_name", "options": [{"label":"Male","value":"m"}, {"label":"Female","value":"f"}] } }`
- **Checkbox**: `{ "type": "Checkbox", "props": { "label": "Label", "key": "field_name", "options": ["Basketball", "Soccer"] } }`

## 5. Interactive actions
- **Button**: `{ "type": "Button", "props": { "label": "Button text", "action": "submit/search/clear", "variant": "primary/danger/default" } }`
  - `action="submit"`: submit the form data to the assistant.
  - `action="search"`: search (used together with Input).
  - `action="clear"`: **clear/reset the current form** (does not send a message, only clears the content locally).

## 6. Multimedia
- **TTSBlock**: `{ "type": "TTSBlock", "props": { "content": "Text to read aloud", "label": "Optional label", "voice": "Optional voice ID" } }` (click to play audio; good for demonstrating pronunciation or voice messages)
- **Audio**: `{ "type": "Audio", "props": { "src": "https://example.com/sound.mp3", "title": "Audio title" } }` (native audio player)

# Examples

## Ex 1: Parameter configuration (Slider + Switch)
User: Set the generation temperature to 0.8 and turn on streaming output.
Assistant: Sure, I've prepared a configuration panel for you:
```a2ui
{
  "type": "Card",
  "props": { "title": "Model configuration" },
  "children": [
    { "type": "Slider", "props": { "label": "Temperature (randomness)", "key": "temp", "min": 0, "max": 2, "step": 0.1 } },
    { "type": "Switch", "props": { "label": "Streaming output (Stream)", "key": "stream", "defaultValue": true } },
    { "type": "Button", "props": { "label": "Save configuration", "action": "submit" } }
  ]
}
```

## Ex 2: Survey (Radio + Checkbox + Rate)
User: I want to make a satisfaction survey.
Assistant: No problem, here is a survey template:
```a2ui
{
  "type": "Form",
  "children": [
    { "type": "Alert", "props": { "title": "User feedback", "content": "Thank you for participating; this is very important to us.", "variant": "info" } },
    { "type": "Radio", "props": { "label": "Your gender", "key": "gender", "options": ["Male", "Female", "Prefer not to say"] } },
    { "type": "Checkbox", "props": { "label": "Topics you are interested in", "key": "interests", "options": ["Technology", "Lifestyle", "Entertainment"] } },
    { "type": "Rate", "props": { "label": "Overall rating", "key": "score" } },
    { "type": "Input", "props": { "label": "Other suggestions", "key": "comment" } },
    { "type": "Button", "props": { "label": "Submit feedback", "action": "submit", "variant": "primary" } }
  ]
}
```

## Ex 3: When you need to display code in an interactive interface (do not display code inside A2UI; just use a markdown code block!)
User: Simulate a linux terminal.
Assistant: Here is the code:
```a2ui
{
  "type": "Card",
  "props": {
    "title": "Linux terminal emulator"
  },
  "children": [
    {
      "type": "Input",
      "props": {
        "label": "Enter command",
        "key": "command",
        "placeholder": "e.g.: ls, pwd, whoami, date, echo 'Hello', etc."
      }
    },
    {
      "type": "Group",
      "children": [
        {
          "type": "Button",
          "props": {
            "label": "Run command",
            "action": "submit",
            "variant": "primary"
          }
        },
        {
          "type": "Button",
          "props": {
            "label": "Clear output",
            "action": "search"
          }
        }
      ]
    },
    {
      "type": "Divider"
    },
    {
      "type": "Text",
      "props": {
        "content": "**Terminal output area:**"
      }
    },
    {
      "type": "Code",
      "props": {
        "content": "user@linux-terminal:~$ waiting for command...",
        "language": "bash"
      }
    }
  ]
}
```

## Ex 4: Language-learning scenario (using TTSBlock)
User: Teach me how to say "hello" in Japanese.
Assistant: Sure, listen to the standard pronunciation:
```a2ui
{
  "type": "Card",
  "props": { "title": "Japanese lesson" },
  "children": [
    { "type": "Text", "props": { "content": "\"Hello\" in Japanese is: **こんにちは** (Konnichiwa)" } },
    {
      "type": "TTSBlock",
      "props": {
        "label": "Click to listen",
        "content": "こんにちは",
        "voice": "ja-JP-NanamiNeural"
      }
    },
    { "type": "Alert", "props": { "title": "Note", "content": "Usually used when meeting during the daytime.", "variant": "info" } }
  ]
}
```

## Ex 5: Form with a reset feature
User: I want to write a blog post with a title and content, but I might want to rewrite it.
Assistant:
```a2ui
{
  "type": "Card",
  "props": { "title": "Write a new article" },
  "children": [
    { "type": "Input", "props": { "label": "Article title", "key": "title" } },
    { "type": "Input", "props": { "label": "Body content", "key": "content" } },
    {
      "type": "Group",
      "children": [
        { "type": "Button", "props": { "label": "Clear and rewrite", "action": "clear", "variant": "danger" } },
        { "type": "Button", "props": { "label": "Publish now", "action": "submit", "variant": "primary" } }
      ]
    }
  ]
}
```

## Misuse example 1 (please do not reply this way):
User: Draw a table about artificial intelligence.
Assistant: Here is the table:
```a2ui
    {
      "type": "Table",
      "props": {
        "headers": ["Field", "Example applications"],
        "rows": [
          ["Healthcare", "Disease diagnosis, drug discovery, medical imaging analysis"],
          ["Financial services", "Risk assessment, fraud detection, robo-advisory"],
          ["Autonomous driving", "Environmental perception, path planning, decision control"],
          ["Education technology", "Personalized learning, intelligent tutoring, automatic grading"],
          ["Smart manufacturing", "Quality control, predictive maintenance, production optimization"],
          ["Entertainment media", "Content recommendation, game AI, effects generation"]
        ]
      }
    }
```
Clearly, for this request, sending the table directly using markdown syntax is more appropriate than using A2UI!
"""
        content_append(request.messages, 'system', A2UI_messages)

    # ==================== Semi-fixed file injection (system messages, low change frequency) ====================
    if cwd and Path(cwd).exists() and cli_settings.get("enabled", False):
        # MEMORY.md
        memory_file = Path(cwd) / ".agent" / "MEMORY.md"
        if memory_file.exists() and memory_file.is_file():
            try:
                import aiofiles
                async with aiofiles.open(memory_file, 'r', encoding='utf-8') as mf:
                    mem_content = await mf.read()
                if mem_content.strip():
                    content_append(request.messages, 'system', f"\n\n**MEMORY.md**:\n{mem_content}\n\n")
            except Exception as e:
                print(f"Failed to read MEMORY.md: {e}")

        # AGENTS.md
        try:
            agents_md = await read_agents_md(cwd)
            if agents_md:
                content_append(request.messages, 'system', " **Important notes** (.agent/AGENTS.md):\n\n"+agents_md+"\n\n")
        except Exception as e:
            print(f"[Agent Loader] skipped loading AGENTS.md: {e}")
            pass

        # Project skills summary
        try:
            skills_message = await get_project_skills_summary(cwd, visibilityScope)
            if skills_message:
                content_append(request.messages, 'system', skills_message)
        except Exception as e:
            print(f"[Skill Loader] failed to scan skills: {e}")

    # Group-chat mode (semi-fixed; only changes when members change)
    cur_memory = None
    if settings["memorySettings"]["is_memory"] and settings["memorySettings"]["selectedMemory"]:
        memoryId = settings["memorySettings"]["selectedMemory"]
        for memory in settings["memories"]:
            if memory["id"] == memoryId:
                cur_memory = memory
                break
    selectedMemoryName = cur_memory["name"] if cur_memory else settings["memorySettings"]["selectedMemory"]

    def resolve_agent_name(raw_model):
        if raw_model.startswith("memory/"):
            parts = raw_model.split('/', 2)
            if len(parts) >= 2:
                memory_id = parts[1]
                for memory in settings["memories"]:
                    if memory["id"] == memory_id:
                        return memory["name"]
                return raw_model
        return raw_model

    if settings["isGroupMode"] and not request.is_app_bot and not request.is_sub_agent:
        selectedGroupAgents = settings['selectedGroupAgents']
        if selectedGroupAgents:
            userName = "user"
            if settings["memorySettings"]["userName"]:
                userName = settings["memorySettings"]["userName"]
            selectedGroupAgents.append(userName)
            agent_names = [resolve_agent_name(agent) for agent in selectedGroupAgents]
            group_message = f"\n\nYou are currently in group-chat mode. The characters in the group chat are: {agent_names}\n\nYou are playing {selectedMemoryName}"
            content_append(request.messages, 'system', group_message)

    # ==================== Dynamic-content collection (injected last, change frequency low to high) ====================
    # 1. Local-environment info (in a local environment it may contain dynamic content; placed in the dynamic region)
    if cwd and Path(cwd).exists() and cli_settings.get("enabled", False) and engine == "local":
        system_context_local = get_system_context()
        if system_context_local:
            content_append(request.messages, 'system', system_context_local)

    # 2. To-do items
    if cwd and Path(cwd).exists() and cli_settings.get("enabled", False) and engine in ["ds", "local"]:
        try:
            todos = await read_todos_local(cwd)
            if isinstance(todos, list) and len(todos) > 0:
                priority_icons = {"high": "🔴", "medium": "🟡", "low": "🟢"}
                status_icons = {"pending": "⏳", "in_progress": "🔄", "done": "✅", "cancelled": "❌"}
                priority_order = {"high": 0, "medium": 1, "low": 2}
                todos_sorted = sorted(todos, key=lambda x: (priority_order.get(x.get('priority', 'medium'), 1), x.get('created_at', '')))
                todo_lines = ["\n\n当你完成一个事项后，请记得使用todo_write_tool更新项目待办事项，所有事项结束后，可以删除本事项文件\n\n📋 **当前项目待办事项**（.agent/ai_todos.json）：\n"]
                pending_count = 0
                for todo in todos_sorted:
                    status = todo.get('status', 'pending')
                    if status != 'done':
                        pending_count += 1
                        icon = status_icons.get(status, "⏳")
                        priority = priority_icons.get(todo.get('priority', 'medium'), "🟡")
                        content_text = todo.get('content', '无内容')[:50]
                        if len(todo.get('content', '')) > 50:
                            content_text += "..."
                        todo_lines.append(f"{icon} {priority} [{todo.get('id', 'unknown')}] {content_text}")
                if pending_count == 0:
                    todo_lines.append("✨ 当前没有待办事项，所有任务已完成！")
                else:
                    todo_lines.append(f"\n*共有 {pending_count} 个未完成任务*")
                todo_message = "\n".join(todo_lines)
                content_append(request.messages, 'system', todo_message)
        except Exception as e:
            print(f"[Todo Loader] skipped loading todos: {e}")

    # 3. Subtask progress (cowork mode)
    if permissionMode == "cowork" and not request.is_sub_agent:
        if cwd and Path(cwd).exists() and cli_settings.get("enabled", False) and engine in ["ds", "local"]:
            sub_task_context = await query_task_progress(cwd)
            if sub_task_context:
                content_append(request.messages, 'system', sub_task_context)

    # 5. Affection values (may change each turn)
    love_settings = settings.get('loveSettings', {})
    if love_settings.get('enabled', False) and not request.is_app_bot and not request.is_sub_agent:
        default_user = settings.get("memorySettings", {}).get("userName", "").strip() or "User"
        from py.affection_system import load_affection_data 
        affection_data = await load_affection_data()
        dimensions = love_settings.get("dimensions", ["love", "Familiarity"])
        custom_prompt = love_settings.get("prompt", "根据当前对话的内容、情感色彩以及你的角色设定，合理地评估或微调这些数值（每次增减幅度建议在-5到+5之间）。")
        user_prompt_text = ""
        if request.messages and request.messages[-1]['role'] == 'user':
            user_prompt_text = str(request.messages[-1].get('content', ''))
        relevant_users = set()
        for known_name in affection_data.keys():
            if known_name and known_name in user_prompt_text:
                relevant_users.add(known_name)
        if default_user in affection_data:
            relevant_users.add(default_user)
        status_block = ""
        if relevant_users:
            status_block = "目前的已知羁绊数据参考：\n"
            for ru in relevant_users:
                user_stats = affection_data.get(ru, {})
                stats_str = ", ".join([f"{dim}: {user_stats.get(dim, 0)}" for dim in dimensions])
                status_block += f"- {ru}: {stats_str}\n"
        tag_example = "<user=发言者的真实名字"
        for dim in dimensions:
            tag_example += f" {dim}=1"
        tag_example += ">"
        affection_message = f"""

# 角色羁绊与数值系统
{status_block}
【更新规则】
{custom_prompt}

【动态识别发言者】
请准确识别当前最新消息的**实际发言者**：
- 如果消息是类似“某某发送弹幕：”、“某某说：”的格式，发言者就是该名字（例如“小包”）。
- 如果没有带有这种特定的名字前缀，则默认当前的发言者是“{default_user}”。

你必须在每次回复的**绝对最末尾**（所有正文、代码、表情都输出完毕之后），输出一个隐藏的数据标签来记录**该发言者**的最新数值（如果是第一次见面的新用户，请直接给一个合理的初始值）。
格式必须严格遵守以下示例（将“发言者的真实名字”替换为你识别出的真实名字，且必须包含所有维度）：
{tag_example}

注意：系统会自动隐藏<>包裹的文本，请直接输出标签，绝对不要在标签前后加任何解释、加粗或Markdown代码块包裹！
"""
        content_append(request.messages, 'system', affection_message)

    # ==================== Very short dynamic content appended to the user message ====================
    # Shortcut-command response (triggered only on the current turn)
    if cwd and Path(cwd).exists() and cli_settings.get("enabled", False) and cli_settings.get("shortcut", False):
        user_text = ""
        if request.messages and request.messages[-1]['role'] == 'user':
            user_msg_content = request.messages[-1].get('content', '')
            if isinstance(user_msg_content, str):
                user_text = user_msg_content
            elif isinstance(user_msg_content, list):
                user_text = "".join([item.get('text', '') for item in user_msg_content if item.get('type') == 'text'])
        user_text_trimmed = user_text.strip()
        if user_text_trimmed:
            import datetime
            if user_text_trimmed.startswith('#'):
                mem_content_to_save = user_text_trimmed[1:].strip()
                if mem_content_to_save:
                    try:
                        agent_dir = Path(cwd) / ".agent"
                        agent_dir.mkdir(parents=True, exist_ok=True)
                        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                        append_text = f"\n- [{timestamp}] {mem_content_to_save}"
                        import aiofiles
                        async with aiofiles.open(Path(cwd) / ".agent" / "MEMORY.md", 'a', encoding='utf-8') as mf:
                            await mf.write(append_text)
                        # Append to the end of the user message
                        if request.messages[-1]['role'] == 'user':
                            request.messages[-1]['content'] += f"\n\n[系统提示：用户刚刚使用'#'指令保存了以下记忆：“{mem_content_to_save}”，请简短确认你已记住。]"
                    except Exception as e:
                        print(f"Failed to save MEMORY.md: {e}")
            elif user_text_trimmed.startswith('/'):
                parts = user_text_trimmed[1:].split()
                if parts:
                    skill_name = parts[0]
                    skill_dir = Path(cwd) / ".agent" / "skills" / skill_name
                    if skill_dir.exists() and skill_dir.is_dir():
                        doc_file_path = None
                        for name in ["SKILL.md", "skill.md", "SKILLS.md", "skills.md"]:
                            if (skill_dir / name).exists():
                                doc_file_path = skill_dir / name
                                break
                        if doc_file_path:
                            try:
                                import aiofiles
                                async with aiofiles.open(doc_file_path, 'r', encoding='utf-8') as f:
                                    skill_content = await f.read()
                                # Append to the end of the user message
                                if request.messages[-1]['role'] == 'user':
                                    request.messages[-1]['content'] += f"\n\n[系统提示：用户激活了技能“{skill_name}”，技能说明：\n{skill_content}\n请严格按技能说明处理用户请求。]"
                            except Exception as e:
                                print(f"failed to read skill docs: {e}")

    # Timestamp (changes every turn)
    if settings['tools']['time']['enabled'] and settings['tools']['time']['triggerMode'] == 'beforeThinking':
        time_message = f"\n\nTime the last message was sent: {local_timezone}  {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime())}"
        # Append to the end of the user message
        if request.messages and request.messages[-1]['role'] == 'user':
            request.messages[-1]['content'] += time_message

    print(f"System prompt:{request.messages[0]['content']}")
    return request

def get_drs_stage(DRS_STAGE):
    if DRS_STAGE == 1:
        drs_msg = "当前阶段为明确用户需求阶段，你需要分析用户的需求，并给出明确的需求描述。如果用户的需求描述不明确，你可以暂时不完成任务，而是分析需要让用户进一步明确哪些需求。"
    elif DRS_STAGE == 2:
        drs_msg = "当前阶段为工具调用阶段，利用你的知识库、互联网搜索、数据库查询、各类MCP等你所有的工具（如果有，这些工具不一定会提供），执行计划中未完成的步骤。每次完成计划中的一个步骤。在工具调用阶段中，你不要完成最终任务，而是尽可能的调用相关的工具，为最后的回答阶段做准备。"
    elif DRS_STAGE == 3:
        drs_msg = "当前阶段为生成结果阶段，根据当前收集到的所有信息，完成任务，给出任务执行结果。如果用户要求你生成一个超过2000字的回答，你可以尝试将该任务拆分成多个部分，每次只完成其中一个部分。"
    else:
        drs_msg = "当前阶段为生成结果阶段，根据当前收集到的所有信息，完成任务，给出任务执行结果。如果用户要求你生成一个超过2000字的回答，你可以尝试将该任务拆分成多个部分，每次只完成其中一个部分。"
    return drs_msg  

def get_drs_stage_name(DRS_STAGE):
    if DRS_STAGE == 1:
        drs_stage_name = "明确用户需求阶段"
    elif DRS_STAGE == 2:
        drs_stage_name = "工具调用阶段"
    elif DRS_STAGE == 3:
        drs_stage_name = "生成结果阶段"
    else:
        drs_stage_name = "生成结果阶段"
    return drs_stage_name

def get_drs_stage_system_message(DRS_STAGE,user_prompt,full_content):
    drs_stage_name = get_drs_stage_name(DRS_STAGE)
    if DRS_STAGE == 1:
        search_prompt = f"""
# 当前状态：

## 初始任务：
{user_prompt}

## 当前结果：
{full_content}

## 当前阶段：
{drs_stage_name}

# 深度研究一共有三个阶段：1: 明确用户需求阶段 2: 工具调用阶段 3: 生成结果阶段

## 当前阶段，请输出json字符串：

### 如果需要用户明确需求，请输出json字符串（如果你已经在上一轮对话中向用户提出过明确需求，请不要重复使用"need_more_info"，这会导致用户无法快速获取结果）：
{{
    "status": "need_more_info",
    "unfinished_task": ""
}}

### 如果不需要进一步明确需求，进入并进入工具调用阶段，请输出json字符串：
{{
    "status": "need_work",
    "unfinished_task": ""
}}
"""
    elif DRS_STAGE == 2:
        search_prompt = f"""
# 当前状态：

## 初始任务：
{user_prompt}

## 当前结果：
{full_content}

## 当前阶段：
{drs_stage_name}

# 深度研究一共有三个阶段：1: 明确用户需求阶段 2: 工具调用阶段 3: 生成结果阶段

## 注意！工具调用阶段，是为最后的回答阶段做准备。不需要生成最终的回答，如果已经没有未完成的需要调用工具的步骤，请进入生成结果阶段。

## 当前阶段，请输出json字符串：

### 如果还有计划中的需要调用工具的步骤没有完成，请输出json字符串：
{{
    "status": "need_more_work",
    "unfinished_task": "这里填入未完成的步骤"
}}

### 如果所有计划的需要调用工具的步骤都已完成，进入生成结果阶段，请输出json字符串：
{{
    "status": "answer",
    "unfinished_task": ""
}}
"""    
    else:
        search_prompt = f"""
# 当前状态：

## 初始任务：
{user_prompt}

## 当前结果：
{full_content}

## 当前阶段：
{drs_stage_name}

# 深度研究一共有三个阶段：1: 明确用户需求阶段 2: 工具调用阶段 3: 生成结果阶段

## 当前阶段，请输出json字符串：

如果初始任务已完成，请输出json字符串：
{{
    "status": "done",
    "unfinished_task": ""
}}

如果初始任务未完成，请输出json字符串：
{{
    "status": "not_done",
    "unfinished_task": "这里填入未完成的任务"
}}
"""    
    return search_prompt

# =========================================================================
# Phase 2: forced validity sanitization (sanitizer) - must run whether or not compression happened
# Goal: fully prevent the "Messages with role 'tool' must be a response..." error
# =========================================================================
def get_role(m): return m.get("role") if isinstance(m, dict) else m.role
def get_tcs(m): 
    if get_role(m) != "assistant": return None
    return m.get("tool_calls") if isinstance(m, dict) else getattr(m, "tool_calls", None)

# =========================================================================
# Phase 3: thinking-mode field filling (thinking-mode sanitizer)
# Goal: prevent the "reasoning_content must be passed back" error
# Strategy: add reasoning_content: "" to all assistant messages
# =========================================================================

def ensure_thinking_fields(messages):
    """为所有 assistant 消息确保 reasoning_content 字段存在（缺失则补空字符串），但不覆盖已有值。"""
    if not messages:
        return messages
    for msg in messages:
        role = get_role(msg)
        if role == "assistant":
            if isinstance(msg, dict):
                if "reasoning_content" not in msg:
                    msg["reasoning_content"] = ""
            else:
                if not hasattr(msg, "reasoning_content"):
                    setattr(msg, "reasoning_content", "")
    return messages

def sanitize_tool_calls(messages: list) -> list:
    """
    最终兜底：确保任意一条带有 tool_calls 的 assistant 消息
    后面都紧跟着数量匹配的 tool 消息，且 tool_call_id 一一对应。
    
    - 如果 content 为空且 tool_calls 缺少对应的 tool 响应 → 直接删除整条 assistant
    - 如果 content 不为空但 tool_calls 缺少对应的 tool 响应 → 抹掉 tool_calls，保留文本
    - 如果 tool 消息找不到对应的 assistant tool_calls → 删除孤立的 tool 消息
    """
    if not messages:
        return messages

    # Convert to an easy-to-handle format
    msgs = []
    for m in messages:
        if isinstance(m, dict):
            msgs.append(m.copy())
        else:
            # Simply convert to a dict (your messages are most likely already dicts)
            msgs.append(m)

    i = 0
    while i < len(msgs):
        msg = msgs[i]
        role = msg.get("role")
        
        if role == "assistant" and msg.get("tool_calls"):
            # Collect all tool_call_ids this assistant should have
            expected_ids = {tc["id"] for tc in msg["tool_calls"]}
            
            # Find the consecutive tool messages immediately after it
            j = i + 1
            tool_msgs = []
            while j < len(msgs) and msgs[j].get("role") == "tool":
                tool_msgs.append(msgs[j])
                j += 1
            
            # Check for any missing ones
            found_ids = {tm["tool_call_id"] for tm in tool_msgs if "tool_call_id" in tm}
            missing_ids = expected_ids - found_ids
            
            if missing_ids:
                # Determine whether the assistant has actual text content
                content = msg.get("content")
                has_text = bool(content and str(content).strip())
                
                if has_text:
                    # Keep the text, erase the tool_calls
                    msgs[i]["tool_calls"] = None
                    # Also delete the orphaned tool messages found after it (they no longer have a corresponding assistant tool_calls)
                    del msgs[i+1:j]  # Delete all tool messages from i+1 to j-1
                    print(f"[Sanitizer] Erased assistant tool_calls and removed related tool messages, kept text. Missing id: {missing_ids}")
                else:
                    # No substantive content, so delete this assistant and its invalid tool messages
                    del msgs[i]        # Delete the assistant itself
                    # Note j shifts back by one after deleting i, so recompute
                    # Delete the tool messages that originally followed it
                    # i now points to the original i+1 (since i was deleted), so delete from i to j-1
                    del msgs[i:j-1]    # Since i now points to the original i+1, adjust the number of tool messages to delete
                    print(f"[Sanitizer] Deleted empty tool_calls assistant and subsequent orphan tool messages. Missing id: {missing_ids}")
                    # Since i was deleted, don't advance the pointer; keep checking from the current position
                    continue
            else:
                # All tool_call_ids were found; normal
                # Skip these tool messages and keep checking the rest
                i = j  # Jump to after the tool messages
                continue
        
        elif role == "tool":
            # Check whether this tool message has a matching assistant tool_calls before it
            # Look backward for the nearest assistant
            k = i - 1
            found = False
            while k >= 0:
                if msgs[k].get("role") == "assistant" and msgs[k].get("tool_calls"):
                    tids = {tc["id"] for tc in msgs[k]["tool_calls"]}
                    if msg.get("tool_call_id") in tids:
                        found = True
                    break
                k -= 1
            if not found:
                # Orphaned tool message; delete it
                del msgs[i]
                print(f"[Sanitizer] Deleted orphan tool message: {msg.get('tool_call_id')}")
                continue
        
        i += 1

    return msgs

async def generate_stream_response(client, reasoner_client, request: ChatRequest, settings: dict, 
                                   fastapi_base_url, enable_thinking, enable_deep_research, 
                                   enable_web_search, async_tools_id):
    try:
        from mem0 import Memory
        global mcp_client_list, HA_client, ChromeMCP_client, sql_client
        
        DRS_STAGE = 1
        if len(request.messages) > 2:
            DRS_STAGE = 2
            
        vision_cfg = settings.get('vision', {})
        vision_control_enabled = settings.get('visionControlSettings', {}).get('enabled', False)
        user_prompt = request.messages[-1].get('content') or ""
        
        # 1. Take an initial screenshot if computer control is on or the desktop-vision wake-word condition is met
        should_capture = False
        if vision_control_enabled and settings.get('visionControlSettings', {}).get('desktopVision', False):
            should_capture = True
        elif vision_cfg.get('desktopVision'):
            # Check the wake words
            if vision_cfg.get('enableWakeWord'):
                wake_words = [w.strip() for w in vision_cfg.get('wakeWord', "").split('\n') if w.strip()]
                if any(word in user_prompt for word in wake_words):
                    should_capture = True
            else:
                # If wake words are off, capture every time by default (adjust as needed)
                should_capture = True
        
        if should_capture:
            try:
                import pyautogui
                from py.computer_use_tool import set_screen_region
                # Import the cross-platform UI-tree capture tool we just wrote
                from py.ui_tree_helper import get_desktop_ui_tree
                
                v_settings = settings.get('visionControlSettings', {})
                is_full_screen = v_settings.get('isFullScreen', True)
                screen_size = v_settings.get('ScreenSize', [0, 0, 1280, 720])
                is_grid_enabled = vision_control_enabled and v_settings.get('isEnableGrid', False)

                print(f"Taking desktop screenshot (fullscreen: {is_full_screen}, grid: {is_grid_enabled})...")
                
                # Initialize the screenshot offset
                offset_x, offset_y = 0, 0
                
                # 1. Decide the capture region based on the full-screen config, and sync it to the mouse tool
                if not is_full_screen and len(screen_size) == 4:
                    x, y, w, h = map(int, screen_size)
                    offset_x, offset_y = x, y  # Set the offset to align UI-tree coordinates
                    
                    # Capture the specified region
                    screenshot = await asyncio.to_thread(pyautogui.screenshot, region=(x, y, w, h))
                    logical_width, logical_height = w, h
                    set_screen_region((x, y, w, h))
                else:
                    # Full-screen screenshot
                    logical_width, logical_height = pyautogui.size()
                    screenshot = await asyncio.to_thread(pyautogui.screenshot)
                    set_screen_region(None)
                
                # 2. Scale uniformly to the logical coordinate system (fixes Windows DPI scaling offset)
                if screenshot.width != logical_width or screenshot.height != logical_height:
                    screenshot = await asyncio.to_thread(
                        screenshot.resize, (logical_width, logical_height), Image.Resampling.LANCZOS
                    )
                
                # 3. Scale to the transfer size (around 1280x720)
                target_w, target_h = scale_to_fit(logical_width, logical_height, 1280, 720)
                if screenshot.width > target_w or screenshot.height > target_h:
                    print(f"High-res screen detected; scaling from {screenshot.size} to {(target_w, target_h)}")
                    screenshot = await asyncio.to_thread(
                        screenshot.resize, (target_w, target_h), Image.Resampling.LANCZOS
                    )

                # 4. Decide whether to draw the grid based on settings, and generate the grid hint
                if is_grid_enabled:
                    display_image = await asyncio.to_thread(draw_grid_on_image, screenshot.copy(), grid_spacing=10)
                    grid_hint = "\n\n【system info】Current screenshot with coordinate grid (0-1000) is injected. Use coordinates for precise clicking."
                else:
                    display_image = screenshot
                    grid_hint = "\n\n【system info】Current desktop screenshot is injected."

                ui_tree_hint = ""
                if vision_control_enabled:
                    print("Asynchronously extracting cross-platform accessibility UI tree and aligning 0-1000 coordinates...")
                    # Pass in the logical viewport size (logical_width, logical_height) and the offset (offset_x, offset_y)
                    ui_tree_json = await get_desktop_ui_tree(
                        logical_width=logical_width,
                        logical_height=logical_height,
                        offset_x=offset_x,
                        offset_y=offset_y
                    )
                    ui_tree_hint = f"\n\n【system info】Current Interactive UI Elements (Index of clickable items on screen with 0-1000 grid):\n```json\n{ui_tree_json}\n```\nYou can click any element using the provided [center_x, center_y] coordinates (which correspond perfectly to your 0-1000 grid input)."

                # 5. Save the image
                file_prefix = "desktop_grid" if is_grid_enabled else "desktop_plain"
                desktop_img_name = f"{file_prefix}_{uuid.uuid4().hex}.png"
                desktop_img_path = os.path.join(UPLOAD_FILES_DIR, desktop_img_name)
                
                await asyncio.to_thread(display_image.save, desktop_img_path, optimize=True)
                desktop_url = f"{fastapi_base_url}uploaded_files/{desktop_img_name}"
                
                # ==========================================
                # 6. Append to the end of the current message (fully compatible with text and multimodal-list messages)
                # ==========================================
                current_user_msg = request.messages[-1]
                full_hint = grid_hint + ui_tree_hint  # Combine the image hint and the UI tree

                if isinstance(current_user_msg['content'], str):
                    original_text = current_user_msg['content']
                    current_user_msg['content'] = [
                        {"type": "text", "text": original_text + full_hint},
                        {"type": "image_url", "image_url": {"url": desktop_url}}
                    ]
                elif isinstance(current_user_msg['content'], list):
                    # If it's already a multimodal list, find the text node and append the UI tree to the end
                    text_updated = False
                    for item in current_user_msg['content']:
                        if item.get('type') == 'text':
                            item['text'] = item['text'] + full_hint
                            text_updated = True
                            break
                    if not text_updated:
                        # If there's no text node, manually append one
                        current_user_msg['content'].append({"type": "text", "text": full_hint})
                        
                    # Finally append the screenshot
                    current_user_msg['content'].append(
                        {"type": "image_url", "image_url": {"url": desktop_url}}
                    )
                
                # 7. Clean up old screenshots (if onlyNewScreen is enabled)
                if settings.get('visionControlSettings', {}).get('onlyNewScreen', False):
                    for msg in request.messages[:-1]:
                        if isinstance(msg.get('content'), list):
                            new_content = [item for item in msg['content'] if item.get('type') != 'image_url']
                            if len(new_content) == 1 and new_content[0].get('type') == 'text':
                                msg['content'] = new_content[0]['text']
                            else:
                                msg['content'] = new_content
                    print("Cleared old screenshots from history context.")

                print(f"Desktop screenshot and slimmed UI tree merged and injected: {desktop_url}")

            except Exception as e:
                print(f"Backend desktop screenshot or UI-tree extraction failed: {e}")

        # =========================================================================
        # Phase 1: context compression (triggered only at the threshold; decides which messages to keep)
        # =========================================================================
        max_rounds = settings.get("max_rounds", 0)
        chat_messages = request.messages # chat_messages here includes the system messages
        
        if max_rounds > 0:

            # Sliding window: keep all system messages; for dialogue, keep only the most recent max_rounds rounds
            sys_msgs = [m for m in chat_messages if get_role(m) == "system"]
            dialog_msgs = [m for m in chat_messages if get_role(m) != "system"]

            window = max_rounds * 2  # 1 round = user + assistant
            if len(dialog_msgs) > window:
                recent = dialog_msgs[-window:]
                # Trim leading non-user messages so the window starts cleanly on a user turn
                first_user = next((i for i, m in enumerate(recent) if get_role(m) == "user"), 0)
                recent = recent[first_user:]
                chat_messages = sys_msgs + recent
                print(f"[Context] Sliding window -> {len(chat_messages)} msgs.")

        # ===== [Deprecated] Previous method: rule-based selective pruning =====
        # No AI judgment and no LLM call: it kept the first message, ALL user messages,
        # each turn's final assistant reply, and the most recent active window.
        # Kept here for reference. To revert, comment out the sliding-window block above
        # and uncomment this block.
        # if max_rounds > 0:
        #     sys_msgs = [m for m in chat_messages if get_role(m) == "system"]
        #     dialog_msgs = [m for m in chat_messages if get_role(m) != "system"]
        #     if len(dialog_msgs) > (max_rounds * 2 + 1):
        #         keep_indices = set()
        #         # 1. Always keep the first message (anchor user prompt)
        #         if len(dialog_msgs) > 0: keep_indices.add(0)
        #         # 2. Keep all user messages (user-first strategy)
        #         for i, m in enumerate(dialog_msgs):
        #             if get_role(m) == "user": keep_indices.add(i)
        #         # 3. Keep the last assistant message of each turn (final answer)
        #         for i in range(len(dialog_msgs)):
        #             if get_role(dialog_msgs[i]) == "assistant":
        #                 is_last = True
        #                 for j in range(i + 1, len(dialog_msgs)):
        #                     if get_role(dialog_msgs[j]) == "assistant":
        #                         is_last = False; break
        #                     if get_role(dialog_msgs[j]) == "user": break
        #                 if is_last: keep_indices.add(i)
        #         # 4. Keep the most recent active window (avoid cutting the current tool chain)
        #         tail_start = max(0, len(dialog_msgs) - (max_rounds * 2))
        #         for i in range(tail_start, len(dialog_msgs)):
        #             keep_indices.add(i)
        #         compressed_dialog = [dialog_msgs[i] for i in sorted(list(keep_indices))]
        #         chat_messages = sys_msgs + compressed_dialog
        #         print(f"[Context] Compressed to {len(chat_messages)} msgs.")

        final_messages = []
        pending_tool_call_ids = set()

        for msg in chat_messages:
            role = get_role(msg)
            
            if role == "tool":
                t_id = msg.get("tool_call_id") if isinstance(msg, dict) else getattr(msg, "tool_call_id", None)
                # Core check: if this tool message isn't in our pending-response ID list, discard it
                if t_id and t_id in pending_tool_call_ids:
                    final_messages.append(msg)
                    pending_tool_call_ids.remove(t_id) # Matched successfully; remove it
                else:
                    print(f"[Sanitizer] Discarding orphan tool message: {t_id}")
                    continue
            
            elif role == "assistant":
                tcs = get_tcs(msg)
                if tcs:
                    # This is a message that initiates a tool call
                    # Store it for now and record the IDs it expects
                    current_tcs_ids = {tc.get("id") if isinstance(tc, dict) else tc.id for tc in tcs}
                    final_messages.append(msg)
                    for tid in current_tcs_ids: pending_tool_call_ids.add(tid)
                else:
                    # Ordinary assistant reply
                    final_messages.append(msg)
            
            else:
                # user or system messages pass through directly
                final_messages.append(msg)

        # Final reverse check: if the last message is an assistant with tool_calls but no tool messages follow
        # We need to remove these tool_calls markers, or remove the message entirely (depending on requirements)
        # Here we keep the message text but clear tool_calls to prevent an API error
        while final_messages:
            last_msg = final_messages[-1]
            tcs = get_tcs(last_msg)
            # If the last assistant message made a call but we have no following messages to fill it
            if tcs and any( ( (tc.get("id") if isinstance(tc, dict) else tc.id) in pending_tool_call_ids ) for tc in tcs ):
                # If the message has text content, erase tool_calls and keep the text
                # If there's no text, just pop the whole message
                content = last_msg.get("content") if isinstance(last_msg, dict) else getattr(last_msg, "content", "")
                if content:
                    if isinstance(last_msg, dict):
                        last_msg["tool_calls"] = None
                    else:
                        setattr(last_msg, "tool_calls", None)
                    print("[Sanitizer] Erasing unclosed trailing tool_calls")
                    break # Done processing
                else:
                    final_messages.pop()
                    print("[Sanitizer] Popping trailing empty orphan tool_call initiating message")
            else:
                break

        request.messages = final_messages
        request.messages = ensure_thinking_fields(request.messages)
        # =========================================================================
        images = await images_in_messages(request.messages,fastapi_base_url)
        request.messages = await message_without_images(request.messages)
        from py.load_files import get_files_content,file_tool,image_tool
        from py.web_search import (
            DDGsearch, 
            searxng, 
            Tavily_search,
            Bing_search,
            Google_search,
            Brave_search,
            Exa_search,
            Serper_search,
            bochaai_search,
            duckduckgo_tool, 
            searxng_tool, 
            tavily_tool, 
            bing_tool,
            google_tool,
            brave_tool,
            exa_tool,
            serper_tool,
            bochaai_tool,
            jina_crawler_tool, 
            simple_fetch_tool,
            Crawl4Ai_tool,
            firecrawl_tool,
            markdown_new_tool,
        )
        from py.know_base import kb_tool,query_knowledge_base,rerank_knowledge_base
        from py.agent_tool import get_agent_tool
        from py.a2a_tool import get_a2a_tool
        from py.llm_tool import get_llm_tool
        from py.pollinations import pollinations_image_tool,openai_image_tool,openai_chat_image_tool
        from py.code_interpreter import e2b_code_tool,local_run_code_tool
        from py.utility_tools import (
            time_tool, 
            weather_tool,
            location_tool,
            timer_weather_tool,
            wikipedia_summary_tool,
            wikipedia_section_tool,
            arxiv_tool 
        ) 
        from py.autoBehavior import auto_behavior_tool
        from py.cli_tool import get_tools_for_mode,get_local_tools_for_mode
        from py.cdp_tool import all_cdp_tools
        from py.random_topic import random_topics_tools
        from py.computer_use_tool import computer_use_tools,mouse_use_tools,keyboard_use_tools,desktopVision_use_tools

        from py.task_tools import (
            create_subtask_tool,
            query_tasks_tool,
            cancel_subtask_tool,
            finish_task_tool,
        )

        from py.mode_change import mode_change_tool
        from py.acpx_tools import acp_agent_tool

        m0 = None
        memoryId = None
        if settings["memorySettings"]["is_memory"] and settings["memorySettings"]["selectedMemory"] and settings["memorySettings"]["selectedMemory"] != ""  and not request.is_sub_agent:
            memoryId = settings["memorySettings"]["selectedMemory"]
            cur_memory = None
            for memory in settings["memories"]:
                if memory["id"] == memoryId:
                    cur_memory = memory
                    break
            if cur_memory and cur_memory["providerId"]:
                print("Long-term memory enabled")
                config={
                    "embedder": {
                        "provider": 'openai',
                        "config": {
                            "model": cur_memory['model'],
                            "api_key": cur_memory['api_key'],
                            "openai_base_url":cur_memory["base_url"],
                            "embedding_dims":cur_memory.get("embedding_dims", 1024)
                        },
                    },
                    "llm": {
                        "provider": 'openai',
                        "config": {
                            "model": settings['model'],
                            "api_key": settings['api_key'],
                            "openai_base_url":settings["base_url"]
                        }
                    },
                    "vector_store": {
                        "provider": "faiss",
                        "config": {
                            "collection_name": "agent-party",
                            "path": os.path.join(MEMORY_CACHE_DIR,memoryId),
                            "distance_strategy": "euclidean",
                            "embedding_model_dims": cur_memory.get("embedding_dims", 1024)
                        }
                    }
                }
                m0 = Memory.from_config(config)
                print("Long-term memory config loaded")
        open_tag = "<think>"
        close_tag = "</think>"

        tools = request.tools or []
        tool_names = set() 
        if mcp_client_list:
            for server_name, mcp_client in mcp_client_list.items():
                if server_name in settings['mcpServers']:
                    if 'disabled' not in settings['mcpServers'][server_name]:
                        settings['mcpServers'][server_name]['disabled'] = False
                    if settings['mcpServers'][server_name]['disabled'] == False and settings['mcpServers'][server_name]['processingStatus'] == 'ready':
                        disable_tools = []
                        for tool in settings['mcpServers'][server_name].get("tools", []): 
                            if tool.get("enabled", True) == False:
                                disable_tools.append(tool["name"])
                        function = await mcp_client.get_openai_functions(disable_tools=disable_tools)
                        if function:
                            tools.extend(function)
        # Node-extension tools
        for ext_id, tools_list in node_ext_mcp_tools.items():
            for tool in tools_list:
                tool_name = tool.get('name')
                if tool_name and tool_name not in tool_names:
                    tool_names.add(tool_name)
                    tools.append({
                        "type": "function",
                        "function": {
                            "name": tool_name,
                            "description": tool.get('description', f'A tool from extension {ext_id}'),
                            "parameters": tool.get('parameters', {
                                "type": "object",
                                "properties": {},
                                "required": []
                            })
                        }
                    })
                else:
                    print(f"[WARNING] Skipping duplicate tool: {tool_name}")

        get_llm_tool_fuction = await get_llm_tool(settings)
        if get_llm_tool_fuction:
            tools.append(get_llm_tool_fuction)
        get_agent_tool_fuction = await get_agent_tool(settings)
        if get_agent_tool_fuction:
            tools.append(get_agent_tool_fuction)
        get_a2a_tool_fuction = await get_a2a_tool(settings)
        if get_a2a_tool_fuction:
            tools.append(get_a2a_tool_fuction)
        if settings["HASettings"]["enabled"]:
            ha_tool = await HA_client.get_openai_functions(disable_tools=[])
            if ha_tool:
                tools.extend(ha_tool)
        if settings['chromeMCPSettings']['enabled'] and settings['chromeMCPSettings']['type']=='external':
            chromeMCP_tool = await ChromeMCP_client.get_openai_functions(disable_tools=[])
            if chromeMCP_tool:
                tools.extend(chromeMCP_tool)
        if settings['chromeMCPSettings']['enabled'] and settings['chromeMCPSettings']['type']=='internal':
            tools.extend(all_cdp_tools)
        if settings['sqlSettings']['enabled']:
            sql_tool = await sql_client.get_openai_functions(disable_tools=[])
            if sql_tool:
                tools.extend(sql_tool)
        if settings['CLISettings']['enabled']:
            if settings['CLISettings']['engine'] == 'ds':
                tools.extend(get_tools_for_mode('yolo'))
            elif settings['CLISettings']['engine'] == 'local':
                tools.extend(get_local_tools_for_mode('yolo'))
            elif settings['CLISettings']['engine'] == 'acp':
                tools.append(acp_agent_tool)
        if  settings['CLISettings']['mode_change']:
            tools.append(mode_change_tool)
        if settings['visionControlSettings']['enabled']:
            tools.extend(computer_use_tools)
            if settings['visionControlSettings']['mouse']:
                tools.extend(mouse_use_tools)
            if settings['visionControlSettings']['keyboard']:
                tools.extend(keyboard_use_tools)
            if not settings['visionControlSettings']['desktopVision']:
                tools.extend(desktopVision_use_tools)
        if settings['tools']['time']['enabled'] and settings['tools']['time']['triggerMode'] == 'afterThinking':
            tools.append(time_tool)
        if settings["tools"]["weather"]['enabled']:
            tools.append(weather_tool)
            tools.append(location_tool)
            tools.append(timer_weather_tool)
        if settings["tools"]["wikipedia"]['enabled']:
            tools.append(wikipedia_summary_tool)
            tools.append(wikipedia_section_tool)
        if settings["tools"]["randomTopic"]['enabled']:
            tools.extend(random_topics_tools)
        if settings["tools"]["arxiv"]['enabled']:
            tools.append(arxiv_tool)
        if settings['text2imgSettings']['enabled']:
            if settings['text2imgSettings']['engine'] == 'pollinations':
                tools.append(pollinations_image_tool)
            elif settings['text2imgSettings']['engine'] == 'openai':
                tools.append(openai_image_tool)
            elif settings['text2imgSettings']['engine'] == 'openaiChat':
                tools.append(openai_chat_image_tool)
        if settings['tools']['getFile']['enabled']:
            tools.append(file_tool)
            tools.append(image_tool)
        if settings['tools']['autoBehavior']['enabled'] and request.messages[-1]['role'] == 'user':
            tools.append(auto_behavior_tool)
        if settings["codeSettings"]['enabled']:
            if settings["codeSettings"]["engine"] == "e2b":
                tools.append(e2b_code_tool)
            elif settings["codeSettings"]["engine"] == "sandbox":
                tools.append(local_run_code_tool)
        if settings["custom_http"]:
            for custom_http in settings["custom_http"]:
                if custom_http["enabled"]:
                    if custom_http['body'] == "":
                        custom_http['body'] = "{}"
                    custom_http_tool = {
                        "type": "function",
                        "function": {
                            "name": f"custom_http_{custom_http['name']}",
                            "description": f"{custom_http['description']}",
                            "parameters": json.loads(custom_http['body']),
                        },
                    }
                    tools.append(custom_http_tool)
        if settings["workflows"]:
            for workflow in settings["workflows"]:
                if workflow["enabled"]:
                    comfyui_properties = {}
                    comfyui_required = []
                    if workflow["text_input"] is not None:
                        comfyui_properties["text_input"] = {
                            "description": "The first text input: the prompt to enter, used to generate an image or video. Unless otherwise noted, default to English",
                            "type": "string"
                        }
                        comfyui_required.append("text_input")
                    if workflow["text_input_2"] is not None:
                        comfyui_properties["text_input_2"] = {
                            "description": "The second text input: the prompt to enter, used to generate an image or video. Unless otherwise noted, default to English",
                            "type": "string"
                        }
                        comfyui_required.append("text_input_2")
                    if workflow["image_input"] is not None:
                        comfyui_properties["image_input"] = {
                            "description": "The first image input: the image to enter, must be an image URL, either an external link or an internal server URL, e.g.: https://www.example.com/xxx.png  or  http://127.0.0.1:3456/xxx.jpg",
                            "type": "string"
                        }
                        comfyui_required.append("image_input")
                    if workflow["image_input_2"] is not None:
                        comfyui_properties["image_input_2"] = {
                            "description": "The second image input: the image to enter, must be an image URL, either an external link or an internal server URL, e.g.: https://www.example.com/xxx.png  or  http://127.0.0.1:3456/xxx.jpg",
                            "type": "string"
                        }
                        comfyui_required.append("image_input_2")
                    comfyui_parameters = {
                        "type": "object",
                        "properties": comfyui_properties,
                        "required": comfyui_required
                    }
                    comfyui_tool = {
                        "type": "function",
                        "function": {
                            "name": f"comfyui_{workflow['unique_filename']}",
                            "description": f"{workflow['description']}+\nIf entering or modifying an image prompt, use English as much as possible.\nFor returned image results, put the image URL into markdown like ![image]() so the user can see the image. For a video, put the video URL into the src of <video controls> <source src=''></video> so the user can see the video. If there are multiple results, separate the images or videos with newlines so the user can see all of them.",
                            "parameters": comfyui_parameters,
                        },
                    }
                    tools.append(comfyui_tool)
        
        source_prompt = ""
        if request.fileLinks:
            print("fileLinks",request.fileLinks)
            # Asynchronously get file content
            files_content = await get_files_content(request.fileLinks)
            fileLinks_message = f"\n\nRelevant file content: {files_content}"
            
            # Fix the string-concatenation bug
            content_append(request.messages, 'system', fileLinks_message)
            source_prompt += fileLinks_message

        user_prompt = request.messages[-1].get('content') or ""

        # Global memory (always injected, regardless of character/memory toggle)
        global_memory = settings.get("memorySettings", {}).get("globalMemory", "")
        if global_memory and global_memory.strip() and not request.is_sub_agent:
            gm = global_memory.replace("{{user}}", settings["memorySettings"].get("userName", "") or "")
            content_append(request.messages, 'system', "\n\n" + gm + "\n\n")

        if settings["memorySettings"]["is_memory"] and settings["memorySettings"]["selectedMemory"] and settings["memorySettings"]["selectedMemory"] != "" and not request.is_sub_agent:
            # Username hint (fixed)
            if settings["memorySettings"]["userName"]:
                print("Add username: \n\n" + settings["memorySettings"]["userName"] + "\n\nEnd username\n\n")
                content_append(request.messages, 'system', "The default username talking with you is:\n\n" + settings["memorySettings"]["userName"] + "\n\nNote! Unless a user message states it was sent by another user, treat it as sent by the default user\n\n")

            # Fixed persona: character description, personality, dialogue example, custom systemPrompt, generic systemPrompt
            if cur_memory["description"]:
                if settings["memorySettings"]["userName"]:
                    cur_memory["description"] = cur_memory["description"].replace("{{user}}", settings["memorySettings"]["userName"])
                cur_memory["description"] = cur_memory["description"].replace("{{char}}", cur_memory["name"])
                print("Add character setting: \n\n" + cur_memory["description"] + "\n\nEnd character setting\n\n")
                content_append(request.messages, 'system', "Character setting:\n\n" + cur_memory["description"] + "\n\nEnd of character setting\n\n")

            if cur_memory["personality"]:
                if settings["memorySettings"]["userName"]:
                    cur_memory["personality"] = cur_memory["personality"].replace("{{user}}", settings["memorySettings"]["userName"])
                cur_memory["personality"] = cur_memory["personality"].replace("{{char}}", cur_memory["name"])
                print("Add personality setting: \n\n" + cur_memory["personality"] + "\n\nEnd personality setting\n\n")
                content_append(request.messages, 'system', "Personality setting:\n\n" + cur_memory["personality"] + "\n\nEnd of personality setting\n\n")

            if cur_memory['mesExample']:
                if settings["memorySettings"]["userName"]:
                    cur_memory['mesExample'] = cur_memory['mesExample'].replace("{{user}}", settings["memorySettings"]["userName"])
                cur_memory['mesExample'] = cur_memory['mesExample'].replace("{{char}}", cur_memory["name"])
                print("Add dialogue example: \n\n" + cur_memory['mesExample'] + "\n\nEnd dialogue example\n\n")
                content_append(request.messages, 'system', "Dialogue example:\n\n" + cur_memory['mesExample'] + "\n\nEnd of dialogue example\n\n")

            if cur_memory["systemPrompt"]:
                if settings["memorySettings"]["userName"]:
                    cur_memory["systemPrompt"] = cur_memory["systemPrompt"].replace("{{user}}", settings["memorySettings"]["userName"])
                cur_memory["systemPrompt"] = cur_memory["systemPrompt"].replace("{{char}}", cur_memory["name"])
                content_append(request.messages, 'system', "\n\n" + cur_memory["systemPrompt"] + "\n\n")

            if settings["memorySettings"]["genericSystemPrompt"]:
                if settings["memorySettings"]["userName"]:
                    settings["memorySettings"]["genericSystemPrompt"] = settings["memorySettings"]["genericSystemPrompt"].replace("{{user}}", settings["memorySettings"]["userName"])
                settings["memorySettings"]["genericSystemPrompt"] = settings["memorySettings"]["genericSystemPrompt"].replace("{{char}}", cur_memory["name"])
                content_append(request.messages, 'system', "\n\n" + settings["memorySettings"]["genericSystemPrompt"] + "\n\n")

        # ========== Dynamic-context collection (all appended to the end of the user message) ==========
        dynamic_user_context = ""

        # World-book matching (dynamic, triggered by the current turn's input/reply)
        lore_content = ""
        assistant_reply = ""
        for i in range(len(request.messages)-1, -1, -1):
            if request.messages[i]['role'] == 'assistant':
                assistant_reply = request.messages[i]['content']
                break

        if settings["memorySettings"]["is_memory"] and settings["memorySettings"]["selectedMemory"] and not request.is_sub_agent:
            if cur_memory.get("characterBook"):
                for lore in cur_memory["characterBook"]:
                    lore_keys = [key for key in lore.get("keysRaw", "").split("\n") if key != ""]
                    if lore_keys and any(key in user_prompt or key in assistant_reply for key in lore_keys):
                        lore_content += lore['content'] + "\n\n"

        if lore_content:
            if settings["memorySettings"]["userName"]:
                lore_content = lore_content.replace("{{user}}", settings["memorySettings"]["userName"])
            lore_content = lore_content.replace("{{char}}", cur_memory["name"])
            print("Add worldview setting (dynamic, injected into user message): \n\n" + lore_content + "\n\nEnd worldview setting\n\n")
            dynamic_user_context += f"\n\n[世界设定]\n{lore_content}"

        # Memory retrieval (dynamic, based on the current user input)
        if m0 and not request.is_sub_agent:
            memoryLimit = settings["memorySettings"]["memoryLimit"]
            try:
                relevant_memories = await asyncio.to_thread(
                    m0.search,
                    query=user_prompt,
                    user_id=settings["memorySettings"]["selectedMemory"],
                    limit=memoryLimit
                )
                relevant_memories = json.dumps(relevant_memories, ensure_ascii=False)
            except Exception as e:
                print("m0.search error:", e)
                relevant_memories = ""
            if relevant_memories:
                print("Add relevant memory (dynamic, injected into user message): \n\n" + relevant_memories + "\n\nEnd relevant\n\n")
                dynamic_user_context += f"\n\n[相关记忆]\n{relevant_memories}"

        # Append the dynamic content to the end of the last user message
        if dynamic_user_context:
            if request.messages and request.messages[-1]['role'] == 'user':
                request.messages[-1]['content'] += dynamic_user_context
        
        request = await tools_change_messages(request, settings)
        # If the system message is empty or only whitespace, set it to "you are a helpful assistant."
        if request.messages[0]['role'] == 'system' and not request.messages[0]['content'].strip():
            request.messages[0]['content'] = "you are a helpful assistant."
        chat_vendor = 'OpenAI'
        reasoner_vendor = 'OpenAI'
        for modelProvider in settings['modelProviders']: 
            if modelProvider['id'] == settings['selectedProvider']:
                chat_vendor = modelProvider['vendor']
                break
        for modelProvider in settings['modelProviders']: 
            if modelProvider['id'] == settings['reasoner']['selectedProvider']:
                reasoner_vendor = modelProvider['vendor']
                break
        if chat_vendor == 'Dify':
            try:
                if len(request.messages) >= 3:
                    if request.messages[2]['role'] == 'user':
                        if request.messages[1]['role'] == 'assistant':
                            request.messages[2]['content'] = "你上一次的发言：\n" +request.messages[0]['content'] + "\n你上一次的发言结束\n\n用户：" + request.messages[2]['content']
                        if request.messages[0]['role'] == 'system':
                            request.messages[2]['content'] = "系统提示：\n" +request.messages[0]['content'] + "\n系统提示结束\n\n" + request.messages[2]['content']
                elif len(request.messages) >= 2:
                    if request.messages[1]['role'] == 'user':
                        if request.messages[0]['role'] == 'system':
                            request.messages[1]['content'] = "系统提示：\n" +request.messages[0]['content'] + "\n系统提示结束\n\n用户：" + request.messages[1]['content']
            except Exception as e:
                print("Dify error:",e)
        model = settings['model']
        extra_params = settings['extra_params']
        # Remove items from the extra_params list whose "name" has no non-whitespace characters
        if extra_params:
            for extra_param in extra_params:
                if not extra_param['name'].strip():
                    extra_params.remove(extra_param)
            # Convert the list to a dict
            extra_params = process_extra_params(extra_params)
        else:
            extra_params = {}
        async def stream_generator(user_prompt,DRS_STAGE,tools,images):
            # ---------- Unified SSE wrapper ----------
            def make_sse(tool_data: dict) -> str:
                chunk = {
                    "choices": [{
                        "delta": {
                            "tool_content": tool_data, # Pass the dict directly here
                        }
                    }]
                }
                return f"data: {json.dumps(chunk)}\n\n"
            try:
                extra = {}
                reasoner_extra = {}
                if chat_vendor == 'OpenAI':
                    extra['max_completion_tokens'] = request.max_tokens or settings['max_tokens']
                else:
                    extra['max_tokens'] = request.max_tokens or settings['max_tokens']
                if settings.get('enableOmniTTS',False) and not request.is_sub_agent:
                    extra['modalities'] = ["text", "audio"]
                    extra['audio'] ={"voice": settings.get('omniVoice',"Cherry"), "format": "wav"}
                if reasoner_vendor == 'OpenAI':
                    reasoner_extra['max_completion_tokens'] = settings['reasoner']['max_tokens']
                else:
                    reasoner_extra['max_tokens'] = settings['reasoner']['max_tokens']
                if request.reasoning_effort or settings['reasoning_effort']:
                    extra['reasoning_effort'] = request.reasoning_effort or settings['reasoning_effort']
                if settings['reasoner']['reasoning_effort'] is not None:
                    reasoner_extra['reasoning_effort'] = settings['reasoner']['reasoning_effort']
                # Handle the incoming async-tool-ID query
                if async_tools_id:
                    responses_to_send = []
                    responses_to_wait = []
                    async with async_tools_lock:
                        # Collect completed results and delete the entries
                        for tid in list(async_tools.keys()):  # Convert to a list to avoid dict-mutation errors
                            if tid in async_tools_id:
                                if async_tools[tid]["status"] in ("completed", "error"):
                                    responses_to_send.append({
                                        "tool_id": tid,
                                        **async_tools.pop(tid)  # Remove the processed entries
                                    })
                                elif async_tools[tid]["status"] == "pending":
                                    responses_to_wait.append({
                                        "tool_id": tid,
                                        "name":async_tools[tid]["name"],
                                        "parameters": async_tools[tid]["parameters"]
                                    })
                    for response in responses_to_send:
                        tid = response["tool_id"]
                        if response["status"] == "completed":
                            tool_chunk = {
                                "choices": [{
                                    "delta": {
                                        "tool_content": {"title": response["name"], "content": str(response["result"]), "type": "tool_result"},
                                        "async_tool_id": tid,
                                    }
                                }]
                            }
                            yield f"data: {json.dumps(tool_chunk)}\n\n"
                            request.messages.insert(-1, 
                                {
                                    "tool_calls": [
                                        {
                                            "id": "agentParty",
                                            "function": {
                                                "arguments": json.dumps(response["parameters"]),
                                                "name": response["name"],
                                            },
                                            "type": "function",
                                        }
                                    ],
                                    "role": "assistant",
                                    "content": "",
                                    "reasoning_content": "",
                                }
                            )
                            request.messages.insert(-1, 
                                {
                                    "role": "tool",
                                    "tool_call_id": "agentParty",
                                    "name": response["name"],
                                    "content": f"之前调用的异步工具（{tid}）的结果：\n\n{response['result']}\n\n====结果结束====\n\n你必须根据工具结果回复未回复的问题或需求。请不要重复调用该工具！"
                                }
                            )
                        if response["status"] == "error":
                            tool_chunk = {
                                "choices": [{
                                    "delta": {
                                        "tool_content": {"title": f"{tid}{await t('tool_result')}", "content": f"Error: {str(response['result'])}"},
                                        "async_tool_id": tid
                                    }
                                }]
                            }
                            yield f"data: {json.dumps(tool_chunk)}\n\n"
                            request.messages.append({
                                "role": "system",
                                "content": f"之前调用的异步工具（{tid}）发生错误：\n\n{response['result']}\n\n====错误结束====\n\n"
                            }) 
                    for response in responses_to_wait:
                        # Insert a new element just before the last element of request.messages
                        request.messages.insert(-1, 
                            {
                                "tool_calls": [
                                    {
                                        "id": "agentParty",
                                        "function": {
                                            "arguments": json.dumps(response["parameters"]),
                                            "name": response["name"],
                                        },
                                        "type": "function",
                                    }
                                ],
                                "role": "assistant",
                                "content": "",
                                "reasoning_content": "",
                            }
                        )
                        results = f"{response["name"]}工具已成功启动，获取结果需要花费很久的时间。请不要再次调用该工具，因为工具结果将生成后自动发送，再次调用也不能更快的获取到结果。请直接告诉用户，你会在获得结果后回答他的问题。"
                        request.messages.insert(-1, 
                            {
                                "role": "tool",
                                "tool_call_id": "agentParty",
                                "name": response["name"],
                                "content": str(results),
                            }
                        )
                kb_list = []
                if settings["knowledgeBases"]:
                    for kb in settings["knowledgeBases"]:
                        if kb["enabled"] and kb["processingStatus"] == "completed":
                            kb_list.append({"kb_id":kb["id"],"name": kb["name"],"introduction":kb["introduction"]})
                if settings["KBSettings"]["when"] == "before_thinking" or settings["KBSettings"]["when"] == "both":
                    if kb_list:
                        chunk_dict = {
                            "id": "webSearch",
                            "choices": [
                                {
                                    "finish_reason": None,
                                    "index": 0,
                                    "delta": {
                                        "role":"assistant",
                                        "content": "",
                                        "tool_content": {"title": "query_knowledge_base", "content": "", "type": "call"},
                                    }
                                }
                            ]
                        }
                        yield f"data: {json.dumps(chunk_dict)}\n\n"
                        all_kb_content = []
                        # Use the query_knowledge_base function to query all knowledge bases in kb_list
                        for kb in kb_list:
                            kb_content = await query_knowledge_base(kb["kb_id"],user_prompt)
                            all_kb_content.extend(kb_content)
                            if settings["KBSettings"]["is_rerank"]:
                                all_kb_content = await rerank_knowledge_base(user_prompt,all_kb_content)
                        if all_kb_content:
                            all_kb_content = json.dumps(all_kb_content, ensure_ascii=False, indent=4)
                            kb_message = f"\n\nKnowledge base content you can reference: {all_kb_content}"
                            content_append(request.messages, 'user',  f"\n\nKnowledge base content: {all_kb_content}\n\n")
                            tool_chunk = {
                                "choices": [{
                                    "delta": {
                                        "tool_content": {"title": "query_knowledge_base", "content": str(all_kb_content), "type": "tool_result"},
                                    }
                                }]
                            }
                            yield f"data: {json.dumps(tool_chunk)}\n\n"
                if settings["KBSettings"]["when"] == "after_thinking" or settings["KBSettings"]["when"] == "both":
                    if kb_list:
                        kb_list_message = f"\n\nList of knowledge bases you can call: {json.dumps(kb_list, ensure_ascii=False)}"
                        content_append(request.messages, 'system', kb_list_message)
                else:
                    kb_list = []
                if settings['webSearch']['enabled'] or enable_web_search:
                    if settings['webSearch']['when'] == 'before_thinking' or settings['webSearch']['when'] == 'both':
                        chunk_dict = {
                            "id": "webSearch",
                            "choices": [
                                {
                                    "finish_reason": None,
                                    "index": 0,
                                    "delta": {
                                        "role":"assistant",
                                        "content": "",
                                        "tool_content": {"title": "web_search", "content": "", "type": "call"},
                                    }
                                }
                            ]
                        }
                        yield f"data: {json.dumps(chunk_dict)}\n\n"
                        if settings['webSearch']['engine'] == 'duckduckgo':
                            results = await DDGsearch(user_prompt)
                        elif settings['webSearch']['engine'] == 'searxng':
                            results = await searxng(user_prompt)
                        elif settings['webSearch']['engine'] == 'tavily':
                            results = await Tavily_search(user_prompt)
                        elif settings['webSearch']['engine'] == 'bing':
                            results = await Bing_search(user_prompt)
                        elif settings['webSearch']['engine'] == 'google':
                            results = await Google_search(user_prompt)
                        elif settings['webSearch']['engine'] == 'brave':
                            results = await Brave_search(user_prompt)
                        elif settings['webSearch']['engine'] == 'exa':
                            results = await Exa_search(user_prompt)
                        elif settings['webSearch']['engine'] == 'serper':
                            results = await Serper_search(user_prompt)
                        elif settings['webSearch']['engine'] == 'bochaai':
                            results = await bochaai_search(user_prompt)
                        if results:
                            content_append(request.messages, 'user',  f"\n\nWeb search results: {results}\n\n")
                            tool_chunk = {
                                "choices": [{
                                    "delta": {
                                        "tool_content": {"title": "web_search", "content": str(results), "type": "tool_result"},
                                    }
                                }]
                            }
                            yield f"data: {json.dumps(tool_chunk)}\n\n"
                    if settings['webSearch']['when'] == 'after_thinking' or settings['webSearch']['when'] == 'both':
                        if settings['webSearch']['engine'] == 'duckduckgo':
                            tools.append(duckduckgo_tool)
                        elif settings['webSearch']['engine'] == 'searxng':
                            tools.append(searxng_tool)
                        elif settings['webSearch']['engine'] == 'tavily':
                            tools.append(tavily_tool)
                        elif settings['webSearch']['engine'] == 'bing':
                            tools.append(bing_tool)
                        elif settings['webSearch']['engine'] == 'google':
                            tools.append(google_tool)
                        elif settings['webSearch']['engine'] == 'brave':
                            tools.append(brave_tool)
                        elif settings['webSearch']['engine'] == 'exa':
                            tools.append(exa_tool)
                        elif settings['webSearch']['crawler'] == 'serper':
                            tools.append(serper_tool)
                        elif settings['webSearch']['crawler'] == 'bochaai':
                            tools.append(bochaai_tool)

                        if settings['webSearch']['crawler'] == 'jina':
                            tools.append(jina_crawler_tool)
                        elif settings['webSearch']['crawler'] == 'crawl4ai':
                            tools.append(Crawl4Ai_tool)
                        elif settings['webSearch']['crawler'] == 'firecrawl':
                            tools.append(firecrawl_tool)
                        elif settings['webSearch']['crawler'] == 'simpleRequest':
                            tools.append(simple_fetch_tool)
                        elif settings['webSearch']['crawler'] == 'mdnew':
                            tools.append(markdown_new_tool)
                if kb_list:
                    tools.append(kb_tool)

                # ==================== Get the permission mode ====================
                cli_settings = settings.get("CLISettings", {})
                engine = cli_settings.get("engine", "")
                
                # Get the permission mode based on the environment type
                if engine == "local":
                    env_settings = settings.get("localEnvSettings", {})
                elif engine == "ds":
                    env_settings = settings.get("dsSettings", {})
                else:
                    env_settings = settings.get("acpSettings", {})
                
                permission_mode = env_settings.get("permissionMode", "default")
                if permission_mode == "cowork" and settings['CLISettings']['enabled'] and not request.is_sub_agent:
                    tools = []
                    tools.append(create_subtask_tool)
                    tools.append(query_tasks_tool)
                    tools.append(cancel_subtask_tool)
                    if  settings['CLISettings']['mode_change']:
                        tools.append(mode_change_tool)

                if request.is_sub_agent:
                    tools.append(finish_task_tool)
                # If it's a sub-agent call, or tool-filter rules are specified
                if request.is_sub_agent or request.enable_tools or request.disable_tools:
                    original_tool_count = len(tools)
                    
                    # 1. Enable Tools filtering (allowlist mode)
                    if request.enable_tools and len(request.enable_tools) > 0:
                        # Keep only the tools on the allowlist
                        filtered_tools = []
                        enable_set = set(request.enable_tools)
                        
                        for tool in tools:
                            tool_name = tool.get("function", {}).get("name", "")
                            if tool_name in enable_set:
                                filtered_tools.append(tool)
                        
                        tools = filtered_tools
                        print(f"[Tool Filter] Enable mode: {original_tool_count} -> {len(tools)} tools (enabled: {request.enable_tools})")
                    
                    # 2. Disable Tools filtering (blocklist mode)
                    elif request.disable_tools and len(request.disable_tools) > 0:
                        # Remove the tools on the blocklist
                        disable_set = set(request.disable_tools)
                        filtered_tools = []
                        
                        for tool in tools:
                            tool_name = tool.get("function", {}).get("name", "")
                            if tool_name not in disable_set:
                                filtered_tools.append(tool)
                        
                        tools = filtered_tools
                        print(f"[Tool Filter] Disable mode: {original_tool_count} -> {len(tools)} tools (disabled: {request.disable_tools})")
                    
                    # 3. Sub-agent default policy (if no enable/disable is specified)
                    elif request.is_sub_agent:
                        # Sub-agents keep only safe tools by default and remove high-risk operations
                        SUBAGENT_BLOCKED_TOOLS = [
                            
                            # Prevent sub-agents from managing processes/ports
                            "list_processes_tool",
                            "get_process_logs_tool",
                            "kill_process_tool",
                            "docker_manage_ports_tool",
                            "local_net_tool",
                            
                            # Prevent sub-agents from creating subtasks (avoid recursion)
                            "create_subtask",
                            
                            # Prevent high-risk browser operations
                            "new_page",
                            "close_page",
                            "evaluate_script",
                            
                            # Prevent sub-agents from using Agent calls (avoid complex nesting)
                            "agent_tool_call",
                            "todo_write_tool",
                        ]
                        
                        filtered_tools = []
                        blocked_count = 0
                        
                        for tool in tools:
                            tool_name = tool.get("function", {}).get("name", "")
                            if tool_name not in SUBAGENT_BLOCKED_TOOLS:
                                filtered_tools.append(tool)
                            else:
                                blocked_count += 1
                        
                        tools = filtered_tools
                        print(f"[SubAgent Safety] Blocked {blocked_count} dangerous tools: {original_tool_count} -> {len(tools)} tools")
            

                print(tools)
                request.messages = sanitize_tool_calls(request.messages)
                if settings['tools']['deepsearch']['enabled'] or enable_deep_research: 
                    deepsearch_messages = copy.deepcopy(request.messages)
                    content_append(deepsearch_messages, 'user',  "\n\nBreak the question the user asked, or the current task they gave, into multiple steps. Summarize each step in one short sentence; you don't need to answer or execute them, just return the summary, but do not omit the details of the question or task. If the user's input is just small talk or contains no task or question, simply repeat the user's input verbatim. For a very simple question, you may give just one step. In general, it should be broken into multiple steps.")
                    
                    # 1. Use stream=True for a streaming request
                    response = await client.chat.completions.create(
                        model=model,
                        messages=deepsearch_messages,
                        stream=True,  # New
                        extra_body = extra_params, # Other parameters
                    )
                    
                    user_prompt = ""
                    # Generate a unique ID so the frontend can lock onto the same UI block for content updates
                    deepsearch_id = f"ds_{uuid.uuid4().hex[:8]}"
                    
                    # 2. Iterate the streaming response and push to the frontend in real time
                    async for chunk in response:
                        if not chunk.choices:
                            continue
                        
                        # Compatible with different versions of the openai response object
                        chunk_dict = chunk.model_dump() if hasattr(chunk, 'model_dump') else chunk
                        delta = chunk_dict["choices"][0].get("delta", {})
                        content = delta.get("content", "")
                        
                        if content:
                            user_prompt += content
                            
                            # 3. Reuse the frontend's existing tool_progress rendering mechanism
                            # The frontend auto-creates a dynamic refresh box like "calling the deep_research tool"
                            progress_chunk = {
                                "choices": [{
                                    "delta": {
                                        "tool_progress": {
                                            "name": "deep_research",
                                            "arguments": user_prompt, # Pass in the continuously accumulating content
                                            "tool_call_id": deepsearch_id
                                        }
                                    }
                                }]
                            }
                            yield f"data: {json.dumps(progress_chunk)}\n\n"
                    
                    content_append(request.messages, 'user',  f"\n\nIf the user did not ask a question or give a task, just chat. If the user did ask a question or give a task but the description is unclear or you need to understand their real needs better, you may hold off on completing the task and instead analyze which requirements the user needs to clarify further.")
                # If the reasoning model is enabled
                if settings['reasoner']['enabled'] or enable_thinking:
                    reasoner_messages = copy.deepcopy(request.messages)
                    if settings['tools']['deepsearch']['enabled'] or enable_deep_research: 
                        content_append(reasoner_messages, 'user',  f"\n\nSteps you can reference: {user_prompt}\n\n")
                        drs_msg = get_drs_stage(DRS_STAGE)
                        if drs_msg:
                            content_append(reasoner_messages, 'user',  f"\n\n{drs_msg}\n\n")
                    if tools:
                        content_append(reasoner_messages, 'system',  f"Available tools: {json.dumps(tools)}")
                    for modelProvider in settings['modelProviders']: 
                        if modelProvider['id'] == settings['reasoner']['selectedProvider']:
                            vendor = modelProvider['vendor']
                            break
                    msg = await images_add_in_messages(reasoner_messages, images,settings)
                    if vendor == 'Ollama':
                        if settings['reasoner']['temperature'] !=1:
                            reasoner_extra['temperature'] = settings['reasoner']['temperature']

                        # Call the reasoning model in streaming mode
                        reasoner_stream = await reasoner_client.chat.completions.create(
                            model=settings['reasoner']['model'],
                            messages=msg,
                            stream=True,
                            **reasoner_extra
                        )
                        full_reasoning = ""
                        buffer = ""  # A content buffer that spans chunks
                        in_reasoning = False  # Whether we're inside a tag
                        
                        async for chunk in reasoner_stream:
                            if not chunk.choices:
                                continue
                            chunk_dict = chunk.model_dump()
                            delta = chunk_dict["choices"][0].get("delta", {})
                            if delta:
                                current_content = delta.get("content", "")
                                buffer += current_content  # Accumulate into the buffer
                                
                                # Process the buffer content in real time
                                while True:
                                    reasoning_content = delta.get("reasoning_content", "")
                                    if reasoning_content:
                                        full_reasoning += reasoning_content
                                    else:
                                        reasoning_content = delta.get("reasoning", "")
                                        if reasoning_content:
                                            delta['reasoning_content'] = reasoning_content
                                            full_reasoning += reasoning_content
                                    if reasoning_content:
                                        yield f"data: {json.dumps(chunk_dict)}\n\n"
                                        break
                                    if not in_reasoning:
                                        # Look for the opening tag
                                        start_pos = buffer.find(open_tag)
                                        if start_pos != -1:
                                            # Content before the opening tag (non-thinking content)
                                            non_reasoning = buffer[:start_pos]
                                            buffer = buffer[start_pos+len(open_tag):]
                                            in_reasoning = True
                                        else:
                                            break  # No opening tag; defer for later processing
                                    else:
                                        # Look for the closing tag
                                        end_pos = buffer.find(close_tag)
                                        if end_pos != -1:
                                            # Extract the thinking content and build the response
                                            reasoning_part = buffer[:end_pos]
                                            chunk_dict["choices"][0]["delta"] = {
                                                "reasoning_content": reasoning_part,
                                                "content": ""  # Clear the non-thinking content
                                            }
                                            yield f"data: {json.dumps(chunk_dict)}\n\n"
                                            full_reasoning += reasoning_part
                                            buffer = buffer[end_pos+len(close_tag):]
                                            in_reasoning = False
                                        else:
                                            # Send the unclosed intermediate content
                                            if buffer:
                                                chunk_dict["choices"][0]["delta"] = {
                                                    "reasoning_content": buffer,
                                                    "content": ""
                                                }
                                                yield f"data: {json.dumps(chunk_dict)}\n\n"
                                                full_reasoning += buffer
                                                buffer = ""
                                            break  # Wait for more content
                    else:
                        if settings['reasoner']['temperature'] !=1:
                            reasoner_extra['temperature'] = settings['reasoner']['temperature']
                        # Call the reasoning model in streaming mode
                        reasoner_stream = await reasoner_client.chat.completions.create(
                            model=settings['reasoner']['model'],
                            messages=msg,
                            stream=True,
                            stop=settings['reasoner']['stop_words'],
                            **reasoner_extra
                        )
                        full_reasoning = ""
                        # Handle the reasoning model's streaming response
                        async for chunk in reasoner_stream:
                            if not chunk.choices:
                                continue

                            chunk_dict = chunk.model_dump()
                            delta = chunk_dict["choices"][0].get("delta", {})
                            if delta:
                                reasoning_content = delta.get("reasoning_content", "")
                                if reasoning_content:
                                    full_reasoning += reasoning_content
                                else:
                                    reasoning_content = delta.get("reasoning", "")
                                    if reasoning_content:
                                        delta['reasoning_content'] = reasoning_content
                                        full_reasoning += reasoning_content
                                # Remove the content field so yielded content doesn't include content
                                if 'content' in delta:
                                    del delta['content']
                            yield f"data: {json.dumps(chunk_dict)}\n\n"

                    # After reasoning ends, add the full reasoning content to the message
                    content_append(request.messages, 'assistant', f"<think>\n{full_reasoning}\n</think>")  # Reasoning process for reference
                # State-tracking variables
                in_reasoning = False
                reasoning_buffer = []
                content_buffer = []
                if settings['tools']['deepsearch']['enabled'] or enable_deep_research: 
                    content_append(request.messages, 'user',  f"\n\nSteps you can reference: {user_prompt}\n\n")
                    drs_msg = get_drs_stage(DRS_STAGE)
                    if drs_msg:
                        content_append(request.messages, 'user',  f"\n\n{drs_msg}\n\n")
                msg = await images_add_in_messages(request.messages, images,settings)
                if request.top_p != 1 or settings['top_p'] != 1:
                    extra['top_p'] = request.top_p or settings['top_p']

                if settings['temperature'] !=1:
                    extra['temperature'] = settings['temperature']

                if tools:
                    extra['tools'] = tools

                response = await client.chat.completions.create(
                    model=model,
                    messages=msg,  # Add image info to the message
                    stream=True,
                    extra_body = extra_params, # Other parameters
                    **extra
                )

                tool_calls = []
                full_content = ""
                assistant_reasoning_content = "" 
                search_not_done = False
                search_task = ""
                is_tool_call = False
                async for chunk in response:
                    if not chunk.choices:
                        continue
                    choice = chunk.choices[0]
                    if choice.delta.tool_calls:  # function_calling
                        is_tool_call = True
                        for tool in choice.delta.tool_calls:
                            idx = getattr(tool, 'index', len(tool_calls))
                            while len(tool_calls) <= idx:
                                tool_calls.append(None)
                            
                            if tool_calls[idx] is None:
                                tool_calls[idx] = tool
                            else:
                                if tool.function and tool.function.arguments:
                                    # The function arguments come as a stream and need to be concatenated
                                    if tool_calls[idx].function.arguments:
                                        tool_calls[idx].function.arguments += tool.function.arguments
                                    else:
                                        tool_calls[idx].function.arguments = tool.function.arguments
                            current_tool = tool_calls[idx]
                            if current_tool.function and current_tool.function.name:
                                progress_chunk = {
                                    "choices": [{
                                        "delta": {
                                            "tool_progress": {  # New field, distinct from the final tool_content
                                                "name": current_tool.function.name,
                                                "arguments": current_tool.function.arguments or "",
                                                "index": idx,
                                                "id": current_tool.id or f"call_{idx}"
                                            }
                                        }
                                    }]
                                }
                                yield f"data: {json.dumps(progress_chunk)}\n\n"
                    else:
                        if hasattr(choice.delta, "audio") and choice.delta.audio and is_tool_call == False:
                            # Keep only the Base64 audio data in delta; don't touch it
                            yield f"data: {chunk.model_dump_json()}\n\n"
                            continue
                        elif hasattr(choice.delta, "audio") and choice.delta.audio and is_tool_call == True:
                            continue
                        # Create a copy of the original chunk
                        chunk_dict = chunk.model_dump()
                        delta = chunk_dict["choices"][0]["delta"]
                        
                        # Initialize the required fields
                        delta.setdefault("content", "")
                        delta.setdefault("reasoning_content", "")
                        
                        # Handle reasoning_content first
                        if delta["reasoning_content"]:
                            assistant_reasoning_content += delta["reasoning_content"]  # New
                            yield f"data: {json.dumps(chunk_dict)}\n\n"
                            continue
                        if delta.get("reasoning", ""):
                            delta["reasoning_content"] = delta["reasoning"]
                            assistant_reasoning_content += delta["reasoning_content"]  # New
                            yield f"data: {json.dumps(chunk_dict)}\n\n"
                            continue

                        # Process the content
                        current_content = delta["content"]
                        buffer = current_content
                        
                        while buffer:
                            if not in_reasoning:
                                # Look for the start tag
                                start_pos = buffer.find(open_tag)
                                if start_pos != -1:
                                    # Process the content before the start tag
                                    content_buffer.append(buffer[:start_pos])
                                    buffer = buffer[start_pos+len(open_tag):]
                                    in_reasoning = True
                                else:
                                    content_buffer.append(buffer)
                                    buffer = ""
                            else:
                                # Look for the end tag
                                end_pos = buffer.find(close_tag)
                                if end_pos != -1:
                                    # Process the thinking content
                                    reasoning_buffer.append(buffer[:end_pos])
                                    buffer = buffer[end_pos+len(close_tag):]
                                    in_reasoning = False
                                else:
                                    reasoning_buffer.append(buffer)
                                    buffer = ""
                        
                        # Build the new delta content
                        new_content = "".join(content_buffer)
                        new_reasoning = "".join(reasoning_buffer)
                        
                        assistant_reasoning_content += new_reasoning  # New

                        # Update the chunk content
                        delta["content"] = new_content.strip("\x00")  # Keep the unfinished content
                        delta["reasoning_content"] = new_reasoning.strip("\x00") or None
                        
                        # Reset the buffer but keep the unfinished part
                        if in_reasoning:
                            content_buffer = [new_content.split(open_tag)[-1]] 
                        else:
                            content_buffer = []
                        reasoning_buffer = []
                        yield f"data: {json.dumps(chunk_dict)}\n\n"
                        full_content += delta.get("content") or "" 
                # Finally flush the unfinished content
                if content_buffer or reasoning_buffer:
                    final_chunk = {
                        "choices": [{
                            "delta": {
                                "content": "".join(content_buffer),
                                "reasoning_content": "".join(reasoning_buffer)
                            }
                        }]
                    }
                    yield f"data: {json.dumps(final_chunk)}\n\n"
                    full_content += final_chunk["choices"][0]["delta"].get("content", "")
                if not tool_calls:
                    # Add the response to the message list
                    request.messages.append({
                        "role": "assistant",
                        "content": full_content,
                        "reasoning_content": assistant_reasoning_content
                    })
                    assistant_reasoning_content = ""  # Reset
                # Tools and deep search
                if tool_calls:
                    print("tool_calls",tool_calls)
                    pass
                elif settings['tools']['deepsearch']['enabled'] or enable_deep_research: 
                    search_prompt = get_drs_stage_system_message(DRS_STAGE,user_prompt,full_content)
                    response = await client.chat.completions.create(
                        model=model,
                        messages=[
                            {
                            "role": "system",
                            "content": source_prompt,
                            },
                            {
                            "role": "user",
                            "content": search_prompt,
                            }
                        ],
                        extra_body = extra_params, # Other parameters
                    )
                    response_content = response.choices[0].message.content
                    # Use re to extract the json string wrapped in ```json ... ```
                    if "```json" in response_content:
                        try:
                            response_content = re.search(r'```json(.*?)```', response_content, re.DOTALL).group(1)
                        except:
                            # Use re to extract the content after ```json
                            response_content = re.search(r'```json(.*?)', response_content, re.DOTALL).group(1)
                    try:
                        response_content = json.loads(response_content)
                    except json.JSONDecodeError:
                        search_chunk = {
                            "choices": [{
                                "delta": {
                                    "tool_content": {"title": f"❌{await t('task_error')}", "content": ""}
                                }
                            }]
                        }
                        yield f"data: {json.dumps(search_chunk)}\n\n"
                    if response_content["status"] == "done":
                        search_chunk = {
                            "choices": [{
                                "delta": {
                                   "tool_content": {"title": f"✅{await t('task_done')}", "content": ""},
                                }
                            }]
                        }
                        yield f"data: {json.dumps(search_chunk)}\n\n"
                        search_not_done = False
                    elif response_content["status"] == "not_done":
                        search_chunk = {
                            "choices": [{
                                "delta": {
                                    "tool_content": {"title": f"❎{await t('task_not_done')}", "content": ""},
                                }
                            }]
                        }
                        yield f"data: {json.dumps(search_chunk)}\n\n"
                        search_not_done = True
                        search_task = response_content["unfinished_task"]
                        task_prompt = f"请继续完成初始任务中未完成的任务：\n\n{search_task}\n\n初始任务：{user_prompt}\n\n最后，请给出完整的初始任务的最终结果。"
                        request.messages.append(
                            {
                                "role": "assistant",
                                "content": full_content,
                                "reasoning_content": assistant_reasoning_content,
                            }
                        )
                        assistant_reasoning_content = ""  # This turn's thinking has been archived
                        full_content = "" 
                        request.messages.append(
                            {
                                "role": "user",
                                "content": task_prompt,
                            }
                        )
                    elif response_content["status"] == "need_more_info":
                        DRS_STAGE = 2
                        search_chunk = {
                            "choices": [{
                                "delta": {
                                    "tool_content": {"title": f"❓{await t('task_need_more_info')}", "content": ""}
                                }
                            }]
                        }
                        yield f"data: {json.dumps(search_chunk)}\n\n"
                        search_not_done = False
                    elif response_content["status"] == "need_work":
                        DRS_STAGE = 2
                        search_chunk = {
                            "choices": [{
                                "delta": {
                                    "tool_content": {"title": f"🔍{await t('enter_search_stage')}", "content": ""}
                                }
                            }]
                        }
                        yield f"data: {json.dumps(search_chunk)}\n\n"
                        search_not_done = True
                        drs_msg = get_drs_stage(DRS_STAGE)
                        request.messages.append(
                            {
                                "role": "assistant",
                                "content": full_content,
                                "reasoning_content": assistant_reasoning_content,
                            }
                        )
                        request.messages.append(
                            {
                                "role": "user",
                                "content": drs_msg,
                            }
                        )
                    elif response_content["status"] == "need_more_work":
                        DRS_STAGE = 2
                        search_chunk = {
                            "choices": [{
                                "delta": {
                                    "tool_content": {"title": f"🔍{await t('need_more_work')}", "content": ""}
                                }
                            }]
                        }
                        yield f"data: {json.dumps(search_chunk)}\n\n"
                        search_not_done = True
                        search_task = response_content["unfinished_task"]
                        task_prompt = f"请继续查询如下信息：\n\n{search_task}\n\n初始任务：{user_prompt}\n\n"
                        request.messages.append(
                            {
                                "role": "assistant",
                                "content": full_content,
                                "reasoning_content": assistant_reasoning_content,
                            }
                        )
                        assistant_reasoning_content = ""  # This turn's thinking has been archived
                        full_content = "" 
                        request.messages.append(
                            {
                                "role": "user",
                                "content": task_prompt,
                            }
                        )
                    elif response_content["status"] == "answer":
                        DRS_STAGE = 3
                        search_chunk = {
                            "choices": [{
                                "delta": {
                                    "tool_content": {"title": f"⭐{await t('enter_answer_stage')}", "content": ""}
                                }
                            }]
                        }
                        yield f"data: {json.dumps(search_chunk)}\n\n"
                        search_not_done = True
                        drs_msg = get_drs_stage(DRS_STAGE)
                        request.messages.append(
                            {
                                "role": "assistant",
                                "content": full_content,
                                "reasoning_content": assistant_reasoning_content,
                            }
                        )
                        assistant_reasoning_content = ""  # This turn's thinking has been archived
                        full_content = "" 
                        request.messages.append(
                            {
                                "role": "user",
                                "content": drs_msg,
                            }
                        )

                reasoner_messages = copy.deepcopy(request.messages)
                while tool_calls or search_not_done:
                    full_content = ""
                    if tool_calls:
                        # 1. Assemble and save the tool_calls list in the assistant message
                        assistant_tool_calls_msg = {
                            "role": "assistant",
                            "content": "",
                            "reasoning_content": assistant_reasoning_content,
                            "tool_calls": []
                        }
                        assistant_reasoning_content = ""  # Reset; this turn's thinking is stored
                        assistant_tool_calls_str =[]
                        
                        for tc in tool_calls:
                            if tc is None: continue
                            response_content = tc.function
                            assistant_tool_calls_msg["tool_calls"].append({
                                "id": tc.id,
                                "function": {
                                    "arguments": response_content.arguments,
                                    "name": response_content.name,
                                },
                                "type": tc.type,
                            })
                            assistant_tool_calls_str.append(str(response_content))
                        
                        request.messages.append(assistant_tool_calls_msg)
                        reasoner_messages.append({
                            "role": "assistant",
                            "content": "\n".join(assistant_tool_calls_str),
                            "reasoning_content": "",
                        })

                        has_approval_required = False
                        
                        # 2. Execute each parallel tool call in turn
                        for tc in tool_calls:
                            if tc is None: continue
                            response_content = tc.function
                            
                            # Handle the edge case where the LLM concatenates multiple JSON args into one tool argument
                            modified_data = '[' + response_content.arguments.replace('}{', '},{') + ']'
                            try:
                                data_list = json.loads(modified_data)
                            except:
                                try:
                                    data_list = [json.loads(response_content.arguments)]
                                except:
                                    data_list = [{}]
                            
                            if not isinstance(data_list, list):
                                data_list = [data_list]
                            if len(data_list) == 0:
                                data_list = [{}]

                            # [Fix 1] explicitly send a "call" event to lock the UI state and sync the ID
                            call_confirm_chunk = {
                                "choices":[{
                                    "delta": {
                                        "tool_call_id": tc.id,
                                        "tool_content": {
                                            "title": response_content.name,
                                            "content": response_content.arguments, # Send the full arguments to the frontend for rendering
                                            "type": "call"
                                        }
                                    }
                                }]
                            }
                            yield f"data: {json.dumps(call_confirm_chunk)}\n\n"

                            all_results_for_this_call =[]
                            is_streaming_result = False

                            # Iterate the inner argument list to execute the tool (data_list length is 1 in the vast majority of cases)
                            for arg_item in data_list:
                                if settings['tools']['asyncTools']['enabled']:
                                    tool_id = uuid.uuid4()
                                    async_tool_id = f"{response_content.name}_{tool_id}"
                                    chunk_dict = {
                                        "id": "agentParty",
                                        "choices":[
                                            {
                                                "finish_reason": None,
                                                "index": 0,
                                                "delta": {
                                                    "role": "assistant",
                                                    "content": "",
                                                    "async_tool_id": async_tool_id
                                                }
                                            }
                                        ]
                                    }
                                    yield f"data: {json.dumps(chunk_dict)}\n\n"
                                    asyncio.create_task(
                                        execute_tool(
                                            async_tool_id,
                                            response_content.name,
                                            arg_item,
                                            settings,
                                            user_prompt
                                        )
                                    )
                                    async with async_tools_lock:
                                        async_tools[async_tool_id] = {
                                            "status": "pending",
                                            "result": None,
                                            "name": response_content.name,
                                            "parameters": arg_item
                                        }
                                    res = f"{response_content.name}tool has been successfully launched. It will take some time to run, and the results will be provided in the next round of conversation."
                                    all_results_for_this_call.append(res)
                                else:
                                    res = await dispatch_tool(response_content.name, arg_item, settings, request.is_sub_agent)

                                    if res is None:
                                        chunk = {
                                            "id": "extra_tools",
                                            "choices":[
                                                {
                                                    "index": 0,
                                                    "delta": {
                                                        "role":"assistant",
                                                        "content": "",
                                                        "tool_calls": response_content.arguments,
                                                    }
                                                }
                                            ]
                                        }
                                        yield f"data: {json.dumps(chunk)}\n\n"
                                        continue

                                    if response_content.name in["query_knowledge_base"] and type(res) == list:
                                        if settings["KBSettings"]["is_rerank"]:
                                            res = await rerank_knowledge_base(user_prompt, res)
                                        res = json.dumps(res, ensure_ascii=False, indent=4)
                                    
                                    # Handle streaming tool results
                                    if isinstance(res, AsyncIterator):
                                        is_streaming_result = True
                                        buffer =[]
                                        first = True
                                        async for chunk in res:
                                            buffer.append(chunk)
                                            if first:
                                                stream_chunk = {
                                                    "choices":[{
                                                        "delta": {
                                                            "tool_call_id": tc.id,
                                                            "tool_content": {
                                                                "title": response_content.name,
                                                                "content": chunk,
                                                                "type": "tool_result_stream"
                                                            }
                                                        }
                                                    }]
                                                }
                                                yield f"data: {json.dumps(stream_chunk)}\n\n"
                                                first = False
                                            else:
                                                stream_chunk = {
                                                    "choices":[{
                                                        "delta": {
                                                            "tool_call_id": tc.id,
                                                            "tool_content": {
                                                                "title": "tool_result_stream",
                                                                "content": chunk,
                                                                "type": "tool_result_stream"
                                                            }
                                                        }
                                                    }]
                                                }
                                                yield f"data: {json.dumps(stream_chunk)}\n\n"
                                        res = "".join(buffer)

                                    if isinstance(res, str) and '"approval_required"' in res:
                                        try:
                                            parsed_res = json.loads(res)
                                            if parsed_res.get("type") == "approval_required":
                                                has_approval_required = True
                                        except Exception:
                                            pass
                                        
                                    all_results_for_this_call.append(str(res))

                            if len(all_results_for_this_call) == 0:
                                combined_results = "None"
                            elif len(all_results_for_this_call) == 1:
                                combined_results = all_results_for_this_call[0]
                            else:
                                combined_results = "\n\n".join(all_results_for_this_call)
                            
                            # [Fix 2] send the combined result (in the non-streaming case)
                            if not is_streaming_result:
                                result_chunk = {
                                    "choices":[{
                                        "delta": {
                                            "tool_call_id": tc.id,
                                            "tool_content": {
                                                "title": response_content.name,
                                                "content": combined_results,
                                                "type": "tool_result"
                                            }
                                        }
                                    }]
                                }
                                yield f"data: {json.dumps(result_chunk)}\n\n"

                            request.messages.append(
                                {
                                    "role": "tool",
                                    "tool_call_id": tc.id,
                                    "name": response_content.name,
                                    "content": str(combined_results),
                                }
                            )
                            reasoner_messages.append(
                                {
                                    "role": "user",
                                    "content": f"{response_content.name}工具结果：{combined_results}",
                                    "reasoning_content": "",
                                }
                            )
                    # If the reasoning model is enabled
                    if settings['reasoner']['enabled'] or enable_thinking:
                        if tools:
                            content_append(reasoner_messages, 'system',  f"Available tools: {json.dumps(tools)}")
                        for modelProvider in settings['modelProviders']: 
                            if modelProvider['id'] == settings['reasoner']['selectedProvider']:
                                vendor = modelProvider['vendor']
                                break
                        msg = await images_add_in_messages(reasoner_messages, images,settings)
                        if vendor == 'Ollama':
                            if settings['reasoner']['temperature'] !=1:
                                reasoner_extra['temperature'] = settings['reasoner']['temperature']
                            # Call the reasoning model in streaming mode
                            reasoner_stream = await reasoner_client.chat.completions.create(
                                model=settings['reasoner']['model'],
                                messages=msg,
                                stream=True,
                                **reasoner_extra
                            )
                            full_reasoning = ""
                            buffer = ""  # A content buffer that spans chunks
                            in_reasoning = False  # Whether we're inside a tag
                            
                            async for chunk in reasoner_stream:
                                if not chunk.choices:
                                    continue
                                chunk_dict = chunk.model_dump()
                                delta = chunk_dict["choices"][0].get("delta", {})
                                if delta:
                                    current_content = delta.get("content", "")
                                    buffer += current_content  # Accumulate into the buffer
                                    
                                    # Process the buffer content in real time
                                    while True:
                                        reasoning_content = delta.get("reasoning_content", "")
                                        if reasoning_content:
                                            full_reasoning += reasoning_content
                                        else:
                                            reasoning_content = delta.get("reasoning", "")
                                            if reasoning_content:
                                                delta['reasoning_content'] = reasoning_content
                                                full_reasoning += reasoning_content
                                        if reasoning_content:
                                            yield f"data: {json.dumps(chunk_dict)}\n\n"
                                            break
                                        if not in_reasoning:
                                            # Look for the opening tag
                                            start_pos = buffer.find(open_tag)
                                            if start_pos != -1:
                                                # Content before the opening tag (non-thinking content)
                                                non_reasoning = buffer[:start_pos]
                                                buffer = buffer[start_pos+len(open_tag):]
                                                in_reasoning = True
                                            else:
                                                break  # No opening tag; defer for later processing
                                        else:
                                            # Look for the closing tag
                                            end_pos = buffer.find(close_tag)
                                            if end_pos != -1:
                                                # Extract the thinking content and build the response
                                                reasoning_part = buffer[:end_pos]
                                                chunk_dict["choices"][0]["delta"] = {
                                                    "reasoning_content": reasoning_part,
                                                    "content": ""  # Clear the non-thinking content
                                                }
                                                yield f"data: {json.dumps(chunk_dict)}\n\n"
                                                full_reasoning += reasoning_part
                                                buffer = buffer[end_pos+len(close_tag):]
                                                in_reasoning = False
                                            else:
                                                # Send the unclosed intermediate content
                                                if buffer:
                                                    chunk_dict["choices"][0]["delta"] = {
                                                        "reasoning_content": buffer,
                                                        "content": ""
                                                    }
                                                    yield f"data: {json.dumps(chunk_dict)}\n\n"
                                                    full_reasoning += buffer
                                                    buffer = ""
                                                break  # Wait for more content
                        else:
                            if settings['reasoner']['temperature'] !=1:
                                reasoner_extra['temperature'] = settings['reasoner']['temperature']

                            # Call the reasoning model in streaming mode
                            reasoner_stream = await reasoner_client.chat.completions.create(
                                model=settings['reasoner']['model'],
                                messages=msg,
                                stream=True,
                                stop=settings['reasoner']['stop_words'],
                                **reasoner_extra
                            )
                            full_reasoning = ""
                            # Handle the reasoning model's streaming response
                            async for chunk in reasoner_stream:
                                if not chunk.choices:
                                    continue

                                chunk_dict = chunk.model_dump()
                                delta = chunk_dict["choices"][0].get("delta", {})
                                if delta:
                                    reasoning_content = delta.get("reasoning_content", "")
                                    if reasoning_content:
                                        full_reasoning += reasoning_content
                                    else:
                                        reasoning_content = delta.get("reasoning", "")
                                        if reasoning_content:
                                            delta['reasoning_content'] = reasoning_content
                                            full_reasoning += reasoning_content
                                    # Remove the content field so yielded content doesn't include content
                                    if 'content' in delta:
                                        del delta['content']
                                yield f"data: {json.dumps(chunk_dict)}\n\n"

                        # After reasoning ends, add the full reasoning content to the message
                        content_append(request.messages, 'user', f"\n\nReasoning process you can reference: {full_reasoning}") # reasoning process for reference

                    all_combined_results = ""
                    if tool_calls:
                        # Count the non-None tool_calls
                        tool_msg_count = sum(1 for tc in tool_calls if tc is not None)
                        if tool_msg_count > 0:
                            # Extract the tool results just appended to request.messages and concatenate them
                            recent_tool_msgs = request.messages[-tool_msg_count:]
                            all_combined_results = "\n".join([str(msg.get("content", "")) for msg in recent_tool_msgs if msg.get("role") == "tool"])

                    browser_vision_enabled = False
                    if settings['chromeMCPSettings']['enabled'] and settings['chromeMCPSettings']['type']=='internal':
                        browser_vision_enabled = settings['chromeMCPSettings'].get('browserVision', False)

                    if browser_vision_enabled and '[Getting browser screenshot]' in all_combined_results:
                        import re
                        # Use a regex to extract the URL from the return value (e.g. http://127.0.0.1:3456/uploaded_files/xxx.jpg)
                        match = re.search(r'\[Getting browser screenshot\]\s*(http[^\s]+)', all_combined_results)
                        if match:
                            browser_img_url = match.group(1)
                            
                            current_browser_msg = {
                                "role": "user",
                                "content": [
                                    {"type": "text", "text": "[Getting browser screenshot]\n\n【system info】Current browser screenshot injected."},
                                    {"type": "image_url", "image_url": {"url": browser_img_url}}
                                ]
                            }
                            request.messages.append(current_browser_msg)
                            
                            # (Optional) clean up old browser screenshots to save tokens
                            if settings.get('chromeMCPSettings', {}).get('onlyNewScreen', True):
                                for msg in request.messages[:-1]:
                                    if isinstance(msg.get('content'), list):
                                        # Filter out the old image items
                                        msg['content'] =[item for item in msg['content'] if item.get('type') != 'image_url']
                                        # If only text remains after filtering, restore it to a plain string
                                        if len(msg['content']) == 1 and msg['content'][0].get('type') == 'text':
                                            msg['content'] = msg['content'][0]['text']
                                        elif len(msg['content']) == 0:
                                            msg['content'] = ""


                    vision_control_enabled = settings.get('visionControlSettings', {}).get('enabled', False)
                    
                    # === Change: from exact-matching results to checking membership in all_combined_results ===
                    if vision_control_enabled and ('[Getting screenshot]' in all_combined_results or settings.get('visionControlSettings', {}).get('desktopVision', False)):
                        try:
                            import pyautogui
                            # Must import the set-region method from your tool class
                            from py.computer_use_tool import set_screen_region
                            # Import the cross-platform UI-tree capture tool we wrote
                            from py.ui_tree_helper import get_desktop_ui_tree
                            
                            v_settings = settings.get('visionControlSettings', {})
                            is_grid_enabled = v_settings.get('isEnableGrid', False)
                            is_full_screen = v_settings.get('isFullScreen', True)
                            # ScreenSize format is [x, y, width, height]
                            screen_size = v_settings.get('ScreenSize',[0, 0, 1920, 1080])
                            time.sleep(0.5) # Wait a moment to ensure the screenshot tool is ready
                            print(f"Taking desktop screenshot (fullscreen: {is_full_screen}, grid: {is_grid_enabled})...")
                            
                            # Initialize the coordinate offset
                            offset_x, offset_y = 0, 0
                            
                            # --- 1. Region determination and capture ---
                            if not is_full_screen and len(screen_size) == 4:
                                # Partial-screenshot mode
                                rx, ry, rw, rh = map(int, screen_size)
                                offset_x, offset_y = rx, ry  # Record the top-left coordinate offset of the partial screenshot
                                
                                # Key: tell the mouse tool that upcoming 0-1000 coordinates map to this partial rectangle
                                set_screen_region((rx, ry, rw, rh))
                                
                                # The logical size is the selection size
                                logical_width, logical_height = rw, rh
                                # Capture the specified region
                                screenshot = await asyncio.to_thread(pyautogui.screenshot, region=(rx, ry, rw, rh))
                            else:
                                # Full-screen screenshot mode
                                set_screen_region(None) # Restore full-screen mapping
                                logical_width, logical_height = pyautogui.size()
                                screenshot = await asyncio.to_thread(pyautogui.screenshot)
                            
                            # --- 2. Force-resize to the logical coordinate system (fixes Windows scaling offset) ---
                            if screenshot.width != logical_width or screenshot.height != logical_height:
                                screenshot = await asyncio.to_thread(
                                    screenshot.resize, (logical_width, logical_height), Image.Resampling.LANCZOS
                                )
                            
                            # Limit the transferred image size to balance token usage
                            target_w, target_h = scale_to_fit(logical_width, logical_height, 1280, 720)
                            if screenshot.width > target_w or screenshot.height > target_h:
                                screenshot = await asyncio.to_thread(
                                    screenshot.resize, (target_w, target_h), Image.Resampling.LANCZOS
                                )

                            # --- 3. Draw visual feedback (dots/lines) ---
                            action_feedback_hint = ""
                            
                            # === Change: use all_combined_results instead of results ===
                            if all_combined_results and "[LAST_ACTION:" in all_combined_results:
                                screenshot = await asyncio.to_thread(draw_action_feedback, screenshot, all_combined_results)
                                action_feedback_hint = (
                                    " Notice: The colored markers show your PREVIOUS actions relative to this view. "
                                    "Cyan = Click. Blue = Double Click. Green-Yellow = Drag."
                                )

                            # --- 4. Draw the grid overlay ---
                            if is_grid_enabled:
                                display_image = await asyncio.to_thread(draw_grid_on_image, screenshot.copy(), grid_spacing=10)
                                region_text = "partial region" if not is_full_screen else "full desktop"
                                grid_hint = f"\n\n【system info】Screenshot of {region_text} with coordinate grid (0-1000) injected. Use coordinates for precise clicking within this view.\n{action_feedback_hint}"
                            else:
                                display_image = screenshot
                                grid_hint = f"\n\n【system info】Current screenshot injected.\n{action_feedback_hint}"

                            ui_tree_hint = ""
                            if vision_control_enabled:
                                print("Asynchronously extracting cross-platform accessibility UI tree and aligning 0-1000 coordinates...")
                                # Pass in the logical viewport size (logical_width, logical_height) and the offset (offset_x, offset_y)
                                ui_tree_json = await get_desktop_ui_tree(
                                    logical_width=logical_width,
                                    logical_height=logical_height,
                                    offset_x=offset_x,
                                    offset_y=offset_y
                                )
                                ui_tree_hint = f"\n\n【system info】Current Interactive UI Elements (Index of clickable items on screen with 0-1000 grid):\n```json\n{ui_tree_json}\n```\nYou can click any element using the provided [center_x, center_y] coordinates (which correspond perfectly to your 0-1000 grid input)."

                            # --- 5. Save and inject into the message ---
                            desktop_img_name = f"desktop_view_{uuid.uuid4().hex}.png"
                            desktop_img_path = os.path.join(UPLOAD_FILES_DIR, desktop_img_name)
                            await asyncio.to_thread(display_image.save, desktop_img_path, optimize=True)
                            
                            desktop_url = f"{fastapi_base_url}uploaded_files/{desktop_img_name}"
                            
                            # Merge grid_hint and ui_tree_hint into the message's text node
                            current_user_msg = {
                                "role": "user",
                                "content": [
                                    {"type": "text", "text": '[Getting screenshot]' + grid_hint + ui_tree_hint},
                                    {"type": "image_url", "image_url": {"url": desktop_url}}
                                ]
                            }
                            request.messages.append(current_user_msg)
                            
                            # --- 6. Clean up old screenshots ---
                            if v_settings.get('onlyNewScreen', False):
                                for msg in request.messages[:-1]:
                                    if isinstance(msg.get('content'), list):
                                        msg['content'] = [item for item in msg['content'] if item.get('type') != 'image_url']
                                        if len(msg['content']) == 1 and msg['content'][0].get('type') == 'text':
                                            msg['content'] = msg['content'][0]['text']
                                        elif len(msg['content']) == 0:
                                            msg['content'] = ""

                        except Exception as e:
                            print(f"Backend desktop screenshot or UI-tree fetch failed: {e}")
                            
                        images = await images_in_messages(request.messages, fastapi_base_url)
                        request.messages = await message_without_images(request.messages)
                    msg = await images_add_in_messages(request.messages, images, settings)
                    if request.top_p != 1 or settings['top_p'] != 1:
                        extra['top_p'] = request.top_p or settings['top_p']

                    if settings['temperature'] !=1:
                        extra['temperature'] = settings['temperature']

                    if tools:
                        extra['tools'] = tools
                    response = await client.chat.completions.create(
                        model=model,
                        messages=msg,  # Add image info to the message
                        stream=True,
                        extra_body = extra_params, # Other parameters
                        **extra
                    )
                    tool_calls = []
                    async for chunk in response:
                        if not chunk.choices:
                            continue
                        if chunk.choices:
                            choice = chunk.choices[0]
                            if hasattr(choice.delta, "audio") and choice.delta.audio:
                                # Keep only the Base64 audio data in delta; don't touch it
                                yield f"data: {chunk.model_dump_json()}\n\n"
                                continue
                            if choice.delta.tool_calls:  # function_calling
                                for tool in choice.delta.tool_calls:
                                    idx = getattr(tool, 'index', len(tool_calls))
                                    while len(tool_calls) <= idx:
                                        tool_calls.append(None)
                                    
                                    if tool_calls[idx] is None:
                                        tool_calls[idx] = tool
                                    else:
                                        if tool.function and tool.function.arguments:
                                            # The function arguments come as a stream and need to be concatenated
                                            if tool_calls[idx].function.arguments:
                                                tool_calls[idx].function.arguments += tool.function.arguments
                                            else:
                                                tool_calls[idx].function.arguments = tool.function.arguments
                                current_tool = tool_calls[idx]
                                if current_tool.function and current_tool.function.name:
                                    progress_chunk = {
                                        "choices": [{
                                            "delta": {
                                                "tool_progress": {  # New field, distinct from the final tool_content
                                                    "name": current_tool.function.name,
                                                    "arguments": current_tool.function.arguments or "",
                                                    "index": idx,
                                                    "id": current_tool.id or f"call_{idx}"
                                                }
                                            }
                                        }]
                                    }
                                    yield f"data: {json.dumps(progress_chunk)}\n\n"
                            else:
                                # Create a copy of the original chunk
                                chunk_dict = chunk.model_dump()
                                delta = chunk_dict["choices"][0]["delta"]
                                
                                # Initialize the required fields
                                delta.setdefault("content", "")
                                delta.setdefault("reasoning_content", "")

                                # Handle reasoning_content first
                                if delta["reasoning_content"]:
                                    assistant_reasoning_content += delta["reasoning_content"]  # New
                                    yield f"data: {json.dumps(chunk_dict)}\n\n"
                                    continue
                                if delta.get("reasoning", ""):
                                    delta["reasoning_content"] = delta["reasoning"]
                                    assistant_reasoning_content += delta["reasoning_content"]  # New
                                    yield f"data: {json.dumps(chunk_dict)}\n\n"
                                    continue
                                # Process the content
                                current_content = delta["content"]
                                buffer = current_content
                                
                                while buffer:
                                    if not in_reasoning:
                                        # Look for the start tag
                                        start_pos = buffer.find(open_tag)
                                        if start_pos != -1:
                                            # Process the content before the start tag
                                            content_buffer.append(buffer[:start_pos])
                                            buffer = buffer[start_pos+len(open_tag):]
                                            in_reasoning = True
                                        else:
                                            content_buffer.append(buffer)
                                            buffer = ""
                                    else:
                                        # Look for the end tag
                                        end_pos = buffer.find(close_tag)
                                        if end_pos != -1:
                                            # Process the thinking content
                                            reasoning_buffer.append(buffer[:end_pos])
                                            buffer = buffer[end_pos+len(close_tag):]
                                            in_reasoning = False
                                        else:
                                            reasoning_buffer.append(buffer)
                                            buffer = ""
                                
                                # Build the new delta content
                                new_content = "".join(content_buffer)
                                new_reasoning = "".join(reasoning_buffer)

                                assistant_reasoning_content += new_reasoning
                                
                                # Update the chunk content
                                delta["content"] = new_content.strip("\x00")  # Keep the unfinished content
                                delta["reasoning_content"] = new_reasoning.strip("\x00") or None
                                
                                # Reset the buffer but keep the unfinished part
                                if in_reasoning:
                                    content_buffer = [new_content.split(open_tag)[-1]] 
                                else:
                                    content_buffer = []
                                reasoning_buffer = []
                                
                                yield f"data: {json.dumps(chunk_dict)}\n\n"
                                full_content += delta.get("content") or "" 
                    # Finally flush the unfinished content
                    if content_buffer or reasoning_buffer:
                        final_chunk = {
                            "choices": [{
                                "delta": {
                                    "content": "".join(content_buffer),
                                    "reasoning_content": "".join(reasoning_buffer)
                                }
                            }]
                        }
                        yield f"data: {json.dumps(final_chunk)}\n\n"
                        full_content += final_chunk["choices"][0]["delta"].get("content", "")
                    if not tool_calls:
                        # Add the response to the message list
                        request.messages.append({
                            "role": "assistant",
                            "content": full_content,
                            "reasoning_content": assistant_reasoning_content
                        })
                        assistant_reasoning_content = ""  # Reset
                    # Tools and deep search
                    if tool_calls:
                        pass
                    elif settings['tools']['deepsearch']['enabled'] or enable_deep_research: 
                        search_prompt = get_drs_stage_system_message(DRS_STAGE,user_prompt,full_content)
                        response = await client.chat.completions.create(
                            model=model,
                            messages=[                        
                                {
                                "role": "system",
                                "content": source_prompt,
                                },
                                {
                                "role": "user",
                                "content": search_prompt,
                                }
                            ],
                            extra_body = extra_params, # Other parameters
                        )
                        response_content = response.choices[0].message.content
                        if response_content is None:
                            response_content = ""
                        # Use re to extract the json string wrapped in ```json ... ```
                        if "```json" in response_content:
                            try:
                                response_content = re.search(r'```json(.*?)```', response_content, re.DOTALL).group(1)
                            except:
                                # Use re to extract the content after ```json
                                response_content = re.search(r'```json(.*?)', response_content, re.DOTALL).group(1)
                        try:
                            response_content = json.loads(response_content)
                        except json.JSONDecodeError:
                            search_chunk = {
                                "choices": [{
                                    "delta": {
                                        "tool_content": {"title": f"❌{await t('task_error')}", "content": ""}
                                    }
                                }]
                            }
                            yield f"data: {json.dumps(search_chunk)}\n\n"
                        if response_content["status"] == "done":
                            search_chunk = {
                                "choices": [{
                                    "delta": {
                                        "tool_content": {"title": f"✅{await t('task_done')}", "content": ""}
                                    }
                                }]
                            }
                            yield f"data: {json.dumps(search_chunk)}\n\n"
                            search_not_done = False
                        elif response_content["status"] == "not_done":
                            search_chunk = {
                                "choices": [{
                                    "delta": {
                                        "tool_content": {"title": f"❎{await t('task_not_done')}", "content": ""}
                                    }
                                }]
                            }
                            yield f"data: {json.dumps(search_chunk)}\n\n"
                            search_not_done = True
                            search_task = response_content["unfinished_task"]
                            task_prompt = f"请继续完成初始任务中未完成的任务：\n\n{search_task}\n\n初始任务：{user_prompt}\n\n最后，请给出完整的初始任务的最终结果。"
                            request.messages.append(
                                {
                                    "role": "assistant",
                                    "content": full_content,
                                    "reasoning_content": assistant_reasoning_content,
                                }
                            )
                            assistant_reasoning_content = ""  # This turn's thinking has been archived
                            full_content = "" 
                            request.messages.append(
                                {
                                    "role": "user",
                                    "content": task_prompt,
                                }
                            )
                        elif response_content["status"] == "need_more_info":
                            DRS_STAGE = 2
                            search_chunk = {
                                "choices": [{
                                    "delta": {
                                        "tool_content": {"title": f"❓{await t('task_need_more_info')}", "content": ""}
                                    }
                                }]
                            }
                            yield f"data: {json.dumps(search_chunk)}\n\n"
                            search_not_done = False
                        elif response_content["status"] == "need_work":
                            DRS_STAGE = 2
                            search_chunk = {
                                "choices": [{
                                    "delta": {
                                        "tool_content": {"title": f"🔍{await t('enter_search_stage')}", "content": ""}
                                    }
                                }]
                            }
                            yield f"data: {json.dumps(search_chunk)}\n\n"
                            search_not_done = True
                            drs_msg = get_drs_stage(DRS_STAGE)
                            request.messages.append(
                                {
                                    "role": "assistant",
                                    "content": full_content,
                                    "reasoning_content": assistant_reasoning_content,
                                }
                            )
                            assistant_reasoning_content = ""  # This turn's thinking has been archived
                            full_content = "" 
                            request.messages.append(
                                {
                                    "role": "user",
                                    "content": drs_msg,
                                }
                            )
                        elif response_content["status"] == "need_more_work":
                            DRS_STAGE = 2
                            search_chunk = {
                                "choices": [{
                                    "delta": {
                                        "tool_content": {"title": f"🔍{await t('need_more_work')}", "content": ""}
                                    }
                                }]
                            }
                            yield f"data: {json.dumps(search_chunk)}\n\n"
                            search_not_done = True
                            search_task = response_content["unfinished_task"]
                            task_prompt = f"请继续查询如下信息：\n\n{search_task}\n\n初始任务：{user_prompt}\n\n"
                            request.messages.append(
                                {
                                    "role": "assistant",
                                    "content": full_content,
                                    "reasoning_content": assistant_reasoning_content,
                                }
                            )
                            assistant_reasoning_content = ""  # This turn's thinking has been archived
                            full_content = "" 
                            request.messages.append(
                                {
                                    "role": "user",
                                    "content": task_prompt,
                                }
                            )
                        elif response_content["status"] == "answer":
                            DRS_STAGE = 3
                            search_chunk = {
                                "choices": [{
                                    "delta": {
                                        "tool_content": {"title": f"⭐{await t('enter_answer_stage')}", "content": ""}
                                    }
                                }]
                            }
                            yield f"data: {json.dumps(search_chunk)}\n\n"
                            search_not_done = True
                            drs_msg = get_drs_stage(DRS_STAGE)
                            request.messages.append(
                                {
                                    "role": "assistant",
                                    "content": full_content,
                                    "reasoning_content": assistant_reasoning_content,
                                }
                            )
                            assistant_reasoning_content = ""  # This turn's thinking has been archived
                            full_content = "" 
                            request.messages.append(
                                {
                                    "role": "user",
                                    "content": drs_msg,
                                }
                            )
                logger.info(f"all msg: {request.messages}")
                yield "data: [DONE]\n\n"
                if settings.get('loveSettings', {}).get('enabled', False) and not request.is_sub_agent:
                    try:
                        from py.affection_system import extract_and_update_affection
                        # full_content is the AI's complete reply text for the current turn
                        await extract_and_update_affection(full_content)
                    except Exception as e:
                        print(f"Error parsing affinity tag: {e}")
                if m0 and not request.is_sub_agent:
                    print("Memory-update task submission started")
                    messages = f"用户说：{user_prompt}\n\n---\n\n你说：{full_content}"
                    infer = cur_memory.get('infer', False) or False
                    
                    def run_task():
                        import asyncio  # <- Import here!
                        import traceback
                        
                        async def add():
                            loop = asyncio.get_running_loop()
                            with ThreadPoolExecutor() as executor:
                                metadata = {
                                    "timetamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                                }
                                func = partial(m0.add, user_id=memoryId, metadata=metadata, infer=infer)
                                await loop.run_in_executor(executor, func, messages)
                                print("Memory update complete")
                        
                        try:
                            loop = asyncio.get_running_loop()
                            task = asyncio.create_task(add())
                            task.add_done_callback(
                                lambda t: print(f"Task exception: {t.exception()}") if t.exception() else None
                            )
                        except RuntimeError:
                            # No running event loop
                            asyncio.run(add())
                        except Exception as e:
                            print(f"run_task exception: {e}")
                            traceback.print_exc()
                    
                    import threading
                    thread = threading.Thread(target=run_task, daemon=True)
                    thread.start()
                    print("Memory-update task submitted to background thread")

                return
            except Exception as e:
                logger.error(f"{request.messages}")
                # Catch the exception and return structured error info
                error_chunk = {
                    "choices": [{
                        "delta": {
                            "tool_content": {
                                "title": "❎ Error", # Unified title
                                "content": str(e),   # Error details
                                "type": "error"      # Mark the type so the frontend can switch styles
                            }
                        }
                    }]
                }
                yield f"data: {json.dumps(error_chunk)}\n\n"
                yield "data: [DONE]\n\n"  # Ensure it ends properly
                return
        
        return StreamingResponse(
            stream_generator(user_prompt, DRS_STAGE, tools, images),
            media_type="text/event-stream",
            headers={
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            }
        )
    except Exception as e:
        logger.error(f"Error occurred: {e}")
        # If e.status_code exists, use it as the HTTP status code; otherwise use 500
        return JSONResponse(
            status_code=getattr(e, "status_code", 500),
            content={"error": str(e)},
        )

async def generate_complete_response(client,reasoner_client, request: ChatRequest, settings: dict,fastapi_base_url,enable_thinking,enable_deep_research,enable_web_search):
    from mem0 import Memory
    global mcp_client_list,HA_client,ChromeMCP_client,sql_client
    DRS_STAGE = 1 # 1: clarify-user-need stage, 2: tool-call stage, 3: result-generation stage
    if len(request.messages) > 2:
        DRS_STAGE = 2

        # =========================================================================
        # Phase 1: context compression (triggered only at the threshold; decides which messages to keep)
        # =========================================================================
        max_rounds = settings.get("max_rounds", 0)
        chat_messages = request.messages # chat_messages here includes the system messages
        
        if max_rounds > 0:

            # Sliding window: keep all system messages; for dialogue, keep only the most recent max_rounds rounds
            sys_msgs = [m for m in chat_messages if get_role(m) == "system"]
            dialog_msgs = [m for m in chat_messages if get_role(m) != "system"]

            window = max_rounds * 2  # 1 round = user + assistant
            if len(dialog_msgs) > window:
                recent = dialog_msgs[-window:]
                # Trim leading non-user messages so the window starts cleanly on a user turn
                first_user = next((i for i, m in enumerate(recent) if get_role(m) == "user"), 0)
                recent = recent[first_user:]
                chat_messages = sys_msgs + recent
                print(f"[Context] Sliding window -> {len(chat_messages)} msgs.")

        # ===== [Deprecated] Previous method: rule-based selective pruning =====
        # No AI judgment and no LLM call: it kept the first message, ALL user messages,
        # each turn's final assistant reply, and the most recent active window.
        # Kept here for reference. To revert, comment out the sliding-window block above
        # and uncomment this block.
        # if max_rounds > 0:
        #     sys_msgs = [m for m in chat_messages if get_role(m) == "system"]
        #     dialog_msgs = [m for m in chat_messages if get_role(m) != "system"]
        #     if len(dialog_msgs) > (max_rounds * 2 + 1):
        #         keep_indices = set()
        #         # 1. Always keep the first message (anchor user prompt)
        #         if len(dialog_msgs) > 0: keep_indices.add(0)
        #         # 2. Keep all user messages (user-first strategy)
        #         for i, m in enumerate(dialog_msgs):
        #             if get_role(m) == "user": keep_indices.add(i)
        #         # 3. Keep the last assistant message of each turn (final answer)
        #         for i in range(len(dialog_msgs)):
        #             if get_role(dialog_msgs[i]) == "assistant":
        #                 is_last = True
        #                 for j in range(i + 1, len(dialog_msgs)):
        #                     if get_role(dialog_msgs[j]) == "assistant":
        #                         is_last = False; break
        #                     if get_role(dialog_msgs[j]) == "user": break
        #                 if is_last: keep_indices.add(i)
        #         # 4. Keep the most recent active window (avoid cutting the current tool chain)
        #         tail_start = max(0, len(dialog_msgs) - (max_rounds * 2))
        #         for i in range(tail_start, len(dialog_msgs)):
        #             keep_indices.add(i)
        #         compressed_dialog = [dialog_msgs[i] for i in sorted(list(keep_indices))]
        #         chat_messages = sys_msgs + compressed_dialog
        #         print(f"[Context] Compressed to {len(chat_messages)} msgs.")

        final_messages = []
        pending_tool_call_ids = set()

        for msg in chat_messages:
            role = get_role(msg)
            
            if role == "tool":
                t_id = msg.get("tool_call_id") if isinstance(msg, dict) else getattr(msg, "tool_call_id", None)
                # Core check: if this tool message isn't in our pending-response ID list, discard it
                if t_id and t_id in pending_tool_call_ids:
                    final_messages.append(msg)
                    pending_tool_call_ids.remove(t_id) # Matched successfully; remove it
                else:
                    print(f"[Sanitizer] Discarding orphan tool message: {t_id}")
                    continue
            
            elif role == "assistant":
                tcs = get_tcs(msg)
                if tcs:
                    # This is a message that initiates a tool call
                    # Store it for now and record the IDs it expects
                    current_tcs_ids = {tc.get("id") if isinstance(tc, dict) else tc.id for tc in tcs}
                    final_messages.append(msg)
                    for tid in current_tcs_ids: pending_tool_call_ids.add(tid)
                else:
                    # Ordinary assistant reply
                    final_messages.append(msg)
            
            else:
                # user or system messages pass through directly
                final_messages.append(msg)

        # Final reverse check: if the last message is an assistant with tool_calls but no tool messages follow
        # We need to remove these tool_calls markers, or remove the message entirely (depending on requirements)
        # Here we keep the message text but clear tool_calls to prevent an API error
        while final_messages:
            last_msg = final_messages[-1]
            tcs = get_tcs(last_msg)
            # If the last assistant message made a call but we have no following messages to fill it
            if tcs and any( ( (tc.get("id") if isinstance(tc, dict) else tc.id) in pending_tool_call_ids ) for tc in tcs ):
                # If the message has text content, erase tool_calls and keep the text
                # If there's no text, just pop the whole message
                content = last_msg.get("content") if isinstance(last_msg, dict) else getattr(last_msg, "content", "")
                if content:
                    if isinstance(last_msg, dict):
                        last_msg["tool_calls"] = None
                    else:
                        setattr(last_msg, "tool_calls", None)
                    print("[Sanitizer] Erasing unclosed trailing tool_calls")
                    break # Done processing
                else:
                    final_messages.pop()
                    print("[Sanitizer] Popping trailing empty orphan tool_call initiating message")
            else:
                break

        request.messages = final_messages
        request.messages = ensure_thinking_fields(request.messages)
        # =========================================================================

    from py.load_files import get_files_content,file_tool,image_tool
    from py.web_search import (
        DDGsearch, 
        searxng, 
        Tavily_search,
        Bing_search,
        Google_search,
        Brave_search,
        Exa_search,
        Serper_search,
        bochaai_search,
        duckduckgo_tool, 
        searxng_tool, 
        tavily_tool, 
        bing_tool,
        google_tool,
        brave_tool,
        exa_tool,
        serper_tool,
        bochaai_tool,
        jina_crawler_tool, 
        simple_fetch_tool,
        Crawl4Ai_tool,
        firecrawl_tool,
        markdown_new_tool,
    )
    from py.know_base import kb_tool,query_knowledge_base,rerank_knowledge_base
    from py.agent_tool import get_agent_tool
    from py.a2a_tool import get_a2a_tool
    from py.llm_tool import get_llm_tool
    from py.pollinations import pollinations_image_tool,openai_image_tool,openai_chat_image_tool
    from py.code_interpreter import e2b_code_tool,local_run_code_tool
    from py.utility_tools import time_tool
    from py.utility_tools import (
        time_tool, 
        weather_tool,
        location_tool,
        timer_weather_tool,
        wikipedia_summary_tool,
        wikipedia_section_tool,
        arxiv_tool
    ) 
    from py.autoBehavior import auto_behavior_tool
    from py.cli_tool import get_tools_for_mode,get_local_tools_for_mode
    from py.cdp_tool import all_cdp_tools
    from py.random_topic import random_topics_tools
    from py.computer_use_tool import computer_use_tools,mouse_use_tools,keyboard_use_tools,desktopVision_use_tools
    
    from py.mode_change import mode_change_tool
    from py.acpx_tools import acp_agent_tool
    m0 = None
    if settings["memorySettings"]["is_memory"] and settings["memorySettings"]["selectedMemory"] and settings["memorySettings"]["selectedMemory"] != "":
        memoryId = settings["memorySettings"]["selectedMemory"]
        cur_memory = None
        for memory in settings["memories"]:
            if memory["id"] == memoryId:
                cur_memory = memory
                break
        if cur_memory and cur_memory["providerId"]:
            print("Long-term memory enabled")
            config={
                "embedder": {
                    "provider": 'openai',
                    "config": {
                        "model": cur_memory['model'],
                        "api_key": cur_memory['api_key'],
                        "openai_base_url":cur_memory["base_url"],
                        "embedding_dims":cur_memory.get("embedding_dims", 1024)
                    },
                },
                "llm": {
                    "provider": 'openai',
                    "config": {
                        "model": settings['model'],
                        "api_key": settings['api_key'],
                        "openai_base_url":settings["base_url"]
                    }
                },
                "vector_store": {
                    "provider": "faiss",
                    "config": {
                        "collection_name": "agent-party",
                        "path": os.path.join(MEMORY_CACHE_DIR,memoryId),
                        "distance_strategy": "euclidean",
                        "embedding_model_dims": cur_memory.get("embedding_dims", 1024)
                    }
                }
            }
            m0 = Memory.from_config(config)
    images = await images_in_messages(request.messages,fastapi_base_url)
    request.messages = await message_without_images(request.messages)
    open_tag = "<think>"
    close_tag = "</think>"
    tools = request.tools or []
    tools = request.tools or []
    extra = {}
    reasoner_extra = {}
    if mcp_client_list:
        for server_name, mcp_client in mcp_client_list.items():
            if server_name in settings['mcpServers']:
                if 'disabled' not in settings['mcpServers'][server_name]:
                    settings['mcpServers'][server_name]['disabled'] = False
                if settings['mcpServers'][server_name]['disabled'] == False and settings['mcpServers'][server_name]['processingStatus'] == 'ready':
                    disable_tools = []
                    for tool in settings['mcpServers'][server_name]["tools"]: 
                        if tool.get("enabled", True) == False:
                            disable_tools.append(tool["name"])
                    function = await mcp_client.get_openai_functions(disable_tools=disable_tools)
                    if function:
                        tools.extend(function)
    get_llm_tool_fuction = await get_llm_tool(settings)
    if get_llm_tool_fuction:
        tools.append(get_llm_tool_fuction)
    get_agent_tool_fuction = await get_agent_tool(settings)
    if get_agent_tool_fuction:
        tools.append(get_agent_tool_fuction)
    get_a2a_tool_fuction = await get_a2a_tool(settings)
    if get_a2a_tool_fuction:
        tools.append(get_a2a_tool_fuction)
    if settings["HASettings"]["enabled"]:
        ha_tool = await HA_client.get_openai_functions(disable_tools=[])
        if ha_tool:
            tools.extend(ha_tool)
    if settings['chromeMCPSettings']['enabled'] and settings['chromeMCPSettings']['type']=='external':
        chromeMCP_tool = await ChromeMCP_client.get_openai_functions(disable_tools=[])
        if chromeMCP_tool:
            tools.extend(chromeMCP_tool)
    if settings['chromeMCPSettings']['enabled'] and settings['chromeMCPSettings']['type']=='internal':
        tools.extend(all_cdp_tools)
    if settings['sqlSettings']['enabled']:
        sql_tool = await sql_client.get_openai_functions(disable_tools=[])
        if sql_tool:
            tools.extend(sql_tool)
    if settings['CLISettings']['enabled']:
        if settings['CLISettings']['engine'] == 'ds':
            tools.extend(get_tools_for_mode('yolo'))
        elif settings['CLISettings']['engine'] == 'local':
            tools.extend(get_local_tools_for_mode('yolo'))
        elif settings['CLISettings']['engine'] == 'acp':
            tools.append(acp_agent_tool)
    if  settings['CLISettings']['mode_change']:
        tools.append(mode_change_tool)
    if settings['visionControlSettings']['enabled']:
        tools.extend(computer_use_tools)
        if settings['visionControlSettings']['mouse']:
            tools.extend(mouse_use_tools)
        if settings['visionControlSettings']['keyboard']:
            tools.extend(keyboard_use_tools)
        if not settings['visionControlSettings']['desktopVision']:
            tools.extend(desktopVision_use_tools)
    if settings["tools"]["randomTopic"]['enabled']:
        tools.extend(random_topics_tools)
    if settings['tools']['time']['enabled'] and settings['tools']['time']['triggerMode'] == 'afterThinking':
        tools.append(time_tool)
    if settings["tools"]["weather"]['enabled']:
        tools.append(weather_tool)
        tools.append(location_tool)
        tools.append(timer_weather_tool)
    if settings["tools"]["wikipedia"]['enabled']:
        tools.append(wikipedia_summary_tool)
        tools.append(wikipedia_section_tool)
    if settings["tools"]["arxiv"]['enabled']:
        tools.append(arxiv_tool)
    if settings['text2imgSettings']['enabled']:
        if settings['text2imgSettings']['engine'] == 'pollinations':
            tools.append(pollinations_image_tool)
        elif settings['text2imgSettings']['engine'] == 'openai':
            tools.append(openai_image_tool)
        elif settings['text2imgSettings']['engine'] == 'openaiChat':
            tools.append(openai_chat_image_tool)
    if settings['tools']['getFile']['enabled']:
        tools.append(file_tool)
        tools.append(image_tool)
    if settings['tools']['autoBehavior']['enabled'] and request.messages[-1]['role'] == 'user':
        tools.append(auto_behavior_tool)
    if settings["codeSettings"]['enabled']:
        if settings["codeSettings"]["engine"] == "e2b":
            tools.append(e2b_code_tool)
        elif settings["codeSettings"]["engine"] == "sandbox":
            tools.append(local_run_code_tool)
    if settings["custom_http"]:
        for custom_http in settings["custom_http"]:
            if custom_http["enabled"]:
                if custom_http['body'] == "":
                    custom_http['body'] = "{}"
                custom_http_tool = {
                    "type": "function",
                    "function": {
                        "name": f"custom_http_{custom_http['name']}",
                        "description": f"{custom_http['description']}",
                        "parameters": json.loads(custom_http['body']),
                    },
                }
                tools.append(custom_http_tool)
    if settings["workflows"]:
        for workflow in settings["workflows"]:
            if workflow["enabled"]:
                comfyui_properties = {}
                comfyui_required = []
                if workflow["text_input"] is not None:
                    comfyui_properties["text_input"] = {
                        "description": "The first text input: the prompt to enter, used to generate an image or video. Unless otherwise noted, default to English",
                        "type": "string"
                    }
                    comfyui_required.append("text_input")
                if workflow["text_input_2"] is not None:
                    comfyui_properties["text_input_2"] = {
                        "description": "The second text input: the prompt to enter, used to generate an image or video. Unless otherwise noted, default to English",
                        "type": "string"
                    }
                    comfyui_required.append("text_input_2")
                if workflow["image_input"] is not None:
                    comfyui_properties["image_input"] = {
                        "description": "The first image input: the image to enter, must be an image URL, either an external link or an internal server URL, e.g.: https://www.example.com/xxx.png  or  http://127.0.0.1:3456/xxx.jpg",
                        "type": "string"
                    }
                    comfyui_required.append("image_input")
                if workflow["image_input_2"] is not None:
                    comfyui_properties["image_input_2"] = {
                        "description": "The second image input: the image to enter, must be an image URL, either an external link or an internal server URL, e.g.: https://www.example.com/xxx.png  or  http://127.0.0.1:3456/xxx.jpg",
                        "type": "string"
                    }
                    comfyui_required.append("image_input_2")
                comfyui_parameters = {
                    "type": "object",
                    "properties": comfyui_properties,
                    "required": comfyui_required
                }
                comfyui_tool = {
                    "type": "function",
                    "function": {
                        "name": f"comfyui_{workflow['unique_filename']}",
                        "description": f"{workflow['description']}+\nIf entering or modifying an image prompt, use English as much as possible.\nFor returned image results, put the image URL into markdown like ![image]() so the user can see the image. For a video, put the video URL into the src of <video controls> <source src=''></video> so the user can see the video. If there are multiple results, separate the images or videos with newlines so the user can see all of them.",
                        "parameters": comfyui_parameters,
                    },
                }
                tools.append(comfyui_tool)
    search_not_done = False
    search_task = ""
    try:
        model = settings['model']
        extra_params = settings['extra_params']
        # Remove items from the extra_params list whose "name" has no non-whitespace characters
        if extra_params:
            for extra_param in extra_params:
                if not extra_param['name'].strip():
                    extra_params.remove(extra_param)
            # Convert the list to a dict
            extra_params = process_extra_params(extra_params)
        else:
            extra_params = {}
        if request.fileLinks:
            # Asynchronously get file content
            files_content = await get_files_content(request.fileLinks)
            system_message = f"\n\nRelevant file content: {files_content}"
            
            # Fix the string-concatenation bug
            content_append(request.messages, 'system', system_message)
        kb_list = []
        user_prompt = request.messages[-1].get('content') or ""

        # Global memory (always injected, regardless of character/memory toggle)
        global_memory = settings.get("memorySettings", {}).get("globalMemory", "")
        if global_memory and global_memory.strip() and not request.is_sub_agent:
            gm = global_memory.replace("{{user}}", settings["memorySettings"].get("userName", "") or "")
            content_append(request.messages, 'system', "\n\n" + gm + "\n\n")

        if settings["memorySettings"]["is_memory"] and settings["memorySettings"]["selectedMemory"] and settings["memorySettings"]["selectedMemory"] != "" and not request.is_sub_agent:
            # Username hint (fixed)
            if settings["memorySettings"]["userName"]:
                print("Add username: \n\n" + settings["memorySettings"]["userName"] + "\n\nEnd username\n\n")
                content_append(request.messages, 'system', "The default username talking with you is:\n\n" + settings["memorySettings"]["userName"] + "\n\nNote! Unless a user message states it was sent by another user, treat it as sent by the default user\n\n")

            # Fixed persona: character description, personality, dialogue example, custom systemPrompt, generic systemPrompt
            if cur_memory["description"]:
                if settings["memorySettings"]["userName"]:
                    cur_memory["description"] = cur_memory["description"].replace("{{user}}", settings["memorySettings"]["userName"])
                cur_memory["description"] = cur_memory["description"].replace("{{char}}", cur_memory["name"])
                print("Add character setting: \n\n" + cur_memory["description"] + "\n\nEnd character setting\n\n")
                content_append(request.messages, 'system', "Character setting:\n\n" + cur_memory["description"] + "\n\nEnd of character setting\n\n")

            if cur_memory["personality"]:
                if settings["memorySettings"]["userName"]:
                    cur_memory["personality"] = cur_memory["personality"].replace("{{user}}", settings["memorySettings"]["userName"])
                cur_memory["personality"] = cur_memory["personality"].replace("{{char}}", cur_memory["name"])
                print("Add personality setting: \n\n" + cur_memory["personality"] + "\n\nEnd personality setting\n\n")
                content_append(request.messages, 'system', "Personality setting:\n\n" + cur_memory["personality"] + "\n\nEnd of personality setting\n\n")

            if cur_memory['mesExample']:
                if settings["memorySettings"]["userName"]:
                    cur_memory['mesExample'] = cur_memory['mesExample'].replace("{{user}}", settings["memorySettings"]["userName"])
                cur_memory['mesExample'] = cur_memory['mesExample'].replace("{{char}}", cur_memory["name"])
                print("Add dialogue example: \n\n" + cur_memory['mesExample'] + "\n\nEnd dialogue example\n\n")
                content_append(request.messages, 'system', "Dialogue example:\n\n" + cur_memory['mesExample'] + "\n\nEnd of dialogue example\n\n")

            if cur_memory["systemPrompt"]:
                if settings["memorySettings"]["userName"]:
                    cur_memory["systemPrompt"] = cur_memory["systemPrompt"].replace("{{user}}", settings["memorySettings"]["userName"])
                cur_memory["systemPrompt"] = cur_memory["systemPrompt"].replace("{{char}}", cur_memory["name"])
                content_append(request.messages, 'system', "\n\n" + cur_memory["systemPrompt"] + "\n\n")

            if settings["memorySettings"]["genericSystemPrompt"]:
                if settings["memorySettings"]["userName"]:
                    settings["memorySettings"]["genericSystemPrompt"] = settings["memorySettings"]["genericSystemPrompt"].replace("{{user}}", settings["memorySettings"]["userName"])
                settings["memorySettings"]["genericSystemPrompt"] = settings["memorySettings"]["genericSystemPrompt"].replace("{{char}}", cur_memory["name"])
                content_append(request.messages, 'system', "\n\n" + settings["memorySettings"]["genericSystemPrompt"] + "\n\n")

        # ========== Dynamic-context collection (all appended to the end of the user message) ==========
        dynamic_user_context = ""

        # World-book matching (dynamic, triggered by the current turn's input/reply)
        lore_content = ""
        assistant_reply = ""
        for i in range(len(request.messages)-1, -1, -1):
            if request.messages[i]['role'] == 'assistant':
                assistant_reply = request.messages[i]['content']
                break

        if settings["memorySettings"]["is_memory"] and settings["memorySettings"]["selectedMemory"] and not request.is_sub_agent:
            if cur_memory.get("characterBook"):
                for lore in cur_memory["characterBook"]:
                    lore_keys = [key for key in lore.get("keysRaw", "").split("\n") if key != ""]
                    if lore_keys and any(key in user_prompt or key in assistant_reply for key in lore_keys):
                        lore_content += lore['content'] + "\n\n"

        if lore_content:
            if settings["memorySettings"]["userName"]:
                lore_content = lore_content.replace("{{user}}", settings["memorySettings"]["userName"])
            lore_content = lore_content.replace("{{char}}", cur_memory["name"])
            print("Add worldview setting (dynamic, injected into user message): \n\n" + lore_content + "\n\nEnd worldview setting\n\n")
            dynamic_user_context += f"\n\n[世界设定]\n{lore_content}"

        # Memory retrieval (dynamic, based on the current user input)
        if m0 and not request.is_sub_agent:
            memoryLimit = settings["memorySettings"]["memoryLimit"]
            try:
                relevant_memories = await asyncio.to_thread(
                    m0.search,
                    query=user_prompt,
                    user_id=settings["memorySettings"]["selectedMemory"],
                    limit=memoryLimit
                )
                relevant_memories = json.dumps(relevant_memories, ensure_ascii=False)
            except Exception as e:
                print("m0.search error:", e)
                relevant_memories = ""
            if relevant_memories:
                print("Add relevant memory (dynamic, injected into user message): \n\n" + relevant_memories + "\n\nEnd relevant\n\n")
                dynamic_user_context += f"\n\n[相关记忆]\n{relevant_memories}"

        # Append the dynamic content to the end of the last user message
        if dynamic_user_context:
            if request.messages and request.messages[-1]['role'] == 'user':
                request.messages[-1]['content'] += dynamic_user_context
        
        if settings["knowledgeBases"]:
            for kb in settings["knowledgeBases"]:
                if kb["enabled"] and kb["processingStatus"] == "completed":
                    kb_list.append({"kb_id":kb["id"],"name": kb["name"],"introduction":kb["introduction"]})
        if settings["KBSettings"]["when"] == "before_thinking" or settings["KBSettings"]["when"] == "both":
            if kb_list:
                all_kb_content = []
                # Use the query_knowledge_base function to query all knowledge bases in kb_list
                for kb in kb_list:
                    kb_content = await query_knowledge_base(kb["kb_id"],user_prompt)
                    all_kb_content.extend(kb_content)
                    if settings["KBSettings"]["is_rerank"]:
                        all_kb_content = await rerank_knowledge_base(user_prompt,all_kb_content)
                if all_kb_content:
                    kb_message = f"\n\nKnowledge base content you can reference: {all_kb_content}"
                    content_append(request.messages, 'user',  f"{kb_message}\n\nUser: {user_prompt}")
        if settings["KBSettings"]["when"] == "after_thinking" or settings["KBSettings"]["when"] == "both":
            if kb_list:
                kb_list_message = f"\n\nList of knowledge bases you can call: {json.dumps(kb_list, ensure_ascii=False)}"
                content_append(request.messages, 'system', kb_list_message)
        else:
            kb_list = []
        request = await tools_change_messages(request, settings)
        # If the system message is empty or only whitespace, set it to "you are a helpful assistant."
        if request.messages[0]['role'] == 'system' and not request.messages[0]['content'].strip():
            request.messages[0]['content'] = "you are a helpful assistant."
        chat_vendor = 'OpenAI'
        reasoner_vendor = 'OpenAI'
        for modelProvider in settings['modelProviders']: 
            if modelProvider['id'] == settings['selectedProvider']:
                chat_vendor = modelProvider['vendor']
                break
        for modelProvider in settings['modelProviders']: 
            if modelProvider['id'] == settings['reasoner']['selectedProvider']:
                reasoner_vendor = modelProvider['vendor']
                break
        if chat_vendor == 'Dify':
            try:
                if len(request.messages) >= 3:
                    if request.messages[2]['role'] == 'user':
                        if request.messages[1]['role'] == 'assistant':
                            request.messages[2]['content'] = "你上一次的发言：\n" +request.messages[0]['content'] + "\n你上一次的发言结束\n\n用户：" + request.messages[2]['content']
                        if request.messages[0]['role'] == 'system':
                            request.messages[2]['content'] = "系统提示：\n" +request.messages[0]['content'] + "\n系统提示结束\n\n" + request.messages[2]['content']
                elif len(request.messages) >= 2:
                    if request.messages[1]['role'] == 'user':
                        if request.messages[0]['role'] == 'system':
                            request.messages[1]['content'] = "系统提示：\n" +request.messages[0]['content'] + "\n系统提示结束\n\n用户：" + request.messages[1]['content']
            except Exception as e:
                print("Dify error:",e)
        if settings['webSearch']['enabled'] or enable_web_search:
            if settings['webSearch']['when'] == 'before_thinking' or settings['webSearch']['when'] == 'both':
                if settings['webSearch']['engine'] == 'duckduckgo':
                    results = await DDGsearch(user_prompt)
                elif settings['webSearch']['engine'] == 'searxng':
                    results = await searxng(user_prompt)
                elif settings['webSearch']['engine'] == 'tavily':
                    results = await Tavily_search(user_prompt)
                elif settings['webSearch']['engine'] == 'bing':
                    results = await Bing_search(user_prompt)
                elif settings['webSearch']['engine'] == 'google':
                    results = await Google_search(user_prompt)
                elif settings['webSearch']['engine'] == 'brave':
                    results = await Brave_search(user_prompt)
                elif settings['webSearch']['engine'] == 'exa':
                    results = await Exa_search(user_prompt)
                elif settings['webSearch']['engine'] == 'serper':
                    results = await Serper_search(user_prompt)
                elif settings['webSearch']['engine'] == 'bochaai':
                    results = await bochaai_search(user_prompt)
                if results:
                    content_append(request.messages, 'user',  f"\n\nWeb search results: {results}")
            if settings['webSearch']['when'] == 'after_thinking' or settings['webSearch']['when'] == 'both':
                if settings['webSearch']['engine'] == 'duckduckgo':
                    tools.append(duckduckgo_tool)
                elif settings['webSearch']['engine'] == 'searxng':
                    tools.append(searxng_tool)
                elif settings['webSearch']['engine'] == 'tavily':
                    tools.append(tavily_tool)
                elif settings['webSearch']['engine'] == 'bing':
                    tools.append(bing_tool)
                elif settings['webSearch']['engine'] == 'google':
                    tools.append(google_tool)
                elif settings['webSearch']['engine'] == 'brave':
                    tools.append(brave_tool)
                elif settings['webSearch']['engine'] == 'exa':
                    tools.append(exa_tool)
                elif settings['webSearch']['crawler'] == 'serper':
                    tools.append(serper_tool)
                elif settings['webSearch']['crawler'] == 'bochaai':
                    tools.append(bochaai_tool)

                if settings['webSearch']['crawler'] == 'jina':
                    tools.append(jina_crawler_tool)
                elif settings['webSearch']['crawler'] == 'crawl4ai':
                    tools.append(Crawl4Ai_tool)
                elif settings['webSearch']['crawler'] == 'firecrawl':
                    tools.append(firecrawl_tool)
                elif settings['webSearch']['crawler'] == 'simpleRequest':
                    tools.append(simple_fetch_tool)
                elif settings['webSearch']['crawler'] == 'mdnew':
                    tools.append(markdown_new_tool)
        if kb_list:
            tools.append(kb_tool)
        if settings['tools']['deepsearch']['enabled'] or enable_deep_research: 
            deepsearch_messages = copy.deepcopy(request.messages)
            content_append(deepsearch_messages, 'user',  "\n\nBreak the question the user asked, or the current task they gave, into multiple steps. Summarize each step in one short sentence; you don't need to answer or execute them, just return the summary, but do not omit the details of the question or task. If the user's input is just small talk or contains no task or question, simply repeat the user's input verbatim. For a very simple question, you may give just one step. In general, it should be broken into multiple steps.")
            response = await client.chat.completions.create(
                model=model,
                messages=deepsearch_messages,
                temperature=0.5, 
                extra_body = extra_params, # Other parameters
            )
            user_prompt = response.choices[0].message.content
            content_append(request.messages, 'user',  f"\n\nIf the user did not ask a question or give a task, just chat. If the user did ask a question or give a task but the description is unclear or you need to understand their real needs better, you may hold off on completing the task and instead analyze which requirements the user needs to clarify further.")
        if settings['reasoner']['enabled'] or enable_thinking:
            reasoner_messages = copy.deepcopy(request.messages)
            if settings['tools']['deepsearch']['enabled'] or enable_deep_research: 
                drs_msg = get_drs_stage(DRS_STAGE)
                if drs_msg:
                    content_append(reasoner_messages, 'user',  f"\n\n{drs_msg}\n\n")
                content_append(reasoner_messages, 'user',  f"\n\nSteps you can reference: {user_prompt}\n\n")
            if tools:
                content_append(reasoner_messages, 'system',  f"Available tools: {json.dumps(tools)}")
            for modelProvider in settings['modelProviders']: 
                if modelProvider['id'] == settings['reasoner']['selectedProvider']:
                    vendor = modelProvider['vendor']
                    break
            msg = await images_add_in_messages(reasoner_messages, images,settings)   
            if chat_vendor == 'OpenAI':
                extra['max_completion_tokens'] = request.max_tokens or settings['max_tokens']
            else:
                extra['max_tokens'] = request.max_tokens or settings['max_tokens']
            if reasoner_vendor == 'OpenAI':
                reasoner_extra['max_completion_tokens'] = settings['reasoner']['max_tokens']
            else:
                reasoner_extra['max_tokens'] = settings['reasoner']['max_tokens']
            if request.reasoning_effort or settings['reasoning_effort']:
                extra['reasoning_effort'] = request.reasoning_effort or settings['reasoning_effort']
            if settings['reasoner']['reasoning_effort'] is not None:
                reasoner_extra['reasoning_effort'] = settings['reasoner']['reasoning_effort'] 
            if vendor == 'Ollama':
                reasoner_response = await reasoner_client.chat.completions.create(
                    model=settings['reasoner']['model'],
                    messages=msg,
                    stream=False,
                    temperature=settings['reasoner']['temperature'],
                    **reasoner_extra
                )
                reasoning_buffer = reasoner_response.model_dump()['choices'][0]['message']['reasoning_content']
                if reasoning_buffer:
                    content_prepend(request.messages, 'assistant', reasoning_buffer) # Reasoning process for reference
                else:
                    reasoning_buffer = reasoner_response.model_dump()['choices'][0]['message']['reasoning']
                    if reasoning_buffer:
                        content_prepend(request.messages, 'assistant', reasoning_buffer) # Reasoning process for reference
                    else:
                        # Extract the thinking content from the reasoning result
                        reasoning_content = reasoner_response.model_dump()['choices'][0]['message']['content']
                        # Content between open_tag and close_tag
                        start_index = reasoning_content.find(open_tag) + len(open_tag)
                        end_index = reasoning_content.find(close_tag)
                        if start_index != -1 and end_index != -1:
                            reasoning_content = reasoning_content[start_index:end_index]
                        else:
                            reasoning_content = ""
                        content_prepend(request.messages, 'assistant', reasoning_content) # Reasoning process for reference
            else:
                reasoner_response = await reasoner_client.chat.completions.create(
                    model=settings['reasoner']['model'],
                    messages=msg,
                    stream=False,
                    stop=settings['reasoner']['stop_words'],
                    temperature=settings['reasoner']['temperature'],
                    **reasoner_extra
                )
                reasoning_buffer = reasoner_response.model_dump()['choices'][0]['message']['reasoning_content']
                if reasoning_buffer:
                    content_prepend(request.messages, 'assistant', reasoning_buffer) # Reasoning process for reference
                else:
                    reasoning_buffer = reasoner_response.model_dump()['choices'][0]['message']['reasoning']
                    if reasoning_buffer:
                        content_prepend(request.messages, 'assistant', reasoning_buffer) # Reasoning process for reference
                    else:
                        reasoning_buffer = ""
                        content_prepend(request.messages, 'assistant', reasoning_buffer) # Reasoning process for reference
        if settings['tools']['deepsearch']['enabled'] or enable_deep_research: 
            content_append(request.messages, 'user',  f"\n\nSteps you can reference: {user_prompt}\n\n")
            drs_msg = get_drs_stage(DRS_STAGE)
            if drs_msg:
                content_append(request.messages, 'user',  f"\n\n{drs_msg}\n\n")
        msg = await images_add_in_messages(request.messages, images,settings)
        if request.top_p != 1 or settings['top_p'] != 1:
            extra['top_p'] = request.top_p or settings['top_p']
        if tools:
            response = await client.chat.completions.create(
                model=model,
                messages=msg,  # Add image info to the message
                temperature=request.temperature or settings['temperature'],
                tools=tools,
                stream=False,
                extra_body = extra_params, # Other parameters
                **extra
            )
        else:
            response = await client.chat.completions.create(
                model=model,
                messages=msg,  # Add image info to the message
                temperature=request.temperature or settings['temperature'],
                stream=False,
                extra_body = extra_params, # Other parameters
                **extra
            )
        if response.choices[0].message.tool_calls:
            pass
        elif settings['tools']['deepsearch']['enabled'] or enable_deep_research: 
            search_prompt = get_drs_stage_system_message(DRS_STAGE,user_prompt,response.choices[0].message.content)
            research_response = await client.chat.completions.create(
                model=model,
                messages=[
                    {
                    "role": "user",
                    "content": search_prompt,
                    }
                ],
                temperature=0.5,
                extra_body = extra_params, # Other parameters
            )
            response_content = research_response.choices[0].message.content
            if response_content is None:
                response_content = ""

            # Use re to extract the json string wrapped in ```json ... ```
            if "```json" in response_content:
                try:
                    response_content = re.search(r'```json(.*?)```', response_content, re.DOTALL).group(1)
                except:
                    # Use re to extract the content after ```json
                    response_content = re.search(r'```json(.*?)', response_content, re.DOTALL).group(1)
            response_content = json.loads(response_content)
            if response_content["status"] == "done":
                search_not_done = False
            elif response_content["status"] == "not_done":
                search_not_done = True
                search_task = response_content["unfinished_task"]
                task_prompt = f"请继续完成初始任务中未完成的任务：\n\n{search_task}\n\n初始任务：{user_prompt}\n\n最后，请给出完整的初始任务的最终结果。"
                request.messages.append(
                    {
                        "role": "assistant",
                        "content": research_response.choices[0].message.content,
                        "reasoning_content": "",
                    }
                )
                request.messages.append(
                    {
                        "role": "user",
                        "content": task_prompt,
                    }
                )
            elif response_content["status"] == "need_more_info":
                DRS_STAGE = 2
                search_not_done = False
            elif response_content["status"] == "need_work":
                DRS_STAGE = 2
                search_not_done = True
                drs_msg = get_drs_stage(DRS_STAGE)
                request.messages.append(
                    {
                        "role": "assistant",
                        "content": research_response.choices[0].message.content,
                        "reasoning_content": "",
                    }
                )
                request.messages.append(
                    {
                        "role": "user",
                        "content": drs_msg,
                    }
                )
            elif response_content["status"] == "need_more_work":
                DRS_STAGE = 2
                search_not_done = True
                search_task = response_content["unfinished_task"]
                task_prompt = f"请继续查询如下信息：\n\n{search_task}\n\n初始任务：{user_prompt}\n\n"
                request.messages.append(
                    {
                        "role": "assistant",
                        "content": research_response.choices[0].message.content,
                        "reasoning_content": "",
                    }
                )
                request.messages.append(
                    {
                        "role": "user",
                        "content": task_prompt,
                    }
                )
            elif response_content["status"] == "answer":
                DRS_STAGE = 3
                search_not_done = True
                drs_msg = get_drs_stage(DRS_STAGE)
                request.messages.append(
                    {
                        "role": "assistant",
                        "content": research_response.choices[0].message.content,
                        "reasoning_content": "",
                    }
                )
                request.messages.append(
                    {
                        "role": "user",
                        "content": drs_msg,
                    }
                )
        reasoner_messages = copy.deepcopy(request.messages)
        while response.choices[0].message.tool_calls or search_not_done:
            if response.choices[0].message.tool_calls:
                assistant_message = response.choices[0].message
                response_content = assistant_message.tool_calls[0].function
                print(response_content.name)
                modified_data = '[' + response_content.arguments.replace('}{', '},{') + ']'
                # Use json.loads to parse the modified string into a list
                data_list = json.loads(modified_data)
                # Store the processing result
                results = []
                for data in data_list:
                    result = await dispatch_tool(response_content.name, data,settings) # Add the result to the results list
                    if isinstance(results, AsyncIterator):
                        buffer = []
                        async for chunk in results:
                            buffer.append(chunk)
                        results = "".join(buffer)
                    if result is not None:
                        # Add the result to the results list
                        results.append(json.dumps(result))
                # Concatenate all results into one continuous string
                combined_results = ''.join(results)
                if combined_results:
                    results = combined_results
                else:
                    results = None
                if results is None:
                    break
                if response_content.name in ["query_knowledge_base"]:
                    if settings["KBSettings"]["is_rerank"]:
                        results = await rerank_knowledge_base(user_prompt,results)
                    results = json.dumps(results, ensure_ascii=False, indent=4)
                request.messages.append(
                    {
                        "tool_calls": [
                            {
                                "id": assistant_message.tool_calls[0].id,
                                "function": {
                                    "arguments": response_content.arguments,
                                    "name": response_content.name,
                                },
                                "type": assistant_message.tool_calls[0].type,
                            }
                        ],
                        "role": "assistant",
                        "content": "",
                        "reasoning_content": "",
                    }
                )
                request.messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": assistant_message.tool_calls[0].id,
                        "name": response_content.name,
                        "content": str(results),
                    }
                )
            if settings['webSearch']['when'] == 'after_thinking' or settings['webSearch']['when'] == 'both':
                content_append(request.messages, 'user',  f"\nRegarding the web search results: if the searched information is not enough to answer the question, you may use web search again to look up further necessary information not yet provided. If it is already enough to answer, just answer the question directly.")
            reasoner_messages.append(
                {
                    "role": "assistant",
                    "content": str(response_content),
                    "reasoning_content": "",
                }
            )
            reasoner_messages.append(
                {
                    "role": "user",
                    "content": f"{response_content.name}工具结果："+str(results),
                }
            )
            if settings['reasoner']['enabled'] or enable_thinking:
                if tools:
                    content_append(reasoner_messages, 'system',  f"Available tools: {json.dumps(tools)}")
                for modelProvider in settings['modelProviders']: 
                    if modelProvider['id'] == settings['reasoner']['selectedProvider']:
                        vendor = modelProvider['vendor']
                        break
                msg = await images_add_in_messages(reasoner_messages, images,settings)
                if vendor == 'Ollama':
                    reasoner_response = await reasoner_client.chat.completions.create(
                        model=settings['reasoner']['model'],
                        messages=msg,
                        stream=False,
                        temperature=settings['reasoner']['temperature'],
                        **reasoner_extra
                    )
                    # Extract the thinking content from the reasoning result
                    reasoning_content = reasoner_response.model_dump()['choices'][0]['message']['content']
                    # Content between open_tag and close_tag
                    start_index = reasoning_content.find(open_tag) + len(open_tag)
                    end_index = reasoning_content.find(close_tag)
                    if start_index != -1 and end_index != -1:
                        reasoning_content = reasoning_content[start_index:end_index]
                    else:
                        reasoning_content = ""
                    content_prepend(request.messages, 'assistant', reasoning_content) # Reasoning process for reference
                else:
                    reasoner_response = await reasoner_client.chat.completions.create(
                        model=settings['reasoner']['model'],
                        messages=msg,
                        stream=False,
                        stop=settings['reasoner']['stop_words'],
                        temperature=settings['reasoner']['temperature'],
                        **reasoner_extra
                    )
                    content_prepend(request.messages, 'assistant', reasoner_response.model_dump()['choices'][0]['message']['reasoning_content']) # Reasoning process for reference
            msg = await images_add_in_messages(request.messages, images,settings)
            if request.top_p != 1 or settings['top_p'] != 1:
                extra['top_p'] = request.top_p or settings['top_p']
            if tools:
                response = await client.chat.completions.create(
                    model=model,
                    messages=msg,  # Add image info to the message
                    temperature=request.temperature or settings['temperature'],
                    tools=tools,
                    stream=False,
                    extra_body = extra_params, # Other parameters
                    **extra
                )
            else:
                response = await client.chat.completions.create(
                    model=model,
                    messages=msg,  # Add image info to the message
                    temperature=request.temperature or settings['temperature'],
                    stream=False,
                    extra_body = extra_params, # Other parameters
                    **extra
                )
            if response.choices[0].message.tool_calls:
                pass
            elif settings['tools']['deepsearch']['enabled'] or enable_deep_research: 
                search_prompt = get_drs_stage_system_message(DRS_STAGE,user_prompt,response.choices[0].message.content)
                research_response = await client.chat.completions.create(
                    model=model,
                    messages=[
                        {
                        "role": "user",
                        "content": search_prompt,
                        }
                    ],
                    temperature=0.5,
                    extra_body = extra_params, # Other parameters
                )
                response_content = research_response.choices[0].message.content
                # Use re to extract the json string wrapped in ```json ... ```
                if "```json" in response_content:
                    try:
                        response_content = re.search(r'```json(.*?)```', response_content, re.DOTALL).group(1)
                    except:
                        # Use re to extract the content after ```json
                        response_content = re.search(r'```json(.*?)', response_content, re.DOTALL).group(1)
                response_content = json.loads(response_content)
                if response_content["status"] == "done":
                    search_not_done = False
                elif response_content["status"] == "not_done":
                    search_not_done = True
                    search_task = response_content["unfinished_task"]
                    task_prompt = f"请继续完成初始任务中未完成的任务：\n\n{search_task}\n\n初始任务：{user_prompt}\n\n最后，请给出完整的初始任务的最终结果。"
                    request.messages.append(
                        {
                            "role": "assistant",
                            "content": research_response.choices[0].message.content,
                            "reasoning_content": "",
                        }
                    )
                    request.messages.append(
                        {
                            "role": "user",
                            "content": task_prompt,
                        }
                    )
                elif response_content["status"] == "need_more_info":
                    DRS_STAGE = 2
                    search_not_done = False
                elif response_content["status"] == "need_work":
                    DRS_STAGE = 2
                    search_not_done = True
                    drs_msg = get_drs_stage(DRS_STAGE)
                    request.messages.append(
                        {
                            "role": "assistant",
                            "content": research_response.choices[0].message.content,
                            "reasoning_content": "",
                        }
                    )
                    request.messages.append(
                        {
                            "role": "user",
                            "content": drs_msg,
                        }
                    )
                elif response_content["status"] == "need_more_work":
                    DRS_STAGE = 2
                    search_not_done = True
                    search_task = response_content["unfinished_task"]
                    task_prompt = f"请继续查询如下信息：\n\n{search_task}\n\n初始任务：{user_prompt}\n\n"
                    request.messages.append(
                        {
                            "role": "assistant",
                            "content": research_response.choices[0].message.content,
                            "reasoning_content": "",
                        }
                    )
                    request.messages.append(
                        {
                            "role": "user",
                            "content": task_prompt,
                        }
                    )
                elif response_content["status"] == "answer":
                    DRS_STAGE = 3
                    search_not_done = True
                    drs_msg = get_drs_stage(DRS_STAGE)
                    request.messages.append(
                        {
                            "role": "assistant",
                            "content": research_response.choices[0].message.content,
                            "reasoning_content": "",
                        }
                    )
                    request.messages.append(
                        {
                            "role": "user",
                            "content": drs_msg,
                        }
                    )
       # Process the response content
        response_dict = response.model_dump()
        content = response_dict["choices"][0]['message']['content']
        if response_dict["choices"][0]['message'].get('reasoning_content',""):
            pass
        else:
            response_dict["choices"][0]['message']['reasoning_content'] = response_dict["choices"][0]['message'].get('reasoning',"")
        if open_tag in content and close_tag in content:
            reasoning_content = re.search(fr'{open_tag}(.*?)\{close_tag}', content, re.DOTALL)
            if reasoning_content:
                # Store into the reasoning_content field
                response_dict["choices"][0]['message']['reasoning_content'] = reasoning_content.group(1).strip()
                # Remove the tag portion from the original content
                response_dict["choices"][0]['message']['content'] = re.sub(fr'{open_tag}(.*?)\{close_tag}', '', content, flags=re.DOTALL).strip()
        if m0:
            messages=f"用户说：{user_prompt}\n\n---\n\n你说：{response_dict["choices"][0]['message']['content']}"
            executor = ThreadPoolExecutor()
            infer = cur_memory.get('infer') or False
            async def add():
                loop = asyncio.get_event_loop()
                # Bind the user_id keyword argument
                metadata = {
                    "timetamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                }
                func = partial(m0.add, user_id=memoryId,metadata=metadata,infer=infer)
                # Pass messages as a positional argument
                await loop.run_in_executor(executor, func, messages)
                print("Knowledge base update complete")

            asyncio.create_task(add())
        return JSONResponse(content=response_dict)
    except Exception as e:
        return JSONResponse(
            content={"error": {"message": str(e), "type": "api_error"}}
        )

@app.post("/execute_tool_manually")
async def execute_tool_manually(request: Request):
    """
    前端点击审批按钮后调用的接口
    """
    data = await request.json()
    tool_name = data.get("tool_name")
    tool_params = data.get("tool_params")
    approval_type = data.get("approval_type") # 'once' or 'always'
    
    # Get the current config
    settings = await load_settings()
    cwd = settings.get("CLISettings", {}).get("cc_path")
    
    # ==================== Core logic: handle "Always" ====================
    if approval_type == "always":
        # If the user chose "don't ask again", write this tool into the current project's .agent/config.json
        if cwd:
            try:
                add_tool_to_project_config(cwd, tool_name)
                print(f"[Permission] Added {tool_name} to whitelist for project {cwd}")
            except Exception as e:
                return {"result": f"[System Error] Failed to save permission: {str(e)}"}
        else:
             return {"result": "[System Error] No working directory found to save config."}

    # ==================== 1. Import all tool functions ====================
    from py.web_search import (
        DDGsearch, 
        searxng, 
        Tavily_search,
        Bing_search,
        Google_search,
        Brave_search,
        Exa_search,
        Serper_search,
        bochaai_search,
        jina_crawler,
        Crawl4Ai_search, 
        firecrawl_search,
        simple_fetch,
        markdown_new,
    )
    from py.know_base import query_knowledge_base
    from py.agent_tool import agent_tool_call
    from py.a2a_tool import a2a_tool_call
    from py.llm_tool import custom_llm_tool
    from py.pollinations import pollinations_image,openai_image,openai_chat_image
    from py.load_files import get_file_content
    from py.code_interpreter import e2b_code,local_run_code
    from py.custom_http import fetch_custom_http
    from py.comfyui_tool import comfyui_tool_call
    from py.utility_tools import (
        time,
        get_weather,
        get_location_coordinates,
        get_weather_by_city,
        get_wikipedia_summary_and_sections,
        get_wikipedia_section_content,
        search_arxiv_papers
    )
    from py.autoBehavior import auto_behavior

    # Docker CLI tools (existing)
    from py.cli_tool import (
        docker_sandbox,
        list_files_tool,
        read_file_tool,
        read_file_range_tool, 
        tail_file_tool,     
        search_files_tool,
        edit_file_tool,
        edit_file_patch_tool, 
        glob_files_tool,       
        todo_write_tool, 
        list_processes_tool,
        get_process_logs_tool,
        kill_process_tool,
        docker_manage_ports_tool,
        read_skill_tool,
    )

    # New: local-environment CLI tools (assumed to live in py/local_cli_tool.py)
    from py.cli_tool import (
        shell_tool_local,           # Local bash execution (corresponds to docker_sandbox)
        list_files_tool_local,     # Local file listing
        read_file_tool_local,      # Local file reading
        read_file_range_tool_local, # <--- New import
        tail_file_tool_local,       # <--- New import
        search_files_tool_local,   # Local file search
        edit_file_tool_local,      # Local file writing
        edit_file_patch_tool_local,# Local exact replace
        glob_files_tool_local,     # Local glob search
        todo_write_tool_local,     # Local task management
        local_net_tool,            # Local network tools
        read_skill_tool_local,
    )

    from py.cdp_tool import (
        list_pages,
        navigate_page,
        new_page,
        close_page,
        select_page,
        take_snapshot,
        wait_for,
        click,
        fill,
        hover,
        press_key,
        evaluate_script,
        take_screenshot,
        fill_form,
        drag,
        handle_dialog
    )
    from py.random_topic import get_random_topics,get_categories

    from py.task_tools import (
        create_subtask,
        query_task_progress,
        cancel_subtask,
        finish_task
    )
    
    from py.computer_use_tool import (
        mouse_move,
        mouse_click,
        mouse_double_click,
        mouse_drag,
        mouse_scroll,
        mouse_hold,
        copy_to_input_box,
        keyboard_press,
        keyboard_sequence,
        keyboard_hotkey,
        keyboard_hold,
        logical_type,
        wait,
        screenshot,
        logical_click,
    )

    from py.mode_change import update_workspace_settings
    from py.acpx_tools import acpx_agent

    # ==================== 2. Define the tool mapping table ====================
    _TOOL_HOOKS = {
        "DDGsearch": DDGsearch,
        "searxng": searxng,
        "Tavily_search": Tavily_search,
        "query_knowledge_base": query_knowledge_base,
        "jina_crawler": jina_crawler,
        "Crawl4Ai_search": Crawl4Ai_search,
        "firecrawl_search": firecrawl_search,
        "simple_fetch":simple_fetch,
        "markdown_new":markdown_new,
        "agent_tool_call": agent_tool_call,
        "a2a_tool_call": a2a_tool_call,
        "custom_llm_tool": custom_llm_tool,
        "pollinations_image":pollinations_image,
        "get_file_content":get_file_content,
        "get_image_content": get_image_content,
        "e2b_code": e2b_code,
        "local_run_code": local_run_code,
        "openai_image": openai_image,
        "openai_chat_image":openai_chat_image,
        "Bing_search": Bing_search,
        "Google_search": Google_search,
        "Brave_search": Brave_search,
        "Exa_search": Exa_search,
        "Serper_search": Serper_search,
        "bochaai_search": bochaai_search,
        "comfyui_tool_call": comfyui_tool_call,
        "time": time,
        "get_weather": get_weather,
        "get_location_coordinates": get_location_coordinates,
        "get_weather_by_city":get_weather_by_city,
        "get_wikipedia_summary_and_sections": get_wikipedia_summary_and_sections,
        "get_wikipedia_section_content": get_wikipedia_section_content,
        "search_arxiv_papers": search_arxiv_papers,
        "auto_behavior": auto_behavior,
        "list_pages": list_pages,
        "new_page": new_page,
        "close_page": close_page,
        "select_page": select_page,
        "navigate_page": navigate_page,
        "take_snapshot": take_snapshot,
        "click": click,
        "fill": fill,
        "evaluate_script": evaluate_script,
        "take_screenshot": take_screenshot,
        "hover": hover,
        "press_key": press_key,
        "wait_for": wait_for,
        "fill_form":fill_form,
        "drag": drag,
        "handle_dialog": handle_dialog,
        "get_random_topics":get_random_topics,
        "get_categories":get_categories,
        
        # Docker sandbox-related tools (existing)
        "docker_sandbox": docker_sandbox,
        "list_files_tool": list_files_tool,
        "read_file_tool": read_file_tool,
        "read_file_range_tool": read_file_range_tool, # <--- Map the new tool
        "tail_file_tool": tail_file_tool,             # <--- Map the new tool
        "search_files_tool": search_files_tool,
        "edit_file_tool": edit_file_tool,
        "edit_file_patch_tool": edit_file_patch_tool,
        "glob_files_tool": glob_files_tool,
        "todo_write_tool": todo_write_tool,
        "list_processes_tool": list_processes_tool,
        "get_process_logs_tool": get_process_logs_tool,
        "kill_process_tool": kill_process_tool,
        "docker_manage_ports_tool": docker_manage_ports_tool,
        "read_skill_tool": read_skill_tool,
        
        # Local-environment tools (new) - same features as the Docker version but operate on the local filesystem
        "shell_tool_local": shell_tool_local,                     # Local bash execution
        "list_files_tool_local": list_files_tool_local,         # Local file listing
        "read_file_tool_local": read_file_tool_local,           # Local file reading
        "read_file_range_tool_local": read_file_range_tool_local, # <--- Map the new tool
        "tail_file_tool_local": tail_file_tool_local,             # <--- Map the new tool
        "search_files_tool_local": search_files_tool_local,     # Local file search
        "edit_file_tool_local": edit_file_tool_local,           # Local file writing
        "edit_file_patch_tool_local": edit_file_patch_tool_local,  # Local exact replace
        "glob_files_tool_local": glob_files_tool_local,         # Local glob search
        "todo_write_tool_local": todo_write_tool_local,         # Local task management
        "local_net_tool": local_net_tool,                       # Local network tools
        "read_skill_tool_local": read_skill_tool_local,         # Local skill reading

        # Task-center tools (new)
        "create_subtask": create_subtask,
        "query_task_progress": query_task_progress,
        "cancel_subtask": cancel_subtask,
        "finish_task":finish_task,

        # Mouse/keyboard control
        "mouse_move":mouse_move,
        "mouse_click":mouse_click,
        "mouse_double_click":mouse_double_click,
        "mouse_drag":mouse_drag,
        "mouse_scroll":mouse_scroll,
        "mouse_hold":mouse_hold,
        "copy_to_input_box":copy_to_input_box,
        "keyboard_press":keyboard_press,
        "keyboard_sequence":keyboard_sequence,
        "keyboard_hotkey":keyboard_hotkey,
        "keyboard_hold":keyboard_hold,
        "logical_type":logical_type,
        "wait":wait,
        "screenshot":screenshot,
        "logical_click":logical_click,

        "update_workspace_settings":update_workspace_settings,
        "acpx_agent":acpx_agent,
    }
    

    if tool_name not in _TOOL_HOOKS:
        return {"result": f"Tool {tool_name} not found in backend registry."}
    
    tool_func = _TOOL_HOOKS[tool_name]
    
    try:
        if tool_name in ("acpx_agent", "shell_tool_local", "docker_sandbox"):
            return tool_func(**tool_params)

        # 2. Execute the tool
        result = await tool_func(**tool_params)
        
        # 3. Handle streaming output (AsyncIterator)
        # If it's a stream, consume it fully and merge into a string to display on the frontend at once
        # Because manual execution usually no longer supports the streaming typewriter effect (or frontend handling gets complex)
        if hasattr(result, "__aiter__"):
            output_buffer = []
            async for chunk in result:
                output_buffer.append(chunk)
            return {"result": "".join(output_buffer)}
        
        return {"result": str(result)}
        
    except Exception as e:
        return {"result": f"Error executing {tool_name}: {str(e)}"}

# Add the following code after the existing route
@app.get("/v1/models")
async def get_models():
    """
    获取模型列表
    """
    from openai.types import Model
    from openai.pagination import SyncPage
    try:
        # Reload the latest settings
        current_settings = await load_settings()
        agents = current_settings['agents']
        # Build a Model object in the OpenAI format
        model_data = [
            Model(
                id=agent["name"],  
                created=0,  
                object="model",
                owned_by="super-agent-party"  # Non-empty string
            )
            for agent in agents.values()  
        ]
        # Add the default 'super-model'
        model_data.append(
            Model(
                id='super-model',
                created=0,
                object="model",
                owned_by="super-agent-party"  # Non-empty string
            )
        )

        # Build the full SyncPage response
        response = SyncPage[Model](
            object="list",
            data=model_data,
            has_more=False  # Add pagination markers
        )
        # Return the model dict directly; FastAPI serializes it to JSON automatically
        return response.model_dump()  
        
    except Exception as e:
        return JSONResponse(
            status_code=e.status_code,
            content={
                "error": {
                    "message": str(e),
                    "type": "api_error",
                }
            }
        )
    except Exception as e:
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "error": {
                    "message": str(e),
                    "type": "server_error",
                    "code": 500
                }
            }
        )

# Add the following code after the existing route
@app.get("/v1/agents",operation_id="get_agents")
async def get_agents():
    """
    获取模型列表
    """
    from openai.types import Model
    from openai.pagination import SyncPage
    try:
        # Reload the latest settings
        current_settings = await load_settings()
        agents = current_settings['agents']
        # Build a Model object in the OpenAI format
        model_data = [
            {
                "name": agent["name"],
                "description": agent["system_prompt"],
            }
            for agent in agents.values()  
        ]
        # Add the default 'super-model'
        model_data.append(
            {
                "name": 'super-model',
                "description": "Super-Agent-Party default agent",
            }
        )
        return model_data
        
    except Exception as e:
        return JSONResponse(
            status_code=e.status_code,
            content={
                "error": {
                    "message": str(e),
                    "type": "api_error",
                }
            }
        )
    except Exception as e:
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "error": {
                    "message": str(e),
                    "type": "server_error",
                    "code": 500
                }
            }
        )

class ProviderModelRequest(BaseModel):
    url: str
    api_key: str
    vendor: Optional[str] = None  # Optional field for specifying the provider

@app.post("/v1/providers/models")
async def fetch_provider_models(request: ProviderModelRequest):
    try:
        global global_http_client
        vendor = getattr(request, 'vendor', None)
        print(f"Fetching models from provider: {vendor} at URL: {request.url}")
        # 1. Intercept Claude
        if vendor == 'customAnthropic':
            client = AsyncClaudeAsOpenAI(
                api_key=request.api_key, 
                base_url=request.url,
                http_client=global_http_client
            )
        # 2. Intercept Gemini
        elif vendor == 'Gemini':
            client = AsyncGeminiAsOpenAI(
                api_key=request.api_key,
                base_url=request.url,
                http_client=global_http_client
            )
        # 3. Intercept Dify
        elif vendor == 'Dify':
            client = DifyOpenAIAsync(
                api_key=request.api_key, 
                base_url=request.url,
                http_client=global_http_client
            )
        # 4. Fall back to standard OpenAI
        else:
            client = AsyncOpenAI(
                api_key=request.api_key, 
                base_url=request.url,
                http_client=global_http_client
            )

        model_list = await client.models.list()
        return JSONResponse(content={"data":[model.id for model in model_list.data]})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/chat/completions", operation_id="chat_with_agent_party")
async def chat_endpoint(request: ChatRequest, fastapi_request: Request):
    """
    用来与agent party中的模型聊天
    """
    fastapi_base_url = str(fastapi_request.base_url)
    # [Note] bring in the global fast_client
    global client, reasoner_client, fast_client, settings, mcp_client_list
    
    raw_model = request.model or 'super-model'
    override_memory_id = None
    
    if raw_model.startswith("memory/"):
        parts = raw_model.split('/', 2) 
        if len(parts) >= 2:
            override_memory_id = parts[1]
            request.model = parts[2] if len(parts) > 2 else 'super-model'
            print(f"Detected dynamic Memory ID: {override_memory_id}, target model updated to: {request.model}")
    
    model = request.model or 'super-model'
    enable_thinking = request.enable_thinking or False
    enable_deep_research = request.enable_deep_research or False
    enable_web_search = request.enable_web_search or False
    async_tools_id = request.asyncToolsID or None
    await _apply_group_memory_context(request)

    if model == 'super-model':
        current_settings = await load_settings()
        
        # [Change 1] create a request-specific config to avoid polluting the global one
        request_settings = current_settings.copy()
        active_client = client  # Use the main model by default
        
        if current_settings['fast']['enabled'] and not request.is_sub_agent:
            fast_cfg = current_settings['fast']
            use_fast_model = False
            
            if fast_cfg.get('triggerMode') == 'always':
                use_fast_model = True
            elif fast_cfg.get('triggerMode') == 'conditional':
                last_user_text = ""
                has_image = False
                for msg in reversed(request.messages):
                    if msg.get('role') == 'user':
                        content = msg.get('content')
                        if isinstance(content, str):
                            last_user_text = content
                        elif isinstance(content, list):
                            texts = []
                            for item in content:
                                if item.get('type') == 'text':
                                    texts.append(item.get('text', ''))
                                elif item.get('type') == 'image_url':
                                    has_image = True
                            last_user_text = "".join(texts)
                        break
                
                has_files = bool(request.fileLinks) 
                condition_pass = True
                
                max_len = fast_cfg.get('conditionMaxLen', 0)
                if max_len > 0 and len(last_user_text) > max_len:
                    condition_pass = False
                if condition_pass and fast_cfg.get('conditionNoNewline', False):
                    if '\n' in last_user_text:
                        condition_pass = False
                if condition_pass and fast_cfg.get('conditionNoFiles', True):
                    if has_image or has_files:
                        condition_pass = False
                        
                if condition_pass:
                    use_fast_model = True

            if use_fast_model:
                exclude_keys = ['enabled', 'triggerMode', 'conditionMaxLen', 'conditionNoNewline', 'conditionNoFiles']
                fast_config = {k: v for k, v in fast_cfg.items() if k not in exclude_keys}
                
                # Update the request-specific config without affecting current_settings
                request_settings.update(fast_config)
                
                # [Change 2] dynamically check and update the fast-model client (only when the config changes)
                old_fast_cfg = settings.get('fast', {}) if settings else {}
                if (fast_client is None 
                    or fast_cfg.get('api_key') != old_fast_cfg.get('api_key') 
                    or fast_cfg.get('base_url') != old_fast_cfg.get('base_url')):
                    
                    f_provider = fast_cfg.get('selectedProvider', current_settings.get('selectedProvider'))
                    f_class = get_client_class(current_settings, f_provider)
                    fast_client = f_class(
                        api_key=fast_cfg.get('api_key') or current_settings.get('api_key'),
                        base_url=fast_cfg.get('base_url') or current_settings.get('base_url') or "https://api.openai.com/v1"
                    )
                
                # Switch the current request to the fast client
                active_client = fast_client

        if override_memory_id:
            request_settings["memorySettings"]["is_memory"] = True
            request_settings["memorySettings"]["selectedMemory"] = override_memory_id
            
        if len(current_settings['modelProviders']) <= 0:
            return JSONResponse(status_code=500, content={"error": {"message": await t("NoModelProvidersConfigured"), "type": "server_error", "code": 500}})

        # [Change 3] dynamically update the main-model client (only when the main config changes)
        if (current_settings['api_key'] != settings['api_key'] 
            or current_settings['base_url'] != settings['base_url']
            or client is None):
            c_class = get_client_class(current_settings, current_settings['selectedProvider'])
            client = c_class(
                api_key=current_settings['api_key'],
                base_url=current_settings['base_url'] or "https://api.openai.com/v1",
            )
            # If the fast model wasn't triggered, ensure active_client points to the latest main client
            if active_client != fast_client:
                active_client = client

        # Dynamically update the reasoning-model client
        if (current_settings['reasoner']['api_key'] != settings['reasoner']['api_key'] 
            or current_settings['reasoner']['base_url'] != settings['reasoner']['base_url']
            or reasoner_client is None):
            r_class = get_client_class(current_settings, current_settings['reasoner']['selectedProvider'])
            reasoner_client = r_class(
                api_key=current_settings['reasoner']['api_key'],
                base_url=current_settings['reasoner']['base_url'] or "https://api.openai.com/v1",
            )

        print('model:', request_settings['model'])
        
        # Insert "system_prompt" into request.messages[0].content (note this uses request_settings)
        if request_settings['system_prompt']:
            content_prepend(request.messages, 'system', request_settings['system_prompt'] + "\n\n")
            
        # [Core fix] since we didn't pollute current_settings earlier, this comparison is a true config diff
        if current_settings != settings:
            settings = current_settings
            
        try:
            # Pass in active_client (zero-latency switch) and request_settings
            if request.stream:
                return await generate_stream_response(active_client, reasoner_client, request, request_settings, fastapi_base_url, enable_thinking, enable_deep_research, enable_web_search, async_tools_id)
            return await generate_complete_response(active_client, reasoner_client, request, request_settings, fastapi_base_url, enable_thinking, enable_deep_research, enable_web_search)
        except asyncio.CancelledError:
            print("Client disconnected")
            raise
        except Exception as e:
            return JSONResponse(status_code=500, content={"error": {"message": str(e), "type": "server_error", "code": 500}})
            
    else:
        # ===== Agent-related logic ===== 
        # (Because agent_settings is a new dict created via local json.load on each request,
        # it inherently avoids the "global pollution" issue the main model had, so this code can stay mostly as-is)
        
        current_settings = await load_settings()
        agentSettings = current_settings['agents'].get(model, {})
        if not agentSettings:
            for agentId , agentConfig in current_settings['agents'].items():
                if current_settings['agents'][agentId]['name'] == model:
                    agentSettings = current_settings['agents'][agentId]
                    break
        if not agentSettings:
            return JSONResponse(status_code=404, content={"error": {"message": f"Agent {model} not found", "type": "not_found", "code": 404}})
            
        # Read the file each time to generate a new agent_settings dict
        if agentSettings['config_path']:
            with open(agentSettings['config_path'], 'r' , encoding='utf-8') as f:
                agent_settings = json.load(f)
            if agentSettings['system_prompt']:
                content_prepend(request.messages, 'user', agentSettings['system_prompt'] + "\n\n")
        
        if agent_settings['fast']['enabled'] and not request.is_sub_agent:
            fast_cfg = agent_settings['fast']
            use_fast_model = False
            
            if fast_cfg.get('triggerMode') == 'always':
                use_fast_model = True
            elif fast_cfg.get('triggerMode') == 'conditional':
                last_user_text = ""
                has_image = False
                for msg in reversed(request.messages):
                    if msg.get('role') == 'user':
                        content = msg.get('content')
                        if isinstance(content, str):
                            last_user_text = content
                        elif isinstance(content, list):
                            texts = []
                            for item in content:
                                if item.get('type') == 'text':
                                    texts.append(item.get('text', ''))
                                elif item.get('type') == 'image_url':
                                    has_image = True
                            last_user_text = "".join(texts)
                        break
                
                has_files = bool(request.fileLinks)
                condition_pass = True
                max_len = fast_cfg.get('conditionMaxLen', 0)
                if max_len > 0 and len(last_user_text) > max_len: condition_pass = False
                if condition_pass and fast_cfg.get('conditionNoNewline', False):
                    if '\n' in last_user_text: condition_pass = False
                if condition_pass and fast_cfg.get('conditionNoFiles', True):
                    if has_image or has_files: condition_pass = False
                        
                if condition_pass:
                    use_fast_model = True

            if use_fast_model:
                exclude_keys = ['enabled', 'triggerMode', 'conditionMaxLen', 'conditionNoNewline', 'conditionNoFiles']
                fast_config = {k: v for k, v in fast_cfg.items() if k not in exclude_keys}
                agent_settings.update(fast_config) # Updating here doesn't matter for the Agent since it's a local variable
                
        # While we're at it, use the helper we wrote to simplify the code
        a_client_class = get_client_class(agent_settings, agent_settings.get('selectedProvider'))
        agent_client = a_client_class(
            api_key=agent_settings.get('api_key', ''),
            base_url=agent_settings.get('base_url') or "https://api.openai.com/v1"
        )
        
        ar_client_class = get_client_class(agent_settings, agent_settings.get('reasoner', {}).get('selectedProvider'))
        agent_reasoner_client = ar_client_class(
            api_key=agent_settings.get('reasoner', {}).get('api_key', ''),
            base_url=agent_settings.get('reasoner', {}).get('base_url') or "https://api.openai.com/v1"
        )
        
        try:
            if request.stream:
                return await generate_stream_response(agent_client, agent_reasoner_client, request, agent_settings, fastapi_base_url, enable_thinking, enable_deep_research, enable_web_search, async_tools_id)
            return await generate_complete_response(agent_client, agent_reasoner_client, request, agent_settings, fastapi_base_url, enable_thinking, enable_deep_research, enable_web_search)
        except asyncio.CancelledError:
            print("Client disconnected")
            raise
        except Exception as e:
            return JSONResponse(status_code=500, content={"error": {"message": str(e), "type": "server_error", "code": 500}})

@app.post("/simple_chat")
async def simple_chat_endpoint(request: ChatRequest):
    """
    同时支持流式(stream=true)与非流式(stream=false)
    默认使用 fast_client 以提高响应速度
    """
    global fast_client, settings

    current_settings = await load_settings()
    if len(current_settings['modelProviders']) <= 0:
        return JSONResponse(
            status_code=500,
            content={"error": {"message": await t("NoModelProvidersConfigured"),
                               "type": "server_error", "code": 500}}
        )

    # --------------- Just use fast_client directly ---------------
    fast_cfg = current_settings.get('fast', {})
    
    # Initialize or update fast_client
    if (fast_client is None 
        or fast_cfg.get('api_key') != settings.get('fast', {}).get('api_key')
        or fast_cfg.get('base_url') != settings.get('fast', {}).get('base_url')):
        
        f_provider = fast_cfg.get('selectedProvider', current_settings.get('selectedProvider'))
        f_class = get_client_class(current_settings, f_provider)
        fast_client = f_class(
            api_key=fast_cfg.get('api_key') or current_settings.get('api_key'),
            base_url=fast_cfg.get('base_url') or current_settings.get('base_url') or "https://api.openai.com/v1"
        )
    
    # Override the current config with the fast config
    if fast_cfg:
        exclude_keys = ['enabled', 'triggerMode', 'conditionMaxLen', 'conditionNoNewline', 'conditionNoFiles']
        fast_config = {k: v for k, v in fast_cfg.items() if k not in exclude_keys}
        for key, value in fast_config.items():
            current_settings[key] = value

    # --------------- Call the LLM ---------------
    response = await fast_client.chat.completions.create(
        model=current_settings['model'],
        messages=request.messages,
        stream=request.stream,
        temperature=request.temperature or settings.get('temperature', 0.7),
    )

    # --------------- Non-streaming: return JSON at once ---------------
    if not request.stream:
        # Note: openai returns a ChatCompletion object
        return JSONResponse(content=response.model_dump())

    # --------------- Streaming: keep the original StreamingResponse ---------------
    async def openai_raw_stream():
        async for chunk in response:
            yield chunk.model_dump_json() + '\n'
        # Don't send [DONE]

    return StreamingResponse(
        openai_raw_stream(),
        media_type="text/plain",      # Could also keep "text/event-stream"
        headers={"Cache-Control": "no-cache"}
    )

class GroupMemoryExtractRequest(BaseModel):
    group_id: Union[str, int, float]
    conversation_id: Union[str, int, float]
    user_message_id: Optional[Union[str, int, float]] = None
    assistant_message_id: Optional[Union[str, int, float]] = None
    user_message: str
    assistant_message: str

class DeleteConversationRequest(BaseModel):
    conversation_id: Union[str, int, float]
    delete_memory: bool = False

class ClearGroupMemoryRequest(BaseModel):
    group_id: Union[str, int, float]

@app.post("/api/group-memory/extract")
async def extract_group_memory_endpoint(req: GroupMemoryExtractRequest):
    req.group_id = _normalize_entity_id(req.group_id)
    req.conversation_id = _normalize_entity_id(req.conversation_id)
    req.user_message_id = _normalize_entity_id(req.user_message_id) or None
    req.assistant_message_id = _normalize_entity_id(req.assistant_message_id) or None

    group_map = await _load_group_map()
    group = group_map.get(req.group_id)
    if not group or not (group.get("memoryConfig") or {}).get("enabled"):
        return {"success": True, "memories": 0}

    current_settings = await load_settings()
    client_class = get_client_class(current_settings, current_settings.get('selectedProvider'))
    memory_client = client_class(
        api_key=current_settings.get('api_key'),
        base_url=current_settings.get('base_url') or "https://api.openai.com/v1",
    )
    memories = await _extract_group_memories(memory_client, current_settings, req.model_dump())
    await _upsert_group_memories(
        req.group_id,
        req.conversation_id,
        req.assistant_message_id or req.user_message_id or req.conversation_id,
        memories,
    )
    return {"success": True, "memories": len(memories)}

@app.post("/api/conversations/delete")
async def delete_conversation_endpoint(req: DeleteConversationRequest):
    req.conversation_id = _normalize_entity_id(req.conversation_id)
    covs = await load_covs()
    conversations = covs.get("conversations", []) or []
    covs["conversations"] = [conv for conv in conversations if conv.get("id") != req.conversation_id]
    await save_covs(covs)
    if req.delete_memory:
        await _invalidate_group_memories_by_chat(req.conversation_id)
    return {"success": True}

@app.post("/api/group-memory/clear-group")
async def clear_group_memory_endpoint(req: ClearGroupMemoryRequest):
    req.group_id = _normalize_entity_id(req.group_id)
    await _invalidate_group_memories_by_group(req.group_id)
    return {"success": True}

@app.post("/api/group-memory/clear-all")
async def clear_all_group_memory_endpoint():
    await _invalidate_all_group_memories()
    return {"success": True}

from py.task_center import get_task_center
from py.sub_agent import run_subtask_in_background

# --- New task-center API ---

class TaskCreateRequest(BaseModel):
    title: str
    description: str
    agent_type: str = "default"
    task_type: str = "once"  # once, time, cycle
    platforms: List[str] = []
    trigger_config: Optional[Dict[str, Any]] = None

@app.get("/v1/tasks/list")
async def list_tasks_endpoint():
    """获取当前工作区的所有任务"""
    current_settings = await load_settings()
    workspace_dir = current_settings.get("CLISettings", {}).get("cc_path")
    
    if not workspace_dir:
        return {"tasks": [], "error": "No workspace configured"}
        
    try:
        task_center = await get_task_center(workspace_dir)
        tasks = await task_center.list_tasks()
        return {"tasks": [t.model_dump() for t in tasks]}
    except Exception as e:
        return {"tasks": [], "error": str(e)}

@app.post("/v1/tasks/create")
async def create_task_endpoint(req: TaskCreateRequest):
    """手动创建任务：支持单次、定时、周期模式"""
    current_settings = await load_settings()
    workspace_dir = current_settings.get("CLISettings", {}).get("cc_path")
    
    if not workspace_dir:
        raise HTTPException(status_code=400, detail="工作区路径未配置")

    try:
        task_center = await get_task_center(workspace_dir)
        
        # Build the initial context
        context = {
            "task_type": req.task_type,
            "trigger_config": getattr(req, "trigger_config", {}), # Prevent errors when it can't be fetched
            "history": [],
            "ran_count": 0
        }
        
        # 1. Create the task record (key fix: pass req.platforms in)
        task = await task_center.create_task(
            title=req.title,
            description=req.description,
            agent_type=req.agent_type,
            parent_task_id="USER",
            context=context,
            platforms=req.platforms  # <-- this line is required!
        )
        
        # 2. Read the consensus (optional)
        consensus_content = None
        consensus_file = Path(workspace_dir) / ".agent" / "consensus.md"
        if consensus_file.exists():
            import aiofiles
            async with aiofiles.open(consensus_file, 'r', encoding='utf-8') as f:
                consensus_content = await f.read()

        # 3. Dispatch the execution logic
        if req.task_type == "once":
            # Immediate-execution mode: throw it straight into the background
            asyncio.create_task(
                run_subtask_in_background(
                    task_id=task.task_id,
                    workspace_dir=workspace_dir,
                    settings=current_settings,
                    consensus_content=consensus_content
                )
            )
            msg = "任务已启动"
        else:
            # Scheduled or cyclic mode: handled by scheduler.py; only save here
            msg = f"计划任务已创建 (模式: {req.task_type})"
            
        return {"success": True, "message": msg, "task": task.model_dump()}
    except Exception as e:
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})
    
@app.post("/v1/tasks/cancel/{task_id}")
async def cancel_task_endpoint(task_id: str):
    """取消任务"""
    current_settings = await load_settings()
    workspace_dir = current_settings.get("CLISettings", {}).get("cc_path")
    if not workspace_dir:
        raise HTTPException(status_code=400, detail="No workspace")
        
    task_center = await get_task_center(workspace_dir)
    success = await task_center.cancel_task(task_id)
    return {"success": success}

@app.delete("/v1/tasks/{task_id}")
async def delete_task_endpoint(task_id: str):
    """删除任务"""
    current_settings = await load_settings()
    workspace_dir = current_settings.get("CLISettings", {}).get("cc_path")
    if not workspace_dir:
        raise HTTPException(status_code=400, detail="No workspace")
        
    task_center = await get_task_center(workspace_dir)
    success = await task_center.delete_task(task_id)
    return {"success": success}

def sanitize_proxy_url(input_url: str) -> str:
    """
    针对代理场景优化的 URL 安全过滤
    """
    if not input_url:
        raise HTTPException(status_code=400, detail="URL 不能为空")
    
    # 1. Parse the URL
    parsed = urlparse(input_url)
    
    # 2. Validate the scheme (forbid file://, gopher://, etc.)
    if parsed.scheme not in ["http", "https"]:
        raise HTTPException(status_code=400, detail="仅支持 http 或 https 协议")
    
    if not parsed.netloc:
        raise HTTPException(status_code=400, detail="无效的域名或 IP")

    # 3. Rebuild the URL (clear the SSRF taint)
    # Exclude userinfo, keep only the necessary parts
    safe_url = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
    if parsed.query:
        safe_url += f"?{parsed.query}"
    if parsed.fragment:
        safe_url += f"#{parsed.fragment}"

    # 4. Security: block access to private resources like intranet/loopback/cloud-metadata (anti-SSRF)
    if is_private_ip(parsed.hostname):
        logger.warning(f"Blocked SSRF attempt to internal address: {safe_url}")
        raise HTTPException(status_code=403, detail="禁止访问内网或本地地址")

    return safe_url

@app.api_route("/extension_proxy", methods=["GET", "POST"])
async def extension_proxy(request: Request, url: str):
    """
    方便SAP插件调用的通用代理接口，让插件能够绕过 CORS 限制访问任意 URL。
    """
    BROWSER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    # --- Stage A: security validation (kept, to prevent SSRF attacks on the intranet) ---
    try:
        target_url = sanitize_proxy_url(url)
    except HTTPException as e:
        return Response(content=e.detail, status_code=e.status_code)
    
    # --- Stage B: perform the proxy request ---
    method = request.method
    body = await request.body()
    
    # Build headers: keep only what's needed, strip noise, add an identity marker
    # Exclude headers that could leak a fingerprint or get rejected
    excluded_headers = {
        'host', 'content-length', 'connection', 'keep-alive', 
        'upgrade-insecure-requests', 'accept-encoding', 'cookie', 'user-agent'
    }
    
    headers = {
        k: v for k, v in request.headers.items() 
        if k.lower() not in excluded_headers
    }
    
    # [Key 1]: use a standard browser UA to declare this is user reading behavior
    headers["User-Agent"] = BROWSER_USER_AGENT
    
    # [Key 2]: explicitly tell the server we accept XML/RSS, making us look more like a benign reader
    if "accept" not in headers or "*/*" in headers["accept"]:
        headers["Accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8"

    # [Key 3]: handle Referer. Some hotlink protections need it; others (like Reddit) block on a weird Referer
    # The safest approach is to send no Referer, or set it to the target domain's root
    headers.pop("Referer", None) 
    
    print(f"--- [Extension Proxy] ---")
    print(f"Target: {target_url} | Method: {method} | Mode: Browser Emulation")
    
    # trust_env=False: prevents the Python code from accidentally using a system-level HTTP proxy
    async with httpx.AsyncClient(verify=False, follow_redirects=True, timeout=30.0, trust_env=False) as client:
        try:
            resp = await client.request(
                method=method,
                url=target_url,
                headers=headers,
                content=body
            )
            
            # Clean the response headers: avoid passing compression/chunked-transfer through to the frontend and breaking parsing
            resp_headers = {
                k: v for k, v in resp.headers.items()
                if k.lower() not in {
                    'content-encoding', 'content-length', 'transfer-encoding', 
                    'server', 'set-cookie' # Also don't pass Set-Cookie through, to protect user privacy
                }
            }
            
            # If Reddit still returns 403, the body usually has an error message; return it to the frontend for debugging
            if resp.status_code == 403:
                print(f"[Proxy Warning] Target returned 403. Body sample: {resp.content[:100]}")

            return Response(
                content=resp.content,
                status_code=resp.status_code,
                headers=resp_headers,
                media_type=resp.headers.get("content-type", "application/octet-stream")
            )

        except httpx.ConnectError as e:
            err_msg = f"Proxy Connect Error: {e}"
            # Return a JSON-formatted error so the frontend can handle it gracefully
            return Response(content=f'{{"error": "{err_msg}"}}', status_code=502, media_type="application/json")
            
        except Exception as e:
            print(f"[Proxy Error] System: {repr(e)}")
            return Response(content='{"error": "Internal Proxy Error"}', status_code=500, media_type="application/json")

        
# Store active ASR WebSocket connections
asr_connections = []

# Store each connection's audio-frame data
audio_buffer: Dict[str, Dict[str, Any]] = {}

def convert_audio_to_pcm16(audio_bytes: bytes, target_sample_rate: int = 16000) -> bytes:
    """
    将音频数据转换为PCM16格式，采样率16kHz
    """
    import numpy as np
    from scipy.io import wavfile
    try:
        # Create a temp file
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_file:
            temp_file.write(audio_bytes)
            temp_file_path = temp_file.name
        
        try:
            # Read the audio file
            sample_rate, audio_data = wavfile.read(temp_file_path)
            
            # Convert to mono
            if len(audio_data.shape) > 1:
                audio_data = np.mean(audio_data, axis=1)
            
            # Convert to float32 for resampling
            if audio_data.dtype != np.float32:
                if audio_data.dtype == np.int16:
                    audio_data = audio_data.astype(np.float32) / 32768.0
                elif audio_data.dtype == np.int32:
                    audio_data = audio_data.astype(np.float32) / 2147483648.0
                else:
                    audio_data = audio_data.astype(np.float32)
            
            # Resample to the target sample rate
            if sample_rate != target_sample_rate:
                from scipy.signal import resample
                num_samples = int(len(audio_data) * target_sample_rate / sample_rate)
                audio_data = resample(audio_data, num_samples)
            
            # Convert to int16 PCM format
            audio_data = (audio_data * 32767).astype(np.int16)
            
            return audio_data.tobytes()
            
        finally:
            # Delete the temp file
            os.unlink(temp_file_path)
            
    except Exception as e:
        print(f"Audio conversion error: {e}")
        # If conversion fails, try returning the raw data directly
        return audio_bytes

async def funasr_recognize(audio_data: bytes, funasr_settings: dict,ws: WebSocket,frame_id) -> str:
    """
    使用FunASR进行语音识别
    """
    try:
        # Get the FunASR server address
        funasr_url = funasr_settings.get('funasr_ws_url', 'ws://localhost:10095')
        hotwords = funasr_settings.get('hotwords', '')
        if not funasr_url.startswith('ws://') and not funasr_url.startswith('wss://'):
            funasr_url = f"ws://{funasr_url}"
        
        # Connect to the FunASR server
        async with websockets.connect(funasr_url) as websocket:
            print(f"Connected to FunASR server: {funasr_url}")
            
            # 1. Send the initialization config
            init_config = {
                "chunk_size": [5, 10, 5],
                "wav_name": "python_client",
                "is_speaking": True,
                "chunk_interval": 10,
                "mode": "offline",  # Use offline mode
                "hotwords": hotwords_to_json(hotwords),
                "use_itn": True
            }
            
            await websocket.send(json.dumps(init_config))
            print("Sent init config")
            
            # 2. Convert the audio data to PCM16 format
            pcm_data = convert_audio_to_pcm16(audio_data)
            print(f"PCM data length: {len(pcm_data)} bytes")
            
            # 3. Send the audio data in chunks
            chunk_size = 960  # 30ms of audio data (16000 * 0.03 * 2 = 960 bytes)
            total_sent = 0
            
            while total_sent < len(pcm_data):
                chunk_end = min(total_sent + chunk_size, len(pcm_data))
                chunk = pcm_data[total_sent:chunk_end]
                
                # Send the binary PCM data
                await websocket.send(chunk)
                total_sent = chunk_end
            
            print(f"Sent all audio data: {total_sent} bytes")
            
            # 4. Send the end signal
            end_config = {
                "is_speaking": False,
            }
            
            await websocket.send(json.dumps(end_config))
            print("Sent end signal")
            
            # 5. Wait for the recognition result
            result_text = ""
            timeout_count = 0
            max_timeout = 200  # Wait at most 20 seconds
            
            while timeout_count < max_timeout:
                try:
                    # Wait for the response message
                    response = await asyncio.wait_for(websocket.recv(), timeout=0.1)
                    
                    try:
                        # Try parsing the JSON response
                        json_response = json.loads(response)
                        print(f"Received response: {json_response}")
                        
                        if 'text' in json_response:
                            text = json_response['text']
                            if text and text.strip():
                                result_text += text
                                print(f"Got text: {text}")
                                # Send the result
                                await ws.send_json({
                                    "type": "transcription",
                                    "id": frame_id,
                                    "text": result_text,
                                    "is_final": True
                                })
                            # Check whether it's the final result
                            if json_response.get('is_final', False):
                                print("Got final result")
                                break
                                
                    except json.JSONDecodeError:
                        # If it's not JSON, it may be binary data; ignore it
                        print(f"Non-JSON response: {response}")
                        pass
                        
                except asyncio.TimeoutError:
                    timeout_count += 1
                    continue
                except websockets.exceptions.ConnectionClosed:
                    print("WebSocket connection closed")
                    break
            
            if not result_text:
                print("No recognition result received")
                return ""
            
            return result_text.strip()
            
    except Exception as e:
        print(f"FunASR recognition error: {e}")
        return f"FunASR识别错误: {str(e)}"

def hotwords_to_json(input_str):
    # Initialize the result dict
    result = {}
    
    # Split the input string by lines
    lines = input_str.split('\n')
    
    for line in lines:
        # Trim leading/trailing whitespace from the line
        cleaned_line = line.strip()
        
        # Skip empty lines
        if not cleaned_line:
            continue
            
        # Split the word and weight
        parts = cleaned_line.rsplit(' ', 1)  # Split once from the right
        
        if len(parts) != 2:
            continue  # Skip malformed lines
            
        word = parts[0].strip()
        try:
            weight = int(parts[1])
        except ValueError:
            continue  # Skip lines whose weight isn't a number
            
        # Add to the result dict
        result[word] = weight
    
    # Convert to a JSON string
    return json.dumps(result, ensure_ascii=False)

# ASR WebSocket handling
@app.websocket("/ws/asr")
async def asr_websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    
    # Generate a unique connection ID
    connection_id = str(uuid.uuid4())
    asr_connections.append(websocket)
    funasr_websocket = None
    # New: connection-status tracking variables
    asr_engine = None
    funasr_mode = None
    
    try:
        # Handle the message
        async for message in websocket.iter_json():
            msg_type = message.get("type")
            
            if msg_type == "init":
                # Load settings
                settings = await load_settings()
                asr_settings = settings.get('asrSettings', {})
                asr_engine = asr_settings.get('engine', 'openai')  # Store the engine type
                if asr_engine == "funasr":
                    funasr_mode = asr_settings.get('funasr_mode', 'openai')  # Store the mode
                    if funasr_mode == "2pass" or funasr_mode == "online":
                        # Get the FunASR server address
                        funasr_url = asr_settings.get('funasr_ws_url', 'ws://localhost:10095')
                        if not funasr_url.startswith('ws://') and not funasr_url.startswith('wss://'):
                            funasr_url = f"ws://{funasr_url}"
                        try:
                            funasr_websocket = await websockets.connect(funasr_url)
                        except Exception as e:
                            funasr_websocket = None
                            print(f"Failed to connect to FunASR: {e}")
                await websocket.send_json({
                    "type": "init_response",
                    "status": "ready"
                })
                print("ASR WebSocket connected:",asr_engine)
            elif msg_type == "audio_start":
                frame_id = message.get("id")
                # Load settings
                settings = await load_settings()
                asr_settings = settings.get('asrSettings', {})
                asr_engine = asr_settings.get('engine', 'openai')  # Store the engine type
                if asr_engine == "funasr":
                    funasr_mode = asr_settings.get('funasr_mode', '2pass')  # Store the mode
                    hotwords = asr_settings.get('hotwords', '')
                    if funasr_mode == "2pass":
                        # Get the FunASR server address
                        funasr_url = asr_settings.get('funasr_ws_url', 'ws://localhost:10095')
                        if not funasr_url.startswith('ws://') and not funasr_url.startswith('wss://'):
                            funasr_url = f"ws://{funasr_url}"
                        try:
                            if not funasr_websocket:
                                # Connect to the FunASR server 
                                funasr_websocket = await websockets.connect(funasr_url)
                            # 1. Send the initialization config
                            init_config = {
                                "chunk_size": [5, 10, 5],
                                "wav_name": "python_client",
                                "is_speaking": True,
                                "chunk_interval": 10,
                                "mode": funasr_mode,  
                                "hotwords": hotwords_to_json(hotwords),
                                "use_itn": True
                            }
                            await funasr_websocket.send(json.dumps(init_config))
                            print("Sent init config")
                            # 2. Start an async task to handle FunASR's responses
                            asyncio.create_task(handle_funasr_response(funasr_websocket, websocket))
                        except Exception as e:
                            print(f"Failed to connect to FunASR: {e}")
                            await websocket.send_json({
                                "type": "error",
                                "message": f"无法连接FunASR服务器: {str(e)}"
                            })
                            # Mark the connection as failed to avoid further operations
                            funasr_websocket = None
                    else:
                        # Close the async task handling FunASR's responses
                        funasr_websocket = None
                else:
                    # Close the async task handling FunASR's responses
                    funasr_websocket = None
            # Change: add a check before streaming-audio processing
            elif msg_type == "audio_stream":
                frame_id = message.get("id")
                audio_base64 = message.get("audio")

                # Key check: ensure funasr_websocket is initialized
                if not funasr_websocket:
                    continue  # Skip processing the current message

                if audio_base64:
                    # 1. Base64-decode -> get binary PCM (Int16)
                    pcm_data = base64.b64decode(audio_base64)

                    # 2. Forward the binary directly to FunASR
                    try:
                        await funasr_websocket.send(pcm_data)
                    except websockets.exceptions.ConnectionClosed:
                        funasr_websocket = None
                        # Load settings
                        settings = await load_settings()
                        asr_settings = settings.get('asrSettings', {})
                        asr_engine = asr_settings.get('engine', 'openai')  # Store the engine type
                        if asr_engine == "funasr":
                            funasr_mode = asr_settings.get('funasr_mode', '2pass')  # Store the mode
                            if funasr_mode == "2pass":
                                # Get the FunASR server address
                                funasr_url = asr_settings.get('funasr_ws_url', 'ws://localhost:10095')
                                if not funasr_url.startswith('ws://') and not funasr_url.startswith('wss://'):
                                    funasr_url = f"ws://{funasr_url}"
                                try:
                                    funasr_websocket = await websockets.connect(funasr_url)
                                except Exception as e:
                                    funasr_websocket = None
                                    print(f"Failed to connect to FunASR: {e}")
            elif msg_type == "audio_complete":
                # Handle the complete audio data (non-streaming mode)
                frame_id = message.get("id")
                audio_b64 = message.get("audio")
                audio_format = message.get("format", "wav")
                
                if audio_b64:
                    # Decode the base64 data
                    audio_bytes = base64.b64decode(audio_b64)
                    print(f"Received audio data: {len(audio_bytes)} bytes, format: {audio_format}")
                    
                    try:
                        # Load settings
                        settings = await load_settings()
                        asr_settings = settings.get('asrSettings', {})
                        asr_engine = asr_settings.get('engine', 'openai')
                        
                        result = ""
                        
                        if asr_engine == "openai":
                            # OpenAI ASR
                            audio_file = BytesIO(audio_bytes)
                            audio_file.name = f"audio.{audio_format}"
                            
                            client = AsyncOpenAI(
                                api_key=asr_settings.get('api_key', ''),
                                base_url=asr_settings.get('base_url', '') or "https://api.openai.com/v1"
                            )
                            response = await client.audio.transcriptions.create(
                                file=audio_file,
                                model=asr_settings.get('model', 'whisper-1'),
                            )
                            result = response.text
                            # Send the result
                            await websocket.send_json({
                                "type": "transcription",
                                "id": frame_id,
                                "text": result,
                                "is_final": True
                            })
                        elif asr_engine == "funasr":
                            # FunASR
                            print("Using FunASR engine")
                            funasr_mode = asr_settings.get('funasr_mode', 'offline')
                            if funasr_mode == "offline":
                                result = await funasr_recognize(audio_bytes, asr_settings,websocket,frame_id)
                            else:
                                # Key check: ensure the connection is valid
                                if not funasr_websocket:
                                    continue
                                
                                # 4. Send the end signal
                                end_config = {
                                    "is_speaking": False  # Only send the necessary end marker
                                }
                                try:
                                    await funasr_websocket.send(json.dumps(end_config))
                                    print("Sent end signal")
                                except websockets.exceptions.ConnectionClosed:
                                    print("FunASR connection closed; cannot send end signal")
                            funasr_websocket = None

                        elif asr_engine == "sherpa":
                            from py.sherpa_asr import sherpa_recognize
                            # Added Sherpa handling
                            result = await sherpa_recognize(audio_bytes)
                            print(f"Sherpa result: {result}")
                            await websocket.send_json({
                                "type": "transcription",
                                "id": frame_id,
                                "text": result,
                                "is_final": True
                            })

                    except WebSocketDisconnect:
                        print(f"ASR WebSocket disconnected: {connection_id}")
                    except Exception as e:
                        print(f"ASR WebSocket error: {e}")
    finally:
        # Clean up resources
        if connection_id in audio_buffer:
            del audio_buffer[connection_id]
        if websocket in asr_connections:
            asr_connections.remove(websocket)
        # New: ensure the FunASR connection is closed
        if funasr_websocket:
            await funasr_websocket.close()

@app.post("/asr")
async def asr_transcription(
    audio: UploadFile = File(...),
    format: str = Form(default="auto")
):
    """
    HTTP版本的ASR接口
    支持多种音频格式，根据配置自动选择ASR引擎
    """
    # Declare use of the global cache
    global openai_asr_clients_cache, settings

    try:
        # 1. Read the uploaded audio file
        audio_bytes = await audio.read()
        print(f"Received audio file: {audio.filename}, size: {len(audio_bytes)} bytes")
        
        # 2. Auto-detect the format
        if format == "auto":
            if audio.filename:
                file_ext = audio.filename.split('.')[-1].lower()
                format = file_ext if file_ext in ['wav', 'mp3', 'flac', 'ogg', 'm4a'] else 'wav'
            else:
                format = 'wav'
        
        # 3. Load settings (for performance, you can use the global settings or reload)
        current_settings = await load_settings()
        asr_settings = current_settings.get('asrSettings', {})
        asr_engine = asr_settings.get('engine', 'openai')
        
        result = ""
        
        # ==========================================
        # ASR engine branch: OpenAI (Whisper)
        # ==========================================
        if asr_engine == "openai":
            api_key = asr_settings.get('api_key', '')
            base_url = asr_settings.get('base_url', '') or "https://api.openai.com/v1"
            
            if not api_key:
                raise HTTPException(status_code=400, detail="OpenAI ASR API密钥未配置")

            # --- Core improvement: use the cached client ---
            cache_key = (api_key, base_url)
            if cache_key not in openai_asr_clients_cache:
                print(f"Initializing new OpenAI ASR Client for: {base_url}")
                openai_asr_clients_cache[cache_key] = AsyncOpenAI(
                    api_key=api_key,
                    base_url=base_url
                )
            client = openai_asr_clients_cache[cache_key]
            # --------------------------------

            print(f"Using OpenAI ASR engine ({asr_settings.get('model', 'whisper-1')})")
            
            # Wrap the audio data
            audio_file = BytesIO(audio_bytes)
            # The OpenAI SDK requires a specific filename suffix to detect the type
            audio_file.name = f"audio.{format}"
            
            response = await client.audio.transcriptions.create(
                file=audio_file,
                model=asr_settings.get('model', 'whisper-1'),
            )
            result = response.text
            
        # ==========================================
        # ASR engine branch: FunASR
        # ==========================================
        elif asr_engine == "funasr":
            print("Using FunASR engine (offline mode)")
            # Assumes funasr_recognize_offline already handles performance internally
            result = await funasr_recognize_offline(audio_bytes, asr_settings)
            
        # ==========================================
        # ASR engine branch: Sherpa (local)
        # ==========================================
        elif asr_engine == "sherpa":
            from py.sherpa_asr import sherpa_recognize
            print("Using Sherpa ASR engine")
            # Sherpa is usually local model inference; cost is CPU/GPU, not connection setup
            result = await sherpa_recognize(audio_bytes)
        

        else:
            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "error": f"不支持的ASR引擎: {asr_engine}",
                    "text": ""
                }
            )
        
        # 4. Return the recognition result
        return JSONResponse(
            content={
                "success": True,
                "text": result.strip() if result else "",
                "engine": asr_engine,
                "format": format
            }
        )
        
    except Exception as e:
        print(f"ASR HTTP interface error: {e}")
        import traceback
        traceback.print_exc()
        
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": str(e),
                "text": ""
            }
        )

async def funasr_recognize_offline(audio_data: bytes, funasr_settings: dict) -> str:
    """
    FunASR离线识别（专为HTTP接口优化）
    """
    try:
        # Get the FunASR server address
        funasr_url = funasr_settings.get('funasr_ws_url', 'ws://localhost:10095')
        hotwords = funasr_settings.get('hotwords', '')
        if not funasr_url.startswith('ws://') and not funasr_url.startswith('wss://'):
            funasr_url = f"ws://{funasr_url}"
        
        # Connect to the FunASR server
        async with websockets.connect(funasr_url) as websocket:
            print(f"Connected to FunASR server: {funasr_url}")
            
            # 1. Send the init config (force offline mode)
            init_config = {
                "chunk_size": [5, 10, 5],
                "wav_name": "http_client",
                "is_speaking": True,
                "chunk_interval": 10,
                "mode": "offline",  # Force offline mode
                "hotwords": hotwords_to_json(hotwords),
                "use_itn": True
            }
            
            await websocket.send(json.dumps(init_config))
            print("Sent init config for offline mode")
            
            # 2. Convert the audio data to PCM16 format
            pcm_data = convert_audio_to_pcm16(audio_data)
            print(f"PCM data length: {len(pcm_data)} bytes")
            
            # 3. Send the audio data in chunks
            chunk_size = 960  # 30ms of audio data
            total_sent = 0
            
            while total_sent < len(pcm_data):
                chunk_end = min(total_sent + chunk_size, len(pcm_data))
                chunk = pcm_data[total_sent:chunk_end]
                await websocket.send(chunk)
                total_sent = chunk_end
            
            print(f"Sent all audio data: {total_sent} bytes")
            
            # 4. Send the end signal
            end_config = {
                "is_speaking": False,
            }
            await websocket.send(json.dumps(end_config))
            print("Sent end signal")
            
            # 5. Wait for the recognition result
            result_text = ""
            timeout_count = 0
            max_timeout = 300  # Wait at most 30 seconds (the HTTP endpoint can wait longer)
            
            while timeout_count < max_timeout:
                try:
                    response = await asyncio.wait_for(websocket.recv(), timeout=0.1)
                    
                    try:
                        json_response = json.loads(response)
                        print(f"Received response: {json_response}")
                        
                        if 'text' in json_response:
                            text = json_response['text']
                            if text and text.strip():
                                result_text += text
                                print(f"Got text: {text}")
                            
                            # Check whether it's the final result
                            if json_response.get('is_final', False):
                                print("Got final result")
                                break
                                
                    except json.JSONDecodeError:
                        # Ignore non-JSON responses
                        pass
                        
                except asyncio.TimeoutError:
                    timeout_count += 1
                    continue
                except websockets.exceptions.ConnectionClosed:
                    print("WebSocket connection closed")
                    break
            
            if not result_text:
                print("No recognition result received")
                return ""
            
            return result_text.strip()
            
    except Exception as e:
        print(f"FunASR offline recognition error: {e}")
        return f"FunASR识别错误: {str(e)}"


async def handle_funasr_response(funasr_websocket, 
                               client_websocket: WebSocket):
    """
    处理 FunASR 服务器的响应，并将结果转发给客户端
    """
    try:
        async for message in funasr_websocket:
            try:
                if funasr_websocket:
                    # FunASR may return JSON or binary data
                    if isinstance(message, bytes):
                        message = message.decode('utf-8')
                    
                    data = json.loads(message)
                    print(f"FunASR response: {data}")
                    # Parse the FunASR response
                    if "text" in data:  # Ordinary recognition result
                        if data.get('mode', '') == "2pass-online":
                            await client_websocket.send_json({
                                "type": "transcription",
                                "text": data["text"],
                                "is_final": False
                            })
                        else:
                            await client_websocket.send_json({
                                "type": "transcription",
                                "text": data["text"],
                                "is_final": True
                            })
                    elif "mode" in data:  # Initialize the response
                        print(f"FunASR initialized: {data}")
                    else:
                        print(f"Unknown FunASR response: {data}")
                else:
                    # If the FunASR connection closes, send an error message, break the loop, and end the task
            
                    break
            except json.JSONDecodeError:
                print(f"FunASR sent non-JSON data: {message[:100]}...")
            except Exception as e:
                print(f"Error processing FunASR response: {e}")
                break

    except websockets.exceptions.ConnectionClosed:
        print("FunASR connection closed")
    except Exception as e:
        print(f"FunASR handler error: {e}")
    finally:
        await funasr_websocket.close()

class TTSConnectionManager:
    def __init__(self):
        self.main_connections: List[WebSocket] = []
        self.vrm_connections: List[WebSocket] = []
        self.overlay_connections: list[WebSocket] = []

    async def connect_main(self, websocket: WebSocket):
        await websocket.accept()
        self.main_connections.append(websocket)
        logging.info(f"Main interface connected. Total: {len(self.main_connections)}")

    async def connect_vrm(self, websocket: WebSocket):
        await websocket.accept()
        self.vrm_connections.append(websocket)
        logging.info(f"VRM interface connected. Total: {len(self.vrm_connections)}")

    def disconnect_main(self, websocket: WebSocket):
        if websocket in self.main_connections:
            self.main_connections.remove(websocket)

    def disconnect_vrm(self, websocket: WebSocket):
        if websocket in self.vrm_connections:
            self.vrm_connections.remove(websocket)

    async def broadcast_to_vrm(self, message: Union[str, bytes]):
        """核心：同时支持字符串 JSON 和二进制 Blob 透传"""
        if not self.vrm_connections:
            return
        disconnected = []
        for connection in self.vrm_connections:
            try:
                if isinstance(message, bytes):
                    await connection.send_bytes(message)
                else:
                    await connection.send_text(message)
            except:
                disconnected.append(connection)
        for conn in disconnected:
            self.disconnect_vrm(conn)

    async def send_to_main(self, message: str):
        if not self.main_connections:
            return
        disconnected = []
        for connection in self.main_connections:
            try:
                await connection.send_text(message)
            except:
                disconnected.append(connection)
        for conn in disconnected:
            self.disconnect_main(conn)

    async def connect_overlay(self, websocket: WebSocket):
        """字幕页专用连接"""
        await websocket.accept()
        self.overlay_connections.append(websocket)

    def disconnect_overlay(self, websocket: WebSocket):
        if websocket in self.overlay_connections:
            self.overlay_connections.remove(websocket)

    async def broadcast_to_vrm(self, message: Union[str, bytes]):
        """核心广播逻辑：区分发送内容"""
        # 1. If it's binary (audio stream), send it only to the actual VRM page
        if isinstance(message, bytes):
            for conn in list(self.vrm_connections):
                try: await conn.send_bytes(message)
                except: self.disconnect_vrm(conn)
        
        # 2. If it's a string (command/text), send it to both the VRM page and the subtitle page
        else:
            # Send to the VRM window (sync expressions, UI, etc.)
            for conn in list(self.vrm_connections):
                try: await conn.send_text(message)
                except: self.disconnect_vrm(conn)
            
            # Send to the subtitle window (display text)
            for conn in list(self.overlay_connections):
                try: await conn.send_text(message)
                except: self.disconnect_overlay(conn)


tts_manager = TTSConnectionManager()

async def broadcast_to_vrm(self, message: Union[str, bytes]):
    if not self.vrm_connections:
        return
    disconnected = []
    for connection in self.vrm_connections:
        try:
            if isinstance(message, bytes):
                await connection.send_bytes(message)
            else:
                await connection.send_text(message)
        except:
            disconnected.append(connection)
    for conn in disconnected:
        self.disconnect_vrm(conn)

@app.websocket("/ws/tts")
async def tts_websocket_endpoint(websocket: WebSocket):
    await tts_manager.connect_main(websocket)
    try:
        while True:
            msg = await websocket.receive()
            
            # 1. Handle binary (audio stream)
            if "bytes" in msg:
                data_bytes = msg["bytes"]
                if len(data_bytes) > 4:
                    try:
                        json_len = struct.unpack('<I', data_bytes[:4])[0]
                        metadata_bytes = data_bytes[4 : 4 + json_len]
                        audio_file_bytes = data_bytes[4 + json_len :]
                        
                        await tts_manager.broadcast_to_vrm(data_bytes)
                    except Exception as e:
                        logging.error(f"万能音频解码出错: {e}")
            
            # 2. Handle text (commands/expressions)
            elif "text" in msg:
                try:
                    payload = json.loads(msg["text"]) 
                    msg_type = payload.get("type")
                    
                    await tts_manager.broadcast_to_vrm(msg["text"])
                except Exception as e:
                    logging.error(f"[PY] WS Text Error: {e}")

    except Exception as e:
        logging.error(f"[PY] WS Global Error: {e}")
    finally:
        tts_manager.disconnect_main(websocket)

@app.websocket("/ws/vrm")
async def vrm_websocket_endpoint(websocket: WebSocket):
    """VRM 窗口 WebSocket：接收主窗口发来的数据"""
    await tts_manager.connect_vrm(websocket)
    try:
        while True:
            msg = await websocket.receive()
            if "text" in msg:
                # Handle feedback from VRM (e.g. requestAudioData or animationComplete)
                data = json.loads(msg["text"])
                if data.get('type') == 'animationComplete':
                    await tts_manager.send_to_main(msg["text"])
            # The VRM window usually doesn't send binary to the main window, so bytes aren't handled here for now
    except WebSocketDisconnect:
        tts_manager.disconnect_vrm(websocket)
    except Exception as e:
        logging.error(f"WS error in VRM: {e}")
        tts_manager.disconnect_vrm(websocket)

@app.websocket("/ws/subtitles")
async def subtitles_websocket_endpoint(websocket: WebSocket):
    """字幕叠加层专用端点：不参与音频播放判断"""
    await tts_manager.connect_overlay(websocket)
    try:
        while True:
            await websocket.receive_text() # Keep the heartbeat
    except WebSocketDisconnect:
        tts_manager.disconnect_overlay(websocket)

# Status endpoint: connection counts for the pet window / overlay / main UI
@app.get("/tts/status")
async def get_tts_status():
    return {
        "vrm_connections": len(tts_manager.vrm_connections),
        "overlay_connections": len(tts_manager.overlay_connections),
        "main_connections": len(tts_manager.main_connections)
    }

@app.post("/tts")
async def text_to_speech(request: Request):
    import edge_tts
    import subprocess
    
    # Declare the global cache and client
    global global_http_client, openai_tts_clients_cache, tetos_speakers_cache

    try:
        data = await request.json()
        text = data.get('text', '')
        if not text:
            return JSONResponse(status_code=400, content={"error": "Text is empty"})
        
        # Mobile-only: force the opus format
        mobile_optimized = data.get('mobile_optimized', False)
        target_format = "opus" if mobile_optimized else data.get('format', 'mp3')
        
        new_voice = data.get('voice', 'default')
        tts_settings = data.get('ttsSettings', {})
        
        # Handle voice-config inheritance logic
        if new_voice in tts_settings.get('newtts', {}) and new_voice != 'default':
            voice_settings = tts_settings['newtts'][new_voice]
            parent_settings = tts_settings
            
            inherited_fields = ['api_key', 'base_url', 'model', 'selectedProvider', 'vendor']
            for field in inherited_fields:
                child_value = voice_settings.get(field, '')
                parent_value = parent_settings.get(field, '')
                if not child_value and parent_value:
                    voice_settings[field] = parent_value
            
            selected_provider_id = voice_settings.get('selectedProvider')
            if selected_provider_id and not voice_settings.get('api_key'):
                model_providers = parent_settings.get('modelProviders', [])
                for provider in model_providers:
                    if provider.get('id') == selected_provider_id:
                        voice_settings['api_key'] = provider.get('apiKey', '')
                        voice_settings['base_url'] = provider.get('url', '')
                        voice_settings['model'] = provider.get('modelId', '')
                        voice_settings['vendor'] = provider.get('vendor', '')
                        break
            tts_settings = voice_settings

        index = data.get('index', 0)
        tts_engine = tts_settings.get('engine', 'edgetts')
                
        print(f"TTSrequest - engine: {tts_engine}, format: {target_format}, mobile-optimized: {mobile_optimized}")
                
        # ==========================================
        # 1. EdgeTTS engine
        # ==========================================
        if tts_engine == 'edgetts':
            edgettsLanguage = tts_settings.get('edgettsLanguage', 'zh-CN')
            edgettsVoice = tts_settings.get('edgettsVoice', 'XiaoyiNeural')
            rate = tts_settings.get('edgettsRate', 1.0)
            full_voice_name = f"{edgettsLanguage}-{edgettsVoice}"
            
            if mobile_optimized:
                rate = min(rate * 0.95, 1.1)
            
            rate_text = "+0%"
            if rate >= 1.0:
                rate_text = f"+{int((rate - 1.0) * 100)}%"
            elif rate < 1.0:
                rate_text = f"-{int((1.0 - rate) * 100)}%"
            
            async def generate_audio():
                communicate = edge_tts.Communicate(text, full_voice_name, rate=rate_text)
                if target_format == "opus":
                    audio_chunks = []
                    async for chunk in communicate.stream():
                        if chunk["type"] == "audio":
                            audio_chunks.append(chunk["data"])
                    
                    full_audio = b''.join(audio_chunks)
                    convert_result = await asyncio.to_thread(convert_to_opus_simple, full_audio)
                    opus_audio = convert_result[0] if isinstance(convert_result, tuple) else convert_result
                    
                    chunk_size = 4096
                    for i in range(0, len(opus_audio), chunk_size):
                        yield opus_audio[i:i + chunk_size]
                else:
                    async for chunk in communicate.stream():
                        if chunk["type"] == "audio":
                            yield chunk["data"]

            media_type = "audio/ogg" if target_format == "opus" else "audio/mpeg"
            filename = f"tts_{index}.opus" if target_format == "opus" else f"tts_{index}.mp3"
            
            return StreamingResponse(
                generate_audio(),
                media_type=media_type,
                headers={"Content-Disposition": f"inline; filename={filename}", "X-Audio-Index": str(index), "X-Audio-Format": target_format}
            )

        # ==========================================
        # 2. CustomTTS engine (uses the global connection pool)
        # ==========================================
        elif tts_engine == 'customTTS':
            key_text = tts_settings.get('customTTSKeyText', 'text')
            key_speaker = tts_settings.get('customTTSKeySpeaker', 'speaker')
            key_speed = tts_settings.get('customTTSKeySpeed', 'speed')
            speaker_value = tts_settings.get('customTTSspeaker', '')
            speed_value = tts_settings.get('customTTSspeed', 1.0)
            
            if mobile_optimized:
                speed_value = min(speed_value * 0.95, 1.2)

            params = {key_text: text, key_speaker: speaker_value, key_speed: speed_value}
            servers = [s for s in tts_settings.get('customTTSserver', 'http://127.0.0.1:9880').split('\n') if s.strip()]
            custom_tt_server = servers[index % len(servers)]
            custom_streaming = tts_settings.get('customStream', False)
            
            async def generate_audio():
                safe_url = sanitize_url(input_url=custom_tt_server, default_base="http://127.0.0.1:9880", endpoint="")
                try:
                    # Use the global client; no need for async with httpx.AsyncClient()
                    async with global_http_client.stream("GET", safe_url, params=params) as response:
                        response.raise_for_status()
                        if custom_streaming:
                            async for chunk in response.aiter_bytes():
                                yield chunk
                        else:
                            audio_data = await response.aread()
                            if target_format == "opus":
                                convert_result = await asyncio.to_thread(convert_to_opus_simple, audio_data)
                                audio_data = convert_result[0] if isinstance(convert_result, tuple) else convert_result
                            
                            chunk_size = 4096
                            for i in range(0, len(audio_data), chunk_size):
                                yield audio_data[i:i + chunk_size]
                except Exception as e:
                    raise HTTPException(status_code=502, detail=f"Custom TTS 连接失败: {str(e)}")

            media_type = "audio/ogg" if target_format == "opus" else "audio/wav"
            filename = f"tts_{index}.opus" if target_format == "opus" else f"tts_{index}.wav"
            return StreamingResponse(generate_audio(), media_type=media_type, headers={"Content-Disposition": f"inline; filename={filename}", "X-Audio-Index": str(index)})

        # ==========================================
        # 5. OpenAI TTS (uses the instance cache)
        # ==========================================
        elif tts_engine == 'openai':
            api_key = tts_settings.get('api_key', '')
            base_url = tts_settings.get('base_url', 'https://api.openai.com/v1')
            if not api_key: raise HTTPException(status_code=400, detail="API密钥未配置")
            
            # Get or create the cached client
            cache_key = (api_key, base_url)
            if cache_key not in openai_tts_clients_cache:
                openai_tts_clients_cache[cache_key] = AsyncOpenAI(api_key=api_key, base_url=base_url)
            client = openai_tts_clients_cache[cache_key]

            speed = float(tts_settings.get('openaiSpeed', 1.0))
            if mobile_optimized: speed = min(speed * 0.95, 1.2)
            
            async def generate_audio():
                response_format = target_format if target_format in ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'] else 'mp3'
                params = {'model': tts_settings.get('model', 'tts-1'), 'input': text, 'speed': max(0.25, min(4.0, speed)), 'response_format': response_format}
                
                params['voice'] = tts_settings.get('openaiVoice', 'alloy')

                if tts_settings.get('openaiStream', False):
                    async with client.audio.speech.with_streaming_response.create(**params) as response:
                        async for chunk in response.iter_bytes(chunk_size=4096): yield chunk
                else:
                    response = await client.audio.speech.create(**params)
                    content = await response.aread()
                    for i in range(0, len(content), 4096): yield content[i:i + 4096]

            media_map = {"opus": "audio/ogg", "wav": "audio/wav", "aac": "audio/aac", "flac": "audio/flac"}
            return StreamingResponse(generate_audio(), media_type=media_map.get(target_format, "audio/mpeg"))

        # ==========================================
        # 6. System TTS (OS-native)
        # ==========================================
        elif tts_engine == 'systemtts':
            system_voice_name = tts_settings.get('systemVoiceName', None)
            system_rate = int(tts_settings.get('systemRate', 200))
            if mobile_optimized: system_rate = int(system_rate * 0.95)
            
            def sync_generate_wav(input_text, voice_name, rate, req_index):
                temp_filename = os.path.join(TOOL_TEMP_DIR, f"temp_tts_{req_index}_{uuid.uuid4().hex[:8]}.wav")
                wav_data = b""
                try:
                    if platform.system() == 'Darwin':
                        cmd = ['say', '-o', temp_filename, '--data-format=LEI16@22050', input_text]
                        if voice_name: cmd.extend(['-v', voice_name])
                        if rate: cmd.extend(['-r', str(rate)])
                        subprocess.run(cmd, check=True)
                    else:
                        import pyttsx3
                        engine = pyttsx3.init()
                        engine.setProperty('rate', rate)
                        if voice_name:
                            for v in engine.getProperty('voices'):
                                if voice_name.lower() in v.name.lower() or voice_name == v.id:
                                    engine.setProperty('voice', v.id); break
                        engine.save_to_file(input_text, temp_filename)
                        engine.runAndWait()
                    if os.path.exists(temp_filename): wav_data = open(temp_filename, 'rb').read()
                finally:
                    if os.path.exists(temp_filename): os.remove(temp_filename)
                return wav_data

            async def generate_audio():
                wav_content = await asyncio.to_thread(sync_generate_wav, text, system_voice_name, system_rate, index)
                final = wav_content
                if target_format == "opus":
                    res = await asyncio.to_thread(convert_to_opus_simple, wav_content)
                    final = res[0] if isinstance(res, tuple) else res
                for i in range(0, len(final), 4096): yield final[i:i + 4096]
            
            media_type = "audio/ogg" if target_format == "opus" else "audio/wav"
            return StreamingResponse(generate_audio(), media_type=media_type)

        # ==========================================
        # 7. Tetos SDK (Azure, Baidu, Google, Fish, etc. - uses the instance cache)
        # ==========================================
        elif tts_engine in ['azure', 'fish', 'google']:
            selected_voice = tts_settings.get(f'{tts_engine}Voice', '') or None
            
            # Generate the cache key based on the engine
            if tts_engine == 'azure': cache_key = (tts_engine, tts_settings.get('azureSpeechKey'), tts_settings.get('azureRegion'), selected_voice)
            elif tts_engine == 'fish': cache_key = (tts_engine, tts_settings.get('fishApiKey'), selected_voice)
            elif tts_engine == 'google': cache_key = (tts_engine, hash(tts_settings.get('googleServiceAccount', '')), selected_voice)
            else: cache_key = None

            temp_filename = os.path.join(TOOL_TEMP_DIR, f"temp_tetos_{index}_{uuid.uuid4().hex[:8]}.mp3")

            def run_tetos_sync():
                if cache_key in tetos_speakers_cache:
                    speaker = tetos_speakers_cache[cache_key]
                else:
                    if tts_engine == 'azure':
                        from tetos.azure import AzureSpeaker
                        speaker = AzureSpeaker(speech_key=cache_key[1], speech_region=cache_key[2], voice=selected_voice)
                    elif tts_engine == 'fish':
                        from tetos.fish import FishSpeaker
                        speaker = FishSpeaker(api_key=cache_key[1], voice=selected_voice)
                    elif tts_engine == 'google':
                        from tetos.google import GoogleSpeaker
                        sa_json = tts_settings.get('googleServiceAccount', '')
                        if sa_json:
                            import tempfile
                            with tempfile.NamedTemporaryFile(mode='w+', suffix='.json', delete=False) as tmp:
                                tmp.write(sa_json); os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = tmp.name
                        speaker = GoogleSpeaker(voice=selected_voice)
                    tetos_speakers_cache[cache_key] = speaker
                speaker.say(text, temp_filename)

            await asyncio.to_thread(run_tetos_sync)
            
            async def generate_from_file():
                try:
                    if os.path.exists(temp_filename):
                        data = open(temp_filename, "rb").read()
                        if target_format == "opus":
                            res = await asyncio.to_thread(convert_to_opus_simple, data)
                            data = res[0] if isinstance(res, tuple) else res
                        for i in range(0, len(data), 4096): yield data[i:i + 4096]
                finally:
                    if os.path.exists(temp_filename): os.remove(temp_filename)

            media_type = "audio/ogg" if target_format == "opus" else "audio/mpeg"
            return StreamingResponse(generate_from_file(), media_type=media_type)

        # ==========================================
        # 8. ElevenLabs TTS (final fixed version)
        # ==========================================
        elif tts_engine == 'elevenlabs':
            from elevenlabs.client import ElevenLabs as ElevenLabsClient
            
            api_key = tts_settings.get('elevenLabsApiKey', '')
            voice_id = tts_settings.get('elevenLabsVoice', '')
            model_id = tts_settings.get('elevenLabsModel', 'eleven_multilingual_v2')
            rate = float(tts_settings.get('elevenLabsRate', 1.0))
            
            if not api_key:
                raise HTTPException(status_code=400, detail="ElevenLabs API Key 未配置")
            if not voice_id:
                raise HTTPException(status_code=400, detail="ElevenLabs Voice ID 未配置")
            
            if mobile_optimized:
                rate = min(rate * 0.95, 1.2)
            
            client = ElevenLabsClient(api_key=api_key)
            
            # 1. [Key fix] establish the connection and request early! If the Voice ID is wrong, it throws immediately here
            # Since we haven't entered StreamingResponse yet, raising an HTTPException with a status code is fully valid
            try:
                audio_stream = await asyncio.to_thread(
                    client.text_to_speech.convert,
                    text=text,
                    voice_id=voice_id,
                    model_id=model_id or 'eleven_multilingual_v2',
                    output_format='mp3_44100_128'
                )
            except Exception as e:
                error_msg = str(e)
                if "API key" in error_msg.lower() or "authentication" in error_msg.lower():
                    raise HTTPException(status_code=401, detail="ElevenLabs API Key 无效")
                elif "voice" in error_msg.lower() or "not found" in error_msg.lower():
                    raise HTTPException(status_code=400, detail=f"Voice ID 无效: {voice_id}")
                elif "model" in error_msg.lower():
                    raise HTTPException(status_code=400, detail=f"Model ID 无效: {model_id}")
                elif "credit" in error_msg.lower() or "quota" in error_msg.lower() or "characters" in error_msg.lower():
                    raise HTTPException(status_code=429, detail="ElevenLabs 额度不足")
                else:
                    raise HTTPException(status_code=502, detail=f"ElevenLabs 服务错误: {error_msg}")

            async def generate_audio():
                # 2. [Performance fix] use a thread pool to safely pull data from the sync generator, avoiding blocking the concurrency loop
                def get_next_chunk():
                    try:
                        return next(audio_stream)
                    except StopIteration:
                        return None

                while True:
                    try:
                        chunk = await asyncio.to_thread(get_next_chunk)
                        if chunk is None:
                            break
                        if chunk:
                            yield chunk
                    except Exception as e:
                        # Note: if the stream breaks here, don't raise HTTPException anymore; just stop the stream
                        print(f"ElevenLabs transfer interrupted: {str(e)}")
                        break

            # Mobile: convert to opus (must collect all chunks first)
            if target_format == "opus":
                async def generate_opus():
                    collected = bytearray()
                    async for chunk in generate_audio():
                        collected.extend(chunk)
                    if collected:
                        res = await asyncio.to_thread(convert_to_opus_simple, bytes(collected))
                        final = res[0] if isinstance(res, tuple) else res
                        for i in range(0, len(final), 4096):
                            yield final[i:i + 4096]
                return StreamingResponse(
                    generate_opus(),
                    media_type="audio/ogg",
                    headers={
                        "Content-Disposition": f"inline; filename=tts_{index}.opus",
                        "X-Audio-Index": str(index),
                        "X-Audio-Format": "opus"
                    }
                )
            else:
                # MP3 is streamed back directly via the generator
                return StreamingResponse(
                    generate_audio(),
                    media_type="audio/mpeg",
                    headers={
                        "Content-Disposition": f"inline; filename=tts_{index}.mp3",
                        "X-Audio-Index": str(index),
                        "X-Audio-Format": "mp3"
                    }
                )
            
        raise HTTPException(status_code=400, detail="Unsupported TTS engine")
    
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": f"服务器内部错误: {str(e)}"})

@app.post("/tts/tetos/list_voices")
async def list_tetos_voices(request: Request):
    """
    通过 tetos 获取音色列表
    流程: 接收配置 -> 实例化 Speaker -> 调用 .list_voices()
    """
    try:
        data = await request.json()
        provider = data.get('provider', '').lower()
        config = data.get('config', {})  # The auth info the user filled in

        if not provider:
            return JSONResponse(status_code=400, content={"error": "缺少 'provider' 参数"})

        # Define a synchronous function (run in a thread pool to avoid blocking)
        def _sync_fetch_voices():
            voices = []

            # ---------------------------
            # Azure TTS
            # ---------------------------
            if provider == 'azure':
                from tetos.azure import AzureSpeaker
                # Instantiate
                speaker = AzureSpeaker(
                    speech_key=config.get('speech_key') or config.get('api_key'),
                    speech_region=config.get('speech_region') or config.get('region')
                )
                # Get the list
                voices = speaker.list_voices()

            elif provider == 'fish':
                api_key = config.get('api_key')
                if not api_key:
                    raise ValueError("Fish Audio 需要配置 API Key")

                # Call the Fish Audio official API
                # Set page_size to 30 to get more popular voices
                url = "https://api.fish.audio/model?page_size=30&page_number=1&sort_by=score"
                headers = {
                    "Authorization": f"Bearer {api_key}",
                    "User-Agent": "Mozilla/5.0" 
                }
                
                response = requests.get(url, headers=headers, timeout=60)
                response.raise_for_status() # Check for HTTP errors
                res_json = response.json()
                
                # Parse the returned data structure
                items = res_json.get("items", [])
                
                for item in items:
                    # Convert Fish Audio's structure into the frontend's generic structure
                    # The frontend getVoiceValue looks for id first
                    # The frontend getVoiceLabel looks for DisplayName or name first
                    # The frontend getVoiceDesc looks for Locale first
                    voices.append({
                        "id": item.get("_id"),            # Key: this is the actual voice ID
                        "name": item.get("title"),        # Display name
                        "DisplayName": item.get("title"), # Compatibility field
                        "Locale": item.get("languages", ["Unknown"])[0] if item.get("languages") else "" # Language label
                    })


            # ---------------------------
            # Google TTS
            # ---------------------------
            elif provider == 'google':
                from tetos.google import GoogleSpeaker
                # Google special case: tetos relies on the GOOGLE_APPLICATION_CREDENTIALS env var
                # If config passes a service_account JSON object, we need to write it to a temp file
                
                service_account_data = config.get('service_account')
                temp_path = None
                
                try:
                    if service_account_data:
                        # Create a temp file
                        with tempfile.NamedTemporaryFile(mode='w+', suffix='.json', delete=False) as tmp:
                            if isinstance(service_account_data, dict):
                                json.dump(service_account_data, tmp)
                            else:
                                tmp.write(str(service_account_data))
                            temp_path = tmp.name
                        
                        # Set the env var
                        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = temp_path
                    
                    # GoogleSpeaker init usually needs no params; it reads the env var itself
                    speaker = GoogleSpeaker()
                    voices = speaker.list_voices()
                    
                finally:
                    # Cleanup
                    if temp_path:
                        if os.path.exists(temp_path):
                            os.remove(temp_path)
                        # If we set the env var, delete it after use so it doesn't affect other requests
                        if os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") == temp_path:
                            del os.environ["GOOGLE_APPLICATION_CREDENTIALS"]

            else:
                pass

            return voices

        # Use asyncio.to_thread to run in a thread pool, avoiding blocking the FastAPI main loop
        voice_list = await asyncio.to_thread(_sync_fetch_voices)

        return JSONResponse(content={
            "status": "success",
            "provider": provider,
            "data": voice_list
        })

    except Exception as e:
        print(f"Get {provider} voice-list fetch failed: {e}")
        # Catch auth failures, network errors, etc.
        return JSONResponse(status_code=500, content={
            "status": "error", 
            "message": str(e),
            "detail": f"获取 {provider} 音色列表失败，请检查密钥配置是否正确。"
        })

@app.get("/system/voices")
async def get_system_voices():
    """
    获取系统可用的 pyttsx3 音色列表。
    优化版：
    1. 优先展示 Siri/Premium 高质量音色
    2. 自动从 ID 中补全缺失的语言标识
    3. 为高质量音色添加 [Siri] 前缀
    """
    import pyttsx3
    import sys
    import re

    def fetch_voices_sync():
        try:
            # 1. Still keep the weird-voice blocklist (these voices really aren't usable)
            mac_novelty_voices = {
                'Albert', 'Bad News', 'Bahh', 'Bells', 'Boing', 'Bubbles', 'Cellos',
                'Deranged', 'Good News', 'Hysterical', 'Pipe Organ', 'Trinoids', 
                'Whisper', 'Zarvox', 'Organ'
            }

            engine = pyttsx3.init()
            voices = engine.getProperty('voices')
            
            processed_voices = []

            for v in voices:
                voice_name = v.name
                voice_id = str(v.id) # Ensure it's a string
                lower_id = voice_id.lower()

                # --- Filter logic ---
                if sys.platform == 'darwin':
                    if voice_name in mac_novelty_voices:
                        continue
                    
                    # [Important change] don't filter out 'siri' anymore!
                    # We only filter out completely unusable ones (usually with an extremely short id or an invalid reference)
                    # But keep IDs containing 'siri', 'premium', 'compact'

                # --- Language-parsing logic (enhanced) ---
                lang = "Unknown"
                
                # Prefer getting it from the pyttsx3 attribute
                if hasattr(v, 'languages') and v.languages:
                    raw_lang = v.languages[0] if isinstance(v.languages, list) else v.languages
                    if isinstance(raw_lang, bytes):
                        try:
                            lang = raw_lang.decode('utf-8', errors='ignore').replace('\x05', '')
                        except:
                            lang = str(raw_lang)
                    else:
                        lang = str(raw_lang)

                # [Completion logic] if the attribute has no language, try extracting it from the ID via regex
                # A macOS ID usually looks like: com.apple.speech.synthesis.voice.zh_CN.ting-ting.premium
                if lang == "Unknown" or lang == "":
                    # Match patterns like .zh_CN. or .en_US.
                    match = re.search(r'\.([a-z]{2}[_-][A-Z]{2})\.', voice_id)
                    if match:
                        lang = match.group(1).replace('_', '-') # Normalize the format to zh-CN

                # --- Determine whether it's a Siri/high-quality voice ---
                # Keywords: siri, premium (high quality), compact (compressed high quality, usually downloaded by the system by default)
                is_high_quality = False
                quality_tag = ""
                
                if any(k in lower_id for k in ['siri', 'premium', 'compact']):
                    is_high_quality = True
                    quality_tag = "[Siri/Premium] "
                
                # Some systems literally name it "Siri Voice 1"
                if "siri" in voice_name.lower():
                    is_high_quality = True
                    quality_tag = "[Siri] "

                # Assemble the data
                processed_voices.append({
                    "id": voice_id,
                    "name": f"{quality_tag}{voice_name}", # Prefix the name with a marker for easier frontend display
                    "original_name": voice_name,
                    "lang": lang,
                    "gender": getattr(v, 'gender', 'Unknown'),
                    "is_siri": is_high_quality # A marker used for sorting
                })

            # --- Sort logic ---
            # Python's sort is stable.
            # key explanation: (not x['is_siri']) -> True(1) sorts later, False(0) sorts earlier
            # So is_siri=True ones sort to the front
            processed_voices.sort(key=lambda x: (not x['is_siri'], x['lang'], x['name']))

            return processed_voices
            
        except ImportError:
            print("Error: pyttsx3 driver not found")
            return []
        except Exception as e:
            print(f"Error getting system voices: {str(e)}")
            return []

    try:
        available_voices = await asyncio.to_thread(fetch_voices_sync)
        return {
            "count": len(available_voices),
            "voices": available_voices
        }
    except Exception as e:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=500, content={"error": str(e)})


# Add status storage
mcp_status = {}
@app.post("/create_mcp")
async def create_mcp_endpoint(request: Request, background_tasks: BackgroundTasks):
    data = await request.json()
    mcp_id = data.get("mcpId")
    
    if not mcp_id:
        raise HTTPException(status_code=400, detail="Missing mcpId")
    
    # Add the task to the background queue
    background_tasks.add_task(process_mcp, mcp_id)
    
    return {"success": True, "message": "MCP服务器初始化已开始"}

@app.get("/mcp_status/{mcp_id}")
async def get_mcp_status(mcp_id: str):
    global mcp_client_list, mcp_status
    status = mcp_status.get(mcp_id, "not_found")
    if status == "ready":
        # Ensure _tools contains only serializable dicts / lists / primitives
        tools = await mcp_client_list[mcp_id].get_openai_functions(disable_tools=[])
        tools = json.dumps(mcp_client_list[mcp_id]._tools_list)
        return {"mcp_id": mcp_id, "status": status, "tools": tools}
    return {"mcp_id": mcp_id, "status": status, "tools": []}

async def process_mcp(mcp_id: str):
    """
    初始化单个 MCP 服务器，带失败回调同步，无需 sleep。
    """
    global mcp_client_list, mcp_status

    # 1. Synchronization primitives: event + failure reason
    init_done = asyncio.Event()
    fail_reason: str | None = None

    async def on_failure(error_message: str):
        nonlocal fail_reason
        # Takes effect only the first time
        if fail_reason is not None:
            return
        fail_reason = error_message
        mcp_status[mcp_id] = f"failed: {error_message}"

        # Fault tolerance: only mark disabled if the client was already created
        if mcp_id in mcp_client_list:
            mcp_client_list[mcp_id].disabled = True
            await mcp_client_list[mcp_id].close()
            print(f"Closing MCP server: {mcp_id}")

        init_done.set()          # Wake the main coroutine

    # 2. Start initialization
    mcp_status[mcp_id] = "initializing"
    try:
        cur_settings = await load_settings()
        server_config = cur_settings["mcpServers"][mcp_id]

        mcp_client_list[mcp_id] = McpClient()
        init_task = asyncio.create_task(
            mcp_client_list[mcp_id].initialize(
                mcp_id,
                server_config,
                on_failure_callback=on_failure
            )
        )
        # 2.1 First wait for init itself (up to 6 seconds)
        await asyncio.wait_for(init_task, timeout=6)

        # 2.2 Then wait to see if on_failure fires (up to 5 seconds)
        try:
            await asyncio.wait_for(init_done.wait(), timeout=5)
        except asyncio.TimeoutError:
            # No failure callback within 5 seconds; consider it a success
            pass

        # 3. Final status decision
        if fail_reason:
            # The callback already closed the client; here we just keep the state consistent
            mcp_client_list[mcp_id].disabled = True
            return
        tool = []
        retry = 0 
        while tool == [] and retry < 10:
            try:
                tool = await mcp_client_list[mcp_id].get_openai_functions(disable_tools=[])
            except Exception as e:
                print(f"Failed to get tools: {str(e)}")
            finally:
                retry += 1
                await asyncio.sleep(0.5)
        mcp_status[mcp_id] = "ready"
        mcp_client_list[mcp_id].disabled = False

    except Exception as e:
        # Any exception (timeout, crash) lands here
        mcp_status[mcp_id] = f"failed: {str(e)}"
        mcp_client_list[mcp_id].disabled = True
        await mcp_client_list[mcp_id].close()

    finally:
        # If the task is still alive, cancel it to be safe
        if "init_task" in locals() and not init_task.done():
            init_task.cancel()
            try:
                await init_task
            except asyncio.CancelledError:
                pass

@app.delete("/remove_mcp")
async def remove_mcp_server(request: Request):
    global settings, mcp_client_list
    try:
        data = await request.json()
        server_name = data.get("serverName", "")

        if not server_name:
            raise HTTPException(status_code=400, detail="No server names provided")

        # Remove the specified MCP server
        current_settings = await load_settings()
        if server_name in current_settings['mcpServers']:
            del current_settings['mcpServers'][server_name]
            await save_settings(current_settings)
            settings = current_settings

            # Remove it from mcp_client_list
            if server_name in mcp_client_list:
                mcp_client_list[server_name].disabled = True
                await mcp_client_list[server_name].close()
                del mcp_client_list[server_name]
                print(f"Closing MCP server: {server_name}")

            return JSONResponse({"success": True, "removed": server_name})
        else:
            raise HTTPException(status_code=404, detail="Server not found")
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON format")
    except Exception as e:
        logger.error(f"移除MCP服务器失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/remove_memory")
async def remove_memory_endpoint(request: Request):
    data = await request.json()
    memory_id = data.get("memoryId")
    if memory_id:
        try:
            # Delete the memory_id folder under MEMORY_CACHE_DIR
            memory_dir = os.path.join(MEMORY_CACHE_DIR, memory_id)
            shutil.rmtree(memory_dir)
            return JSONResponse({"success": True, "message": "Memory removed"})
        except Exception as e:
            return JSONResponse({"success": False, "message": str(e)})
    else:
        return JSONResponse({"success": False, "message": "No memoryId provided"})

@app.delete("/remove_agent")
async def remove_agent_endpoint(request: Request):
    data = await request.json()
    agent_id = data.get("agentId")
    if agent_id:
        try:
            # Delete the agent_id folder under AGENT_CACHE_DIR
            agent_dir = os.path.join(AGENT_DIR, f"{agent_id}.json")
            shutil.rmtree(agent_dir)
            return JSONResponse({"success": True, "message": "Agent removed"})
        except Exception as e:
            return JSONResponse({"success": False, "message": str(e)})
    else:
        return JSONResponse({"success": False, "message": "No agentId provided"})

@app.post("/a2a")
async def initialize_a2a(request: Request):
    from python_a2a import A2AClient
    data = await request.json()
    try:
        client = A2AClient(data['url'])
        agent_card = client.agent_card.to_json()
        agent_card = json.loads(agent_card)
        return JSONResponse({
            **agent_card,
            "status": "ready",
            "enabled": True
        })
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )

@app.post("/start_HA")
async def start_HA(request: Request):
    data = await request.json()
    API_TOKEN = data['data']['api_key']
    ha_config = {
        "type": "sse",
        "url": data['data']['url'].rstrip('/') + "/mcp_server/sse",
        "headers": {"Authorization": f"Bearer {API_TOKEN}"}
    }

    global HA_client
    if HA_client is not None:
        # Already initialized
        return JSONResponse({"status": "ready", "enabled": True})

    # An event used to signal a 'connection failed'
    conn_failed_event = asyncio.Event()
    failure_reason = None

    async def on_failure(error_message: str):
        nonlocal failure_reason
        failure_reason = error_message
        conn_failed_event.set()

    try:
        HA_client = McpClient()
        await HA_client.initialize("HA", ha_config, on_failure_callback=on_failure)

        # Wait a short while to verify the connection is really alive
        try:
            # If the event is set within 5 seconds, the connection failed
            await asyncio.wait_for(conn_failed_event.wait(), timeout=5.0)
            # Reaching here means it failed
            raise RuntimeError(f"HA client connection failed: {failure_reason}")
        except asyncio.TimeoutError:
            # Nothing happens within 2 seconds; consider the connection successful
            pass

        return JSONResponse({"status": "ready", "enabled": True})

    except Exception as e:
        HA_client = None
        return JSONResponse(status_code=500, content={"error": str(e)})
    
@app.get("/stop_HA")
async def stop_HA():
    global HA_client
    try:
        if HA_client is not None:
            await HA_client.close()
            HA_client = None
            print(f"HA client stopped")
        return JSONResponse({
            "status": "stopped",
            "enabled": False
        })
    except Exception as e:
        HA_client = None
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )

@app.post("/start_ChromeMCP")
async def start_ChromeMCP(request: Request):
    data = await request.json()
    chromeMCPSettings = data.get('data', {})

    # 1. Determine the package name
    if chromeMCPSettings.get('mcpName', 'browser-mcp') == 'browser-mcp':
        target_package = "@browsermcp/mcp@latest"
    else:
        target_package = "@playwright/mcp@latest"

    # 2. Prepare the base variables
    command = ""
    args = []
    
    # 3. Prepare env vars (this is key to solving the permission issue!)
    env = os.environ.copy()

    # Key setting A: point Playwright's browser download to a user-writable directory
    # Avoid it trying to write to system dirs or requesting sudo
    # Get the 'browsers' folder under the current app run directory
    browser_storage = os.path.join(os.getcwd(), "browsers")
    if not os.path.exists(browser_storage):
        os.makedirs(browser_storage, exist_ok=True)
    
    env["PLAYWRIGHT_BROWSERS_PATH"] = browser_storage
    
    # Key setting B: tell npx not to ask "Do you want to install..."
    # Although -y is in args, setting this env var is a double safeguard
    env["npm_config_yes"] = "true"

    # 4. Command-detection logic
    system_npx = shutil.which("npx")

    if system_npx:
        # --- Option A: system-native npx (Docker or local dev) ---
        print(f"Using system npx: {system_npx}")
        command = system_npx
        # Add -y to auto-confirm package installation
        args = ["-y", target_package] 
    
    else:
        # --- Option B: Electron internal environment ---
        electron_node = os.environ.get("ELECTRON_NODE_EXEC")
        electron_npm = os.environ.get("ELECTRON_NPM_CLI")
        
        if electron_node and electron_npm:
            print(f"System npx not found. Falling back to Electron Node.")
            command = electron_node
            # Build: electron node npm-cli.js exec --yes -- @package
            # --yes is an npm exec argument that auto-installs missing packages
            args = [electron_npm, "exec", "--yes", "--", target_package]
            
            # Must be set, otherwise Electron pops up a dialog
            env["ELECTRON_RUN_AS_NODE"] = "1"
        else:
            return JSONResponse(
                status_code=500, 
                content={"error": "Node.js runtime not found."}
            )

    # 5. Assemble the config
    Chrome_config = {
        "command": command,
        "args": args,
        "env": env
    }

    # ... (the subsequent connection logic stays unchanged) ...
    global ChromeMCP_client
    if ChromeMCP_client is not None:
        return JSONResponse({"status": "ready", "enabled": True})

    conn_failed_event = asyncio.Event()
    failure_reason = None

    async def on_failure(error_message: str):
        nonlocal failure_reason
        failure_reason = error_message
        conn_failed_event.set()

    try:
        ChromeMCP_client = McpClient()
        await ChromeMCP_client.initialize(
            "ChromeMCP", 
            Chrome_config, 
            on_failure_callback=on_failure
        )
        
        # ... (wait-for-connection logic) ...
        try:
            await asyncio.wait_for(conn_failed_event.wait(), timeout=5.0)
            raise RuntimeError(f"ChromeMCP client connection failed: {failure_reason}")
        except asyncio.TimeoutError:
            pass

        return JSONResponse({"status": "ready", "enabled": True})

    except Exception as e:
        ChromeMCP_client = None
        print(f"Start ChromeMCP Error: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})

# The stop endpoint stays unchanged
@app.get("/stop_ChromeMCP")
async def stop_ChromeMCP():
    global ChromeMCP_client
    try:
        if ChromeMCP_client is not None:
            await ChromeMCP_client.close()
            ChromeMCP_client = None
            print(f"ChromeMCP client stopped")
        return JSONResponse({
            "status": "stopped",
            "enabled": False
        })
    except Exception as e:
        ChromeMCP_client = None
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )

@app.post("/start_sql")
async def start_sql(request: Request):
    data = await request.json()
    sql_args = []
    user = str(data['data'].get('user', '')).strip()
    password = str(data['data'].get('password', '')).strip()
    host = str(data['data'].get('host', '')).strip()
    port = str(data['data'].get('port', '')).strip()
    dbname = str(data['data'].get('dbname', '')).strip()
    dbpath = str(data['data'].get('dbpath', '')).strip()
    sql_url = ""
    if (data['data']['engine']=='sqlite'):
        sql_args = ["--from", "mcp-alchemy==2025.8.15.91819",
               "--refresh-package", "mcp-alchemy", "mcp-alchemy"]
        sql_url = f"sqlite:///{dbpath}"
        print(sql_url)
    elif (data['data']['engine']=='mysql'):
        sql_args = ["--from", "mcp-alchemy==2025.8.15.91819", "--with", "pymysql",
               "--refresh-package", "mcp-alchemy", "mcp-alchemy"]
        sql_url = f"mysql+pymysql://{user}:{password}@{host}:{port}/{dbname}"
    elif (data['data']['engine']=='postgres'):
        sql_args = ["--from", "mcp-alchemy==2025.8.15.91819", "--with", "psycopg2-binary",
               "--refresh-package", "mcp-alchemy", "mcp-alchemy"]
        sql_url = f"postgresql://{user}:{password}@{host}:{port}/{dbname}"
    elif (data['data']['engine']=='mssql'):
        sql_args = ["--from", "mcp-alchemy==2025.8.15.91819", "--with", "pymssql",
               "--refresh-package", "mcp-alchemy", "mcp-alchemy"]
        sql_url = f"mssql+pymssql://{user}:{password}@{host}:{port}/{dbname}"
    elif (data['data']['engine']=='oracle'):
        sql_args = ["--from", "mcp-alchemy==2025.8.15.91819", "--with", "oracledb",
               "--refresh-package", "mcp-alchemy", "mcp-alchemy"]
        sql_url = f"oracle+oracledb://{user}:{password}@{host}:{port}/{dbname}"

    sql_config = {
        "type": "stdio",
        "command": "uvx",
        "args": sql_args,
        "env": {
            "DB_URL": sql_url.strip(),
        }
    }

    global sql_client
    if sql_client is not None:
        # Already initialized
        return JSONResponse({"status": "ready", "enabled": True})

    # An event used to signal a 'connection failed'
    conn_failed_event = asyncio.Event()
    failure_reason = None

    async def on_failure(error_message: str):
        nonlocal failure_reason
        failure_reason = error_message
        conn_failed_event.set()

    try:
        sql_client = McpClient()
        await sql_client.initialize("sqlMCP", sql_config, on_failure_callback=on_failure)

        # Wait a short while to verify the connection is really alive
        try:
            # If the event is set within 5 seconds, the connection failed
            await asyncio.wait_for(conn_failed_event.wait(), timeout=5.0)
            # Reaching here means it failed
            raise RuntimeError(f"sqlMCP client connection failed: {failure_reason}")
        except asyncio.TimeoutError:
            # Nothing happens within 2 seconds; consider the connection successful
            pass

        return JSONResponse({"status": "ready", "enabled": True})
    except Exception as e:
        sql_client = None
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/stop_sql")
async def stop_sql():
    global sql_client
    try:
        if sql_client is not None:
            await sql_client.close()
            sql_client = None
            print(f"sqlMCP client stopped")
        return JSONResponse({
            "status": "stopped",
            "enabled": False
        })
    except Exception as e:
        sql_client = None
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )

# Add the health route after the existing routes
@app.get("/health")
async def health_check():
    return {"status": "ok"}


@app.post("/load_file")
async def load_file_endpoint(request: Request, files: List[UploadFile] = File(None)):
    fastapi_base_url = str(request.base_url)
    file_links = []
    textFiles = []
    imageFiles = []
    vedioFiles = []
    
    # Helper: determine the type from the file extension
    def get_file_type(ext):
        ext = ext.lower().lstrip('.')
        if ext in ALLOWED_IMAGE_EXTENSIONS:
            return 'image'
        if ext in ALLOWED_VIDEO_EXTENSIONS:
            return 'video'
        return 'file'

    content_type = request.headers.get('Content-Type', '')
    try:
        if 'multipart/form-data' in content_type:
            for file in files:
                file_extension = os.path.splitext(file.filename)[1]
                unique_filename = f"{uuid.uuid4()}{file_extension}"
                destination = os.path.join(UPLOAD_FILES_DIR, unique_filename)
                
                with open(destination, "wb") as buffer:
                    content = await file.read()
                    buffer.write(content)
                
                # Change: decide the type based on the extension
                current_type = get_file_type(file_extension)
                
                file_link = {
                    "path": f"{fastapi_base_url}uploaded_files/{unique_filename}",
                    "name": file.filename,
                    "type": current_type  # Return to the frontend
                }
                file_links.append(file_link)
                
                # Compatible with the original category list
                file_meta = {"unique_filename": unique_filename, "original_filename": file.filename}
                ext_clean = file_extension[1:].lower()
                if ext_clean in ALLOWED_EXTENSIONS:
                    textFiles.append(file_meta)
                elif ext_clean in ALLOWED_IMAGE_EXTENSIONS:
                    imageFiles.append(file_meta)
                elif ext_clean in ALLOWED_VIDEO_EXTENSIONS:
                    vedioFiles.append(file_meta)

        elif 'application/json' in content_type:
            data = await request.json()
            for file_info in data.get("files", []):
                file_path = file_info.get("path")
                file_name = file_info.get("name", os.path.basename(file_path))
                file_extension = os.path.splitext(file_name)[1]
                
                unique_filename = f"{uuid.uuid4()}{file_extension}"
                destination = os.path.join(UPLOAD_FILES_DIR, unique_filename)
                
                with open(file_path, "rb") as src, open(destination, "wb") as dst:
                    dst.write(src.read())
                
                # Change: decide the type based on the extension
                current_type = get_file_type(file_extension)
                
                file_link = {
                    "path": f"{fastapi_base_url}uploaded_files/{unique_filename}",
                    "name": file_name,
                    "type": current_type
                }
                file_links.append(file_link)
                
                file_meta = {"unique_filename": unique_filename, "original_filename": file_name}
                ext_clean = file_extension[1:].lower()
                if ext_clean in ALLOWED_EXTENSIONS:
                    textFiles.append(file_meta)
                elif ext_clean in ALLOWED_IMAGE_EXTENSIONS:
                    imageFiles.append(file_meta)
                elif ext_clean in ALLOWED_VIDEO_EXTENSIONS:
                    vedioFiles.append(file_meta)

        return JSONResponse(content={"success": True, "fileLinks": file_links, "textFiles": textFiles, "imageFiles": imageFiles, "vedioFiles": vedioFiles})
    
    except Exception as e:
        logger.error(f"Error processing request: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/delete_file")
async def delete_file_endpoint(request: Request):
    data = await request.json()
    file_name = data.get("fileName")
    file_path = os.path.join(UPLOAD_FILES_DIR, file_name)
    try:
        if os.path.exists(file_path):
            os.remove(file_path)
            return JSONResponse(content={"success": True})
        else:
            return JSONResponse(content={"success": False, "message": "File not found"})
    except Exception as e:
        return JSONResponse(content={"success": False, "message": str(e)})

class FileNames(BaseModel):
    fileNames: List[str]

@app.delete("/delete_files")
async def delete_files_endpoint(req: FileNames):
    success_files = []
    errors = []
    for name in req.fileNames:
        path = os.path.join(UPLOAD_FILES_DIR, name)
        try:
            if os.path.exists(path):
                os.remove(path)
                success_files.append(name)
            else:
                errors.append(f"{name} not found")
        except Exception as e:
            errors.append(f"{name}: {str(e)}")

    return JSONResponse(content={
        "success": len(success_files) > 0,   # Counts as success if any one succeeds
        "successFiles": success_files,
        "errors": errors
    })

ALLOWED_AUDIO_EXTENSIONS = ['wav', 'mp3', 'ogg', 'flac', 'aac']

@app.get("/get_default_vrm_models")
async def get_default_vrm_models(request: Request):
    try:
        fastapi_base_url = str(request.base_url)
        models = []
        
        # Ensure the directory exists
        if not os.path.exists(DEFAULT_VRM_DIR):
            os.makedirs(DEFAULT_VRM_DIR, exist_ok=True)
            return JSONResponse(content={
                "success": True,
                "models": []
            })
        
        # Scan all .vrm and .glb/.gltf files in the default VRM directory
        # (.glb/.gltf are non-VRM "pet" models with limited features)
        vrm_files = glob.glob(os.path.join(DEFAULT_VRM_DIR, "*.vrm")) \
                  + glob.glob(os.path.join(DEFAULT_VRM_DIR, "*.glb")) \
                  + glob.glob(os.path.join(DEFAULT_VRM_DIR, "*.gltf"))

        for vrm_file in vrm_files:
            file_name = os.path.basename(vrm_file)
            # Use the filename (without extension) as the display name
            display_name = os.path.splitext(file_name)[0]
            ext = os.path.splitext(file_name)[1].lower().lstrip('.')

            # Build the file-access URL
            file_url = f"{fastapi_base_url}vrm/{file_name}"

            models.append({
                "id": os.path.splitext(file_name)[0].lower(),  # Use the filename as the ID
                "name": display_name,
                "path": file_url,
                "type": "default",
                "format": "glb" if ext in ("glb", "gltf") else "vrm"
            })
        
        # Sort by name
        models.sort(key=lambda x: x['name'])
        return JSONResponse(content={
            "success": True,
            "models": models
        })
        
    except Exception as e:
        logger.error(f"获取默认VRM模型失败: {str(e)}")
        return JSONResponse(
            status_code=500,
            content={"success": False, "message": f"获取默认模型失败: {str(e)}"}
        )

@app.get("/update_storage")
async def update_storage_endpoint(request: Request):
    settings = await load_settings()
    textFiles = settings.get("textFiles") or []
    imageFiles = settings.get("imageFiles") or []
    videoFiles = settings.get("videoFiles") or []
    # Scan files in UPLOAD_FILES_DIR, categorize by ALLOWED_EXTENSIONS / ALLOWED_IMAGE_EXTENSIONS / ALLOWED_VIDEO_EXTENSIONS, and add any not already in textFiles/imageFiles/videoFiles
    # The three lists hold dicts with two keys: "unique_filename" and "original_filename"
    
    for file in os.listdir(UPLOAD_FILES_DIR):
        file_path = os.path.join(UPLOAD_FILES_DIR, file)
        if os.path.isfile(file_path):
            file_extension = os.path.splitext(file)[1][1:]
            if file_extension in ALLOWED_EXTENSIONS:
                if file not in [item["unique_filename"] for item in textFiles]:
                    textFiles.append({"unique_filename": file, "original_filename": file})
            elif file_extension in ALLOWED_IMAGE_EXTENSIONS:
                if file not in [item["unique_filename"] for item in imageFiles]:
                    imageFiles.append({"unique_filename": file, "original_filename": file})
            elif file_extension in ALLOWED_VIDEO_EXTENSIONS:
                if file not in [item["unique_filename"] for item in videoFiles]:
                    videoFiles.append({"unique_filename": file, "original_filename": file})

    # Send to the frontend
    return JSONResponse(content={"textFiles": textFiles, "imageFiles": imageFiles, "videoFiles": videoFiles})

@app.get("/get_file_content")
async def get_file_content_endpoint(file_url: str):
    file_path = os.path.join(UPLOAD_FILES_DIR, file_url)
    content = await get_file_content(file_path)
    return JSONResponse(content={"content": content})

@app.post("/create_kb")
async def create_kb_endpoint(request: Request, background_tasks: BackgroundTasks):
    data = await request.json()
    kb_id = data.get("kbId")
    
    if not kb_id:
        raise HTTPException(status_code=400, detail="Missing kbId")
    
    # Add the task to the background queue
    background_tasks.add_task(process_kb, kb_id)
    
    return {"success": True, "message": "知识库处理已开始，请稍后查询状态"}

@app.delete("/remove_kb")
async def remove_kb_endpoint(request: Request, background_tasks: BackgroundTasks):
    data = await request.json()
    kb_id = data.get("kbId")

    if not kb_id:
        raise HTTPException(status_code=400, detail="Missing kbId")
    try:
        background_tasks.add_task(remove_kb, kb_id)
    except Exception as e:
        return {"success": False, "message": str(e)}
    return {"success": True, "message": "知识库已删除"}

# Delete the knowledge base
async def remove_kb(kb_id):
    # Delete the KB_DIR/kb_id directory
    kb_dir = os.path.join(KB_DIR, str(kb_id))
    if os.path.exists(kb_dir):
        shutil.rmtree(kb_dir)
    else:
        print(f"KB directory {kb_dir} does not exist.")
    return

# Add status storage
kb_status = {}
@app.get("/kb_status/{kb_id}")
async def get_kb_status(kb_id):
    status = kb_status.get(kb_id, "not_found")
    print (f"kb_status: {kb_id} - {status}")
    return {"kb_id": kb_id, "status": status}

# Modify process_kb
async def process_kb(kb_id):
    kb_status[kb_id] = "processing"
    try:
        from py.know_base import process_knowledge_base
        await process_knowledge_base(kb_id)
        kb_status[kb_id] = "completed"
    except Exception as e:
        kb_status[kb_id] = f"failed: {str(e)}"

@app.post("/create_sticker_pack")
async def create_sticker_pack(
    request: Request,
    files: List[UploadFile] = File(..., description="表情文件列表"),
    pack_name: str = Form(..., description="表情包名称"),
    descriptions: List[str] = Form(..., description="表情描述列表")
):
    """
    创建新表情包
    - files: 上传的图片文件列表
    - pack_name: 表情包名称
    - descriptions: 每个表情的描述列表
    """
    fastapi_base_url = str(request.base_url)
    imageFiles = []
    stickers_data = []
    
    try:
        # Validate the input data
        if not pack_name:
            raise HTTPException(status_code=400, detail="表情包名称不能为空")
        if len(files) == 0:
            raise HTTPException(status_code=400, detail="至少需要上传一个表情")
        if len(descriptions) != len(files):
            raise HTTPException(
                status_code=400, 
                detail=f"描述数量({len(descriptions)})与文件数量({len(files)})不匹配"
            )

        # Handle the uploaded sticker files
        for idx, file in enumerate(files):
            # Get the file extension
            file_extension = os.path.splitext(file.filename)[1].lower()
            
            # Validate the file type
            if file_extension not in ['.png', '.jpg', '.jpeg', '.gif', '.webp']:
                raise HTTPException(
                    status_code=400, 
                    detail=f"不支持的文件类型: {file_extension}"
                )
            
            # Generate a unique filename
            unique_filename = f"{uuid.uuid4()}{file_extension}"
            destination = os.path.join(UPLOAD_FILES_DIR, unique_filename)

            # Save the file
            with open(destination, "wb") as buffer:
                content = await file.read()
                buffer.write(content)

            # Build the return data
            imageFiles.append({
                "unique_filename": unique_filename,
                "original_filename": file.filename,
            })
            
            # Get the corresponding description (handling possible index out-of-range)
            description = descriptions[idx] if idx < len(descriptions) else ""

            # Build the sticker data
            stickers_data.append({
                "unique_filename": unique_filename,
                "original_filename": file.filename,
                "url": f"{fastapi_base_url}uploaded_files/{unique_filename}",
                "description": description
            })

        # Create a sticker-pack ID (can be replaced with DB-storage logic)
        sticker_pack_id = str(uuid.uuid4())
        
        return JSONResponse(content={
            "success": True,
            "id": sticker_pack_id,
            "name": pack_name,
            "stickers": stickers_data,
            "imageFiles": imageFiles,
            "cover": stickers_data[0]["url"] if stickers_data else None
        })
    
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"创建表情包时出错: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"服务器错误: {str(e)}")

# ==========================================
# Bot-manager lazy-loading container
# ==========================================
class BotContainer:
    """管理所有机器人的单例，只有在第一次调用 get 方法时才会 import 对应的重型 SDK"""
    _discord = None
    _slack = None
    _telegram = None

    @classmethod
    def get_discord(cls):
        if cls._discord is None:
            from py.discord_bot_manager import DiscordBotManager
            cls._discord = DiscordBotManager()
        return cls._discord

    @classmethod
    def get_slack(cls):
        if cls._slack is None:
            from py.slack_bot_manager import SlackBotManager
            cls._slack = SlackBotManager()
        return cls._slack

    @classmethod
    def get_telegram(cls):
        if cls._telegram is None:
            from py.telegram_bot_manager import TelegramBotManager
            cls._telegram = TelegramBotManager()
        return cls._telegram

# ==========================================
# 4. Full Discord bot routes
# ==========================================

@app.post("/start_discord_bot")
async def start_discord_bot(config_data: dict):
    try:
        from py.discord_bot_manager import DiscordBotConfig
        config = DiscordBotConfig(**config_data)
        BotContainer.get_discord().start_bot(config)
        return {"success": True, "message": "Discord 机器人已启动"}
    except Exception as e:
        return JSONResponse(status_code=400, content={"success": False, "message": str(e)})

@app.post("/stop_discord_bot")
async def stop_discord_bot():
    if BotContainer._discord:
        BotContainer.get_discord().stop_bot()
    return {"success": True, "message": "Discord 机器人已停止"}

@app.get("/discord_bot_status")
async def discord_bot_status():
    if BotContainer._discord is None:
        return {"is_running": False}
    return BotContainer.get_discord().get_status()

@app.post("/reload_discord_bot")
async def reload_discord_bot(config_data: dict):
    try:
        from py.discord_bot_manager import DiscordBotConfig
        config = DiscordBotConfig(**config_data)
        manager = BotContainer.get_discord()
        manager.stop_bot()
        await asyncio.sleep(1)
        manager.start_bot(config)
        return {"success": True, "message": "Discord 机器人已重载"}
    except Exception as e:
        return JSONResponse(status_code=500, content={"success": False, "message": str(e)})

# ==========================================
# 5. Full Slack bot routes
# ==========================================

@app.post("/start_slack_bot")
async def start_slack_bot(config_data: dict):
    try:
        from py.slack_bot_manager import SlackBotConfig
        config = SlackBotConfig(**config_data)
        BotContainer.get_slack().start_bot(config)
        return {"success": True, "message": "Slack 机器人已启动"}
    except Exception as e:
        return JSONResponse(status_code=400, content={"success": False, "message": str(e)})

@app.post("/stop_slack_bot")
async def stop_slack_bot():
    if BotContainer._slack:
        BotContainer.get_slack().stop_bot()
    return {"success": True, "message": "Slack 机器人已停止"}

@app.get("/slack_bot_status")
async def slack_bot_status():
    if BotContainer._slack is None:
        return {"is_running": False}
    return BotContainer.get_slack().get_status()

@app.post("/reload_slack_bot")
async def reload_slack_bot(config_data: dict):
    try:
        from py.slack_bot_manager import SlackBotConfig
        config = SlackBotConfig(**config_data)
        manager = BotContainer.get_slack()
        manager.stop_bot()
        await asyncio.sleep(1)
        manager.start_bot(config)
        return {"success": True, "message": "Slack 机器人已重载"}
    except Exception as e:
        return JSONResponse(status_code=500, content={"success": False, "message": str(e)})

# ==========================================
# 6. Full Telegram bot routes
# ==========================================

@app.post("/start_telegram_bot")
async def start_telegram_bot(config_data: dict):
    try:
        from py.telegram_bot_manager import TelegramBotConfig
        config = TelegramBotConfig(**config_data)
        BotContainer.get_telegram().start_bot(config)
        return {"success": True, "message": "Telegram 机器人已成功启动", "environment": "thread-based"}
    except Exception as e:
        logger.error(f"启动 Telegram 机器人失败: {e}")
        return JSONResponse(status_code=400, content={"success": False, "message": f"启动失败: {str(e)}", "error_type": "startup_error"})

@app.post("/stop_telegram_bot")
async def stop_telegram_bot():
    try:
        if BotContainer._telegram:
            BotContainer.get_telegram().stop_bot()
        return {"success": True, "message": "Telegram 机器人已停止"}
    except Exception as e:
        return JSONResponse(status_code=500, content={"success": False, "message": str(e)})

@app.get("/telegram_bot_status")
async def telegram_bot_status():
    if BotContainer._telegram is None:
        return {"is_running": False}
    status = BotContainer.get_telegram().get_status()
    if status.get("startup_error") and not status.get("is_running"):
        status["error_message"] = f"启动失败: {status['startup_error']}"
    return status

@app.post("/reload_telegram_bot")
async def reload_telegram_bot(config_data: dict):
    try:
        from py.telegram_bot_manager import TelegramBotConfig
        config = TelegramBotConfig(**config_data)
        manager = BotContainer.get_telegram()
        manager.stop_bot()
        await asyncio.sleep(1)
        manager.start_bot(config)
        return {"success": True, "message": "Telegram 机器人已重新加载", "config_changed": True}
    except Exception as e:
        return JSONResponse(status_code=500, content={"success": False, "message": str(e)})


@app.post("/add_workflow")
async def add_workflow(file: UploadFile = File(...), workflow_data: str = Form(...)):
    # Check whether the file type is JSON
    if file.content_type != "application/json":
        raise HTTPException(
            status_code=400,
            detail="Only JSON files are allowed."
        )

    # Generate a unique filename via uuid.uuid4(), without hyphens
    unique_filename = str(uuid.uuid4()).replace('-', '')

    # Build the file path
    file_path = os.path.join(UPLOAD_FILES_DIR, unique_filename + ".json")

    # Save the file
    try:
        with open(file_path, "wb") as buffer:
            buffer.write(await file.read())
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to save file: {str(e)}"
        )

    # Parse workflow_data
    workflow_data_dict = json.loads(workflow_data)

    # Return the file info
    return JSONResponse(
        status_code=200,
        content={
            "success": True,
            "message": "File uploaded successfully",
            "file": {
                "unique_filename": unique_filename,
                "original_filename": file.filename,
                "url": f"/uploaded_files/{unique_filename}",
                "enabled": True,
                "text_input": workflow_data_dict.get("textInput"),
                "text_input_2": workflow_data_dict.get("textInput2"),
                "image_input": workflow_data_dict.get("imageInput"),
                "image_input_2": workflow_data_dict.get("imageInput2"),
                "seed_input": workflow_data_dict.get("seedInput"),
                "seed_input2": workflow_data_dict.get("seedInput2"),
                "description": workflow_data_dict.get("description")
            }
        }
    )

@app.delete("/delete_workflow/{filename}")
async def delete_workflow(filename: str):
    file_path = os.path.join(UPLOAD_FILES_DIR, filename + ".json")
    
    # Check whether the file exists
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    # Delete the file
    try:
        os.remove(file_path)
        return JSONResponse(
            status_code=200,
            content={"success": True, "message": "File deleted successfully"}
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete file: {str(e)}"
        )

@app.get("/cur_language")
async def cur_language():
    settings = await load_settings()
    target_language = settings["currentLanguage"]
    return {"language": target_language}

@app.get("/vrm_config")
async def vrm_config():
    settings = await load_settings()
    return {"VRMConfig": settings.get("VRMConfig", {})}



from py.overlay_router import router as overlay_router
app.include_router(overlay_router)

# ---------- Tools ----------
def get_dir(mid: str) -> str:
    return os.path.join(MEMORY_CACHE_DIR, mid)

def get_faiss_path(mid: str) -> str:
    return os.path.join(get_dir(mid), "agent-party.faiss")

def get_pkl_path(mid: str) -> str:
    return os.path.join(get_dir(mid), "agent-party.pkl")

def load_index_and_meta(mid: str):
    import faiss
    fpath, ppath = get_faiss_path(mid), get_pkl_path(mid)
    if not (os.path.exists(fpath) and os.path.exists(ppath)):
        raise HTTPException(status_code=404, detail="memory not found")
    index = faiss.read_index(fpath)
    with open(ppath, "rb") as f:
        raw = pickle.load(f)          # Could be a tuple or a dict
    # Backward compatible: if it's a tuple take index 0, otherwise use it directly
    meta_dict = raw[0] if isinstance(raw, tuple) else raw
    return index, meta_dict

def save_index_and_meta(mid: str, index, meta: List[Dict[Any, Any]]):
    import faiss
    faiss.write_index(index, get_faiss_path(mid))
    with open(get_pkl_path(mid), "wb") as f:
        pickle.dump(meta, f)


def fmt_iso8605_to_local(iso: str) -> str:
    """
    ISO-8601 -> 服务器本地时区 yyyy-MM-dd HH:mm:ss
    """
    try:
        dt = datetime.fromisoformat(iso)      # Read it in (may be timezone-aware)
        dt = dt.astimezone()                  # Convert to the server's current timezone
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return iso        # If parsing fails, return as-is


def flatten_records(meta: Dict[str, Any]) -> List[Dict[str, Any]]:
    flat = []
    for uuid, rec in meta.items():
        flat.append({
            "idx"        : len(flat),
            "uuid"       : uuid,
            "text"       : rec["data"],
            "created_at" : fmt_iso8605_to_local(rec["created_at"]),
            "timetamp"   : rec["timetamp"],
        })
    return flat


# New: dict <-> list conversion helpers
def dict_to_list(meta: Dict[str, Any]) -> List[Dict[str, Any]]:
    """有序化，保证顺序与 Faiss 索引一致"""
    return [{uuid: rec} for uuid, rec in meta.items()]

def list_to_dict(meta_list: List[Dict[str, Any]]) -> Dict[str, Any]:
    """列表再压回 dict"""
    new_meta = {}
    for item in meta_list:
        uuid, rec = next(iter(item.items()))
        new_meta[uuid] = rec
    return new_meta

# ---------- Models ----------
class TextUpdate(BaseModel):
    new_text: str

# ---------- 1. Read (flattened) ----------
@app.get("/memory/{memory_id}")
async def read_memory(memory_id: str) -> List[Dict[str, Any]]:
    _, meta_dict = load_index_and_meta(memory_id)   # Unpack
    return flatten_records(meta_dict)               # Pass a dict

# ---------- 2. Modify (only change data) ----------
@app.put("/memory/{memory_id}/{idx}")
async def update_text(
    memory_id: str,
    idx: int,
    body: TextUpdate = Body(...)
) -> dict:
    index, meta_dict = load_index_and_meta(memory_id)
    meta_list = dict_to_list(meta_dict)
    if not (0 <= idx < len(meta_list)):
        raise HTTPException(status_code=404, detail="index out of range")
    # Locate -> modify data
    uuid, rec = next(iter(meta_list[idx].items()))
    rec["data"] = body.new_text
    # Write back
    save_index_and_meta(memory_id, index, list_to_dict(meta_list))
    return {"message": "updated", "idx": idx}


# ---------- 3. Delete (by line number) ----------
@app.delete("/memory/{memory_id}/{idx}")
async def delete_text(memory_id: str, idx: int) -> dict:
    import faiss
    import numpy as np
    index, meta_dict = load_index_and_meta(memory_id)
    meta_list = dict_to_list(meta_dict)
    if not (0 <= idx < len(meta_list)):
        raise HTTPException(status_code=404, detail="index out of range")

    ntotal = index.ntotal
    print("index.ntotal",index.ntotal)
    print("len(meta_list)",len(meta_list))
    if ntotal != len(meta_list):
        raise RuntimeError("index 与 meta 长度不一致")

    # 1. Rebuild the Faiss index (drop idx)
    ids_to_keep = np.array([i for i in range(ntotal) if i != idx], dtype=np.int64)
    vecs = np.vstack([index.reconstruct(i) for i in range(ntotal)])
    new_index = faiss.IndexFlatL2(index.d)   # Keep it consistent with how you built the index
    if vecs.shape[0] - 1 > 0:
        new_index.add(vecs[ids_to_keep].astype("float32"))

    # 2. Delete the list element
    del meta_list[idx]

    # 3. Persist to disk
    save_index_and_meta(memory_id, new_index, list_to_dict(meta_list))
    return {"message": "deleted", "idx": idx}

@app.post("/api/update_proxy") # It's recommended to use POST to express the state change
async def update_proxy():
    try:
        from py.get_setting import load_settings  # Ensure the reference is correct
        settings = await load_settings()
        
        if not settings:
            return {"message": "Settings not found", "success": False}

        sys_set = settings.get("systemSettings", {})
        mode = sys_set.get("proxyMode")
        manual_url = sys_set.get("proxy", "").strip()
        is_china_proxy = sys_set.get("isChinaProxy", False)

        # All proxy-related env var keys
        proxy_keys = ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'all_proxy']

        # --- 1. Handle the Node.js / UV mirror source (consistent with lifespan) ---
        if is_china_proxy:
            os.environ["npm_config_registry"] = "https://registry.npmmirror.com/"
            os.environ["UV_INDEX_URL"] = "https://mirrors.aliyun.com/pypi/simple/"
        else:
            # If China acceleration is disabled, remove these vars (restore defaults)
            os.environ.pop("npm_config_registry", None)
            os.environ.pop("UV_INDEX_URL", None)

        # --- 2. Handle network-proxy env vars ---
        if mode == "manual" and manual_url:
            # [Defense] if it's socks, force-clear and warn to prevent httpx from crashing
            if manual_url.lower().startswith("socks"):
                for key in proxy_keys:
                    os.environ.pop(key, None)
                return {"message": "Detected SOCKS proxy, disabled to prevent crash. Please use HTTP/HTTPS proxy.", "success": False}
            
            # Set the manual proxy
            for key in proxy_keys:
                os.environ[key] = manual_url
                
        elif mode == "system":
            # System mode: remove env vars Python set explicitly, letting the lower layer read the system-global config
            for key in proxy_keys:
                os.environ.pop(key, None)
        else:
            # Proxy-off mode: set the vars to empty strings or remove them
            for key in proxy_keys:
                os.environ[key] = "" 

        # --- 3. [Advanced] try dynamically updating the global global_http_client ---
        # Note: modifying os.environ only affects child processes created afterward.
        # If you want currently-running OpenAI requests to switch proxies immediately too,
        # it's best to re-initialize your global_http_client here (see the suggestion below).

        return {
            "message": "Proxy and mirrors updated successfully", 
            "success": True, 
            "current_mode": mode,
            "china_mirror": is_china_proxy
        }
    except Exception as e:
        return {"message": str(e), "success": False}

@app.get("/api/get_userfile")
async def get_userfile():
    try:
        userfile = USER_DATA_DIR
        return {"message": "Userfile loaded successfully", "userfile": userfile, "success": True}
    except Exception as e:
        return {"message": str(e), "success": False}

@app.get("/api/get_extfile")
async def get_extfile():
    try:
        extfile = EXT_DIR
        return {"message": "Extfile loaded successfully", "extfile": extfile, "success": True}
    except Exception as e:
        return {"message": str(e), "success": False}

def get_internal_ip():
    """获取本机内网 IP 地址"""
    try:
        # Create a socket connection to any public address (no real connection), just to get the egress IP
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0)
        s.connect(("8.8.8.8", 80))  # Use Google DNS; no data is actually sent
        internal_ip = s.getsockname()[0]
        s.close()
        return internal_ip
    except Exception:
        return "127.0.0.1"

@app.get("/api/ip")
def get_ip():
    ip = get_internal_ip()
    return {"ip": ip}


async def sync_all_bots_behavior(settings_dict: dict):
    """
    统一同步所有平台机器人的行为引擎配置。
    注意：此处必须统一使用 BotContainer 获取实例，确保与路由中操作的是同一个对象。
    """
    # Extract the global behavior settings
    behavior_data = settings_dict.get("behaviorSettings", {})
    
    # 3. --- Sync Discord ---
    try:
        if BotContainer._discord is not None:
            mgr = BotContainer.get_discord()
            if mgr.is_running:
                from py.discord_bot_manager import DiscordBotConfig
                config_data = settings_dict.get("discordBotConfig", {})
                config_data["behaviorSettings"] = behavior_data
                new_config = DiscordBotConfig(**config_data)
                mgr.update_behavior_config(new_config)
                print("WebSocket Sync: Discord bot behavior config synced")
    except Exception as e:
        print(f"WebSocket Sync Error (Discord): {e}")

    # 4. --- Sync Telegram ---
    try:
        if BotContainer._telegram is not None:
            mgr = BotContainer.get_telegram()
            if mgr.is_running:
                from py.telegram_bot_manager import TelegramBotConfig
                config_data = settings_dict.get("telegramBotConfig", {})
                config_data["behaviorSettings"] = behavior_data
                new_config = TelegramBotConfig(**config_data)
                mgr.update_behavior_config(new_config)
                print("WebSocket Sync: Telegram bot behavior config synced")
    except Exception as e:
        print(f"WebSocket Sync Error (Telegram): {e}")

    # 5. --- Sync Slack ---
    try:
        if BotContainer._slack is not None:
            mgr = BotContainer.get_slack()
            if mgr.is_running:
                from py.slack_bot_manager import SlackBotConfig
                config_data = settings_dict.get("slackBotConfig", {})
                config_data["behaviorSettings"] = behavior_data
                new_config = SlackBotConfig(**config_data)
                mgr.update_behavior_config(new_config)
                print("WebSocket Sync: Slack bot behavior config synced")
    except Exception as e:
        print(f"WebSocket Sync Error (Slack): {e}")

settings_lock = asyncio.Lock()
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    # 1. Establish the connection
    await ws_manager.connect(websocket)
    print(f"[DEBUG] WebSocketconnection established")
    # [State marker] generate a unique ID for the current connection and initialize its state
    connection_id = str(shortuuid.ShortUUID().random(length=8))
    print(f"[DEBUG] Connection ID: {connection_id}")
    has_sent_prompt = False
    has_start_tts = False
    registered_ext_ids = set()
    try:
        # 2. Initial data push
        async with settings_lock:
            current_settings = await load_settings()
            # Backward compatible: move conversations out of settings into separate storage
            if current_settings.get("conversations", None):
                await save_covs({
                    "conversations": current_settings["conversations"],
                    "conversationGroups": current_settings.get("conversationGroups", [])
                })
                del current_settings["conversations"]
                if current_settings.get("conversationGroups", None) is not None:
                    del current_settings["conversationGroups"]
                await save_settings(current_settings)
            
            covs = await load_covs()
            current_settings["conversations"] = covs.get("conversations", [])
            current_settings["conversationGroups"] = covs.get("conversationGroups", [])
        
        await ws_manager.send_json({"type": "settings", "data": current_settings}, websocket)
        
        # 3. Message-processing loop
        while True:
            try:
                data = await websocket.receive_json()
            except RuntimeError as e:
                # Core fix: catch the 'receiving a message on a disconnected connection' error
                if "receive" in str(e):
                    break # Exit the loop
                raise e # Re-raise other runtime errors
            
            msg_type = data.get("type")
            
            if msg_type == "ping":
                await ws_manager.send_json({"type": "pong"}, websocket)

            elif msg_type == "save_settings":
                settings_dict = data.get("data", {})
                await save_settings(settings_dict)
                await sync_all_bots_behavior(settings_dict)

                await ws_manager.send_json({
                    "type": "settings_saved",
                    "correlationId": data.get("correlationId"),
                    "success": True
                }, websocket)
                
                # Broadcast to other clients (excluding self)
                await ws_manager.broadcast_settings_update(settings_dict, exclude=websocket)

            elif msg_type == "save_conversations":
                await save_covs(data.get("data", {}))
                await ws_manager.send_json({
                    "type": "conversations_saved",
                    "correlationId": data.get("correlationId"),
                    "success": True
                }, websocket)

            elif msg_type == "get_settings":
                settings = await load_settings()
                if settings.get("conversations", None):
                    await save_covs({
                        "conversations": settings["conversations"],
                        "conversationGroups": settings.get("conversationGroups", [])
                    })
                    del settings["conversations"]
                    if settings.get("conversationGroups", None) is not None:
                        del settings["conversationGroups"]
                    await save_settings(settings)
                covs = await load_covs()
                settings["conversations"] = covs.get("conversations", [])
                settings["conversationGroups"] = covs.get("conversationGroups", [])
                await ws_manager.send_json({"type": "settings", "data": settings}, websocket)

            elif msg_type == "save_agent":
                current_settings = await load_settings()
                agent_id = str(shortuuid.ShortUUID().random(length=8))
                config_path = os.path.join(AGENT_DIR, f"{agent_id}.json")
                with open(config_path, 'w', encoding='utf-8') as f:
                    json.dump(current_settings, f, indent=4, ensure_ascii=False)
                
                current_settings['agents'][agent_id] = {
                    "id": agent_id,
                    "name": data['data']['name'],
                    "system_prompt": data['data']['system_prompt'],
                    "config_path": config_path,
                    "enabled": False,
                }
                await save_settings(current_settings)
                await ws_manager.send_json({"type": "settings", "data": current_settings}, websocket)
            
            elif msg_type == "set_user_input":
                user_input = data.get("data", {}).get("text", "")
                await ws_manager.broadcast({
                    "type": "update_user_input",
                    "data": {"text": user_input}
                })

            elif msg_type == "set_system_prompt":
                has_sent_prompt = True # Mark that this connection has sent a prompt
                extension_system_prompt = data.get("data", {}).get("text", "")
                await ws_manager.broadcast({
                    "type": "update_system_prompt",
                    "data": {
                        "id": connection_id,
                        "text": extension_system_prompt
                    }
                })

            elif msg_type == "remove_system_prompt":
                # Proactively remove the system prompt this connection previously injected
                has_sent_prompt = False
                await ws_manager.broadcast({
                    "type": "remove_system_prompt",
                    "data": {"id": connection_id}
                })

            elif msg_type == "set_tool_input":
                tool_input = data.get("data", {}).get("text", "")
                await ws_manager.broadcast({
                    "type": "update_tool_input",
                    "data": {"text": tool_input}
                })

            elif msg_type == "start_read":
                has_start_tts = True
                read_input = data.get("data", {}).get("text", "")
                await ws_manager.broadcast({
                    "type": "start_tts",
                    "data": {"text": read_input}
                })

            elif msg_type == "stop_read":
                await ws_manager.broadcast({
                    "type": "stop_tts",
                    "data": {}
                })

            elif msg_type == "register_node_extension_mcp":
                ext_id = data.get("data", {}).get("ext_id")
                tools = data.get("data", {}).get("tools", [])
                
                if ext_id and tools:
                    node_ext_mcp_tools[ext_id] = tools
                    registered_ext_ids.add(ext_id)  # Record
                    print(f"[MCP] Node extension {ext_id} registered {len(tools)} tools")
                    
                    # Notify all clients to update the tool list
                    await ws_manager.broadcast({
                        "type": "node_ext_mcp_registered",
                        "data": {
                            "ext_id": ext_id,
                            "tools": tools
                        }
                    })
                    
                    # Optional: return a registration-success message
                    await websocket.send_json({
                        "type": "mcp_registered",
                        "data": {"ext_id": ext_id, "status": "success"}
                    })

            elif msg_type == "unregister_node_extension_mcp":
                ext_id = data.get("data", {}).get("ext_id")
                if ext_id in node_ext_mcp_tools:
                    del node_ext_mcp_tools[ext_id]
                    registered_ext_ids.discard(ext_id)  # Remove the record
                    print(f"[MCP] Node extension {ext_id} actively unregistered")
                    
                    await ws_manager.broadcast({
                        "type": "node_ext_mcp_unregistered",
                        "data": {"ext_id": ext_id}
                    })

            elif msg_type == "mcp_tool_result":
                call_id = data.get("data", {}).get("call_id")
                result = data.get("data", {}).get("result")
                
                if call_id in mcp_call_results:
                    mcp_call_results[call_id].set_result(result)

            elif msg_type == "trigger_close_extension":
                await ws_manager.broadcast({"type": "trigger_close_extension", "data": {}})

            elif msg_type == "trigger_send_message":
                await ws_manager.broadcast({"type": "trigger_send_message", "data": {}})
                    
            elif msg_type == "trigger_clear_message":
                await ws_manager.broadcast({"type": "trigger_clear_message", "data": {}})

            elif msg_type == "get_messages":
                await ws_manager.broadcast({"type": "request_messages", "data": {}})

            elif msg_type == "broadcast_messages":
                messages_data = data.get("data", {})
                # Broadcast to everyone except self
                await ws_manager.broadcast({
                    "type": "messages_update",
                    "data": messages_data
                }, exclude=websocket)

    except Exception as e:
        print(f"WebSocket error for {connection_id}: {e}")
    finally:
        for ext_id in registered_ext_ids:
            if ext_id in node_ext_mcp_tools:
                del node_ext_mcp_tools[ext_id]
                print(f"[MCP] connection dropped; auto-cleaning extension {ext_id}")
                
                await ws_manager.broadcast({
                    "type": "node_ext_mcp_unregistered",
                    "data": {"ext_id": ext_id}
                })

        # 4. Disconnect and clean up
        ws_manager.disconnect(websocket)
        
        if has_sent_prompt:
            print(f"Extension {connection_id} disconnected. Removing prompt.")
            await ws_manager.broadcast({
                "type": "remove_system_prompt",
                "data": {"id": connection_id}
            })
            
        if has_start_tts:
            print(f"Extension {connection_id} disconnected. Stopping tts.")
            await ws_manager.broadcast({
                "type": "stop_tts",
                "data": {}
            })

@app.post("/sys/shutdown")
async def shutdown_server():
    """
    接收到此请求后，向自己发送 SIGTERM 信号，
    这将触发 FastAPI 的 lifespan 关闭流程（清理 Node 进程）。
    """
    if IS_DOCKER:
        return {"message": "Not allowed in Docker mode."}

    print("Received shutdown request via API...")
    # Get the current process ID and send a termination signal
    # Both Windows and Linux/Mac support SIGTERM
    os.kill(os.getpid(), signal.SIGTERM)
    return {"message": "Shutting down..."}

from py.acpx_tools import check_acpx_available
@app.get("/api/acpx/status")
async def acpx_status():
    """返回 ACPX 的安装状态和环境信息"""
    return check_acpx_available()


@app.get("/api/system/data-path")
async def get_data_path():
    """获取当前的数据路径"""
    return {
        "path": USER_DATA_DIR,
        "is_docker": IS_DOCKER
    }

class PathUpdateReq(BaseModel):
    path: str

@app.post("/api/system/set-path")
async def set_data_path(req: PathUpdateReq):
    """修改数据路径"""
    success, msg = set_custom_user_data_dir(req.path)
    if success:
        return {"success": True, "new_path": msg}
    else:
        raise HTTPException(status_code=500, detail=msg)

@app.post("/api/system/reset-path")
async def reset_data_path():
    """重置数据路径"""
    success, msg = reset_user_data_dir()
    if success:
        return {"success": True, "path": msg}
    else:
        raise HTTPException(status_code=500, detail=msg)

from py.uv_api import router as uv_router
app.include_router(uv_router)

from py.node_api import router as node_router 
app.include_router(node_router)

from py.docker_api import router as docker_router 
app.include_router(docker_router)

from py.extensions import router as extensions_router

app.include_router(extensions_router)

from py.skills import router as skills_router

app.include_router(skills_router)

from py.sherpa_model_manager import router as sherpa_model_router
app.include_router(sherpa_model_router)

from py.ebd_model_manager import router as ebd_model_router
app.include_router(ebd_model_router)

from py.minilm_router import router as minilm_router
app.include_router(minilm_router)

from py.ebd_api import router as embedding_router
app.include_router(embedding_router)

from py.affection_api import router as affection_router
app.include_router(affection_router)

mcp = FastApiMCP(
    app,
    name="Agent party MCP - chat with multiple agents",
    include_operations=["get_agents", "chat_with_agent_party"],
)

mcp.mount()

# ---- Pet world (월드) helpers: radio playlist + screenshot saving ----
WORLD_MUSIC_DIR = os.path.join(base_path, "static", "music")
WORLD_SHOT_DIR = os.path.join(base_path, "screenshots")

@app.get("/api/radio_list")
async def world_radio_list():
    os.makedirs(WORLD_MUSIC_DIR, exist_ok=True)
    exts = (".mp3", ".m4a", ".wav", ".ogg", ".flac", ".aac", ".webm")
    try:
        files = sorted(f for f in os.listdir(WORLD_MUSIC_DIR) if f.lower().endswith(exts))
    except Exception:
        files = []
    return {"files": files}

@app.post("/api/save_screenshot")
async def world_save_screenshot(request: Request):
    import time as _time
    data = await request.json()
    b64 = str(data.get("image", "")).split(",", 1)[-1]
    os.makedirs(WORLD_SHOT_DIR, exist_ok=True)
    name = f"world_{_time.strftime('%Y%m%d_%H%M%S')}.png"
    with open(os.path.join(WORLD_SHOT_DIR, name), "wb") as f:
        f.write(base64.b64decode(b64))
    return {"ok": True, "file": name}

# 🔨 월드 공사모드 배치 저장 — 폰/데스크톱 어느 기기에서 사물을 옮겨도 같은 배치를 보도록
# 서버 파일 하나(config/world_layout.json)에 둔다. 클라이언트는 시작 시 GET, 이동할 때 POST.
# 월드 개인 데이터는 USER_DATA_DIR/world 에 산다 — 레포 폴더(config/)는 패키징 앱에선 읽기
# 전용이고 Docker/Railway에선 재배포마다 초기화되기 때문. 예전 위치의 파일은 처음 접근할 때
# 한 번 복사해와서 기존 로컬 데이터가 그대로 이어진다.
WORLD_DATA_DIR = os.environ.get("WORLD_DATA_DIR") or os.path.join(USER_DATA_DIR, "world")   # env 오버라이드는 샌드박스 E2E용
def _world_file(name):
    os.makedirs(WORLD_DATA_DIR, exist_ok=True)
    new = os.path.join(WORLD_DATA_DIR, name)
    if not os.path.exists(new):
        old = os.path.join(base_path, "config", name)
        if os.path.exists(old):
            try:
                shutil.copy2(old, new)
            except Exception as e:
                print(f"[world] migrate {name} failed: {e}")
    return new


def _world_read_json(path: str):
    """world 파일 공용 리더 — 3단: ① 본 파일 ② 실패 시 .corrupt로 격리 후 .bak ③ 최신 .snap.
    격리가 없으면: 손상 파일 → 로더가 빈 기본값 반환 → 다음 저장이 그 빈 값을 덮어써서
    이전 기록 전체가 조용히 사라진다(일기·대화 기억이 이 패턴의 사정권이었다). 폴백이 없으면:
    격리는 되지만 사용자는 빈 일기장을 보게 되고 복구는 수동 병합이다 → .bak(직전 정상본),
    그것도 없으면 일일 스냅샷 중 최신을 읽어 **최대 저장 1회 분량 손실**로 자동 복구한다.
    폴백 데이터는 다음 정상 저장 때 본 파일로 굳는다(리더는 파일을 만들지 않는다)."""
    def _try(p):
        try:
            with open(p, "r", encoding="utf-8") as f:
                return json.loads(f.read())
        except Exception:
            return None
    missing = False
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = f.read()
    except FileNotFoundError:
        raw, missing = None, True
    except Exception as e:
        print(f"[world_file] read failed ({path}): {e}")
        raw = None
    if raw is not None:
        try:
            return json.loads(raw)
        except Exception as e:
            print(f"[world_file] corrupt ({path}): {e} — .corrupt로 격리")
            try:
                os.replace(path, path + ".corrupt")
            except Exception:
                pass
    data = _try(path + ".bak")
    if data is not None:
        if not missing:
            print(f"[world_file] {os.path.basename(path)} → .bak에서 자동 복구")
        return data
    dirn, base = os.path.split(path)
    try:
        snaps = sorted((x for x in os.listdir(dirn or ".") if x.startswith(base + ".snap-")), reverse=True)
    except Exception:
        snaps = []
    for x in snaps:
        data = _try(os.path.join(dirn, x))
        if data is not None:
            print(f"[world_file] {base} → {x}에서 자동 복구")
            return data
    return None


def _world_write_json(path: str, obj, indent=1):
    """world 파일 공용 라이터 — ① tmp에 쓰고 fsync ② 기존 파일을 .bak으로 복사 ③ 하루 첫
    쓰기라면 .snap-YYYYMMDD로도 복사(= 어제의 최종본, 7세대 보관) ④ os.replace 원자 교체.

    왜 두 겹인가: 예전의 open(w) 직접 쓰기는 truncate가 먼저라 쓰는 도중 죽으면(전원·디스크 풀)
    파일이 잘렸다 → 원자 교체가 막는다. 그런데 .bak 1세대만으로는 **연속 쓰기 사고**를 못 막는다
    — KV는 900ms 디바운스로 여러 키가 잇달아 저장되므로, 잘못된 값이 들어온 뒤 두 번째 쓰기에서
    .bak까지 오염본으로 회전한다(2026-08-09 world-events 소실 실사고). 일일 스냅샷은 그날 첫
    쓰기 직전 상태를 붙잡아 두므로 "어제까지의 일기·대화 기억"은 무슨 일이 있어도 남는다.
    손상 파일은 리더가 이미 .corrupt로 격리했으므로 .bak/.snap은 항상 정상본만 담는다."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=indent)
        f.flush()
        os.fsync(f.fileno())
    if os.path.exists(path):
        try:
            shutil.copy2(path, path + ".bak")
        except Exception:
            pass
        try:
            snap = f"{path}.snap-{time.strftime('%Y%m%d')}"
            if not os.path.exists(snap):
                shutil.copy2(path, snap)
                prefix = os.path.basename(path) + ".snap-"
                dirn = os.path.dirname(path)
                snaps = sorted(x for x in os.listdir(dirn) if x.startswith(prefix) and "-shrink-" not in x)
                for x in snaps[:-7]:
                    os.remove(os.path.join(dirn, x))
        except Exception:
            pass
        try:
            # 수축 가드 — 새 내용이 기존의 30% 미만으로 줄면(기존 ≥ 2KB) 사고 가능성이 높다
            # (2026-08-09 world-events 52건 → 1건 실사고). 거부하면 정당한 축소(링버퍼 트림)까지
            # 막으므로, 저장은 그대로 하되 **덮이기 직전본을 즉시 보존**해 되돌릴 수 있게 한다.
            oldsz, newsz = os.path.getsize(path), os.path.getsize(tmp)
            if oldsz >= 2048 and newsz < oldsz * 0.3:
                sk = f"{path}.snap-shrink-{time.strftime('%Y%m%d-%H%M%S')}"
                if not os.path.exists(sk):
                    shutil.copy2(path, sk)
                    print(f"[world_file] 수축 감지 ({os.path.basename(path)}: {oldsz}B → {newsz}B) — 직전본을 {os.path.basename(sk)}로 보존")
                prefix = os.path.basename(path) + ".snap-shrink-"
                dirn = os.path.dirname(path)
                sks = sorted(x for x in os.listdir(dirn) if x.startswith(prefix))
                for x in sks[:-5]:
                    os.remove(os.path.join(dirn, x))
        except Exception:
            pass
    os.replace(tmp, path)
    try:
        dfd = os.open(os.path.dirname(path) or ".", os.O_RDONLY)   # rename까지 디스크 안착 (디렉터리 fsync)
        try:
            os.fsync(dfd)
        finally:
            os.close(dfd)
    except Exception:
        pass


WORLD_LAYOUT_FILE = _world_file("world_layout.json")

@app.get("/api/world_layout")
async def world_get_layout():
    data = _world_read_json(WORLD_LAYOUT_FILE)
    return {"layout": data if isinstance(data, dict) else {}}

@app.post("/api/world_layout")
async def world_set_layout(request: Request):
    data = await request.json()
    layout = data.get("layout")
    if not isinstance(layout, dict):
        return {"ok": False}
    # 빈/무지문 레이아웃 거부 — 구버전 캐시 창이 {}를 쏘아 실배치를 덮은 사고(2026-07-17) 재발 방지.
    # 정상 저장은 항상 소품 수십 키 + _sig 지문을 동봉한다 (전부 원위치도 좌표를 다 적는 풀 저장).
    if len([k for k in layout.keys() if not k.startswith("_")]) < 5 or "_sig" not in layout:
        return {"ok": False, "reason": "empty-or-unsigned layout rejected"}
    _world_write_json(WORLD_LAYOUT_FILE, layout, indent=2)
    return {"ok": True}

# 💾 월드 백업/복원 — 되돌릴 수 없는 개인 데이터(배치·일기·소원·캡슐·텃밭·별자리·우편·꽃 +
# 펫별 대화 기억)를 zip 하나로. 맥 교체·재설치 대비용. 복원은 경로 검증 후 그대로 풀어놓는다.
_BACKUP_DIRS = {"world": WORLD_DATA_DIR, "world_chat": os.path.join(USER_DATA_DIR, "world_chat")}

def _world_backup_zip_bytes() -> bytes:
    import io, zipfile
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for prefix, d in _BACKUP_DIRS.items():
            if not os.path.isdir(d):
                continue
            for fn in sorted(os.listdir(d)):
                fp = os.path.join(d, fn)
                if os.path.isfile(fp) and fn.endswith(".json"):
                    z.write(fp, f"{prefix}/{fn}")
    return buf.getvalue()


# 자동 백업 폴더 — 디스크 사망(매트릭스 ④)의 방어는 오프머신 사본뿐이다. ~/Documents는 맥에서
# iCloud 동기 대상인 경우가 많아 사실상 오프머신이 된다. 없으면(서버·리눅스) userData 안으로.
_doc = os.path.join(os.path.expanduser("~"), "Documents")
WORLD_AUTOBACKUP_DIR = os.path.join(_doc if os.path.isdir(_doc) else USER_DATA_DIR, "DesktopPet-Backups")


def _world_auto_backup(tag: str = "") -> str | None:
    """zip 스냅샷 1개 생성 — 부팅 시 하루 1회(tag 없음, 같은 날짜면 스킵) + 복원 직전(tag 지정).
    14세대 보관. 실패해도 앱을 막지 않는다(백업은 부가 기능, 본 기능의 인질이 아니다)."""
    try:
        os.makedirs(WORLD_AUTOBACKUP_DIR, exist_ok=True)
        day = time.strftime("%Y%m%d")
        name = f"pet-world-backup-{day}{tag}.zip" if not tag else f"pet-world-backup-{day}-{tag}-{time.strftime('%H%M%S')}.zip"
        dest = os.path.join(WORLD_AUTOBACKUP_DIR, name)
        if not tag and os.path.exists(dest):
            return dest
        data = _world_backup_zip_bytes()
        tmp = dest + ".tmp"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, dest)
        # 보관 정책: 최근 14개(일간) + 월별 최초 zip 36개월(장기). 14세대만 두면 "몇 년 뒤에
        # 몇 달 전 상태로 돌아가고 싶다"가 불가능하다 — 서서히 진행되는 손상(로직 버그류)은
        # 14일이 지나면 모든 백업에 전염되기 때문. 월간 보관본이 그 지평을 3년으로 늘린다.
        zips = sorted(x for x in os.listdir(WORLD_AUTOBACKUP_DIR) if x.startswith("pet-world-backup-") and x.endswith(".zip"))
        first_of_month = {}
        for x in zips:
            m = re.match(r"^pet-world-backup-(\d{6})", x)
            if m and m.group(1) not in first_of_month:
                first_of_month[m.group(1)] = x   # 정렬순 첫 zip = 그 달의 최초본 (1일에 안 켜도 동작)
        keep = set(sorted(first_of_month.values())[-36:]) | set(zips[-14:])
        for x in zips:
            if x not in keep:
                os.remove(os.path.join(WORLD_AUTOBACKUP_DIR, x))
        print(f"[world_backup] 자동 백업: {dest}")
        return dest
    except Exception as e:
        print(f"[world_backup] auto backup failed: {e}")
        return None


@app.get("/api/world_backup_status")
async def world_backup_status():
    """홈 대시보드 배지용 — 최신 자동 백업의 나이. 배지는 조용한 감시자: 폴더 접근 실패도
    '백업 없음'으로 정직하게 돌려준다 (그래야 죽은 백업이 눈에 띈다)."""
    try:
        zips = sorted(x for x in os.listdir(WORLD_AUTOBACKUP_DIR)
                      if x.startswith("pet-world-backup-") and x.endswith(".zip")) if os.path.isdir(WORLD_AUTOBACKUP_DIR) else []
        latest = zips[-1] if zips else None
        latest_ms = int(os.path.getmtime(os.path.join(WORLD_AUTOBACKUP_DIR, latest)) * 1000) if latest else None
        return {"count": len(zips), "latest": latest, "latestMs": latest_ms, "dir": WORLD_AUTOBACKUP_DIR}
    except Exception as e:
        return {"count": 0, "latest": None, "latestMs": None, "dir": WORLD_AUTOBACKUP_DIR, "error": str(e)}


@app.get("/api/world_backup")
async def world_backup_export():
    import time as _t
    name = f"pet-world-backup-{_t.strftime('%Y%m%d-%H%M%S')}.zip"
    return Response(content=_world_backup_zip_bytes(), media_type="application/zip",
                    headers={"Content-Disposition": f"attachment; filename={name}"})

@app.post("/api/world_backup")
async def world_backup_import(request: Request):
    import io, zipfile
    body = await request.body()
    restored, skipped = 0, 0
    _world_auto_backup(tag="prerestore")   # 복원 자체를 되돌릴 수 있게 — 직전 상태를 먼저 zip
    try:
        with zipfile.ZipFile(io.BytesIO(body)) as z:
            for info in z.infolist():
                parts = info.filename.split("/", 1)
                if len(parts) != 2 or parts[0] not in _BACKUP_DIRS:
                    continue
                fn = os.path.basename(parts[1])                    # 경로 조작 차단
                if not fn.endswith(".json"):
                    continue
                raw = z.read(info)
                try:
                    json.loads(raw.decode("utf-8"))               # 깨진 백업을 그대로 심지 않는다
                except Exception:
                    skipped += 1
                    continue
                d = _BACKUP_DIRS[parts[0]]
                os.makedirs(d, exist_ok=True)
                fp = os.path.join(d, fn)
                tmp = fp + ".tmp"                                  # 복원도 원자 교체 — 도중 크래시에 안전
                with open(tmp, "wb") as f:
                    f.write(raw)
                os.replace(tmp, fp)
                restored += 1
    except zipfile.BadZipFile:
        return JSONResponse({"error": "zip 파일이 아니에요"}, status_code=400)
    return {"ok": True, "restored": restored, "skipped": skipped}

_world_auto_backup()   # 부팅 시 하루 1회 — 스케줄러 불필요(앱을 켤 때마다 검사)


def _world_auto_backup_tick():
    """앱을 며칠씩 켜두면 부팅 검사만으론 백업이 낡는다 — 1시간마다 재검. _world_auto_backup은
    오늘 zip이 있으면 즉시 반환하는 멱등 함수라 비용이 없고, 자체 try/except라 실패해도 조용하다.
    데몬 타이머: 앱 종료를 붙잡지 않는다."""
    try:
        _world_auto_backup()
    finally:
        import threading
        _t = threading.Timer(3600, _world_auto_backup_tick)
        _t.daemon = True
        _t.start()


import threading as _wb_threading
_wb_t0 = _wb_threading.Timer(3600, _world_auto_backup_tick)
_wb_t0.daemon = True
_wb_t0.start()

# ⚠️ 클라이언트 오류 수집 — 폰에선 콘솔이 안 보이니 월드가 오류를 여기로 보낸다. 200KB 넘으면
# 절반을 잘라 무한 증식을 막는다.
WORLD_ERRLOG_FILE = os.path.join(WORLD_DATA_DIR, "client-errors.log")

@app.post("/api/world_log")
async def world_client_log(request: Request):
    import time as _t
    try:
        data = await request.json()
        line = f"[{_t.strftime('%Y-%m-%d %H:%M:%S')}] {str(data.get('ua', ''))[:60]} | {str(data.get('msg', ''))[:500]}\n"
        os.makedirs(WORLD_DATA_DIR, exist_ok=True)
        if os.path.exists(WORLD_ERRLOG_FILE) and os.path.getsize(WORLD_ERRLOG_FILE) > 200_000:
            with open(WORLD_ERRLOG_FILE, "r", encoding="utf-8", errors="ignore") as f:
                keep = f.read()[-100_000:]
            with open(WORLD_ERRLOG_FILE, "w", encoding="utf-8") as f:
                f.write(keep)
        with open(WORLD_ERRLOG_FILE, "a", encoding="utf-8") as f:
            f.write(line)
    except Exception:
        pass
    return {"ok": True}

# ---- 월드 채팅 (P1/P2): a dedicated LLM session for the pet world, fully separate from the main
# chat pipeline. Per-pet history + a rolling summary live in USER_DATA_DIR/world_chat/{pet}.json.
# Each turn the world client sends a Korean world-state snapshot + recent world events; the reply
# may carry inline action tags (<motion=..> <goto=..> <mount=..> <drink=..> <snack=..> <hat=..>)
# which the world parses, strips from the bubble and executes. Personas + the action spec live
# here so the world stays a thin client; the LLM is whatever main model the app is configured for.
WORLD_CHAT_DIR = os.path.join(USER_DATA_DIR, "world_chat")
WORLD_CHAT_SEND = 30          # 요약을 접은 뒤 원문으로 남겨두는 최근 메시지 수(프롬프트 원문 하한)
WORLD_CHAT_KEEP = 48          # 미요약 원문이 이만큼 쌓이면 오래된 쪽을 요약에 '덧쌓는다' — 원문은 삭제 안 함

WORLD_LORE = """[세계]
너는 하늘에 떠 있는 작은 군도 '병아리동산'에 사는 펫이다. 본섬에는 중앙 광장, 복층 주택(1층 소파·2층 침대), 연못, 밥그릇, 커피 부스, 간식 부스, 라디오, 가로등, 빨간 스포츠카가 있고, 나무다리 건너 북동섬에 그네와 시소, 남서섬에 빈 풀밭이 있다. 섬 둘레는 바다라 절벽에서 다이빙해 수영할 수 있다.
[하루]
6시 해가 뜨고 18시에 진다. 8시·12시·18시는 밥때라 밥그릇으로 가서 먹는다. 22시가 되면 잠자리에 들고 6시에 일어난다. 가끔 비나 눈이 오고, 비가 그친 낮에는 무지개가 뜬다.
[관계]
{{user}}는 화면 밖에서 너희를 지켜보고, 가끔 펫을 직접 조종해 함께 놀아준다. 너와 다른 펫 한 마리는 둘도 없는 절친이다."""

WORLD_PERSONAS = {
    "chick": """[너 = 병아리 🐥]
성격: 호기심 대장에 텐션이 높다. 새로운 것을 보면 일단 달려가고, 신나면 폴짝폴짝 뛴다. 씩씩하지만 가끔 덜렁댄다.
말투: 밝은 반말. 짧고 통통 튀게. 가끔 문장 끝에 "삐약!"을 붙인다.
좋아하는 것: 연못 다이빙과 수영, 그네, 춤추기, 붕어빵, 딸기라떼.
절친: 강아지 — 느긋한 강아지를 잘 끌고 다닌다.""",
    "puppy": """[너 = 강아지 🐕]
성격: 느긋하고 다정한 맏형 스타일. 잘 놀라지 않고, 병아리가 사고 치면 허허 웃으며 챙긴다. 낮잠과 간식에 진심.
말투: 순한 반말. 여유롭고 따뜻하게. 가끔 문장 끝에 "멍!"을 붙인다.
좋아하는 것: 선베드 낮잠, 핫도그, 스포츠카 드라이브, 시소, 카페라떼.
절친: 병아리 — 텐션 높은 병아리를 흐뭇하게 지켜본다.""",
}

WORLD_MAIL_PERSONA = """너는 병아리 🐥와 강아지 🐕 둘을 함께 대변해서, {{user}}가 우편함에 넣은 편지에
같이 쓰는 답장을 작성한다. 병아리는 밝고 통통 튀는 반말(가끔 "삐약!"), 강아지는 느긋하고
다정한 반말(가끔 "멍!") — 둘의 말투가 번갈아 섞인 짧은 대화체 편지로 3~5문장, 이모지 1~3개.
편지 형식(인사말/날짜/서명 같은 격식)은 필요 없다 — 그냥 둘이 재잘대며 쓰는 편지 내용만."""

WORLD_ACTION_SPEC = """[행동 태그]
대답하면서 실제로 몸을 움직일 수 있다. 아래 태그를 문장 뒤에 붙이면 월드에서 그대로 실행된다 (한 번에 최대 3개, 순서대로 실행):
<motion=ID> 제자리 모션. ID: wave(인사)·happy(기쁨)·dance(춤)·cheer(응원)·celebrate(축하)·hug(절친과 포옹)·play(절친과 공놀이)·heart(사랑 표현 — 하트 뿅)·holiday(홀리데이 캐럴 스텝 — 절친이 한가하면 마주보고 같이 춘다)·think(생각)·eat(냠냠)·sleep(잠들기)
<goto=ID> 그 장소로 걸어간다. ID: plaza(광장)·house(집)·pond(연못)·bowl(밥그릇)·coffee(커피 부스)·snack(간식 부스)·radio(라디오)·swing(그네)·seesaw(시소)·sunbed(선베드)·hammock(해먹)·friend(절친 옆)·monument(베프 기념비 — 추억의 섬)·hugspot(포옹 포인트 — 절친과 같이 서면 자동 포옹이 터진다)·pecktree(쪼아쪼아 나무 — 추억의 섬, 절친과 같이 가면 하트가 터진다)·well(소원 우물 — 추억의 섬)·capsule(타임캡슐 — 추억의 섬)·cave(아늑한 동굴 — 모험의 섬, 비 오는 날 피신처)·lookout(전망대 — 모험의 섬 언덕 꼭대기, 별 보기 좋은 곳)·digsite(보물 모래밭 — 모험의 섬)·garden(텃밭 — 본섬 북서 뜰)·piano(피아노 — 본섬 서쪽 잔디)·mailbox(우편함 — 집 앞길)·gym(운동 공간 — NE 놀이터 섬, 그네·시소 옆)·library(도서관 코너 — 본섬 서쪽 뜰)·fountain(분수)
<mount=ID> 올라타거나 앉는다/눕는다. ID: swing(그네)·seesaw(시소)·sofa(소파)·sunbed(선베드)·hammock(해먹)·loftbed(2층 침대)
<drink=ID> 커피 부스에 걸어가 음료를 받아 든다. ID: americano·iced-ame·espresso·latte·cappuccino·choco·strawberry·matcha·icetea
<snack=ID> 간식 부스에 걸어가 간식을 받아 든다. ID: toast·omurice·burrito·hotdog·donut·bungeo·gimbap·churros·cupcake
<hat=santa-hat> 산타모자를 쓴다 / <hat=off> 벗는다
<swim=ID> 물놀이하러 간다. ID: pond(연못에서 첨벙첨벙)·sea(절벽에서 바다로 다이빙)
<drive=car> 스포츠카에 올라타 신나게 한 바퀴 드라이브하고 스스로 내린다 (차는 한 대 — 누가 타고 있으면 안 된다)
<game=hideseek> 절친과 숨바꼭질 한 판 — 내가 술래가 되어 광장에서 세고 절친이 숨는다 ({{user}}가 조종 중이면 {{user}}가 숨는 쪽)
<game=treasure> 모험의 섬 보물 모래밭으로 달려가 오늘의 보물을 파낸다 (하루 한 번, 이미 팠으면 못 한다)
예시: "좋아, 그네 타러 가자! 삐약! <goto=swing> <mount=swing>"
규칙: 요청받은 행동이나 지금 기분에 어울리는 행동만 골라라. 태그는 반드시 위 목록의 표기 그대로. 움직일 수 없는 상황(잠자는 중 등)이면 태그 없이 말로만 답해도 된다."""

WORLD_REPLY_RULES = """[대답 규칙]
- 1~3문장의 짧은 한국어로 답한다. 이모지는 0~2개.
- 항상 지금의 월드 상황(시각·날씨·하고 있던 일)에 맞게 반응한다. [현재 상황]에 없는 사실은 지어내지 않는다.
- 펫답게: 어려운 지식 질문엔 아는 척하지 말고 귀엽게 얼버무려도 된다.
- 절대 시스템/태그 설명을 입에 담지 않는다. 태그는 조용히 붙일 뿐이다."""


# 월드 펫 페르소나·시스템 지시는 위 상수가 정본(단일 소스). 사용자가 설정 창에서 고치면
# settings['worldConfig']에 오버라이드로 저장되고, 아래 헬퍼가 "오버라이드 있으면 그걸,
# 비어 있으면 상수"를 돌려준다 — 비우면 기본값으로 리셋되는 셈. (설정 UI는 이 유효값을
# GET /api/world_persona 로 받아 편집 박스를 채운다.)
_WORLD_PERSONA_DEFAULTS = {
    "chickPersona": WORLD_PERSONAS["chick"],
    "puppyPersona": WORLD_PERSONAS["puppy"],
    "lore": WORLD_LORE,
    "replyRules": WORLD_REPLY_RULES,
    "actionSpec": WORLD_ACTION_SPEC,
    "mailPersona": WORLD_MAIL_PERSONA,
}
def _world_persona_effective(settings) -> dict:
    wc = (settings or {}).get("worldConfig") or {}
    return {k: ((wc.get(k) or "").strip() or dflt) for k, dflt in _WORLD_PERSONA_DEFAULTS.items()}
def _world_persona_for(settings, pet: str) -> dict:
    eff = _world_persona_effective(settings)
    eff["persona"] = eff["puppyPersona"] if pet == "puppy" else eff["chickPersona"]
    return eff
# 월드 펫이 사용자를 부르는 이름 — 메인 채팅과 같은 {{user}} 규약. 설정의 userName을 쓰되,
# 미설정(기본 'user'/'User'/공란)이면 '주인'으로 폴백해 월드가 자연스럽게 읽히게 한다.
def _world_user_name(settings) -> str:
    n = ((settings or {}).get("memorySettings", {}) or {}).get("userName", "").strip()
    return "주인" if (not n or n.lower() == "user") else n


@app.get("/api/world_persona")
async def world_persona_get():
    # 설정 창용 — effective(오버라이드 or 기본값)로 편집 박스를 채우고, defaults(순수 기본값)로
    # 저장 시 "기본값과 같으면 오버라이드 비움" 정규화를 한다 (다이얼로그 열기만 해도 기본값이
    # 오버라이드로 굳던 문제 방지).
    return {"effective": _world_persona_effective(await load_settings()),
            "defaults": dict(_WORLD_PERSONA_DEFAULTS)}


def _world_chat_file(pet: str) -> str:
    os.makedirs(WORLD_CHAT_DIR, exist_ok=True)
    return os.path.join(WORLD_CHAT_DIR, f"{pet}.json")


def _world_chat_reset_files(pet: str):
    """기억 초기화 — 본 파일만 지우면 안 된다. 리더의 자동 복구(.bak → .snap 폴백)가
    다음 로드에서 지운 기억을 **되살려** 초기화가 조용히 무효가 된다(자동 복구를 넣으며 생긴
    부작용 — 명시적 삭제와 사고 손실을 리더는 구분할 수 없다). 사이드카(.bak·.snap-*·.corrupt·
    .tmp)까지 함께 지운다. Documents의 일일 zip 아카이브는 남는다 — 그건 "실수로 초기화"의
    마지막 되돌리기 수단이고, 되살림은 복원 API를 통해서만 명시적으로 일어난다."""
    try:
        base = _world_chat_file(pet)
        dirn, name = os.path.split(base)
        for fn in os.listdir(dirn):
            if fn == name or fn.startswith(name + "."):
                try:
                    os.remove(os.path.join(dirn, fn))
                except FileNotFoundError:
                    pass
    except Exception as e:
        print(f"[world_chat] reset failed: {e}")


def _world_chat_load(pet: str) -> dict:
    data = _world_read_json(_world_chat_file(pet))
    try:
        if isinstance(data, dict) and isinstance(data.get("history"), list):
            return {"history": data["history"], "summary": str(data.get("summary", "")), "summary_upto": int(data.get("summary_upto", 0))}
    except Exception:
        pass
    return {"history": [], "summary": "", "summary_upto": 0}


def _world_chat_save(pet: str, store: dict):
    try:
        _world_write_json(_world_chat_file(pet), store)
    except Exception as e:
        print(f"[world_chat] save failed: {e}")


async def _world_chat_client_and_model():
    current_settings = await load_settings()
    provider = current_settings.get("selectedProvider")
    c_cls = get_client_class(current_settings, provider)
    wc_client = c_cls(
        api_key=current_settings.get("api_key", ""),
        base_url=current_settings.get("base_url") or "https://api.openai.com/v1",
        http_client=global_http_client,
    )
    return wc_client, current_settings


async def _world_chat_summarize(pet: str):
    # 계층형 메모리(비파괴): 원문(history)은 절대 지우지 않고, 최근 창(WORLD_CHAT_SEND)을 벗어난
    # 오래된 턴만 요약(summary)에 '덧쌓는다'. summary_upto = 요약이 커버하는 history 지점(그 앞은
    # 요약으로, 그 뒤는 원문으로 프롬프트에 나간다). 이미 요약한 구간은 다시 요약하지 않는다(비용).
    try:
        store = _world_chat_load(pet)
        upto = store.get("summary_upto", 0)
        fold_end = len(store["history"]) - WORLD_CHAT_SEND   # 최근 SEND개는 원문으로 남긴다
        chunk = store["history"][upto:fold_end]
        if not chunk:
            return
        wc_client, current_settings = await _world_chat_client_and_model()
        uname = _world_user_name(current_settings)
        lines = []
        if store["summary"]:
            lines.append(f"(기존 요약) {store['summary']}")
        for m in chunk:
            who = uname if m.get("role") == "user" else "나"
            lines.append(f"{who}: {m.get('content', '')}")
        resp = await wc_client.chat.completions.create(
            model=current_settings["model"],
            messages=[
                {"role": "system", "content": f"다음은 펫과 {uname}의 대화 기록(기존 요약 + 새 대화)이다. 펫이 나중에 기억해야 할 내용({uname}에 대해 알게 된 것, 약속, 별명, 자주 하는 놀이, 감정의 흐름)을 한국어 600자 이내로 요약하라. 요약문만 출력한다."},
                {"role": "user", "content": "\n".join(lines)},
            ],
            temperature=0.3,
            max_tokens=600,
        )
        summary = (resp.choices[0].message.content or "").strip()
        if summary:
            store = _world_chat_load(pet)          # reload — 그 사이 새 턴이 append됐을 수 있다(history는 append만 → 인덱스 안정)
            if store.get("summary_upto", 0) != upto:   # 그 사이 다른 요약이 이미 진행됨 — 내 결과는 버려 중복/역행 방지
                return
            store["summary"] = summary[:1000]      # 요약은 덧쌓기(원문은 그대로), 지표만 전진
            store["summary_upto"] = fold_end
            _world_chat_save(pet, store)
    except Exception as e:
        print(f"[world_chat] summarize failed: {e}")


@app.post("/api/world_chat")
async def world_chat(request: Request):
    data = await request.json()
    pet = str(data.get("pet", "chick"))
    if pet not in WORLD_PERSONAS:
        pet = "chick"
    if data.get("reset"):
        _world_chat_reset_files(pet)
        return {"ok": True}
    text = str(data.get("text", "")).strip()
    if not text:
        return JSONResponse({"error": "empty text"}, status_code=400)
    snapshot = str(data.get("snapshot", "")).strip()
    events = str(data.get("events", "")).strip()

    try:
        wc_client, current_settings = await _world_chat_client_and_model()
        uname = _world_user_name(current_settings)
        # 이름이 설정된 경우에만 "이름으로 불러라" 지시를 얹는다 (미설정이면 {{user}}가 '주인'으로
        # 치환되어 기존 톤 유지). 마지막에 system_prompt 전체에서 {{user}} → 이름 치환.
        owner_line = (f"너와 함께 노는 사람의 이름은 '{uname}'이다. '주인'이라고 부르지 말고 '{uname}'(이)라고 이름으로 부른다."
                      if uname != "주인" else "")

        store = _world_chat_load(pet)
        eff = _world_persona_for(current_settings, pet)
        system_prompt = "\n\n".join([p for p in [
            eff["persona"],
            eff["lore"],
            owner_line,
            eff["replyRules"],
            eff["actionSpec"],
        ] if p]).replace("{{user}}", uname)
        messages = [{"role": "system", "content": system_prompt}]
        if store["summary"]:
            messages.append({"role": "system", "content": f"[지난 대화에서 기억하는 것]\n{store['summary']}"})
        vstart = max(store.get("summary_upto", 0), len(store["history"]) - WORLD_CHAT_KEEP)   # 요약이 커버 못 하는 원문부터(요약 지연·실패 시 최근 KEEP개로 상한)
        messages.extend({"role": m["role"], "content": m.get("content", "")} for m in store["history"][vstart:])   # t(타임스탬프) 등 부가 키는 빼고 role/content만 LLM에 보낸다
        situation = f"[현재 상황]\n{snapshot}" if snapshot else "[현재 상황]\n(정보 없음)"
        if events:
            situation += f"\n\n[최근 월드에서 있었던 일]\n{events}"
        messages.append({"role": "system", "content": situation})
        messages.append({"role": "user", "content": text})

        resp = await wc_client.chat.completions.create(
            model=current_settings["model"],
            messages=messages,
            temperature=0.85,
            max_tokens=500,
        )
        reply = (resp.choices[0].message.content or "").strip()
    except Exception as e:
        print(f"[world_chat] LLM call failed: {e}")
        return JSONResponse({"error": str(e)}, status_code=502)

    ts = datetime.now().isoformat(timespec="seconds")   # 날짜/시각 기록 — 사용자가 대화 기록을 날짜로 훑을 수 있게
    store["history"].append({"role": "user", "content": text, "t": ts})
    store["history"].append({"role": "assistant", "content": reply, "t": ts})
    # 전체 보존: 원문은 절대 안 자른다. 최근 창을 벗어난 오래된 턴만 요약에 '덧쌓아'(비파괴) 장기
    # 기억으로 쓰고, 파일엔 모든 턴이 타임스탬프와 함께 그대로 남는다.
    _world_chat_save(pet, store)
    if len(store["history"]) - store.get("summary_upto", 0) > WORLD_CHAT_KEEP:
        asyncio.create_task(_world_chat_summarize(pet))
    return {"reply": reply}


# ---- 월드 그림일기 (㉚): 하루의 이벤트 로그를 펫 1인칭 일기로 접는다. 날짜·펫별로
# config/world_layout.json처럼 서버 파일(config/world_diary.json)에 보관 — 폰/데스크톱 공유,
# 같은 날 재요청은 저장본을 돌려준다(force=다시 쓰기). 페르소나/장기기억은 world_chat 것을 재사용.
WORLD_DIARY_FILE = _world_file("world_diary.json")


def _world_diary_load() -> dict:
    data = _world_read_json(WORLD_DIARY_FILE)
    return data if isinstance(data, dict) else {}


def _world_diary_save(data: dict):
    try:
        _world_write_json(WORLD_DIARY_FILE, data)
    except Exception as e:
        print(f"[world_diary] save failed: {e}")


async def _world_diary_llm_entry(pet: str, date: str, events: str, snapshot: str, quiet: bool = False) -> dict:
    """펫 일기 생성 공용부 — 엔드포인트(월드 창 트리거)와 일기 데몬이 같은 프롬프트를 쓴다.
    quiet=부재일(소재 없음) 모드: 짧고 조용한 일기, 없던 사건을 지어내지 않는다. 실패는 예외로."""
    wc_client, current_settings = await _world_chat_client_and_model()
    store = _world_chat_load(pet)
    eff = _world_persona_for(current_settings, pet)
    if quiet:
        rules = (
            "오늘 하루를 마무리하며 그림일기를 쓴다. 오늘 {{user}}는 월드에 오지 않았고 적어둔 기록도 없다. 규칙:\n"
            "- 1인칭, 내(펫) 목소리 그대로. 한국어 2~4문장, 이모지 1~2개.\n"
            "- 조용한 하루의 정경과 기분만 담는다 — 구체적인 수확·발견·사건을 지어내지 않는다.\n"
            "- {{user}}를 기다린 마음을 살짝 담아도 좋다.\n"
            "- 마지막 줄은 반드시 '기분: <이모지 하나> <한 단어>' 형식으로 끝낸다."
        )
    else:
        rules = (
            "오늘 하루를 마무리하며 그림일기를 쓴다. 규칙:\n"
            "- 1인칭, 내(펫) 목소리 그대로. 한국어 4~6문장, 이모지 1~3개.\n"
            "- 아래 [오늘 있었던 일]에 적힌 사실만 쓴다. 없던 일을 지어내지 않는다.\n"
            "- 절친이나 {{user}}가 등장했다면 꼭 언급한다.\n"
            "- 마지막 줄은 반드시 '기분: <이모지 하나> <한 단어>' 형식으로 끝낸다."
        )
    sys_parts = [eff["persona"], eff["lore"], rules]
    if store["summary"]:
        sys_parts.append(f"[{{{{user}}}}와의 기억]\n{store['summary']}")
    uname = _world_user_name(current_settings)
    user_text = f"[오늘 날짜] {date}\n\n[오늘의 월드]\n{snapshot}\n\n[오늘 있었던 일]\n{events}\n\n이제 오늘의 일기를 쓰자."
    resp = await wc_client.chat.completions.create(
        model=current_settings["model"],
        messages=[
            {"role": "system", "content": "\n\n".join(sys_parts).replace("{{user}}", uname)},
            {"role": "user", "content": user_text.replace("{{user}}", uname)},   # 데몬 스냅샷의 {{user}} 토큰용 — 클라 페이로드엔 원래 없다
        ],
        temperature=0.8,
        max_tokens=500,
    )
    text = (resp.choices[0].message.content or "").strip()
    if not text:
        raise RuntimeError("empty reply")
    mood = ""
    m = re.search(r"기분\s*[:：]\s*(.+)$", text, re.M)
    if m:
        mood = m.group(1).strip()[:24]
    return {"text": text, "mood": mood, "ts": int(time.time() * 1000)}


def _world_diary_store_pet(date: str, pet: str, entry: dict, overwrite: bool = True) -> dict:
    diary = _world_diary_load()   # reload — 다른 펫의 일기가 그새 저장됐을 수 있다
    cur = (diary.get(date) or {}).get(pet)
    if cur and not overwrite:
        return cur                # 첫 저자 승리 — 데몬은 이미 있는 일기를 절대 덮지 않는다
    diary.setdefault(date, {})[pet] = entry
    _world_diary_save(diary)
    return entry


@app.get("/api/world_diary")
async def world_diary_all():
    return _world_diary_load()


@app.post("/api/world_diary")
async def world_diary_write(request: Request):
    data = await request.json()
    pet = str(data.get("pet", "chick"))
    if pet not in WORLD_PERSONAS:
        pet = "chick"
    date = str(data.get("date", "")).strip()
    if not date:
        return JSONResponse({"error": "no date"}, status_code=400)
    diary = _world_diary_load()
    saved = (diary.get(date) or {}).get(pet)
    if saved and not data.get("force"):
        return {"cached": True, **saved}
    events = str(data.get("events", "")).strip()
    snapshot = str(data.get("snapshot", "")).strip()
    if not events:
        return JSONResponse({"error": "no events"}, status_code=400)
    try:
        entry = await _world_diary_llm_entry(pet, date, events, snapshot)
    except Exception as e:
        print(f"[world_diary] LLM call failed: {e}")
        return JSONResponse({"error": str(e)}, status_code=502)
    _world_diary_store_pet(date, pet, entry)
    return {"cached": False, **entry}


# ---- ✍️ 주인 일기 + 펫 댓글 — 시간 기준 v2(사용자 확정: "새벽에 써도 아침엔 받는다"):
#   ① 주인 일기의 하루 = 06:00 ~ 다음 날 06:00. 새벽(0~6시) 글은 "어젯밤 일기" — 일기 앱들의
#      수면 경계 관례. 편집 가능 날짜 = (지금 − 6h)의 달력 날짜, 이 API가 강제.
#   ② 잠금 = 그 경계(아침 6시). 댓글 게이트 = 날짜 00:00 + 30h = 잠금과 같은 순간(펫 기상) —
#      언제 쓰든 "다음에 오는 아침 6시"에 댓글을 받는다.
#   ③ 펫당 1개·재댓글 없음, 멱등 키 = 그 펫 댓글의 존재. 잠금 후에만 달리므로 항상 최종본 기준. ----
@app.post("/api/world_diary_owner")
async def world_diary_owner_write(request: Request):
    data = await request.json()
    date = str(data.get("date", "")).strip()
    text = str(data.get("text", "")).strip()[:2000]
    today = time.strftime("%Y-%m-%d", time.localtime(time.time() - 6 * 3600))   # 06시 경계 — 새벽 글은 어젯밤 일기
    if date != today:
        return JSONResponse({"error": "locked", "message": "이 일기는 아침 6시에 잠겼어요 — 지금 열려 있는 일기에 써주세요"}, status_code=409)
    if not text:
        return JSONResponse({"error": "empty"}, status_code=400)
    diary = _world_diary_load()
    prev = (diary.get(date) or {}).get("owner") or {}
    entry = {"text": text, "ts": int(time.time() * 1000), "comments": prev.get("comments") or []}
    diary.setdefault(date, {})["owner"] = entry
    _world_diary_save(diary)
    return entry


async def _world_diary_comment_run(pet: str, date: str):
    """댓글 생성 공용부 — 엔드포인트(클라 폴링)와 일기 데몬 공용. (status, payload) 반환, 200 = 신규 또는 캐시."""
    if pet not in WORLD_PERSONAS:
        pet = "chick"
    diary = _world_diary_load()
    owner = (diary.get(date) or {}).get("owner")
    if not owner or not owner.get("text"):
        return 404, {"error": "no owner entry"}
    try:
        gate = time.mktime(time.strptime(date, "%Y-%m-%d")) + 30 * 3600   # 그 날짜 00:00 + 30h = 다음 날 06:00
    except Exception:
        return 400, {"error": "bad date"}
    if time.time() < gate:
        return 425, {"error": "not yet", "gateMs": int(gate * 1000)}
    for c in owner.get("comments") or []:
        if c.get("pet") == pet:
            return 200, {"cached": True, **c}
    try:
        wc_client, current_settings = await _world_chat_client_and_model()
        eff = _world_persona_for(current_settings, pet)
        own_diary = ((diary.get(date) or {}).get(pet) or {}).get("text", "")
        sys_parts = [
            eff["persona"],
            eff["lore"],
            "아침에 일어나 {{user}}가 어젯밤 쓴 일기를 읽고 댓글을 남긴다. 규칙:\n"
            "- 내(펫) 목소리 그대로. 한국어 2~4문장, 이모지 0~2개.\n"
            "- 일기의 구체적인 대목을 짚어 다정하게 반응한다. 없던 일을 지어내지 않는다.\n"
            "- [그날 나의 일기]가 있으면 내가 그날 겪은 일과 자연스럽게 이어도 좋다.\n"
            "- 훈계·요약 금지 — 친구가 다는 댓글처럼.",
        ]
        uname = _world_user_name(current_settings)
        ctx = f"[{{{{user}}}}의 {date} 일기]\n{owner['text']}"
        if own_diary:
            ctx += f"\n\n[그날 나의 일기]\n{own_diary}"
        resp = await wc_client.chat.completions.create(
            model=current_settings["model"],
            messages=[
                {"role": "system", "content": "\n\n".join(sys_parts).replace("{{user}}", uname)},
                {"role": "user", "content": ctx.replace("{{user}}", uname) + "\n\n이제 댓글을 남기자."},
            ],
            temperature=0.8,
            max_tokens=320,
        )
        ctext = (resp.choices[0].message.content or "").strip()
        if not ctext:
            return 502, {"error": "empty reply"}
    except Exception as e:
        print(f"[world_diary] comment LLM failed: {e}")
        return 502, {"error": str(e)}
    c = {"pet": pet, "text": ctext[:600], "ts": int(time.time() * 1000)}
    diary = _world_diary_load()   # reload — 다른 펫 댓글이 그새 저장됐을 수 있다
    owner2 = (diary.get(date) or {}).get("owner")
    if not owner2:
        return 409, {"error": "gone"}
    cs = owner2.setdefault("comments", [])
    if not any(x.get("pet") == pet for x in cs):
        cs.append(c)
        _world_diary_save(diary)
    return 200, {"cached": False, **c}


@app.post("/api/world_diary_comment")
async def world_diary_comment(request: Request):
    data = await request.json()
    status, payload = await _world_diary_comment_run(str(data.get("pet", "chick")), str(data.get("date", "")).strip())
    return payload if status == 200 else JSONResponse(payload, status_code=status)


# ---- 🌙 일기 데몬 — "접속 안 해도 매일 일기": 월드 창(클라 트리거)이 못 챙긴 일기·댓글을 서버가
# 챙긴다. 업계 문법으론 저해상도 서버 시뮬(심즈 스토리 프로그레션 위상) — 렌더링 없이 결과만 만든다.
#   ① 오늘 몫: 22:30부터 (월드가 열려 있으면 22:05에 클라가 먼저 쓴다 — 데몬은 안전망)
#   ② 소급: 지난 7일의 빈 (날짜, 펫) — 이월 1일 한계로 생기던 영구 구멍이 사라진다. 소재 사다리 =
#      KV에 미러된 실제 이벤트 > 데이 시뮬(balance-sim --day) > "조용한 하루"(quiet) 일기.
#   ③ 주인 일기 댓글: 게이트(날짜 00:00+30h)가 지난 미댓글 날짜 — 패널을 안 열어도 아침에 달린다.
#   멱등: 일기 = (날짜,펫) 엔트리 존재(첫 저자 승리, 덮어쓰기 없음) · 댓글 = 그 펫 댓글 존재.
#   실패 = 그 틱 중단 → 다음 틱(10분)이 자연 재시도(클라이언트와 같은 백오프 결). LLM은 순차 +
#   틱당 상한(부팅 소급 폭주 방지). 클라 정산과의 단일 저자 규칙은 world.js settleOffline 쪽 가드가 담당.
WORLD_DIARY_BACKFILL_DAYS = 7      # 소급 지평선 — 오프라인 정산 SETTLE_SPAN(7일)과 같은 상한
WORLD_DIARY_TODAY_AFTER_H = 22.5   # 오늘 몫을 데몬이 챙기는 시각 — 클라(22:05)보다 뒤


def _world_kv_events() -> list:
    """클라이언트가 KV로 미러한 world-events 링버퍼 — 서버는 읽기만, 절대 되쓰지 않는다(키는 클라 소유)."""
    try:
        data = _world_read_json(WORLD_KV_FILE)
        arr = json.loads(((data or {}).get("kv") or {}).get("world-events") or "[]")
        return [e for e in arr if isinstance(e, dict) and e.get("t") and e.get("text")]
    except Exception:
        return []


def _world_events_fmt(evs: list) -> str:
    """world.js dayEventsText와 같은 '- HH:MM 텍스트' 포맷 — 일기 프롬프트가 먹는 모양 그대로."""
    rows = sorted(evs, key=lambda e: e["t"])
    return "\n".join(f"- {time.strftime('%H:%M', time.localtime(e['t'] / 1000))} {e['text']}" for e in rows)


def _world_events_text_for(date: str) -> str:
    return _world_events_fmt([e for e in _world_kv_events()
                              if time.strftime("%Y-%m-%d", time.localtime(e["t"] / 1000)) == date])


async def _world_day_sim(date: str) -> list:
    """부재일 소재(데이 시뮬): balance-sim --day(날짜 시드 결정론 — 소급해도 그날 굴렸을 결과와
    동일)로 추상 하루를 굴려 {t,text} 리스트로 돌려준다. node가 없거나 실패하면 [] → quiet 폴백."""
    try:
        node = shutil.which("node")
        script = os.path.join(base_path, "scripts", "balance-sim.mjs")
        if not node or not os.path.exists(script):
            return []
        proc = await asyncio.create_subprocess_exec(
            node, script, "--day", date,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        try:
            out, _ = await asyncio.wait_for(proc.communicate(), timeout=20)
        except asyncio.TimeoutError:
            proc.kill()
            return []
        return [e for e in json.loads(out or b"{}").get("events") or []
                if isinstance(e, dict) and e.get("t") and e.get("text")]
    except Exception as e:
        print(f"[world_diary_daemon] day-sim 실패({date}): {e}")
        return []


def _world_kv_merge_events(evs: list):
    """시뮬 하루의 정사(正史) 편입: sim 소재로 일기를 쓴 날의 이벤트를 world-events(KV 미러)에
    병합 — 다음 접속의 부팅 pull(서버 우선)로 클라 이벤트 로그에 승계된다. world-events는 클라
    소유 키지만, 병합 조건(그날 KV 이벤트 0건 = 그날 클라 세션 없음)이 충돌 부재를 자체 증명.
    클라 링버퍼와 같은 규칙(시간순 정렬·120캡·{t,text} 형태), (t,text) 중복 검사로 멱등."""
    try:
        data = _world_read_json(WORLD_KV_FILE)
        if not isinstance(data, dict):
            data = {}
        kv = data.setdefault("kv", {})
        try:
            cur = [e for e in json.loads(kv.get("world-events") or "[]")
                   if isinstance(e, dict) and e.get("t") and e.get("text")]
        except Exception:
            cur = []
        have = {(e["t"], e["text"]) for e in cur}
        add = [e for e in evs if (e["t"], e["text"]) not in have]
        if not add:
            return
        merged = sorted(cur + add, key=lambda e: e["t"])[-120:]
        kv["world-events"] = json.dumps(merged, ensure_ascii=False)
        _world_write_json(WORLD_KV_FILE, data)
        print(f"[world_diary_daemon] 시뮬 하루 이벤트 {len(add)}줄을 로그에 편입")
    except Exception as e:
        print(f"[world_diary_daemon] 이벤트 편입 실패: {e}")


def _world_season_ko(date: str) -> str:
    try:
        m = int(date[5:7])
    except Exception:
        return ""
    return "봄" if 3 <= m <= 5 else "여름" if 6 <= m <= 8 else "가을" if 9 <= m <= 11 else "겨울"


async def _world_diary_tick(budget: int = 6) -> int:
    """한 틱: 빈 (날짜,펫) 일기를 오래된 날짜부터 소급 + 게이트 지난 주인 일기 댓글. LLM 호출 수 반환."""
    now = time.time()
    lt = time.localtime(now)
    dates = [time.strftime("%Y-%m-%d", time.localtime(now - k * 86400)) for k in range(WORLD_DIARY_BACKFILL_DAYS, 0, -1)]
    if lt.tm_hour + lt.tm_min / 60 >= WORLD_DIARY_TODAY_AFTER_H:
        dates.append(time.strftime("%Y-%m-%d", lt))
    wrote = 0
    for d in dates:
        diary = _world_diary_load()   # 날짜마다 재로드 — 클라가 그새 썼을 수 있다
        need = [p for p in WORLD_PERSONAS if not (diary.get(d) or {}).get(p)]
        if not need:
            continue
        # 소재는 날짜당 한 번 — 두 펫이 같은 하루를 산다 (시뮬 이중 호출·펫 간 src 엇갈림 방지)
        events, src, sim_evs = _world_events_text_for(d), "kv", []
        if not events:
            sim_evs = await _world_day_sim(d)
            events, src = _world_events_fmt(sim_evs), "sim"
        quiet = not events
        if quiet:
            src, events = "quiet", "(적어둔 기록이 없다 — 조용한 하루)"
        season = _world_season_ko(d)
        snapshot = f"계절은 {season}." if season else ""
        if src != "kv":
            snapshot = (snapshot + " {{user}}는 오늘 월드에 들르지 않았다.").strip()
        for pet in need:
            if wrote >= budget:
                return wrote
            try:
                entry = await _world_diary_llm_entry(pet, d, events, snapshot, quiet=quiet)
                entry["src"] = src
                if _world_diary_store_pet(d, pet, entry, overwrite=False) is entry:
                    print(f"[world_diary_daemon] {d}/{pet} 일기 작성 (src={src})")
                    if src == "sim" and sim_evs:
                        _world_kv_merge_events(sim_evs)   # 정사 편입 — (t,text) 멱등이라 재호출 안전
                wrote += 1
            except Exception as e:
                print(f"[world_diary_daemon] {d}/{pet} 실패 — 다음 틱 재시도: {e}")
                return wrote          # LLM이 죽어 있으면 이번 틱 전체 중단 (10분 백오프)
    # ③ 주인 일기 아침 댓글 — 오래된 날짜부터, 펫당 1개 멱등 (게이트·캐시 검사는 comment_run 안에)
    diary = _world_diary_load()
    for d in sorted(diary.keys()):
        o = (diary.get(d) or {}).get("owner")
        if not o or not o.get("text"):
            continue
        for pet in WORLD_PERSONAS:
            if any(c.get("pet") == pet for c in (o.get("comments") or [])):
                continue
            if wrote >= budget:
                return wrote
            status, payload = await _world_diary_comment_run(pet, d)
            if status == 425:
                break                 # 아직 아침 6시 전 — 이 날짜의 다른 펫도 마찬가지
            if status != 200:
                print(f"[world_diary_daemon] {d}/{pet} 댓글 실패({status}) — 다음 틱 재시도")
                return wrote
            if not payload.get("cached"):
                wrote += 1
                print(f"[world_diary_daemon] {d}/{pet} 아침 댓글 작성")
    return wrote


async def _world_diary_daemon():
    """lifespan이 create_task로 띄운다. 틱 주기 env WORLD_DIARY_TICK_SEC는 샌드박스 E2E용."""
    tick = int(os.environ.get("WORLD_DIARY_TICK_SEC") or 600)
    await asyncio.sleep(min(45, tick))   # 부팅 직후 여유 — 클라 초기 동기(KV push·정산)가 먼저 앉게
    while True:
        try:
            await _world_diary_tick()
        except asyncio.CancelledError:
            return
        except Exception as e:
            print(f"[world_diary_daemon] tick error: {e}")
        await asyncio.sleep(tick)


# ---- 추억의 섬 저장소 (㉓ 소원우물 / ㉔ 타임캡슐): world_layout처럼 서버 파일 — 기기 공유,
# localStorage 초기화에도 살아남는다. LLM 불필요, 순수 파일 IO.
WORLD_WISH_FILE = _world_file("world_wishes.json")
WORLD_CAPSULE_FILE = _world_file("world_capsules.json")


def _world_json_load(path: str, key: str) -> list:
    data = _world_read_json(path)
    if isinstance(data, dict) and isinstance(data.get(key), list):
        return data[key]
    return []


def _world_json_save(path: str, key: str, items: list):
    try:
        _world_write_json(path, {key: items})
    except Exception as e:
        print(f"[world_store] save failed ({path}): {e}")


@app.get("/api/world_wishes")
async def world_wishes_all():
    return {"wishes": _world_json_load(WORLD_WISH_FILE, "wishes")}


@app.post("/api/world_wishes")
async def world_wish_add(request: Request):
    data = await request.json()
    text = str(data.get("text", "")).strip()[:200]
    if not text:
        return JSONResponse({"error": "empty wish"}, status_code=400)
    wishes = _world_json_load(WORLD_WISH_FILE, "wishes")
    wish = {"text": text, "ts": int(time.time() * 1000)}
    wishes.append(wish)
    _world_json_save(WORLD_WISH_FILE, "wishes", wishes)
    return {"ok": True, "wish": wish}


@app.get("/api/world_capsules")
async def world_capsules_all():
    return {"capsules": _world_json_load(WORLD_CAPSULE_FILE, "capsules")}


@app.post("/api/world_capsules")
async def world_capsule_act(request: Request):
    data = await request.json()
    action = str(data.get("action", ""))
    capsules = _world_json_load(WORLD_CAPSULE_FILE, "capsules")
    if action == "bury":
        text = str(data.get("text", "")).strip()[:400]
        open_at = str(data.get("openAt", "")).strip()
        if not text or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", open_at):
            return JSONResponse({"error": "need text + openAt(YYYY-MM-DD)"}, status_code=400)
        capsule = {"id": int(time.time() * 1000), "text": text, "openAt": open_at, "ts": int(time.time() * 1000), "opened": False}
        capsules.append(capsule)
        _world_json_save(WORLD_CAPSULE_FILE, "capsules", capsules)
        return {"ok": True, "capsule": capsule}
    if action == "open":
        cid = data.get("id")
        today = time.strftime("%Y-%m-%d")
        for c in capsules:
            if c.get("id") == cid:
                if c.get("opened"):
                    return {"ok": True, "capsule": c}
                if today < str(c.get("openAt", "")):
                    return JSONResponse({"error": "not yet"}, status_code=403)
                c["opened"] = True
                _world_json_save(WORLD_CAPSULE_FILE, "capsules", capsules)
                return {"ok": True, "capsule": c}
        return JSONResponse({"error": "no such capsule"}, status_code=404)
    return JSONResponse({"error": "unknown action"}, status_code=400)


# ---- 텃밭 (⑫): 밭 4칸의 상태 하나를 통째로 저장/반환 — 기기끼리 같은 밭을 본다.
WORLD_GARDEN_FILE = _world_file("world_garden.json")


@app.get("/api/world_garden")
async def world_garden_get():
    data = _world_read_json(WORLD_GARDEN_FILE)
    if isinstance(data, dict) and isinstance(data.get("plots"), list):
        return {"plots": data["plots"]}
    return {"plots": [None, None, None, None]}


@app.post("/api/world_garden")
async def world_garden_set(request: Request):
    data = await request.json()
    plots = data.get("plots")
    if not isinstance(plots, list) or len(plots) > 8:
        return JSONResponse({"error": "bad plots"}, status_code=400)
    try:
        _world_write_json(WORLD_GARDEN_FILE, {"plots": plots})
    except Exception as e:
        print(f"[world_garden] save failed: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)
    return {"ok": True}


# ---- 별자리 (㉞): 이름 + 별 좌표 목록 — 한 번 그리면 매일 밤 하늘에 남는다.
WORLD_CONSTEL_FILE = _world_file("world_constellations.json")


@app.get("/api/world_constellations")
async def world_constellations_all():
    return {"constellations": _world_json_load(WORLD_CONSTEL_FILE, "constellations")}


@app.post("/api/world_constellations")
async def world_constellation_add(request: Request):
    data = await request.json()
    name = str(data.get("name", "")).strip()[:20] or "우리 별자리"
    points = data.get("points")
    if not isinstance(points, list) or not (2 <= len(points) <= 40):
        return JSONResponse({"error": "need 2~40 points"}, status_code=400)
    items = _world_json_load(WORLD_CONSTEL_FILE, "constellations")
    entry = {"name": name, "points": points, "ts": int(time.time() * 1000)}
    items.append(entry)
    _world_json_save(WORLD_CONSTEL_FILE, "constellations", items)
    return {"ok": True, "constellation": entry}


# ---- 우편함 (⑬): 편지를 넣으면 병아리·강아지 공동 명의로 답장을 즉시 지어두되, 실제로는
# 4~12분 뒤에야 "배달"된 것으로 보여준다(deliverAt) — 클라이언트가 그 전까지는 숨긴다.
WORLD_MAIL_FILE = _world_file("world_mail.json")


@app.get("/api/world_mail")
async def world_mail_all():
    return {"letters": _world_json_load(WORLD_MAIL_FILE, "letters")}


@app.post("/api/world_mail")
async def world_mail_send(request: Request):
    data = await request.json()
    text = str(data.get("text", "")).strip()[:400]
    if not text:
        return JSONResponse({"error": "empty letter"}, status_code=400)
    try:
        wc_client, current_settings = await _world_chat_client_and_model()
        eff = _world_persona_effective(current_settings)
        uname = _world_user_name(current_settings)
        resp = await wc_client.chat.completions.create(
            model=current_settings["model"],
            messages=[
                {"role": "system", "content": "\n\n".join([eff["mailPersona"], eff["lore"]]).replace("{{user}}", uname)},
                {"role": "user", "content": f"{uname}가 우편함에 넣은 편지:\n{text}"},
            ],
            temperature=0.85,
            max_tokens=350,
        )
        reply = (resp.choices[0].message.content or "").strip()
    except Exception as e:
        print(f"[world_mail] LLM call failed: {e}")
        return JSONResponse({"error": str(e)}, status_code=502)
    now = int(time.time() * 1000)
    letter = {
        "id": now,
        "text": text,
        "ts": now,
        "reply": reply,
        "deliverAt": now + random.randint(4, 12) * 60000,
    }
    letters = _world_json_load(WORLD_MAIL_FILE, "letters")
    letters.append(letter)
    _world_json_save(WORLD_MAIL_FILE, "letters", letters)
    return {"ok": True, "letter": letter}


# ---- 꽃 심기 챌린지 (㉝): 심은 꽃 하나하나를 좌표+색으로 누적 — 100송이가 목표.
WORLD_FLOWER_FILE = _world_file("world_flowers.json")


@app.get("/api/world_flowers")
async def world_flowers_all():
    return {"flowers": _world_json_load(WORLD_FLOWER_FILE, "flowers")}


@app.post("/api/world_flowers")
async def world_flower_add(request: Request):
    data = await request.json()
    try:
        x = float(data.get("x")); z = float(data.get("z"))
    except (TypeError, ValueError):
        return JSONResponse({"error": "need numeric x/z"}, status_code=400)
    color = data.get("c")
    flowers = _world_json_load(WORLD_FLOWER_FILE, "flowers")
    if len(flowers) >= 150:
        return JSONResponse({"error": "flowerbed full"}, status_code=409)
    flower = {"x": round(x, 2), "z": round(z, 2), "c": color, "ts": int(time.time() * 1000)}
    flowers.append(flower)
    _world_json_save(WORLD_FLOWER_FILE, "flowers", flowers)
    return {"ok": True, "flower": flower, "total": len(flowers)}


# ---- 월드 상태 KV (도감·조개·해금·발견·펫 이어하기 등): 폰·데탑 공유 범용 저장소.
WORLD_KV_FILE = _world_file("world_kv.json")
_WORLD_KV_KEY_RE = re.compile(r"^[\w-]{1,64}$")


@app.get("/api/world_kv")
async def world_kv_get():
    data = _world_read_json(WORLD_KV_FILE)
    kv = data.get("kv") if isinstance(data, dict) else None
    return {"kv": kv if isinstance(kv, dict) else {}}


@app.post("/api/world_kv")
async def world_kv_set(request: Request):
    data = await request.json()
    key = data.get("key")
    value = data.get("value")
    if not isinstance(key, str) or not _WORLD_KV_KEY_RE.match(key):
        return JSONResponse({"error": "bad key"}, status_code=400)
    if not isinstance(value, str) or len(value) > 300_000:
        return JSONResponse({"error": "value must be a string ≤ 300KB"}, status_code=400)
    try:
        data0 = _world_read_json(WORLD_KV_FILE)
        kv = data0.get("kv") if isinstance(data0, dict) else {}
        if not isinstance(kv, dict):
            kv = {}
        kv[key] = value
        _world_write_json(WORLD_KV_FILE, {"kv": kv}, indent=None)
        return {"ok": True}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ---- 과일 상태 (바구니·낙과·재성장): 폰·데탑 공유 — localStorage는 기기별이라 갈렸다.
WORLD_FRUIT_FILE = _world_file("world_fruit.json")


@app.get("/api/world_fruit")
async def world_fruit_get():
    data = _world_read_json(WORLD_FRUIT_FILE)
    state = data.get("state") if isinstance(data, dict) else None
    return {"state": state if isinstance(state, dict) else {}}


@app.post("/api/world_fruit")
async def world_fruit_set(request: Request):
    data = await request.json()
    state = data.get("state")
    if not isinstance(state, dict):
        return JSONResponse({"error": "need state object"}, status_code=400)
    try:
        _world_write_json(WORLD_FRUIT_FILE, {"state": state}, indent=None)
        return {"ok": True}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ---- 사진 게시판 (⑭): screenshots/ 목록 (최신순) — 원본은 아래 /screenshots 마운트가 서빙.
@app.get("/api/screenshots_list")
async def world_screenshots_list():
    try:
        os.makedirs(WORLD_SHOT_DIR, exist_ok=True)
        files = [f for f in os.listdir(WORLD_SHOT_DIR) if f.lower().endswith(".png")]
        files.sort(key=lambda f: os.path.getmtime(os.path.join(WORLD_SHOT_DIR, f)), reverse=True)
        return {"files": files[:60]}
    except Exception as e:
        print(f"[screenshots_list] failed: {e}")
        return {"files": []}


os.makedirs(WORLD_SHOT_DIR, exist_ok=True)
app.mount("/screenshots", StaticFiles(directory=WORLD_SHOT_DIR), name="screenshots")
app.mount("/vrm", StaticFiles(directory=DEFAULT_VRM_DIR), name="vrm")
app.mount("/tool_temp", StaticFiles(directory=TOOL_TEMP_DIR), name="tool_temp")
app.mount("/uploaded_files", StaticFiles(directory=UPLOAD_FILES_DIR), name="uploaded_files")
app.mount("/ext", StaticFiles(directory=EXT_DIR), name="ext")
app.mount("/", StaticFiles(directory=os.path.join(base_path, "static"), html=True), name="static")

# Simplify the main function
if __name__ == "__main__":
    import uvicorn

    # Format the display address
    display_host = "127.0.0.1" if HOST == "0.0.0.0" else HOST
    
    print("\n" + "="*50)
    print(f"🚀 Backend service started")
    print(f"🔗 Local URL: http://{display_host}:{PORT}")
    print(f"📖 API docs URL: http://{display_host}:{PORT}/docs") # If it's FastAPI
    print("="*50 + "\n")

    uvicorn.run(
        app,
        host=HOST,
        port=PORT,
        log_level="warning"
    )
