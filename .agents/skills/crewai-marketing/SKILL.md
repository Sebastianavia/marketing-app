---
name: crewai-marketing
description: >-
  Arquitectura y patrones de orquestación multi-agente con CrewAI y Python para producción
  de campañas de marketing y video. Incluye roles de agentes (Director, Copywriter, QA),
  flujos secuenciales y jerárquicos, y pipeline de integración con la API de HeyGen.
---

# CrewAI Marketing & Video Studio — Skill de Antigravity

Esta skill define la arquitectura para orquestar equipos de agentes autónomos con **CrewAI** especializados en marketing publicitario y generación de video con avatares (HeyGen).

---

## 1. Requisitos de Entorno (Importante)

CrewAI requiere **Python >= 3.10 y < 3.14**. Para evitar fallos de compilación en Windows con librerías nativas (`regex`, `tiktoken`), usa siempre **Python 3.12**:

```powershell
# Crear y activar entorno virtual con Python 3.12
py -3.12 -m venv venv
.\venv\Scripts\activate

# Instalar dependencias requeridas
pip install crewai crewai-tools requests pydantic python-dotenv
```

---

## 2. Roles del Equipo de Agentes de Marketing

```python
# backend/marketing_crew.py
from crewai import Agent, Task, Crew, Process
from langchain_openai import ChatOpenAI
import os

# Configuración de LLM (OpenRouter / OpenAI)
llm = ChatOpenAI(
    model="openrouter/anthropic/claude-3.5-sonnet",
    base_url="https://openrouter.ai/api/v1",
    api_key=os.getenv("OPENROUTER_API_KEY"),
)

# 1. Director Estratégico de Campaña
strategist = Agent(
    role="Director Estratégico de Marketing",
    goal="Definir el ángulo de venta, propuesta única de valor y la psicología del consumidor para el brief.",
    backstory="Experto con más de 12 años en performance marketing y campañas virales en TikTok y Meta Ads.",
    llm=llm,
    verbose=True,
)

# 2. Copywriter de Gancho y Guiones
copywriter = Agent(
    role="Copywriter Publicitario Especialista en Video Corto",
    goal="Escribir guiones dinámicos para video con ganchos de retención en los primeros 3 segundos.",
    backstory="Maestro del storytelling comercial, especializado en scripts para avatares de IA y videos de 30 a 60 segundos.",
    llm=llm,
    verbose=True,
)

# 3. Auditor de Calidad y Cumplimiento de Marca (QA)
qa_auditor = Agent(
    role="Auditor de Calidad y Marca",
    goal="Auditar el guion asegurando que cumple con los objetivos comerciales, ritmo de lectura y tono persuasivo.",
    backstory="Editor jefe con ojo crítico para eliminar frases genéricas y maximizar la tasa de conversión.",
    llm=llm,
    verbose=True,
)
```

---

## 3. Definición de Tareas y Orquestación

```python
def create_marketing_campaign(product_name: str, target_audience: str, key_benefit: str):
    task_strategy = Task(
        description=f"Analiza el producto '{product_name}' dirigido a '{target_audience}'. "
                    f"El beneficio clave es '{key_benefit}'. Define el ángulo emocional y el gancho principal.",
        expected_output="Documento estratégico con perfil del cliente, dolor principal y 3 ángulos creativos.",
        agent=strategist,
    )

    task_script = Task(
        description="Escribe el guion comercial completo (duración 30 segundos) con pausas e indicaciones "
                    "para el avatar de HeyGen. Divide en: Gancho (0-3s), Problema, Solución y Llamado a la Acción.",
        expected_output="Guion con timestamps, texto para locución y sugerencias visuales.",
        agent=copywriter,
    )

    task_audit = Task(
        description="Evalúa el guion generado. Si tiene clichés, corrígelo. Entrega la versión final pulida y lista.",
        expected_output="Guion final aprobado en formato JSON con 'title', 'script_text' y 'call_to_action'.",
        agent=qa_auditor,
    )

    crew = Crew(
        agents=[strategist, copywriter, qa_auditor],
        tasks=[task_strategy, task_script, task_audit],
        process=Process.sequential,
        verbose=True,
    )

    return crew.kickoff()
```

---

## 4. Integración con HeyGen API v2

Cliente para enviar el guion final producido por CrewAI hacia HeyGen:

```python
# backend/heygen_client.py
import os
import requests

HEYGEN_API_KEY = os.getenv("HEYGEN_API_KEY")
HEYGEN_BASE_URL = "https://api.heygen.com"

def generate_avatar_video(script_text: str, avatar_id: str = "Daisy-inskirt-20220818", voice_id: str = "2d5b0e6cf36f460aa7fc47e3eee4ba54"):
    """
    Envía una petición a HeyGen v2 para renderizar un video con avatar y guion generado.
    """
    url = f"{HEYGEN_BASE_URL}/v2/video/generate"
    headers = {
        "X-Api-Key": HEYGEN_API_KEY,
        "Content-Type": "application/json",
    }
    payload = {
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
            "width": 1080,
            "height": 1920, # 9:16 Vertical para TikTok/Reels
        },
        "aspect_ratio": "9:16",
    }

    response = requests.post(url, json=payload, headers=headers)
    response.raise_for_status()
    return response.json()
```
