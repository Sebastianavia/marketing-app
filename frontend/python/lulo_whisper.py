"""Lulo Studio · transcripción palabra por palabra con Whisper en este PC (gratis).

  python lulo_whisper.py --audio audio16k.wav --out palabras.json --lang es --model turbo --vocab "Lulo, reel"

El audio debe ser WAV mono de 16 kHz (lo prepara la app con FFmpeg): así Whisper no necesita FFmpeg en el PATH.
Usa NVIDIA si hay; si no, la CPU (más lento: el modelo "small" va bien sin tarjeta gráfica).
"""
import argparse
import json
import sys
import wave


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--lang", default="es")
    ap.add_argument("--model", default="turbo")
    ap.add_argument("--vocab", default="")
    a = ap.parse_args()
    try:
        import numpy as np
        import torch
        import whisper

        with wave.open(a.audio, "rb") as w:
            if w.getnchannels() != 1 or w.getframerate() != 16000 or w.getsampwidth() != 2:
                raise ValueError("el audio debe ser WAV mono, 16 kHz y 16 bits")
            data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0

        dev = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"DISPOSITIVO {dev} {a.model}", flush=True)
        model = whisper.load_model(a.model, device=dev)
        res = model.transcribe(
            data,
            language=a.lang or None,
            word_timestamps=True,
            condition_on_previous_text=False,
            initial_prompt=a.vocab or None,
            fp16=(dev == "cuda"),
        )
        words = [
            {"text": w["word"].strip(), "start": round(float(w["start"]), 3), "end": round(float(w["end"]), 3), "p": round(float(w.get("probability", 0)), 3)}
            for seg in res.get("segments", [])
            for w in seg.get("words", [])
            if w.get("word", "").strip()
        ]
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump({"text": res.get("text", "").strip(), "words": words, "dispositivo": dev}, f, ensure_ascii=False)
        print(f"LISTO {len(words)}", flush=True)
    except Exception as e:
        print(f"ERROR {type(e).__name__}: {e}"[:500], flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
