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

**Conexión de fábrica — HECHO (2026-07-30)**: la app **ya viene conectada**. Las
constantes `SB_DEFAULT_URL` / `SB_DEFAULT_KEY` / `SB_DEFAULT_NS` (arriba de
`scGetConfig` en SUPABASE.JS) traen la URL, la anon key y el `ns` del proyecto,
y `scGetConfig()` las usa cuando no hay `sb_config` guardado (o cuando algún
campo vino vacío). En un dispositivo nuevo solo hay que **iniciar sesión**: no se
pega URL ni key. Lo guardado a mano SIGUE teniendo prioridad (se puede apuntar a
otro proyecto/tienda sin tocar el código). La anon key es pública por diseño
(viaja en cada request del navegador) y no abre nada sola: RLS exige sesión +
fila en `user_stores`. **Nunca** poner acá la service_role key. Mismo cambio en
StockVendedor.

**Sincronizar al iniciar sesión — HECHO (2026-07-30)**: el arranque de la app
ocurre con el gate de login tapando todo, o sea SIN sesión, así que `srBoot()` /
`pullOrders()` (central) y `pullCatalog()` (vendedor) fallaban por RLS y la app
quedaba vacía hasta cerrarla y reabrirla. Ahora `srBoot()` **sale sin marcar
`_srBooted`** si no hay sesión guardada (antes quedaba "ya arrancado" y no
reintentaba nunca), y tanto `authGateLogin()` como `sbLogin()` llaman a
`_sbAfterLoginSync()`, que dispara la bajada apenas hay sesión. Mismo helper en
StockVendedor (ahí baja catálogo + fichas de clientes).

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
  viceversa. Entre apps viajan nombre / lista / vendedor / domicilio / teléfono
  (tabla `clients`); las notas NO.
- **Datos de contacto del cliente (domicilio + teléfono)** — HECHO (2026-06-22):
  campos OPCIONALES en la ficha de cliente de ambas apps (el vendedor crea con
  solo el nombre; la lista la define el pedido). Viajan vendor→central por la
  tabla `clients` (columnas `domicilio`/`telefono`). En la central, la ficha sin
  esos datos muestra un ⚠️ en la lista de 👥 Clientes (`renderClientsList`), y
  `pullVendorClients` COMPLETA los que falten localmente sin pisar lo cargado a
  mano por la central. Además autocompletan DOMICILIO/TELEFONOS del PDF de
  presupuesto (`DOCS.JS`, vía `findClientFicha`).
- **Sync de fichas vendedor → central** (tabla `clients`): los borrados NO
  viajan (la libreta de la central es de la central), y si la central editó
  una ficha (`source: 'central'`), lo que mande un vendedor no la pisa.
- **Fichas central → vendedor (vendedor asignado)** — HECHO (2026-06-22): la
  central puede crear un cliente y **asignarle un vendedor** (campo
  `clientFormVendor`, datalist con `_knownVendors()`) + su lista. Al guardar,
  `pushClientToCloud()` lo sube a `clients`. La app del vendedor cuyo nombre
  coincide (`state.user.name`) lo BAJA con `pullClientsFromCloud()` (al arrancar,
  al volver al frente, al abrir el selector de cliente y por Realtime), así el
  cliente YA EXISTE en su libreta y en su lista al armar el pedido. El cruce
  vendedor↔ficha es por nombre del vendedor; por eso la central elige del
  datalist (nombres reales de pedidos/fichas) para que coincida EXACTO. Cruce de
  clientes por NOMBRE, last-write-wins por `updated_at`. Lo bajado no se re-sube.
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
  reportes históricos no cambian al actualizarla. Esa misma cotización es el
  **tipo de cambio que se precarga al generar el PDF de un pedido**, y se
  **sincroniza en ambos sentidos** (editar el TC en el PDF actualiza la
  cotización de Caja y viceversa; `openDocModal` lee `state.treasury.rate` y
  `confirmDocModal` lo reescribe). El **dólar blue (valor *venta*) se trae
  automáticamente** desde `dolarapi.com` (InfoDólar no se puede leer directo por
  CORS) al abrir la app, al entrar a Caja y al abrir el modal del PDF
  (`autoFetchDolarBlue`), pero **NUNCA pisa una cotización ya cargada hoy** (la
  marca con `rateUpdatedAt`), así sigue siendo **editable a mano** si el operador
  verifica otro precio. Además queda el botón **🔄** (`fetchDolarBlueInto`) para
  forzar la actualización. Nada de esto viaja a StockVendedor ni a la nube (vive
  en `state.treasury`, local + backups).
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
- **Imputación de pagos a comprobantes** — HECHO (2026-06-22): un pago
  (cobranza) puede llevar `allocations:[{ref,usd}]` que dicen a qué pedido(s)
  confirmado(s) se aplica y cuánto. Lo NO imputado queda **"a cuenta"** (baja la
  deuda general igual). Los pagos viejos sin `allocations` = todo a cuenta (nada
  cambia). La **deuda total NO depende de la imputación** (es solo detalle por
  comprobante). En el formulario de cobranza se reparte FIFO (más viejo primero)
  y es **ajustable a mano** (`movBuildImput`/`movAutofillImput`/`movImputRecalc`).
  El estado por comprobante (🟢 pagado / 🟡 parcial / 🔴 pendiente) se ve en
  "Dinero en calle" (desplegable `toggleCalleDetail`, helpers `_clientLedger`/
  `_paidByOrder`/`_clientComprobantes`) y en el PDF de resumen. La `ref` del
  pedido es `localId||orderId`. Todo local (`state.treasury`), solo central.

- **Bitácora de movimientos (auditoría) — HECHO (2026-08-01)**: la central
  registra en la nube TODA operación que mueve dinero o mercadería, con el
  antes y el después: confirmar / revertir / descartar un pedido, emitir un
  comprobante, alta y baja de movimientos de caja, cambio de la cotización del
  día y cambio a mano de un precio de costo. Va a `event_log` (append-only: la
  base no da permiso de editar ni borrar) y **no se ve desde ninguna pantalla
  de la app** — se consulta aparte con la Management API. El "quién" y el rol
  los fuerza la BASE con un trigger (`event_log_forzar_usuario`), no el
  navegador; la hora confiable es `created_at` (del servidor), no `occurred_at`
  (del dispositivo). Objetivo declarado por Julio: poder detectar movimientos
  fraudulentos y verificar que la app se usó bien.
- **Aviso a los usuarios — PENDIENTE (a partir de ~septiembre 2026, tras 1 mes
  de uso real)**: poner en la app un aviso de que los movimientos quedan
  registrados con fecha, hora y usuario. Encuadre pedido por Julio: presentarlo
  como parte del monitoreo de errores y la seguridad del sistema, **no** como
  vigilancia; que los usuarios entiendan cómo funciona y deduzcan solos que un
  movimiento fraudulento quedaría registrado. ⚠️ El texto tiene que ser
  **cierto y completo** sobre QUÉ se registra (eso es lo que disuade) y no debe
  negar el uso de control — decir "solo se usa para errores" sería falso.

## Notas de desarrollo

- **HECHO (2026-08-01): bitácora de movimientos (auditoría antifraude)** —
  `auditar(accion, resumen, datos)` en LOG.JS envuelve a `logEvent` y escribe
  eventos `audit.*` en `event_log`. Enganches (todos en la central):
  `_doConfirmReceivedOrder` · `_doRevertReceivedOrder` (junta `_devuelto` en el
  loop de restauración) · `discardReceivedOrder` · el `order.docs.push` de
  `confirmDocModal` · `addCajaMovement` · `deleteCajaMovement` (guarda el
  movimiento entero en `meta.audit.antes`) · `setCajaRate` y el sync de TC del
  modal del PDF · `confirmSetChinaPrice`. Todos guardan ANTES y DESPUÉS.
  - **Tamper-proofing (lo que la hace servir como constancia)**: `user_id` y
    `role` los pisa un trigger de la base (`event_log_forzar_usuario`) con la
    sesión real — el navegador no puede mentir. `actor` (nombre visible) sigue
    siendo cosmético. Sin policies de update/delete → nadie borra.
  - **Cómo consultarla** (Management API, ver más abajo): filtrar por
    `event like 'audit.%'` y mirar `meta->'audit'`.
  - **Lo que NO cubre**: si alguien entrega mercadería y cobra sin registrar
    nada en la app, no hay evento — eso se detecta por faltante de stock
    (conteo físico contra el sistema), no por la bitácora.
  - StockVendedor no cambió (los vendedores no tocan dinero); sí se sincronizó
    su `schema.sql`.

- **HECHO (2026-07-30): banco de pruebas (`pruebas.html`)** — página aparte
  (`/pruebas.html`, no linkeada desde la app) para diagnosticar stock y
  conectividad sin entorno de desarrollo. Existe la gemela en StockVendedor.
  Cuatro bloques:
  1. **Conexión** (solo lee): internet, versión del SW instalada vs publicada,
     librería CDN, config (`ns`/URL/últimos 4 de la key), sesión, **rol
     `central` en `user_stores`**, catálogo publicado (productos, peso, precios
     por lista, antigüedad), latencia, lectura de `orders`, canal de Realtime y
     permiso de escritura (línea `selftest` en `event_log`).
  2. **Stock y pedidos**: stock cargado, cantidades negativas, **colisiones de
     `_key`** (mismo detector que `buildVendorPayload`), productos sin precio
     China (salen sin precio en las 3 listas), catálogo publicado vs stock
     local, **⭐ pedidos que están en la nube y NO se importaron acá**, cursor
     `sb_orders_lastpull` vs pedido más nuevo, duplicados por `orderId`,
     pendientes que no cruzan contra el stock, confirmados sin
     `confirmSnapshot` (no reversibles) y espacio.
  3. **Pruebas automáticas (15)**: cargan **la app real** en un iframe con
     `localStorage`/`indexedDB` **falsos en memoria** (los `<script src>` de CDN
     y el registro del SW se quitan del HTML inyectado) → no tocan el stock ni
     los pedidos reales. Verifican `normalize()` contra una tabla de vectores,
     forma del `vendor_data_v2`, cruce por `_key` (con y sin clave explícita),
     ítem sin match, clamp de cantidades, dedupe por `orderId`,
     `localIdForOrder`, `dedupeReceivedOrders`, descuento al confirmar, clamp en
     0, doble confirmación, revertir (incl. con movimientos intermedios), orden
     del catálogo y la **vuelta completa** catálogo → pedido → descuento.
  4. **Limpieza**: borra de `orders` los `order_id` que empiezan con `PRUEBA-`
     (los que genera el banco del vendedor). Requiere rol `central`.
  - **Puente para mirar adentro**: `state` se declara con `const`, así que NO
    cuelga de `window`. El banco inyecta al final del HTML
    `window.__x = e => eval(e)` y toma `W.S = W.__x('state')`. Las **funciones**
    sí son propiedades del global (se pueden stubbear). `appConfirm`/`appPrompt`
    se reemplazan por promesas que responden solas.
  - Ojo con los nombres de campo: en la central el stock lleva **`extraA` =
    marca** y **`extraA2` = rubro** (así vienen las columnas del Excel), por eso
    `makeCatalogCmp()` de acá ordena por esos campos y el del vendedor por
    `marca`/`rubro`.
  - **`KEY_VECTORS` es IDÉNTICA en los dos repos**: si `normalize()` cambia en
    una sola app, ese banco se pone en rojo antes de que se rompan los pedidos.
    Si se toca `normalize()`, hay que actualizar la tabla en **ambos**.
  - Verificado corriendo los dos bancos en Chromium real (16/16 y 13/13).
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
- **HECHO (2026-07-30): texto seguro en los PDF** (`_pdfTxt` / `_pdfSafeDoc` en
  UTILS.JS). Las fuentes que trae jsPDF solo dibujan **WinAnsi**; con cualquier
  otro carácter cambia la codificación de TODA la línea y el lector la muestra
  letra por letra y cortada. Pasaba en el resumen de cuenta corriente
  (`exportClientStatement`), que escribía `≈ $ ...` → se veía `"H $ 5 0 2 ...`.
  Ahora esa línea dice "Equivalente en pesos: $ …" y, además, los dos
  generadores de PDF (`generatePDF` de DOCS.JS y `exportClientStatement`)
  envuelven el documento con `_pdfSafeDoc(doc)`, que pasa **todo** el texto
  (incluidas las tablas de autoTable) por `_pdfTxt`: reemplaza `≈ → ✓ ⚠ − ≤ ≥`
  por equivalentes y descarta emojis. Importa porque parte del texto lo escriben
  las personas (nombres de clientes, notas, productos). Al agregar texto a un PDF
  no hace falta llamar a `_pdfTxt` a mano: el wrapper ya lo cubre. Verificado
  generando los PDF con jsPDF real en Chromium (antes/después). StockVendedor no
  genera PDF, así que no aplica.
- **HECHO (2026-07-30): identidad del pedido entre dispositivos de la central.**
  Cada dispositivo bajaba los pedidos de la nube por su cuenta y le ponía un
  `localId` **al azar** (`genLocalOrderId`). Como `SYNC_ROWS.JS` identifica los
  pedidos por `local_id`, el MISMO pedido del vendedor quedaba como dos filas
  distintas en `received_orders`: confirmar o revertir en un equipo no se
  reflejaba en el otro y la lista mostraba copias repetidas (se vieron 6 pedidos
  duplicados, uno con 3 copias). Ahora:
  - `ingestVendorOrder` usa `localIdForOrder(src.orderId)` → `RO-<orderId>`,
    **igual en todos los dispositivos** (el `orderId` es único por
    `(ns, order_id)`). Los pedidos sin `orderId` (a mano / Excel viejo) siguen
    con id al azar y no se cruzan.
  - `dedupeReceivedOrders()` junta las copias que ya existían, con reglas FIJAS
    para que los dos equipos converjan igual (`_mergeOrderPair`): gana el estado
    más avanzado (confirmado > pendiente > descartado), si empatan la copia
    importada primero, `localId` = el menor alfabéticamente, y se conservan los
    comprobantes (`docs`) de las dos. Corre en el arranque (BOOT) y al final de
    `srPullAll()`; el flush marca `deleted` la fila de la copia perdedora.
  - `_applyOrderRow` cruza primero por `local_id` (misma copia → se aplica tal
    cual, así viajan confirmar Y revertir) y, si no la encuentra, por `orderId`
    (→ fusiona en vez de agregar un duplicado).
  Decisión de Julio: fusionar automáticamente; NO se revisó si algún stock quedó
  descontado dos veces (eran pedidos de prueba). Nada de esto toca a
  StockVendedor.
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
