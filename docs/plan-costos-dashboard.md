# Plan: rediseño del dashboard de Costos

Fuente: documento "Costos — rediseño del dashboard" (26 oct 2026). Se implementa cuando el usuario lo indique.
Archivo actual: `frontend/src/components/costs/CostsView.tsx`; datos de `GET /api/usage?month=AAAA-MM` (`UsageEvent`: createdAt, person, tool, kind, provider, model, description, units, unit, costUSD, estimated, filePath, jobId, productionId, status). No se cambia cómo se registra cada cobro; solo la pantalla (y leer también el mes anterior).

## Objetivo
Responder de un vistazo: ¿cómo voy este mes? ¿en qué se va el dinero? ¿cuánto costó cada video?

## Pantalla (de arriba abajo)
1. Cabecera: mes elegido, persona, Exportar CSV (como hoy).
2. 4 tarjetas:
   - Hoy: suma del día + barra contra límite diario + "te quedan $X".
   - Este mes: suma + diferencia % contra el mismo día del mes anterior.
   - Cierre estimado: gasto diario promedio × días del mes (marcado como estimación).
   - Costo por video: promedio de producciones/videos terminados del mes.
   - El límite diario editable se mantiene (dentro de Hoy o en la cabecera).
3. Gasto por día: barras por día apiladas por herramienta + línea del límite diario; clic en un día → la tabla salta a ese día.
4. En qué se va: barras ordenadas con % del total; selector Herramienta / Proveedor / Modelo.
5. Videos más caros: suma por productionId (o jobId); top 5 con enlace a su tarjeta en Proyectos.
6. Gratis y sin cobrar: nº de tareas con Gemini gratis (registros a $0) e intentos fallidos no cobrados.
7. Registro: tabla actual agrupada por día + búsqueda + filtros (herramienta, proveedor, tipo, estado); "estimado" como etiqueta visible.

Colores: un color fijo por herramienta en todos los bloques; claro/oscuro; seguir la skill de gráficos (dataviz). Dólares con 2 decimales (4 para centavos).

## Fases (ambas $0)
1. Tarjetas nuevas + gráfico por día + "En qué se va". Prueba: con datos reales de octubre, totales iguales a los actuales y al CSV.
2. Videos más caros + Gratis y sin cobrar + búsqueda/filtros + clic en día. Prueba: la producción "Prueba Santiago" ≈ $0.20 coincide.

## Decisiones pendientes
- Cuándo hacerlo.
- Equipo: cada PC ve solo su gasto; ¿resumen del equipo importando CSV de los demás?
- ¿Presupuesto mensual además del diario, con aviso?
- ¿Mostrar también en pesos colombianos con tasa manual?
