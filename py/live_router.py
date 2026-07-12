"""
直播子路由：/api/live/*  +  /ws/live/danmu
功能与原来完全一致，prefix 写死在 router 里
"""
from __future__ import annotations
import asyncio
import uuid
from typing import Optional, List
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from py.ytdm import YouTubeDMClient
from py.twitch_service import start_twitch_task, stop_twitch_task
# ==========================  Key: hardcode the prefix once ==========================
router = APIRouter(prefix="/api/live", tags=["live"])
# ====================================================================

# Global variables holding the live client and related state
current_loop = None
yt_client: Optional[YouTubeDMClient] = None
twitch_task = None
# Pydantic models
class LiveConfig(BaseModel):
    youtube_enabled: bool = False
    youtube_video_id: str = ""
    youtube_api_key: str = ""
    twitch_enabled: bool = False
    twitch_channel: str = ""
    twitch_access_token: str = ""

class LiveConfigRequest(BaseModel):
    config: LiveConfig

class ApiResponse(BaseModel):
    success: bool
    message: str

# WebSocket manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, data: dict):
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_json(data)
            except:
                disconnected.append(connection)

        # Clean up disconnected connections
        for connection in disconnected:
            self.disconnect(connection)

manager = ConnectionManager()

# API routes
@router.post("/start", response_model=ApiResponse)
async def start_live(request: LiveConfigRequest):
    global yt_client, current_loop, twitch_task

    config = request.config

    # (1) The main thread caches the event loop first, for YouTube to use
    current_loop = asyncio.get_running_loop()
    print('[Live] main loop cached ->', current_loop)
    try:
        if config.youtube_enabled:
            if yt_client is not None:
                return ApiResponse(success=False, message="YouTube 监听已在运行")
            if not config.youtube_video_id or not config.youtube_api_key:
                return ApiResponse(success=False, message="请填写 YouTube videoId 与 API_KEY")

            def _yt_on_message(msg: dict):
                # current_loop is now guaranteed to be set
                asyncio.run_coroutine_threadsafe(manager.broadcast(msg), current_loop)

            yt_client = YouTubeDMClient(
                api_key=config.youtube_api_key,
                video_id=config.youtube_video_id,
                on_message=_yt_on_message
            )
            yt_client.start()

        if config.twitch_enabled:
            if twitch_task is not None:
                return ApiResponse(success=False, message="Twitch 监听已在运行")

            # Modify this callback to accept four parameters
            async def _twitch_on_msg(chan, user, msg, d_type="danmaku"):
                await manager.broadcast({
                    'id': str(uuid.uuid4()),
                    "type": "message",
                    "content": f"{user}: {msg}" if d_type == "danmaku" else msg,
                    "danmu_type": d_type,
                    "platform": "twitch"
                })

            # Start the Twitch task
            twitch_task = asyncio.create_task(
                start_twitch_task(config.dict(), _twitch_on_msg)
            )


        # Wait a moment to ensure the client starts
        await asyncio.sleep(0.5)

        return ApiResponse(success=True, message="直播监听启动成功")
    except Exception as e:
        return ApiResponse(success=False, message=f"启动失败: {str(e)}")

@router.post("/stop", response_model=ApiResponse)
async def stop_live():
    global current_loop, yt_client, twitch_task

    try:

        print("Stopping live-stream monitoring...")
        if yt_client is not None:
            yt_client.stop()
            yt_client = None

        if twitch_task:
            await stop_twitch_task()
            twitch_task.cancel()
            try:
                await twitch_task
            except asyncio.CancelledError:
                pass
            twitch_task = None

        # Clean up global variables
        current_loop = None

        print("Live-stream monitoring stopped")
        return ApiResponse(success=True, message="直播监听停止成功")

    except Exception as e:
        print(f"Error stopping live-stream monitoring: {e}")
        return ApiResponse(success=False, message=f"停止失败: {str(e)}")

@router.post("/reload", response_model=ApiResponse)
async def reload_live(request: LiveConfigRequest):
    try:
        # Stop first
        stop_result = await stop_live()
        if not stop_result.success:
            return stop_result

        # Wait a moment to ensure it has fully stopped
        await asyncio.sleep(2)

        # Then start
        return await start_live(request)
    except Exception as e:
        return ApiResponse(success=False, message=f"重载失败: {str(e)}")

@router.get("/status")
async def get_live_status():
    """获取当前直播监听服务的运行状态"""
    # If any platform's client is running, consider it running
    is_running = (yt_client is not None) or (twitch_task is not None)

    return {
        "is_running": is_running,
        "details": {
            "youtube": yt_client is not None,
            "twitch": twitch_task is not None
        }
    }

# —————— WebSocket routes ——————
# Note: to mount the WebSocket at /ws/live/danmu, just create another router
ws_router = APIRouter(prefix="/ws/live", tags=["live"])

# WebSocket route
@ws_router.websocket("/danmu")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Keep the connection alive, receiving heartbeat messages
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# Export both routers; the main file includes each separately
__all__ = ["router", "ws_router"]
