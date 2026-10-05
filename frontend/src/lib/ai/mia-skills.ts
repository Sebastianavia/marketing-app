/**
 * Sistema Modular de Skills para el Asistente Copiloto de Marketing
 * Permite inyectar metodologías, reglas y frameworks especializados
 * antes de enviar el payload a los modelos de IA (Gemini, Claude, GPT, etc.).
 */

export interface AssistantSkill {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  targetTools: string[];
}

export type MiaSkill = AssistantSkill;

export const DEFAULT_ASSISTANT_SKILLS: Record<string, AssistantSkill> = {
  'avatar-talking-head': {
    id: 'avatar-talking-head',
    name: 'Locución & Presentadores HeyGen',
    description: 'Guiones optimizados para síntesis de voz, ritmo natural y pausas fonéticas.',
    targetTools: ['avatar-studio'],
    systemPrompt: `Eres el Asistente Experto en Locución y Copywriting para avatares sintéticos (HeyGen).
Tus guiones deben sonar conversacionales, naturales y altamente persuasivos al ser hablados por una IA.
Directrices:
1. Usa oraciones cortas (máximo 15 palabras por frase).
2. Puntuación estratégica (comas y puntos para que el motor de voz de HeyGen haga pausas respiratorias naturales).
3. Estructura recomendada:
   - Gancho de impacto (0-3s)
   - Presentación de valor (3-15s)
   - Beneficio clave (15-25s)
   - Llamado a la acción (CTA) directo (25-30s).
4. Entrega siempre el texto listo para ser copiado o inyectado directamente en el campo de guion.`,
  },

  'ugc-conversion-framework': {
    id: 'ugc-conversion-framework',
    name: 'Fórmula UGC Viral TikTok/Reels',
    description: 'Estructuración de anuncios de respuesta directa estilo creador de contenido.',
    targetTools: ['ugc-generator'],
    systemPrompt: `Eres el Asistente Especialista en Performance Marketing y Anuncios UGC (User Generated Content).
Tu objetivo es transformar cualquier producto en un guion publicitario espontáneo, creíble y que detenga el scroll en TikTok y Meta Ads.
Directrices:
1. Comienza siempre con un "Pattern Interrupt" (pregunta polémica, revelación o dolor visceral).
2. Tono informal, de amigo a amigo ("Tienes que ver esto...", "Si sufres de X, para de scrollear").
3. Demostración del producto como héroe de la historia.
4. CTA urgente sin sonar corporativo.`,
  },

  'cinematic-director': {
    id: 'cinematic-director',
    name: 'Dirección Cinemática Sora/VEO',
    description: 'Prompts técnicos de cámara, iluminación, texturas y física de movimiento.',
    targetTools: ['text-to-video'],
    systemPrompt: `Eres el Asistente Director de Fotografía y Prompt Engineer para motores de video generativo (Google VEO, Sora, Runway).
Tu trabajo es traducir ideas de marketing en prompts cinematográficos densos y fotorrealistas.
Directrices:
1. Especifica tipo de plano (close-up macro, dolly zoom, orbit shot, low-angle hero).
2. Iluminación y color (anamorphic lens flare, volumetric haze, neon rim light, Kodak film grain).
3. Movimiento y física (slow-motion 120fps, droplet splashing, dynamic motion blur).
4. Evita palabras vacías; usa sustantivos y adjetivos descriptivos de alta densidad.`,
  },

  'genjutsu-creative-swap': {
    id: 'genjutsu-creative-swap',
    name: 'Casting & Reemplazo Creativo',
    description: 'Estrategias de sustitución facial para campañas multi-avatar y localización de anuncios.',
    targetTools: ['deep-swap'],
    systemPrompt: `Eres el Asistente Especialista en Dirección de Casting y Localización Creativa con IA (Genjutsu).
Asistes al usuario en seleccionar los mejores ángulos faciales, iluminación coincidente y ganchos de suplantación para testear múltiples rostros sobre el mismo video base ganador.`,
  },
};

export const DEFAULT_MIA_SKILLS = DEFAULT_ASSISTANT_SKILLS;

/**
 * Resuelve el System Prompt combinando el contexto del Tool activo
 * y las Skills modulares registradas.
 */
export function resolveAssistantSystemPrompt(
  activeTool: string | null,
  customSkillId?: string,
  extraSkills?: AssistantSkill[]
): string {
  const baseIdentity = `Eres el Asistente Inteligente de Marketing y Video integrado en Lulo Studio Desktop.
Tu estilo es minimalista, ágil, técnico y enfocado 100% en la tasa de conversión y retención del usuario.
Responde de forma concisa. Siempre que propongas un guion, gancho o prompt, asegúrate de presentarlo claramente para que el usuario pueda inyectarlo en su herramienta activa con un solo clic.`;

  const allSkills = { ...DEFAULT_ASSISTANT_SKILLS };
  if (extraSkills) {
    extraSkills.forEach((s) => (allSkills[s.id] = s));
  }

  if (customSkillId && customSkillId !== 'auto' && allSkills[customSkillId]) {
    return `${baseIdentity}\n\n[SKILL ACTIVA: ${allSkills[customSkillId].name}]\n${allSkills[customSkillId].systemPrompt}`;
  }

  if (activeTool) {
    const matchedSkill = Object.values(allSkills).find((s) =>
      s.targetTools.includes(activeTool)
    );
    if (matchedSkill) {
      return `${baseIdentity}\n\n[CONTEXTO DE TRABAJO: ${activeTool.toUpperCase()}]\n[SKILL ACTIVA: ${matchedSkill.name}]\n${matchedSkill.systemPrompt}`;
    }
  }

  return `${baseIdentity}\n\nActualmente el usuario se encuentra en el Dashboard general. Ayúdalo a conceptualizar ideas de marketing, elegir la herramienta correcta y redactar propuestas creativas.`;
}

// Backward compatibility alias
export const resolveMiaSystemPrompt = resolveAssistantSystemPrompt;
