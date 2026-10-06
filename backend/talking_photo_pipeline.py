"""
=============================================================================
PIPELINE MODULAR DE TALKING PHOTO (LIP-SYNC) CON HEYGEN, OPENROUTER Y ELEVENLABS
=============================================================================
Arquitectura:
1. Módulo de Texto: Generación de guion con OpenRouter.
2. Módulo de Audio Condicional:
   - 'generar': Síntesis neuronal mediante ElevenLabs -> MP3.
   - 'local': Carga de archivo MP3 existente desde disco local.
3. Módulo de Carga (HeyGen):
   - Carga binaria de imagen (.jpg/.png) -> talking_photo_id.
   - Carga binaria de audio (.mp3) -> audio_id.
4. Módulo de Video & Polling:
   - Despacho de video_inputs con character 'talking_photo' y voice 'audio'.
   - Polling asíncrono no bloqueante con timeout y reintentos.
   - Descarga automática del archivo MP4 final.
=============================================================================
"""

import os
import sys
import time
import argparse
import mimetypes
from pathlib import Path
from typing import Dict, Any, Optional
import requests
from dotenv import load_dotenv

# Reconfigurar salida de consola a UTF-8 para compatibilidad universal con Windows CMD y PowerShell
if sys.platform == "win32":
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Cargar variables de entorno desde .env local o raíz
load_dotenv()
load_dotenv(dotenv_path=Path(__file__).parent.parent / "frontend" / ".env.local")

# Configuración de URLs base
HEYGEN_API_URL = "https://api.heygen.com"
HEYGEN_UPLOAD_URL = "https://upload.heygen.com"
OPENROUTER_API_URL = "https://openrouter.ai/api/v1"
ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1"

# Voces y modelos por defecto
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
DEFAULT_OPENROUTER_MODEL = "meta-llama/llama-3.3-70b-instruct"
DEFAULT_ELEVENLABS_VOICE = "21m00Tcm4TlvDq8ikWAM"  # Rachel (Conversational)


class PipelineConfigError(Exception):
    """Error de configuración de variables de entorno o parámetros."""
    pass


class PipelineApiError(Exception):
    """Error devuelto por una API externa durante la ejecución."""
    def __init__(self, service: str, status_code: int, message: str, details: Any = None):
        super().__init__(f"[{service}] Error HTTP {status_code}: {message}")
        self.service = service
        self.status_code = status_code
        self.details = details


# =============================================================================
# 1. MÓDULO DE TEXTO: GOOGLE GEMINI (CERO COSTOS / POOL DE KEYS) Y OPENROUTER
# =============================================================================
def get_gemini_key_pool() -> list[str]:
    """
    Obtiene las API keys de Google Gemini desde las variables de entorno (.env o .env.local).
    Soporta GEMINI_API_KEYS (lista separada por comas) y GEMINI_API_KEY única.
    """
    keys: list[str] = []
    seen = set()

    raw_pool = os.getenv("GEMINI_API_KEYS", "")
    if raw_pool:
        for k in raw_pool.replace("\n", ",").split(","):
            cleaned = k.strip()
            if cleaned and cleaned not in seen:
                keys.append(cleaned)
                seen.add(cleaned)

    single_key = os.getenv("GEMINI_API_KEY", "").strip()
    if single_key and single_key not in seen:
        keys.append(single_key)
        seen.add(single_key)

    google_key = os.getenv("GOOGLE_GENERATIVE_AI_API_KEY", "").strip()
    if google_key and google_key not in seen:
        keys.append(google_key)
        seen.add(google_key)

    return keys


def generate_script_gemini(
    prompt: str,
    api_key: Optional[str] = None,
    model: str = DEFAULT_GEMINI_MODEL,
    system_instruction: Optional[str] = None,
) -> str:
    """
    Genera un guion de video marketing usando Google Gemini con failover de cuota automático.
    Utiliza el pool de claves configurado en el archivo .env sin costos adicionales.
    """
    if not prompt or not prompt.strip():
        raise ValueError("El prompt para generar el guion no puede estar vacío.")

    keys = [api_key] if api_key else get_gemini_key_pool()
    if not keys:
        raise PipelineConfigError(
            "No se encontraron API Keys de Gemini en GEMINI_API_KEYS ni GEMINI_API_KEY."
        )

    sys_text = system_instruction or (
        "Eres un director de video marketing experto. Escribe un guion corto y directo de locución "
        "en español neutro para un video publicitario de 15 a 30 segundos (máximo 60 palabras). "
        "No incluyas acotaciones entre paréntesis ni indicaciones técnicas de cámara o sonido. "
        "Únicamente entrega el texto exacto que el avatar debe decir en voz alta."
    )

    last_error: Optional[Exception] = None

    for idx, key in enumerate(keys):
        masked_key = f"{key[:8]}...{key[-4:]}" if len(key) > 12 else "***"
        print(f"\n[1/4 Texto] Generando guion con Google Gemini ({model}) [Llave {idx+1}/{len(keys)}: {masked_key}]...")

        endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
        headers = {"Content-Type": "application/json"}
        payload = {
            "system_instruction": {
                "parts": [{"text": sys_text}]
            },
            "contents": [
                {
                    "parts": [{"text": f"Tema o producto: {prompt.strip()}"}]
                }
            ],
            "generationConfig": {
                "temperature": 0.7,
                "maxOutputTokens": 300,
            },
        }

        try:
            res = requests.post(endpoint, json=payload, headers=headers, timeout=30)
            if res.status_code == 200:
                data = res.json()
                candidates = data.get("candidates", [])
                if candidates:
                    parts = candidates[0].get("content", {}).get("parts", [])
                    if parts:
                        script = parts[0].get("text", "").strip()
                        # Limpiar comillas iniciales y finales si las colocó
                        script = script.strip('"\'')
                        print(f"[1/4 Texto] ✓ Guion generado con Gemini ({len(script)} caracteres):\n   \"{script}\"")
                        return script
                raise PipelineApiError("Gemini", 200, "Respuesta vacía de candidatos en Gemini", data)

            # Si es error 429 (límite de cuota) y hay más llaves, rotar
            if res.status_code == 429 and idx < len(keys) - 1:
                print(f"[1/4 Texto] ⚠ Cuota excedida en llave {masked_key}. Conmutando automáticamente a la siguiente...")
                continue

            last_error = PipelineApiError("Gemini", res.status_code, res.text)
        except requests.exceptions.RequestException as req_err:
            last_error = PipelineApiError("Gemini", 0, f"Error de conexión con Gemini: {req_err}")
            if idx < len(keys) - 1:
                print(f"[1/4 Texto] ⚠ Error de red con llave {masked_key}. Intentando siguiente llave...")
                continue

    raise last_error or PipelineConfigError("No fue posible generar el guion con ninguna llave de Gemini del pool.")


def generate_script_openrouter(
    prompt: str,
    api_key: Optional[str] = None,
    model: str = DEFAULT_OPENROUTER_MODEL,
    system_instruction: Optional[str] = None,
) -> str:
    """
    (Alternativo) Conecta con OpenRouter para redactar un guion breve y persuasivo.
    """
    key = api_key or os.getenv("OPENROUTER_API_KEY")
    if not key:
        raise PipelineConfigError("Falta OPENROUTER_API_KEY en las variables de entorno.")

    if not prompt or not prompt.strip():
        raise ValueError("El prompt para generar el guion no puede estar vacío.")

    system_prompt = system_instruction or (
        "Eres un director de video marketing experto. Escribe un guion corto de locución "
        "en español neutro para un video de 15 a 30 segundos (máximo 60 palabras). "
        "No incluyas acotaciones entre paréntesis ni indicaciones técnicas de cámara; "
        "únicamente entrega el texto exacto que el avatar debe decir."
    )

    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://localhost:3000",
        "X-Title": "Marketing AI Studio - Talking Photo Pipeline",
    }

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Tema o producto: {prompt.strip()}"},
        ],
        "temperature": 0.7,
        "max_tokens": 300,
    }

    print(f"\n[1/4 Texto] Generando guion con OpenRouter ({model})...")
    try:
        response = requests.post(
            f"{OPENROUTER_API_URL}/chat/completions",
            json=payload,
            headers=headers,
            timeout=30,
        )
    except requests.exceptions.RequestException as e:
        raise PipelineApiError("OpenRouter", 0, f"Error de conexión de red: {e}")

    if not response.ok:
        raise PipelineApiError("OpenRouter", response.status_code, response.text)

    data = response.json()
    script = data["choices"][0]["message"]["content"].strip()
    script = script.strip('"\'')
    print(f"[1/4 Texto] ✓ Guion generado con OpenRouter ({len(script)} caracteres):\n   \"{script}\"")
    return script


def generate_script(
    prompt: str,
    provider: str = "gemini",
    api_key: Optional[str] = None,
) -> str:
    """
    Selector maestro del módulo de texto.
    Por defecto usa 'gemini' (cero costos y pool de llaves en .env).
    """
    provider = provider.lower().strip()
    if provider == "gemini":
        return generate_script_gemini(prompt, api_key=api_key)
    elif provider == "openrouter":
        return generate_script_openrouter(prompt, api_key=api_key)
    else:
        raise ValueError(f"Proveedor de texto desconocido '{provider}'. Usa 'gemini' u 'openrouter'.")


# =============================================================================
# 2. MÓDULO DE AUDIO CONDICIONAL: ELEVENLABS VS LOCAL
# =============================================================================
def synthesize_elevenlabs(
    text: str,
    output_path: str = "output_speech.mp3",
    voice_id: str = DEFAULT_ELEVENLABS_VOICE,
    api_key: Optional[str] = None,
) -> str:
    """
    Envía texto a ElevenLabs para síntesis de voz neuronal y guarda el MP3.
    Retorna la ruta absoluta del archivo generado.
    """
    key = api_key or os.getenv("ELEVENLABS_API_KEY")
    if not key:
        raise PipelineConfigError("Falta ELEVENLABS_API_KEY en las variables de entorno.")

    if not text or not text.strip():
        raise ValueError("El texto para ElevenLabs no puede estar vacío.")

    endpoint = f"{ELEVENLABS_API_URL}/text-to-speech/{voice_id}"
    headers = {
        "xi-api-key": key,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    }
    payload = {
        "text": text,
        "model_id": "eleven_multilingual_v2",
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75,
            "style": 0.0,
            "use_speaker_boost": True,
        },
    }

    print(f"\n[2/4 Audio] Sintetizando voz con ElevenLabs (Voice ID: {voice_id})...")
    try:
        response = requests.post(endpoint, json=payload, headers=headers, timeout=45)
    except requests.exceptions.RequestException as e:
        raise PipelineApiError("ElevenLabs", 0, f"Error de conexión: {e}")

    if not response.ok:
        raise PipelineApiError("ElevenLabs", response.status_code, response.text)

    dest_path = Path(output_path).resolve()
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    with open(dest_path, "wb") as f:
        f.write(response.content)

    print(f"[2/4 Audio] ✓ Audio neuronal guardado exitosamente en: {dest_path}")
    return str(dest_path)


def resolve_audio(
    mode: str,
    text: Optional[str] = None,
    local_path: Optional[str] = None,
    output_path: str = "speech.mp3",
    voice_id: str = DEFAULT_ELEVENLABS_VOICE,
    api_key: Optional[str] = None,
) -> str:
    """
    Módulo de audio condicional:
    - mode == 'generar': Llama a ElevenLabs con el texto suministrado.
    - mode == 'local': Valida y usa un archivo MP3 existente en disco.
    """
    mode = mode.lower().strip()
    if mode == "generar":
        if not text:
            raise ValueError("Modo 'generar' requiere el parámetro 'text'.")
        return synthesize_elevenlabs(
            text=text,
            output_path=output_path,
            voice_id=voice_id,
            api_key=api_key,
        )
    elif mode == "local":
        if not local_path:
            raise ValueError("Modo 'local' requiere la ruta al archivo en 'local_path'.")
        path = Path(local_path).resolve()
        if not path.is_file():
            raise FileNotFoundError(f"No se encontró el archivo de audio local: {path}")
        print(f"\n[2/4 Audio] ✓ Utilizando audio local verificado en: {path}")
        return str(path)
    else:
        raise ValueError(f"Modo de audio inválido '{mode}'. Debe ser 'generar' o 'local'.")


# =============================================================================
# 3. MÓDULO DE CARGA DE ASSETS A HEYGEN
# =============================================================================
def upload_heygen_asset(
    file_path: str,
    content_type: str,
    api_key: Optional[str] = None,
) -> str:
    """
    Sube un archivo binario (imagen o audio) al endpoint de almacenamiento de HeyGen:
    POST https://upload.heygen.com/v1/asset
    Retorna el ID del asset asignado por HeyGen.
    """
    key = api_key or os.getenv("HEYGEN_API_KEY")
    if not key:
        raise PipelineConfigError("Falta HEYGEN_API_KEY en las variables de entorno.")

    path = Path(file_path).resolve()
    if not path.is_file():
        raise FileNotFoundError(f"El archivo para subir no existe: {path}")

    headers = {
        "X-Api-Key": key,
        "Content-Type": content_type,
    }

    url = f"{HEYGEN_UPLOAD_URL}/v1/asset"
    try:
        with open(path, "rb") as f:
            file_bytes = f.read()

        response = requests.post(url, headers=headers, data=file_bytes, timeout=60)
    except requests.exceptions.RequestException as e:
        raise PipelineApiError("HeyGen Upload", 0, f"Fallo al subir activo: {e}")

    if not response.ok:
        raise PipelineApiError("HeyGen Upload", response.status_code, response.text)

    data = response.json()
    asset_id = data.get("data", {}).get("id") or data.get("data", {}).get("asset_id")
    if not asset_id:
        raise PipelineApiError("HeyGen Upload", response.status_code, "Respuesta sin asset_id", data)

    return asset_id


def upload_talking_photo_image(image_path: str, api_key: Optional[str] = None) -> str:
    """
    Sube la foto del usuario (.jpg / .png) para el Talking Photo.
    """
    mime_type, _ = mimetypes.guess_type(image_path)
    mime_type = mime_type or "image/jpeg"
    print(f"\n[3/4 HeyGen Carga] Subiendo imagen ({mime_type})...")
    asset_id = upload_heygen_asset(image_path, mime_type, api_key)
    print(f"[3/4 HeyGen Carga] ✓ Talking Photo ID obtenido: {asset_id}")
    return asset_id


def upload_talking_photo_audio(audio_path: str, api_key: Optional[str] = None) -> str:
    """
    Sube el archivo de locución (.mp3) para el lip-sync.
    """
    print(f"[3/4 HeyGen Carga] Subiendo audio MP3...")
    asset_id = upload_heygen_asset(audio_path, "audio/mpeg", api_key)
    print(f"[3/4 HeyGen Carga] ✓ Audio Asset ID obtenido: {asset_id}")
    return asset_id


# =============================================================================
# 4. MÓDULO DE VIDEO: GENERACIÓN, POLLING Y DESCARGA
# =============================================================================
def generate_talking_photo_video(
    talking_photo_id: str,
    audio_id: str,
    title: str = "Talking Photo LipSync",
    aspect_ratio: str = "9:16",
    api_key: Optional[str] = None,
) -> str:
    """
    Despacha la orden de generación de video con Talking Photo y Lip-Sync a HeyGen v2.
    Retorna el video_id para realizar polling.
    """
    key = api_key or os.getenv("HEYGEN_API_KEY")
    if not key:
        raise PipelineConfigError("Falta HEYGEN_API_KEY en las variables de entorno.")

    headers = {
        "X-Api-Key": key,
        "Content-Type": "application/json",
    }

    width, height = (1080, 1920) if aspect_ratio == "9:16" else (1920, 1080)

    payload = {
        "title": title,
        "video_inputs": [
            {
                "character": {
                    "type": "talking_photo",
                    "talking_photo_id": talking_photo_id,
                    "talking_photo_style": "normal",
                },
                "voice": {
                    "type": "audio",
                    "audio_asset_id": audio_id,
                },
                "background": {
                    "type": "color",
                    "value": "#000000",
                },
            }
        ],
        "dimension": {
            "width": width,
            "height": height,
        },
        "aspect_ratio": aspect_ratio,
    }

    print(f"\n[4/4 HeyGen Video] Despachando orden de renderizado v2...")
    try:
        response = requests.post(
            f"{HEYGEN_API_URL}/v2/video/generate",
            json=payload,
            headers=headers,
            timeout=30,
        )
    except requests.exceptions.RequestException as e:
        raise PipelineApiError("HeyGen Video", 0, f"Error al despachar video: {e}")

    if not response.ok:
        raise PipelineApiError("HeyGen Video", response.status_code, response.text)

    data = response.json()
    video_id = data.get("data", {}).get("video_id")
    if not video_id:
        raise PipelineApiError("HeyGen Video", response.status_code, "No se recibió video_id", data)

    print(f"[4/4 HeyGen Video] ✓ Render iniciado. Video ID: {video_id}")
    return video_id


def poll_video_until_complete(
    video_id: str,
    interval_seconds: int = 5,
    timeout_seconds: int = 600,
    api_key: Optional[str] = None,
) -> str:
    """
    Consulta periódicamente el endpoint /v1/video_status.get hasta que el estado
    sea 'completed' o 'failed'. Retorna la URL del MP4 final.
    """
    key = api_key or os.getenv("HEYGEN_API_KEY")
    headers = {"X-Api-Key": key}
    url = f"{HEYGEN_API_URL}/v1/video_status.get?video_id={video_id}"

    start_time = time.time()
    print(f"[4/4 HeyGen Video] Iniciando ciclo de polling (cada {interval_seconds}s)...")

    while True:
        elapsed = int(time.time() - start_time)
        if elapsed > timeout_seconds:
            raise TimeoutError(f"Se superó el tiempo límite de renderizado ({timeout_seconds}s).")

        try:
            res = requests.get(url, headers=headers, timeout=15)
        except requests.exceptions.RequestException as e:
            print(f"   Advertencia de red durante polling: {e}. Reintentando...")
            time.sleep(interval_seconds)
            continue

        if not res.ok:
            raise PipelineApiError("HeyGen Status", res.status_code, res.text)

        status_data = res.json().get("data", {})
        status = status_data.get("status", "").lower()

        print(f"   [{elapsed}s] Estado HeyGen: '{status}'")

        if status == "completed":
            video_url = status_data.get("video_url")
            if not video_url:
                raise ValueError("HeyGen reportó 'completed' pero no incluyó 'video_url'.")
            print(f"[4/4 HeyGen Video] ✓ Render finalizado con éxito.")
            return video_url

        if status == "failed":
            error_info = status_data.get("error") or "Fallo interno en HeyGen"
            raise PipelineApiError("HeyGen Status", 500, f"Render falló: {error_info}")

        time.sleep(interval_seconds)


def download_mp4(video_url: str, output_path: str = "output_talking_photo.mp4") -> str:
    """
    Descarga el archivo MP4 desde la URL pública de HeyGen al disco local.
    """
    dest = Path(output_path).resolve()
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"\n[Descarga] Descargando video final desde HeyGen hacia:\n   {dest}")

    response = requests.get(video_url, stream=True, timeout=60)
    response.raise_for_status()

    with open(dest, "wb") as f:
        for chunk in response.iter_content(chunk_size=8192):
            if chunk:
                f.write(chunk)

    print(f"[Descarga] ✓ Archivo MP4 guardado localmente ({dest.stat().st_size} bytes).")
    return str(dest)


# =============================================================================
# 5. ORQUESTADOR MAESTRO DEL PIPELINE
# =============================================================================
def run_talking_photo_pipeline(
    image_path: str,
    audio_mode: str,
    prompt: Optional[str] = None,
    local_audio_path: Optional[str] = None,
    output_video_path: str = "final_talking_photo.mp4",
    voice_id: str = DEFAULT_ELEVENLABS_VOICE,
    aspect_ratio: str = "9:16",
    script_provider: str = "gemini",
) -> Dict[str, Any]:
    """
    Ejecuta el pipeline completo de principio a fin.
    Por defecto utiliza Google Gemini para redacción de guiones a cero costos.
    """
    print("\n" + "=" * 65)
    print(" INICIANDO PIPELINE MODULAR DE TALKING PHOTO")
    print(f" Proveedor de guion: {script_provider.upper()} | Modo audio: {audio_mode}")
    print("=" * 65)

    # 1. Módulo de Texto (Gemini por defecto para recorte de costos)
    if audio_mode == "generar":
        if not prompt:
            raise ValueError("Se requiere '--prompt' cuando audio_mode es 'generar'.")
        script_text = generate_script(prompt, provider=script_provider)
    else:
        script_text = "[Audio local provisto por el usuario]"

    # 2. Módulo de Audio Condicional
    audio_file = resolve_audio(
        mode=audio_mode,
        text=script_text if audio_mode == "generar" else None,
        local_path=local_audio_path,
        output_path="temp_voice.mp3",
        voice_id=voice_id,
    )

    # 3. Módulo de Carga a HeyGen
    talking_photo_id = upload_talking_photo_image(image_path)
    audio_id = upload_talking_photo_audio(audio_file)

    # 4. Módulo de Video & Polling
    video_id = generate_talking_photo_video(
        talking_photo_id=talking_photo_id,
        audio_id=audio_id,
        title=f"TalkingPhoto_{int(time.time())}",
        aspect_ratio=aspect_ratio,
    )

    video_url = poll_video_until_complete(video_id)
    local_mp4 = download_mp4(video_url, output_path=output_video_path)

    print("\n" + "=" * 65)
    print(" PIPELINE COMPLETADO EXITOSAMENTE")
    print(f" Video final: {local_mp4}")
    print("=" * 65 + "\n")

    return {
        "success": True,
        "script": script_text,
        "script_provider": script_provider,
        "audio_path": audio_file,
        "talking_photo_id": talking_photo_id,
        "audio_id": audio_id,
        "video_id": video_id,
        "video_url": video_url,
        "local_mp4_path": local_mp4,
    }


# =============================================================================
# 6. ENTRADA CLI (EJECUCIÓN POR LÍNEA DE COMANDOS)
# =============================================================================
if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Pipeline Modular de Talking Photo (Google Gemini + ElevenLabs + HeyGen)"
    )
    parser.add_argument(
        "--image",
        required=True,
        help="Ruta a la foto del avatar (.jpg o .png)",
    )
    parser.add_argument(
        "--provider",
        choices=["gemini", "openrouter"],
        default="gemini",
        help="Motor de redacción de guion (por defecto 'gemini' usando pool de claves en .env)",
    )
    parser.add_argument(
        "--audio-mode",
        choices=["generar", "local"],
        default="generar",
        help="Modo de audio: 'generar' (Gemini + ElevenLabs) o 'local' (archivo MP3 del disco)",
    )
    parser.add_argument(
        "--prompt",
        default="Crea un gancho publicitario para una bebida energética de lulo",
        help="Idea o tema para que la IA redacte el guion (requerido si --audio-mode=generar)",
    )
    parser.add_argument(
        "--audio-file",
        help="Ruta al archivo MP3 local (requerido si --audio-mode=local)",
    )
    parser.add_argument(
        "--output",
        default="talking_photo_final.mp4",
        help="Ruta de destino para el archivo .mp4 descargado",
    )
    parser.add_argument(
        "--aspect-ratio",
        choices=["9:16", "16:9"],
        default="9:16",
        help="Relación de aspecto del video (9:16 vertical o 16:9 horizontal)",
    )

    args = parser.parse_args()

    try:
        run_talking_photo_pipeline(
            image_path=args.image,
            audio_mode=args.audio_mode,
            prompt=args.prompt,
            local_audio_path=args.audio_file,
            output_video_path=args.output,
            aspect_ratio=args.aspect_ratio,
            script_provider=args.provider,
        )
    except Exception as err:
        print(f"\n[ERROR CRÍTICO] {err}", file=sys.stderr)
        sys.exit(1)
