"""Lulo Studio · dónde está la cara en cada momento (para que los gráficos no la tapen).

  python lulo_faces.py --ffmpeg <ruta> --src plate.mp4 --sw 360 --sh 640 --fps 4 --out caras.json

Lee el video reducido en escala de grises y busca la cara más grande con el detector de OpenCV.
Guarda cajas normalizadas (0–1) por muestra: {"fps": 4, "frames": [{"x":..,"y":..,"w":..,"h":..} | null, ...]}.
"""
import argparse
import json
import subprocess
import sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ffmpeg", default="ffmpeg")
    ap.add_argument("--src", required=True)
    ap.add_argument("--sw", type=int, required=True)
    ap.add_argument("--sh", type=int, required=True)
    ap.add_argument("--fps", type=float, default=4)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    try:
        import cv2
        import numpy as np

        cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
        if cascade.empty():
            raise RuntimeError("no se pudo cargar el detector de caras de OpenCV")
        frame = a.sw * a.sh
        rd = subprocess.Popen(
            [a.ffmpeg, "-v", "error", "-i", a.src, "-vf", f"fps={a.fps},scale={a.sw}:{a.sh},format=gray", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
            stdout=subprocess.PIPE,
            bufsize=frame * 4,
        )
        frames = []
        min_side = max(24, int(a.sw * 0.12))
        while True:
            buf = rd.stdout.read(frame)
            if len(buf) < frame:
                break
            img = np.frombuffer(buf, dtype=np.uint8).reshape(a.sh, a.sw)
            img = cv2.equalizeHist(img)
            found = cascade.detectMultiScale(img, scaleFactor=1.1, minNeighbors=5, minSize=(min_side, min_side))
            if len(found):
                x, y, w, h = max(found, key=lambda b: b[2] * b[3])
                frames.append({"x": x / a.sw, "y": y / a.sh, "w": w / a.sw, "h": h / a.sh})
            else:
                frames.append(None)
        rd.wait()
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump({"fps": a.fps, "frames": frames}, f)
        hits = sum(1 for x in frames if x)
        print(f"LISTO {len(frames)} {hits}", flush=True)
    except Exception as e:
        print(f"ERROR {type(e).__name__}: {e}"[:500], flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
