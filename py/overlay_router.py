import json
import os
import sys
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse

def get_base_path():
    if getattr(sys, 'frozen', False):
        return sys._MEIPASS
    else:
        return os.path.abspath(".")

base_path = get_base_path()

# Define the sub-router
router = APIRouter()

class DanmakuOverlayManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        # Iterate over a copy to avoid list-mutation errors when a connection drops during broadcast
        for connection in list(self.active_connections):
            try:
                await connection.send_text(json.dumps(message))
            except Exception:
                self.disconnect(connection)

# Instantiate the manager
overlay_manager = DanmakuOverlayManager()

@router.websocket("/ws/overlay")
async def websocket_overlay_endpoint(websocket: WebSocket):
    await overlay_manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text() # Keep the connection alive
    except WebSocketDisconnect:
        overlay_manager.disconnect(websocket)

@router.post("/api/overlay/danmaku")
async def show_danmaku_overlay(data: dict):
    await overlay_manager.broadcast({"action": "show", "data": data})
    return {"status": "ok"}

@router.post("/api/overlay/danmaku/clear")
async def clear_danmaku_overlay():
    await overlay_manager.broadcast({"action": "clear"})
    return {"status": "ok"}

@router.get("/subtitle_overlay")
async def get_subtitle_overlay():
    # Join paths using base_path so it works after packaging too
    file_path = os.path.join(base_path, "static", "subtitle_overlay.html")
    
    # Check whether the file exists
    if not os.path.exists(file_path):
        # Could also return HTMLResponse("File not found", status_code=404)
        return {"error": "Subtitle overlay file not found"}, 404
        
    return FileResponse(file_path)


@router.get("/danmaku_overlay")
async def get_danmaku_overlay():
    # Build the file's absolute path
    file_path = os.path.join(base_path, "static", "danmaku_overlay.html")
    
    # Check the file exists to prevent a 500 error
    if not os.path.exists(file_path):
        return {"error": "Overlay file not found"}, 404
        
    return FileResponse(file_path)