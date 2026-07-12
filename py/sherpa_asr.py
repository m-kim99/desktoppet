# sherpa_asr.py
import os
import asyncio
from pathlib import Path
from io import BytesIO
from py.get_setting import DEFAULT_ASR_DIR
import platform

# ---------- Placeholders and global variables ----------
_recognizer = None
_last_model_name = None

# ---------- Lazy-load helper functions ----------
def _detect_device() -> str:
    """强制使用 CPU，避免 GPU 版本未安装的警告"""
    # Temporarily disable GPU until the GPU build is installed
    return 'cpu'

# Key fix: rename the function back to _get_recognizer and add default parameters
def _get_recognizer(model_name: str = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue"):
    """初始化/获取识别器（包含重型库的懒加载）"""
    global _recognizer, _last_model_name
    
    # If already loaded and the model hasn't changed, return directly
    if _recognizer is not None and model_name == _last_model_name:
        return _recognizer

    # --- Lazily import heavy dependencies ---
    try:
        import sherpa_onnx
    except ImportError as e:
        print("sherpa_onnx library not installed:",e)
        return None
    
    model_dir = Path(DEFAULT_ASR_DIR) / model_name
    model_path = model_dir / "model.int8.onnx"
    tokens_path = model_dir / "tokens.txt"

    # Check the file exists; if not, return None instead of raising (to avoid crashing the main program)
    if not model_path.is_file() or not tokens_path.is_file():
        # Use logging or print here, don't raise ValueError, or server.py's lifespan will crash
        print(f"Note: Sherpa model file not downloaded yet, ASR feature unavailable. Path: {model_dir}")
        return None

    device = _detect_device()
    print(f"Loading Sherpa-ONNX model [{model_name}] using device [{device}]...")

    try:
        recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=str(model_path),
            tokens=str(tokens_path),
            num_threads=4,
            provider=device,
            use_itn=True,
            debug=False,
        )
        _recognizer = recognizer
        _last_model_name = model_name
        return _recognizer
    except Exception as e:
        print(f"Error loading Sherpa model: {e}")
        return None

# ---------- Core synchronous logic (runs in a thread pool) ----------
def _process_audio_sync(recognizer, audio_bytes: bytes) -> str:
    """
    同步执行的 CPU 密集型任务：解码音频 + 神经网络推理
    """
    import soundfile as sf
    import numpy as np

    with BytesIO(audio_bytes) as audio_file:
        audio, sample_rate = sf.read(audio_file, dtype="float32", always_2d=True)
        audio = audio[:, 0] # Convert to mono
        
        stream = recognizer.create_stream()
        stream.accept_waveform(sample_rate, audio)
        recognizer.decode_stream(stream)
        return stream.result.text

# ---------- Public async interface ----------
async def sherpa_recognize(audio_bytes: bytes, model_name: str = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue"):
    """
    异步封装：将繁重的推理任务扔到线程池
    """
    try:
        recognizer = _get_recognizer(model_name)
        if recognizer is None:
            raise RuntimeError("ASR 模型未就绪（可能未下载或加载失败）")
        
        text = await asyncio.to_thread(_process_audio_sync, recognizer, audio_bytes)
        return text
    except Exception as e:
        raise RuntimeError(f"Sherpa ASR 处理失败: {e}")