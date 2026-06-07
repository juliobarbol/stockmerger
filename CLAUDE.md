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

`index.html` pesa **~485 KB / ~12.100 líneas** (≈120k tokens). **Leerlo entero
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
5. **CSS (`<style>` 22–2267)** y **HTML/markup (2268–3190)** casi nunca hacen
   falta para lógica de negocio — no los leas salvo trabajo de estilos o
   maquetado.
6. Contrato compartido con StockVendedor: `Grep` el símbolo en **ambos** repos
   en vez de abrir los dos `index.html`.

### Mapa de navegación (rangos de línea)

| Región | Líneas |
|---|---|
| `<head>` + scripts CDN | 1–21 |
| **CSS** (`<style>`) | 22–2267 |
| **HTML / markup** (body, pestañas) | 2268–3190 |
| Script de arranque temprano | 3191–3201 |
| **JS principal** (`<script>`) | 3202–12124 |

### Módulos internos (dentro del JS principal)

Cada módulo arranca con un banner `// XXX.JS — ...`. Saltá directo al rango:

| Módulo | Líneas | Rol |
|---|---|---|
| `STORE.JS` | 3204–3369 | Almacén durable sobre **IndexedDB** con fachada **síncrona** (`Store.get/set`, mismo contrato que localStorage; write-behind). |
| `STATE.JS` | 3370–3940 | Estado global (`state`) + persistencia en localStorage. |
| `UTILS.JS` | 3941–4047 | Utilidades compartidas (normalización de claves `_key`, hashing, etc.). |
| `FILES.JS` | 4048–4413 | Carga de Excel de stock + mapper de columnas. |
| `MERGE.JS` | 4414–5332 | Ingreso de stock (inicial o nuevo ingreso) + manejo de duplicados. |
| `UI.JS` | 5333–6065 | Render de stock, navegación, filtros, cards mobile con virtual scroll. |
| `EXPORT.JS` | 6066–6204 | Exportar Excel / CSV / reportes de alertas. |
| `PRICES.JS` | 6205–7949 | Pestaña Precios (modelo v23, 3 listas + multiplicadores por rubro). |
| `BACKUP.JS` | 7950–8482 | Exportar/importar TODA la config como JSON. Incluye `buildVendorPayload()`. |
| `BACKUPS.JS` | 8483–8685 | Capa 1 (recordatorio + descarga) y Capa 2 (snapshots en nube, tabla `backups`). |
| `SUPABASE.JS` | 8686–9160 | Sync **opcional** con la nube. Config, publicar catálogo, traer pedidos. |
| `REALTIME.JS` | 9161–9262 | Supabase Realtime: escucha `orders` nuevos. |
| `ORDERS.JS` | 9263–9910 | Pedidos recibidos de vendedores (`state.receivedOrders`). |
| `ORDERS_UI.JS` | 9911–10248 | UI de la pestaña Pedidos. |
| `DOCS.JS` | 10249–10742 | Generación de PDF (presupuesto / remito / nota de pedido). |
| `ANALYTICS.JS` | 10743–11070 | Agregaciones de ventas (solo cálculo, sin DOM). |
| `ANALYTICS_UI.JS` | 11071–11570 | UI de la pestaña Análisis. |
| `SYNC_ROWS.JS` | 11571–12064 | Sync **fila por fila** entre dispositivos de la central (beta). |
| `BOOT.JS` | 12065–12123 | Orquesta el arranque sobre IndexedDB. |

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
