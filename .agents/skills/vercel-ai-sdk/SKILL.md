---
name: vercel-ai-sdk
description: >-
  Guía completa y recetas de implementación para Vercel AI SDK en proyectos Next.js App Router,
  incluyendo streaming de texto (streamText, useChat), tool calling para generación estructurada
  de anuncios y guiones de marketing, e integración con OpenRouter mediante @ai-sdk/openai.
---

# Vercel AI SDK — Skill de Desarrollo para Next.js

Esta skill proporciona las directrices de arquitectura, mejores prácticas y patrones de código para integrar **Vercel AI SDK** en aplicaciones Next.js orientadas a marketing y generación de contenido audiovisual.

---

## 1. Configuración de Proveedor (OpenRouter / OpenAI)

Vercel AI SDK utiliza `@ai-sdk/openai` compatible con OpenRouter configurando el `baseURL`:

```typescript
// frontend/src/lib/ai/openrouter.ts
import { createOpenAI } from '@ai-sdk/openai';

export const openrouter = createOpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY || '',
  headers: {
    'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
    'X-Title': 'Marketing Video AI Studio',
  },
});
```

---

## 2. API Route con Streaming (`app/api/chat/route.ts`)

Patrón estándar para generar guiones y briefs de marketing con streaming reactivo al frontend:

```typescript
// frontend/src/app/api/chat/route.ts
import { streamText } from 'ai';
import { openrouter } from '@/lib/ai/openrouter';

export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages, topic, targetAudience } = await req.json();

  const result = streamText({
    model: openrouter('anthropic/claude-3.5-sonnet'), // o google/gemini-2.5-flash
    system: `Eres un Director Creativo de Marketing digital de alto impacto.
Tu objetivo es crear guiones publicitarios para videos cortos (TikTok, Reels, Shorts)
estructurados en:
1. Gancho (0-3s): Retención inmediata.
2. Problema / Deseo (3-15s).
3. Solución & Beneficio (15-25s).
4. Llamado a la Acción (CTA) (25-30s).`,
    messages,
  });

  return result.toTextStreamResponse();
}
```

---

## 3. Tool Calling para Estructuración de Video

Para generar escenas estructuradas que luego puedan ser renderizadas o enviadas a HeyGen:

```typescript
// frontend/src/app/api/generate-script/route.ts
import { generateObject } from 'ai';
import { z } from 'zod';
import { openrouter } from '@/lib/ai/openrouter';

export const sceneSchema = z.object({
  campaignTitle: z.string(),
  scenes: z.array(
    z.object({
      sceneNumber: z.number(),
      durationSeconds: z.number(),
      hookType: z.enum(['visual', 'question', 'controversial', 'story']),
      spokenScript: z.string().describe('Texto que pronunciará el avatar o locutor'),
      visualPrompt: z.string().describe('Instrucciones visuales para el fondo o video'),
      transition: z.enum(['cut', 'dissolve', 'whip_pan', 'speed_ramp']),
    })
  ),
  heygenAvatarId: z.string().optional(),
});

export async function POST(req: Request) {
  const { brief } = await req.json();

  const { object } = await generateObject({
    model: openrouter('google/gemini-2.5-flash'),
    schema: sceneSchema,
    prompt: `Diseña una campaña de video marketing para el siguiente brief: "${brief}".`,
  });

  return Response.json(object);
}
```

---

## 4. Frontend Hook con `useChat`

Integración en cliente React para streaming visual y chat interactivo:

```tsx
'use client';

import { useChat } from '@ai-sdk/react';

export function ScriptChat() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/chat',
  });

  return (
    <div className="flex flex-col h-[500px] border rounded-xl p-4 bg-slate-900 text-white">
      <div className="flex-1 overflow-y-auto space-y-3">
        {messages.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            <span className="font-semibold text-xs text-slate-400">
              {m.role === 'user' ? 'Tú' : 'Agente Creativo'}:
            </span>
            <p className="p-2 rounded bg-slate-800 mt-1 whitespace-pre-wrap">{m.content}</p>
          </div>
        ))}
      </div>
      <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="Escribe el producto o campaña a promocionar..."
          className="flex-1 bg-slate-800 border border-slate-700 px-3 py-2 rounded text-sm"
        />
        <button
          type="submit"
          disabled={isLoading}
          className="bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded text-sm font-semibold"
        >
          {isLoading ? 'Generando...' : 'Enviar'}
        </button>
      </form>
    </div>
  );
}
```
