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
- Lleva la **tesorería** (pestaña 💰 Caja): cajas multi-moneda (Pesos,
  Dólares, Mercado Pago, Lemon), gastos/impuestos, cuenta corriente de
  clientes en USD ("dinero en calle") y reportes de comisiones por vendedor.

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

`index.html` pesa **~558 KB / ~13.900 líneas** (≈135k tokens). **Leerlo entero
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
5. **CSS (`<style>` 26–2334)** y **HTML/markup (2335–3452)** casi nunca hacen
   falta para lógica de negocio — no los leas salvo trabajo de estilos o
   maquetado.
6. Contrato compartido con StockVendedor: `Grep` el símbolo en **ambos** repos
   en vez de abrir los dos `index.html`.

### Mapa de navegación (rangos de línea)

| Región | Líneas |
|---|---|
| `<head>` + scripts CDN | 1–25 |
| **CSS** (`<style>`) | 26–2334 |
| **HTML / markup** (body, pestañas) | 2335–3452 |
| Script de arranque temprano | 3453–3463 |
| **JS principal** (`<script>`) | 3464–13892 |

### Módulos internos (dentro del JS principal)

Cada módulo arranca con un banner `// XXX.JS — ...`. Saltá directo al rango:

| Módulo | Líneas | Rol |
|---|---|---|
| `STORE.JS` | 3466–3631 | Almacén durable sobre **IndexedDB** con fachada **síncrona** (`Store.get/set`, mismo contrato que localStorage; write-behind). |
| `STATE.JS` | 3632–4302 | Estado global (`state`) + persistencia en localStorage. Incluye `state.clients` (libreta de la central) y `state.treasury` (caja). |
| `UTILS.JS` | 4303–4429 | Utilidades compartidas (normalización de claves `_key`, hashing, etc.). |
| `FILES.JS` | 4430–4803 | Carga de Excel de stock + mapper de columnas. |
| `MERGE.JS` | 4804–5722 | Ingreso de stock (inicial o nuevo ingreso) + manejo de duplicados. |
| `UI.JS` | 5723–6682 | Render de stock, navegación, filtros, selector de orden, cards mobile con virtual scroll. |
| `EXPORT.JS` | 6683–6835 | Exportar Excel / CSV / reportes de alertas (con autofiltro y precios de las 3 listas + China). |
| `PRICES.JS` | 6836–8578 | Pestaña Precios (modelo v23, 3 listas + multiplicadores por rubro). |
| `BACKUP.JS` | 8579–9179 | Exportar/importar TODA la config como JSON (incluye `clients` y `treasury`). Incluye `buildVendorPayload()`. |
| `BACKUPS.JS` | 9180–9394 | Capa 1 (recordatorio + descarga) y Capa 2 (snapshots en nube, tabla `backups`). |
| `SUPABASE.JS` | 9395–9889 | Sync **opcional** con la nube. Config, publicar catálogo, traer pedidos (+ fichas de clientes). |
| `LOG.JS` | 10412–10631 | **Bitácora de diagnóstico**: `logEvent()` (best-effort, cola offline) sube a la tabla `event_log`; captura `window.onerror`/`unhandledrejection`, muestra un código `ref` al usuario y adjunta breadcrumbs (`addBreadcrumb`) + contexto. |
| `REALTIME.JS` | 9890–10003 | Supabase Realtime: escucha `orders` nuevos y cambios en `clients`. |
| `ORDERS.JS` | 10004–10671 | Pedidos recibidos de vendedores (`state.receivedOrders`). Al confirmar marca `order.ctaCte` (entra a la cuenta corriente de Caja). |
| `ORDERS_UI.JS` | 10672–11033 | UI de la pestaña Pedidos (las tarjetas muestran notas/lista de la ficha del cliente). |
| `CLIENTS.JS` | 11034–11288 | Fichas de clientes de la central (overlay 👥 Clientes, incl. `saldoInicial` USD) + `pullVendorClients()` (bajada desde la nube). |
| `DOCS.JS` | 11289–11782 | Generación de PDF (presupuesto / remito / nota de pedido). |
| `ANALYTICS.JS` | 11783–12110 | Agregaciones de ventas (solo cálculo, sin DOM). |
| `ANALYTICS_UI.JS` | 12111–12610 | UI de la pestaña Análisis. |
| `SYNC_ROWS.JS` | 12611–13104 | Sync **fila por fila** entre dispositivos de la central (beta). |
| `CAJA.JS` | 13105–13829 | Pestaña 💰 Caja: cajas multi-moneda (`state.treasury`), cotización del día, cuenta corriente USD por cliente ("dinero en calle", PDF/Excel) y reportes (ventas por lista, comisiones por vendedor, balance mensual). |
| `BOOT.JS` | 13830–13891 | Orquesta el arranque sobre IndexedDB. |

> Los rangos se mueven al editar. Si algo no cuadra, reubicá con
> `Grep -n "^// NOMBRE.JS"` y leé el banner.

### Pestañas de la UI

`Archivos` (carga de stock + backups/nube), `Stock`, `Precios`, `Pedidos`,
`Análisis`, `Caja` (tesorería: sub-pestañas 📒 Caja / 💵 Dinero en calle /
📊 Reportes). La pantalla `Memoria` (decisiones de duplicados) no tiene botón
en la barra: se abre desde un botón "🧠 Ver memoria" al final de Archivos
(`switchTab('memoria')` resalta la pestaña Archivos).

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

La sección de conexión de la UI (pestaña Archivos) queda **oculta tras la
contraseña `opbayressincnube`** una vez configurada (candado anti-miradas,
mismo espíritu que el gran reset — no es seguridad real). El campo de la key
es `type="password"` y el resumen solo muestra las últimas 4. Igual en el
vendedor (Home). Ver `sbLockRefresh()` en SUPABASE.JS de ambos repos.

### Acceso por persona (Supabase Auth + RLS) — HECHO (2026-06-13)

La anon key **ya NO abre la base por sí sola**: hay RLS real por rol. Cada
persona tiene un usuario de Supabase Auth (email + contraseña) y un rol por
tienda (`central` / `vendor`) en la tabla `user_stores`. Las policies
consultan ese rol con el helper `store_role(ns)`; sin sesión iniciada
(`auth.uid()` null) no se ve ni se toca nada.

- **Gate de login al abrir** (`#authGate`, `authGateRefresh()`): si la nube
  está configurada y NO hay sesión guardada, una pantalla tapa la app hasta
  iniciar sesión (`authGateLogin()`). No bloquea el modo file-only (sin nube
  configurada no aparece). Botón "Configurar conexión" (`authGateConfig()`,
  tras la contraseña del candado) para cargar URL/key la primera vez.
- **Captcha en el login (Cloudflare Turnstile) — HECHO (2026-06-19)**: ambas
  pantallas de login (gate `#gateCaptcha` y sección de conexión
  `#sbLoginCaptcha`) muestran un widget Turnstile; el token viaja en
  `signInWithPassword({ options:{ captchaToken } })` y Supabase lo valida con la
  **clave secreta** (en `config/auth`, `security_captcha_provider:'turnstile'`,
  **NUNCA en el código** — el repo es público). La **Site Key** sí va en el HTML
  (`TURNSTILE_SITEKEY`, es pública por diseño). Helpers en SUPABASE.JS:
  `_loadTurnstile` / `_ensureCaptcha` / `_captchaToken` / `_captchaReset`.
  Degrada con gracia: si el script no carga, el login sigue sin token. Solo
  protege el **inicio de sesión** (no el refresh ni las sesiones ya abiertas) y
  no aparece en modo file-only. **Kill-switch**: `security_captcha_enabled` en
  Supabase (Management API) lo apaga al instante sin redeploy. El alta de
  personas no cambia. El widget Turnstile vive en la cuenta Cloudflare de Julio
  (hostnames `stockmerger.*` y `stockvendedor.*.workers.dev`).
- **Persistencia**: `scClient()` crea el cliente con `persistSession: true` +
  `autoRefreshToken: true` + `storageKey: SB_AUTH_KEY`. La sesión queda en
  `localStorage` (`sb-<ref>-auth-token`) y sobrevive recargas; offline el token
  vencido se renueva solo al recuperar internet. El gate usa
  `_sbHasStoredSession()` (presencia, sin exigir token vigente).
- **Login también en la sección de conexión**: dentro del candado hay el mismo
  formulario (`sbLogin()`); muestra el email y "Cerrar sesión" (`sbLogout()`,
  re-muestra el gate). Estado refrescado por `sbLockRefresh()` con
  `_sbGetSession()`.
- **Roles**: `central` puede TODO lo de su `ns` (publicar catálogo, leer/borrar
  pedidos, tablas de sync, backups). `vendor` solo LEE `catalog` e INSERTA en
  `orders`/`clients`. Las tablas solo-central (`catalog_items`,
  `rubro_multipliers`, `settings`, `received_orders`, `backups`) y el bucket
  `backups` de Storage son inaccesibles para vendedores.
- **Gran reset**: conserva la clave de sesión (`sb-<ref>-auth-token`) en
  `GRAN_RESET_KEEP`, junto a `sb_config`/`docconfig`, para no desloguear.
- **Alta/baja de personas**: crear/borrar el usuario en Supabase Auth (Admin
  API / Management API con `SUPABASE_ACCESS_TOKEN`) y su fila en `user_stores`
  (`role` = `central`/`vendor`). En el alta, además guardar la **identidad fija**
  del vendedor en `app_metadata` (`vendor_name` + `vendor_code`): la app del
  vendedor la autocompleta y bloquea (no se escribe el nombre/código a mano, así
  no se duplican vendedores). El `ON DELETE CASCADE` borra la membresía al
  borrar el usuario → el teléfono queda sin acceso al instante. Detalle y SQL
  de ejemplo en `schema.sql` (sección AUTH + RLS).
- **Usuarios actuales** (ns `default`, con código corto): Julio Barrientos
  (JUL), Shirley Celis (SHI), Santiago Encalada (SAN) — central; Walter Méndez
  (WAL), Sergio Achaval (SER), Jairo Leguizamón (JAI) — vendor.

### Tablas que toca StockMerger

| Tabla | Uso desde el merger |
|---|---|
| `catalog` | **Escribe** (upsert). Una fila por tienda: `{ id: ns, payload, updated_at }`. El `payload` es un `vendor_data_v2` (stock + 3 listas). |
| `orders` | **Lee** (pull incremental por `created_at > lastpull`, filtrado por `ns`). Son los pedidos que insertan los vendedores. |
| `received_orders` | Espejo en nube de los pedidos ya importados, para sync entre dispositivos de la central. |
| `catalog_items`, `rubro_multipliers`, `settings` | Sync fila-por-fila entre dispositivos de la central (`SYNC_ROWS.JS`). |
| `backups` | Snapshots de respaldo en nube (`BACKUPS.JS`). |
| `clients` | **Lee** (pull + Realtime). Fichas de clientes que crean los vendedores; se integran a la libreta local (`CLIENTS.JS`, `pullVendorClients`). |
| `event_log` | **Escribe** (insert, best-effort). Bitácora de diagnóstico: errores, contexto y breadcrumbs (`LOG.JS`). Append-only; la lee solo la central (en la práctica, se consulta por la Management API). |

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
    stock:  [ { _key, product, qty, marca, rubro }, ... ],   // en orden catálogo
    prices: { act:{key:{label,marca,rubro,price}}, dist:{...}, vip:{...} },
    order:  { rubros:[...], marcas:[...] } }   // ADITIVO: prioridad del catálogo
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
- **Orden catálogo** (jerarquía rubro → marca → modelo correlativo, con
  números comparados como números: A01 < A01 Core < A02 < A02s < A10): la
  prioridad de rubros y marcas la define la central (botón 📑 en Stock,
  `state.catalogOrder`) y viaja en `vendor_data_v2.order` (campo aditivo).
  Es el orden de los Excel de la central, el orden por defecto del catálogo
  del vendedor y de la plantilla Excel para clientes. Valores no listados van
  después (alfabéticos); sin rubro/marca, al final.
- **Tesorería / Caja (solo central, pestaña 💰 Caja en StockMerger)**: 4
  cuentas fijas — Caja Pesos (ARS), Caja Dólares (USD), Mercado Pago (ARS),
  Lemon (ARS). La **cotización del día** (1 USD = ARS) es un campo editable a
  mano; cada movimiento guarda la cotización con la que se registró, así los
  reportes históricos no cambian al actualizarla. Nada de esto viaja a
  StockVendedor ni a la nube (vive en `state.treasury`, local + backups).
- **Cuenta corriente de clientes (en USD)**: la deuda nace al CONFIRMAR un
  pedido (flag `ctaCte` que se setea desde v26 — los confirmados antes se
  asumen ya cobrados). Los pagos se registran como "cobranza" en Caja (en
  cualquier cuenta; si es en pesos se convierte a USD con la cotización) y
  bajan el saldo automáticamente. Deudas previas a la app → campo
  `saldoInicial` (USD) en la ficha del cliente. El cruce es POR NOMBRE
  normalizado (`_cliKey`), igual que fichas↔pedidos.
- **Comisiones por vendedor**: % editable por vendedor (se guarda en
  `state.treasury.commissions`), aplicado sobre las ventas confirmadas de su
  cartera en el mes (pestaña Caja → Reportes).

## Notas de desarrollo

- **EN CURSO (2026-06-21): rediseño de UI ("estilo DaisyUI" sin build) — rama
  `claude/light-theme-ui-dtlqb5`, todo MERGEADO a `main`.** Trabajo con Julio,
  por etapas y publicando cada una. Hecho hasta ahora:
  - **Tema claro/oscuro**: variables en `html[data-theme="light"]` (CSS, justo
    tras `:root`); script inline en el `<head>` (`applyTheme`/`toggleTheme`,
    `localStorage['ui_theme']`, default `dark`); botón `#themeToggleBtn` en el
    hero de Archivos. `meta[name=theme-color]` se actualiza solo.
  - **Tarjetas limpias** (paneles de config como cards): `.backup-section`
    (pestaña Archivos).
  - **Tablas que no corren la página** (scroll horizontal contenido):
    `.rubros-table-wrap` (Precios), wrapper `.caja-tscroll` alrededor de cada
    `<table class="caja-table">` (Reportes de Caja — se envuelven en CAJA.JS),
    `.od-table td` que envuelve texto largo (detalle de Pedidos). `tr:hover td`
    ahora usa `var(--surface2)` (antes color fijo, se veía feo en claro).
  - **Selector de cliente in-app** (Caja → Movimiento): reemplaza el `datalist`
    nativo. `movClientFilter`/`movClientPick`/`movClientHide`/`movClientBlurLater`,
    markup `#movClientResults`, CSS `.mov-client-results`/`.mcr-item`.
  - **Diálogo de texto propio** (reemplaza `prompt()`/`alert()` del navegador):
    `appPrompt({title,placeholder,value,password})` → Promise; `_appPromptClose`;
    markup `#appPromptOverlay`; CSS `.app-modal*`. Aplicado en `openNewRubro`,
    `createRubroFromAssign`, `granReset`, `sbUnlockConfig`, `authGateConfig`.
  - **Desplegable propio para `<select>`** (la lista nativa no se puede pintar):
    `enhanceSelect(sel)` oculta el `<select>` (`.csel-native`; sigue funcional:
    al elegir setea `value` + dispara `change`), pone trigger `.csel-trigger` y
    lista `.csel-pop` **flotante** (position:fixed, colgada del `<body>`, para
    no recortarse en modales/scroll). `refreshSelect` re-sincroniza el texto
    tras fijar value por código; `enhanceAllSelects` + `_watchSelects`
    (MutationObserver) cubren también los `<select>` dinámicos (cuenta/mes de
    Reportes de Caja). Init: `_initCustomSelects`.
  - **PENDIENTE**:
    - El `prompt()` de "¿qué lista trae el Excel? (7/VIP)" (`const choice =
      prompt(...)`): pasarlo a un modal de **2 botones** (mejor que tipear). Es
      el ÚNICO `prompt()` de texto que queda a la vista.
    - Opcional: los `confirm()`/`alert()` restantes → mismo cuadro propio.
    - Sin tocar a propósito: `<input type="date">` (mejor nativo) y los
      `datalist` de marca/rubro en crear producto manual (mismo patrón que el
      cliente si se quisiera).
    - Falta que Julio confirme los desplegables en ventanas/modales y dinámicos.
  > Mismo rediseño en StockVendedor (mantener en sync). Diferencias: el vendedor
  > NO tiene `appPrompt` todavía (sus `prompt()` de contraseña siguen nativos)
  > ni MutationObserver (enhancea en load); sí tiene tema, tarjetas
  > (`.config-section`, `.template-section`, `.order-search-section`) y
  > `enhanceSelect` en sus 3 selects.
- **HECHO (2026-06-21): bitácora de diagnóstico** (`LOG.JS` + tabla `event_log`).
  NO es un audit log para mirar desde la app: es una bitácora REMOTA para
  diagnosticar cuando alguien reporta un error. Captura crashes de JS
  (`window.onerror`/`unhandledrejection`) y fallos de operaciones riesgosas
  (`pullOrders`/`publishCatalog`), con stack completo, contexto del dispositivo
  (navegador, versión = nombre del cache del SW, online/offline) y **breadcrumbs**
  (las últimas acciones, vía `addBreadcrumb`). Cada error le muestra al usuario un
  código corto `ref` (ej. `A3F9`). Best-effort total: nunca rompe la app, y si la
  subida falla queda en una **cola local** (`event_log_queue`, conservada por el
  gran reset) que se reintenta al volver la conexión. **Cómo consultarla** (con
  `SUPABASE_ACCESS_TOKEN`, Management API, endpoint `/v1/projects/<ref>/database/query`):
  por código de referencia →
  `select * from event_log where ref = 'A3F9' order by created_at desc;`
  o los últimos errores →
  `select created_at, app, actor, event, summary, meta from event_log where severity='error' order by created_at desc limit 50;`
  El `meta.breadcrumbs` muestra qué pasó antes; `meta.error.stack`, el stack.
  Mismo módulo en ambos repos (solo cambian `LOG_APP`/`LOG_ROLE`).
- **HECHO (2026-06-13): acceso por persona a la nube** (Supabase Auth + RLS por
  rol, hallazgo C1 de `AUDITORIA.md`). Ver la sección "Acceso por persona" en
  "Conexión con la nube" (arriba) y `schema.sql`. Alta/baja de personas: crear/
  borrar el usuario en Auth + su fila en `user_stores`.
- No hay tests ni linters; es HTML+JS plano servido estático.
- **Acceso directo a Supabase**: si la variable de entorno
  `SUPABASE_ACCESS_TOKEN` está definida, usarla con la Management API
  (`api.supabase.com`, proyecto `stock-bayres`, ref `dxntcbssxjxtxznkdsot`,
  endpoint `/v1/projects/<ref>/database/query`) para consultar/ajustar la
  base directamente. ⚠️ NUNCA commitear tokens/secretos al repo: el repo SE
  PUBLICA tal cual como app en Cloudflare y el historial de git no se borra.
- Para cambios de catálogo/pedido, verificá la app hermana
  (`juliobarbol/stockvendedor`): comparten formato `vendor_data_v2`, esquema de
  `orders` y la normalización de `_key`.
- Idempotencia de pedidos: la constraint única `(ns, order_id)` hace que el
  reintento de inserción tras un corte de red devuelva `23505` y NO duplique.
- Todo lo de Supabase es opt-in: el flujo de archivos Excel/JSON debe seguir
  funcionando aunque no haya nube.
- **Gran reset** (pasaje de pruebas a uso real): botón al final de la pestaña
  Archivos (acá) y de Home (vendedor), protegido por la contraseña
  `opbayresgranreset` (hardcodeada — es un guard anti-toque-accidental, no
  seguridad). El de la central descarga un backup, borra TODO lo local salvo
  `sb_config`/`docconfig` y limpia las filas del ns en la nube; `orders` y
  `catalog` necesitan las policies de DELETE que schema.sql agrega desde esta
  versión (si el proyecto corre el schema viejo, el reset lo detecta con un
  count y avisa). El del vendedor borra solo lo local salvo `sb_config`.

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
