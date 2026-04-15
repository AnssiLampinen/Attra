"""
transcribe.py — local audio transcription via faster-whisper.

Dependency: pip install faster-whisper
ffmpeg must be on PATH (needed to decode .webm from MediaRecorder).
  Windows: winget install ffmpeg
  macOS:   brew install ffmpeg
  Linux:   apt install ffmpeg

Set env var WHISPER_MODEL=tiny|base|small|medium to override the model.
The model (~74 MB for 'base') is downloaded on first call to ~/.cache/huggingface/hub.
"""

import os
import threading
from functools import lru_cache

WHISPER_MODEL = os.getenv("WHISPER_MODEL", "base")

# CTranslate2 (used by faster-whisper) is not safe for concurrent inference
# on the same model instance. This lock serialises calls across threads.
_transcribe_lock = threading.Lock()


@lru_cache(maxsize=1)
def _get_model():
    """Load and cache the WhisperModel — initialised once per process."""
    from faster_whisper import WhisperModel
    return WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")


def transcribe_audio(file_path: str) -> str:
    """Transcribe audio at file_path and return full text.

    Accepts any format ffmpeg understands: webm, mp4, wav, mp3, ogg.
    Returns empty string if no speech detected.
    """
    model = _get_model()
    with _transcribe_lock:
        segments, _ = model.transcribe(file_path, beam_size=5)
        return " ".join(seg.text.strip() for seg in segments).strip()
