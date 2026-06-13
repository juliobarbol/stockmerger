# PLAN-ACCESOS.md — Acceso por persona a la nube (RLS real)

> **Estado: ✅ HECHO (2026-06-13).** Implementado en una sola tanda (no hubo
> ventana de uso real, así que el corte se hizo directo). Resuelve el hallazgo
> **C1** de `AUDITORIA.md`. Este archivo queda como registro histórico; la
> documentación viva está en `schema.sql` (sección AUTH + RLS) y en la sección
> "Acceso por persona" de los CLAUDE.md de ambos repos.
>
> **Qué quedó implementado:**
> - Tabla `user_stores` (user_id, ns, role, vendor) + helper `store_role()`.
> - 6 usuarios de Auth: Julio Barrientos, Shirley Celis, Santiago Encalada
>   (central); Walter Méndez, Sergio Achaval, Jairo Leguizamón (vendor).
> - Policies estrictas por rol en todas las tablas + bucket `backups` de
>   Storage. La tabla legacy `workspace` quedó cerrada (sin policies).
> - Login email + contraseña en la sección de conexión de ambas apps; la
>   sesión se conserva en el gran reset.
> - Verificado por rol: anon no ve nada; vendedor solo lee catálogo e inserta
>   pedidos; central ve/escribe todo.
> - **Pendiente opcional**: rotar la anon key (con RLS estricta ya no sirve
>   sola; rotarla obliga a re-pegar la key nueva en todos los teléfonos).
>
> Idea en una frase: antes la anon key (que viaja en el teléfono de cada
> vendedor) abría TODA la base; ahora cada teléfono tiene su propio usuario y
> contraseña, y la base solo le permite hacer lo que le corresponde a su rol.

## 0. Contexto técnico (verificado 2026-06-12)

- Proyecto Supabase `stock-bayres`, ref `dxntcbssxjxtxznkdsot`. Con
  `SUPABASE_ACCESS_TOKEN` en el entorno se puede operar TODO por la
  Management API (`api.supabase.com`):
  - SQL directo: `POST /v1/projects/<ref>/database/query`.
  - Claves del proyecto (incl. `service_role`, para crear usuarios por la
    Admin API de Auth): `GET /v1/projects/<ref>/api-keys?reveal=true`.
  - ⚠️ NUNCA commitear tokens/keys: ambos repos se publican tal cual.
- Policies actuales: TODAS `using (true)` (verificado en `pg_policies`).
  Además de las tablas de `schema.sql` existe una tabla **`workspace`**
  (legacy, no la usa el código actual — revisar y, si está muerta, dropearla
  o cerrarla igual que el resto).
- Las apps crean el cliente con `createClient(url, anonKey)` (`scClient()`),
  supabase-js v2 (UMD, pineado con SRI). La sesión de Auth persiste sola en
  localStorage (`sb-<ref>-auth-token`) — compatible con el modelo offline.

## 1. Diseño objetivo

### Usuarios (Supabase Auth, email + contraseña)

- 1 usuario para la central (y otro por dispositivo extra de la central si
  usan "Central compartida").
- 1 usuario por vendedor. Emails internos tipo `vendedor1@<ns>.local` (no
  hace falta que existan como casillas; desactivar confirmación de email).

### Tabla de membresía

```sql
create table user_stores (
  user_id uuid not null references auth.users(id) on delete cascade,
  ns      text not null,
  role    text not null check (role in ('central','vendor')),
  vendor  text,            -- nombre visible del vendedor (para auditoría)
  primary key (user_id, ns)
);
alter table user_stores enable row level security;
-- sin policies para anon/authenticated: solo la lee el helper (security definer)

create or replace function public.store_role(p_ns text)
returns text language sql stable security definer set search_path = public as
$$ select role from user_stores where user_id = auth.uid() and ns = p_ns $$;
```

### Matriz de permisos (reemplaza a las policies abiertas)

| Tabla | Vendedor (de su `ns`) | Central (de su `ns`) |
|---|---|---|
| `catalog` | SELECT | todo |
| `orders` | INSERT | SELECT / DELETE |
| `clients` | INSERT / UPDATE / SELECT (sin DELETE: los borrados no viajan) | todo |
| `catalog_items`, `rubro_multipliers`, `settings`, `received_orders` | nada | todo |
| `backups` (tabla y/o bucket Storage) | nada | todo |
| `workspace` (legacy) | nada | nada (cerrar o dropear) |

Ejemplo del patrón (el resto igual, cambiando tabla/comando):

```sql
drop policy if exists "orders_read" on orders;
create policy "orders_read"   on orders for select using (store_role(ns) = 'central');
drop policy if exists "orders_insert" on orders;
create policy "orders_insert" on orders for insert
  with check (store_role(ns) in ('central','vendor'));
drop policy if exists "orders_delete" on orders;
create policy "orders_delete" on orders for delete using (store_role(ns) = 'central');
```

Notas:
- `catalog` usa `id` como ns → en sus policies es `store_role(id)`.
- El bucket `backups` de Storage necesita sus propias policies sobre
  `storage.objects` (hoy están para `anon`): pasarlas a
  `store_role(<ns del path>) = 'central'` o, mínimo, a `authenticated`.
- Realtime (postgres_changes) respeta RLS: el vendedor seguirá recibiendo
  los avisos de `catalog`; la central los de `orders`/`clients`. supabase-js
  v2 re-autentica el canal solo al cambiar la sesión (verificar en prueba).

## 2. Cambios en las apps (ambos repos)

1. **Login en la sección de conexión** (la que quedó detrás del candado
   `opbayressincnube`): campos email + contraseña, botones "Iniciar sesión" /
   "Cerrar sesión", y estado visible ("Sesión: vendedor1 ✓"). Usa
   `client.auth.signInWithPassword(...)`; la sesión persiste sola.
2. **Estado de sesión en los flujos**: si una operación de nube falla con
   401/403 o no hay sesión, mensaje claro ("Iniciá sesión en la sección de
   conexión") en `scStatus`/toast — distinguirlo del error de red. La cola
   offline de pedidos del vendedor ya reintenta: tras loguearse, los pedidos
   encolados salen solos (verificar).
3. **Gran reset**: agregar la clave de sesión `sb-<ref>-auth-token` a
   `GRAN_RESET_KEEP` (en ambas apps), como ya se hace con `sb_config` —
   si no, el reset desloguea.
4. `sb_config` no cambia de shape (`{url, anonKey, ns}`): la anon key sigue
   haciendo falta como "llave de entrada" de la librería; lo que manda es la
   sesión. Documentar en CLAUDE.md de ambos repos al terminar.

## 3. Orden de despliegue (para no dejar a nadie sin servicio)

1. **Preparar la nube sin romper nada**: crear `user_stores` + helper +
   usuarios (central y vendedores) y la membresía. Las policies abiertas
   siguen vigentes → todo funciona igual.
2. **Publicar las apps con login** (ambas). Pedirle a cada vendedor que entre
   una vez con su email/contraseña (instrucciones simples, las escribe la
   sesión que implemente). Verificar en `auth.users.last_sign_in_at` que
   todos entraron.
3. **El corte**: reemplazar las policies abiertas por las estrictas (un solo
   script idempotente; actualizar también `schema.sql` en ambos repos).
   Probar el ciclo completo: publicar catálogo → bajar en vendedor → enviar
   pedido → importar → confirmar. Probar también backups en nube y gran reset.
4. **Después del corte (opcional, recomendado)**: rotar la anon key
   (Management API) — con RLS estricta la key vieja sola ya no sirve de nada,
   pero rotarla limpia el legado. Ojo: rotar obliga a re-pegar la key nueva
   en TODOS los teléfonos (sección de conexión, contraseña del candado).

## 4. Decisiones que hay que pedirle a Julio el día que se haga

- Lista de vendedores activos (cuántos usuarios crear y con qué nombre).
- Contraseñas: las inventa él o se generan y se las pasa (recomendado:
  generadas, una por vendedor, enviadas por privado).
- Si la central corre en más de un dispositivo (¿usuario extra o el mismo?).

## 5. Al terminar

- Actualizar `schema.sql` (ambos repos), la sección RLS de los CLAUDE.md,
  el hallazgo C1 de `AUDITORIA.md` y borrar este archivo (o marcarlo HECHO).
