"""Lulo Studio · movimiento de labios (fase «Cortes limpios»).

  python lulo_lips.py --ffmpeg <ruta> --src original.mp4 --out labios.json [--fps 15]

Con MediaPipe Face Mesh mide, en cada fotograma, cuánto está abierta la boca de la persona
(distancia entre el labio superior e inferior / alto de la cara). Así se sabe si una voz que se
oye es suya (la boca se mueve) o viene de fondo (la boca está quieta o no se ve la cara).
Salida: {"fps": 15, "boca": [apertura | null, ...]}. Imprime PROGRESO n total fps y LISTO n.
"""
import argparse
import json
import subprocess
import sys
import time


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ffmpeg", default="ffmpeg")
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--fps", type=float, default=15)
    ap.add_argument("--w", type=int, default=360)
    ap.add_argument("--frames", type=int, default=0)
    a = ap.parse_args()
    try:
        import numpy as np
        import mediapipe as mp
    except Exception as e:  # noqa: BLE001
        print(f"ERROR faltan paquetes ({e}). Instala el kit de herramientas de Claude en Edición → Herramientas.", flush=True)
        sys.exit(2)
    # Alto según la proporción del video (se lee la primera línea de ffprobe vía ffmpeg -i)
    info = subprocess.run([a.ffmpeg, "-hide_banner", "-i", a.src], capture_output=True, text=True).stderr
    import re

    m = re.search(r", (\d{2,5})x(\d{2,5})", info)
    vw, vh = (int(m.group(1)), int(m.group(2))) if m else (1080, 1920)
    rot = re.search(r"rotation of (-?\d+)|rotate\s*:\s*(-?\d+)", info)
    if rot and abs(int(rot.group(1) or rot.group(2))) in (90, 270):
        vw, vh = vh, vw
    w = a.w
    h = int(round(vh * w / vw / 2)) * 2
    frame = w * h * 3
    rd = subprocess.Popen(
        [a.ffmpeg, "-v", "error", "-i", a.src, "-vf", f"fps={a.fps},scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        stdout=subprocess.PIPE,
        bufsize=frame * 4,
    )
    mesh = mp.solutions.face_mesh.FaceMesh(static_image_mode=False, max_num_faces=1, refine_landmarks=False, min_detection_confidence=0.5, min_tracking_confidence=0.5)
    out = []
    n, t0, last = 0, time.time(), 0.0
    while True:
        buf = rd.stdout.read(frame)
        if len(buf) < frame:
            break
        img = np.frombuffer(buf, dtype=np.uint8).reshape(h, w, 3)
        r = mesh.process(img)
        if r.multi_face_landmarks:
            L = r.multi_face_landmarks[0].landmark
            # 13/14: labio superior e inferior (interior); 10/152: frente y barbilla
            face_h = abs(L[152].y - L[10].y) or 1e-6
            out.append(round(abs(L[14].y - L[13].y) / face_h, 4))
        else:
            out.append(None)
        n += 1
        now = time.time()
        if n == 1 or now - last >= 1.0:
            print(f"PROGRESO {n} {a.frames} {n / max(1e-6, now - t0):.2f}", flush=True)
            last = now
    rd.wait()
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump({"fps": a.fps, "boca": out}, f)
    print(f"LISTO {n}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print(f"ERROR {type(e).__name__}: {e}"[:500], flush=True)
        sys.exit(1)
