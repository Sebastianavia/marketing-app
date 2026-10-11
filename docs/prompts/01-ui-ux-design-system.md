# Prompt 01 — Sistema de diseño y layout (Lead UI/UX + Frontend Architect)

Estado: **pendiente de implementar** (recibido 2026-10-10). Aplicar sobre la app existente
(no partir de cero): reutilizar `ToolCard`, `StepIndicator`, `UploadZone`, `VideoPlayer`, `ShimmerLoader`,
`TitleBar`/`DesktopSidebar`, y mantener todas las herramientas y flujos reales que ya funcionan.

---

Actúa como un Lead UI/UX Designer y Frontend Architect. Genera la estructura visual, el layout y el sistema de diseño de una aplicación web de Inteligencia Artificial (Single Page Application) de nivel empresarial. La app centraliza múltiples herramientas de IA para la creación automatizada de videos de marketing. El diseño debe ser estrictamente minimalista, "high-end", con un enfoque absoluto en la usabilidad y cero fricción visual.

## Sistema de Diseño y Lenguaje Visual

* Tema: Modo oscuro premium (fondos grises antracita o negros puros) con un uso intensivo del espacio en negativo (white space) para que la interfaz "desaparezca" y el contenido audiovisual sea el protagonista.
* Acentos: Tonos sutiles (como azul eléctrico o púrpura neón) limitados estrictamente a estados activos, botones de acción principal (Generar) y retroalimentación de procesamiento de IA.
* Tipografía: Sans-serif geométrica y limpia (ej. Inter o Geist). Jerarquía visual estricta entre títulos de sección y texto de soporte.
* Elementos UI: Bordes suavemente redondeados, contenedores con un sutil efecto de cristal (glassmorphism) para los modales flotantes y transiciones fluidas de micro-interacciones (hover effects).

## Arquitectura de la Aplicación (Estructura de Vistas)

### 1. Dashboard Principal (Pantalla de Inicio)

* Top Bar Discreto: Logo a la izquierda, indicador de créditos/uso a la derecha, y un menú de perfil. Sin elementos distractores.
* Hero Section: Un título limpio (ej. "Video Marketing AI Studio") y un subtítulo breve.
* Grid Modular de Herramientas: El núcleo del inicio. Un layout de cuadrícula con tarjetas (Cards) grandes, elegantes y altamente visuales. Cada tarjeta debe tener un ícono distintivo, un título claro y una breve descripción. Al hacer hover, la tarjeta debe elevarse sutilmente.
  * Card 1: Avatar Studio. (Foto + Voz = Video Talking Head tipo HeyGen).
  * Card 2: Clonación y Reemplazo (Deep Swap). (Reemplazo de sujetos en videos mediante una foto estática).
  * Card 3: Generador UGC. (Ensamblaje y creación de contenido estilo User Generated Content para anuncios).
  * Card 4: Text-to-Video Scripts. (Transformación de guiones de marketing a video renderizado).

### 2. Espacios de Trabajo Aislados (Tool Views)

Cuando el usuario selecciona una tarjeta, la aplicación debe hacer una transición fluida hacia un "Modo de Enfoque" (Focus Mode) dedicado exclusivamente a esa herramienta, eliminando cualquier distracción del dashboard principal.

* Navegación de Retorno: Un botón minimalista en la esquina superior izquierda ("← Volver al Dashboard").
* Layout de Pantalla Dividida (Split-Screen):
  * Panel Izquierdo (Controles e Inputs): Un flujo de trabajo estructurado por pasos (Stepper). Áreas de Drag & Drop limpias para subir imágenes/videos, campos de texto expansibles para guiones o prompts, y controles deslizantes para ajustes avanzados. Al final del flujo, un botón prominente y brillante de "Generar Video".
  * Panel Derecho (Canvas de Previsualización): Un reproductor de video de alta fidelidad que ocupe el resto de la pantalla. Aquí se mostrarán los estados de carga con animaciones elegantes mientras la IA procesa, y el resultado final listo para previsualizar, descargar o exportar.

## Instrucciones Técnicas para la Generación

* Estructura la interfaz pensando en componentes reutilizables (Sidebar, ToolCard, UploadZone, VideoPlayer, StepIndicator).
* No utilices texto de relleno (Lorem Ipsum); emplea la información y los nombres de las herramientas descritas arriba para dar un contexto real.
* Asegúrate de que el diseño del "Espacio de Trabajo" se adapte fluidamente (Responsive Design), apilando el panel de controles sobre el reproductor de video en pantallas más pequeñas.
