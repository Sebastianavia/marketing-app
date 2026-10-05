import os
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from dotenv import load_dotenv

from marketing_crew import create_marketing_crew, CampaignOutput
from heygen_service import create_heygen_video, check_video_status

load_dotenv()

app = FastAPI(
    title="Marketing Video AI Studio — Microservicio CrewAI",
    description="API para orquestar agentes de marketing y renderizar videos con HeyGen",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class GenerateCampaignRequest(BaseModel):
    product_name: str
    target_audience: str
    key_benefit: str
    custom_brief: Optional[str] = None

class RenderVideoRequest(BaseModel):
    script_text: str
    avatar_id: Optional[str] = "Daisy-inskirt-20220818"
    voice_id: Optional[str] = "2d5b0e6cf36f460aa7fc47e3eee4ba54"
    title: Optional[str] = "Campaña Publicitaria"

@app.get("/")
def health_check():
    return {
        "status": "online",
        "service": "CrewAI Marketing & Video Producer",
        "python_env": "3.12 (Virtualenv)",
    }

@app.post("/api/campaign/generate")
async def generate_campaign(req: GenerateCampaignRequest):
    """
    Ejecuta el equipo de agentes de CrewAI (Estratega, Copywriter y QA)
    para diseñar la campaña y el guion publicitario.
    """
    try:
        crew = create_marketing_crew(
            product_name=req.product_name,
            target_audience=req.target_audience,
            key_benefit=req.key_benefit,
            custom_brief=req.custom_brief,
        )
        result = crew.kickoff()
        
        # Si la salida tiene pydantic_output
        if hasattr(result, "pydantic") and result.pydantic:
            return {"status": "success", "campaign": result.pydantic.model_dump()}
        return {"status": "success", "raw_output": str(result)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/video/render")
async def render_video(req: RenderVideoRequest):
    """
    Envía el guion generado a HeyGen para renderizar el video con avatar.
    """
    try:
        result = create_heygen_video(
            script_text=req.script_text,
            avatar_id=req.avatar_id or "Daisy-inskirt-20220818",
            voice_id=req.voice_id or "2d5b0e6cf36f460aa7fc47e3eee4ba54",
            title=req.title or "Video Publicitario",
        )
        return {"status": "submitted", "heygen_response": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/video/status/{video_id}")
async def get_status(video_id: str):
    """
    Consulta el estado de generación del video en HeyGen.
    """
    try:
        result = check_video_status(video_id)
        return {"status": "ok", "heygen_data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "0.0.0.0")
    uvicorn.run("main:app", host=host, port=port, reload=True)
