import os
from pydantic import BaseModel, Field
from typing import List, Optional
from crewai import Agent, Task, Crew, Process, LLM
from dotenv import load_dotenv

load_dotenv()

# Esquema estructurado de salida de campaña
class MarketingScene(BaseModel):
    scene_number: int = Field(description="Número ordinal de la escena")
    timing: str = Field(description="Duración en segundos, ej: 0-3s")
    spoken_text: str = Field(description="Guion de voz para el avatar")
    visual_direction: str = Field(description="Instrucciones visuales, encuadre o fondo")

class CampaignOutput(BaseModel):
    campaign_title: str
    target_audience: str
    core_hook: str
    scenes: List[MarketingScene]
    call_to_action: str
    recommended_avatar_style: str

def get_marketing_llm(model_name: str = "openrouter/anthropic/claude-3.5-sonnet") -> LLM:
    """Configura el cliente LLM a través de OpenRouter."""
    api_key = os.getenv("OPENROUTER_API_KEY")
    return LLM(
        model=model_name,
        base_url="https://openrouter.ai/api/v1",
        api_key=api_key,
        temperature=0.7,
    )

def create_marketing_crew(
    product_name: str,
    target_audience: str,
    key_benefit: str,
    custom_brief: Optional[str] = None,
    llm: Optional[LLM] = None,
) -> Crew:
    if llm is None:
        llm = get_marketing_llm()

    # 1. Estratega de Campaña
    strategist = Agent(
        role="Director Estratégico de Marketing Digital",
        goal="Identificar el ángulo de ventas más persuasivo y el dolor del cliente para crear una campaña de alto impacto.",
        backstory="Especialista con amplia trayectoria en video marketing de respuesta directa para TikTok, Reels y YouTube Shorts.",
        llm=llm,
        verbose=True,
    )

    # 2. Copywriter de Guiones
    copywriter = Agent(
        role="Copywriter Creativo de Video Corto",
        goal="Redactar un guion publicitario magnético de 30 a 60 segundos con ganchos de alta retención.",
        backstory="Experto en redacción comercial para avatares sintéticos, optimizando el ritmo, la claridad y el CTA.",
        llm=llm,
        verbose=True,
    )

    # 3. Auditor de Calidad (QA)
    auditor = Agent(
        role="Auditor de Calidad y Conversión Publicitaria",
        goal="Auditar el guion para eliminar frases redundantes, asegurar fluidez verbal y máxima conversión.",
        backstory="Director de calidad que evalúa la retención de los primeros 3 segundos y la contundencia del llamado a la acción.",
        llm=llm,
        verbose=True,
    )

    # Tarea 1: Estrategia y Ángulo
    t1 = Task(
        description=(
            f"Analiza el producto '{product_name}' dirigido a la audiencia '{target_audience}'.\n"
            f"Beneficio principal: '{key_benefit}'.\n"
            f"Briefing adicional: '{custom_brief or 'Enfocarse en retención y conversión directa'}'.\n"
            "Define el dolor del cliente, el beneficio transformador y 3 opciones de ganchos virales."
        ),
        expected_output="Documento estratégico con análisis de dolor, beneficio clave y 3 ganchos.",
        agent=strategist,
    )

    # Tarea 2: Redacción del Guion
    t2 = Task(
        description=(
            "Usando la estrategia anterior, redacta el guion publicitario completo estructurado en 4 escenas:\n"
            "1. Gancho (0-3s)\n"
            "2. Problema / Agitación (3-12s)\n"
            "3. Solución / Producto (12-22s)\n"
            "4. Llamado a la acción (CTA) claro y urgente (22-30s)."
        ),
        expected_output="Borrador del guion dividido por escenas con indicaciones para el avatar.",
        agent=copywriter,
    )

    # Tarea 3: Auditoría y Salida Estructurada
    t3 = Task(
        description=(
            "Revisa el guion para que suene 100% natural al ser pronunciado por un avatar de IA (HeyGen).\n"
            "Genera el resultado estructurado final cumpliendo el esquema CampaignOutput."
        ),
        expected_output="Objeto estructurado con el guion final aprobado, ganchos y escenas.",
        agent=auditor,
        output_pydantic=CampaignOutput,
    )

    return Crew(
        agents=[strategist, copywriter, auditor],
        tasks=[t1, t2, t3],
        process=Process.sequential,
        verbose=True,
    )
