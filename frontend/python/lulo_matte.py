"""Lulo Studio · recorte del sujeto (mate) fotograma a fotograma con RobustVideoMatting.

  python lulo_matte.py --ffmpeg <ruta> --src plate.mp4 --out matte.mp4 --model rvm.torchscript --w 1080 --h 1920 --frames 900

Salida: video en escala de grises (blanco = persona). Sirve para poner texto DETRÁS de la cabeza:
el fondo real se conserva y la persona se vuelve a poner encima.
Usa NVIDIA (CUDA) si existe, si no Mac (MPS) y si no la CPU. Imprime "PROGRESO n total" para la barra de la app.
--prueba: no usa PyTorch (mate a partir del brillo); solo para probar la conexión con FFmpeg.
"""
import argparse
import subprocess
import sys
import time


def parse():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ffmpeg", default="ffmpeg")
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", default="")
    ap.add_argument("--w", type=int, required=True)
    ap.add_argument("--h", type=int, required=True)
    ap.add_argument("--fps", default="30")
    ap.add_argument("--frames", type=int, default=0)
    ap.add_argument("--down", type=float, default=0, help="downsample_ratio (0 = automático)")
    ap.add_argument("--prueba", action="store_true")
    return ap.parse_args()


def open_pipes(a):
    frame = a.w * a.h * 3
    rd = subprocess.Popen(
        [a.ffmpeg, "-v", "error", "-i", a.src, "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{a.w}x{a.h}", "-"],
        stdout=subprocess.PIPE,
        bufsize=frame * 2,
    )
    wr = subprocess.Popen(
        [a.ffmpeg, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{a.w}x{a.h}", "-r", a.fps, "-i", "-",
         "-c:v", "libx264", "-preset", "fast", "-crf", "12", "-pix_fmt", "yuv420p", a.out],
        stdin=subprocess.PIPE,
    )
    return rd, wr, frame


def report(n, total, t0, last):
    now = time.time()
    if n == 1 or now - last >= 1.0:
        print(f"PROGRESO {n} {total} {n / max(1e-6, now - t0):.2f}", flush=True)
        return now
    return last


def run_test(a):
    """Sin PyTorch: blanco donde el canal verde es claro. Solo para pruebas."""
    rd, wr, frame = open_pipes(a)
    lut = bytes(255 if v > 100 else 0 for v in range(256))
    n, t0, last = 0, time.time(), 0.0
    while True:
        buf = rd.stdout.read(frame)
        if len(buf) < frame:
            break
        wr.stdin.write(buf[1::3].translate(lut))
        n += 1
        last = report(n, a.frames, t0, last)
    wr.stdin.close()
    wr.wait()
    rd.wait()
    print(f"LISTO {n} prueba", flush=True)


def run_rvm(a):
    import torch

    if a.down:
        down = a.down
    else:
        # RVM recomienda ~0,25 en 4K y ~0,4 en HD
        down = 0.25 if max(a.w, a.h) >= 3000 else 0.4

    def pick():
        if torch.cuda.is_available():
            return "cuda"
        mps = getattr(torch.backends, "mps", None)
        if mps and mps.is_available():
            return "mps"
        return "cpu"

    def load(dev):
        m = torch.jit.load(a.model, map_location="cpu").to(dev).eval()
        try:
            m = torch.jit.freeze(m)
        except Exception:
            pass
        with torch.no_grad():
            m(torch.zeros(1, 3, a.h, a.w, device=dev), None, None, None, None, down)
        return m

    dev = pick()
    try:
        model = load(dev)
    except Exception as e:
        if dev == "cpu":
            raise
        print(f"AVISO {dev} no funciona con este modelo ({type(e).__name__}); se usa la CPU.", flush=True)
        dev = "cpu"
        model = load(dev)
    print(f"DISPOSITIVO {dev}", flush=True)

    rd, wr, frame = open_pipes(a)
    rec = [None] * 4
    n, t0, last = 0, time.time(), 0.0
    with torch.no_grad():
        while True:
            buf = rd.stdout.read(frame)
            if len(buf) < frame:
                break
            src = torch.frombuffer(bytearray(buf), dtype=torch.uint8).to(dev).view(a.h, a.w, 3).permute(2, 0, 1)[None].float().div_(255)
            # Los estados recurrentes (rec) pasan de un fotograma al siguiente: dan estabilidad en el tiempo
            fgr, pha, *rec = model(src, *rec, down)
            wr.stdin.write(pha[0, 0].mul(255).round().clamp(0, 255).to(torch.uint8).cpu().numpy().tobytes())
            n += 1
            last = report(n, a.frames, t0, last)
    wr.stdin.close()
    wr.wait()
    rd.wait()
    print(f"LISTO {n} {dev}", flush=True)


def main():
    a = parse()
    try:
        if a.prueba:
            run_test(a)
        else:
            if not a.model:
                print("ERROR Falta el modelo de recorte.", flush=True)
                sys.exit(2)
            run_rvm(a)
    except Exception as e:
        print(f"ERROR {type(e).__name__}: {e}"[:500], flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
