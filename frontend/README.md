# 🎬 Marketing AI Studio — Desktop Frontend

Aplicación de escritorio privada y suite integral para la creación, redacción estratégica y producción audiovisual de anuncios de video marketing vertical (TikTok, Reels, YouTube Shorts).

Desarrollada con **Next.js 16 (Turbopack)**, **TypeScript**, **Tailwind CSS**, **Geist Sans** y una arquitectura desacoplada para APIs de IA generativa.

---

## 🚀 Módulos y Capacidades

### 1. Generador UGC Multi-Proveedor & Cotizador en Tiempo Real
- **Catálogo Desacoplado:** Soporte multi-proveedor para **APIMart** y **OpenRouter**.
  - `MiniMax-Hailuo-2.3` ($0.0488/s): Rostros fotorrealistas y expresiones naturales.
  - `kling-v3-omni` ($0.0672/s): Cinemática y física en interacción con productos.
  - `seedance-2.0` ($0.066/s): Prompts calibrados para retención en TikTok.
  - `ByteDance: Seedance 1.5 Pro` ($0.02306/s): Máxima rentabilidad (< $2.00 por anuncio).
  - `ByteDance: Seedance 2.0 Fast` ($0.04035/s): Consistencia facial y equilibrio costo/calidad.
  - `Alibaba: Wan 2.6` ($0.04/s): Especialista en B-Roll y tomas de detalle.
- **Calculadora Reactiva de Costos:** Duración (s) × Tarifa ($/s) calculada en tiempo real.
- **Control Documental de Duración:** Selector de clips nativos (5s, 10s, 15s) y campañas multi-toma (15s, 30s, 60s, 120s) con alerta presupuestaria integrada.

### 2. Motor de Renderizado UGC (Pipeline Asíncrono Desacoplado)
- **ElevenLabs TTS:** Síntesis de locución neuronal en buffer MP3.
- **Almacenamiento Temporal (Cloudflare R2 / S3):** Generación de URLs prefirmadas de audio sin costos de egreso.
- **OpenRouter / HeyGen (`heygen/avatar-iv`):** Renderizado de video fotorrealista con sincronización labial (*lip-sync*).
- **Streaming SSE & SRE Rollback:** Monitoreo granular con `useVideoPipeline` y limpieza automática de activos huérfanos ante fallas.

### 3. Asistente Copilot Local (CLI & Pool de Gemini)
- Terminal y asistente conversacional para redacción de guiones publicitarios, hooks virales y optimización de prompts.
- Pool de claves Gemini (`GEMINI_API_KEYS`) con balanceo de carga automático si se agota la cuota.
- Inyección en 1-clic hacia los formularios de las herramientas activas.

### 4. Herramientas Audiovisuales Complementarias
- **Avatar Studio:** Generación de avatares hablantes fotorrealistas.
- **DeepSwap:** Reemplazo facial de alta fidelidad para modelos sintéticos.
- **Text-to-Video:** Generación de escenas cinemáticas a partir de texto.
- **Biblioteca Local de Proyectos:** Guardado y persistencia en el disco local de la app.

---

## 🛠️ Instalación y Ejecución

### Prerrequisitos
- Node.js 18.x o superior
- npm, pnpm o yarn

### 1. Instalar dependencias
```bash
npm install
```

### 2. Configurar variables de entorno
Copia la plantilla de configuración:
```bash
cp .env.local.example .env.local
```
Completa las claves necesarias en `.env.local`:
- `OPENROUTER_API_KEY`: Para generación de guiones y render de video OpenRouter.
- `ELEVENLABS_API_KEY`: Para síntesis de voz neuronal.
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`: Para subida de audios en Cloudflare R2 / S3.
- `APIMART_API_KEY` *(Opcional)*: Para modelos directos de APIMart (Hailuo, Kling, Seedance).

### 3. Iniciar el entorno de desarrollo
```bash
npm run dev
```
Abre [http://localhost:3000](http://localhost:3000) en tu navegador.

### 4. Validación de compilación y tipos
```bash
npx tsc --noEmit
npm run build
```

---

## 📁 Estructura del Frontend

```
frontend/
├── src/
│   ├── app/                    # Next.js App Router & API Routes (SSE, UGC Dispatch, etc.)
│   ├── components/
│   │   ├── layout/             # TitleBar frameless, TopBar, Sidebar
│   │   ├── tools/              # UgcGeneratorView, UgcModelSelector, AvatarStudioView, etc.
│   │   ├── mia/                # Terminal y Copilot local
│   │   └── storage/            # Biblioteca y persistencia local de proyectos
│   ├── config/
│   │   └── ugc-models.config.ts # Catálogo oficial tipado de modelos y tarifas
│   ├── hooks/
│   │   ├── useCostEstimator.ts  # Cálculo reactivo de costos por segundo
│   │   ├── useVideoPipeline.ts  # Consumo de SSE y estados granulares de render
│   │   └── useUgcPipeline.ts    # Pipeline integral de guion + video
│   ├── services/
│   │   ├── elevenlabs/          # ElevenLabs TTS Service
│   │   ├── storage/             # Cloudflare R2 / S3 Service
│   │   ├── openrouter/          # OpenRouter Video Service
│   │   └── pipeline/            # ugc-pipeline.service & ugc-dispatcher.service
│   └── types/                   # Contratos de datos TypeScript
├── .env.local.example
└── package.json
```
