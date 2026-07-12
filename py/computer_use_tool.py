import asyncio
import time
import platform
import json
import os
from typing import List, Optional, Tuple
from functools import wraps

# ================== Core fix: safely import GUI libraries ==================
GUI_AVAILABLE = False
try:
    import pyautogui
    import pyperclip
    # Enable the fail-safe mechanism
    pyautogui.FAILSAFE = True
    pyautogui.PAUSE = 0.05
    GUI_AVAILABLE = True
except (KeyError, ImportError, Exception) as e:
    # In Docker/headless environments, ignore the error and just print a warning
    print(f"⚠️ [Warning] Desktop mouse/keyboard tool disabled (missing DISPLAY): {e}")

# Interceptor: if the LLM tries to use mouse/keyboard inside Docker, return a message instead of crashing
def require_gui(func):
    @wraps(func)
    async def wrapper(*args, **kwargs):
        if not GUI_AVAILABLE:
            return "Execution failed: the current system runs in a headless environment (e.g. Docker) with no physical display, so mouse and keyboard operations cannot be performed."
        return await func(*args, **kwargs)
    return wrapper
# ==============================================================


CURRENT_SCREEN_REGION = None

def set_screen_region(region: Optional[Tuple[int, int, int, int]]):
    """Set the currently active screen-mapping region"""
    global CURRENT_SCREEN_REGION
    CURRENT_SCREEN_REGION = region

def _percent_to_pixel(x_percent: float, y_percent: float) -> Tuple[int, int]:
    """Internal helper: convert a per-mille value (0 to 1000) into actual pixel coordinates of the current screen or specified region."""
    x_percent = max(0, min(1000, float(x_percent)))
    y_percent = max(0, min(1000, float(y_percent)))
    
    # If a partial screen region is specified, compute coordinates relative to it
    if CURRENT_SCREEN_REGION is not None:
        rx, ry, rw, rh = CURRENT_SCREEN_REGION
        px = rx + int(rw * (x_percent / 1000))
        py = ry + int(rh * (y_percent / 1000))
        
        # Ensure we don't exceed the region's bounds
        px = min(px, rx + rw - 1)
        py = min(py, ry + rh - 1)
        return px, py
        
    # Otherwise default to mapping full-screen coordinates
    width, height = pyautogui.size()
    px = min(int(width * (x_percent / 1000)), width - 1)
    py = min(int(height * (y_percent / 1000)), height - 1)
    
    return px, py


@require_gui
async def mouse_move(x: float, y: float, duration: float = 0.5) -> str:
    """Move the mouse to a per-mille position on screen"""
    if x < 0 or x > 1000 or y < 0 or y > 1000:
        return "Per-mille coordinate out of range; please enter a value between 0 and 1000."
    
    px, py = _percent_to_pixel(x, y)
    
    def _move():
        pyautogui.moveTo(px, py, duration=duration, tween=pyautogui.easeInOutQuad)
        time.sleep(0.02)
    
    await asyncio.to_thread(_move)
    return f"鼠标已成功移动到屏幕位置 ({x}‰, {y}‰)。 [LAST_ACTION: MOVE({x},{y})]"


@require_gui
async def mouse_click(button: str = "left", clicks: int = 1, x: Optional[float] = None, y: Optional[float] = None) -> str:
    """Click the mouse (supports per-mille coordinates)"""
    if x is not None and y is not None:
        if x < 0 or x > 1000 or y < 0 or y > 1000:    
            return "Per-mille coordinate out of range; please enter a value between 0 and 1000."
        
        def _click_at():
            px, py = _percent_to_pixel(x, y)
            pyautogui.moveTo(px, py, duration=0.2)
            time.sleep(0.2) 
            pyautogui.click(x=px, y=py, clicks=clicks, button=button, interval=0.1)
            
        await asyncio.to_thread(_click_at)
        # Tag differently based on the number of clicks
        tag = f"CLICK({x},{y})" if clicks == 1 else f"DOUBLE_CLICK({x},{y})"
        return f"鼠标已移动到 ({x}‰, {y}‰) 并使用 {button} 键点击了 {clicks} 次。 [LAST_ACTION: {tag}]"
    else:
        # If no coordinates are given (click in place), we can't mark the position on the image, so no coordinate tag
        await asyncio.to_thread(pyautogui.click, clicks=clicks, button=button, interval=0.1)
        return f"鼠标在当前位置使用 {button} 键点击了 {clicks} 次。[LAST_ACTION: CLICK_CURRENT]"


@require_gui
async def mouse_double_click(button: str = "left", x: Optional[float] = None, y: Optional[float] = None) -> str:
    """Double-click the mouse"""
    if x is not None and y is not None:
        if x < 0 or x > 1000 or y < 0 or y > 1000:    
            return "Per-mille coordinate out of range; please enter a value between 0 and 1000."
        
        def _double_click():
            px, py = _percent_to_pixel(x, y)
            pyautogui.moveTo(px, py, duration=0.2)
            time.sleep(0.2)
            pyautogui.click(x=px, y=py, clicks=2, button=button, interval=0.1)
            
        await asyncio.to_thread(_double_click)
        return f"鼠标已移动到 ({x}‰, {y}‰) 并使用 {button} 键双击。 [LAST_ACTION: DOUBLE_CLICK({x},{y})]"
    else:
        await asyncio.to_thread(pyautogui.click, clicks=2, button=button, interval=0.1)
        return f"鼠标在当前位置使用 {button} 键双击。 [LAST_ACTION: CLICK_CURRENT]"


@require_gui
async def mouse_drag(x1: float, y1: float, x2: float, y2: float, duration: float = 1.0, button: str = "left") -> str:
    """Drag from the start position (x1, y1) to the end position (x2, y2)"""
    try:
        coords = {"x1": x1, "y1": y1, "x2": x2, "y2": y2}
        for name, val in coords.items():
            if val < 0 or val > 1000:
                return f"错误：{name} 坐标 ({val}) 超出范围，请输入 0 到 1000 之间的值。"
        
        px1, py1 = _percent_to_pixel(x1, y1)
        px2, py2 = _percent_to_pixel(x2, y2)
        
        def _drag():
            pyautogui.moveTo(px1, py1, duration=0.2)
            time.sleep(0.2) 
            pyautogui.dragTo(x=px2, y=py2, duration=duration, button=button, tween=pyautogui.easeInOutQuad)
            time.sleep(0.1)
            
        await asyncio.to_thread(_drag)
        return f"已成功将鼠标从 ({x1}‰, {y1}‰) 拖拽到 ({x2}‰, {y2}‰)。[LAST_ACTION: DRAG({x1},{y1},{x2},{y2})]"
    except Exception as e:
        return f"拖拽失败：{e}"


@require_gui
async def mouse_scroll(clicks: int) -> str:
    """Scroll the mouse"""
    def _scroll():
        chunk_size = 10 if abs(clicks) > 10 else abs(clicks)
        direction = 1 if clicks > 0 else -1
        remaining = abs(clicks)
        
        while remaining > 0:
            current_chunk = min(chunk_size, remaining)
            pyautogui.scroll(current_chunk * direction)
            remaining -= current_chunk
            if remaining > 0:
                time.sleep(0.01)
    
    await asyncio.to_thread(_scroll)
    direction = "up" if clicks > 0 else "down"
    # Scrolling can't be marked; just return status
    return f"The mouse wheel has scrolled {direction} by {abs(clicks)} units. [LAST_ACTION: SCROLL]"


@require_gui
async def mouse_hold(button: str, duration: float) -> str:
    """Press and hold a mouse button"""
    if duration > 30: duration = 30
    
    def _hold_logic():
        try:
            pyautogui.mouseDown(button=button)
            time.sleep(duration)
        finally:
            pyautogui.mouseUp(button=button)
    
    await asyncio.to_thread(_hold_logic)
    return f"已成功按住鼠标 {button} 键持续 {duration} 秒。[LAST_ACTION: HOLD]"



@require_gui
async def copy_to_input_box(text: str) -> str:
    """Input text (optimized version: fixes the occasional bug where only the character 'v' is typed)"""
    def _type_text():
        old_clipboard = ""
        try:
            old_clipboard = pyperclip.paste()
        except Exception:
            pass
        
        sys_os = platform.system()
        
        try:
            pyperclip.copy("")
            pyperclip.copy(text)
            wait_time = 0.2 if sys_os == "Windows" else 0.15
            time.sleep(wait_time)
            
            for i in range(3):
                if pyperclip.paste() == text: break
                time.sleep(0.1)
                pyperclip.copy(text)
            
            modifier = 'command' if sys_os == "Darwin" else 'ctrl'
            
            # Core fix: explicitly press the modifier key and wait so the OS queue fully registers Ctrl/Cmd as held
            pyautogui.keyDown(modifier)
            time.sleep(0.05)  # 50ms system buffer delay to fully block the IME or the system from jumping ahead
            pyautogui.press('v')
            time.sleep(0.05)  # Brief wait before releasing
            pyautogui.keyUp(modifier)
            
            time.sleep(0.15)
        finally:
            time.sleep(0.05)
            for _ in range(2):
                try:
                    if old_clipboard: pyperclip.copy(old_clipboard)
                    break
                except Exception:
                    time.sleep(0.05)

    await asyncio.to_thread(_type_text)
    return f"已复制文本到输入框：'{text}'"

@require_gui
async def keyboard_press(key: str, presses: int = 1) -> str:
    """Press a single key multiple times"""
    def _press_logic():
        pyautogui.press(key, presses=presses, interval=0.05)
    
    await asyncio.to_thread(_press_logic)
    return f"已按下键盘按键 '{key}' {presses} 次。"


@require_gui
async def keyboard_sequence(keys: List[str]) -> str:
    """Press several different keys in sequence, with 0.5s between each"""
    if not keys:
        return "Error: no key list provided."

    def _sequence_logic():
        for i, key in enumerate(keys):
            pyautogui.press(key)
            # If it's not the last key, wait 0.5s
            if i < len(keys) - 1:
                time.sleep(0.5)

    await asyncio.to_thread(_sequence_logic)
    return f"已按顺序执行按键序列：{', '.join(keys)}，按键间隔 0.5 秒。"

@require_gui
async def keyboard_hotkey(keys: List[str]) -> str:
    """Press a key-combination shortcut"""
    if not keys: return "Error: no key combination provided"
    
    def _hotkey():
        if len(keys) == 1:
            pyautogui.press(keys[0])
        else:
            modifier = keys[0]
            rest_keys = keys[1:]
            with pyautogui.hold(modifier):
                for k in rest_keys:
                    pyautogui.press(k)
                    time.sleep(0.02)
    
    await asyncio.to_thread(_hotkey)
    return f"已触发组合键：{' + '.join(keys)}。"


@require_gui
async def keyboard_hold(keys: List[str], duration: float) -> str:
    """Press and hold a key"""
    if duration > 30: duration = 30
    
    def _hold_logic():
        start_time = time.time()
        try:
            for key in keys:
                pyautogui.keyDown(key)
                time.sleep(0.02)
            
            elapsed = 0
            while elapsed < duration:
                sleep_time = min(0.1, duration - elapsed)
                time.sleep(sleep_time)
                elapsed = time.time() - start_time
        except Exception as e:
            print(f"Error while holding key: {e}")
        finally:
            for key in reversed(keys):
                try:
                    pyautogui.keyUp(key)
                    time.sleep(0.02)
                except Exception:
                    pass

    await asyncio.to_thread(_hold_logic)
    return f"已成功长按组合键 {keys} 持续 {duration} 秒。"


@require_gui
async def logical_click(id: int) -> str:
    """Perform an accessibility logical click via a UI-tree node ID (supports occluded windows and background operation with screen off/locked)"""
    # Dynamically import the UI-tree cache query method
    from py.ui_tree_helper import get_cached_element
    
    cached = get_cached_element(id)
    if not cached:
        return f"错误：未找到 ID 为 {id} 的有效 UI 元素。页面可能已刷新，请重新Take a screenshot后再试。"
        
    system, handle = cached
    
    try:
        if system == "Windows":
            def _win_click():
                # Attempt 1: standard Invoke action (matches most buttons)
                try:
                    pattern = handle.GetInvokePattern()
                    if pattern:
                        pattern.Invoke()
                        return True
                except Exception:
                    pass
                
                # Attempt 2: Toggle action (matches checkboxes/radios)
                try:
                    pattern = handle.GetTogglePattern()
                    if pattern:
                        pattern.Toggle()
                        return True
                except Exception:
                    pass
                
                # Attempt 3: SelectionItem action (matches list items/tabs)
                try:
                    pattern = handle.GetSelectionItemPattern()
                    if pattern:
                        pattern.Select()
                        return True
                except Exception:
                    pass
                
                # Attempt 4: simulate an accessibility click (without moving the physical mouse)
                try:
                    handle.Click(simulateMove=True)
                    return True
                except Exception:
                    pass
                
                raise Exception("The current Windows UIA node does not support any known accessibility click action.")
                
            await asyncio.to_thread(_win_click)
            return f"已成功通过 Windows UIA 模式对节点 ID {id} 执行后台逻辑点击。[LAST_ACTION: LOGICAL_CLICK({id})]"
            
        elif system == "Darwin":
            import ApplicationServices as AX
            
            def _mac_click():
                # Attempt 1: AXPress (macOS standard button-press action)
                err = AX.AXUIElementPerformAction(handle, "AXPress")
                if err == 0:
                    return True
                
                # Attempt 2: AXPick (menu-item selection action)
                err = AX.AXUIElementPerformAction(handle, "AXPick")
                if err == 0:
                    return True
                
                # Attempt 3: AXShowMenu (triggers right-click/dropdown menu)
                err = AX.AXUIElementPerformAction(handle, "AXShowMenu")
                if err == 0:
                    return True
                
                raise Exception(f"AXUIElementPerformAction 返回无障碍错误码: {err}")
                
            await asyncio.to_thread(_mac_click)
            return f"已成功通过 macOS AXPress 模式对节点 ID {id} 执行后台逻辑点击。[LAST_ACTION: LOGICAL_CLICK({id})]"
            
        elif system == "Linux":
            import pyatspi
            
            def _linux_click():
                action = handle.queryAction()
                if action and action.nActions > 0:
                    # Default to the node's first associated action (usually click/activate)
                    action.doAction(0)
                    return True
                raise Exception("The current Linux AT-SPI node has no action interface.")
                
            await asyncio.to_thread(_linux_click)
            return f"已成功通过 Linux AT-SPI 模式对节点 ID {id} 执行后台逻辑点击。[LAST_ACTION: LOGICAL_CLICK({id})]"
            
        else:
            return f"未知的操作系统类型 {system}。"
            
    except Exception as e:
        # When the accessibility API hits a dead end (uncooperative app), hint the AI to fall back to a physical mouse click
        return f"逻辑点击 ID {id} 失败（原因: {str(e)}）。建议立刻使用原物理工具 mouse_click 传入该节点的 center 坐标进行兜底点击。"


@require_gui
async def logical_type(id: int, text: str) -> str:
    """Input text in the background via an accessibility node ID (no physical mouse movement or clipboard needed; supports locked-screen and background input)"""
    from py.ui_tree_helper import get_cached_element
    cached = get_cached_element(id)
    if not cached:
        return f"错误：未找到 ID 为 {id} 的有效输入框。页面可能已刷新，请重新截图。"
        
    system, handle = cached
    try:
        if system == "Windows":
            def _win_type():
                # Attempt 1: UIA ValuePattern (the most standard way to set an input's value)
                try:
                    pattern = handle.GetValuePattern()
                    if pattern:
                        pattern.SetValue(text)
                        return True
                except Exception:
                    pass
                # Attempt 2: set value via LegacyIAccessiblePattern
                try:
                    pattern = handle.GetLegacyIAccessiblePattern()
                    if pattern:
                        pattern.SetValue(text)
                        return True
                except Exception:
                    pass
                raise Exception("This component does not support the Windows UIA Value assignment mode.")
                
            await asyncio.to_thread(_win_type)
            return f"已成功通过 Windows UIA 后台向输入框 ID {id} 输入文本：'{text}'"
            
        elif system == "Darwin":
            import ApplicationServices as AX
            
            def _mac_type():
                # macOS low-level trick: rewrite the node's AXValue via the system accessibility API
                err = AX.AXUIElementSetAttributeValue(handle, "AXValue", text)
                if err == 0:
                    return True
                raise Exception(f"macOS AXValue 写入失败，无障碍错误码: {err}")
                
            await asyncio.to_thread(_mac_type)
            return f"已成功通过 macOS AXValue 后台向输入框 ID {id} 输入文本：'{text}'"
            
        else:
            return f"暂时不支持该系统平台后台逻辑输入。"
    except Exception as e:
        # Fallback: if logical input fails, hint the AI to use the traditional physical-click + paste approach
        return f"后台逻辑输入失败（原因：{str(e)}）。请尝试先点击目标输入框，再调用 copy_to_input_box 粘贴输入。"

# Note: wait doesn't need a GUI, so DON'T add @require_gui
async def wait(seconds: float) -> str:
    """Wait for a while to let the page or program load"""
    seconds = min(max(0, seconds), 60)
    await asyncio.sleep(seconds)
    return f"已等待 {seconds} 秒。"

async def screenshot() -> str:
    """Take a screenshot"""
    await asyncio.sleep(0.3)
    return "[Getting screenshot]"

# ================= Corresponding OpenAI tool schema definitions =================

mouse_move_tool = {
    "type": "function",
    "function": {
        "name": "mouse_move",
        "description": "Move the mouse to a specified position on screen. Coordinates use per-mille (0 to 1000). (0,0) is the top-left of the screen, (1000,1000) is the bottom-right, and (500,500) is the exact center.",
        "parameters": {
            "type": "object",
            "properties": {
                "x": {"type": "number", "description": "Target horizontal coordinate (X axis), per-mille from 0 to 1000. For example 500 means the horizontal center","maximum": 1000, "minimum": 0},
                "y": {"type": "number", "description": "Target vertical coordinate (Y axis), per-mille from 0 to 1000. For example 500 means the vertical center","maximum": 1000, "minimum": 0},
                "duration": {"type": "number", "description": "Move duration (seconds), default 0.5s. For realism, it's recommended not to set it to 0", "default": 0.5}
            },
            "required": ["x", "y"]
        }
    }
}

mouse_click_tool = {
    "type": "function",
    "function": {
        "name": "mouse_click",
        "description": "Click the mouse. If per-mille coordinates are provided, it moves there first and then clicks; if no coordinates are provided, it clicks at the current position.",
        "parameters": {
            "type": "object",
            "properties": {
                "button": {"type": "string", "enum": ["left", "right", "middle"], "description": "The button to click: left/right/middle"},
                "clicks": {"type": "integer", "description": "Number of clicks. 1 is a single click, 2 is a double-click. When you need to open a link or file, a double-click is recommended. If single-clicking an icon has no effect, also prefer a double-click.", "default": 1},
                "x": {"type": "number", "description": "Target horizontal coordinate before clicking (per-mille from 0 to 1000), optional","maximum": 1000, "minimum": 0},
                "y": {"type": "number", "description": "Target vertical coordinate before clicking (per-mille from 0 to 1000), optional","maximum": 1000, "minimum": 0}
            },
            "required": ["button"]
        }
    }
}

mouse_double_click_tool = {
    "type": "function",
    "function": {
        "name": "mouse_double_click",
        "description": "Double-click the mouse to quickly open links, files, apps, etc. If per-mille coordinates are provided, it moves there first and then clicks; if no coordinates are provided, it clicks at the current position.",
        "parameters": {
            "type": "object",
            "properties": {
                "button": {"type": "string", "enum": ["left", "right", "middle"], "description": "The button to click: left/right/middle"},
                "x": {"type": "number", "description": "Target horizontal coordinate before clicking (per-mille from 0 to 1000), optional","maximum": 1000, "minimum": 0},
                "y": {"type": "number", "description": "Target vertical coordinate before clicking (per-mille from 0 to 1000), optional","maximum": 1000, "minimum": 0}
            },
            "required": ["button"]
        }
    }
}

mouse_drag_tool = {
    "type": "function",
    "function": {
        "name": "mouse_drag",
        "description": "Press a mouse button and drag from the start coordinate to the end coordinate. Commonly used to drag windows or sliders, move files, or box-select a region.",
        "parameters": {
            "type": "object",
            "properties": {
                "x1": {"type": "number", "description": "Start point horizontal coordinate (0-1000)","maximum": 1000, "minimum": 0},
                "y1": {"type": "number", "description": "Start point vertical coordinate (0-1000)","maximum": 1000, "minimum": 0},
                "x2": {"type": "number", "description": "End point horizontal coordinate (0-1000)","maximum": 1000, "minimum": 0},
                "y2": {"type": "number", "description": "End point vertical coordinate (0-1000)","maximum": 1000, "minimum": 0},
                "duration": {"type": "number", "description": "Drag duration (seconds), default 1.0s", "default": 1.0},
                "button": {"type": "string", "enum": ["left", "right"], "description": "Which button to hold while dragging, default left", "default": "left"}
            },
            "required": ["x1", "y1", "x2", "y2"]
        }
    }
}

mouse_hold_tool = {
    "type": "function",
    "function": {
        "name": "mouse_hold",
        "description": "Press and hold a mouse button for a while. Useful for charging up in games, continuous firing, or long-press menus in some UIs.",
        "parameters": {
            "type": "object",
            "properties": {
                "button": {
                    "type": "string", 
                    "enum": ["left", "right", "middle"],
                    "description": "The mouse button to hold."
                },
                "duration": {
                    "type": "number", 
                    "description": "How long to hold (seconds)."
                }
            },
            "required": ["button", "duration"]
        }
    }
}


mouse_scroll_tool = {
    "type": "function",
    "function": {
        "name": "mouse_scroll",
        "description": "Scroll the mouse wheel to browse a web page or document. Positive numbers scroll up, negative numbers scroll down.",
        "parameters": {
            "type": "object",
            "properties": {
                "clicks": {"type": "integer", "description": "Scroll amount. Greater than 0 scrolls up, less than 0 scrolls down, e.g. 500 or -500. For a typical web page, try a value of 300 to 800 per scroll."}
            },
            "required": ["clicks"]
        }
    }
}

keyboard_type_tool = {
    "type": "function",
    "function": {
        "name": "copy_to_input_box",
        "description": "Paste a piece of text you provide into the currently focused input box. Supports Chinese and English characters. Note: before calling, make sure you have clicked the correct input box so it has focus! This input is just copy-paste, unrelated to keyboard control, and is not real key-by-key interaction",
        "parameters": {
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "The specific text content to input"}
            },
            "required": ["text"]
        }
    }
}

keyboard_press_tool = {
    "type": "function",
    "function": {
        "name": "keyboard_press",
        "description": "Press a single key. Useful when you need to press the same key repeatedly, e.g. deleting multiple characters or moving down repeatedly.",
        "parameters": {
            "type": "object",
            "properties": {
                "key": {
                    "type": "string", 
                    "description": "Key name, e.g.: 'enter', 'backspace', 'tab', 'down', 'esc'."
                },
                "presses": {
                    "type": "integer", 
                    "description": "Number of times to press the key, default 1.", 
                    "default": 1
                }
            },
            "required": ["key"]
        }
    }
}

keyboard_sequence_tool = {
    "type": "function",
    "function": {
        "name": "keyboard_sequence",
        "description": "Press several different keys in sequence. The program automatically pauses 0.5s between each. Useful for step-by-step key operations, e.g. 'press Tab to switch focus, then press Enter to confirm'.",
        "parameters": {
            "type": "object",
            "properties": {
                "keys": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "A list of key names, e.g. ['tab', 'enter'] or ['up', 'up', 'space']."
                }
            },
            "required": ["keys"]
        }
    }
}

keyboard_hotkey_tool = {
    "type": "function",
    "function": {
        "name": "keyboard_hotkey",
        "description": "Press a keyboard shortcut combination. For example, copy is ['ctrl', 'c'] and switching windows is ['alt', 'tab']. On macOS, use 'command' instead of 'ctrl'.",
        "parameters": {
            "type": "object",
            "properties": {
                "keys": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "An array of shortcut keys, which must be ordered by the sequence in which they are pressed, e.g.: ['ctrl', 'shift', 'esc']"
                }
            },
            "required": ["keys"]
        }
    }
}

keyboard_hold_tool = {
    "type": "function",
    "function": {
        "name": "keyboard_hold",
        "description": "Press and hold one or more keyboard keys for a while. This is very useful for controlling game-character movement or performing operations that require holding.",
        "parameters": {
            "type": "object",
            "properties": {
                "keys": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "A list of keys to hold, e.g. ['w'] or ['w', 'shift']."
                },
                "duration": {
                    "type": "number", 
                    "description": "How long to hold (seconds)."
                }
            },
            "required": ["keys", "duration"]
        }
    }
}


wait_tool = {
    "type": "function",
    "function": {
        "name": "wait",
        "description": "Pause and wait for a while. After clicking a link that loads a page, launching software, or entering content, you must call this tool to wait for the UI to finish refreshing, otherwise the next operation may fail because the target can't be found.",
        "parameters": {
            "type": "object",
            "properties": {
                "seconds": {"type": "number", "description": "The number of seconds to wait, e.g. 1, 2.5, 5. If the network or program loads slowly, extend it appropriately."}
            },
            "required": ["seconds"]
        }
    }
}
screenshot_tool = {
    "type": "function",
    "function": {
        "name": "screenshot",
        "description": "Capture an image of the current desktop with a per-mille assist grid"
    }
}

# Tool config declaration for logical click
logical_click_tool = {
    "type": "function",
    "function": {
        "name": "logical_click",
        "description": "Perform a logical click (accessibility click) in the background via a node ID from the current page/window UI tree, with no physical mouse movement; supports occluded windows and screen-off operation. If you can obtain a valid node ID, prefer this tool over a physical mouse click.",
        "parameters": {
            "type": "object",
            "properties": {
                "id": {
                    "type": "integer", 
                    "description": "The ID of the UI element to click (corresponds to the id field provided in the current UI-tree JSON)."
                }
            },
            "required": ["id"]
        }
    }
}


logical_type_tool = {
    "type": "function",
    "function": {
        "name": "logical_type",
        "description": "Input text directly into an input box in the background (accessibility input) via a node ID from the current page/window UI tree, with no physical mouse movement; supports occluded windows and screen-off operation. If you can obtain a valid input-box node ID, prefer this tool over copy_to_input_box for typing.",
        "parameters": {
            "type": "object",
            "properties": {
                "id": {
                    "type": "integer", 
                    "description": "The ID of the input box or text-area element to type into (corresponds to the id field provided in the current UI-tree JSON)."
                },
                "text": {
                    "type": "string",
                    "description": "The specific text content to input。"
                }
            },
            "required": ["id", "text"]
        }
    }
}

# Export all tools to a list so the main program can mount them uniformly
computer_use_tools = [
    wait_tool
    
]

desktopVision_use_tools = [
    screenshot_tool
]

mouse_use_tools = [
    mouse_move_tool,
    mouse_click_tool,
    mouse_double_click_tool,
    mouse_drag_tool,
    mouse_scroll_tool,
    mouse_hold_tool,
    logical_click_tool,
]

keyboard_use_tools = [
    keyboard_type_tool,
    keyboard_press_tool,
    keyboard_sequence_tool,
    keyboard_hotkey_tool,
    keyboard_hold_tool,
    logical_type_tool,
]