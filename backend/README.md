# InflatCO API

API REST para el seguimiento de precios de compras de mercado en Colombia. A partir de la fotografía de una factura, extrae sus datos con IA, los normaliza contra el catálogo de productos del usuario y mide, compra a compra, la variación de precio de cada producto: si **subió, bajó o se mantuvo**.

### Principios de diseño

- **Captura basada en evidencia.** Toda compra se registra con la fotografía de su factura (hasta 2 imágenes para tiquetes largos). Gemini interpreta el documento y asocia cada línea a un producto del catálogo del usuario.
- **Calidad de imagen antes que captura manual.** Si la imagen no es legible, se solicita una nueva toma; el registro manual solo se habilita cuando no es posible obtener una imagen legible.
- **Validación humana obligatoria.** Cada línea se revisa y confirma de forma individual antes de cerrar la factura. Solo las facturas confirmadas alimentan el historial y los reportes.
- **Comparación normalizada.** Los precios se comparan por unidad base ($/g, $/ml, $/und), no por ítem, para que empaques de distinto tamaño sean comparables.
- **Contexto local.** Operación exclusiva en Colombia: montos en pesos colombianos (COP, enteros) y fechas en la zona horaria `America/Bogota`.
- **Preparado para escalar.** Modelo de datos multiusuario con aislamiento estricto por usuario desde el inicio.

## Contenido

- [Stack](#stack)
- [Arquitectura](#arquitectura)
- [Estructura del código](#estructura-del-código)
- [Puesta en marcha](#puesta-en-marcha)
- [Variables de entorno](#variables-de-entorno)
- [Comandos](#comandos)
- [Base de datos](#base-de-datos)
- [Autenticación y seguridad](#autenticación-y-seguridad)
- [API](#api)
- [Flujo de una factura](#flujo-de-una-factura)
- [Reportes](#reportes)
- [Tests](#tests)
- [Git y CI](#git-y-ci)
- [Estado del proyecto](#estado-del-proyecto)

## Stack

| Pieza | Elección |
|---|---|
| Framework | NestJS 12 (ESM), TypeScript 6, Express |
| Runtime y paquetes | Bun (`oven/bun` en Docker) |
| Base de datos | Neon Postgres 18 + Drizzle ORM (`@nestjs/drizzle`, `drizzle-orm/neon-serverless`, `drizzle-kit`) |
| Archivos | Neon Object Storage (S3) con `@nestjs/storage` (`S3Disk`, `forcePathStyle: true`), bucket privado |
| IA | `@nestjs/ai` + `@ai-sdk/google`, modelo `gemini-3.5-flash-lite` |
| Auth | `@nestjs/authentication`: email + contraseña, sesión en Postgres y cookie `__Host-session` |
| Validación | Zod 4 con `StandardSchemaValidationPipe` (`@Body({ schema })`, `@Query({ schema })`) |
| Rate limit | `@nestjs/throttler`, solo en el login |
| Config | `@nestjs/config` + validación Zod del `.env` |
| Tests | Vitest + Supertest; `FakeModel` (`@nestjs/ai/testing`) e `InMemoryDisk` |
| Calidad | oxlint (type-aware), Prettier, Husky + commitlint |
| Deploy (Fase 5) | Render (Docker, etapa `prod`) |

## Arquitectura

```
Navegador / celular
      │  (mismo origen: solo habla con SvelteKit)
      ▼
SvelteKit en Cloudflare ──/api/*──►  NestJS en Render  ──►  Neon Postgres
  (páginas + proxy)                   (toda la lógica)  ──►  Neon Object Storage
                                                        ──►  Gemini API
```

- El navegador nunca llama a la API directamente: el proxy de SvelteKit reenvía la petición con la cookie y agrega `X-Proxy-Secret` y `X-Client-IP`. Así la cookie es del mismo sitio (`SameSite=Lax`) y no hace falta CORS.
- Los secretos (Neon, storage, Gemini) solo viven en el backend.
- **Monolito modular**: un módulo por área de negocio, flujo único **controller → service → Drizzle**. El controller valida con Zod y toma el usuario de la sesión; el service tiene la lógica y usa Drizzle directamente (sin repositorios).
- **Todo service recibe `userId`** y toda consulta filtra por él. Un recurso de otro usuario responde **404**, no 403, para no revelar que existe.
- `insights` solo lee; nunca escribe.

## Estructura del código

```
src/
  main.ts                 bootstrap (x-powered-by desactivado, PORT o 3000)
  app.module.ts           config, DB, auth, throttler, storage, guards y pipe globales
  config/env.ts           schema Zod del .env (la app no arranca si falta algo)
  db/                     schema.ts (tablas Drizzle), db.module.ts, types.ts (Db, Tx)
  common/                 proxy-secret.guard, image (magic bytes, hash), dates, email, sql (escapeLike), schemas
  health.controller.ts    GET /health (select 1)
  auth/                   sign-in / sign-out / me, sesiones en Postgres, throttler del login
  users/                  UsersService
  stores/                 tiendas del usuario
  products/               catálogo del usuario
  receipts/               subir, extraer (extraction.service con Gemini), revisar, confirmar; unit-price.ts
  insights/               comparación y reportes (solo lectura); price-change.ts
scripts/user-create.ts    crea un usuario o cambia su contraseña
drizzle/                  migraciones SQL generadas por drizzle-kit
test/                     tests e2e (*.e2e-spec.ts)
neon.ts                   declaración del bucket para `neon deploy`
api.http                  requests de prueba (VS Code REST Client)
```

## Puesta en marcha

En el host **no hay Bun, Node ni npm instalados**: todo corre en Docker.

1. Docker Desktop corriendo.
2. Crear `.env` a partir de `.env.example`:
   - `DATABASE_URL`, `DATABASE_URL_UNPOOLED` y las `AWS_*` las escribe `neon env pull` (proyecto Neon `InflatCO-app`, región `aws-us-east-2`).
   - `S3_BUCKET=receipts`, `PROXY_SECRET` (`openssl rand -hex 32`) y `GOOGLE_GENERATIVE_AI_API_KEY` se agregan a mano.
3. Aplicar las migraciones: `./run.sh bun run db:migrate`
4. Crear el usuario: `./run.sh bun run user:create tu@email.com` (pide la contraseña, mínimo 12 caracteres).
5. Levantar el servidor: `./dev.sh` → `http://localhost:3000` (hot reload).
6. Probar: `GET /health` y luego `POST /auth/sign-in` con el header `X-Proxy-Secret`.

Las dependencias viven en el volumen Docker `backend_node_modules`, así que el `node_modules` del host está vacío. Para que el IDE encuentre los tipos (solo IDE):

```bash
docker run --rm -v backend_node_modules:/from -v "$PWD/node_modules":/to backend-dev cp -a /from/. /to/
```

## Variables de entorno

Se validan con Zod al arrancar (`src/config/env.ts`).

| Variable | Requerida | Uso |
|---|---|---|
| `DATABASE_URL` | sí | Conexión **pooled** de Neon, la usa la app |
| `DATABASE_URL_UNPOOLED` | migraciones | Conexión directa: `drizzle-kit` y `user:create` (no van por PgBouncer) |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | sí | Credenciales de Neon Object Storage |
| `AWS_ENDPOINT_URL_S3` | sí | Endpoint S3 de Neon (URL) |
| `AWS_REGION` | sí | Región del bucket |
| `S3_BUCKET` | sí | Nombre del bucket (`receipts`) |
| `PROXY_SECRET` | sí, ≥ 32 caracteres | Secreto compartido con el proxy de SvelteKit |
| `GOOGLE_GENERATIVE_AI_API_KEY` | sí | API key de Google AI Studio (restringida a *Generative Language API*, sin billing) |
| `AI_MODEL` | no | Modelo de Gemini, por defecto `gemini-3.5-flash-lite` |
| `PORT` | no | Puerto HTTP, por defecto `3000` |
| `NEON_*` | no | Las escribe `neon env pull`; la app no las usa |

`.env` y `.env.*` están en `.gitignore`; solo se versiona `.env.example` sin valores.

## Comandos

| Comando | Qué hace |
|---|---|
| `./dev.sh` | Construye la imagen `dev` y levanta el servidor con hot reload en `:3000` |
| `./run.sh <cmd>` | Corre cualquier comando dentro del contenedor dev con el `.env` (ej. `./run.sh bun add x`) |
| `./build.sh` | Construye la imagen de producción `backend:latest` (etapa `prod`) |
| `./run.sh bun run build` | Compila a `dist/` |
| `./run.sh bun run lint` | oxlint type-aware sobre `src/` y `test/` |
| `./run.sh bunx tsc --noEmit` | Chequeo de tipos |
| `./run.sh bun run test` | Tests unitarios (`src/**/*.spec.ts`) |
| `./run.sh bun run test:e2e` | Tests e2e (`test/*.e2e-spec.ts`), **contra la DB real de Neon** del `.env` |
| `./run.sh bun run db:generate` | Genera una migración a partir de `src/db/schema.ts` |
| `./run.sh bun run db:migrate` | Aplica las migraciones pendientes (usa `DATABASE_URL_UNPOOLED`) |
| `./run.sh bun run user:create <email>` | Crea el usuario; si ya existe, cambia la contraseña y **borra todas sus sesiones** |

Después de cambiar dependencias: `docker build --target dev -t backend-dev .` (y volver a copiar los tipos al host si se usan en el IDE).

`bunfig.toml` tiene `minimumReleaseAge = 604800`: Bun no instala versiones publicadas hace menos de 7 días.

## Base de datos

Postgres en Neon, esquema en `src/db/schema.ts`, migraciones en `drizzle/` (`0000`–`0004`).

| Tabla | Columnas clave | Notas |
|---|---|---|
| `users` | `email` único, `password_hash` | Sin roles todavía |
| `sessions` | `user_id`, `expires_at`, `last_active_at` | Store de `@nestjs/authentication` |
| `stores` | `user_id`, `name`, `type` (`cadena`/`plaza`/`barrio`), `nit` | `UNIQUE(user_id, nit)`; el tipo de tienda vive aquí y lo heredan sus facturas |
| `products` | `user_id`, `name`, `category`, `base_unit` (`g`/`ml`/`und`), `base_size` | `UNIQUE(user_id, name)`; catálogo propio de cada usuario |
| `receipts` | `user_id`, `store_id`, `purchased_at` (date), `total`, `cufe`, `status`, `entry_mode`, `unreadable_reason`, `ai_raw` | `UNIQUE(user_id, cufe)`, índice `(user_id, purchased_at)` |
| `receipt_images` | `user_id`, `receipt_id`, `position` (1 o 2), `image_key`, `image_hash` | `UNIQUE(receipt_id, position)`, `UNIQUE(user_id, image_hash)` |
| `receipt_items` | `receipt_id`, `position`, `product_id`, `new_product` (jsonb), `raw_description`, `quantity` numeric(10,3), `unit` (`kg`/`g`/`l`/`ml`/`und`), `unit_price`, `discount`, `line_total`, `unit_price_base` numeric(12,4), `confirmed` | Pertenecen al usuario a través de su factura |

Decisiones:

- `purchased_at` es `date`, no `timestamptz`: un timestamp corría el día de la factura al anterior en Bogotá.
- `status`: `unreadable` → `draft` → `confirmed`. `entry_mode = manual` solo si la factura pasó antes por `unreadable`.
- `ai_raw` guarda la respuesta original de Gemini para depurar; nunca se devuelve al cliente.
- `new_product` guarda el producto que se va a crear al confirmar, si la línea no tiene `product_id`.
- `unit_price_base` = `line_total` / cantidad en la unidad base del producto (`kg`→g ×1000, `l`→ml ×1000, `und` × `base_size`). Se calcula al confirmar (`src/receipts/unit-price.ts`).
- Las fotos se guardan en `users/{userId}/receipts/{uuid}`: borrar los datos de un usuario es borrar un prefijo.

Flujo para cambiar el esquema: editar `src/db/schema.ts` → `db:generate` → revisar el SQL generado → `db:migrate` → commitear `drizzle/` junto con el cambio.

## Autenticación y seguridad

- **Guard global `ProxySecretGuard`**: toda petición sin `X-Proxy-Secret` válido → 401 (comparación en tiempo constante). Solo `/health` queda libre.
- **Sesión**: `POST /auth/sign-in` crea una sesión en Postgres y emite la cookie `__Host-session` (`httpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, 30 días). Todo requiere sesión salvo `sign-in` y `health` (`@Public()`).
- **Throttler del login**: 5 intentos por minuto por `email|IP`. La IP sale de `X-Client-IP`, en la que solo se confía porque el `ProxySecretGuard` corre antes.
- Errores de login genéricos ("credenciales inválidas"); se loguean los fallos sin datos sensibles.
- **Aislamiento**: toda consulta filtra por `user_id`, también ítems e imágenes (a través de su factura). Hay tests e2e de aislamiento entre 2 usuarios por endpoint.
- **Mass assignment**: los schemas de `PATCH` listan solo los campos editables; `status`, `cufe`, `ai_raw`, `id` y demás se descartan.
- **SQL**: Drizzle parametriza todo; en los filtros `q` se escapan `%` y `_` (`escapeLike`).
- **Subida de archivos**: multer limita a 2 archivos de 10 MB; el tipo se valida por **magic bytes** (JPEG, PNG, WebP, HEIC); la llave es un UUID del servidor; bucket privado y URLs firmadas de 5 min.
- **Salida de la IA**: Gemini no tiene herramientas. Su salida se valida con Zod con cotas (cantidades, precios ≤ 20 M por línea y 100 M de total, fecha no futura, longitudes), y un `matchedProductId` solo se acepta si es del catálogo del usuario.
- **Fallos a mitad de camino**: si Gemini o el storage fallan, se borran las fotos y se responde 502; no queda un `draft` a medias.
- IDs de ruta validados como UUID (400 en vez de un 500 de Postgres).

## API

Todas las rutas requieren `X-Proxy-Secret` y, salvo las marcadas, la cookie de sesión. Las respuestas son JSON.

### Sistema y auth

| Método y ruta | Descripción |
|---|---|
| `GET /health` | Sin secreto ni sesión. `select 1` contra Neon |
| `POST /auth/sign-in` | Sin sesión. Body `{ email, password }` → 200 + cookie; 401 si no coincide; 429 al 6.º intento por minuto |
| `POST /auth/sign-out` | Borra la sesión → 204 |
| `GET /me` | Usuario de la sesión |

### Tiendas y productos

| Método y ruta | Descripción |
|---|---|
| `GET /stores?q=` | Tiendas del usuario, filtro por nombre |
| `PATCH /stores/:id` | `{ name?, type?, nit? }` (`nit` vacío → `null`) |
| `GET /products?q=` | Catálogo del usuario, filtro por nombre |
| `PATCH /products/:id` | `{ name?, category?, baseUnit?, baseSize? }`; nombre repetido (sin importar mayúsculas) → 409 |
| `GET /products/:id/price-history` | Ver [Reportes](#reportes) |

### Facturas

| Método y ruta | Descripción |
|---|---|
| `GET /receipts` | Listado paginado `{ data, page, limit, total }`, más reciente primero. Filtros: `storeType`, `storeId`, `from`, `to` (`YYYY-MM-DD`), `q` (tienda, producto o línea), `category`, `page`, `limit` (≤ 100) |
| `POST /receipts` | `multipart/form-data`: `images` (1 o 2 fotos, en orden) + `storeId` **o** `storeName` + `storeType`. Responde la factura en `draft` (con `warning` si la suma de las líneas no da el total) o `unreadable` con su motivo. Foto ya registrada o CUFE repetido → 409; 3 fotos o archivo que no es imagen → 400; fallo de Gemini o del storage → 502 |
| `GET /receipts/:id` | Factura, tienda, fotos e ítems (con su producto) en el orden de la factura |
| `PATCH /receipts/:id` | `{ purchasedAt?, total? }`. Solo en `draft` |
| `DELETE /receipts/:id` | Solo `draft` o `unreadable` → 204; borra también las fotos del bucket |
| `PUT /receipts/:id/images` | Reintentar fotos (multipart `images`). Solo en `unreadable`; reemplaza las fotos y vuelve a llamar a Gemini |
| `GET /receipts/:id/images` | URLs firmadas de 5 min |
| `POST /receipts/:id/manual` | `unreadable` → `draft` con `entry_mode = manual` |
| `POST /receipts/:id/items` | Solo en facturas manuales (si no → 409). `{ description, quantity, unit, unitPrice, discount?, productId \| product }`. El servidor calcula `line_total`; el ítem nace confirmado |
| `PATCH /receipts/:id/items/:itemId` | Corregir y/o confirmar una línea: `{ description?, quantity?, unit?, unitPrice?, discount?, productId? \| product?, confirmed? }`. Recalcula `line_total` si cambian cantidad, precio o descuento |
| `POST /receipts/:id/confirm` | `draft` → `confirmed`. 422 si falta fecha o total, no hay ítems, algún ítem está sin confirmar o sin producto, o las unidades no se pueden convertir. Crea los productos nuevos (reutiliza uno con el mismo nombre) y calcula `unit_price_base` |
| `POST /receipts/:id/reopen` | `confirmed` → `draft` y **desmarca todos los ítems** |
| `GET /receipts/:id/comparison` | Ver [Reportes](#reportes) |

`product` (producto nuevo) = `{ name, category, baseUnit: 'g' | 'ml' | 'und', baseSize }`.

### Reportes (`insights`)

| Método y ruta | Descripción |
|---|---|
| `GET /receipts/:id/comparison` | Precio de cada producto vs su compra anterior. 409 si la factura no está confirmada |
| `GET /products/:id/price-history` | Historial del producto. Filtros: `storeType`, `storeId`, `from`, `to` |
| `GET /insights/cheapest` | Dónde está más barato cada producto. Filtros: `storeType`, `storeId`, `from`, `to`, `q`, `category` |
| `GET /insights/spending` | Gasto agrupado. `groupBy=month` (por defecto) o `storeType`; filtros `storeType`, `storeId`, `from`, `to`, `category` |

### Códigos de error

| Código | Cuándo |
|---|---|
| 400 | Body, query o id inválidos (Zod), fotos inválidas, descuento mayor que la línea |
| 401 | Sin `X-Proxy-Secret` válido, sin sesión o credenciales inválidas |
| 404 | El recurso no existe **o es de otro usuario** |
| 409 | Estado incompatible (editar una confirmada, cambiar fotos de una legible, ítem manual en factura de IA, duplicados) |
| 422 | La factura no se puede confirmar todavía (el mensaje dice por qué) |
| 429 | Demasiados intentos de login |
| 502 | Falló Gemini o el storage; las fotos se borran y se puede reintentar |

## Flujo de una factura

```
subir foto ──► Gemini ──► ¿legible?
                            ├─ no ─► unreadable ─┬─► PUT /images (otra foto) ─► Gemini ...
                            │                    └─► POST /manual ──────────────┐
                            └─ sí ─► draft ◄─────────────────────────────────────┘
                                       │ PATCH /items/:itemId { confirmed: true } por cada línea
                                       ▼
                                   POST /confirm ──► confirmed ──► GET /comparison
                                       ▲                 │
                                       └── POST /reopen ─┘
```

1. `POST /receipts` sube las fotos al bucket y, en paralelo, llama **una vez** a Gemini con las fotos y el catálogo del usuario. Gemini dice si es legible (motivos: `borrosa`, `oscura`, `cortada`, `reflejo`, `no_es_factura`) y, si lo es, devuelve fecha, total, NIT, CUFE y las líneas con el producto del catálogo que corresponde o uno nuevo sugerido. El servidor también la marca ilegible si no salen ítems o total.
2. El usuario revisa cada línea: corrige cantidad, precio, descuento o producto (`productId` del catálogo, buscado con `GET /products?q=`, o `product` nuevo) y la marca `confirmed`.
3. `POST /confirm` valida, crea los productos nuevos, calcula el precio por unidad base y deja la factura en `confirmed`.
4. Para corregir una confirmada: `POST /reopen`, editar y volver a confirmar cada línea.

Timeouts de la IA: 40 s y 2 intentos, para no pasar los 100 s del proxy de Cloudflare.

## Reportes

Módulo `src/insights/`, solo lectura, sobre facturas **confirmadas** (los borradores no cuentan). La base de todos es el **precio por unidad base de cada producto en cada factura**; si el producto aparece en varias líneas de la misma factura, se promedia.

- **Comparación** (`GET /receipts/:id/comparison`): para cada producto de la factura, la compra anterior es la de fecha menor más reciente (el mismo día, la que se subió antes). Tendencia según el cambio relativo, con umbral fijo de ±2 % (inclusive): `subio`, `bajo`, `igual`; `nuevo` si no hay compra anterior. Respuesta:
  ```json
  {
    "receiptId": "…", "purchasedAt": "2026-02-10",
    "summary": { "subio": 0, "bajo": 1, "igual": 1, "nuevo": 1 },
    "items": [{
      "product": { "id": "…", "name": "Arroz", "category": "Granos", "baseUnit": "g", "baseSize": "500.000" },
      "unitPriceBase": 5, "trend": "bajo", "changePct": -16.7,
      "previous": { "receiptId": "…", "purchasedAt": "2026-01-10", "store": { "id": "…", "name": "…", "type": "cadena" }, "unitPriceBase": 6 }
    }]
  }
  ```
- **Historial** (`GET /products/:id/price-history`): `{ product, data: [{ receiptId, purchasedAt, store, unitPriceBase, trend, changePct }] }` en orden de compra; la tendencia es contra la entrada anterior.
- **Más barato** (`GET /insights/cheapest`): se toma el **último precio en cada tienda** (no el promedio ni el mínimo histórico, para no premiar precios viejos) y gana el más bajo. `[{ product, cheapest: { store, unitPriceBase, purchasedAt }, byStoreType: [...] }]`, donde `byStoreType` trae la tienda más barata de cada tipo, ordenadas por precio. `q` busca en producto o tienda.
- **Gasto** (`GET /insights/spending`): `{ groupBy, total, data: [{ key, total, receipts }] }`. Suma el `total` de las facturas por mes (`YYYY-MM`) o tipo de tienda. Con `category` suma solo las líneas de esa categoría. No acepta `q`: no queda claro si un texto que coincide con la tienda debe sumar la factura entera o solo una línea.

Los precios de los reportes se devuelven como número (4 decimales). El frontend los escala para mostrarlos (por ejemplo $/kg = $/g × 1000, o precio por empaque = `unitPriceBase × baseSize`).

## Tests

| Archivo | Cubre |
|---|---|
| `src/common/image.spec.ts` | Detección de tipo por magic bytes |
| `src/receipts/unit-price.spec.ts` | Precio por unidad base y `line_total` |
| `src/insights/price-change.spec.ts` | Umbral de ±2 % y casos borde |
| `test/app.e2e-spec.ts` | `/health` |
| `test/auth.e2e-spec.ts` | Login, cookie, sign-out, `X-Proxy-Secret`, throttler |
| `test/receipts.e2e-spec.ts` | Subida, extracción, ilegible, reintento, duplicados, 502, URLs firmadas, aislamiento |
| `test/review.e2e-spec.ts` | Revisión, confirmación, registro manual, reopen, filtros, borrado, productos, aislamiento |
| `test/insights.e2e-spec.ts` | Comparación, historial, más barato, gasto, filtros, aislamiento |

- Los e2e corren contra **Neon real** (la DB del `.env`), crean usuarios `*@example.com` propios y los borran al terminar (todo se borra en cascada).
- Nunca llaman a Gemini ni al bucket real: `overrideModels(builder, { default: new FakeModel() })` y `.overrideProvider(STORAGE_MODULE_OPTIONS)` con un `InMemoryDisk`.
- Prueba manual: colección Bruno local (`bruno-api/`, fuera de git porque tiene fotos reales) y `api.http`.

## Despliegue (Render)

Web Service con runtime **Docker**: Render construye la última etapa del `Dockerfile` (`prod`, `bun dist/main.js`, usuario `bun`). Sin build ni start command.

| Ajuste | Valor |
|---|---|
| Región | Ohio (misma región que Neon, `aws-us-east-2`) |
| Instancia | Free (se duerme tras ~15 min; el primer request puede tardar ~1 min) |
| Health check | `/health` (el único endpoint sin `X-Proxy-Secret`) |
| Auto-deploy | Pushes a `main` |
| Variables | Las requeridas de la tabla de arriba; `PROXY_SECRET` propio de producción (`openssl rand -hex 32`). `PORT` la pone Render; `DATABASE_URL_UNPOOLED` y `NEON_*` no hacen falta |

- **Migraciones**: el *pre-deploy command* de Render solo existe en instancias pagas. En Free se aplican desde local con `./run.sh bun run db:migrate` (misma DB de Neon) **antes** de hacer push de una migración nueva.
- Usuarios: `./run.sh bun run user:create <email>` desde local, contra la misma DB.
- El `deps` del `Dockerfile` instala con `--ignore-scripts`: sin eso el `prepare` (`husky`, devDependency) falla con 127.
- Probar la imagen antes de desplegar: `./build.sh` y `docker run --rm -p 10000:10000 -e PORT=10000 --env-file .env backend:latest`; `/health` → 200 y cualquier otra ruta → 401 sin `X-Proxy-Secret`.
- `bun audit --prod` debe salir limpio antes de cada deploy.

## Git y CI

- Ramas cortas desde `main` actualizado: `feat/…`, `fix/…`, `chore/…`, `docs/…` (descripción corta, en minúsculas y con guiones).
- Commits con [Conventional Commits](https://www.conventionalcommits.org/), en español, en imperativo y en minúsculas: `feat(reportes): comparar precios, historial, mas barato y gasto`.
- Hooks de Husky (corren en Docker): `pre-commit` → lint + `tsc --noEmit`; `commit-msg` → commitlint.
- CI (`.github/workflows/ci.yml`) en PRs y pushes a `main`: `bun install --frozen-lockfile`, lint, `tsc --noEmit`, tests unitarios y build. Los e2e no corren en CI (necesitan Neon); se corren en local antes del PR.
- Se integra por PR a `main`.

