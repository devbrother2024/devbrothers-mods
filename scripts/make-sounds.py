"""Synthesize the taxi pack's sound effects so every clip ships under the repo's own license."""

import math
import random
import struct
import wave
from pathlib import Path

RATE = 44_100
ROOT = Path(__file__).resolve().parent.parent / "plugins"


def write(path: Path, samples: list[float]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    peak = max(1e-9, max(abs(s) for s in samples))
    frames = b"".join(struct.pack("<h", int(s / peak * 0.8 * 32767)) for s in samples)
    with wave.open(str(path), "wb") as clip:
        clip.setnchannels(1)
        clip.setsampwidth(2)
        clip.setframerate(RATE)
        clip.writeframes(frames)


def click(duration: float, tone: float, decay: float, noise: float, seed: int) -> list[float]:
    rng = random.Random(seed)
    out = []
    for i in range(int(RATE * duration)):
        t = i / RATE
        env = math.exp(-t * decay)
        out.append(env * (math.sin(2 * math.pi * tone * t) + noise * rng.uniform(-1, 1)))
    return out


def bell(freq: float, duration: float) -> list[float]:
    out = []
    for i in range(int(RATE * duration)):
        t = i / RATE
        env = math.exp(-t * 6)
        out.append(env * (math.sin(2 * math.pi * freq * t) + 0.3 * math.sin(2 * math.pi * freq * 2.01 * t)))
    return out


def silence(duration: float) -> list[float]:
    return [0.0] * int(RATE * duration)


def main() -> None:
    write(ROOT / "taxi-meter/sounds/tick.wav", click(0.04, 2_400, 140, 0.6, seed=1))
    write(ROOT / "taxi-meter/sounds/chime.wav", bell(1_318.5, 0.35) + bell(1_046.5, 0.6))
    write(
        ROOT / "taxi-speedcam/sounds/shutter.wav",
        click(0.05, 1_800, 90, 1.2, seed=2) + silence(0.06) + click(0.07, 1_200, 70, 1.0, seed=3),
    )
    write(ROOT / "taxi-navi/sounds/ding.wav", bell(987.8, 0.5))


if __name__ == "__main__":
    main()
