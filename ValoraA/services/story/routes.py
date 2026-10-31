"""
services/story/routes.py

FastAPI routes for Multi-Voice Story Studio:
- /api/story/assemble: Assemble dialogue clips into one continuous story track
- /api/story/download/{export_id}: Download assembled WAV or MP3
- /api/story/generate-script: AI script generation
- /api/story/music-tracks: List available royalty-free background tracks
- /api/story/upload-music: Upload custom background music
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import logging
from pathlib import Path
import re
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, File, Form, HTTPException, Request, Response, UploadFile, status
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from services.story.assembler import assemble_story, convert_story_wav_to_mp3
from services.story.generator import generate_story_script

logger = logging.getLogger("valora.story.routes")

router = APIRouter(prefix="/api/story", tags=["Story Studio"])

STATIC_DIR = Path(__file__).resolve().parents[1] / "api" / "static"
EXPORTS_DIR = STATIC_DIR / "uploads" / "story_exports"
MUSIC_DIR = STATIC_DIR / "uploads" / "music"
AMBIENCE_DIR = STATIC_DIR / "assets" / "audio" / "ambience"

EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
MUSIC_DIR.mkdir(parents=True, exist_ok=True)


BUILTIN_MUSIC_TRACKS = [
    {
        "id": "piano_ambient",
        "name": "Gentle Acoustic Piano",
        "description": "Warm, emotional piano chords and soft acoustic resonance.",
        "filename": "piano_ambient.wav",
        "url": "/assets/audio/ambience/piano_ambient.wav",
        "duration_seconds": 12.0,
        "is_loopable": True,
        "recommended_volume": 0.15,
    },
    {
        "id": "cinematic_drone",
        "name": "Cinematic Mystery Drone",
        "description": "Deep atmospheric string drone for suspense, drama, and mystery.",
        "filename": "cinematic_drone.wav",
        "url": "/assets/audio/ambience/cinematic_drone.wav",
        "duration_seconds": 12.0,
        "is_loopable": True,
        "recommended_volume": 0.12,
    },
    {
        "id": "lofi_warm",
        "name": "Lo-Fi Warm Pad",
        "description": "Mellow jazz pad with gentle tape warmth and relaxing ambiance.",
        "filename": "lofi_warm.wav",
        "url": "/assets/audio/ambience/lofi_warm.wav",
        "duration_seconds": 12.0,
        "is_loopable": True,
        "recommended_volume": 0.14,
    },
    {
        "id": "cafe_ambience",
        "name": "Quiet Café Ambience",
        "description": "Subtle low-frequency room tone and warm organic texture.",
        "filename": "cafe_ambience.wav",
        "url": "/assets/audio/ambience/cafe_ambience.wav",
        "duration_seconds": 12.0,
        "is_loopable": True,
        "recommended_volume": 0.10,
    },
]


class ClipPayload(BaseModel):
    line_id: str
    character_id: str
    character_name: str
    audio_base64: str = Field(..., description="Base64-encoded WAV audio for the line")
    pause_after_ms: Optional[int] = Field(default=None, description="Pause duration after this line in ms")


class StoryAssembleRequest(BaseModel):
    project_id: Optional[str] = "proj_default"
    project_name: Optional[str] = "Untitled Story"
    version_hash: Optional[str] = None
    default_pause_ms: int = Field(default=500, ge=0, le=10000)
    clips: List[ClipPayload]
    music_track_id: Optional[str] = None # 'piano_ambient', 'cinematic_drone', etc.
    music_base64: Optional[str] = None # Custom uploaded music bytes in base64
    music_volume: float = Field(default=0.15, ge=0.0, le=1.0)
    music_loop: bool = True
    ducking_enabled: bool = True
    ducking_factor: float = Field(default=0.35, ge=0.05, le=1.0)


class ScriptGenerateRequest(BaseModel):
    topic: str
    format: str = "Audiobook Scene"
    characters: Optional[List[str]] = None
    language: str = "en-US"
    tone: str = "Cinematic"
    length: str = "medium"
    instructions: Optional[str] = None


@router.get("/music-tracks", summary="List built-in ambient music tracks")
async def list_music_tracks():
    """Return available ambient tracks with preview URLs."""
    return {"status": "success", "tracks": BUILTIN_MUSIC_TRACKS}


@router.post("/upload-music", summary="Upload custom background music")
async def upload_music(file: UploadFile = File(...)):
    """Upload custom audio for use as background music."""
    filename = file.filename or "custom_music.wav"
    ext = Path(filename).suffix.lower()
    if ext not in [".wav", ".mp3", ".ogg", ".m4a"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported audio format. Please upload .wav, .mp3, or .ogg.",
        )

    file_id = f"custom_{uuid.uuid4().hex[:10]}"
    target_path = MUSIC_DIR / f"{file_id}{ext}"

    content = await file.read()
    if not content or len(content) < 128:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty or corrupted.",
        )

    with open(target_path, "wb") as f:
        f.write(content)

    return {
        "status": "success",
        "music_id": file_id,
        "name": Path(filename).stem,
        "url": f"/uploads/music/{target_path.name}",
    }


@router.post("/assemble", summary="Assemble dialogue clips into continuous story audio")
async def assemble_story_endpoint(req: StoryAssembleRequest):
    """
    Assemble speech clips with specified pauses and optional background music.
    Caches output by version hash so repeated downloads don't re-render unchanged audio.
    """
    if not req.clips:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot assemble empty story. Please supply at least one dialogue clip.",
        )

    # Compute stable render hash
    hash_material = f"{req.project_name}_{req.default_pause_ms}_{req.music_track_id}_{req.music_volume}_{req.ducking_enabled}"
    for c in req.clips:
        hash_material += f"_{c.line_id}_{c.pause_after_ms}_{len(c.audio_base64)}"
    render_hash = hashlib.sha256(hash_material.encode("utf-8")).hexdigest()[:16]

    export_wav_path = EXPORTS_DIR / f"story_{render_hash}.wav"
    export_mp3_path = EXPORTS_DIR / f"story_{render_hash}.mp3"
    meta_path = EXPORTS_DIR / f"story_{render_hash}.json"

    # Check cache
    if export_wav_path.exists() and export_mp3_path.exists() and meta_path.exists():
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                cached_data = json.load(f)
            logger.info("Serving story assembly from cache: story_%s", render_hash)
            return cached_data
        except Exception:
            pass

    # Decode clips
    decoded_clips = []
    for c in req.clips:
        try:
            audio_bytes = base64.b64decode(c.audio_base64)
            decoded_clips.append({
                "line_id": c.line_id,
                "character_id": c.character_id,
                "character_name": c.character_name,
                "audio_bytes": audio_bytes,
                "pause_after_ms": c.pause_after_ms,
            })
        except Exception as dec_err:
            logger.error("Failed to decode base64 audio for line %s: %s", c.line_id, dec_err)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid audio data for line {c.line_id}",
            ) from dec_err

    # Resolve background music bytes
    music_bytes: Optional[bytes] = None
    if req.music_base64:
        try:
            music_bytes = base64.b64decode(req.music_base64)
        except Exception:
            pass
    elif req.music_track_id:
        track = next((t for t in BUILTIN_MUSIC_TRACKS if t["id"] == req.music_track_id), None)
        if track:
            candidate_paths = [
                AMBIENCE_DIR / track["filename"],
                STATIC_DIR / "assets" / "audio" / "ambience" / track["filename"],
                Path(__file__).resolve().parents[3] / "assets" / "audio" / "ambience" / track["filename"],
            ]
            for p in candidate_paths:
                if p.exists():
                    music_bytes = p.read_bytes()
                    break

    # Assemble
    try:
        wav_bytes, duration_seconds, timeline_markers = assemble_story(
            clips=decoded_clips,
            default_pause_ms=req.default_pause_ms,
            music_bytes=music_bytes,
            music_volume=req.music_volume,
            music_loop=req.music_loop,
            ducking_enabled=req.ducking_enabled,
            ducking_factor=req.ducking_factor,
            target_sample_rate=44100,
        )
    except Exception as asm_err:
        logger.exception("Story assembly error: %s", asm_err)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Audio assembly failed: {asm_err}",
        ) from asm_err

    # Convert to MP3
    try:
        mp3_bytes = convert_story_wav_to_mp3(wav_bytes, bitrate_kbps=192)
    except Exception as mp3_err:
        logger.error("MP3 conversion failed (%s); proceeding with WAV only.", mp3_err)
        mp3_bytes = b""

    # Save to disk
    with open(export_wav_path, "wb") as f:
        f.write(wav_bytes)

    if mp3_bytes:
        with open(export_mp3_path, "wb") as f:
            f.write(mp3_bytes)

    response_payload = {
        "status": "success",
        "export_id": f"story_{render_hash}",
        "project_name": req.project_name,
        "duration_seconds": duration_seconds,
        "line_count": len(req.clips),
        "wav_url": f"/uploads/story_exports/story_{render_hash}.wav",
        "mp3_url": f"/uploads/story_exports/story_{render_hash}.mp3" if mp3_bytes else None,
        "file_size_wav": len(wav_bytes),
        "file_size_mp3": len(mp3_bytes) if mp3_bytes else 0,
        "sample_rate": 44100,
        "quality_wav": "44.1kHz 16-bit Lossless WAV",
        "quality_mp3": "192kbps LAME High-Efficiency MP3",
        "timeline": timeline_markers,
    }

    try:
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(response_payload, f, indent=2)
    except Exception:
        pass

    return response_payload


@router.get("/download/{export_id}")
async def download_story_export(export_id: str, format: str = "wav", filename: Optional[str] = None):
    """Download the assembled story audio as a file attachment."""
    fmt = format.lower().strip()
    if fmt not in ["wav", "mp3"]:
        fmt = "wav"

    target_file = EXPORTS_DIR / f"{export_id}.{fmt}"
    if not target_file.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exported audio file not found.")

    safe_name = re.sub(r'[^a-zA-Z0-9_\-\s]', '', filename or export_id).strip()
    if not safe_name:
        safe_name = export_id
    final_filename = f"{safe_name}.{fmt}"

    media_type = "audio/wav" if fmt == "wav" else "audio/mpeg"
    return FileResponse(
        path=target_file,
        media_type=media_type,
        filename=final_filename,
        headers={"Content-Disposition": f'attachment; filename="{final_filename}"'},
    )


@router.post("/generate-script", summary="Generate multi-character story script with AI")
async def generate_script_endpoint(req: ScriptGenerateRequest):
    """Generate structured dialogue script with AI or Intelligent Scene Composer."""
    if not req.topic or not req.topic.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Please provide a topic or story idea.")

    result = generate_story_script(
        topic=req.topic,
        format_type=req.format,
        characters=req.characters,
        language=req.language,
        tone=req.tone,
        length_option=req.length,
        scene_instructions=req.instructions,
    )
    return result
