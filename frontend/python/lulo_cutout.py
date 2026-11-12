"""Recorte de la persona en una imagen (portadas): PNG con transparencia.

Uso: python lulo_cutout.py --src foto.jpg --out recorte.png
Usa la segmentación de selfies de MediaPipe (en las herramientas de Claude o en el Python del PC)
y suaviza el borde. Imprime OK o ERROR <motivo>.
"""
import argparse
import sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    try:
        import cv2
        import numpy as np
        import mediapipe as mp
    except Exception as e:  # noqa: BLE001
        print(f"ERROR faltan paquetes ({e})")
        return 2
    img = cv2.imread(a.src, cv2.IMREAD_COLOR)
    if img is None:
        print("ERROR no se pudo leer la imagen")
        return 2
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    seg = mp.solutions.selfie_segmentation.SelfieSegmentation(model_selection=0)
    res = seg.process(rgb)
    if res.segmentation_mask is None:
        print("ERROR sin máscara")
        return 1
    m = res.segmentation_mask.astype("float32")
    # Umbral suave + cierre de huecos + borde difuminado
    m = np.clip((m - 0.35) / 0.3, 0, 1)
    k = max(3, int(round(min(img.shape[:2]) / 180)) | 1)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k * 3, k * 3)))
    m = cv2.GaussianBlur(m, (k, k), 0)
    # Solo la zona más grande (quita manchas sueltas)
    bin_ = (m > 0.5).astype("uint8")
    n, lab, stats, _ = cv2.connectedComponentsWithStats(bin_)
    if n > 2:
        big = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        keep = cv2.dilate((lab == big).astype("uint8"), np.ones((k * 4, k * 4), "uint8"))
        m = m * keep
    if float(m.mean()) < 0.02:
        print("ERROR no se encontró a ninguna persona")
        return 1
    out = np.dstack([img, (m * 255).astype("uint8")])
    cv2.imwrite(a.out, out)
    rows = np.where((m > 0.5).mean(axis=1) > 0.01)[0]
    top = float(rows[0]) / m.shape[0] if len(rows) else 0.0
    print(f"OK TOP {top:.4f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
