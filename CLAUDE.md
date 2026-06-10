# CLAUDE.md — StockMerger (app central)

> Mapa de arquitectura de **StockMerger** y de cómo se conecta con su app
> hermana **StockVendedor**. Las dos forman un mismo sistema de stock /
> precios / pedidos para mayoristas.

## Qué es

StockMerger es la **app central** (back-office del mayorista). Desde acá se:

- Carga e ingresa el **stock** desde archivos Excel.
- Definen los **precios** (3 listas: Act/Lista 7, Distribuidor, VIP).
- **Publica el catálogo** a la nube para que los vendedores lo bajen.
- **Reciben y confirman los pedidos** que arman los vendedores, descontando
  stock.
- Generan documentos PDF (presupuesto / remito / nota de pedido) y reportes.

StockVendedor es la **app de los vendedores** (catálogo + armado de pedidos).
Vive en su propio repo (`juliobarbol/stockvendedor`).

## Forma del proyecto

- **PWA de un solo archivo**: toda la app está en `index.html` (~12k líneas,
  HTML + CSS + JS inline). No hay build step ni bundler.
- Se sirve como **assets estáticos en Cloudflare** (`wrangler.jsonc`,
  `assets.directory: "."`).
- `sw.js` + `manifest.webmanifest` la hacen instalable y offline-first.
- Dependencias externas por CDN: librería de Supabase (jsdelivr), `xlsx`
  (SheetJS), `jspdf` + `jspdf-autotable`, fuentes de Google.

## ⚠️ Trabajar sin quemar tokens — LEER PRIMERO

`index.html` pesa **~513 KB / ~12.700 líneas** (≈125k tokens). **Leerlo entero
gasta un contexto completo de una.** Pero está limpio y modularizado: líneas
cortas, sin minificados ni base64, banners `// XXX.JS`. Por eso la **lectura
por rangos de línea es exacta y barata**. Reglas:

1. **NUNCA** hagas `Read` del archivo completo (sin `offset`/`limit`). Tampoco
   `cat`/`sed` de todo el archivo.
2. Para localizar algo: `Grep -n` del símbolo/función/string → te da la línea
   exacta → `Read` con `offset`/`limit` solo ese tramo (±30 líneas).
3. Para saltar a un módulo: usá la columna **Líneas** de la tabla de abajo y
   `Read` ese rango directamente.
4. Para **editar**: `Grep` el `old_string` único → `Read` solo esa franja →
   `Edit`. No vuelvas a leer el archivo después de editar (el harness ya valida
   el cambio).
5. **CSS (`<style>` 22–2287)** y **HTML/markup (2288–3279)** casi nunca hacen
   falta para lógica de negocio — no los leas salvo trabajo de estilos o
   maquetado.
6. Contrato compartido con StockVendedor: `Grep` el símbolo en **ambos** repos
   en vez de abrir los dos `index.html`.

### Mapa de navegación (rangos de línea)

| Región | Líneas |
|---|---|
| `<head>` + scripts CDN | 1–21 |
| **CSS** (`<style>`) | 22–2287 |
| **HTML / markup** (body, pestañas) | 2288–3279 |
| Script de arranque temprano | 3280–3290 |
| **JS principal** (`<script>`) | 3291–12709 |

### Módulos internos (dentro del JS principal)

Cada módulo arranca con un banner `// XXX.JS — ...`. Saltá directo al rango:

| Módulo | Líneas | Rol |
|---|---|---|
| `STORE.JS` | 3291–3456 | Almacén durable sobre **IndexedDB** con fachada **síncrona** (`Store.get/set`, mismo contrato que localStorage; write-behind). |
| `STATE.JS` | 3457–4071 | Estado global (`state`) + persistencia en localStorage. Incluye `state.clients` (libreta de la central). |
| `UTILS.JS` | 4072–4198 | Utilidades compartidas (normalización de claves `_key`, hashing, etc.). |
| `FILES.JS` | 4199–4572 | Carga de Excel de stock + mapper de columnas. |
| `MERGE.JS` | 4573–5491 | Ingreso de stock (inicial o nuevo ingreso) + manejo de duplicados. |
| `UI.JS` | 5492–6262 | Render de stock, navegación, filtros, selector de orden, cards mobile con virtual scroll. |
| `EXPORT.JS` | 6263–6413 | Exportar Excel / CSV / reportes de alertas (con autofiltro y precios de las 3 listas + China). |
| `PRICES.JS` | 6414–8156 | Pestaña Precios (modelo v23, 3 listas + multiplicadores por rubro). |
| `BACKUP.JS` | 8157–8727 | Exportar/importar TODA la config como JSON (incluye `clients`). Incluye `buildVendorPayload()`. |
| `BACKUPS.JS` | 8728–8942 | Capa 1 (recordatorio + descarga) y Capa 2 (snapshots en nube, tabla `backups`). |
| `SUPABASE.JS` | 8943–9437 | Sync **opcional** con la nube. Config, publicar catálogo, traer pedidos (+ fichas de clientes). |
| `REALTIME.JS` | 9438–9551 | Supabase Realtime: escucha `orders` nuevos y cambios en `clients`. |
| `ORDERS.JS` | 9552–10215 | Pedidos recibidos de vendedores (`state.receivedOrders`). |
| `ORDERS_UI.JS` | 10216–10577 | UI de la pestaña Pedidos (las tarjetas muestran notas/lista de la ficha del cliente). |
| `CLIENTS.JS` | 10578–10830 | Fichas de clientes de la central (overlay 👥 Clientes) + `pullVendorClients()` (bajada desde la nube). |
| `DOCS.JS` | 10831–11324 | Generación de PDF (presupuesto / remito / nota de pedido). |
| `ANALYTICS.JS` | 11325–11652 | Agregaciones de ventas (solo cálculo, sin DOM). |
| `ANALYTICS_UI.JS` | 11653–12152 | UI de la pestaña Análisis. |
| `SYNC_ROWS.JS` | 12153–12646 | Sync **fila por fila** entre dispositivos de la central (beta). |
| `BOOT.JS` | 12647–12708 | Orquesta el arranque sobre IndexedDB. |

> Los rangos se mueven al editar. Si algo no cuadra, reubicá con
> `Grep -n "^// NOMBRE.JS"` y leé el banner.

### Pestañas de la UI

`Archivos` (carga de stock), `Stock`, `Precios`, `Pedidos`, `Análisis`,
`Memoria` (config/backups).

## Persistencia

1. **Local**: `state` se guarda en localStorage, respaldado por IndexedDB
   (`stockmerger_store`, store `kv`) vía `Store`. Funciona 100% offline.
2. **Nube (opcional)**: Supabase. Si no se configura, la app funciona igual
   usando archivos Excel/JSON como medio de intercambio.

## Conexión con la nube (Supabase)

Config en `localStorage['sb_config'] = { url, anonKey, ns }`:

- `url` / `anonKey`: del proyecto Supabase.
- **`ns`** = "tienda" / namespace. **Es la clave que une ambas apps**: merger
  y vendedor deben usar el mismo `ns` para hablarse.

Cliente creado con `supabase.createClient(url, anonKey)` (ver `scClient()`).

### Tablas que toca StockMerger

| Tabla | Uso desde el merger |
|---|---|
| `catalog` | **Escribe** (upsert). Una fila por tienda: `{ id: ns, payload, updated_at }`. El `payload` es un `vendor_data_v2` (stock + 3 listas). |
| `orders` | **Lee** (pull incremental por `created_at > lastpull`, filtrado por `ns`). Son los pedidos que insertan los vendedores. |
| `received_orders` | Espejo en nube de los pedidos ya importados, para sync entre dispositivos de la central. |
| `catalog_items`, `rubro_multipliers`, `settings` | Sync fila-por-fila entre dispositivos de la central (`SYNC_ROWS.JS`). |
| `backups` | Snapshots de respaldo en nube (`BACKUPS.JS`). |
| `clients` | **Lee** (pull + Realtime). Fichas de clientes que crean los vendedores; se integran a la libreta local (`CLIENTS.JS`, `pullVendorClients`). |

Realtime: se suscribe a `postgres_changes` en `orders` (pedidos nuevos) y, en
modo multi-dispositivo, a `catalog_items` / `rubro_multipliers` / `settings` /
`received_orders`.

## Cómo se conectan las dos apps

```
            StockMerger (central)                 StockVendedor (vendedores)
            ─────────────────────                 ──────────────────────────
  edita stock + precios
        │
        │ buildVendorPayload()  →  vendor_data_v2 (stock + listas act/dist/vip)
        ▼
   upsert catalog {id: ns, payload}  ───────────►  pullCatalog() / Realtime
                          (Supabase)                 applyVendorData()
                                                          │
                                                     arma pedido
                                                          │
   pullOrders() / Realtime  ◄───────────────────  insert orders {ns, order_id, payload}
        │                       (Supabase)
        ▼
   importa a receivedOrders → confirma → descuenta stock → PDF
```

Dos canales equivalentes, según haya nube o no:

- **Con Supabase**: catálogo y pedidos viajan por las tablas `catalog` y
  `orders`, en tiempo real. Misma `ns` en ambos lados.
- **Sin nube (manual)**: la central exporta un `.json`/Excel `vendor_data_v2`
  ("Exportar para vendedores"); el vendedor lo importa. El vendedor exporta el
  pedido como Excel (con hoja oculta `_meta`); la central lo importa en
  Pedidos. **Mismo formato y mismas funciones** (`buildVendorPayload` /
  `applyVendorData`) que el camino de nube, para no divergir.

### Contrato de datos compartido

- **Catálogo (central → vendedor)** = `vendor_data_v2`:
  ```
  { _app:"StockMerger", _type:"vendor_data_v2", _version:2, _exportedAt,
    stock:  [ { _key, product, qty, marca, rubro }, ... ],
    prices: { act:{key:{label,marca,rubro,price}}, dist:{...}, vip:{...} } }
  ```
  Lo genera `buildVendorPayload()` (merger) y lo aplica `applyVendorData()`
  (vendedor). **Si cambia el shape, hay que tocar ambos repos.**
- **Pedido (vendedor → central)**: el vendedor inserta en `orders` con
  `{ ns, order_id, vendor, client, payload }`. La central lo cruza por `_key`
  contra `state.merged` y lo guarda en `state.receivedOrders`.
- **`_key`**: clave normalizada de producto. Es el pegamento para cruzar
  catálogo y pedidos. Debe normalizarse igual en ambas apps (`UTILS.JS`).

## Decisiones de producto (de Julio) — fuente de verdad

> ⚠️ **Mantener al día**: si Julio cambia alguna de estas reglas, hay que
> EDITAR esta sección en los CLAUDE.md de **ambos repos** en el mismo cambio.
> Una regla desactualizada acá genera implementaciones contradictorias.

- **Listas de precios**: claves internas `act` / `dist` / `vip` — los nombres
  visibles son "Lista 7", "Distribuidor" y "VIP". Las claves internas NO se
  renombran (romperían pedidos guardados y la conexión entre apps).
- **Fichas de clientes**: cada vendedor tiene SU libreta local (StockVendedor,
  pestaña Clientes); la central tiene la suya con TODOS los clientes
  (StockMerger, overlay 👥 Clientes en la pestaña Pedidos).
- **La lista del pedido la define la ficha del cliente**: al elegir cliente en
  el pedido, su lista se aplica y los chips quedan bloqueados. Para un pedido
  puntual con otra lista se EDITA LA FICHA (no se puede pisar desde el pedido).
- **Notas privadas por lado**: las notas del vendedor no viajan a la central y
  viceversa. Entre apps solo viajan nombre / lista / vendedor (tabla `clients`).
- **Sync de fichas vendedor → central** (tabla `clients`): los borrados NO
  viajan (la libreta de la central es de la central), y si la central editó
  una ficha (`source: 'central'`), lo que mande un vendedor no la pisa.
- **Excel exportados**: siempre con autofiltro en la fila de cabecera. El
  Excel de Stock de la central incluye las 3 listas + precio China.

## Notas de desarrollo

- No hay tests ni linters; es HTML+JS plano servido estático.
- Para cambios de catálogo/pedido, verificá la app hermana
  (`juliobarbol/stockvendedor`): comparten formato `vendor_data_v2`, esquema de
  `orders` y la normalización de `_key`.
- Idempotencia de pedidos: la constraint única `(ns, order_id)` hace que el
  reintento de inserción tras un corte de red devuelva `23505` y NO duplique.
- Todo lo de Supabase es opt-in: el flujo de archivos Excel/JSON debe seguir
  funcionando aunque no haya nube.

## Deploy y versión del cache (PWA)

- Se sirve como assets estáticos en Cloudflare desde el repo. `.assetsignore`
  excluye `wrangler.jsonc`, `.assetsignore` y `README.md`.
- El service worker (`sw.js`) sirve el HTML **network-first** (las
  actualizaciones del `index.html` llegan solas) y el resto **cache-first**.
- La versión del cache (`const CACHE` en `sw.js`) **debe cambiar en cada
  release** para que el SW se actualice y los usuarios reciban lo nuevo. Lo
  estampa **`build.py`** (`CACHE = '<name>-<timestamp UTC>'`, name de
  `wrangler.jsonc`).
- `build.py` lo corre solo el workflow **`.github/workflows/stamp-sw.yml`** en
  cada push a `main`; si el `sw.js` no venía estampado, lo commitea de vuelta.
  Es la red de seguridad: **no hace falta bump manual**. Igual podés correrlo a
  mano con `python build.py`.
- Si algún día se parte el `index.html` en archivos `.js` externos, ojo: caen
  en la rama cache-first del SW → hay que cache-bustear (`?v=`) o pasarlos a
  network-first para no servir versiones viejas.
