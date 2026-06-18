# Auditoría de punta a punta — StockMerger + StockVendedor

> **Estado (2026-06-09)**: primera tanda de remediación implementada en la
> rama `claude/app-audit-improvements-rghqv4` de ambos repos. Ver §5 al final:
> qué quedó resuelto, qué falló como falso positivo y qué sigue pendiente.

> Fecha: 2026-06-09. Alcance: ambos repos (`stockmerger`, `stockvendedor`),
> contrato compartido (`vendor_data_v2`, `orders`, `_key`), Supabase,
> service workers, build y deploy. Los números de línea son de la fecha de
> la auditoría; si no cuadran, reubicar con `Grep`.

---

## 1. Resumen ejecutivo

El sistema está **bien estructurado y es defensivo en general**: la
normalización `_key` es idéntica en ambas apps, el contrato
`vendor_data_v2` está bien apareado en los dos extremos (con
retro-compatibilidad v1), la idempotencia de pedidos por `(ns, order_id)`
está bien diseñada, y el canal manual por Excel (`_meta`) coincide
perfectamente entre apps.

Los problemas reales se concentran en **4 frentes**:

1. **Seguridad de la nube**: las policies RLS son `using (true)` — el
   aislamiento por `ns` es solo un filtro del lado cliente. Cualquiera con
   la anon key (que está en el código de cada vendedor) puede leer/escribir
   el catálogo y los pedidos de **cualquier** tienda.
2. **XSS**: ambas apps interpolan datos remotos (claves de producto,
   pedidos) en handlers `onclick` con un escape insuficiente (solo comillas).
3. **Integridad / pérdida de datos**: no hay `beforeunload` que haga flush
   del write-behind de IndexedDB ni de las colas; la confirmación de pedido
   no es atómica con el guardado (riesgo de doble descuento o de descuento
   no persistido); promesas async críticas quedan flotando sin `catch`.
4. **Infraestructura**: `supabase-js` se carga del CDN sin versión fijada y
   sin SRI; no existe un `schema.sql` que documente las constraints de las
   que depende la idempotencia.

---

## 2. Hallazgos consolidados

### 🔴 Críticos

| # | Dónde | Hallazgo |
|---|---|---|
| C1 | ~~Supabase (ambas apps)~~ | ✅ **RESUELTO (2026-06-13)**: implementado acceso por persona con Supabase Auth + RLS real por rol. Cada usuario tiene email/contraseña y un rol (`central`/`vendor`) en la tabla `user_stores`; las policies consultan ese rol con el helper `store_role()`. Sin sesión iniciada la anon key ya no abre la base. Verificado por rol (anon no ve nada; vendedor solo lee catálogo e inserta pedidos; central ve todo). Ver `schema.sql` (sección AUTH + RLS) y la sección "Conexión con la nube" de los CLAUDE.md. |
| C2 | merger `UI.JS` ~5537; vendedor `UI.JS` 3927, 4073 | **XSS en `onclick`**: patrón `safeKey = s._key.replace(/'/g, "\\'")` interpolado en `onclick="fn('${safeKey}')"`. Una clave tipo `x\');alert(1);//` rompe el string (el escape de comilla simple no cubre backslash ni contexto HTML). Los datos vienen de la nube (catálogo/pedidos) → ejecutable en todos los dispositivos. **Fix**: eliminar onclick inline → `data-key` + event delegation, o escapar para contexto HTML+JS completo. |
| C3 | merger `ORDERS.JS` 9647–9780 | **Confirmación de pedido no atómica**: el guard `status === 'confirmado'` es solo en memoria del tab. Dos pestañas con el mismo pedido pendiente pueden descontar stock dos veces; y si `saveMerged()` falla (cuota), el pedido queda `confirmado` sin que el descuento persista. **Fix**: lock cross-tab (BroadcastChannel/StorageEvent), y marcar `confirmado` solo después de que ambos saves se completen (patrón snapshot → descuento → marca). |
| C4 | merger `STORE.JS` 3329–3343; vendedor global | **Sin `beforeunload`**: el flush de IndexedDB es debounced 300 ms y `flushNow()` solo corre en `visibilitychange`/`online`; las promesas de `flushNow()` ni se esperan. Cerrar la pestaña justo después de confirmar/enviar puede perder la escritura. **Fix**: `window.addEventListener('beforeunload', () => Store.flushNow())` en merger; flush de `saveOrders()`/`saveCurrentOrder()` en vendedor. |

### 🟠 Altos

| # | Dónde | Hallazgo |
|---|---|---|
| A1 | merger 12017–12022, 9007, 9222; vendedor 4294 | **Promesas flotantes** en rutas críticas: `srFlush()`, `srPullAll()`, `publishCatalog({auto})`, `pullOrders({silent})`, `pushOrderSafe(order)` sin `await` ni `.catch()`. Errores tragados en silencio. |
| A2 | vendedor `UI.JS` 4263–4310 | **Carrera de doble envío**: el mutex `_sendingOrder` se libera en `finally` antes de que el `pushOrderSafe()` (no awaiteado) termine. La constraint salva el duplicado en nube, pero el flujo permite re-disparos. **Fix**: `await pushOrderSafe(order)` dentro del try. |
| A3 | merger `SUPABASE.JS` 9062–9116 | **Cursor `lastpull` frágil**: `created_at > lastpull` pierde filas con timestamp igual al cursor; clock skew puede saltear pedidos. **Fix**: `>=` + dedupe por `order_id` (ya existe), o cursor `(created_at, id)`. |
| A4 | vendedor `ORDERS.JS` 3128–3193 | **Precio obsoleto en pedido en curso**: un refresh de catálogo (Realtime) durante el armado puede cambiar precios; el item no tiene marca de staleness. **Fix**: snapshotear `_priceSyncedAt` y avisar antes de enviar si el catálogo cambió. |
| A5 | infra (ambos) | **CDN sin blindaje**: `@supabase/supabase-js@2` sin versión exacta, ningún script con `integrity`/`crossorigin` (SRI), `xlsx` desde dos CDNs distintos según app. Un compromiso del CDN inyecta código en ambas apps. **Fix**: pinear versiones exactas, agregar SRI, unificar CDN (o vendorear las libs al repo). |
| A6 | ambos repos | **No existe `schema.sql`**: las constraints `(ns, order_id)`, `(ns, item_key)`, índices y policies viven solo en comentarios. Si se redepliega Supabase sin la constraint única, **se rompe la idempotencia de pedidos en silencio**. **Fix**: crear `schema.sql` versionado con DDL + RLS + índices. |
| A7 | merger `FILES.JS` 4095–4107 | **Detección de header sin umbral**: si ninguna fila puntúa, devuelve fila 0 → un Excel sin encabezado se parsea tratando datos como headers. **Fix**: exigir `bestScore >= 2` o pedir selección manual. |
| A8 | vendedor `SUPABASE.JS` 2184–2203 | **Fallo silencioso de catálogo en modo auto**: si el `ns` está mal tipeado, el pull automático no avisa nunca. **Fix**: indicador persistente de "última sync OK/fallida" en Home. |

### 🟡 Medios

| # | Dónde | Hallazgo |
|---|---|---|
| M1 | vendedor `IMPORT.JS` 1800–1813; merger `BACKUP.JS` 8142–8329 | Importaciones (catálogo / backup JSON) sin validación profunda ni saneo de claves: objetos `out[k] = …` con claves arbitrarias del JSON (usar `Object.create(null)` + whitelist de claves), productos con `qty` inválida pasan enteros. |
| M2 | ambas apps | Cuota de storage sin chequeo proactivo (`navigator.storage.estimate()`); `_safeSetItem` reacciona pero hay ventanas de fallo silencioso con catálogos/historiales grandes. |
| M3 | vendedor `SUPABASE.JS` 2329–2358 | La cola offline solo se reintenta con `online`/`visibilitychange`; sin intervalo periódico, un pedido puede quedar encolado indefinidamente con la app abierta. |
| M4 | merger `UTILS.JS` 6590–6596 | Existe `normalizeKey()` (MAYÚSCULAS, solo espacios) además de `normalize()` (la real). Hoy no se usa en rutas críticas, pero es una trampa: si alguien la usa para `_key`, las apps dejan de matchear. Renombrar o borrar. |
| M5 | ambas `UTILS.JS` | `normalize()` colapsa nombres distintos a la misma `_key` ("Jabón-Florín" ≡ "Jabón Florín") → el último pisa al anterior en el mapa de precios. Agregar detector de colisiones al construir el payload. |
| M6 | merger `ORDERS.JS` 9675–9722 | Pedidos parciales (qty > stock) se clampean y se anotan en `confirmIssues`, pero la UI no los muestra de forma prominente → faltantes pasan desapercibidos. |
| M7 | merger 8937–9130 | Manejo de errores indiferenciado (red vs. permiso vs. cuota → mismo flag "pending"); mensajes engañosos. |
| M8 | merger `REALTIME.JS` + botón manual | `pullOrders()` concurrente (debounce realtime + click manual) sin flag de "pull en curso". |
| M9 | vendedor `STATE.JS` 1623–1629 | `loadOrders()` traga corrupción de JSON sin avisar → historial desaparece en silencio. |

### 🟢 Bajos

- Multiplicadores de rubro aceptan 0/negativos → precios $0 o negativos exportables (merger `PRICES.JS` ~6426).
- LWW de `SYNC_ROWS` sin tiebreaker ante colisión de `updated_at` (agregar `device_id`).
- Sin rate-limit en `pullCatalog`/`flushOrderQueue` (spam de botón = hammering a Supabase).
- `READE.md` (typo) en vendedor no queda excluido por `.assetsignore` → se publica como asset.
- `console.log` de migraciones incluye datos de usuario (menor).
- Sin dedupe por hash de contenido cuando un vendedor re-exporta el mismo pedido con otro `order_id`.

### ✅ Fortalezas verificadas (no tocar)

- `normalize()` **idéntica carácter por carácter** en ambas apps.
- Contrato `vendor_data_v2` bien apareado; vendedor acepta v1 legacy.
- Formato `_meta` del Excel manual coincide exactamente.
- Idempotencia `(ns, order_id)` + manejo de `23505` correcto; `order_id` con `crypto.getRandomValues`.
- `escHtml()` existe y se usa para el contenido textual (el problema es solo el contexto `onclick`).
- Guard contra "catálogo que se achica drásticamente" en el vendedor.
- SW: network-first para HTML, bypass correcto de `*.supabase.co`; workflow `stamp-sw` sin loops infinitos.

---

## 3. Plan de auditoría / remediación por fases

Cada fase tiene criterio de salida verificable. Orden pensado para atacar
primero lo que puede causar pérdida de plata o de datos.

### Fase 0 — Preparación (½ día)
- [ ] Crear `schema.sql` en ambos repos con el DDL completo (tablas, unique
      constraints, índice `orders_ns_created_idx`) y las policies RLS
      objetivo. **(A6)**
- [ ] Backup completo de Supabase y export JSON local antes de tocar nada.
- [ ] Smoke-test manual documentado: publicar catálogo → bajar en vendedor →
      armar pedido → enviar → importar → confirmar → verificar descuento.

### Fase 1 — Seguridad (1–2 días)
- [x] **C1** ✅ (2026-06-13): RLS real por rol con Supabase Auth + tabla
      `user_stores` + helper `store_role()`. Login por persona en ambas apps.
      Pendiente opcional: rotar la anon key (con RLS estricta ya no sirve sola,
      pero rotarla limpia el legado; obliga a re-pegar la key en cada teléfono).
- [ ] **C2**: barrer todos los `onclick="...('${...}')"` de ambas apps y
      migrar a `data-*` + event delegation (grep: `onclick=\"` con template
      literal).
- [ ] **A5**: pinear `@supabase/supabase-js` a versión exacta, agregar
      `integrity` + `crossorigin` a todos los CDNs, unificar CDN de `xlsx`.
- [ ] Verificación: probar payloads con `'`, `\`, `<img onerror>` en nombres
      de producto/cliente de punta a punta.

### Fase 2 — Integridad de datos (2–3 días)
- [ ] **C4**: `beforeunload` → `Store.flushNow()` (merger) y flush de
      orders/cola (vendedor); hacer `flushNow()` lo más síncrono posible.
- [ ] **C3**: confirmación atómica: snapshot → descuento → saves → recién ahí
      `status='confirmado'`; lock cross-tab.
- [ ] **A1/A2**: barrer promesas flotantes (`grep` de `publishCatalog(`,
      `pullOrders(`, `srFlush(`, `pushOrderSafe(`) y agregar
      `await`/`.catch()`; `await pushOrderSafe()` antes de liberar
      `_sendingOrder`.
- [ ] **A3**: cursor de pedidos `>=` + margen / tupla `(created_at, id)`.
- [ ] **M3**: intervalo de reintento (60 s, visible) para la cola offline.
- [ ] Verificación: simular corte de red en cada paso del flujo; confirmar
      el mismo pedido desde dos pestañas; cerrar pestaña inmediatamente tras
      confirmar.

### Fase 3 — Robustez de entradas (1–2 días)
- [ ] **A7**: umbral en `detectHeaderRow` + selección manual de header.
- [ ] **M1**: validación profunda de backup/catálogo (shape por producto,
      `Object.create(null)`, whitelist de claves, `qty`/`price` numéricos).
- [ ] **M2**: chequeo proactivo de cuota antes de saves grandes.
- [ ] Bajos: validar multiplicadores > 0; toast en `loadOrders` corrupto.

### Fase 4 — Sync y concurrencia (1 día)
- [ ] **M8**: flag anti-concurrencia en `pullOrders`/`pullCatalog`.
- [ ] **A8**: indicador "última sync" en Home del vendedor.
- [ ] LWW con tiebreaker `device_id` en `SYNC_ROWS`.
- [ ] **M4**: eliminar/renombrar `normalizeKey()`; comentario en ambos
      `UTILS.JS`: "_key SIEMPRE con normalize()".
- [ ] **M5**: detector de colisiones de `_key` en `buildVendorPayload()`.

### Fase 5 — UX de errores y limpieza (1 día)
- [ ] **M6**: mostrar `confirmIssues` (parciales/ignorados) de forma
      prominente en el detalle del pedido.
- [ ] **M7**: diferenciar errores red/permiso/cuota en mensajes.
- [ ] Bajos restantes: rate-limit de sync, `.assetsignore` vs `READE.md`,
      logs de migración sin datos.

---

## 4. Funciones y mejoras recomendadas

### Para StockMerger (central)
1. **Auditoría / historial de cambios**: log de cambios de precios y stock
   (qué, cuándo, desde qué dispositivo) + undo multinivel en Precios.
2. **Alertas de stock inteligentes**: además del mínimo, sobre-stock y
   productos sin movimiento en N días (los datos ya están en ANALYTICS.JS).
3. **Acciones masivas en Pedidos**: confirmar/descartar en lote con
   validación previa de faltantes agregados.
4. **Panel de salud de sync**: estado de catálogo publicado, pedidos
   pendientes de pull, cola de snapshots, última sync por dispositivo.
5. **Roles multi-usuario** (Supabase Auth): admin vs. operador — habilita
   además la RLS real de la Fase 1.

### Para StockVendedor
1. **Lista de clientes**: autocompletar desde el historial + favoritos
   (hoy se retipea el cliente en cada pedido).
2. **Reabrir/duplicar pedidos**: reeditar un pedido enviado (mismo
   `order_id` → la idempotencia ya lo soporta) y "repetir pedido" desde el
   historial.
3. **Banner de cola pendiente**: "📡 N pedidos esperando sincronizar" con
   botón de envío forzado + indicador de última sync del catálogo.
4. **Aviso de precios actualizados**: si el catálogo cambió con un pedido
   en curso, marcar los ítems con precio distinto y pedir revalidación.
5. **Modo claro / theming** con CSS variables (hoy dark fijo).

### Compartidas / arquitectura
1. **`schema.sql` + policies versionadas** (sale de la Fase 0/1).
2. **Versionado explícito del contrato**: chequear `_version` (no solo
   `_type`) y mostrar aviso si la app hermana publica una versión más nueva.
3. **Telemetría mínima de errores**: contador local de fallos de sync
   visible en Memoria/Home (sin servicios externos).
4. **Vendorear las libs CDN** al repo (xlsx, supabase-js, jspdf) — elimina
   la dependencia de CDNs para el offline-first real y el riesgo de supply
   chain; el SW ya las cachearía como assets propios.

---

## 5. Estado de implementación (2026-06-09)

### ✅ Resuelto en esta rama (ambos repos donde aplica)

| Hallazgo | Fix |
|---|---|
| C2 XSS en `onclick` | Nuevo `escJsAttr()` (escape JS + HTML en capas) en ambas apps. Reemplazó el escape de solo-comilla **y también** los `escAttr`/`escHtml` usados en contexto JS en PRICES.JS del merger, cuyo `&#39;` se decodificaba de vuelta a `'` antes de ejecutar (XSS adicional no detectado por la primera pasada). |
| C3 doble confirmación | Guard cross-tab vía localStorage en `confirmReceivedOrder` (se libera al revertir). |
| A1 promesas flotantes | `.catch()` en `publishCatalog`/`pullOrders`/`srFlush`/`srPullAll` fire-and-forget (merger). |
| A2 doble envío | `handleSendOrder` es async y AWAITea `pushOrderSafe`; el mutex queda tomado hasta el final (vendedor). |
| A3 cursor de pedidos | `gte` en lugar de `gt`; la fila borde re-fetcheada la descarta el dedupe por `order_id`. |
| A6 sin schema.sql | `schema.sql` creado en ambos repos: DDL completo, constraints de idempotencia, policies actuales y plan de endurecimiento RLS. |
| A7 header de Excel | `detectHeaderRow` devuelve `confident`; si ninguna fila matcheó keywords se avisa al usuario. |
| A8 catálogo mudo | El modo auto ahora reporta en `scStatus` y consola cuando no hay catálogo para el `ns` (síntoma típico de ns mal tipeado). |
| M1 | Vendedor: `_normalizePricesList` usa `Object.create(null)` y descarta `__proto__`/`constructor`/`prototype`. Merger: el restore de backup valida cada fila de stock (`_key`/`product` presentes, `qty` numérica ≥ 0) y descarta inválidas con aviso, sin dejar restauración parcial. |
| M5 colisiones `_key` | `buildVendorPayload` detecta productos distintos que colapsan a la misma clave normalizada y avisa con ejemplos (antes uno pisaba al otro en silencio). |
| M6 confirmIssues | El detalle YA los mostraba (falso positivo parcial); se agregó el badge `⚠️ N` en la tarjeta del listado para que no pasen desapercibidos. |
| M3 cola sin reintento | Reintento periódico de `flushOrderQueue` cada 60 s con la app visible (vendedor). |
| M4 `normalizeKey()` | Eliminada. **Al investigarla apareció un bug real**: `importChinaList` indexaba `chinaPrices` con keys en MAYÚSCULAS, invisibles para todos los lookups (que usan `normalize()` en minúsculas). Fix + migración idempotente de keys viejas al cargar. |
| M8 pulls concurrentes | Flag `_pullOrdersBusy` en `pullOrders` (merger). |
| M9 historial corrupto | `loadOrders` preserva el crudo en `vendor_orders_corrupt` y loguea (vendedor). |
| Bajo: `READE.md` | Renombrado a `README.md` (ahora sí lo excluye `.assetsignore`). |

### ❌ Falsos positivos (verificados y descartados)

- **C4 merger**: el merger YA tenía flush en `pagehide` + `visibilitychange`
  (STORE.JS). En el vendedor todos los saves son localStorage sincrónico —
  no hay ventana de write-behind.
- **Bajo multiplicadores 0/negativos**: `saveRubroEdit`, `saveProductOverride`
  y `confirmSetChinaPrice` ya validan `> 0` en todos los puntos de entrada.

### ⏳ Pendiente (requiere acción manual o decisión de producto)

0. ~~**C1b — `user_stores` con RLS APAGADO** (auditoría 2026-06-18)~~ — ✅
   **RESUELTO (2026-06-18)**: en la base en vivo, `user_stores` (la tabla que
   gobierna todo el RLS por rol) tenía `relrowsecurity=false` y `anon`/
   `authenticated` con SELECT/INSERT/UPDATE/DELETE → cualquiera con la anon key
   podía leer/editar/borrar los roles (escalar a `central` o dejar a todos sin
   acceso = DoS), esquivando todo el endurecimiento C1. Fix aplicado:
   `enable row level security` + `revoke all ... from anon, authenticated`
   (defensa en profundidad; `store_role()` es SECURITY DEFINER y sigue
   funcionando). `schema.sql` actualizado en ambos repos para que no se
   re-desincronice. Verificado en vivo: RLS=true, grants vacíos, helper ve las
   6 filas.
0b. ~~**Tabla legacy `workspace`**~~ — ✅ **RESUELTO (2026-06-18)**: era el
   mecanismo viejo de "central compartida" (blob de estado completo),
   reemplazado por `SYNC_ROWS.JS` (sync fila-por-fila). Ya no la usa ninguna
   query del código (solo quedaban comentarios históricos). Se respaldó la
   única fila (rev 107, 30-may) y se hizo `drop table workspace`. Verificado:
   ya no existe.
1. ~~**C1 RLS real por `ns`**~~ — ✅ **RESUELTO (2026-06-13)**: acceso por
   persona con Supabase Auth + RLS por rol (`user_stores` + `store_role()`).
   Login por persona en ambas apps; verificado por rol. Ver `schema.sql`.
   Opcional pendiente: rotar la anon key (limpieza de legado).
2. ~~**A5 pineo de CDN + SRI**~~ — **RESUELTO (verificado 2026-06-12)**: los
   `<script>` de ambas apps ya están pineados a versiones exactas con
   `integrity` + `crossorigin` (supabase-js 2.108.1, xlsx 0.18.5, jspdf 2.5.1).
   Vendorear las libs al repo queda como mejora opcional, ya sin urgencia de
   seguridad.
3. **A4 precio obsoleto en pedido en curso** — mitigado de fábrica (el modo
   auto no pisa un pedido en curso); el snapshot `_priceSyncedAt` +
   revalidación queda como mejora de producto.
4. **M2 cuota proactiva**, **M7 errores diferenciados**, **LWW tiebreaker
   en SYNC_ROWS** — fases 3–5 del plan.
