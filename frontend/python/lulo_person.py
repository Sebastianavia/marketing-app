"""Lulo Studio · pista de persona (Fase 4 del editor viral) con MediaPipe.

  python lulo_person.py --ffmpeg <ruta> --src plate.mp4 --mask persona-mask.mp4 --json persona.json --w 360 --h 640 --fps 30 --frames 1800

Una sola pasada sobre el video base (a resolución reducida):
  - máscara de la persona en TODOS los fotogramas (video en grises, blanco = persona) → fondo
    desenfocado o cambiado, clon, persona delante de un elemento;
  - cada 3 fotogramas: cara (recuadro), manos (centro de la palma, izquierda/derecha de la PERSONA
    vista en el video) y pose (hombros, muñecas, nariz) → reencuadre, seguimiento y movimientos.
Coordenadas de 0 a 1 respecto al cuadro. Imprime "PROGRESO n total fps" y al final "LISTO n".
"""
import argparse
import json
import subprocess
import sys
import time


def parse():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ffmpeg", default="ffmpeg")
    ap.add_argument("--src", required=True)
    ap.add_argument("--mask", required=True)
    ap.add_argument("--json", required=True)
    ap.add_argument("--w", type=int, default=360)
    ap.add_argument("--h", type=int, default=640)
    ap.add_argument("--fps", default="30")
    ap.add_argument("--frames", type=int, default=0)
    ap.add_argument("--cada", type=int, default=3, help="analizar cara/manos/pose cada N fotogramas")
    return ap.parse_args()


def r3(v):
    return round(float(v), 3)


def main():
    a = parse()
    try:
        import numpy as np
        import cv2
        import mediapipe as mp
    except Exception as e:  # noqa: BLE001
        print(f"ERROR faltan paquetes ({e}). Instala el kit de herramientas de Claude en Edición → Herramientas.", flush=True)
        sys.exit(2)

    frame = a.w * a.h * 3
    rd = subprocess.Popen(
        [a.ffmpeg, "-v", "error", "-i", a.src, "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{a.w}x{a.h}", "-"],
        stdout=subprocess.PIPE,
        bufsize=frame * 4,
    )
    wr = subprocess.Popen(
        [a.ffmpeg, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{a.w}x{a.h}", "-r", a.fps, "-i", "-",
         "-c:v", "libx264", "-preset", "fast", "-crf", "16", "-pix_fmt", "yuv420p", a.mask],
        stdin=subprocess.PIPE,
    )
    seg = mp.solutions.selfie_segmentation.SelfieSegmentation(model_selection=0)
    face = mp.solutions.face_detection.FaceDetection(model_selection=0, min_detection_confidence=0.5)
    hands = mp.solutions.hands.Hands(static_image_mode=False, max_num_hands=2, model_complexity=0, min_detection_confidence=0.5, min_tracking_confidence=0.5)
    pose = mp.solutions.pose.Pose(static_image_mode=False, model_complexity=0, enable_segmentation=False, min_detection_confidence=0.5)
    P = mp.solutions.pose.PoseLandmark

    prev = None
    out = []
    n, t0, last = 0, time.time(), 0.0
    k = max(1, a.cada)
    while True:
        buf = rd.stdout.read(frame)
        if len(buf) < frame:
            break
        img = np.frombuffer(buf, dtype=np.uint8).reshape(a.h, a.w, 3)
        res = seg.process(img)
        m = res.segmentation_mask if res.segmentation_mask is not None else np.zeros((a.h, a.w), "float32")
        m = np.clip((m - 0.3) / 0.4, 0, 1)
        # Suavizado temporal ligero (menos parpadeo en el borde)
        if prev is not None:
            m = 0.65 * m + 0.35 * prev
        prev = m
        wr.stdin.write(cv2.GaussianBlur((m * 255).astype("uint8"), (5, 5), 0).tobytes())

        if n % k == 0:
            item = {"t": r3(n / float(a.fps))}
            fd = face.process(img)
            if fd.detections:
                b = max(fd.detections, key=lambda d: d.score[0]).location_data.relative_bounding_box
                item["cara"] = [r3(b.xmin), r3(b.ymin), r3(b.width), r3(b.height)]
            hd = hands.process(img)
            if hd.multi_hand_landmarks:
                for lm, hn in zip(hd.multi_hand_landmarks, hd.multi_handedness):
                    pts = [lm.landmark[i] for i in (0, 5, 9, 13, 17)]
                    cx = sum(p.x for p in pts) / len(pts)
                    cy = sum(p.y for p in pts) / len(pts)
                    # MediaPipe da la mano como si la imagen fuera un espejo: «Left» = mano derecha de la persona
                    lado = "manoDer" if hn.classification[0].label == "Left" else "manoIzq"
                    item[lado] = [r3(cx), r3(cy)]
            ps = pose.process(img)
            if ps.pose_landmarks:
                L = ps.pose_landmarks.landmark
                def pt(i):
                    p = L[i]
                    return [r3(p.x), r3(p.y), r3(p.visibility)]
                item["pose"] = {
                    "nariz": pt(P.NOSE),
                    "hombroIzq": pt(P.LEFT_SHOULDER),
                    "hombroDer": pt(P.RIGHT_SHOULDER),
                    "munecaIzq": pt(P.LEFT_WRIST),
                    "munecaDer": pt(P.RIGHT_WRIST),
                }
            out.append(item)
        n += 1
        now = time.time()
        if n == 1 or now - last >= 1.0:
            print(f"PROGRESO {n} {a.frames} {n / max(1e-6, now - t0):.2f}", flush=True)
            last = now
    wr.stdin.close()
    wr.wait()
    rd.wait()
    with open(a.json, "w", encoding="utf-8") as f:
        json.dump({"fps": float(a.fps) / k, "cada": k, "w": a.w, "h": a.h, "frames": out}, f)
    print(f"LISTO {n}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print(f"ERROR {type(e).__name__}: {e}"[:500], flush=True)
        sys.exit(1)
