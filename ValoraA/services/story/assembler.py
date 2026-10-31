"""
services/story/assembler.py

Audio assembly, timing sequencing, background music mixing, dynamic ducking,
and MP3 encoding for the Valora AI Multi-Voice Story Studio.
"""

from __future__ import annotations

import io
import logging
import os
import shutil
import subprocess
import tempfile
import uuid
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from pydub import AudioSegment
from pydub.effects import normalize

logger = logging.getLogger("valora.story.assembler")


def create_silence_segment(duration_ms: int, frame_rate: int = 44100, channels: int = 2) -> AudioSegment:
    """Create a silent AudioSegment of specified duration, frame rate and channel layout."""
    if duration_ms <= 0:
        return AudioSegment.empty()
    return AudioSegment.silent(duration=duration_ms, frame_rate=frame_rate).set_channels(channels)


def load_audio_segment_from_bytes(data: bytes, target_sample_rate: int = 44100) -> AudioSegment:
    """Load arbitrary WAV/MP3 bytes into an AudioSegment and conform sample rate."""
    if not data or len(data) < 44:
        raise ValueError("Invalid or empty audio byte buffer.")
    
    seg = AudioSegment.from_file(io.BytesIO(data))
    if seg.frame_rate != target_sample_rate:
        seg = seg.set_frame_rate(target_sample_rate)
    if seg.channels != 2:
        seg = seg.set_channels(2)
    return seg


def assemble_story(
    clips: List[Dict[str, Any]],
    default_pause_ms: int = 500,
    music_bytes: Optional[bytes] = None,
    music_volume: float = 0.15,
    music_loop: bool = True,
    music_fade_in_ms: int = 600,
    music_fade_out_ms: int = 1200,
    ducking_enabled: bool = True,
    ducking_factor: float = 0.35, # Drops music to 35% during speech
    target_sample_rate: int = 44100,
) -> Tuple[bytes, float, List[Dict[str, Any]]]:
    """
    Assemble individual dialogue clips into a continuous audio master.
    
    Args:
        clips: List of dicts containing:
            - 'line_id': str
            - 'character_id': str
            - 'character_name': str
            - 'audio_bytes': bytes (WAV audio)
            - 'pause_after_ms': Optional[int] (overrides default_pause_ms)
        default_pause_ms: Default pause duration between consecutive dialogue lines.
        music_bytes: Optional raw audio bytes for background music.
        music_volume: Volume multiplier (0.0 to 1.0) for background music.
        music_loop: Whether to loop background music to match dialogue length.
        music_fade_in_ms: Fade-in duration for music.
        music_fade_out_ms: Fade-out duration for music.
        ducking_enabled: Whether to duck background music during spoken dialogue.
        ducking_factor: Music attenuation multiplier during speech (e.g. 0.35 = -9dB).
        target_sample_rate: Master sample rate (standard 44.1kHz).
        
    Returns:
        Tuple of:
            - assembled_wav_bytes: bytes
            - total_duration_seconds: float
            - timeline_markers: List[Dict[str, Any]] with exact timestamps for each line.
    """
    if not clips:
        raise ValueError("No dialogue clips provided for story assembly.")

    master_speech = AudioSegment.empty()
    timeline_markers: List[Dict[str, Any]] = []
    speech_intervals_ms: List[Tuple[int, int]] = []
    
    current_time_ms = 0

    for idx, item in enumerate(clips):
        raw_audio = item.get("audio_bytes")
        if not raw_audio:
            logger.warning("Line %s has empty audio; skipping in assembly.", item.get("line_id"))
            continue

        clip_seg = load_audio_segment_from_bytes(raw_audio, target_sample_rate=target_sample_rate)
        clip_duration_ms = len(clip_seg)

        start_ms = current_time_ms
        end_ms = start_ms + clip_duration_ms

        speech_intervals_ms.append((start_ms, end_ms))
        master_speech += clip_seg
        current_time_ms = end_ms

        # Determine pause after line (no trailing pause on final line)
        pause_ms = item.get("pause_after_ms")
        if pause_ms is None:
            pause_ms = default_pause_ms
        pause_ms = max(0, int(pause_ms))

        is_last = (idx == len(clips) - 1)
        added_pause_ms = 0 if is_last else pause_ms

        timeline_markers.append({
            "line_id": item.get("line_id", str(idx + 1)),
            "character_id": item.get("character_id", "char_unknown"),
            "character_name": item.get("character_name", "Speaker"),
            "start_time_seconds": round(start_ms / 1000.0, 3),
            "end_time_seconds": round(end_ms / 1000.0, 3),
            "duration_seconds": round(clip_duration_ms / 1000.0, 3),
            "pause_after_seconds": round(added_pause_ms / 1000.0, 3),
        })

        if added_pause_ms > 0:
            silence_seg = create_silence_segment(added_pause_ms, frame_rate=target_sample_rate, channels=2)
            master_speech += silence_seg
            current_time_ms += added_pause_ms

    if len(master_speech) == 0:
        raise ValueError("All supplied clips were empty or unreadable.")

    # -------------------------------------------------------------------------
    # Optional Background Music Mixing & Ducking
    # -------------------------------------------------------------------------
    final_mix = master_speech

    if music_bytes and len(music_bytes) > 44:
        try:
            bg_music = load_audio_segment_from_bytes(music_bytes, target_sample_rate=target_sample_rate)
            total_speech_ms = len(master_speech)
            tail_room_ms = min(1500, max(600, music_fade_out_ms))
            target_music_ms = total_speech_ms + tail_room_ms

            # Loop or trim music
            if len(bg_music) < target_music_ms:
                if music_loop:
                    loops_needed = (target_music_ms // len(bg_music)) + 2
                    bg_music = bg_music * loops_needed
                else:
                    # Pad remaining with silence
                    pad = create_silence_segment(target_music_ms - len(bg_music), frame_rate=target_sample_rate)
                    bg_music = bg_music + pad

            bg_music = bg_music[:target_music_ms]

            # Adjust overall music volume
            # Convert linear multiplier (0.0 - 1.0) to dB
            vol = max(0.01, min(1.0, music_volume))
            db_adjust = 20.0 * np.log10(vol)
            bg_music = bg_music.apply_gain(db_adjust)

            # Apply ducking beneath dialogue if requested
            if ducking_enabled and speech_intervals_ms:
                # Ducking reduction in dB (e.g. 0.35 factor ~ -9.1 dB)
                duck_factor = max(0.1, min(0.9, ducking_factor))
                duck_db = 20.0 * np.log10(duck_factor)
                
                # Split music into speech & pause chunks or crossfade
                ducked_music = AudioSegment.empty()
                cursor = 0
                for s_start, s_end in speech_intervals_ms:
                    if s_start > cursor:
                        # Non-speech region: normal volume
                        normal_chunk = bg_music[cursor:s_start]
                        ducked_music += normal_chunk
                    
                    # Speech region: ducked volume
                    speech_chunk = bg_music[s_start:s_end].apply_gain(duck_db)
                    ducked_music += speech_chunk
                    cursor = s_end

                if cursor < len(bg_music):
                    ducked_music += bg_music[cursor:]

                bg_music = ducked_music

            # Apply gentle fade-in and fade-out
            if music_fade_in_ms > 0:
                bg_music = bg_music.fade_in(min(music_fade_in_ms, len(bg_music) // 4))
            if music_fade_out_ms > 0:
                bg_music = bg_music.fade_out(min(music_fade_out_ms, len(bg_music) // 2))

            # Overlay speech on top of background music
            final_mix = bg_music.overlay(master_speech, position=0)
        except Exception as bg_err:
            logger.error("Failed to mix background music into story (%s); proceeding with speech only.", bg_err)
            final_mix = master_speech

    # Normalize to -0.5 dBFS to prevent digital clipping
    try:
        final_mix = normalize(final_mix, headroom=0.5)
    except Exception:
        pass

    out_io = io.BytesIO()
    final_mix.export(out_io, format="wav")
    wav_bytes = out_io.getvalue()
    duration_sec = round(len(final_mix) / 1000.0, 3)

    return wav_bytes, duration_sec, timeline_markers


def convert_story_wav_to_mp3(wav_bytes: bytes, bitrate_kbps: int = 192) -> bytes:
    """
    Encode assembled story WAV audio into valid, high-fidelity MP3.
    Uses ffmpeg CLI with pipe streaming (fastest), falling back to pydub.
    """
    if not wav_bytes or len(wav_bytes) < 44:
        raise ValueError("Invalid WAV byte buffer for MP3 export.")

    ffmpeg_bin = shutil.which("ffmpeg")
    if ffmpeg_bin:
        try:
            cmd = [
                ffmpeg_bin,
                "-v", "error",
                "-y",
                "-i", "pipe:0",
                "-ar", "44100",
                "-c:a", "libmp3lame",
                "-b:a", f"{bitrate_kbps}k",
                "-f", "mp3",
                "pipe:1",
            ]
            proc = subprocess.run(
                cmd,
                input=wav_bytes,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=True,
                timeout=45,
            )
            if proc.stdout and len(proc.stdout) > 64:
                return proc.stdout
        except Exception as ffmpeg_err:
            logger.warning("ffmpeg MP3 encoding failed (%s); trying pydub...", ffmpeg_err)

    # Fallback to pydub
    try:
        seg = AudioSegment.from_file(io.BytesIO(wav_bytes), format="wav")
        out_buf = io.BytesIO()
        seg.export(out_buf, format="mp3", bitrate=f"{bitrate_kbps}k")
        return out_buf.getvalue()
    except Exception as pydub_err:
        logger.error("pydub MP3 encoding failed: %s", pydub_err)
        raise RuntimeError(f"MP3 encoding failed: {pydub_err}") from pydub_err
