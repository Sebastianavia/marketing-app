"""Lulo Studio · comprueba el Python de este PC para la edición avanzada (solo biblioteca estándar).

Imprime un JSON en una línea: versión de Python, PyTorch (y si hay GPU NVIDIA o Mac), Whisper y numpy.
No instala nada.
"""
import importlib.util
import json
import platform
import sys


def main():
    info = {
        "ok": True,
        "python": platform.python_version(),
        "ejecutable": sys.executable,
        "plataforma": platform.system(),
        "torch": None,
        "cuda": False,
        "gpu": None,
        "mps": False,
        "whisper": importlib.util.find_spec("whisper") is not None,
        "numpy": importlib.util.find_spec("numpy") is not None,
        "opencv": importlib.util.find_spec("cv2") is not None,
    }
    if importlib.util.find_spec("torch") is not None:
        try:
            import torch

            info["torch"] = torch.__version__
            info["cuda"] = bool(torch.cuda.is_available())
            if info["cuda"]:
                info["gpu"] = torch.cuda.get_device_name(0)
            mps = getattr(torch.backends, "mps", None)
            info["mps"] = bool(mps and mps.is_available())
        except Exception as e:  # torch instalado pero roto
            info["torch"] = None
            info["torchError"] = f"{type(e).__name__}: {e}"[:300]
    print(json.dumps(info))


if __name__ == "__main__":
    main()
