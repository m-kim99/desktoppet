import asyncio
import os
import json
import uuid
from pathlib import Path
import httpx
import aiofiles
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

# Assumes your app defines a default model-storage directory
# Note: this uses DEFAULT_ASR_DIR
from py.get_setting import DEFAULT_ASR_DIR 

router = APIRouter(prefix="/sherpa-model")

# --- Model config ---
MODEL_NAME = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue"
# List of key files the Sherpa runtime requires
REQUIRED_FILES = ["model.int8.onnx", "tokens.txt"] 

MODELS = {
    "huggingface": {
        "url": "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09/resolve/main/model.int8.onnx?download=true",
        "tokens_url": "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09/resolve/main/tokens.txt?download=true",
        "files_to_download": [
            {"filename": "model.int8.onnx", "url_key": "url", "progress_key": "model"},
            {"filename": "tokens.txt", "url_key": "tokens_url", "progress_key": "tokens"},
        ]
    }
}

# ---------- Helper functions ----------
def get_model_dir() -> Path:
    """获取 Sherpa 模型在本地的完整路径"""
    return Path(DEFAULT_ASR_DIR) / MODEL_NAME

def model_exists() -> bool:
    """检查所有必需的模型文件是否存在"""
    d = get_model_dir()
    # Check whether all REQUIRED_FILES exist in the directory
    return all((d / f).is_file() for f in REQUIRED_FILES)

async def download_file(url: str, dest: Path, progress_id: str):
    """
    异步下载单个文件并记录进度 (使用 DEFAULT_ASR_DIR)。
    所有文件写入操作都使用 aiofiles 保持异步。
    """
    tmp = dest.with_suffix(".downloading")
    progress_file_path = Path(DEFAULT_ASR_DIR) / f"{progress_id}.json"
    
    # Ensure the progress file exists at the start (async write)
    async with aiofiles.open(progress_file_path, mode='w') as p_file:
        await p_file.write(json.dumps({"done": 0, "total": 0}))

    try:
        async with httpx.AsyncClient(timeout=None, follow_redirects=True) as client:
            async with client.stream("GET", url) as resp:
                resp.raise_for_status() # Check the HTTP status code
                total = int(resp.headers.get("content-length", 0))
                done = 0
                async with aiofiles.open(tmp, "wb") as f:
                    async for chunk in resp.aiter_bytes(1024 * 64):
                        await f.write(chunk)
                        done += len(chunk)
                        # Update the progress file in real time (async write)
                        async with aiofiles.open(progress_file_path, mode='w') as p_file:
                            await p_file.write(
                                json.dumps({"done": done, "total": total, "filename": dest.name})
                            )
        
        # Rename the temp file to the target (use asyncio.to_thread for the synchronous Path.rename)
        await asyncio.to_thread(tmp.rename, dest)

        # After download completes, write the 'complete' status (async write)
        async with aiofiles.open(progress_file_path, mode='w') as p_file:
            await p_file.write(
                json.dumps({"done": done, "total": done, "filename": dest.name, "complete": True})
            )
    except Exception as e:
        # On download failure, record the error message (async write)
        async with aiofiles.open(progress_file_path, mode='w') as p_file:
            await p_file.write(
                json.dumps({"error": str(e), "filename": dest.name, "failed": True})
            )
    finally:
        # After the download task ends, keep the progress file (success or not) until it's removed
        pass 

# ---------- Endpoint definitions ----------

@router.get("/status")
def status():
    """检查 Sherpa 模型文件是否存在"""
    return {"exists": model_exists(), "model": MODEL_NAME, "required_files": REQUIRED_FILES}

@router.delete("/remove")
def remove():
    """移除本地的 Sherpa 模型目录"""
    import shutil
    d = get_model_dir()
    if d.exists():
        shutil.rmtree(d)
    # Clean up all related progress files (using the MODEL_NAME prefix)
    for f in Path(DEFAULT_ASR_DIR).glob(f"{MODEL_NAME}_*.json"):
        f.unlink(missing_ok=True)
    return {"ok": True}

@router.get("/download/{source}")
async def download(source: str):
    """从指定源异步下载 Sherpa 模型和分词器文件，并流式传输进度"""
    if source not in MODELS:
        allowed_sources = list(MODELS.keys())
        raise HTTPException(status_code=400, detail=f"Bad source: only {', '.join(allowed_sources)} is supported.")
    if model_exists():
        raise HTTPException(status_code=400, detail="Model already exists.")

    model_subdir = get_model_dir()
    model_subdir.mkdir(parents=True, exist_ok=True)
    
    # Use a single overall ID to track all download tasks
    master_progress_id = f"{MODEL_NAME}_{uuid.uuid4().hex}"
    
    # Create all download tasks
    tasks = []
    file_map = {} # Mapping used in the generator to look up each file's progress
    
    for item in MODELS[source]["files_to_download"]:
        filename = item["filename"]
        # Use item["url_key"] to get the corresponding URL from MODELS[source]
        url = MODELS[source][item["url_key"]]
        progress_key = item["progress_key"]
        
        # Each download task has a unique ID
        task_id = f"{master_progress_id}_{progress_key}" 
        dest_path = model_subdir / filename
        
        tasks.append(
            asyncio.create_task(
                download_file(url, dest_path, task_id)
            )
        )
        # Initialize file_map to track status
        file_map[progress_key] = {"id": task_id, "filename": filename, "done": 0, "total": 0, "complete": False, "failed": False}


    async def event_generator():
        # Watch the progress of all files
        num_files = len(file_map)
        completed_files = 0
        
        # Clean up download progress files (after the task completes)
        def cleanup_progress_files():
            for key in file_map:
                try:
                    file_id = file_map[key].get('id')
                    if file_id:
                        progress_file = Path(DEFAULT_ASR_DIR) / f"{file_id}.json"
                        progress_file.unlink(missing_ok=True)
                except Exception as e:
                    # Safely get the error message, avoiding errors inside the exception's __str__()
                    try:
                        error_msg = str(e)
                    except:
                        error_msg = f"Error type: {type(e).__name__}"
                    
                    filename = file_map[key].get('filename', 'unknown')
                    print(f"Cleanup error for {filename}: {error_msg}")

        try:
            while completed_files < num_files:
                await asyncio.sleep(0.5)
                current_progress = {"status": "downloading", "files": []}
                completed_files = 0
                is_failed = False
                
                # Iterate all files, reading each one's progress file
                for key in file_map:
                    file_info = file_map[key]
                    progress_file_path = Path(DEFAULT_ASR_DIR) / f"{file_info['id']}.json"
                    
                    try:
                        # Try reading the progress file asynchronously (fix: use asyncio.to_thread to avoid blocking the event loop)
                        file_content = await asyncio.to_thread(progress_file_path.read_text)
                        data = json.loads(file_content)
                        
                        file_info.update({
                            "done": data.get("done", 0),
                            "total": data.get("total", 0),
                            "complete": data.get("complete", False),
                            "failed": data.get("failed", False),
                            "error": data.get("error", None)
                        })
                        
                        if file_info["complete"]:
                            completed_files += 1
                        if file_info["failed"]:
                            is_failed = True
                        
                    except FileNotFoundError:
                        # The task may have just started and the progress file isn't created yet
                        pass
                    except json.JSONDecodeError:
                        # The progress file may be mid-write; ignore this read
                        pass
                    except Exception as e:
                        # Catch other possible thread-pool or filesystem errors
                        print(f"Unexpected file read error for {file_info['filename']}: {e}")
                        
                    current_progress["files"].append({
                        "filename": file_info["filename"],
                        "done": file_info["done"],
                        "total": file_info["total"],
                        "complete": file_info["complete"],
                        "failed": file_info["failed"],
                        "error": file_info["error"]
                    })
                
                # Transmit the current progress
                yield f"data: {json.dumps(current_progress)}\n\n"

                if is_failed:
                    current_progress["status"] = "failed"
                    yield f"data: {json.dumps(current_progress)}\n\n"
                    break # Exit the loop

                if completed_files == num_files:
                    current_progress["status"] = "complete"
                    yield f"data: {json.dumps(current_progress)}\n\n"
                    break # Exit the loop
                    
            # Final cleanup
            cleanup_progress_files()
            yield "data: close\n\n"

        except Exception as e:
            print(f"Streaming error: {e}")
            cleanup_progress_files()


    return StreamingResponse(event_generator(), media_type="text/event-stream")