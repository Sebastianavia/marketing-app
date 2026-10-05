import os
import requests
from typing import Dict, Any, Optional

HEYGEN_BASE_URL = "https://api.heygen.com"

def get_heygen_headers() -> Dict[str, str]:
    api_key = os.getenv("HEYGEN_API_KEY", "")
    return {
        "X-Api-Key": api_key,
        "Content-Type": "application/json",
    }

def create_heygen_video(
    script_text: str,
    avatar_id: str = "Daisy-inskirt-20220818",
    voice_id: str = "2d5b0e6cf36f460aa7fc47e3eee4ba54",
    title: str = "Video Campaña Marketing",
    dimension: str = "1080x1920", # 9:16 vertical
) -> Dict[str, Any]:
    """
    Envía una petición a HeyGen v2 para renderizar un video con avatar parlante.
    """
    url = f"{HEYGEN_BASE_URL}/v2/video/generate"
    width, height = [int(x) for x in dimension.split("x")]

    payload = {
        "title": title,
        "video_inputs": [
            {
                "character": {
                    "type": "avatar",
                    "avatar_id": avatar_id,
                    "avatar_style": "normal",
                },
                "voice": {
                    "type": "text",
                    "input_text": script_text,
                    "voice_id": voice_id,
                },
                "background": {
                    "type": "color",
                    "value": "#0F172A",
                },
            }
        ],
        "dimension": {
            "width": width,
            "height": height,
        },
        "aspect_ratio": "9:16",
    }

    response = requests.post(url, json=payload, headers=get_heygen_headers(), timeout=30)
    response.raise_for_status()
    return response.json()

def check_video_status(video_id: str) -> Dict[str, Any]:
    """
    Consulta el estado de renderizado del video en HeyGen.
    """
    url = f"{HEYGEN_BASE_URL}/v1/video_status.get?video_id={video_id}"
    response = requests.get(url, headers=get_heygen_headers(), timeout=15)
    response.raise_for_status()
    return response.json()
