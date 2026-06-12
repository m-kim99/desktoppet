import os
import json
import re
import asyncio
from py.get_setting import USER_DATA_DIR

# Directory and file for storing affection data
AFFECTION_DIR = os.path.join(USER_DATA_DIR, 'affection')
AFFECTION_FILE = os.path.join(AFFECTION_DIR, 'affection_data.json')

async def load_affection_data():
    """读取用户好感度数据"""
    os.makedirs(AFFECTION_DIR, exist_ok=True)
    if not os.path.exists(AFFECTION_FILE):
        return {}
    try:
        # Use asyncio.to_thread to avoid blocking the event loop
        def _read():
            with open(AFFECTION_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        return await asyncio.to_thread(_read)
    except Exception as e:
        print(f"[Affection] 读取数据失败: {e}")
        return {}

async def save_affection_data(data):
    """保存用户好感度数据"""
    os.makedirs(AFFECTION_DIR, exist_ok=True)
    try:
        def _write():
            with open(AFFECTION_FILE, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=4)
        await asyncio.to_thread(_write)
    except Exception as e:
        print(f"[Affection] 保存数据失败: {e}")

async def extract_and_update_affection(full_content):
    """从AI完整的回复中提取 <user=xxx love=xxx> 并更新数据"""
    if not full_content:
        return
    
    # Regex match: find <user=name attr1=value attr2=value>
    # Handle the spaced form, e.g. <user=Pai love=12 familiarity=15>
    match = re.search(r"<user=([^\s>]+)\s+(.+?)>", full_content)
    if not match:
        return

    user_name = match.group(1)
    stats_str = match.group(2)

    # Extract all attribute=value pairs
    # Support Chinese attribute names, negative numbers, etc.
    stat_matches = re.findall(r"([a-zA-Z0-9_\u4e00-\u9fa5]+)\s*=\s*(-?\d+)", stats_str)
    
    if stat_matches:
        new_stats = {k: int(v) for k, v in stat_matches}
        
        # Update into JSON
        data = await load_affection_data()
        if user_name not in data:
            data[user_name] = {}
        
        data[user_name].update(new_stats)
        await save_affection_data(data)
        print(f"✨ [好感度系统] 用户 {user_name} 状态已更新: {new_stats}")