'use client';

import React, { useState } from 'react';
import { Check, Copy, Download, FileText, X } from 'lucide-react';

export const TEMPLATE_MARKDOWN = `# 📋 GUÍA DE MARCA Y ESTÁNDAR DE EDICIÓN DE VIDEO

Usa esta plantilla para tu documento (PDF, Word o Markdown). La inteligencia artificial leerá estos datos para importar automáticamente tu Marca y tu Estilo de Edición en Lulo Studio.

---

## 1. IDENTIDAD DE LA MARCA
- **Nombre de la marca / creador:** Mi Marca
- **Lema o eslogan:** Educación y transformación digital
- **Usuario en redes sociales:** @mimarcadigital
- **Llamada a la acción (CTA) para el cierre:** «Síguenos y comenta GUÍA para empezar»
- **Notas o directrices generales:** Estilo directo, profesional y cercano.

---

## 2. COLORES OFICIALES (Códigos HEX)
- **Color primario (fondo o dominante):** #0B0B0B (Negro profundo)
- **Color de acento (énfasis y destacados):** #C6FF3D (Lima neón)
- **Color de texto legible:** #FFFFFF (Blanco puro)
- *(Opcional) Color de fondo de tarjetas:* #160A26

---

## 3. TIPOGRAFÍAS Y TAMAÑOS DE LETRA
*(Puedes usar cualquier fuente de Google Fonts o instalada en tu sistema)*

### A. Subtítulos
- **Tipo de letra (fuente):** Montserrat (o Archivo Black, Inter, Poppins, Sora, Oswald)
- **Tamaño de letra:** 75 px (Rango recomendado: 60 px a 95 px para lienzo vertical 1080x1920)
- **Mayúsculas sostenidas:** Sí (MAYÚSCULAS)
- **Estilo de subtítulos:** Karaoke (la palabra que suena se pinta con el color de acento)
  *(Opciones: Karaoke | Palabra por palabra | Pop viral | Frase fija | Caja activa)*
- **Posición:** Abajo (o «Bajo el mentón» para reels)
- **Color de texto principal:** #FFFFFF
- **Color de la palabra resaltada:** #C6FF3D
- **Sombra o contorno:** Sombra suave desenfocada sin borde grueso
- **Caja de fondo:** No (o Sí con color #000000 al 80% de opacidad)

### B. Gancho Inicial (Primeros 3 segundos)
- **Tipo de letra:** Archivo Black
- **Tamaño de letra:** 85 px
- **Color del texto:** #FFFFFF
- **Color de fondo del gancho:** #F4581C (o el color de acento de tu marca)
- **Duración en pantalla:** 3 segundos

### C. Cifras y Gráficos de Impacto
- **Tipo de letra:** Impact (o Anton)
- **Ubicación:** Texto gigante detrás o delante del presentador

---

## 4. REGLAS DE EDICIÓN Y RITMO
- **Corte de pausas:** Recortar silencios mayores a 0.35 segundos.
- **Errores y muletillas:** Eliminar falsos comienzos, repeticiones y "ehhh".
- **Efecto de dinamismo (Jump Cut):** Acercamiento (zoom) del 10% en cada corte de frase.
- **Duración objetivo:** Menos de 60 segundos por video.
- **Normalización de volumen:** Sí (-14 LUFS para Instagram y TikTok).

---

## 5. AUDIO Y MÚSICA
- **Voz:** Limpiar ruido de fondo y ecualizar presencia.
- **Música de fondo:** Lo-fi suave (o synth pop enérgico) 18 dB por debajo de la voz.
- **Ducking de música:** Bajar 6 dB automáticamente mientras la persona habla.
- **Efectos de sonido:** Whoosh suave en transiciones y golpe sutil en la entrada del gancho.

---

## 6. SOBRE TI Y TU NEGOCIO (Contexto para la IA)
- **¿Quién eres y qué vendes?** Ayudamos a negocios y creadores a escalar su contenido con IA.
- **Público objetivo:** Emprendedores y creadores en Latinoamérica de 22 a 45 años.
- **Tono de comunicación:** Cercano, con autoridad, sin rodeos, usando ejemplos prácticos.
`;

export function DocumentTemplateModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(TEMPLATE_MARKDOWN);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([TEMPLATE_MARKDOWN], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'plantilla-guia-estilo-y-marca.md';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="relative flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl border border-line bg-surface p-6 shadow-2xl">
        <div className="flex items-start justify-between border-b border-line pb-4">
          <div>
            <h3 className="flex items-center gap-2 text-[16px] font-semibold text-fg">
              <FileText className="h-5 w-5 text-accent" /> Plantilla de Documento para Importar
            </h3>
            <p className="mt-1 text-[12px] text-fg-muted">
              Pasa esta guía a tus clientes o utilízala para tu PDF / Word. La IA identificará automáticamente la tipografía, tamaños, colores y reglas.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-fg-subtle hover:bg-surface-hover hover:text-fg"
            aria-label="Cerrar modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="my-4 flex-1 overflow-y-auto rounded-xl border border-line bg-surface-sunken p-4 font-mono text-[12px] text-fg-muted leading-relaxed">
          <pre className="whitespace-pre-wrap">{TEMPLATE_MARKDOWN}</pre>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <span className="text-[11px] text-fg-subtle">
            Tip: Puedes exportar este texto a PDF o subirlo directamente como archivo .txt o .md.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="btn-secondary h-8 px-3 text-[12px]"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-accent" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? '¡Copiado!' : 'Copiar plantilla'}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="btn-primary h-8 px-3 text-[12px]"
            >
              <Download className="h-3.5 w-3.5" /> Descargar .md
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

