'use client';

import React from 'react';
import type { EditProject } from '@/lib/editor/types';
import { ClaudeAgentChat } from '@/components/claude/ClaudeAgentChat';
import { uploadAttachments } from '@/components/material/material-api';

/**
 * Chat con Claude dentro de una edición. Claude (Claude Code con la suscripción de la persona)
 * cambia el estilo y el guion con las herramientas de Lulo, renderiza con el motor y, si el
 * motor no alcanza, trabaja con FFmpeg/Python y publica su propia versión del borrador.
 */

const SUGGESTIONS = [
  'Subtítulos más grandes y en el centro',
  'Hazlo más dinámico: menos pausas y más zoom',
  'Quita la música',
  'Ponle un look cinematográfico (color cálido y viñeta)',
];

const STEP_NAMES: Record<string, string> = {
  'lulo: ver_edicion': 'Mirando la edición',
  'lulo: ver_feedback': 'Leyendo el feedback del equipo',
  'lulo: tomar_feedback': 'Descargando los cambios que pidió el equipo',
  'lulo: responder_feedback': 'Respondiendo al equipo en Feedback',
  'lulo: palabras_borrador': 'Leyendo los tiempos de cada palabra',
  'lulo: escuchar_audio': 'Escuchando el audio',
  'lulo: cambiar_perfil': 'Cambiando el estilo',
  'lulo: cambiar_guion': 'Ajustando el guion',
  'lulo: planear_graficos': 'Planeando los gráficos',
  'lulo: renderizar': 'Armando el video con el motor',
  'lulo: esperar_render': 'Esperando el render',
  'lulo: publicar_borrador': 'Publicando la nueva versión',
  'lulo: catalogo_edicion': 'Mirando efectos, música y recursos',
  'lulo: dirigir_edicion': 'Dirigiendo la edición (cámara, sonido, música, gráficos)',
  'lulo: revisar_html_video': 'Revisando la animación (HyperFrames)',
  'lulo: renderizar_html_video': 'Renderizando la animación (HyperFrames)',
};

export function ClaudeEditChat({
  edit,
  onChanged,
  onWorkingChange,
  fill = false,
}: {
  edit: EditProject;
  onChanged: () => void;
  onWorkingChange?: (working: boolean) => void;
  /** Ocupa todo el alto de su contenedor (al lado del video). */
  fill?: boolean;
}) {
  return (
    <ClaudeAgentChat
      endpoint={`/api/editor/projects/${edit.id}/claude`}
      mensajes={edit.claude?.mensajes ?? []}
      onChanged={onChanged}
      title="Claude · editor"
      intro="Pídele cualquier cambio. Usa tu suscripción de Claude ($0 extra); cada versión que haga aparece arriba como borrador para que la apruebes."
      suggestions={SUGGESTIONS}
      placeholder="Ej.: pon el video en blanco y negro y los subtítulos en amarillo"
      stepNames={STEP_NAMES}
      refreshOnStep
      materialKey={`edit:${edit.id}`}
      onWorkingChange={onWorkingChange}
      fill={fill}
      onAttach={(files) => uploadAttachments(`/api/editor/projects/${edit.id}/files`, files)}
    />
  );
}
