import os
import sys
from fastapi import APIRouter
from fastapi.responses import FileResponse

def get_base_path():
    if getattr(sys, 'frozen', False):
        return sys._MEIPASS
    else:
        return os.path.abspath(".")

base_path = get_base_path()

# Define the sub-router
router = APIRouter()

@router.get("/subtitle_overlay")
async def get_subtitle_overlay():
    # Join paths using base_path so it works after packaging too
    file_path = os.path.join(base_path, "static", "subtitle_overlay.html")
    
    # Check whether the file exists
    if not os.path.exists(file_path):
        # Could also return HTMLResponse("File not found", status_code=404)
        return {"error": "Subtitle overlay file not found"}, 404
        
    return FileResponse(file_path)