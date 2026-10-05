# 🚀 Marketing AI Studio (Next.js + Vercel AI SDK + CrewAI + HeyGen)

Plataforma integral para ideación, redacción estratégica y producción audiovisual de anuncios de marketing en formato vertical (TikTok, Reels, Shorts) combinando **Next.js**, **Vercel AI SDK**, **CrewAI** y la API de **HeyGen**.

---

## 🏗 Arquitectura del Proyecto

```
app- marketing/
├── .agents/
│   └── skills/
│       ├── vercel-ai-sdk/       <-- Skill de Antigravity: patrones Next.js + AI SDK
│       └── crewai-marketing/    <-- Skill de Antigravity: orquestación de agentes y HeyGen
├── frontend/                    <-- Next.js (TypeScript, Tailwind, Vercel AI SDK, OpenRouter)
│   ├── src/
│   │   ├── app/
│   │   │   └── api/chat/        <-- Streaming con streamText y OpenRouter
│   │   └── lib/ai/              <-- Cliente OpenRouter (@ai-sdk/openai)
│   └── .env.local.example
└── backend/                     <-- Python 3.12 (CrewAI, FastAPI, HeyGen API)
    ├── venv/                    <-- Entorno virtual aislado
    ├── marketing_crew.py        <-- Agentes: Director Estratégico, Copywriter, Auditor QA
    ├── heygen_service.py        <-- Cliente HeyGen v2 para renderizar video
    ├── main.py                  <-- Servidor FastAPI
    └── requirements.txt
```

---

## ⚡ Guía de Ejecución

### 1. Iniciar el Frontend (Next.js)

1. Entra a la carpeta `frontend`:
   ```powershell
   cd frontend
   ```
2. Copia las variables de entorno y agrega tu `OPENROUTER_API_KEY`:
   ```powershell
   cp .env.local.example .env.local
   ```
3. Inicia el servidor de desarrollo:
   ```powershell
   npm run dev
   ```
   Abre [http://localhost:3000](http://localhost:3000).

---

### 2. Iniciar el Backend (CrewAI + FastAPI)

1. Entra a la carpeta `backend`:
   ```powershell
   cd backend
   ```
2. Activa el entorno virtual:
   ```powershell
   .\venv\Scripts\activate
   ```
3. Configura tus credenciales (`OPENROUTER_API_KEY`, `HEYGEN_API_KEY`):
   ```powershell
   cp .env.example .env
   ```
4. Inicia el servidor de la API:
   ```powershell
   python main.py
   ```
   El microservicio estará disponible en [http://localhost:8000](http://localhost:8000).

---

## 🧠 Skills de Antigravity Instaladas

Tu asistente en Antigravity cuenta con dos skills persistentes cargadas en este workspace:
- **`vercel-ai-sdk`**: Ubicada en [.agents/skills/vercel-ai-sdk/SKILL.md](file:///d:/github/app-%20marketing/.agents/skills/vercel-ai-sdk/SKILL.md). Proporciona recetas y directrices para streaming, interfaces generativas y tool-calling con OpenRouter.
- **`crewai-marketing`**: Ubicada en [.agents/skills/crewai-marketing/SKILL.md](file:///d:/github/app-%20marketing/.agents/skills/crewai-marketing/SKILL.md). Proporciona la definición de roles de agentes (Director de Campaña, Copywriter de Gancho, QA) y el conector a la API de HeyGen.
