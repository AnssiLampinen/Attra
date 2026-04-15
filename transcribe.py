"""
transcribe.py

Local audio transcription using faster-whisper. Imported by app_server.py
to process voice notes recorded in the browser — not a runnable script.

The WhisperModel is loaded lazily on the first call and cached in memory
for the lifetime of the process (avoids ~2 s reload per request). A
threading.Lock serialises concurrent calls because CTranslate2 (the
inference backend) is not safe for simultaneous use on the same model
instance; concurrent voice notes from multiple users queue up safely.

Accepts any audio format that ffmpeg understands (.webm from MediaRecorder,
plus .mp4, .wav, .mp3, .ogg, etc.). ffmpeg must be on PATH.

Model size is controlled by the WHISPER_MODEL env var (default: "base",
~74 MB). Options: tiny | base | small | medium. The model is downloaded
automatically to ~/.cache/huggingface/hub on first use.

Exports:
  transcribe_audio(file_path) — transcribes the file and returns plain text,
                                 or an empty string if no speech is detected
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
