#!/usr/bin/env python3
import asyncio
import base64
import os
import re
import shutil
import signal
import subprocess
import json
import platform
import time
import uuid
import tempfile
import socket
import glob as std_glob
import fnmatch
from pathlib import Path
from typing import AsyncIterator
from datetime import datetime
from collections import deque
import aiofiles
import aiofiles.os
import hashlib
import anyio
from py.get_setting import load_settings
from py.get_setting import SKILLS_DIR

COMMAND_TIMEOUT = 300  # 5-minute timeout

# ==================== Environment initialization ====================

try:
    from zerobox import Sandbox, SandboxCommandError
    HAS_ZEROBOX = True
except ImportError:
    HAS_ZEROBOX = False

def get_shell_environment():
    """Get the full shell environment via a subprocess"""
    shell = os.environ.get('SHELL', '/bin/zsh')
    home = Path.home()
    
    config_commands = [
        f'source {home}/.zshrc && env',
        f'source {home}/.bash_profile && env', 
        f'source {home}/.bashrc && env',
        'env'
    ]
    
    # Simply skip on Windows
    if platform.system() == "Windows":
        return

    for cmd in config_commands:
        try:
            result = subprocess.run(
                [shell, '-i', '-c', cmd],
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.returncode == 0:
                for line in result.stdout.splitlines():
                    if '=' in line:
                        var_name, var_value = line.split('=', 1)
                        os.environ[var_name] = var_value
                print("Successfully loaded environment from shell")
                return
        except Exception as e:
            continue
    
    print("Warning: Could not load shell environment, using current environment")

get_shell_environment()

# ==================== Core infrastructure: stream processing ====================


async def read_stream(stream, *, is_error: bool = False):
    """
    Improved stream reader: supports multi-encoding fallback to ensure the system's raw errors are captured.
    """
    if stream is None:
        return
    
    prefix = "[ERROR] " if is_error else ""
    
    while True:
        line_bytes = await stream.readline()
        if not line_bytes:
            break
            
        decoded = ""
        # Try in order: UTF-8 -> GBK (Windows) -> CP437 -> replacement mode
        for enc in ['utf-8', 'gbk', 'cp437']:
            try:
                decoded = line_bytes.decode(enc).rstrip()
                break
            except UnicodeDecodeError:
                continue
        
        if not decoded:
            decoded = line_bytes.decode('utf-8', errors='replace').rstrip()
            
        yield f"{prefix}{decoded}"

# Read read_stream in chunks to prevent progress bars from hanging
async def read_stream_chunks(stream, prefix=""):
    """
    Read the stream in chunks without waiting for newlines, fixing progress-bar display issues.
    """
    if stream is None:
        return
    
    try:
        while True:
            # Read 4KB data chunk
            chunk = await stream.read(4096)
            if not chunk:
                break
            
            # Try decoding with multiple encodings
            decoded = ""
            for enc in ['utf-8', 'gbk', 'cp437']:
                try:
                    decoded = chunk.decode(enc)
                    break
                except UnicodeDecodeError:
                    continue
            
            if not decoded:
                decoded = chunk.decode('utf-8', errors='replace')
            
            if decoded:
                yield f"{prefix}{decoded}"
    except Exception as e:
        yield f"[System Stream Error] {e}"


async def _merge_streams(*streams):
    """Merge multiple async streams"""
    streams = [s.__aiter__() for s in streams]
    while streams:
        for stream in list(streams):
            try:
                item = await stream.__anext__()
                yield item
            except StopAsyncIteration:
                streams.remove(stream)

async def _get_current_cwd() -> str:
    """Get the currently configured working directory"""
    settings = await load_settings()
    cwd = settings.get("CLISettings", {}).get("cc_path")
    if not cwd:
        raise ValueError("No workspace directory specified in settings (CLISettings.cc_path).")
    return cwd

def get_detailed_exit_info(code: int, command: str) -> str:
    """
    Generate detailed diagnostics and suggestions based on the exit code and OS.
    """
    cmd_name = command.strip().split()[0] if command.strip() else "unknown"
    system = platform.system()
    
    # Base mapping
    explanations = {
        1: "Hint: exit code 1 means the command failed; carefully read the error info in the output above (e.g. keywords like Error, Fatal, error) to determine the cause.",
        2: "Improper use of a shell built-in command.",
        126: "Command not executable (insufficient permissions or not an executable file).",
        127: "Command not found (Linux/Unix).",
        130: "Terminated by Control-C.",
        137: "Process was force-killed (possibly triggered by an OOM out-of-memory).",
        # Windows-specific
        9009: f"Windows: 找不到命令 '{cmd_name}'。请检查程序是否已安装，或是否已加入 PATH 环境变量。",
        5: "Windows: access denied (insufficient permissions).",
    }
    
    info = f"\n[诊断信息] 进程退出码: {code}\n"
    info += f"[解释] {explanations.get(code, 'Unknown error type')}\n"
    
    if code in [127, 9009]:
        info += f"💡 建议:\n"
        if system == "Windows":
            info += f"  1. 运行 'where {cmd_name}' 检查程序位置。\n"
            info += f"  2. 如果是刚安装的软件，可能需要重启 Agent 或使用绝对路径。\n"
        else:
            info += f"  1. 运行 'which {cmd_name}' 检查程序位置。\n"
            info += f"  2. 检查环境变量: 'echo $PATH'\n"
            
    return info

# ==================== [New] Hashline anchor-edit core engine ====================

def get_line_hash(line: str) -> str:
    """Generate a 2-character hash of the line content (Hashline standard)"""
    clean_line = line.rstrip('\r\n')
    h = hashlib.md5(clean_line.encode('utf-8')).digest()
    b = base64.b64encode(h, altchars=b'AB').decode('utf-8')
    # Filter out non-alphanumeric chars, take the first two
    clean_b = ''.join(c for c in b if c.isalnum())
    return clean_b[:2].upper() if len(clean_b) >= 2 else 'XX'

def format_line_with_hash(line_number: int, content: str, max_line_chars: int = 1000) -> str:
    """Add a hash anchor to a code line, in a format like '   12#XJ| return True'"""
    content_stripped = content.rstrip('\r\n')
    line_hash = get_line_hash(content_stripped)
    
    if len(content_stripped) > max_line_chars:
        half = max_line_chars // 2
        display_content = f"{content_stripped[:half]} ... [Truncated] ... {content_stripped[-50:]}"
    else:
        display_content = content_stripped
        
    return f"{line_number:5}#{line_hash}| {display_content}"

def apply_hashline_edits(file_content: str, edits: list) -> tuple[bool, str, str]:
    """
    Core hash-replacement engine (supports automatic offset repair / auto-healing)
    """
    lines = file_content.split('\n')
    
    # --- Helper: auto path-finding ---
    def find_actual_index(expected_idx: int, expected_hash: str, window: int = 50) -> int:
        """Find a hash-matching line near expected_idx"""
        # 1. First try exact match (no line-number shift; fastest)
        if 0 <= expected_idx < len(lines):
            if get_line_hash(lines[expected_idx]) == expected_hash:
                return expected_idx
                
        # 2. If no match, the file may have had lines inserted/deleted; start a sliding-window search up and down
        start = max(0, expected_idx - window)
        end = min(len(lines), expected_idx + window + 1)
        
        matches = []
        for i in range(start, end):
            if get_line_hash(lines[i]) == expected_hash:
                matches.append(i)
                
        if len(matches) == 1:
            # Found exactly one nearby match; perfectly corrects the offset
            return matches[0]
        elif len(matches) > 1:
            raise ValueError(f"Hash '{expected_hash}' is ambiguous in the nearby window. Multiple identical lines found. Please provide more context or re-read the file.")
        else:
            raise ValueError(f"Hash '{expected_hash}' not found near line {expected_idx+1}. The file content may have been heavily modified.")

    try:
        parsed_edits = []
        for edit in edits:
            start_anchor = str(edit.get('start_anchor', ''))
            end_anchor = str(edit.get('end_anchor', '')) or start_anchor
            new_content = edit.get('new_content', '')
            
            def parse_anchor(anchor: str):
                if not anchor or '#' not in anchor:
                    raise ValueError(f"Invalid anchor format: {anchor}")
                num_str, rest = anchor.split('#', 1)
                line_num = int(num_str.strip())
                
                # Guard against AI copy hallucination
                if '|' in rest:
                    hash_str = rest.split('|')[0].strip()
                else:
                    hash_str = rest.strip()[:2]
                return line_num, hash_str
            
            s_num, s_hash = parse_anchor(start_anchor)
            e_num, e_hash = parse_anchor(end_anchor)
            
            if s_num > e_num:
                raise ValueError(f"start_anchor line ({s_num}) > end_anchor line ({e_num})")
            
            # --- Use auto path-finding to locate the real index ---
            actual_s_idx = find_actual_index(s_num - 1, s_hash)
            actual_e_idx = find_actual_index(e_num - 1, e_hash)
            
            if actual_s_idx > actual_e_idx:
                raise ValueError("Start anchor found AFTER end anchor due to heavy file modifications.")
            
            parsed_edits.append({
                'start_idx': actual_s_idx, 
                'end_idx': actual_e_idx, 
                'new_content': new_content
            })
        
        # Must edit bottom-up (reverse order) so earlier edits don't shift later line numbers
        parsed_edits.sort(key=lambda x: x['start_idx'], reverse=True)
        
        for edit in parsed_edits:
            s_idx = edit['start_idx']
            e_idx = edit['end_idx']
            
            # Replace the corresponding block
            replacement_lines = edit['new_content'].split('\n') if edit['new_content'] else []
            lines[s_idx:e_idx+1] = replacement_lines
            
    except Exception as e:
        return False, file_content, f"Hash Edit Failed: {str(e)}"
        
    return True, '\n'.join(lines), "Success"

def _apply_patch(content: str, old_string: str, new_string: str) -> tuple[bool, str, str]:
    """
    A highly robust patch-application algorithm that fully solves AI newline hallucination and the 'ever-growing blank lines' problem.
    """
    # Normalize line endings to \n
    content_lf = content.replace('\r\n', '\n')
    old_lf = old_string.replace('\r\n', '\n')
    new_lf = new_string.replace('\r\n', '\n')

    # 1. Absolute exact match (fastest, never produces extra blank lines)
    if old_lf in content_lf:
        return True, content_lf.replace(old_lf, new_lf, 1), "Exact match successful."

    # 2. Smart fuzzy-match stage
    content_lines = content_lf.split('\n')
    old_lines = old_lf.split('\n')
    new_lines = new_lf.split('\n')

    # Helper: count leading/trailing blank lines
    def count_empty_padding(lines):
        start = 0
        while start < len(lines) and not lines[start].strip():
            start += 1
        end = 0
        while end < len(lines) and not lines[len(lines)-1-end].strip():
            end += 1
        return start, end

    # Count and strip the formatting blank lines at the start/end of old_lines
    old_pad_start, old_pad_end = count_empty_padding(old_lines)
    old_actual_end = len(old_lines) - old_pad_end
    old_stripped = old_lines[old_pad_start : old_actual_end]
    
    if not old_stripped:
        return False, content, "old_string is empty or only contains whitespaces."

    # Sliding-window match
    def find_match(ignore_leading=False):
        for i in range(len(content_lines) - len(old_stripped) + 1):
            match = True
            for j in range(len(old_stripped)):
                c_line = content_lines[i+j].rstrip()
                o_line = old_stripped[j].rstrip()
                if ignore_leading:
                    c_line = c_line.lstrip()
                    o_line = o_line.lstrip()
                if c_line != o_line:
                    match = False
                    break
            if match:
                return i
        return -1

    match_idx = find_match(ignore_leading=False)
    msg = "Fuzzy match successful (ignored trailing whitespaces)."
    if match_idx == -1:
        match_idx = find_match(ignore_leading=True)
        msg = "Fuzzy match successful (ignored leading/trailing whitespaces)."

    if match_idx != -1:
        # Slice out the preserved original text
        pre = content_lines[:match_idx]
        post = content_lines[match_idx + len(old_stripped):]
        
        # --- Core logic to prevent blank-line bloat ---
        new_pad_start, new_pad_end = count_empty_padding(new_lines)
        
        # Cancel out the useless context blank lines the AI added to both old and new
        # Only write blank lines to the file when the AI deliberately added extra ones in new_string (i.e. the difference)
        strip_front = min(old_pad_start, new_pad_start)
        strip_back = min(old_pad_end, new_pad_end)
        
        new_actual_end = len(new_lines) - strip_back
        new_final = new_lines[strip_front : new_actual_end]
        
        # Core fix: merge using pure lists, never hardcode an extra "\n"
        new_content = '\n'.join(pre + new_final + post)
        return True, new_content, msg

    # Match failed; generate line-numbered correction hints for the AI
    first_line_clean = old_stripped[0].strip()
    candidates =[]
    for i, line in enumerate(content_lines):
        if first_line_clean and first_line_clean in line:
            candidates.append(f"Line {i+1}: {line.strip()[:80]}")
            
    err_msg = "[Error] old_string not found in file. Check line endings or indentation.\n"
    if candidates:
        err_msg += "Did you mean one of these locations?\n" + "\n".join(candidates[:5])
    return False, content, err_msg

# ==================== [New] Core infrastructure: process management ====================

class ProcessManager:
    """Global background-process manager (Docker & Local) - enhanced version (supports killing Windows process trees)"""
    def __init__(self):
        # Structure: {pid: {"proc": proc, "logs": deque, "cmd": str, "type": str, "task": task, "status": str, "start_time": str}}
        self._processes = {}
        self._counter = 0

    def generate_id(self):
        self._counter += 1
        return str(self._counter)

    async def register_process(self, proc, cmd: str, p_type: str):
        """Register and start monitoring a background process"""
        pid = self.generate_id()
        logs = deque(maxlen=2000)
        
        task = asyncio.create_task(self._monitor_output(pid, proc, logs))
        
        self._processes[pid] = {
            "proc": proc,
            "logs": logs,
            "cmd": cmd,
            "type": p_type,
            "task": task,
            "status": "running",
            "start_time": datetime.now().isoformat()
        }
        return pid

    async def _monitor_output(self, pid: str, proc, logs: deque):
        async def read_stream_to_log(stream, prefix=""):
            if not stream: return
            try:
                while True:
                    # Read in chunks instead of using readline()
                    chunk = await stream.read(1024) 
                    if not chunk:
                        break
                    
                    decoded = ""
                    for enc in ['utf-8', 'gbk', 'cp437']:
                        try:
                            decoded = chunk.decode(enc)
                            break
                        except UnicodeDecodeError:
                            continue
                    if not decoded:
                        decoded = chunk.decode('utf-8', errors='replace')

                    timestamp = datetime.now().strftime("%H:%M:%S")
                    
                    # Handle carriage returns \r by replacing them with newlines so each progress-bar update shows in the log
                    # If you don't need to keep every progress-bar line, you can just use decoded.strip()
                    lines = decoded.replace('\r', '\n').splitlines()
                    for line in lines:
                        if line.strip():
                            logs.append(f"[{timestamp}] {prefix}{line}")
            except Exception as e:
                logs.append(f"[SYSTEM ERROR] {prefix}Monitoring failed: {str(e)}")

        try:
            await asyncio.gather(
                read_stream_to_log(proc.stdout, ""),
                read_stream_to_log(proc.stderr, "[ERR] ")
            )
            await proc.wait()
            if pid in self._processes:
                if "terminated" not in self._processes[pid]["status"]:
                    self._processes[pid]["status"] = f"exited (code {proc.returncode})"
        except Exception:
            pass

    def get_logs(self, pid: str, lines: int = 50) -> str:
        if pid not in self._processes:
            return f"Error: Process ID {pid} not found."
        
        entry = self._processes[pid]
        stored_logs = list(entry["logs"])
        subset = stored_logs[-lines:] if lines > 0 else stored_logs
        
        header = f"--- Logs for Process {pid} ({entry['status']}) ---\nCommand: {entry['cmd']}\n"
        return header + "\n".join(subset)

    def list_processes(self):
        if not self._processes:
            return "No background processes running."
        
        result = ["PID | Type   | Status       | Start Time          | Command"]
        result.append("-" * 90)
        
        active_found = False
        for pid, info in list(self._processes.items()):
            cmd_display = (info['cmd'][:45] + '...') if len(info['cmd']) > 45 else info['cmd']
            start_time = info['start_time'].split('T')[-1][:8]
            result.append(f"{pid:<4}| {info['type']:<7}| {info['status']:<13}| {start_time:<20}| {cmd_display}")
            active_found = True
        
        if not active_found:
            return "No background processes running."
        return "\n".join(result)

    async def kill_process(self, pid: str):
        """
        Force-terminate a process.
        On Windows, uses taskkill /T to kill the process tree, preventing leftover child processes.
        """
        if pid not in self._processes:
            return f"Error: Process ID {pid} not found."
        
        info = self._processes[pid]
        proc = info["proc"]
        
        # Even if proc.returncode is already set, still try to clean up possible orphan processes
        os_pid = proc.pid
        
        try:
            info["status"] = "terminating..."
            
            if platform.system() == "Windows":
                # Windows: use taskkill /F (force) /T (process tree) /PID <pid>
                # This is key to cleaning up child processes spawned by PowerShell/CMD
                kill_cmd = f"taskkill /F /T /PID {os_pid}"
                subprocess.run(kill_cmd, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                # Linux/Mac: try killing the process group (if applicable) or standard terminate
                try:
                    proc.terminate()
                    # Give it a moment to exit gracefully
                    await asyncio.wait_for(proc.wait(), timeout=2.0)
                except (asyncio.TimeoutError, ProcessLookupError):
                    try:
                        proc.kill()
                    except:
                        pass
            
            info["status"] = "terminated"
            return f"Process {pid} (OS PID {os_pid}) terminated successfully."
            
        except Exception as e:
            return f"Error terminating process {pid}: {str(e)}"
        
process_manager = ProcessManager()

# ==================== [New] Core infrastructure: Docker network proxy ====================

class DockerPortProxy:
    """A pure-Python Docker port forwarder (Container -> Host)"""
    def __init__(self, container_name: str):
        self.container_name = container_name
        self.proxies = {} # {local_port: server_obj}

    async def start_forward(self, local_port: int, container_port: int):
        """Start forwarding: local TCP server -> docker exec bridge -> port inside the container"""
        if local_port in self.proxies:
            return f"Port {local_port} is already being forwarded."

        if not self._is_port_available(local_port):
            return f"Error: Local port {local_port} is already in use."

        try:
            server = await asyncio.start_server(
                lambda r, w: self._handle_client(r, w, container_port),
                '127.0.0.1', local_port
            )
            
            self.proxies[local_port] = server
            asyncio.create_task(server.serve_forever())
            return f"Success: Forwarding localhost:{local_port} -> Docker:{container_port}"
        except Exception as e:
            return f"Error starting proxy: {str(e)}"

    def _is_port_available(self, port: int) -> bool:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            return s.connect_ex(('127.0.0.1', port)) != 0

    async def _handle_client(self, client_reader, client_writer, container_port):
        """Handle each connection: start a docker exec process as a pipe"""
        try:
            # Tiny Python forwarding script that runs inside the container
            proxy_script = (
                "import socket,sys,threading;"
                "s=socket.socket();"
                f"s.connect(('127.0.0.1',{container_port}));"
                "def r():"
                " while True:"
                "  d=s.recv(4096);"
                "  if not d: break;"
                "  sys.stdout.buffer.write(d);sys.stdout.flush();\n"
                "threading.Thread(target=r,daemon=True).start();"
                "while True:"
                " d=sys.stdin.buffer.read(4096);"
                " if not d: break;"
                " s.sendall(d)"
            )

            cmd = [
                "docker", "exec", "-i", 
                self.container_name, 
                "python3", "-u", "-c", proxy_script
            ]

            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL 
            )

            async def pipe_reader_to_writer(reader, writer):
                try:
                    while True:
                        data = await reader.read(4096)
                        if not data: break
                        writer.write(data)
                        await writer.drain()
                except Exception:
                    pass
                finally:
                    try: writer.close()
                    except: pass

            await asyncio.gather(
                pipe_reader_to_writer(client_reader, proc.stdin),  # Local -> Docker
                pipe_reader_to_writer(proc.stdout, client_writer)  # Docker -> Local
            )
            try: proc.terminate()
            except: pass

        except Exception as e:
            try: client_writer.close()
            except: pass

    async def stop_forward(self, local_port: int):
        if local_port in self.proxies:
            server = self.proxies[local_port]
            server.close()
            await server.wait_closed()
            del self.proxies[local_port]
            return f"Stopped forwarding on port {local_port}"
        return f"Port {local_port} was not being forwarded."
    
    def list_proxies(self):
        if not self.proxies:
            return "No active port forwardings."
        return "\n".join([f"localhost:{p} -> container:{p} (active)" for p in self.proxies.keys()])

DOCKER_PROXIES = {} # {container_name: ProxyInstance}

# ==================== Docker sandbox infrastructure ====================

def get_safe_container_name(cwd: str) -> str:
    """Generate a valid container name from the path"""
    abs_path = str(Path(cwd).resolve())
    path_hash = hashlib.md5(abs_path.encode()).hexdigest()[:12]
    return f"sandbox-{path_hash}"

async def get_or_create_docker_sandbox(cwd: str, image_name: str = "docker/sandbox-templates:claude-code") -> str:
    """Get or create a path-based persistent sandbox and map the global skills directory"""
    container_name = get_safe_container_name(cwd)
    
    # Get the host's global skills directory
    host_skills_dir = SKILLS_DIR
    
    check_proc = await asyncio.create_subprocess_exec(
        "docker", "ps", "-a", "--filter", f"name=^/{container_name}$", "--format", "{{.Names}}|{{.Status}}",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    stdout, _ = await check_proc.communicate()
    output = stdout.decode().strip()
    
    if container_name in output:
        status = output.split("|")[-1] if "|" in output else ""
        if "Up" in status:
            return container_name
        else:
            # Start an existing container
            await asyncio.create_subprocess_exec("docker", "start", container_name, stdout=asyncio.subprocess.PIPE)
            return container_name
    
    # Create a new container, mapping the host's global skills directory
    # Note: we map the host skills directory to /root/.agents/skills inside the container
    # This is the path used by the standard Agent Skills CLI
    create_cmd = [
        "docker", "run", "-d",
        "--name", container_name,
        "-v", f"{cwd}:/workspace",  # Map the working directory
        "-v", f"{host_skills_dir}:/home/agent/.agents/skills",   # Map the global skills directory into the container
        "-w", "/workspace",
        "--restart", "unless-stopped",
        image_name,
        "tail", "-f", "/dev/null"
    ]
    
    proc = await asyncio.create_subprocess_exec(
        *create_cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    stdout, stderr = await proc.communicate()
    
    if proc.returncode == 0:
        # Container created successfully; ensure the skills directory permissions inside are correct
        try:
            # Set permissions of the skills directory inside the container
            chown_cmd = [
                "docker", "exec", container_name,
                "chown", "-R", "root:root", "/root/.agents/skills"
            ]
            chown_proc = await asyncio.create_subprocess_exec(
                *chown_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            await chown_proc.communicate()
        except Exception:
            # A permission-setting failure doesn't affect core functionality
            pass
        
        return container_name
    else:
        # Simple retry logic
        if "is already in use" in stderr.decode():
            await asyncio.sleep(0.5)
            return await get_or_create_docker_sandbox(cwd, image_name)
        raise Exception(f"Failed to create sandbox: {stderr.decode()}")


async def _exec_docker_cmd_simple(cwd: str, cmd_list: list) -> str:
    """Internal helper: run a simple command inside the container and get its output"""
    container_name = await get_or_create_docker_sandbox(cwd)
    full_cmd = ["docker", "exec", "-w", "/workspace", container_name] + cmd_list
    
    proc = await asyncio.create_subprocess_exec(
        *full_cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    stdout, stderr = await proc.communicate()
    
    if proc.returncode != 0:
        raise Exception(f"Command failed: {stderr.decode().strip()}")
    return stdout.decode()

# ==================== Sensitive-info redaction utility ====================

def _is_env_file(file_path: str) -> bool:
    """Determine whether a file is an environment-variable file (based on its filename)"""
    if not file_path:
        return False
    name = os.path.basename(file_path)
    return (
        name.startswith('.env') or 
        name.startswith('env.') or 
        name in ['.env', 'env', 'environment']
    )

def _mask_sensitive_value(value: str) -> str:
    """Redact a value: replace it with a mask, showing only the beginning and end"""
    v = value.strip()
    if len(v) <= 4:
        return '*' * len(v)
    elif len(v) <= 8:
        return v[0] + '*' * (len(v) - 2) + v[-1]
    else:
        return v[:3] + '*' * (len(v) - 6) + v[-3:]

def _mask_env_content(text: str) -> str:
    """Redact lines containing KEY=VALUE, replacing the VALUE part with a mask"""
    pattern = re.compile(
        r'^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*)(\S+)(.*)$',
        re.IGNORECASE
    )
    masked_lines = []
    for line in text.splitlines():
        match = pattern.match(line)
        if match:
            prefix = match.group(1)
            value = match.group(2)
            suffix = match.group(3) or ''
            masked_value = _mask_sensitive_value(value)
            new_line = f"{prefix}{masked_value}{suffix}"
            masked_lines.append(new_line)
        else:
            masked_lines.append(line)
    return "\n".join(masked_lines)

def _maybe_mask_output(file_path: str, output: str) -> str:
    """
    Decide whether to redact output based on the file path.
    Used by tools like read_file, read_file_range, tail_file.
    The output may include a line-number prefix, e.g. "   42 | CONTENT".
    """
    if not _is_env_file(file_path):
        return output

    masked = []
    for line in output.splitlines():
        # If it contains a pipe, it may be line-numbered output
        if '|' in line:
            parts = line.split('|', 1)
            if len(parts) == 2:
                line_no = parts[0].strip()
                content = parts[1]
                masked_line = f"{line_no} | {_mask_env_content(content)}"
            else:
                masked_line = _mask_env_content(line)
        else:
            masked_line = _mask_env_content(line)
        masked.append(masked_line)
    return "\n".join(masked)

# ==================== Docker-environment tool implementation (with new features) ====================

async def docker_sandbox(command: str, background: bool = False, timeout: int = 600) -> AsyncIterator[str]:
    """
    [Docker] Sandbox execution (flattened version, returns an async generator directly)
    """
    effective_timeout = max(1, min(timeout, 3600))
    settings = await load_settings()
    cwd = settings.get("CLISettings", {}).get("cc_path")
    if not cwd:
        yield "Error: No workspace directory specified."
        return
    
    try:
        container_name = await get_or_create_docker_sandbox(cwd)
    except Exception as e:
        yield f"Docker Sandbox Error: {str(e)}"
        return

    exec_cmd = [
        "docker", "exec", 
        "-i", 
        "-e", "PYTHONUNBUFFERED=1",
        "-e", "TERM=xterm",
        container_name, 
        "sh", "-c", f"cd /workspace && {command}"
    ]
    
    try:
        process = await asyncio.create_subprocess_exec(
            *exec_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        if background:
            pid = await process_manager.register_process(process, f"[Docker] {command}", "docker")
            yield f"[SUCCESS] Docker PID: {pid}"
            return

        queue = asyncio.Queue()
        async def wrap_stdout():
            async for chunk in read_stream_chunks(process.stdout, ""):
                await queue.put(chunk)
        async def wrap_stderr():
            async for chunk in read_stream_chunks(process.stderr, "[Docker stderr] "):
                await queue.put(chunk)

        stdout_task = asyncio.create_task(wrap_stdout())
        stderr_task = asyncio.create_task(wrap_stderr())

        start_time = time.time()
        try:
            while not (stdout_task.done() and stderr_task.done() and queue.empty()):
                remaining = effective_timeout - (time.time() - start_time)
                if remaining <= 0:
                    raise asyncio.TimeoutError()
                try:
                    content = await asyncio.wait_for(queue.get(), timeout=0.1)
                    yield content
                except asyncio.TimeoutError:
                    continue
            
            await process.wait()

        except asyncio.TimeoutError:
            process.kill()
            yield f"\n\n[TIMEOUT ERROR] Docker 命令执行超过 {effective_timeout} 秒已强制终止。注意！命令并未完全执行完毕。"
            yield "\n💡 Hint: for launching apps or downloading large files, use 'background': true."
    except Exception as e:
        yield f"[ERROR] Docker 进程启动失败: {str(e)}"

async def edit_file_patch_tool(path: str, edits: list) -> str:
    """[Docker] Exact replace (rewritten with Hashline, deprecating old_string)"""
    try:
        real_cwd = await _get_current_cwd()
        container_name = await get_or_create_docker_sandbox(real_cwd)
        
        try:
            content = await _exec_docker_cmd_simple(real_cwd, ["cat", path])
        except Exception as e:
            return f"[Error] Cannot read file for patching: {e}"
        
        success, new_content, msg = apply_hashline_edits(content, edits)
        if not success:
            return msg # Return the detailed hash-mismatch error to the AI
            
        with tempfile.NamedTemporaryFile(mode='w', delete=False, encoding='utf-8') as tmp:
            tmp.write(new_content)
            tmp_path = tmp.name
        
        dest_path = f"{container_name}:/workspace/{path}"
        cp_proc = await asyncio.create_subprocess_exec("docker", "cp", tmp_path, dest_path, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        await cp_proc.communicate()
        os.unlink(tmp_path)
        
        if cp_proc.returncode != 0: return "[Error] Patch copy failed."
        return f"[Success] Patched '{path}' using Hashline. ({msg})"
    except Exception as e:
        return f"[Error] Patch failed: {str(e)}"

async def glob_files_tool(pattern: str, exclude: str = "**/node_modules/**,**/.git/**,**/__pycache__/**") -> str:
    """[Docker] Glob recursive search"""
    try:
        real_cwd = await _get_current_cwd()
        exclude_list = [e.strip() for e in exclude.split(",") if e.strip()]
        
        python_script = f'''
import glob, os, json, fnmatch
files = glob.glob("/workspace/{pattern}", recursive=True)
exclude_patterns = {exclude_list}
filtered = []
for f in files:
    if not os.path.isfile(f): continue
    rel_path = f.replace("/workspace/", "")
    should_exclude = False
    for ex in exclude_patterns:
        if fnmatch.fnmatch(rel_path, ex) or fnmatch.fnmatch(f, ex):
            should_exclude = True; break
    if not should_exclude: filtered.append(rel_path)
print(json.dumps(filtered))
'''
        output = await _exec_docker_cmd_simple(real_cwd, ["python3", "-c", python_script])
        files = json.loads(output)
        if not files: return "[Result] No files found."
        
        lines = [f"[{len(files)} files matched]"]
        for f in files[:50]:
            icon = "🐍" if f.endswith(".py") else "📄"
            lines.append(f"{icon} {f}")
        if len(files) > 50: lines.append(f"... {len(files)-50} more")
        return "\n".join(lines)
    except Exception as e:
        return f"[Error] Glob failed: {str(e)}"

async def todo_write_tool(action: str, id: str = None, content: str = None, 
                          priority: str = "medium", status: str = None) -> str:
    """[Docker] To-do task management tool - uses 3-digit sequential IDs"""
    try:
        real_cwd = await _get_current_cwd()
        container_name = await get_or_create_docker_sandbox(real_cwd)
        todo_file = "/workspace/.agent/ai_todos.json"
        
        # Read the task list from the Docker container
        try:
            data = await _exec_docker_cmd_simple(real_cwd, ["cat", todo_file])
            todos = json.loads(data)
        except:
            todos = []
            
        msg = ""

        # Helper to generate the next sequential ID
        def _generate_ordered_id(existing_todos):
            if not existing_todos:
                return "1"
            # Find the largest numeric ID (compatible with legacy data)
            numeric_ids = [int(t['id']) for t in existing_todos if t['id'].isdigit()]
            if not numeric_ids:
                return "1"
            return str(max(numeric_ids) + 1)  # 1, 2, 3... no zero-padding, no digit limit

        if action == "create":
            """Create a new task - auto-generates a 3-digit sequential ID"""
            if not content: 
                return "[Error] Creating a task requires the content parameter"
            
            new_id = _generate_ordered_id(todos)
            new_todo = {
                "id": new_id,
                "content": content,
                "priority": priority,
                "status": "pending",
                "created_at": datetime.now().isoformat(),
                "completed_at": None
            }
            todos.append(new_todo)
            msg = f"[Success] 已创建任务 #{new_id}: {content[:30]}"
            
        elif action == "list":
            """List all tasks - sorted by numeric ID"""
            if not todos: 
                return "No tasks at the moment"
            
            lines = ["📋 **Task list** (larger ID = created later):"]
            sorted_todos = sorted(todos, key=lambda x: int(x['id']) if x['id'].isdigit() else 0)
            
            for t in sorted_todos:
                icon = "✅" if t.get('status') == 'done' else "⏳"
                priority_map = {"high": "🔴", "medium": "🟡", "low": "🟢"}
                p_icon = priority_map.get(t.get('priority', 'medium'), "⚪")
                lines.append(f"{icon} [{t['id']}] {p_icon} {t['content'][:40]}")
            return "\n".join(lines)

        elif action == "complete":
            """[High-frequency] Mark a task as completed - idempotent operation"""
            if not id: 
                return "[Error] Completing a task requires an id (e.g.: 001)"
            
            target = next((t for t in todos if t['id'] == id), None)
            if not target: 
                return f"[Error] 未找到任务 #{id}"
            
            if target.get('status') == 'done':
                msg = f"[Info] 任务 #{id} 已经是完成状态"
            else:
                target['status'] = 'done'
                target['completed_at'] = datetime.now().isoformat()
                msg = f"[Success] 已完成任务 #{id}"

        elif action == "toggle":
            """Toggle completion status"""
            if not id: 
                return "[Error] Toggling status requires an id"
            
            target = next((t for t in todos if t['id'] == id), None)
            if not target: 
                return f"[Error] 未找到任务 #{id}"
            
            if target.get('status') != 'done':
                target['status'] = 'done'
                target['completed_at'] = datetime.now().isoformat()
                msg = f"[Success] 已完成任务 #{id}"
            else:
                target['status'] = 'pending'
                target['completed_at'] = None
                msg = f"[Success] 已重新打开任务 #{id}"

        elif action == "update":
            """Edit task details"""
            if not id: 
                return "[Error] Updating a task requires an id"
            
            target = next((t for t in todos if t['id'] == id), None)
            if not target: 
                return f"[Error] 未找到任务 #{id}"
            
            if content: 
                target['content'] = content
            if priority: 
                target['priority'] = priority
            
            if status:
                if status == "done" and target.get('status') != "done":
                    target['completed_at'] = datetime.now().isoformat()
                elif status != "done" and target.get('status') == "done":
                    target['completed_at'] = None
                target['status'] = status
            
            target['updated_at'] = datetime.now().isoformat()
            msg = f"[Success] 已更新任务 #{id}"

        elif action == "delete":
            """Delete a task"""
            if not id: 
                return "[Error] Deleting a task requires an id"
            
            target = next((t for t in todos if t['id'] == id), None)
            if not target: 
                return f"[Error] 未找到任务 #{id}"
            
            todos.remove(target)
            msg = f"[Success] 已Delete a task #{id}"

        else:
            return f"[Error] 未知操作: {action}"

        # Write back to the Docker container
        with tempfile.NamedTemporaryFile(mode='w', delete=False, encoding='utf-8') as tmp:
            tmp.write(json.dumps(todos, indent=2, ensure_ascii=False))
            tmp_path = tmp.name
        
        await _exec_docker_cmd_simple(real_cwd, ["mkdir", "-p", "/workspace/.agent"])
        dest = f"{container_name}:{todo_file}"
        proc = await asyncio.create_subprocess_exec("docker", "cp", tmp_path, dest, 
                                                    stdout=asyncio.subprocess.PIPE)
        await proc.wait()
        
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
            
        return msg
        
    except Exception as e:
        return f"[Error] 任务操作失败: {str(e)}"
    
# Restore the original Docker base file tools
async def list_files_tool(path: str = ".", show_all: bool = True) -> str:
    try:
        real_cwd = await _get_current_cwd()
        flag = "-laF" if show_all else "-F"
        return await _exec_docker_cmd_simple(real_cwd, ["ls", flag, path])
    except Exception as e: return str(e)

async def read_file_tool(path: str, start_line: int = None, end_line: int = None) -> str:
    """[Docker] Read a file (with Hashline injected)"""
    if start_line is not None or end_line is not None:
        return await read_file_range_tool(path, start_line or 1, end_line or 1)
    try:
        real_cwd = await _get_current_cwd()
        # Use a Python script instead of awk to ensure consistent hashing of multilingual characters
        script = f"""
import sys, hashlib, base64
def get_h(l):
    c = l.rstrip('\\r\\n')
    b = base64.b64encode(hashlib.md5(c.encode()).digest(), altchars=b'AB').decode()
    c_b = ''.join(x for x in b if x.isalnum())
    return c_b[:2].upper() if len(c_b)>=2 else 'XX'

try:
    with open("{path}", "rb") as f:
        if b'\\0' in f.read(1024):
            print("[Error] Cannot read binary file")
            sys.exit(0)
except Exception: pass

total = 0
with open("{path}", "r", encoding="utf-8", errors="replace") as f:
    for i, line in enumerate(f, 1):
        total = i
        if i <= 1000:
            c = line.rstrip('\\r\\n')
            h = get_h(c)
            if len(c) > 1000: c = c[:500] + " ... [Truncated] ... " + c[-50:]
            print(f"{{i:5}}#{{h}}| {{c}}")

if total > 1000:
    print(f"\\n... [Warning] File truncated. Showing 1 to 1000 of {{total}} lines.")
"""
        raw_output = await _exec_docker_cmd_simple(real_cwd, ["python3", "-c", script])
        return _maybe_mask_output(path, raw_output)
    except Exception as e: return f"[Error] Read failed: {str(e)}"

async def read_file_range_tool(path: str, start_line: int, end_line: int) -> str:
    """[Docker] Read an exact range (range reading as mentioned, with Hashline injected)"""
    try:
        if start_line < 1 or end_line < start_line: return "[Error] Invalid line range."
        real_cwd = await _get_current_cwd()
        script = f"""
import sys, hashlib, base64
def get_h(l):
    c = l.rstrip('\\r\\n')
    b = base64.b64encode(hashlib.md5(c.encode()).digest(), altchars=b'AB').decode()
    c_b = ''.join(x for x in b if x.isalnum())
    return c_b[:2].upper() if len(c_b)>=2 else 'XX'

with open("{path}", "r", encoding="utf-8", errors="replace") as f:
    for i, line in enumerate(f, 1):
        if i >= {start_line} and i <= {end_line}:
            c = line.rstrip('\\r\\n')
            h = get_h(c)
            if len(c) > 1000: c = c[:500] + " ... [Truncated] ... " + c[-50:]
            print(f"{{i:5}}#{{h}}| {{c}}")
        elif i > {end_line}: break
"""
        result = await _exec_docker_cmd_simple(real_cwd, ["python3", "-c", script])
        if len(result) > 50000: result = result[:50000] + "\n... [Warning] Output truncated."
        return _maybe_mask_output(path, result)
    except Exception as e: return str(e)

async def tail_file_tool(path: str, lines: int = 100) -> str:
    """[Docker] Read the tail (with Hashline injected)"""
    try:
        real_cwd = await _get_current_cwd()
        script = f"""
total=$(wc -l < "{path}" 2>/dev/null || echo 0)
start=$((total - {lines} + 1))
if [ $start -lt 1 ]; then start=1; fi
awk -v s=$start 'NR>=s' "{path}" | python3 -c "
import sys, hashlib, base64
def get_h(l):
    c = l.rstrip('\\r\\n')
    b = base64.b64encode(hashlib.md5(c.encode()).digest(), altchars=b'AB').decode()
    c_b = ''.join(x for x in b if x.isalnum())
    return c_b[:2].upper() if len(c_b)>=2 else 'XX'
start_idx = int(sys.argv[1])
for i, line in enumerate(sys.stdin, start_idx):
    c = line.rstrip('\\r\\n')
    h = get_h(c)
    print(f'{{i:5}}#{{h}}| {{c}}')
" $start
"""
        raw_output = await _exec_docker_cmd_simple(real_cwd, ["sh", "-c", script])
        return _maybe_mask_output(path, raw_output)
    except Exception as e: return str(e)

async def edit_file_tool(path: str, content: str) -> str:
    try:
        real_cwd = await _get_current_cwd()
        container_name = await get_or_create_docker_sandbox(real_cwd)
        with tempfile.NamedTemporaryFile(mode='w', delete=False, encoding='utf-8') as tmp:
            tmp.write(content)
            tmp_path = tmp.name
        await _exec_docker_cmd_simple(real_cwd, ["mkdir", "-p", os.path.dirname(path) or "."])
        dest = f"{container_name}:/workspace/{path}"
        proc = await asyncio.create_subprocess_exec("docker", "cp", tmp_path, dest, stdout=asyncio.subprocess.PIPE)
        await proc.wait()
        os.unlink(tmp_path)
        return f"[Success] Saved {path}"
    except Exception as e: return str(e)

def _mask_grep_output(grep_output: str) -> str:
    """Redact grep output; for matching lines in .env files, mask the VALUE part"""
    if not grep_output:
        return grep_output
    lines = grep_output.splitlines()
    masked_lines = []
    for line in lines:
        # grep output is usually: filename:line_number:matched_text
        parts = line.split(':', 2)
        if len(parts) >= 3:
            fname = parts[0]
            line_no = parts[1]
            content = parts[2]
            # If the filename matches the .env pattern, redact its content
            if _is_env_file(fname) or '.env' in fname.lower():
                content = _mask_env_content(content)
            masked_lines.append(f"{fname}:{line_no}:{content}")
        else:
            masked_lines.append(line)
    return "\n".join(masked_lines)


async def search_files_tool(pattern: str, path: str = ".") -> str:
    """[Docker] Grep search (appends Hashline anchors on the fly)"""
    try:
        real_cwd = await _get_current_cwd()
        script = """
import sys, hashlib, base64
def get_h(l):
    c = l.rstrip('\\r\\n')
    b = base64.b64encode(hashlib.md5(c.encode()).digest(), altchars=b'AB').decode()
    c_b = ''.join(x for x in b if x.isalnum())
    return c_b[:2].upper() if len(c_b)>=2 else 'XX'

for line in sys.stdin:
    parts = line.split(':', 2)
    if len(parts) >= 3:
        filepath, lineno, content = parts[0], parts[1], parts[2]
        h = get_h(content)
        print(f"{filepath}:{lineno}#{h}:{content.rstrip()}")
    else:
        print(line.rstrip())
"""
        cmd = f"grep -rn '{pattern}' '{path}' | python3 -c \"{script}\""
        raw_output = await _exec_docker_cmd_simple(real_cwd, ["sh", "-c", cmd])
        if '.env' in raw_output.lower(): return _mask_grep_output(raw_output)
        return raw_output
    except Exception as e: return str(e)


# ==================== [New] Management tools: processes and network ====================

async def list_processes_tool() -> str:
    """[Common] List all background processes (Docker & local)"""
    return process_manager.list_processes()

async def get_process_logs_tool(pid: str) -> str:
    """[Common] Get the logs of a specific process"""
    if not pid:
        return "Error: 'pid' is required to fetch logs."
    return process_manager.get_logs(pid)

async def kill_process_tool(pid: str) -> str:
    """[Common] Terminate a specific background process"""
    if not pid:
        return "Error: 'pid' is required to kill a process."
    return await process_manager.kill_process(pid)

async def docker_manage_ports_tool(action: str, container_port: int = 8000, host_port: int = None) -> str:
    """[Docker] Port-forwarding management"""
    try:
        real_cwd = await _get_current_cwd()
        container_name = await get_or_create_docker_sandbox(real_cwd)
        
        if container_name not in DOCKER_PROXIES:
            DOCKER_PROXIES[container_name] = DockerPortProxy(container_name)
        proxy = DOCKER_PROXIES[container_name]
        
        if action == "list":
            return proxy.list_proxies()
        if action == "forward":
            if not host_port: host_port = container_port
            return await proxy.start_forward(host_port, container_port)
        if action == "stop":
            if not host_port: return "Error: host_port required to stop."
            return await proxy.stop_forward(host_port)
        return "Unknown action."
    except Exception as e:
        return f"[Error] Port tool failed: {str(e)}"

async def local_net_tool(action: str, port: int = None) -> str:
    """[Local] Local network tool: check port usage"""
    if action == "check":
        if not port: return "Error: Port required."
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            result = s.connect_ex(('127.0.0.1', port))
            status = "OPEN/BUSY" if result == 0 else "CLOSED/FREE"
            return f"Port {port} on localhost is {status}."
    
    if action == "scan":
        # Simple scan of common development ports
        common_ports = [3000, 5000, 8000, 8080, 80, 443, 3306, 5432]
        results = []
        for p in common_ports:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(0.1)
                res = s.connect_ex(('127.0.0.1', p))
                status = "BUSY" if res == 0 else "FREE"
                results.append(f"{p}: {status}")
        return "Common Ports:\n" + "\n".join(results)
        
    return "Unknown action. Use check or scan."

# ==================== Local-environment tool implementation ====================

def resolve_strict_path(cwd: str, sub_path: str, check_symlink: bool = True) -> Path:
    """
    Strict workspace path resolution
    - Forbid absolute paths
    - Forbid ../ traversal  
    - Forbid symlinks pointing outside the workspace
    """
    base = Path(cwd).resolve()
    
    if not sub_path:
        return base
        
    # Sanitize input (block null bytes, newlines, etc.)
    sub_path = sub_path.strip().replace('\x00', '').replace('\n', '')
    
    # Explicitly forbid path-traversal patterns (fail fast)
    if '..' in sub_path.split(os.sep):
        raise PermissionError(f"Path traversal detected: {sub_path}")
    
    # Forbid absolute paths (Windows C:\ and Unix /)
    if os.path.isabs(sub_path) or (len(sub_path) > 1 and sub_path[1] == ':'):
        raise PermissionError(f"Absolute paths not allowed: {sub_path}")
    
    # Resolve the full path
    target = (base / sub_path).resolve()
    
    # Key check: ensure the resolved path is still inside base
    try:
        target.relative_to(base)
    except ValueError:
        raise PermissionError(f"Access denied: {sub_path} resolves outside workspace")
    
    # Symlink check (prevent /workspace/link -> /etc)
    if check_symlink and target.exists():
        real_path = target.resolve(strict=True)
        try:
            real_path.relative_to(base)
        except ValueError:
            raise PermissionError(f"Symlink escape detected: {sub_path} -> {real_path}")
            
    return target

from typing import Tuple

def validate_bash_command(command: str, cwd: str, mode: str = "default") -> Tuple[bool, str]:
    """
    Enhanced security-validation strategy (cross-platform: Win/Mac/Linux)
    """
    cmd_lower = command.lower()
    
    # ===== 1. Path-traversal and sensitive-directory defense =====
    # Prevent multi-level upward traversal escaping the workspace (e.g. ../../../etc/passwd)
    if re.search(r'(\.\.[/\\]){2,}', command):
        return False, "Multiple path traversal (../../) is blocked"

    # Cross-platform sensitive directories (handles both / and \)
    sensitive_roots = [
        # Linux / macOS
        r'(?:\s|^)/etc', r'(?:\s|^)/var', r'(?:\s|^)/root', 
        r'(?:\s|^)/bin', r'(?:\s|^)/sbin', r'(?:\s|^)/usr/local/bin',
        r'(?:\s|^)/sys', r'(?:\s|^)/proc', 
        # macOS-specific
        r'(?:\s|^)/Library', r'(?:\s|^)/System',
        # Windows (handles both C:\Windows and C:/Windows)
        r'(?:\s|^)[a-z]:[/\\]Windows', r'(?:\s|^)[a-z]:[/\\]Program Files', 
        r'(?:\s|^)[a-z]:[/\\]Users[/\\](?:Default|Public|Administrator)' 
    ]
    
    for pattern in sensitive_roots:
        if re.search(pattern, command, re.IGNORECASE):
            return False, f"Access to sensitive system directory blocked by pattern: {pattern}"

    # Forbid cd-ing directly to the root directory or another drive
    if re.search(r'\bcd\s+/[a-z0-9_]*$', command, re.IGNORECASE):
        return False, "Changing directory to root is blocked"
    if re.search(r'\bcd\s+[a-z]:[/\\]', command, re.IGNORECASE):
        return False, "Changing Windows drive directly is blocked"

    # ===== 2. Cross-platform destructive operations =====
    destructive_patterns = [
        # Linux/Mac file deletion (covers rm -rf /, rm -rf /*, rm -r -f /)
        (r'rm\s+-[rRfF\s]+\s*(/|[a-z]:[/\\])\*?', "Recursive delete root"),
        # Linux dangerous operations
        (r'mkfs\.[a-z]+', "Filesystem format"),                    
        (r'dd\s+if=.*of=/dev/[a-z]', "Direct device write"),       
        (r'>?\s*/dev/(sda|hd|nvme|mmcblk)', "Block device access"),
        (r'chmod\s+-[R\s]*777\s+/', "Change root permissions"),
        (r'chown\s+-[R\s]*root\s+/', "Change root ownership"),
        (r':\(\)\{\s*:\|:&?\s*\};\s*:', "Fork bomb"), 
        # Windows dangerous operations (registry destruction, dangerous formatting)
        (r'(?:\s|^)format\s+[a-z]:', "Windows disk format"),
        (r'(?:\s|^)reg\s+(delete|add)\s+(HKLM|HKEY_LOCAL_MACHINE)', "Modify system registry"),
        (r'Remove-Item\s+-Recurse\s+-Force\s+[a-z]:[/\\]', "Powershell recursive delete root"),
        # macOS dangerous operations
        (r'nvram\s+-c', "Clear Mac NVRAM"),
    ]
    
    for pattern, reason in destructive_patterns:
        if re.search(pattern, command, re.IGNORECASE):
            return False, f"Destructive operation blocked: {reason}"
    
    # ===== 3. Risky operations (privilege escalation, phishing, remote execution) =====
    if mode != "yolo":
        risk_patterns = [
            # Linux/Mac privilege escalation and remote loading
            (r'(?:\s|^)sudo\s+', "sudo usage blocked (prevents password wait/escalation)"),
            (r'(curl|wget).*\|\s*(sh|bash|zsh|python|perl|php)', "Remote execution via pipe"),
            (r'$\{?HOME\}?', "HOME env variable usage"),
            (r'~\s*/', "Home directory access via ~"),
            # macOS phishing warning (guard against AI popups stealing the user's password)
            (r'(?:\s|^)osascript\s+-e\s+.*password', "AppleScript password prompt blocked"),
            # Windows remote loading (Powershell IEX)
            (r'(Invoke-WebRequest|iwr|Invoke-RestMethod|irm).*\|\s*(Invoke-Expression|iex)', "PowerShell remote script execution"),
        ]
        for pattern, reason in risk_patterns:
            if re.search(pattern, command, re.IGNORECASE):
                return False, f"{reason} blocked in {mode} mode"
    
    return True, command


async def shell_tool_local(command: str, background: bool = False, timeout: int = 600) -> AsyncIterator[str]:
    """
    [Local] Execute a local command
    - Windows: keeps the original powershell/cmd logic.
    - Non-Windows: prefers zerobox.Sandbox for OS-level sandbox isolation.
    """
    # Clamp timeout range: 1 second to 1 hour
    effective_timeout = max(1, min(timeout, 3600))
    
    settings = await load_settings()
    cwd = settings.get("CLISettings", {}).get("cc_path")
    perm = settings.get("localEnvSettings", {}).get("permissionMode", "default")
    
    if not cwd: 
        yield "Error: No workspace directory specified (cc_path)."
        return
    
    # Security-validation strategy (double protection)
    allowed, validate_result = validate_bash_command(command, cwd, mode=perm)
    if not allowed:
        yield f"[Security] Command blocked: {validate_result}"
        return
    
    system = platform.system()

    # ==================== Non-Windows with ZeroBox installed ====================
    # Note: the SDK is currently synchronous/blocking. To keep the CLI responsive we run it in a thread.
    # And for PID-manager compatibility, only use the SDK for foreground tasks (background=False).
    if system != "Windows" and HAS_ZEROBOX and not background:
        try:
            yield f"--- [Sandbox Mode] Executing via zerobox.Sandbox ---\n"
            
            def run_sandbox():
                # Create a sandbox instance: allow read/write of the cwd, enable all permissions for complex-command compatibility
                # For stricter behavior, change allow_all=True to allow_write=[cwd]
                sb = Sandbox.create({
                    "cwd": cwd,
                    "allow_write": [cwd],  
                    "allow_read": [cwd],  
                    "allow_net": True,
                })
                # Use .output() to get code, stdout, stderr without raising execution exceptions
                return sb.sh(command).output(timeout=float(effective_timeout))

            # Run the synchronous SDK call in a thread pool
            result = await asyncio.to_thread(run_sandbox)
            
            if result.stdout:
                yield result.stdout
            if result.stderr:
                yield f"[stderr] {result.stderr}"
            
            if result.code != 0:
                yield f"\n--- 运行结束 (Exit Code: {result.code}) ---"
                yield get_detailed_exit_info(result.code, command)
            
            return # Task finished

        except subprocess.TimeoutExpired:
            yield f"\n\n[TIMEOUT ERROR] 命令执行超过 {effective_timeout} 秒已强制终止。"
            return
        except Exception as e:
            yield f"[Sandbox Error] ZeroBox SDK 运行异常: {str(e)}\n尝试回退到标准 Shell...\n"
            # On error, don't return; fall through to the standard execution logic below

    # ==================== Windows, or falling back to the standard shell ====================
    
    if system == "Windows":
        def is_strictly_cmd(cmd_str: str) -> bool:
            c = cmd_str.lower().strip()
            if re.search(r'%[a-z0-9_]+%', c): return True
            if '&&' in c and '$' not in c: return True
            return False
            
        if is_strictly_cmd(command):
            exe, args = "cmd.exe", ["/c", command]
        else:
            exe, args = "powershell.exe", ["-NonInteractive", "-NoProfile", "-Command", command]
    else:
        # Non-Windows fallback or background task
        exe, args = os.environ.get('SHELL', '/bin/bash'), ["-c", command]

    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    env["TERM"] = "xterm"

    try:
        process = await asyncio.create_subprocess_exec(
            exe, *args,
            stdout=asyncio.subprocess.PIPE, 
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
            env=env,
            start_new_session=(system != "Windows")
        )

        if background:
            pid = await process_manager.register_process(process, command, "local")
            yield f"[SUCCESS] Background process started.\nPID: {pid}"
            return

        queue = asyncio.Queue()
        async def wrap_stdout():
            async for chunk in read_stream_chunks(process.stdout, ""):
                await queue.put(chunk)
        async def wrap_stderr():
            async for chunk in read_stream_chunks(process.stderr, "[stderr] "):
                await queue.put(chunk)

        stdout_task = asyncio.create_task(wrap_stdout())
        stderr_task = asyncio.create_task(wrap_stderr())

        start_time = time.time()
        try:
            while not (stdout_task.done() and stderr_task.done() and queue.empty()):
                remaining = effective_timeout - (time.time() - start_time)
                if remaining <= 0:
                    raise asyncio.TimeoutError()
                try:
                    content = await asyncio.wait_for(queue.get(), timeout=0.1)
                    yield content
                except asyncio.TimeoutError:
                    continue

            await process.wait()
            if process.returncode != 0:
                yield f"\n--- 运行结束 (Exit Code: {process.returncode}) ---"
                yield get_detailed_exit_info(process.returncode, command)
                
        except asyncio.TimeoutError:
            # Process-tree kill logic
            if system == "Windows":
                subprocess.run(f"taskkill /F /T /PID {process.pid}", shell=True, capture_output=True)
            else:
                try:
                    os.killpg(os.getpgid(process.pid), signal.SIGKILL)
                except:
                    process.kill()
            yield f"\n\n[TIMEOUT ERROR] 命令执行超过 {effective_timeout} 秒已强制终止。"
            yield "\n💡 Hint: for long-running tasks, use 'background': true."
            
    except Exception as e:
        yield f"[系统错误] 无法启动进程: {str(e)}"

# Restore the original Local file tools
async def list_files_tool_local(path: str = ".", show_all: bool = True) -> str:
    """[Local] List files: directories first, supports count truncation, filters hidden files"""
    try:
        cwd = await _get_current_cwd()
        target = resolve_strict_path(cwd, path, check_symlink=True)
        
        if not target.is_dir():
            return f"[Error] Not a directory: {path}"

        # Use scandir for more detailed info and better speed
        entries = []
        try:
            with os.scandir(target) as it:
                for entry in it:
                    if not show_all and entry.name.startswith('.'):
                        continue
                    
                    is_dir = entry.is_dir()
                    # Format: (is_dir, sort_name, display_string)
                    # Directories first (0), files after (1)
                    display_name = f"{entry.name}/" if is_dir else entry.name
                    entries.append((0 if is_dir else 1, entry.name.lower(), display_name))
        except PermissionError:
            return f"[Error] Permission denied accessing: {path}"

        # Sort: first by dir/file, then alphabetically by name
        entries.sort()

        # Truncate count to prevent token blow-up
        MAX_ITEMS = 200
        result_lines = [e[2] for e in entries[:MAX_ITEMS]]
        
        summary = f"Total: {len(entries)} items"
        if len(entries) > MAX_ITEMS:
            summary += f" (Showing first {MAX_ITEMS})"
            result_lines.append(f"... {len(entries) - MAX_ITEMS} more items")
        
        return f"{summary} in {path}:\n" + "\n".join(result_lines) if result_lines else "Empty directory."

    except Exception as e:
        return f"[Error] List failed: {str(e)}"

def _format_line(line_number: int, content: str, max_line_chars: int = 1000) -> str:
    """[Local-only] Format a single line. Delegates directly to the global core engine, so read and read_range automatically get anchors"""
    return format_line_with_hash(line_number, content, max_line_chars)

async def read_file_tool_local(path: str, start_line: int = None, end_line: int = None) -> str:
    if start_line is not None or end_line is not None:
        return await read_file_range_tool_local(path, start_line or 1, end_line or 1)
    try:
        MAX_LINES = 1000
        MAX_LINE_CHARS = 1000
        MAX_TOTAL_CHARS = 50000
        
        cwd = await _get_current_cwd()
        target = resolve_strict_path(cwd, path, check_symlink=True)
        if not target.exists() or not target.is_file():
            return f"[Error] File not found: {path}"

        # Binary check unchanged...
        with open(target, 'rb') as f_bin:
            if b'\0' in f_bin.read(1024):
                return f"[Error] Cannot read binary file: {path}"

        output = []
        current_total_len = 0
        truncated = False
        
        async with aiofiles.open(target, 'r', encoding='utf-8', errors='replace') as f:
            line_idx = 1
            async for line in f:
                formatted = _format_line(line_idx, line, MAX_LINE_CHARS)
                output.append(formatted)
                current_total_len += len(formatted)
                
                if line_idx >= MAX_LINES or current_total_len > MAX_TOTAL_CHARS:
                    truncated = True
                    break
                line_idx += 1

        res = "\n".join(output)
        if truncated:
            res += f"\n\n... [Warning] Content truncated (Safety Limit). Last line read: {line_idx}."
            res += f"\n💡 [Hint] The file is large or has very long lines. Use 'read_file_range_local' to explore specific sections."
        
        # Redaction handling
        return _maybe_mask_output(path, res)
    except Exception as e: 
        return f"[Error] Read failed: {str(e)}"  

async def read_file_range_tool_local(path: str, start_line: int, end_line: int) -> str:
    """[Local] Read an exact line range of a file, with overflow protection"""
    try:
        MAX_TOTAL_CHARS = 30000  # Max chars returned at once, to prevent context blow-up
        MAX_LINE_CHARS = 1000    # Max display length per line
        
        if start_line < 1 or end_line < start_line:
            return "[Error] Invalid line range."
            
        cwd = await _get_current_cwd()
        target = resolve_strict_path(cwd, path, check_symlink=True)
        if not target.exists() or not target.is_file(): 
            return f"[Error] File not found: {path}"

        output = []
        current_total_len = 0
        
        async with aiofiles.open(target, 'r', encoding='utf-8', errors='replace') as f:
            line_idx = 1
            async for line in f:
                if line_idx >= start_line:
                    formatted = _format_line(line_idx, line, MAX_LINE_CHARS)
                    output.append(formatted)
                    current_total_len += len(formatted)
                    
                    if current_total_len > MAX_TOTAL_CHARS:
                        output.append(f"--- [Warning] Output stopped: Reached limit of {MAX_TOTAL_CHARS} chars ---")
                        break
                
                if line_idx >= end_line:
                    break
                line_idx += 1
            
        if not output and line_idx < start_line:
            return f"[Error] start_line ({start_line}) is beyond file length ({line_idx})."
        
        res = "\n".join(output)
        # Redaction handling
        return _maybe_mask_output(path, res)
    except Exception as e: 
        return f"[Error] Range read failed: {str(e)}"

async def tail_file_tool_local(path: str, lines: int = 100) -> str:
    """[Local] Read the tail of a file (with Hashline injected)"""
    try:
        cwd = await _get_current_cwd()
        target = resolve_strict_path(cwd, path, check_symlink=True)
        if not target.exists() or not target.is_file(): return f"[Error] File not found: {path}"

        async with aiofiles.open(target, 'r', encoding='utf-8', errors='replace') as f:
            all_lines = await f.readlines()
            
        subset = all_lines[-lines:] if lines < len(all_lines) else all_lines
        start_idx = max(1, len(all_lines) - lines + 1)
        
        # Hook into Hashline formatting
        res = "\n".join(format_line_with_hash(i + start_idx, line) for i, line in enumerate(subset))
        return _maybe_mask_output(path, res)
    except Exception as e: return f"[Error] Tail failed: {str(e)}"
    
async def edit_file_tool_local(path: str, content: str) -> str:
    """[Local] Write a file: fixes the absolute-path misjudgment issue"""
    try:
        cwd = await _get_current_cwd()
        # This step already ensures path can't escape cwd
        target = resolve_strict_path(cwd, path, check_symlink=True)
        
        # 1. Ensure the parent directory exists
        parent_dir = target.parent
        # --- Removed the resolve_strict_path(cwd, str(parent_dir)...) call that caused errors ---
        
        await aiofiles.os.makedirs(parent_dir, exist_ok=True)

        # 2. Create a backup (if the file exists)
        backup_msg = ""
        if target.exists():
            try:
                backup_path = target.with_suffix(target.suffix + ".bak")
                shutil.copy2(target, backup_path)
                backup_msg = f" (Backup created: {backup_path.name})"
            except Exception as e:
                print(f"[Warn] Backup failed: {e}")

        # 3. Atomic write
        temp_path = target.with_suffix(target.suffix + f".tmp.{uuid.uuid4().hex[:6]}")
        try:
            async with aiofiles.open(temp_path, 'w', encoding='utf-8') as f:
                await f.write(content)
            
            if os.path.exists(target):
                os.replace(temp_path, target)
            else:
                os.rename(temp_path, target)
        except Exception as e:
            if os.path.exists(temp_path):
                os.remove(temp_path)
            raise e

        return f"Saved successfully{backup_msg}."

    except Exception as e:
        return f"[Error] Edit failed: {str(e)}"

async def search_files_tool_local(pattern: str, path: str = ".") -> str:
    """[Local] Smart search (appends Hashline, supports search-then-edit)"""
    try:
        cwd = await _get_current_cwd()
        target_dir = resolve_strict_path(cwd, path, check_symlink=True)
        target_str = str(target_dir)
        
        # 1. Drop git grep since its output is awkward for injecting hashes; use a unified optimized Python implementation
        matches = []
        regex = re.compile(pattern)
        MAX_RESULTS = 1000
        
        SKIP_DIRS = {'.git', 'node_modules', '__pycache__', 'venv', '.env', 'dist', 'build', 'coverage'}
        SKIP_EXTS = {'.pyc', '.pyo', '.so', '.dll', '.exe', '.bin', '.png', '.jpg', '.jpeg', '.gif', '.zip', '.tar', '.gz'}

        def is_binary(file_path):
            try:
                with open(file_path, 'rb') as f:
                    return b'\0' in f.read(1024)
            except: return True

        for root, dirs, files in os.walk(target_str, topdown=True):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith('.')]
            
            for file in files:
                if any(file.endswith(ext) for ext in SKIP_EXTS): continue
                full_path = os.path.join(root, file)
                display_path = os.path.relpath(full_path, cwd)
                
                if is_binary(full_path): continue

                try:
                    async with aiofiles.open(full_path, 'r', encoding='utf-8', errors='replace') as f:
                        content = await f.read()
                        lines = content.splitlines()
                        for i, line in enumerate(lines, 1):
                            if regex.search(line):
                                clean_line = line.strip()[:200]
                                # Core: get this line's individual hash!
                                line_hash = get_line_hash(line)
                                if _is_env_file(file):
                                    clean_line = _mask_env_content(clean_line)
                                matches.append(f"{display_path}:{i}#{line_hash}:{clean_line}")
                                if len(matches) >= MAX_RESULTS:
                                    return "\n".join(matches) + f"\n... (Truncated at {MAX_RESULTS} matches)"
                except Exception:
                    continue

        return "\n".join(matches) if matches else "No matches found."
    except Exception as e:
        return f"[Error] Search failed: {str(e)}"


async def glob_files_tool_local(pattern: str, exclude: str = "") -> str:
    """[Local] Smart find: uses pathlib.glob for ** recursion, Windows-compatible"""
    try:
        cwd = await _get_current_cwd()
        base = Path(cwd).resolve()

        excludes = [e.strip() for e in exclude.split(",") if e.strip()]
        DEFAULT_EXCLUDES = {'.git', 'node_modules', '__pycache__', 'venv', 'dist', 'build'}

        # Use pathlib's glob, which natively supports ** recursion and is separator-agnostic
        matched_paths = list(base.glob(pattern))

        results = []
        for p in matched_paths:
            if not p.is_file():
                continue

            # Compute the relative path for later matching and output
            try:
                rel = p.relative_to(base)
            except ValueError:
                # If the path is not inside base (shouldn't happen in theory), skip it
                continue

            rel_str = rel.as_posix()  # Use forward slashes for cross-platform consistency

            # Exclude entries matching the patterns in the exclude argument
            if any(fnmatch.fnmatch(rel_str, ex) for ex in excludes):
                continue

            # Exclude default hidden/build directories (check every level of the path)
            parts = rel.parts
            if any(part in DEFAULT_EXCLUDES or part.startswith('.') for part in parts):
                continue

            results.append(rel_str)

        output = sorted(results)
        limit = 200
        if not output:
            return "No files matched."
        if len(output) > limit:
            return "\n".join(output[:limit]) + f"\n... ({len(output)-limit} more files)"
        return "\n".join(output)

    except Exception as e:
        return f"[Error] Glob failed: {str(e)}"

async def edit_file_patch_tool_local(path: str, edits: list) -> str:
    """[Local] Exact replace (rewritten with Hashline, deprecating old_string)"""
    try:
        cwd = await _get_current_cwd()
        target = resolve_strict_path(cwd, path, check_symlink=True)
        if not target.exists():
            return f"[Error] File not found: {path}"

        async with aiofiles.open(target, 'r', encoding='utf-8') as f:
            content = await f.read()

        success, new_content, msg = apply_hashline_edits(content, edits)
        if not success:
            return msg # Hash interception takes effect

        try:
            backup_path = target.with_suffix(target.suffix + ".bak")
            shutil.copy2(target, backup_path)
        except: pass

        async with aiofiles.open(target, 'w', encoding='utf-8') as f:
            await f.write(new_content)
            
        return f"[Success] Patched '{path}' using Hashline. ({msg})"
    except Exception as e:
        return f"[Error] Patch failed: {str(e)}"

async def todo_write_tool_local(action: str, id: str = None, content: str = None, 
                                priority: str = "medium", status: str = None) -> str:
    """Local to-do task management tool - uses 3-digit sequential IDs"""
    try:
        cwd = await _get_current_cwd()
        party_dir = Path(cwd) / ".agent"
        if not party_dir.exists():
            await aiofiles.os.makedirs(party_dir, exist_ok=True)
        
        todo_file = party_dir / "ai_todos.json"
        
        # Read existing tasks
        todos = []
        if todo_file.exists():
            try:
                async with aiofiles.open(todo_file, 'r', encoding='utf-8') as f:
                    file_content = await f.read()
                    if file_content.strip():
                        todos = json.loads(file_content)
            except (json.JSONDecodeError, Exception):
                todos = []
            
        msg = ""

        # Helper to generate the next sequential ID
        def _generate_ordered_id(existing_todos):
            if not existing_todos:
                return "1"
            # Find the largest numeric ID (compatible with legacy data)
            numeric_ids = [int(t['id']) for t in existing_todos if t['id'].isdigit()]
            if not numeric_ids:
                return "1"
            return str(max(numeric_ids) + 1)  # 1, 2, 3... no zero-padding, no digit limit

        if action == "create":
            """Create a new task - auto-generates a 3-digit sequential ID"""
            if not content: 
                return "[Error] Creating a task requires the content parameter"
            
            new_id = _generate_ordered_id(todos)
            new_todo = {
                "id": new_id,
                "content": content,
                "priority": priority,
                "status": "pending",
                "created_at": datetime.now().isoformat(),
                "completed_at": None
            }
            todos.append(new_todo)
            msg = f"[Success] 已创建任务 #{new_id}: {content[:30]}"
            
        elif action == "list":
            """List all tasks - sorted by numeric ID"""
            if not todos: 
                return "This project has no tasks at the moment"
            
            lines = ["📋 **Project task list** (larger ID = created later):"]
            # Sort by numeric ID to keep the display ordered
            sorted_todos = sorted(todos, key=lambda x: int(x['id']) if x['id'].isdigit() else 0)
            
            for t in sorted_todos:
                status_icon = "✅" if t.get('status') == 'done' else "⏳"
                priority_map = {"high": "🔴", "medium": "🟡", "low": "🟢"}
                p_icon = priority_map.get(t.get('priority', 'medium'), "⚪")
                lines.append(f"{status_icon} [{t['id']}] {p_icon} {t['content'][:40]}")
            return "\n".join(lines)

        elif action == "complete":
            """[High-frequency] Mark a task as completed - idempotent operation"""
            if not id: 
                return "[Error] Completing a task requires an id (e.g.: 001)"
            
            target = next((t for t in todos if t['id'] == id), None)
            if not target: 
                return f"[Error] 未找到任务 #{id}"
            
            if target.get('status') == 'done':
                msg = f"[Info] 任务 #{id} 已经是完成状态"
            else:
                target['status'] = 'done'
                target['completed_at'] = datetime.now().isoformat()
                msg = f"[Success] 已完成任务 #{id}"

        elif action == "toggle":
            """Toggle completion status - pending<->done"""
            if not id: 
                return "[Error] Toggling status requires an id"
            
            target = next((t for t in todos if t['id'] == id), None)
            if not target: 
                return f"[Error] 未找到任务 #{id}"
            
            if target.get('status') != 'done':
                target['status'] = 'done'
                target['completed_at'] = datetime.now().isoformat()
                msg = f"[Success] 已完成任务 #{id}"
            else:
                target['status'] = 'pending'
                target['completed_at'] = None
                msg = f"[Success] 已重新打开任务 #{id}"

        elif action == "update":
            """Edit task details"""
            if not id: 
                return "[Error] Updating a task requires an id"
            
            target = next((t for t in todos if t['id'] == id), None)
            if not target: 
                return f"[Error] 未找到任务 #{id}"
            
            if content: 
                target['content'] = content
            if priority: 
                target['priority'] = priority
            
            if status:
                if status == "done" and target.get('status') != "done":
                    target['completed_at'] = datetime.now().isoformat()
                elif status != "done" and target.get('status') == "done":
                    target['completed_at'] = None
                target['status'] = status
            
            target['updated_at'] = datetime.now().isoformat()
            msg = f"[Success] 已更新任务 #{id}"

        elif action == "delete":
            """Delete a task"""
            if not id: 
                return "[Error] Deleting a task requires an id"
            
            target = next((t for t in todos if t['id'] == id), None)
            if not target: 
                return f"[Error] 未找到任务 #{id}"
            
            todos.remove(target)
            msg = f"[Success] 已Delete a task #{id}"

        else:
            return f"[Error] 未知操作: {action}"

        # Save to a local file
        async with aiofiles.open(todo_file, 'w', encoding='utf-8') as f:
            await f.write(json.dumps(todos, indent=2, ensure_ascii=False))
            
        return msg

    except Exception as e:
        return f"[Error] 操作失败: {str(e)}"
    
# ==================== [New] Skill-specific read tool ====================

async def read_skill_tool_logic(cwd: str, skill_id: str, is_docker: bool = True) -> str:
    """
    Internal shared logic: read a Skill's folder structure and documentation.
    If the skill doesn't exist in the workspace and the global skills dir is available, it's auto-copied to the workspace (supported on both Docker/Local).
    """
    skill_rel_path = f".agent/skills/{skill_id}"
    workspace_skill_path = f"/workspace/.agent/skills/{skill_id}" if is_docker else str(Path(cwd) / ".agent" / "skills" / skill_id)

    # ----- Copy logic: when missing from the workspace, copy from global -----
    if is_docker:
        # Docker environment: use the already-mapped global skills directory
        container_name = await get_or_create_docker_sandbox(cwd)          # Get/create the container
        global_skill_path = f"/home/agent/.agents/skills/{skill_id}"      # Global skills path inside the container
        try:
            # 1. Check whether the workspace skill exists
            test_cmd = ["test", "-d", workspace_skill_path]
            await _exec_docker_cmd_simple(cwd, test_cmd)                  # Raises an exception if it doesn't exist
        except Exception:
            # 2. Not in the workspace; try copying from global
            try:
                # Check whether the global skill exists
                test_global = ["test", "-d", global_skill_path]
                await _exec_docker_cmd_simple(cwd, test_global)

                # Ensure the target parent directory exists
                mkdir_cmd = ["mkdir", "-p", f"/workspace/.agent/skills"]
                await _exec_docker_cmd_simple(cwd, mkdir_cmd)

                # Perform the copy
                cp_cmd = ["cp", "-r", global_skill_path, f"/workspace/.agent/skills/"]
                await _exec_docker_cmd_simple(cwd, cp_cmd)

                print(f"[Skill AutoCopy][Docker] Copied global skill '{skill_id}' to workspace.")
            except Exception as e:
                # Copy failed or global skill missing; keep trying to read the workspace (errors later if absent)
                pass
    else:
        # Local environment: copy with shutil (implemented, but consolidated into the unified logic)
        workspace_path = Path(cwd) / ".agent" / "skills" / skill_id
        if not workspace_path.exists():
            global_path = Path(SKILLS_DIR) / skill_id
            if global_path.exists() and global_path.is_dir():
                try:
                    workspace_path.parent.mkdir(parents=True, exist_ok=True)
                    await asyncio.to_thread(
                        shutil.copytree,
                        global_path,
                        workspace_path,
                        dirs_exist_ok=True
                    )
                    print(f"[Skill AutoCopy][Local] Copied global skill '{skill_id}' to workspace.")
                except Exception as e:
                    print(f"[Skill AutoCopy][Local] Copy failed: {e}. Will fallback to global read.")
                    # Fallback reading is handled by the main flow

    # ----- Original read logic unchanged (reads the workspace skill) -----
    tree_str = ""
    doc_content = ""

    if is_docker:
        try:
            tree_str = await _exec_docker_cmd_simple(cwd, ["find", skill_rel_path, "-maxdepth", "2", "-not", "-path", '*/.*'])
            for name in ["SKILL.md", "skill.md", "SKILLS.md", "skills.md"]:
                try:
                    doc_path = f"{skill_rel_path}/{name}"
                    doc_content = await _exec_docker_cmd_simple(cwd, ["cat", doc_path])
                    break
                except:
                    continue
        except Exception as e:
            return f"[Error] Skill '{skill_id}' not found or inaccessible in Docker: {str(e)}"
    else:
        try:
            base_path = Path(cwd) / ".agent" / "skills" / skill_id
            if not base_path.exists():
                return f"[Error] Skill '{skill_id}' folder does not exist in workspace and auto-copy failed or global skill unavailable."

            # Generate a local file tree (depth <= 2)
            tree_lines = [f"{skill_id}/"]
            for p in base_path.rglob("*"):
                if p.name.startswith("."): continue
                depth = len(p.relative_to(base_path).parts)
                if depth > 2: continue
                indent = "  " * depth
                tree_lines.append(f"{indent}{p.name}{'/' if p.is_dir() else ''}")
            tree_str = "\n".join(tree_lines)

            # Read the local documentation file
            for name in ["SKILL.md", "skill.md", "SKILLS.md", "skills.md"]:
                doc_path = base_path / name
                if doc_path.exists():
                    async with aiofiles.open(doc_path, 'r', encoding='utf-8', errors='replace') as f:
                        doc_content = await f.read()
                    break
        except Exception as e:
            return f"[Error] Skill '{skill_id}' read failed: {str(e)}"

    if not doc_content and not tree_str:
        return f"[Error] Could not find skill details for '{skill_id}'."

    res = f"--- Skill Details: {skill_id} ---\n"
    res += f"\n📂 **Folder Structure:**\n```\n{tree_str}\n```\n"
    res += f"\n📖 **Documentation ({skill_rel_path}):**\n\n{doc_content or '(No SKILL.md found)'}"
    return res

async def read_skill_tool(skill_id: str) -> str:
    """[Docker] Read the full documentation and file tree of a specific skill"""
    cwd = await _get_current_cwd()
    return await read_skill_tool_logic(cwd, skill_id, is_docker=True)

async def read_skill_tool_local(skill_id: str) -> str:
    """[Local] Read the full documentation and file tree of a specific skill"""
    cwd = await _get_current_cwd()
    return await read_skill_tool_logic(cwd, skill_id, is_docker=False)

COMMON_BASH_DESC = (
    "Execute commands. Guidance: \n"
    "1. For long-running tasks (servers, watchers, large downloads), set 'background': true.\n"
    "2. For medium tasks, adjust 'timeout' (1-3600s, default 600s).\n"
    "3. If 'background' is true, wait a few seconds for initialization before checking logs/status; do not poll rapidly."
)

# ==================== Tool registry (complete) ====================

TOOLS_REGISTRY = {
    # --- Read-only ---
    "list_files": {
        "type": "function", "function": {
            "name": "list_files_tool", 
            "description": "List files in docker workspace.",
            "parameters": {
                "type": "object", 
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative path to list files in (from workspace root)."
                    }, 
                    "show_all": {"type": "boolean", "default": True}
                }, 
                "required": ["path"]
            }
        }
    },
    "read_file": {
        "type": "function", "function": {
            "name": "read_file_tool", 
            "description": "Read file content.",
            "parameters": {
                "type": "object", 
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative path to file (from workspace root)."
                    }
                }, 
                "required": ["path"]
            }
        }
    },
    "read_file_range": {
        "type": "function", "function": {
            "name": "read_file_range_tool", 
            "description": "Read a specific range of lines from a file. Useful for large files after grepping.",
            "parameters": {
                "type": "object", 
                "properties": {
                    "path": {"type": "string", "description": "Relative path to file"},
                    "start_line": {"type": "integer"},
                    "end_line": {"type": "integer"}
                }, 
                "required": ["path", "start_line", "end_line"]
            }
        }
    },
    "tail_file": {
        "type": "function", "function": {
            "name": "tail_file_tool", 
            "description": "Read the last N lines of a file. Useful for reading logs.",
            "parameters": {
                "type": "object", 
                "properties": {
                    "path": {"type": "string", "description": "Relative path to file"},
                    "lines": {"type": "integer", "default": 100, "description": "Number of lines to read from the end"}
                }, 
                "required": ["path"]
            }
        }
    },
    "search_files": {
        "type": "function", "function": {
            "name": "search_files_tool", 
            "description": "Grep search.",
            "parameters": {
                "type": "object", 
                "properties": {
                    "pattern": {"type": "string"}, 
                    "path": {
                        "type": "string",
                        "description": "Relative path to directory to search in (from workspace root)."
                    }
                }, 
                "required": ["pattern"]
            }
        }
    },
    "glob_files": {
        "type": "function", "function": {
            "name": "glob_files_tool", 
            "description": "Recursive glob.",
            "parameters": {
                "type": "object", 
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Glob pattern (relative to workspace root)."
                    }, 
                    "exclude": {"type": "string"}
                }, 
                "required": ["pattern"]
            }
        }
    },
    "read_skill": {
        "type": "function", "function": {
            "name": "read_skill_tool", 
            "description": "Read full documentation and file tree for a project-specific skill from .agent/skills/.",
            "parameters": {
                "type": "object", 
                "properties": {
                    "skill_id": {"type": "string"}
                }, 
                "required": ["skill_id"]
            }
        }
    },
    # --- Edit ---
    "edit_file": {
        "type": "function", "function": {
            "name": "edit_file_tool", 
            "description": "Overwrite file.",
            "parameters": {
                "type": "object", 
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative path to file (from workspace root)."
                    }, 
                    "content": {"type": "string"}
                }, 
                "required": ["path", "content"]
            }
        }
    },
    "edit_file_patch": {
        "type": "function", "function": {
            "name": "edit_file_patch_tool", 
            "description": "Precise replacement using Hash-Anchored Edits (Hashline). Highly recommended for modifying existing files safely.",
            "parameters": {
                "type": "object", 
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative path to file (from workspace root)."
                    }, 
                    "edits": {
                        "type": "array",
                        "description": "List of edits to apply.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "start_anchor": {
                                    "type": "string", 
                                    "description": "The exact anchor from read tools, e.g., '12#XJ'. It MUST include both the line number and the 2-char hash. Don't worry if line numbers have slightly shifted due to other edits; the system has auto-healing to find the correct hash nearby."
                                },
                                "end_anchor": {
                                    "type": "string",
                                    "description": "Optional. e.g., '15#MB'. The line to end replacing. If omitted, only start_anchor is replaced."
                                },
                                "new_content": {
                                    "type": "string",
                                    "description": "The exact new content to replace the anchored block. To INSERT before a line, replace the line with itself prefixed by the new content."
                                }
                            },
                            "required": ["start_anchor", "new_content"]
                        }
                    }
                }, 
                "required": ["path", "edits"]
            }
        }
    },
    # --- Tasks ---
    "todo_write": {
        "type": "function",
        "function": {
            "name": "todo_write_tool",
            "description": "[Docker] To-do task management tool. Manages the task list inside the Docker sandbox environment, supporting create, list, complete, edit, delete, and more. All tasks are persisted in the container's /workspace/.agent/ai_todos.json file.",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["create", "list", "complete", "toggle", "update", "delete"],
                        "description": "Operation type: create, list (view all), complete (mark done - idempotent/safe), toggle (flip status - reverses it), update (edit details), delete"
                    },
                    "id": {
                        "type": "string",
                        "description": "The task's unique identifier. Optional for create (auto-generated), required for other operations (complete/toggle/update/delete)"
                    },
                    "content": {
                        "type": "string",
                        "description": "The task content description. Required for create, optional for update"
                    },
                    "priority": {
                        "type": "string",
                        "enum": ["high", "medium", "low"],
                        "description": "Priority: high, medium (default), low. Optional for create/update"
                    },
                    "status": {
                        "type": "string",
                        "enum": ["pending", "done"],
                        "description": "[update only] Force-set the task status: pending (incomplete), done (completed). Note: to mark as done, prefer the complete action over the status parameter"
                    }
                },
                "required": ["action"]
            }
        }
    },
    # --- Infrastructure ---
    "bash": {
        "type": "function", "function": {
            "name": "docker_sandbox", 
            "description": f"[Docker] {COMMON_BASH_DESC}",
            "parameters": {
                "type": "object", 
                "properties": {
                    "command": {"type": "string"}, 
                    "background": {"type": "boolean", "description": "Run non-blocking. Returns PID."},
                    "timeout": {
                        "type": "integer", 
                        "default": 60, 
                        "description": "Max execution time in seconds (1-3600). Default 60."
                    }
                }, 
                "required": ["command"]
            }
        }
    },
    "list_processes": {
        "type": "function",
        "function": {
            "name": "list_processes_tool",
            "description": "List all running background processes (both Docker containers and local processes).",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    },
    "get_process_logs": {
        "type": "function",
        "function": {
            "name": "get_process_logs_tool",
            "description": "Retrieve logs for a specific background process using its PID or Container ID.",
            "parameters": {
                "type": "object",
                "properties": {
                    "pid": {
                        "type": "string",
                        "description": "The process ID or container ID to fetch logs for."
                    }
                },
                "required": ["pid"]
            }
        }
    },
    "kill_process": {
        "type": "function",
        "function": {
            "name": "kill_process_tool",
            "description": "Terminate a background process or stop a Docker container using its PID or ID.",
            "parameters": {
                "type": "object",
                "properties": {
                    "pid": {
                        "type": "string",
                        "description": "The process ID or container ID to terminate."
                    }
                },
                "required": ["pid"]
            }
        }
    },
    "manage_ports": {
        "type": "function", "function": {
            "name": "docker_manage_ports_tool", 
            "description": "Forward Docker ports to localhost.",
            "parameters": {
                "type": "object", 
                "properties": {
                    "action": {"type": "string", "enum": ["forward", "stop", "list"]},
                    "container_port": {"type": "integer"},
                    "host_port": {"type": "integer"}
                }, 
                "required": ["action"]
            }
        }
    }
}

LOCAL_TOOLS_REGISTRY = {
    # --- Read-only ---
    "list_files_local": {
        "type": "function", "function": {
            "name": "list_files_tool_local", 
            "description": "List local files.",
            "parameters": {
                "type": "object", 
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative path to list files in (from current working directory)."
                    }, 
                    "show_all": {"type": "boolean","default": True}
                }, 
                "required": ["path"]
            }
        }
    },
    "read_file_local": {
        "type": "function", "function": {
            "name": "read_file_tool_local", 
            "description": "Read local file.",
            "parameters": {
                "type": "object", 
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative path to file (from current working directory)."
                    }
                }, 
                "required": ["path"]
            }
        }
    },
    "read_file_range_local": {
        "type": "function", "function": {
            "name": "read_file_range_tool_local", 
            "description": "Read a specific range of lines from a local file. Useful for large files after grepping.",
            "parameters": {
                "type": "object", 
                "properties": {
                    "path": {"type": "string", "description": "Relative path to file"},
                    "start_line": {"type": "integer", "description": "The line number to start reading from."},
                    "end_line": {"type": "integer", "description": "The line number to stop reading at."}
                }, 
                "required": ["path", "start_line", "end_line"]
            }
        }
    },
    "tail_file_local": {
        "type": "function", "function": {
            "name": "tail_file_tool_local", 
            "description": "Read the last N lines of a local file. Useful for reading logs.",
            "parameters": {
                "type": "object", 
                "properties": {
                    "path": {"type": "string", "description": "Relative path to file"},
                    "lines": {"type": "integer", "default": 100}
                }, 
                "required": ["path"]
            }
        }
    },
    "search_files_local": {
         "type": "function", "function": {
            "name": "search_files_tool_local", 
            "description": "Search local files.",
            "parameters": {
                "type": "object", 
                "properties": {
                    "pattern": {"type": "string"},
                    "path": {"type": "string", "description": "Relative directory to search in (default .)"}
                },
                "required": ["pattern"]
            }
        }
    },
    "glob_files_local": {
         "type": "function", "function": {
            "name": "glob_files_tool_local", 
            "description": "Glob local files.",
            "parameters": {
                "type": "object", 
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Glob pattern (relative to current working directory)."
                    },
                    "exclude": {"type": "string", "description": "Comma-separated patterns to exclude"}
                }, 
                "required": ["pattern"]
            }
        }
    },
    "read_skill_local": {
        "type": "function", "function": {
            "name": "read_skill_tool_local", 
            "description": "Read full documentation and file tree for a project-specific skill from .agent/skills/ (Local).",
            "parameters": {
                "type": "object", 
                "properties": {
                    "skill_id": {"type": "string", "description": "The ID of the skill to read."}
                }, 
                "required": ["skill_id"]
            }
        }
    },
    # --- Edit ---
    "edit_file_local": {
        "type": "function", "function": {
            "name": "edit_file_tool_local", 
            "description": "Write local file.",
            "parameters": {
                "type": "object", 
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative path to file (from current working directory)."
                    }, 
                    "content": {"type": "string", "description": "Full file content"}
                }, 
                "required": ["path", "content"]
            }
        }
    },
    "edit_file_patch_local": {
        "type": "function", "function": {
            "name": "edit_file_patch_tool_local", 
            "description": "Patch local file using Hash-Anchored Edits (Hashline). Highly recommended for partial edits to prevent data loss.",
            "parameters": {
                "type": "object", 
                "properties": {
                    "path": {"type": "string"}, 
                    "edits": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "start_anchor": {
                                    "type": "string", 
                                    "description": "The exact anchor from read tools, e.g., '12#XJ'. It MUST include both the line number and the 2-char hash. Don't worry if line numbers have slightly shifted due to other edits; the system has auto-healing to find the correct hash nearby."
                                },
                                "end_anchor": {
                                    "type": "string",
                                    "description": "Optional. e.g., '15#MB'. The line to end replacing. If omitted, only start_anchor is replaced."
                                },
                                "new_content": {
                                    "type": "string",
                                    "description": "The exact new content to replace the anchored block. To INSERT before a line, replace the line with itself prefixed by the new content."
                                }
                            },
                            "required": ["start_anchor", "new_content"]
                        }
                    }
                }, 
                "required": ["path", "edits"]
            }
        }
    },
    "todo_write_local": {
        "type": "function",
        "function": {
            "name": "todo_write_tool_local",
            "description": "Local to-do task management tool. Manages the project's task list, including create, list, complete, edit, delete, and more. All tasks are persisted in the project root's .agent/ai_todos.json file.",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["create", "list", "complete", "toggle", "update", "delete"],
                        "description": "Operation type: create, list (view all), complete (mark done - idempotent), toggle (flip status - reverses it), update (edit details), delete"
                    },
                    "id": {
                        "type": "string",
                        "description": "The task's unique identifier. Optional for create (auto-generated), required for other operations (complete/toggle/update/delete)"
                    },
                    "content": {
                        "type": "string",
                        "description": "The task content description. Required for create, optional for update"
                    },
                    "priority": {
                        "type": "string",
                        "enum": ["high", "medium", "low"],
                        "description": "Priority: high, medium (default), low. Optional for create/update"
                    },
                    "status": {
                        "type": "string",
                        "enum": ["pending", "done"],
                        "description": "[update only] Force-set the task status: pending (incomplete), done (completed). Note: to mark as done, prefer the complete action over the status parameter"
                    }
                },
                "required": ["action"]
            }
        }
    },
    # --- Infrastructure ---
    "bash_local": {
        "type": "function", "function": {
            "name": "shell_tool_local", 
            "description": f"[Local] {COMMON_BASH_DESC}",
            "parameters": {
                "type": "object", 
                "properties": {
                    "command": {"type": "string"},
                    "background": {"type": "boolean", "description": "Run in background."},
                    "timeout": {
                        "type": "integer", 
                        "default": 60, 
                        "description": "Max execution time in seconds (1-3600). Default 60."
                    }
                }, 
                "required": ["command"]
            }
        }
    },
    "list_processes": {
        "type": "function",
        "function": {
            "name": "list_processes_tool",
            "description": "List all running background processes (both Docker containers and local processes).",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    },
    "get_process_logs": {
        "type": "function",
        "function": {
            "name": "get_process_logs_tool",
            "description": "Retrieve logs for a specific background process using its PID or Container ID.",
            "parameters": {
                "type": "object",
                "properties": {
                    "pid": {
                        "type": "string",
                        "description": "The process ID or container ID to fetch logs for."
                    }
                },
                "required": ["pid"]
            }
        }
    },
    "kill_process": {
        "type": "function",
        "function": {
            "name": "kill_process_tool",
            "description": "Terminate a background process or stop a Docker container using its PID or ID.",
            "parameters": {
                "type": "object",
                "properties": {
                    "pid": {
                        "type": "string",
                        "description": "The process ID or container ID to terminate."
                    }
                },
                "required": ["pid"]
            }
        }
    },
    "local_net_tool": {
        "type": "function", "function": {
            "name": "local_net_tool", 
            "description": "Check local ports.",
            "parameters": {
                "type": "object", 
                "properties": {
                    "action": {"type": "string", "enum": ["check", "scan"]},
                    "port": {"type": "integer"}
                }, 
                "required": ["action"]
            }
        }
    }
}

def get_tools_for_mode(mode: str) -> list:
    """Get the Docker-environment tool set"""
    # Basic read-only
    read = [TOOLS_REGISTRY["list_files"], 
            TOOLS_REGISTRY["read_file"], 
            TOOLS_REGISTRY["read_file_range"],
            TOOLS_REGISTRY["tail_file"],     
            TOOLS_REGISTRY["search_files"], 
            TOOLS_REGISTRY["glob_files"],
            TOOLS_REGISTRY["read_skill"]
            ]
    # Edit
    edit = [TOOLS_REGISTRY["edit_file"], TOOLS_REGISTRY["edit_file_patch"], TOOLS_REGISTRY["todo_write"]]
    # Infrastructure (execution/process/port)
    infra = [TOOLS_REGISTRY["bash"], TOOLS_REGISTRY["list_processes"], TOOLS_REGISTRY["get_process_logs"], TOOLS_REGISTRY["kill_process"], TOOLS_REGISTRY["manage_ports"]]
    
    if mode == "default": return read
    if mode == "auto-approve": return read + edit + [TOOLS_REGISTRY["list_processes"], TOOLS_REGISTRY["get_process_logs"], TOOLS_REGISTRY["kill_process"]]
    if mode == "yolo": return read + edit + infra
    return read

def get_local_tools_for_mode(mode: str) -> list:
    """Get the Local-environment tool set"""
    read = [
        LOCAL_TOOLS_REGISTRY["list_files_local"], 
        LOCAL_TOOLS_REGISTRY["read_file_local"], 
        LOCAL_TOOLS_REGISTRY["read_file_range_local"],
        LOCAL_TOOLS_REGISTRY["tail_file_local"],    
        LOCAL_TOOLS_REGISTRY["search_files_local"], 
        LOCAL_TOOLS_REGISTRY["glob_files_local"],
        LOCAL_TOOLS_REGISTRY["read_skill_local"] 
    ]
    edit = [LOCAL_TOOLS_REGISTRY["edit_file_local"], LOCAL_TOOLS_REGISTRY["edit_file_patch_local"], LOCAL_TOOLS_REGISTRY["todo_write_local"]]
    infra = [
        LOCAL_TOOLS_REGISTRY["bash_local"], 
        LOCAL_TOOLS_REGISTRY["list_processes"], LOCAL_TOOLS_REGISTRY["get_process_logs"], LOCAL_TOOLS_REGISTRY["kill_process"],
        LOCAL_TOOLS_REGISTRY["local_net_tool"]
    ]
    
    if mode == "default": return read
    if mode == "auto-approve": return read + edit + [LOCAL_TOOLS_REGISTRY["list_processes"], LOCAL_TOOLS_REGISTRY["get_process_logs"], LOCAL_TOOLS_REGISTRY["kill_process"], LOCAL_TOOLS_REGISTRY["local_net_tool"]]
    if mode == "yolo": return read + edit + infra
    return read