"""Synthesize the prototype's sound effects (no third-party audio). 44.1 kHz mono 16-bit WAV.
python3 tools/audio/make_sfx.py  -> assets/sfx/*.wav"""
import pathlib
import wave

import numpy as np

SR = 44100
OUT = pathlib.Path(__file__).resolve().parents[2] / "assets/sfx"
rng = np.random.default_rng(1447)


def t(d):
    return np.arange(int(SR * d)) / SR


def env(n, a=0.01, r=0.2):
    e = np.ones(n)
    ai, ri = int(SR * a), int(SR * r)
    e[:ai] = np.linspace(0, 1, ai)
    e[-ri:] *= np.linspace(1, 0, ri) ** 2
    return e


def bandnoise(d, lo, hi):
    n = int(SR * d)
    x = rng.standard_normal(n)
    f = np.fft.rfft(x)
    fr = np.fft.rfftfreq(n, 1 / SR)
    f[(fr < lo) | (fr > hi)] = 0
    return np.fft.irfft(f, n)


def sweep_noise(d, f0, f1, q=0.35):
    # moving band-pass: sum of short windows with rising centre
    n = int(SR * d); out = np.zeros(n); win = 2048; hop = 512
    for i, s in enumerate(range(0, n - win, hop)):
        c = f0 + (f1 - f0) * s / n
        seg = bandnoise(win / SR, c * (1 - q), c * (1 + q)) * np.hanning(win)
        out[s:s + win] += seg
    return out


def save(name, x, gain=0.8):
    x = x / (np.max(np.abs(x)) + 1e-9) * gain
    with wave.open(str(OUT / f"{name}.wav"), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype(np.int16).tobytes())


OUT.mkdir(parents=True, exist_ok=True)
# Saker call: three hoarse "kek" notes (falcon-like, not a recording)
call = np.zeros(int(SR * 0.62))
for k, start in enumerate((0.0, 0.2, 0.4)):
    tt = t(0.14)
    f = 2300 - 500 * tt / 0.14 + 80 * k
    ph = 2 * np.pi * np.cumsum(f) / SR
    note = (np.sin(ph) + 0.5 * np.sin(2 * ph + 0.6 * np.sin(ph * 0.5)) + 0.25 * bandnoise(0.14, 1800, 4500)) * env(len(tt), 0.005, 0.09)
    i = int(SR * start); call[i:i + len(note)] += note
save("falcon_call", call, 0.7)
# Launch: rising air whoosh
save("launch", sweep_noise(0.55, 300, 2600) * env(int(SR * 0.55), 0.04, 0.3), 0.75)
# Strike: wing clap + dull thud
st = t(0.35)
thud = np.sin(2 * np.pi * (110 - 60 * st / 0.35) * st) * np.exp(-st * 18)
clap = bandnoise(0.35, 600, 5000) * np.exp(-st * 40)
save("strike", thud + 0.8 * clap, 0.85)
# Catch: soft leather pat on the glove
ct = t(0.18)
save("catch", bandnoise(0.18, 200, 1800) * np.exp(-ct * 35) + 0.4 * np.sin(2 * np.pi * 180 * ct) * np.exp(-ct * 30), 0.6)
# Net throw: rope swish
save("net_throw", sweep_noise(0.4, 1800, 500, 0.5) * env(int(SR * 0.4), 0.02, 0.25), 0.6)
# Player hit: muffled body thump
ht = t(0.45)
save("player_hit", np.sin(2 * np.pi * (80 - 30 * ht) * ht) * np.exp(-ht * 9) + 0.3 * bandnoise(0.45, 60, 400) * np.exp(-ht * 12), 0.9)
# Trapper flees: sand scuffs
fl = np.zeros(int(SR * 0.6))
for s in (0.0, 0.15, 0.3, 0.45):
    b = bandnoise(0.1, 1500, 7000) * np.exp(-t(0.1) * 40)
    i = int(SR * s); fl[i:i + len(b)] += b
save("flee", fl, 0.5)
# Wave start: low frame drum
wt = t(0.9)
drum = sum(np.sin(2 * np.pi * 75 * (wt - d)) * np.exp(-np.clip(wt - d, 0, None) * 10) * (wt >= d) for d in (0.0, 0.3, 0.45))
save("wave", drum, 0.8)
print("written:", sorted(p.name for p in OUT.glob("*.wav")))
