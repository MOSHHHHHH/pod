#!/usr/bin/env python3
"""Generate Podki's original, gentle two-second sonic logo (no dependencies except ffmpeg)."""
import math
import pathlib
import struct
import subprocess
import tempfile
import wave

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "audio"
OUT.mkdir(parents=True, exist_ok=True)
RATE = 48000
SECONDS = 2.1

def sample(t):
    total = 0.0
    for start, freq, loudness in ((0.00, 523.25, .21), (.31, 659.25, .19), (.65, 783.99, .16)):
        age = t - start
        if age < 0:
            continue
        envelope = min(1.0, age * 75) * math.exp(-3 * age)
        total += loudness * envelope * (
            math.sin(2 * math.pi * freq * age)
            + .22 * math.sin(4 * math.pi * freq * age)
            + .08 * math.sin(6 * math.pi * freq * age)
        )
    return max(-.9, min(.9, total * max(0.0, min(1.0, (2.08 - t) / .32))))

with tempfile.TemporaryDirectory() as temp:
    wav = pathlib.Path(temp) / "intro.wav"
    with wave.open(str(wav), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes(b"".join(
            struct.pack("<h", int(sample(i / RATE) * 32767))
            for i in range(round(SECONDS * RATE))
        ))
    for rate in (44100, 48000):
        dest = OUT / f"podki-intro-{rate}-stereo.mp3"
        subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav),
            "-ar", str(rate), "-ac", "2", "-codec:a", "libmp3lame", "-b:a", "96k",
            "-write_xing", "0", "-id3v2_version", "0", "-map_metadata", "-1", str(dest)
        ], check=True)
        data = dest.read_bytes()
        if not data.startswith(b"\xff") or len(data) > 40000:
            raise RuntimeError(f"Unexpected MP3 format: {dest}")
        print(f"{dest.relative_to(ROOT)}: {len(data)} bytes")
