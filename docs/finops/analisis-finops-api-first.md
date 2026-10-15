# Análisis FinOps: Modelo API-First vs. Suscripciones SaaS

**Plataforma:** Lulo Studio — Marketing AI Studio
**Fecha de corte de precios:** 10 de octubre de 2026
**Moneda:** USD, precios sin impuestos
**Audiencia:** stakeholders y planificación financiera interna

---

## Resumen ejecutivo

Lulo Studio consume IA generativa (texto, voz, video con avatar e imagen) a través de APIs de pago por uso, orquestadas desde una interfaz propia. Este documento compara ese modelo con la alternativa de pagar las suscripciones "Pro / Business" de cada herramienta para un equipo de 3 personas.

| Escenario mensual | Stack SaaS (3 usuarios) | Stack API-First | Ahorro | % |
|---|---:|---:|---:|---:|
| Mes sin producción | $348.50 | $6.00 | $342.50 | **98 %** |
| Mes bajo (20 videos, 100 audios) | $348.50 | $47.92 | $300.58 | **86 %** |
| **Mes base (100 videos, 500 audios)** | **$425.50** | **$215.62** | **$209.88** | **49 %** |
| Mes pico (300 videos, 1,500 audios) | $700.50 | $634.86 | $65.64 | **9 %** |
| **Año mixto** (4 bajos + 6 base + 2 picos) | **$5,348** | **$2,755** | **$2,593** | **48 %** |

**Conclusiones clave:**

1. En un mes típico, el modelo API-First **cuesta la mitad** que el stack SaaS equivalente, y casi nada en meses de baja actividad.
2. La ventaja es mayor cuanto más varía la demanda: el SaaS cobra la capacidad que se *reserva*; la API cobra lo que se *consume*.
3. Hay un punto donde el SaaS se acerca: **el video con avatar en volumen alto** (ver §4). Lo tratamos con transparencia porque define la estrategia de optimización.
4. El ahorro en dinero es solo una parte. La automatización del flujo ahorra **~35 horas-persona al mes** en el escenario base (§3.4), lo que el SaaS no puede ofrecer.

---

## 1. Desglose de costos oficiales por API (pago por uso)

### 1.1 Modelos de lenguaje (LLM) vía OpenRouter

Usos en Lulo Studio: guiones (`/api/openrouter/script`), copiloto "Mia", auditor de campañas "Busi".

| Modelo | Entrada / 1M tokens | Salida / 1M tokens | Entrada / 1K | Salida / 1K | Uso recomendado |
|---|---:|---:|---:|---:|---|
| Claude Haiku 5.5 | $0.10 | $0.50 | $0.0001 | $0.0005 | Clasificación, borradores, ganchos A/B masivos |
| Gemini 3.8 Flash | $0.75 | $3.75 | $0.00075 | $0.00375 | Copiloto Mia, guiones rápidos |
| Gemini 3.1 Flash Lite | $0.25 | $1.50 | $0.00025 | $0.0015 | Tareas de alto volumen y bajo valor |
| Claude Sonnet 5.5 | $2.00 | $10.00 | $0.002 | $0.010 | Guiones finales de venta |
| Gemini 3.1 Pro (preview) | $2.00 | $12.00 | $0.002 | $0.012 | Análisis largos |
| Claude Opus 5.5 | $4.00 | $20.00 | $0.004 | $0.020 | Estrategia y auditorías complejas |

> Las variantes *batch* de Claude y Gemini cuestan **50 % menos**, útiles para procesos nocturnos como generar 50 variantes de gancho.

**Costo unitario real en nuestro flujo:**

| Operación | Supuesto de tokens | Modelo | Costo por operación |
|---|---|---|---:|
| Guion de video de 30 s | 3K entrada + 1.5K salida | Sonnet 5.5 | **$0.021** |
| Mismo guion | 3K + 1.5K | Haiku 5.5 | $0.001 |
| Mensaje del copiloto Mia | 4K entrada + 0.8K salida | Gemini 3.8 Flash | **$0.006** |
| Auditoría de campaña (Busi) | 20K entrada + 3K salida | Sonnet 5.5 | **$0.07** |

### 1.2 Texto a voz (ElevenLabs)

| Modelo | Canal | Costo / 1,000 caracteres | Costo / minuto de audio* |
|---|---|---:|---:|
| Eleven v4 | **OpenRouter** | **$0.040** | ~$0.036 |
| Eleven v4 Turbo | OpenRouter | $0.020 | ~$0.018 |
| Multilingual v2 | ElevenLabs API directa | $0.080 | ~$0.072 |
| Eleven v3 | ElevenLabs API directa | $0.080 | ~$0.072 |
| Flash / Turbo | ElevenLabs API directa | $0.040 | ~$0.036 |

\* Supuesto: ~900 caracteres por minuto de locución en español (~150 palabras/min).

- **Audio de 30 s (~450 caracteres) con v4 vía OpenRouter: $0.018.**
- **Clonación de voz (IVC):** requiere como mínimo el plan **Starter de ElevenLabs ($6/mes)**. Es el único costo fijo de nuestro stack y está incluido en todos los cálculos.
- **Hallazgo de optimización:** v4 vía OpenRouter cuesta **la mitad** que Multilingual v2 en la API directa. Conviene migrar el TTS por defecto.

### 1.3 Video con avatar (HeyGen Avatar IV)

| Canal | Costo / segundo | Costo / minuto | Video de 30 s |
|---|---:|---:|---:|
| **OpenRouter `heygen/avatar-iv`** (nuestra ruta actual) | **$0.05** | **$3.00** | **$1.50** |
| API directa de HeyGen (pay-as-you-go) | $0.10 | $6.00 | $3.00 |
| Creación de Photo Avatar / Digital Twin (API directa) | $1 por avatar, único | — | — |

- La API directa de HeyGen funciona con monedero prepago desde $5, sin suscripción y con 10 trabajos concurrentes.
- **Hallazgo:** enrutar por OpenRouter cuesta **50 % menos** que la API directa de HeyGen. El cliente legacy `services/heygen.service.ts` y el flujo UGC (que todavía llama a `/api/heygen/generate`) deberían migrarse a OpenRouter.

**Modelos de video complementarios** (catálogo `ugc-models.config.ts`, sincronizado con precios en vivo):

| Modelo | Proveedor | $/s | Clip de 5 s | Uso |
|---|---|---:|---:|---|
| Seedance 1.5 Pro | OpenRouter | $0.023 | $0.12 | Ganchos y pruebas A/B baratas |
| Wan 2.6 | OpenRouter | $0.040 | $0.20 | B-roll de producto |
| Seedance 2.0 Fast | OpenRouter | $0.040 | $0.20 | Creador sintético recurrente |
| MiniMax Hailuo 2.3 | APIMart | $0.049 | $0.24 | Testimonios realistas |
| Seedance 2.0 | APIMart | $0.066 | $0.33 | UGC vertical |
| Kling v3 Omni | APIMart | $0.067 | $0.34 | Interacción con producto |

### 1.4 Generación de imágenes, Canva y Busi

| Recurso | Canal | Precio oficial | Costo estimado por imagen* |
|---|---|---|---:|
| Nano Banana (Gemini 2.5 Flash Image) | OpenRouter | $30 / 1M tokens de salida | ~$0.039 |
| Nano Banana 2 Lite | OpenRouter | $30 / 1M tokens de salida | ~$0.039 |
| **Nano Banana 2 (Gemini 3.1 Flash Image)** | OpenRouter | $60 / 1M tokens de salida | **~$0.077** |
| Nano Banana Pro (Gemini 3 Pro Image) | OpenRouter | $120 / 1M tokens de salida | ~$0.155 |

\* Estimado con ~1,290 tokens de salida por imagen de ~1024 px. OpenRouter factura por token, así que el costo real varía con la resolución.

- **Canva:** la Connect API no tiene tarifa por llamada. Sin embargo, las funciones de automatización que nos servirían (Autofill y Brand Templates) están reservadas a **Canva Enterprise**, que solo se vende por cotización. Por eso generamos las imágenes por API y dejamos Canva como herramienta opcional de retoque manual. *(Verificar con Canva antes de presupuestar Enterprise.)*
- **Busi:** es un módulo interno de Lulo Studio (hoy en demo), no un proveedor externo. Su costo es solo el de los tokens del LLM: unos **$0.07 por auditoría** con Sonnet 5.5, o menos de $0.01 con Haiku 5.5.

### 1.5 Infraestructura de soporte

| Servicio | Uso | Costo |
|---|---|---|
| Cloudinary | URLs públicas temporales para retratos y audio | $0 en el plan gratuito al volumen actual (verificar créditos mensuales) |
| Disco local | Almacenamiento de proyectos | $0 |
| Hosting | App de escritorio / localhost | $0 |

---

## 2. Comparativa: modelo API vs. suscripciones SaaS directas

### 2.1 Escenario base (un mes típico)

**Supuestos de volumen:**

| Partida | Volumen |
|---|---|
| Videos con avatar de 30 s | 100 (= 50 minutos de Avatar IV) |
| Audios de locución (~500 caracteres) | 500 |
| Locución para los videos (~450 caracteres) | 100 |
| Total de caracteres TTS | 295,000 |
| Imágenes generadas | 300 |
| Guiones y copys (LLM) | 600 generaciones |
| Mensajes del copiloto | 2,000 |
| Personas en el equipo | 3 |

### 2.2 Costo vía API (pago por uso)

| Partida | Cálculo | Costo |
|---|---|---:|
| Guiones (Sonnet 5.5) | 600 × $0.021 | $12.60 |
| Copiloto Mia (Gemini 3.8 Flash) | 2,000 × $0.006 | $12.00 |
| TTS (Eleven v4 vía OpenRouter) | 295K caracteres × $0.04/1K | $11.80 |
| ElevenLabs Starter (clonación de voz) | Fijo | $6.00 |
| Video con avatar (Avatar IV vía OpenRouter) | 3,000 s × $0.05 | $150.00 |
| Imágenes (Nano Banana 2) | 300 × ~$0.077 | $23.22 |
| Asientos adicionales | 3 usuarios × $0 | $0.00 |
| **Total API** | | **$215.62** |

### 2.3 Costo vía suscripciones SaaS (3 usuarios)

| Herramienta | Plan necesario | Por qué ese plan | Costo |
|---|---|---|---:|
| ChatGPT | Business, 3 × $25/mes (mínimo 2) | Uso comercial en equipo | $75.00 |
| ElevenLabs | Pro ($99, 600K créditos) | 295K caracteres superan Creator (121K) | $99.00 |
| HeyGen | Business ($149) + 2 asientos × $20 | 50 min × 20 créditos/min = 1,000 créditos, multiusuario | $189.00 |
| Canva | Business, 3 × $250/año ÷ 12 | Imágenes y plantillas (créditos de IA incluidos) | $62.50 |
| **Total SaaS** | | | **$425.50** |

> **Supuestos favorables al SaaS:** comparamos contra ChatGPT Business y no contra Claude Team, que exige mínimo 5 asientos ($125/mes). En ElevenLabs suponemos una sola cuenta Pro compartida; con asientos individuales haría falta Scale ($299, 3 asientos), y el total SaaS subiría a **$625.50**. También suponemos que los créditos de IA de Canva alcanzan para las 300 imágenes.

### 2.4 Resultado del escenario base

| | SaaS | API | Diferencia |
|---|---:|---:|---:|
| Mensual | $425.50 | $215.62 | **−$209.88 (−49 %)** |
| Anualizado | $5,106 | $2,587 | **−$2,519** |

### 2.5 Sensibilidad por volumen

| Partida | Mes bajo (API) | Mes base (API) | Mes pico (API) |
|---|---:|---:|---:|
| Videos de 30 s / audios / imágenes | 20 / 100 / 60 | 100 / 500 / 300 | 300 / 1,500 / 900 |
| LLM (guiones + copiloto) | $4.92 | $24.60 | $73.80 |
| TTS + Starter | $8.36 | $17.80 | $41.40 |
| Video Avatar IV | $30.00 | $150.00 | $450.00 |
| Imágenes | $4.64 | $23.22 | $69.66 |
| **Total API** | **$47.92** | **$215.62** | **$634.86** |
| **Total SaaS** | **$348.50** | **$425.50** | **$700.50** |

En el mes bajo, el SaaS baja ElevenLabs a Creator ($22). En el pico sube a Scale ($299) y compra 5 paquetes de créditos de HeyGen ($75).

**Escalamiento por equipo:** si el equipo pasa de 3 a 6 personas, el stack SaaS sube unos **$197/mes** (ChatGPT +$75, HeyGen +$60, Canva +$62.50). El stack API sube **$0**.

---

## 3. Justificación estratégica

### 3.1 Eficiencia de capital: pagamos solo lo que se consume

Una suscripción es un **costo fijo disfrazado de herramienta**: se cobra igual se use al 100 % o al 5 %. En nuestro modelo, cada dólar corresponde a un artefacto producido: un segundo de video, mil caracteres de voz o un millón de tokens.

- **Mes sin producción:** el SaaS sigue facturando **$348.50**; la API factura **$6** (solo el Starter de ElevenLabs).
- **Costo unitario trazable:** la app ya calcula el costo final de cada render (`pricing.service.ts`). Esto permite fijar precio por pieza a clientes con márgenes conocidos, algo que un plan plano no permite saber.
- **Sin créditos que caducan:** los créditos de HeyGen y ElevenLabs que no se usan se pierden o solo pasan a un ciclo más. El saldo prepago de una API no caduca por ciclo.

### 3.2 Sin cuellos de botella por asientos

Cada herramienta SaaS cobra por persona: ChatGPT $25, HeyGen $20 por asiento extra, Canva $20.83, Claude Team con mínimo de 5 asientos. Cinco herramientas multiplicadas por N personas dan un costo que crece con la plantilla, no con la producción.

En Lulo Studio, **las claves de API viven en el servidor** (rutas `app/api/**`) y cualquier persona del equipo usa todas las capacidades desde una sola interfaz. Sumar un editor, un practicante o un freelance cuesta **$0 en licencias**. Además, se acaba el problema de compartir contraseñas de una cuenta "Pro" entre varias personas, que suele violar los términos de servicio.

### 3.3 Escalabilidad sin fricción

| Situación | Stack SaaS | Stack API-First |
|---|---|---|
| Mes sin contenido | Factura completa | Factura ≈ $0 |
| Pico de campaña (3× volumen) | Subir de plan en 2–4 apps, comprar paquetes de créditos, esperar el ciclo | La API absorbe el volumen sin cambios de configuración |
| Cambio de proveedor | Cancelar, migrar cuentas, perder créditos | Cambiar un ID de modelo en `ugc-models.config.ts` |
| Nuevo modelo más barato | Esperar a que la app lo incorpore | Disponible en OpenRouter el día de su lanzamiento |

La arquitectura multiproveedor (OpenRouter + APIMart + Gemini + ElevenLabs) también nos **protege del lock-in**. Por ejemplo, podemos pasar los ganchos de prueba de Hailuo ($0.049/s) a Seedance 1.5 Pro ($0.023/s) y gastar un 53 % menos por clip, sin cambiar la experiencia del equipo.

### 3.4 Propiedad del flujo de trabajo: automatización y horas-persona

Con apps separadas, producir un video implica: escribir el guion en ChatGPT, copiarlo a ElevenLabs, descargar el MP3, subirlo a HeyGen junto con la foto, esperar, descargar el video, generar imágenes en Canva y organizar los archivos a mano. **Lulo Studio hace todo esto en un solo flujo:** foto → Cloudinary → TTS → render → polling → proyecto guardado en disco, con costo calculado.

**Estimación de tiempo ahorrado (escenario base):**

| Tarea | Volumen | Minutos ahorrados por unidad* | Horas/mes |
|---|---:|---:|---:|
| Video con avatar | 100 | 8 | 13.3 |
| Audio de locución | 500 | 2 | 16.7 |
| Imagen | 300 | 1 | 5.0 |
| **Total** | | | **~35 h** |

\* Supuesto interno: tiempo de copiar, pegar, descargar, subir y renombrar entre apps. Conviene validarlo midiendo una semana de trabajo real.

Con un costo de referencia de **$12 por hora-persona**, son unos **$420/mes adicionales de valor recuperado**. Sumado al ahorro directo, el beneficio total del escenario base ronda los **$630/mes**. Además, el flujo propio permite cosas que las apps separadas no ofrecen: generar variantes A/B en lote, inyectar guiones desde el copiloto, tener una biblioteca de proyectos unificada y llevar control de costos por pieza.

---

## 4. Dónde el SaaS compite y cómo lo manejamos

Un análisis serio debe mostrar dónde la tesis es más débil. Aquí está:

**El video Avatar IV en volumen alto.** En el plan web de HeyGen, Avatar IV consume 20 créditos por minuto. El plan Business incluye 1,500 créditos (75 min) por $149, y los paquetes extra cuestan $15 por 300 créditos, es decir, **~$1 por minuto marginal**. Por API, el minuto cuesta **$3** (vía OpenRouter).

- **Punto de equilibrio:** con un equipo de 3 personas ($189 fijos en HeyGen Business), la API es más barata **por debajo de ~63 minutos de avatar al mes** (unos 126 videos de 30 s). Por encima de ese volumen, el plan web gana en ese rubro específico.
- **Límite del plan web:** sus créditos no se pueden consumir desde nuestra app por API directa (la API usa un saldo aparte). Habría que volver al flujo manual, con lo que se pierden las ~13 h/mes de automatización del video.

**Estrategia recomendada:**

1. **Mantener API-First por defecto.** Incluso en el mes pico, el stack completo sigue siendo más barato ($634.86 frente a $700.50).
2. **Revisar el umbral cada trimestre:** si el volumen sostenido supera ~150 minutos de avatar al mes, negociar con HeyGen **Enterprise API** (incluye "discounted rates") en lugar de pasar al plan web.
3. **Mover los clips que no necesitan lip-sync a modelos más baratos** (Seedance 1.5 Pro a $0.023/s, Wan 2.6 a $0.04/s), y reservar Avatar IV para los voceros que hablan a cámara.

---

## 5. Recomendaciones FinOps accionables

| # | Acción | Impacto estimado |
|---|---|---|
| 1 | Migrar el TTS por defecto de Multilingual v2 (directa, $0.08/1K) a **Eleven v4 vía OpenRouter ($0.04/1K)** | −50 % en voz |
| 2 | Migrar el flujo UGC y `heygen.service.ts` de la API directa de HeyGen ($0.10/s) a **OpenRouter ($0.05/s)** | −50 % en video con avatar |
| 3 | **Enrutar LLM por tarea:** Haiku 5.5 para borradores y variantes, Sonnet 5.5 solo para el guion final | −60–90 % en tokens |
| 4 | Usar **batch** (−50 %) para generaciones masivas no urgentes | −50 % en esos lotes |
| 5 | Agregar topes de presupuesto mensual por proveedor y alertas en `pricing.service.ts` | Evita sorpresas |
| 6 | Quitar los fallbacks de assets falsos (`ugc-dispatcher`) y el mock silencioso de `openrouter-video.service.ts` | Evita gastar créditos en renders inválidos |
| 7 | Reemplazar los créditos fijos de la UI (`2450`) por el saldo real de cada proveedor | Visibilidad del gasto |

---

## 6. Metodología y supuestos

- Los precios se tomaron el 10/10/2026 de las páginas oficiales de precios de OpenRouter, ElevenLabs, HeyGen y Canva. Para los planes de ChatGPT y Claude se usó un comparativo de terceros (junio de 2026), que debe validarse en los sitios oficiales antes de comprar.
- Los precios de APIMart y de los modelos de video secundarios vienen del catálogo interno `src/config/ugc-models.config.ts`, que se sincroniza con tarifas en vivo de OpenRouter.
- Los precios de IA bajan con frecuencia. **Recomendamos recalcular este análisis cada trimestre.** Los volúmenes del escenario son ilustrativos y deben reemplazarse por la telemetría real de la app.
- Las cifras de tokens por operación, caracteres por audio y minutos ahorrados son supuestos de planificación, no mediciones.
- Este documento es un análisis operativo, no asesoría financiera ni contable.

### Fuentes

- [OpenRouter — modelos de Anthropic](https://openrouter.ai/anthropic)
- [OpenRouter — modelos de Google](https://openrouter.ai/google)
- [OpenRouter — HeyGen Avatar IV](https://openrouter.ai/heygen/avatar-iv)
- [OpenRouter — catálogo de modelos (Eleven v4)](https://openrouter.ai/models)
- [ElevenLabs — precios de la API](https://elevenlabs.io/pricing/api)
- [ElevenLabs — planes](https://elevenlabs.io/pricing)
- [HeyGen — precios de la API (developers)](https://developers.heygen.com/docs/pricing)
- [HeyGen — precios de la API](https://www.heygen.com/api-pricing)
- [HeyGen — planes web](https://www.heygen.com/pricing)
- [Arcade — HeyGen pricing 2026 (créditos de Avatar IV)](https://www.arcade.software/post/heygen-pricing)
- [Creatify — HeyGen pricing 2026](https://creatify.ai/blog/heygen-pricing-(2026)-plans-and-what-you-ll-actually-pay)
- [Canva — precios](https://www.canva.com/pricing/)
- [Morph — ChatGPT vs Claude pricing 2026](https://www.morphllm.com/chatgpt-vs-claude)
