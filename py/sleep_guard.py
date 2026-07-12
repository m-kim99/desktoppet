"""
跨平台防休眠模块
支持 Windows、macOS、Linux
使用方法：
    from sleep_guard import SleepGuard
    guard = SleepGuard()
    guard.start()  # 启动防休眠
    # ... 你的主程序 ...
    guard.stop()   # 停止防休眠（可选）
"""

import threading
import platform
import subprocess
import time
import sys
import os
from typing import Optional


class _BaseGuard:
    """防休眠基类"""
    def start(self) -> bool:
        raise NotImplementedError
    
    def stop(self) -> None:
        raise NotImplementedError


class _WindowsGuard(_BaseGuard):
    """Windows 实现"""
    def __init__(self):
        self._running = False
        self._thread = None
        self._check_interval = 30  # Refresh once every 30 seconds
        
    def start(self) -> bool:
        try:
            import ctypes
            self._ctypes = ctypes
            self._running = True
            self._thread = threading.Thread(target=self._keep_awake, daemon=True)
            self._thread.start()
            return True
        except Exception as e:
            print(f"[SleepGuard] Windows failed to start sleep prevention: {e}")
            return False
    
    def _keep_awake(self):
        """后台线程：定期调用 API 防止休眠"""
        # Prevent system sleep + prevent the display from turning off
        ES_CONTINUOUS = 0x80000000
        ES_SYSTEM_REQUIRED = 0x00000001
        ES_DISPLAY_REQUIRED = 0x00000002
        flags = ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED
        
        while self._running:
            self._ctypes.windll.kernel32.SetThreadExecutionState(flags)
            time.sleep(self._check_interval)
    
    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=1)
        # Restore the default state (allow normal system sleep)
        if hasattr(self, '_ctypes'):
            ES_CONTINUOUS = 0x80000000
            self._ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS)


class _MacOSGuard(_BaseGuard):
    """macOS 实现 - 使用 caffeinate 子进程"""
    def __init__(self):
        self._process: Optional[subprocess.Popen] = None
        
    def start(self) -> bool:
        try:
            # -d: prevent display sleep, -i: prevent idle system sleep, -s: prevent sleep on AC power
            self._process = subprocess.Popen(
                ['caffeinate', '-dims'],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                stdin=subprocess.DEVNULL
            )
            # Check whether the process started successfully
            if self._process.poll() is None:
                return True
            return False
        except Exception as e:
            print(f"[SleepGuard] macOS failed to start sleep prevention: {e}")
            return False
    
    def stop(self):
        if self._process and self._process.poll() is None:
            self._process.terminate()
            try:
                self._process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self._process.kill()


class _LinuxGuard(_BaseGuard):
    """Linux 实现 - 尝试多种方式"""
    def __init__(self):
        self._process: Optional[subprocess.Popen] = None
        self._method = None
        
    def start(self) -> bool:
        # Method 1: systemd-inhibit (the most standard)
        try:
            self._process = subprocess.Popen(
                ['systemd-inhibit', '--what=idle', '--why=应用运行中', 
                 '--mode=block', 'sleep', 'infinity'],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                stdin=subprocess.DEVNULL
            )
            if self._process.poll() is None:
                self._method = 'systemd'
                return True
        except (FileNotFoundError, Exception):
            pass
        
        # Method 2: simulate activity with xdotool (requires xdotool installed)
        try:
            # First check whether xdotool is available
            subprocess.run(['xdotool', '--version'], 
                          stdout=subprocess.DEVNULL, 
                          stderr=subprocess.DEVNULL, 
                          check=True)
            self._method = 'xdotool'
            self._running = True
            self._thread = threading.Thread(target=self._simulate_activity, daemon=True)
            self._thread.start()
            return True
        except (FileNotFoundError, subprocess.CalledProcessError, Exception):
            pass
        
        print("[SleepGuard] Linux failed to start sleep prevention: not found systemd-inhibit or xdotool")
        return False
    
    def _simulate_activity(self):
        """通过模拟按键防止休眠"""
        while self._running:
            subprocess.run(['xdotool', 'key', 'Shift_L'], 
                          stdout=subprocess.DEVNULL, 
                          stderr=subprocess.DEVNULL)
            time.sleep(30)
    
    def stop(self):
        if self._method == 'systemd' and self._process:
            self._process.terminate()
            try:
                self._process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self._process.kill()
        elif self._method == 'xdotool':
            self._running = False


class SleepGuard:
    """
    跨平台防休眠管理器
    
    使用示例:
        guard = SleepGuard()
        guard.start()  # 启动防休眠（非阻塞）
        # 你的主程序代码...
        guard.stop()   # 停止防休眠（可选，程序退出时会自动清理）
        
    也支持上下文管理器:
        with SleepGuard() as guard:
            # 自动启动，退出时自动停止
            run_your_app()
    """
    
    def __init__(self, verbose: bool = False):
        """
        初始化防休眠管理器
        
        Args:
            verbose: 是否打印详细日志
        """
        self.verbose = verbose
        self._guard: Optional[_BaseGuard] = None
        self._system = platform.system()
        
    def start(self) -> bool:
        """启动防休眠（非阻塞）"""
        if self._guard is not None:
            if self.verbose:
                print("[SleepGuard] sleep prevention already running")
            return True
        
        # Choose the implementation based on the OS
        if self._system == 'Windows':
            self._guard = _WindowsGuard()
        elif self._system == 'Darwin':  # macOS
            self._guard = _MacOSGuard()
        elif self._system == 'Linux':
            self._guard = _LinuxGuard()
        else:
            if self.verbose:
                print(f"[SleepGuard] unsupported system: {self._system}")
            return False
        
        success = self._guard.start()
        if success and self.verbose:
            print(f"[SleepGuard] sleep prevention started ({self._system})")
        elif not success and self.verbose:
            print(f"[SleepGuard] failed to start sleep prevention ({self._system})")
        
        return success
    
    def stop(self) -> None:
        """停止防休眠"""
        if self._guard is not None:
            self._guard.stop()
            if self.verbose:
                print(f"[SleepGuard] sleep prevention stopped")
            self._guard = None
    
    def is_running(self) -> bool:
        """检查防休眠是否正在运行"""
        if self._guard is None:
            return False
        if self._system == 'Windows':
            return hasattr(self._guard, '_running') and self._guard._running
        elif self._system == 'Darwin':
            return (self._guard._process is not None and 
                    self._guard._process.poll() is None)
        elif self._system == 'Linux':
            if hasattr(self._guard, '_method') and self._guard._method == 'systemd':
                return self._guard._process.poll() is None
            return hasattr(self._guard, '_running') and self._guard._running
        return False
    
    def __enter__(self):
        """上下文管理器入口"""
        self.start()
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """上下文管理器出口"""
        self.stop()


# ============= Usage example =============
if __name__ == '__main__':
    # Example 1: basic usage
    guard = SleepGuard(verbose=True)
    guard.start()
    
    print("Sleep prevention started; program will stay awake...")
    print("Press Ctrl+C exit")
    
    try:
        # Simulate the main program running
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nExiting...")
    finally:
        guard.stop()
    
    # Example 2: use the context manager (more concise)
    # with SleepGuard(verbose=True):
    #     print("Program running; the system won't sleep...")
    #     time.sleep(10)
    #     print("Sleep policy restored after exit")