# Plan: App de facturas de mercado (Backend)

> Documento vivo. Se actualiza antes y durante cada fase.
> Estado: **Fase 2 completada — siguiente: Fase 3**

## Objetivo

App web (al inicio personal, preparada para más usuarios) para registrar cada factura de mercado con una foto, extraer sus detalles con IA (Gemini free tier), guardarlos en Neon Postgres y, a partir del segundo registro, indicar si cada precio **subió, bajó o se mantuvo** respecto al mercado anterior (cada 15–30 días).

## Principios

- **Sencillo y entendible para cualquier dev.** Pocas tablas, pocos endpoints. Nada de capas o abstracciones "por si acaso".
- **Multiusuario desde el modelo de datos, un usuario al arrancar.** Cada dato pertenece a un usuario (`user_id`) desde el día 1; abrir la app a más personas no debe requerir migrar datos ni reescribir servicios.
- **Toda compra entra con foto** de su factura o recibo. Sin recibo, no se registra.
- **La foto debe ser legible.** Si no lo es, se pide tomarla de nuevo con buena iluminación. Solo en ese caso se permite registrar los productos a mano.
- **El usuario elige el tipo de tienda** al subir la foto: `cadena` · `plaza` · `barrio`.
- **Cada producto de la lista se confirma uno por uno** antes de poder confirmar la factura.
- **Solo facturas confirmadas** cuentan para el historial de precios.
- **Comparar precio por unidad base** ($/g, $/ml, $/und), no por ítem.
- **Solo Colombia**: montos como **enteros en COP**, fechas en `America/Bogota`.

## Convenciones de código

- Estructura por módulo de negocio (`src/receipts`, `src/products`, …): `*.module.ts`, `*.controller.ts`, `*.service.ts`, `*.schemas.ts`.
- Los services usan Drizzle directamente. Sin capa de repositorios ni interfaces extra.
- Validación con Zod (`@Body({ schema })`), un archivo `*.schemas.ts` por módulo.
- **Comentarios solo cuando aportan**: técnicos, cortos, y explicando el *por qué* (una regla de negocio, un workaround, un límite externo). Nada de comentarios que repitan lo que el código ya dice, ni JSDoc obvio, ni banners.
- Nombres claros > comentarios.

## Arquitectura del backend

**Monolito modular**: una sola app NestJS, un módulo por área de negocio. Es lo más liviano que escala bien a decenas o cientos de usuarios.

```
src/
  main.ts
  app.module.ts
  config/          env.schema.ts (Zod)
  db/              schema.ts (tablas Drizzle), db.module.ts
  common/          proxy-secret.guard.ts, utilidades pequeñas (dinero, fechas)
  auth/            sign-in, sign-out, me, sesiones
  users/           users.service.ts
  stores/
  receipts/        controller, service, extraction.service.ts (Gemini), schemas
  products/
  insights/        comparación y reportes (solo lectura)
scripts/
  user-create.ts
drizzle/           migraciones generadas por drizzle-kit
```

Reglas:
- Flujo único: **controller → service → Drizzle**. El controller valida (Zod) y lee el usuario de la sesión; el service tiene la lógica.
- **Todo service recibe `userId`** y toda consulta filtra por él. Un recurso de otro usuario responde **404** (no 403, para no revelar que existe).
- Los módulos se usan entre sí importando el service exportado (p. ej. `receipts` usa `ProductsService`). Sin eventos, colas, CQRS ni microservicios.
- Las llaves del bucket van por usuario: `users/{userId}/receipts/{uuid}`. Así borrar los datos de un usuario es borrar un prefijo.
- `insights` solo lee; nunca escribe.

### Camino de crecimiento (solo cuando haga falta)

| Cuando… | Se agrega |
|---|---|
| Entra el 2.º usuario | Invitación o registro (`POST /auth/sign-up`), con throttler. Política de privacidad y borrado de cuenta (`DELETE /me`), exigidos por la **Ley 1581 de 2012 (Habeas Data)** al tratar datos de terceros |
| Varios usuarios suben facturas | Límite diario de facturas por usuario (la cuota de Gemini es **por proyecto**, compartida por todos) |
| Se agota el free tier de Gemini | Tier pago de Gemini (y deja de usar los datos para entrenamiento) |
| Render free se queda corto | Instancia paga de Render (sin dormirse) |
| Neon pasa de 1 GB | Plan pago de Neon |
| La extracción tarda demasiado para responder en el request | Procesarla en segundo plano y que el frontend consulte el estado |

## Stack

| Pieza | Elección |
|---|---|
| Framework | NestJS 12 (ESM, Vitest, oxlint) — ya scaffoldeado |
| Package manager / runtime | Bun (`bun add`, `bun run`, `bunx`) |
| DB | Neon Postgres + `@nestjs/drizzle` + `drizzle-orm` + `@neondatabase/serverless` + `drizzle-kit` |
| Imágenes | Neon Object Storage (S3) vía `@nestjs/storage` (`S3Disk`, `forcePathStyle: true`), bucket privado |
| IA | `@nestjs/ai` + `@ai-sdk/google` + `zod`, modelo `gemini-3.5-flash-lite` (Google AI Studio, free) |
| Auth | `@nestjs/authentication`: email + contraseña, sesión en cookie `httpOnly` |
| Rate limit | `@nestjs/throttler`, solo en el login |
| Config | `@nestjs/config` + validación Zod del `.env` |
| Hosting API | Render (Docker, `Dockerfile` existente) |
| Frontend | SvelteKit en Cloudflare (adapter `@sveltejs/adapter-cloudflare`), al final |

## Arquitectura

```
Navegador / celular
      │  (mismo origen: solo habla con SvelteKit)
      ▼
SvelteKit en Cloudflare ──/api/*──►  NestJS en Render  ──►  Neon Postgres
  (páginas + proxy)                   (toda la lógica)  ──►  Neon Object Storage
                                                        ──►  Gemini API
```

- **El navegador nunca llama a Render directamente.** SvelteKit tiene una ruta `/api/[...path]` que reenvía la petición (con la cookie) a NestJS.
- Por qué: `*.pages.dev` / `*.workers.dev` y `*.onrender.com` son sitios distintos; una cookie de sesión entre ellos necesitaría `SameSite=None`, que Safari bloquea. Con el proxy la cookie es del mismo origen: `SameSite=Lax` funciona y **no hace falta CORS**.
- Las llaves de Gemini, Neon y el storage **solo viven en Render**. El frontend no tiene secretos, solo `API_URL`.
- Alternativa si algún día se compra un dominio: `app.midominio.com` (Cloudflare) + `api.midominio.com` (Render) también es mismo sitio y permite quitar el proxy.

## Notas de infraestructura

- **Neon**: crear el proyecto en **AWS US East** (`aws-us-east-1` o `aws-us-east-2`); Object Storage solo existe en algunas regiones. Free: 1 GB DB, 5 GB storage, la DB se suspende tras 5 min sin uso.
- **Render free** se duerme tras ~15 min sin tráfico: el primer request tarda (puede pasar de 30 s). El frontend debe mostrar un "cargando" en vez de fallar.
- **Cloudflare free**: el proxy solo reenvía bytes, así que entra en los límites gratis; 2 fotos de ≤ 10 MB caben en el límite de body de Cloudflare.
- **Bun runtime**: la imagen `prod` corre `bun dist/main.js`. Si algún paquete falla bajo Bun, solo la etapa `prod` pasa a `node:22-alpine`.
- **Gemini free**: límites visibles en AI Studio → *Rate limits*; de sobra para 2–4 facturas al mes. Google puede usar los datos del free tier. El modelo va en `AI_MODEL` para cambiarlo sin tocar código.

## Autenticación

- Al inicio los usuarios se crean con `bun run user:create <email>` (pide la contraseña, mínimo 12 caracteres). Volver a correrlo con el mismo email cambia la contraseña **y borra todas las sesiones** (sirve si se pierde el celular).
- Sin registro público, sin email, sin recuperación de contraseña por correo (se agregan con el 2.º usuario, ver *Camino de crecimiento*).
- Sesión guardada en Postgres, cookie `__Host-session`: `httpOnly` + `Secure` + `SameSite=Lax` + `Path=/`, sin `Domain`, ~30 días. Nueva sesión en cada login; sign-out la borra en la DB.
- Error genérico en el login ("credenciales inválidas"), sin decir si el email existe.
- Throttler en el login: 5 intentos/min **por email** y por IP del cliente.
- Guard global: todo requiere sesión salvo `POST /auth/sign-in` y `GET /health`.

Endpoints: `POST /auth/sign-in` · `POST /auth/sign-out` · `GET /me`

> La cookie funciona porque el navegador solo habla con SvelteKit (ver *Arquitectura*). NestJS no necesita CORS.

## Seguridad

Barrido basado en OWASP Top 10 2025 y OWASP Top 10 para LLM. Solo lo que aplica a esta app, pensando en que tendrá más usuarios.

### Lo que se implementa

| Riesgo | Medida | Fase |
|---|---|---|
| **Acceso a datos de otro usuario (IDOR)** | Toda consulta filtra por el `userId` de la sesión, también en ítems e imágenes (vía su factura). Recurso ajeno → 404. Test por endpoint: el usuario B no puede leer, editar ni borrar nada del usuario A | 1–4 |
| **Secretos en el repo** | El proyecto **no tiene `.gitignore` ni git** todavía. Crear `.gitignore` (`.env*`, `node_modules`, `dist`, `coverage`) **antes** de crear el `.env`. Solo se versiona `.env.example` sin valores | 0 |
| **Config insegura** | El `.env` se valida con Zod al arrancar: si falta algo, la app no inicia. `app.disable('x-powered-by')`. Errores 500 sin stack trace (comportamiento por defecto de Nest) | 0 |
| **Dependencias (supply chain)** | `bunfig.toml` con `minimumReleaseAge = 604800` (7 días). `bun.lock` versionado y `bun install --frozen-lockfile` en Docker (ya está). Bun no corre scripts `postinstall` de dependencias salvo `trustedDependencies`. Revisar con `bun audit` antes de cada deploy | 0 / 5 |
| **API de Render expuesta** | La URL `*.onrender.com` es pública aunque el navegador no la use. El proxy de SvelteKit envía un header `X-Proxy-Secret`; NestJS rechaza (401) cualquier petición sin él, comparando en tiempo constante. `/health` queda libre para el health check de Render | 1 / 6 |
| **IP real del cliente** | Detrás del proxy todas las peticiones llegan con la IP de Cloudflare, lo que rompería el throttler. El proxy reenvía `CF-Connecting-IP` como `X-Client-IP`, y NestJS solo lo acepta si el `X-Proxy-Secret` es válido | 1 / 6 |
| **CSRF** | `SameSite=Lax` evita que otro sitio envíe la cookie en un POST. Los endpoints que modifican datos solo aceptan `application/json` o `multipart/form-data` | 1 |
| **Mass assignment** | Los schemas Zod de `PATCH` listan solo los campos editables; los campos desconocidos se descartan. `status`, `image_key`, `ai_raw` e `id` nunca se aceptan del cliente | 3 |
| **Inyección SQL** | Drizzle parametriza todo. Nunca `sql.raw()` con datos del usuario. En `q` se escapan `%` y `_` antes del `ILIKE` | 2 / 3 |
| **Subida de archivos** | Límite de multer: máximo 2 archivos, 10 MB cada uno y pocos campos. El tipo se valida por **magic bytes**, no por el `Content-Type` del cliente. La llave del objeto es un UUID generado en el servidor, nunca el nombre original. Bucket privado y URL firmada de 5 min | 2 |
| **Prompt injection en la foto** | Una factura podría traer texto como "ignora las instrucciones…". Gemini no tiene herramientas ni acceso a nada, y la salida se valida con Zod con límites (cantidades > 0, precios dentro de un rango razonable, fecha no futura, textos con longitud máxima). Lo que no valida se rechaza | 2 |
| **XSS** | La IA genera los textos (descripciones, nombres). La API solo devuelve JSON; Svelte escapa por defecto. Regla: **nunca `{@html}`** con datos de la API | 6 |
| **Proxy SSRF** | El proxy arma la URL como `API_URL + path` y no acepta host ni URL absoluta del cliente. Reenvía solo `Cookie`, `Content-Type` y el body, y devuelve el `Set-Cookie` | 6 |
| **Fallos a mitad de camino** | Si Gemini falla después de subir las fotos, se borran y se responde 502; no queda un `draft` a medias. El hash duplicado solo cuenta para facturas guardadas, así que se puede reintentar | 2 |
| **Llave de Gemini** | En Google Cloud, restringir la API key a *Generative Language API*. **No asociar billing** al proyecto de AI Studio: en free tier no se puede generar cobro | 0 |
| **Logs** | Se loguean logins fallidos y errores 5xx. Nunca contraseñas, cookies, API keys ni el `.env` | 1 |
| **Transporte** | HTTPS por defecto en Render, Cloudflare y Neon (`sslmode=require` en `DATABASE_URL`). HSTS activado en Cloudflare | 5 / 6 |
| **Contenedor** | La imagen `prod` ya corre como usuario `bun`, no root | ✅ |

### Lo que se descarta a propósito

Con pocos usuarios no compensa: Helmet (la API solo devuelve JSON; las cabeceras de seguridad del HTML van en SvelteKit/Cloudflare), WAF, 2FA (queda opcional), roles separados en Postgres, borrar EXIF/GPS de las fotos (el bucket es privado), antivirus de archivos, rotación automática de secretos y logging centralizado.

## Modelo de datos

```
users(id, email UNIQUE, password_hash, created_at)
sessions(...)                    -- lo que pide el store de @nestjs/authentication

stores(id, user_id, name, type[cadena|plaza|barrio], nit NULL, created_at,
       UNIQUE(user_id, nit))

receipts(id, user_id, store_id, purchased_at NULL, total NULL, cufe NULL,
         status[unreadable|draft|confirmed], entry_mode[ai|manual],
         unreadable_reason NULL, ai_raw jsonb NULL, created_at,
         UNIQUE(user_id, cufe), INDEX(user_id, purchased_at))

receipt_images(id, user_id, receipt_id, position CHECK (1, 2), image_key, image_hash,
               UNIQUE(receipt_id, position), UNIQUE(user_id, image_hash))

receipt_items(id, receipt_id, product_id NULL, raw_description,
              quantity numeric(10,3), unit[kg|g|l|ml|und],
              unit_price, discount, line_total, unit_price_base NULL,
              confirmed boolean DEFAULT false)

products(id, user_id, name, category, base_unit[g|ml|und], base_size,
         UNIQUE(user_id, name))
```

- **`user_id` en `stores`, `receipts`, `receipt_images` y `products`**. Los `receipt_items` pertenecen al usuario a través de su factura. Las restricciones únicas son por usuario (dos personas pueden comprar en la misma tienda o subir la misma factura).
- **Tiendas y productos son por usuario**, no un catálogo compartido: cada quien tiene su propio catálogo, que es pequeño y cabe en el prompt de Gemini. Un catálogo global (comparar precios entre usuarios) es otra decisión de producto, no se prepara ahora.
- `users` no tiene roles todavía; se agregan solo si aparece un panel de administración.

- El **tipo de tienda vive en `stores`**: se elige una vez y todas sus facturas lo heredan.
- **Máximo 2 fotos por factura** (`position` 1 o 2), para tiquetes largos. La base de datos lo impone con el `CHECK` y el `UNIQUE`.
- `image_hash` y `cufe` evitan que un usuario registre la misma factura dos veces.
- `ai_raw` guarda la respuesta original de Gemini para depurar.
- `unit_price_base` = precio por g / ml / und, se calcula al confirmar.
- `quantity` admite decimales para productos a granel (`1.250` kg de carne); los montos siguen siendo enteros en COP.
- `entry_mode = manual` solo es posible si la factura pasó antes por `unreadable`.

## Flujo principal

```
subir foto ──► Gemini ──► ¿legible?
                            ├─ no ─► unreadable ─┬─► tomar foto de nuevo ─► Gemini ...
                            │                    └─► registrar a mano ─────┐
                            └─ sí ─► draft ◄────────────────────────────────┘
                                       │ confirmar cada producto
                                       ▼
                                   confirmed ──► comparación de precios
```

1. **Subir** — `POST /receipts` (multipart): `images` (**1 o 2 fotos**, en orden: parte de arriba y parte de abajo) + (`storeId` **o** `storeName` + `storeType`). Una 3.ª foto → 400.
   - Se guardan las fotos en Neon Storage y se llama **una vez** a Gemini con las fotos (indicando que son partes de la misma factura) y la lista de productos ya conocidos **del usuario**.
   - Gemini primero dice si las fotos son **legibles** (`readable` + motivo: `borrosa`, `oscura`, `cortada`, `reflejo`, `no_es_factura`). El servidor también la marca ilegible si no salen productos o total.
   - **Legible** → `draft` con fecha, total, CUFE/NIT si existen, y por cada línea: descripción, cantidad, unidad, precios y el **producto conocido que corresponde** (o un nombre nuevo con categoría, unidad y tamaño). Si `Σ líneas ≠ total`, la respuesta trae un aviso.
   - **Ilegible** → `unreadable` con el motivo. La respuesta le indica al frontend que pida **tomar la foto de nuevo con buena iluminación**.
2. **Reintentar fotos** — `PUT /receipts/:id/images` (solo en `unreadable`): reemplaza las fotos (1 o 2; borra las anteriores del bucket) y vuelve a llamar a Gemini. Se puede repetir hasta que salgan legibles.
3. **Registro manual (solo si la foto no se pudo leer)** — `POST /receipts/:id/manual` pasa una factura `unreadable` a `draft` con `entry_mode = manual`. La foto se conserva como soporte. Luego:
   - `PATCH /receipts/:id` → fecha y total.
   - `POST /receipts/:id/items` → `description`, `quantity`, `unit` (`kg`, `g`, `l`, `ml`, `und`), `unitPrice`, `discount` opcional, y `productId` **o** producto nuevo (`name`, `category`, `baseUnit`, `baseSize`). `line_total` lo calcula el servidor.
   - Agregar ítems a mano solo se permite con `entry_mode = manual`; en una factura leída por la IA → 409.
4. **Revisar y confirmar cada producto** — `GET /receipts/:id`, luego por cada línea `PATCH /receipts/:id/items/:itemId` para corregir y/o marcar `confirmed: true`. Los ítems de la IA empiezan sin confirmar; los manuales nacen confirmados porque los escribió el usuario.
   - **Si Gemini asoció mal el producto, el usuario lo corrige a mano**: busca el correcto con `GET /products?q=` y envía su `productId`, o crea uno nuevo (`name`, `category`, `baseUnit`, `baseSize`). No hay una segunda sugerencia automática.
5. **Confirmar factura** — `POST /receipts/:id/confirm`. Responde **422** si hay algún ítem sin confirmar, algún ítem sin producto, la factura no tiene ítems o faltan fecha/total. Si todo está bien: crea los productos nuevos, calcula `unit_price_base` y pasa a `confirmed`.
6. **Corregir una factura ya confirmada** — `POST /receipts/:id/reopen` la regresa a `draft` y **desmarca todos los ítems**: hay que confirmarlos de nuevo antes de volver a guardarla. Mientras está en `draft` no cuenta en el historial.
7. **Comparar** — `GET /receipts/:id/comparison`: por cada producto, precio anterior vs actual → `subió` / `bajó` / `igual` (umbral fijo ±2 %).

**Por qué funciona la normalización con una sola llamada:** el catálogo personal es pequeño (cientos de productos), así que cabe en el prompt y Gemini elige el producto existente. Lo que falle se corrige en la revisión.

## Filtros

`GET /receipts` y los endpoints de reportes aceptan:

| Filtro | Param |
|---|---|
| Tipo de tienda | `storeType` |
| Tienda | `storeId` |
| Fechas | `from`, `to` (`YYYY-MM-DD`) |
| Texto (tienda o producto) | `q` (`ILIKE`) |
| Categoría | `category` |

Paginación simple: `?page=&limit=`.

---

## Fases

### Fase 0 — Fundaciones
- [x] `git init` + `.gitignore` (antes de crear el `.env`)
- [x] `bunfig.toml` con `minimumReleaseAge = 604800`
- [x] Proyecto Neon (US East) + bucket privado
- [x] API key de Gemini (en `.env`, probada con `gemini-3.5-flash-lite`) — confirmar en Google Cloud que está restringida a *Generative Language API* y sin billing
- [x] `@nestjs/config` + validación Zod del `.env` (`DATABASE_URL`, `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET`, `PROXY_SECRET`; `GOOGLE_GENERATIVE_AI_API_KEY` y `AI_MODEL` opcionales hasta la Fase 2)
- [x] `app.disable('x-powered-by')`
- [x] Drizzle + Neon: conexión, `drizzle.config.ts`, primera migración
- [x] `@nestjs/storage` con `S3Disk` → Neon
- [x] `GET /health` (controller simple con `select 1`)
- [x] `.env.example` y `api.http` (requests de prueba para VS Code REST Client)

**Hecho cuando:** la app arranca, conecta a Neon y `/health` responde OK.

### Fase 1 — Autenticación
- [x] Tablas `users` + `sessions`
- [x] Script `user:create` (mínimo 12 caracteres; al cambiar la contraseña borra las sesiones)
- [x] Sign-in / sign-out / me + guard global + throttler en sign-in (por email + `X-Client-IP`)
- [x] Guard de `X-Proxy-Secret` (excepto `/health`)
- [x] Log de logins fallidos (sin datos sensibles)
- [x] Tests: login OK, contraseña mala, sin cookie → 401, sin `X-Proxy-Secret` → 401, 6.º intento → 429

**Hecho cuando:** sin sesión no se puede usar la API.

### Fase 2 — Subir y extraer
- [x] Tablas `stores`, `receipts`, `receipt_images`, `receipt_items`, `products`
- [x] `GET /stores?q=` y `PATCH /stores/:id`
- [x] `POST /receipts` con 1 o 2 fotos: límites de multer, tipo por magic bytes (jpeg/png/webp/heic, ≤ 10 MB c/u), hash duplicado del mismo usuario → 409, llave `users/{userId}/receipts/{uuid}`, subir a storage, llamar a Gemini, guardar `draft` o `unreadable`
- [x] Schema Zod de la salida de Gemini con `readable` + motivo y límites (cantidades, precios, fecha, longitudes)
- [x] `PUT /receipts/:id/images` (reintentar fotos, solo en `unreadable`)
- [x] Si Gemini falla: borrar las fotos y responder 502
- [x] `GET /receipts/:id/images` → URLs firmadas de 5 min
- [x] Tests con respuesta de Gemini simulada (incluye foto ilegible, 2 fotos, 3 fotos → 400, salida inválida y archivo que no es imagen)
- [x] Prueba manual con una foto real (Gemini real) y una borrosa

**Hecho cuando:** subo una foto real y veo la factura extraída en Neon; una foto borrosa queda en `unreadable` con su motivo.

### Fase 3 — Revisar y confirmar
- [ ] `GET /receipts` (con filtros) y `GET /receipts/:id`
- [ ] `PATCH` de factura e ítems, con `confirmed` por ítem (schemas con solo los campos editables)
- [ ] `POST /receipts/:id/manual` y `POST /receipts/:id/items` (solo si la factura pasó por `unreadable`)
- [ ] Escapar `%` y `_` en el filtro `q`
- [ ] `POST /receipts/:id/confirm` (422 si falta confirmar algún ítem)
- [ ] `POST /receipts/:id/reopen` (vuelve a `draft` y desmarca los ítems)
- [ ] `DELETE /receipts/:id` (solo `unreadable` o `draft`)
- [ ] `GET /products?q=` y `PATCH /products/:id`
- [ ] Tests: confirmar con ítems pendientes → 422, ítem manual en factura de IA → 409, reopen desmarca todo
- [ ] Tests de aislamiento con 2 usuarios: B recibe 404 al leer, editar o borrar facturas, ítems, fotos, tiendas o productos de A

**Hecho cuando:** puedo revisar producto por producto, confirmarlos todos y luego confirmar la factura; y registrar a mano solo cuando la foto no se pudo leer.

### Fase 4 — Comparación y reportes
- [ ] `GET /receipts/:id/comparison` (vs la compra anterior de cada producto)
- [ ] `GET /products/:id/price-history`
- [ ] `GET /insights/cheapest` (dónde y en qué tipo de tienda está más barato cada producto)
- [ ] `GET /insights/spending?groupBy=month|storeType` (gasto)

**Hecho cuando:** al confirmar un mercado veo qué subió, qué bajó y qué se mantuvo.

### Fase 5 — Despliegue
- [ ] Render: Docker (etapa `prod`), región Ohio/Virginia, health check `/health`
- [ ] Migraciones `bunx drizzle-kit migrate` como pre-deploy command
- [ ] Secretos solo en Render (`PROXY_SECRET` generado con `openssl rand -hex 32`)
- [ ] `bun audit` sin vulnerabilidades altas o críticas
- [ ] Verificar runtime Bun en producción

### Fase 6 — Frontend SvelteKit en Cloudflare
- [ ] SvelteKit + `@sveltejs/adapter-cloudflare` (usable desde el celular para tomar la foto)
- [ ] Proxy `src/routes/api/[...path]/+server.ts` → `API_URL + path` (sin host del cliente), reenviando solo `Cookie`, `Content-Type` y body, más `X-Proxy-Secret` y `X-Client-IP`; devuelve `Set-Cookie`
- [ ] Deploy en Cloudflare con `API_URL` y `PROXY_SECRET` como secretos; HSTS activado
- [ ] CSP con `kit.csp` de SvelteKit; nunca `{@html}` con datos de la API
- [ ] Pantallas: login, subir factura, revisar / confirmar, comparación, historial, búsqueda
- [ ] Al tomar la foto: consejos (buena luz, sin reflejos, factura completa y plana) y opción **Agregar 2.ª foto** para tiquetes largos (máximo 2). Si queda `unreadable`: mensaje según el motivo ("La foto está oscura, tómala de nuevo con buena iluminación"), botón principal **Tomar de nuevo** y secundario **Registrar a mano**
- [ ] Revisión: lista con un check por producto; el botón **Confirmar factura** solo se habilita con todos marcados

### Después (solo si se necesita)
- Modelo de respaldo si Gemini falla seguido
- Alertas de subidas fuertes, presupuesto, export CSV

---

## Riesgos

- Fotos borrosas u oscuras: Gemini las marca `unreadable` y se pide tomarlas de nuevo con buena iluminación. Solo si no se logra una foto legible se registran los productos a mano.
- Tiquetes muy largos: se permiten **máximo 2 fotos por factura**. Si no cabe en 2, se toman con el tiquete más lejos o doblado sin tapar líneas.
- Gemini puede decir que una foto es legible y aun así leer mal algún dato: por eso cada producto se confirma uno por uno.
- Productos a granel (frutas, carnes) vienen por peso: `quantity` con decimales y `unit` en `kg` o `g`. **Hay que pedir la factura en el local o la tienda** y subirla, porque de ahí salen el peso y el precio.
- Gemini puede asociar mal un producto: **el usuario lo corrige manualmente** al revisar ese ítem (elige el producto correcto o crea uno nuevo) antes de marcarlo como confirmado.

## Bitácora

| Fecha | Cambio |
|---|---|
| 2026-11-17 | Plan inicial y decisiones: Neon (DB + Storage), `@nestjs/authentication`, Bun, Render, `gemini-3.5-flash-lite`, solo Colombia, tipos de tienda `cadena` / `plaza` / `barrio`, solo compras con foto |
| 2026-11-17 | **Simplificación**: un solo usuario (sin `user_id`), auth mínima, una sola llamada a Gemini que también normaliza productos, sin alias / `pg_trgm` / modelo de respaldo, menos filtros y reportes, sin Swagger ni Terminus, 9 → 7 fases. Se agregan convenciones de código y de comentarios |
| 2026-11-17 | Arquitectura confirmada: SvelteKit en Cloudflare, NestJS en Render, Neon (DB + Storage), Gemini API. SvelteKit hace de proxy `/api/*` para que la cookie sea del mismo origen; sin CORS |
| 2026-11-17 | Barrido de seguridad (OWASP 2025 + LLM): `.gitignore` (faltaba), `minimumReleaseAge`, `X-Proxy-Secret`, IP real para el throttler, cookie `__Host-`, magic bytes, validación de la salida de Gemini, limpieza si Gemini falla, API key restringida y sin billing. Se listan las medidas descartadas |
| 2026-11-17 | Foto legible obligatoria: estado `unreadable` con motivo y reintento de foto (`PUT /receipts/:id/image`). Registro manual de productos solo si la foto no se pudo leer (`entry_mode = manual`). Confirmación obligatoria de cada ítem antes de confirmar la factura; `reopen` desmarca todo. `quantity` decimal + `unit` para granel |
| 2026-11-18 | Máximo 2 fotos por factura (tabla `receipt_images`, endpoints `/images`). Corrección manual del producto mal asociado. Granel: pedir siempre la factura en el local |
| 2026-11-18 | Arquitectura: monolito modular (controller → service → Drizzle) con estructura de carpetas definida. **Multiusuario desde el modelo**: vuelve `user_id` a `stores`, `receipts`, `receipt_images`, `products`, únicos por usuario, llaves del bucket por usuario, 404 en recursos ajenos y tests de aislamiento. Se agrega *Camino de crecimiento* (registro, Habeas Data, cuota de Gemini, planes pagos) |
| 2026-11-18 | Fase 0 casi lista: proyecto `InflatCO-app` en Neon (aws-us-east-2) con bucket `receipts`, `neon.ts` + `neon deploy` provisionan los servicios y escriben `.env`. Neon entrega vars `AWS_*` (no `S3_*`); `S3_BUCKET` y `PROXY_SECRET` se agregan a mano. Drizzle con `@nestjs/drizzle` + `drizzle-orm/neon-serverless` (pooled para la app, `DATABASE_URL_UNPOOLED` para migraciones), `S3Disk` con `forcePathStyle`, `/health` responde OK. Skills de Neon instaladas en `.devin/skills/`. Pendiente: API key de Gemini |
| 2026-11-18 | Limpieza de sobreingeniería: fuera `ws` y `@neon/env` (sin uso), `@neon/config` a devDependencies, `neon.ts` solo con el bucket, vars de Gemini salen del env hasta la Fase 2, se borra el Hello World del scaffold (el e2e ahora prueba `/health`), `package.json` alineado con Bun |
| 2026-11-18 | Fase 1 completada: tablas `users` y `sessions` migradas a Neon, script `user:create` con scrypt y reseteo de sesiones, autenticación por cookies `__Host-session` con `@nestjs/authentication`, `ProxySecretGuard` global protegiendo todos los endpoints (salvo `/health`), throttler en login por `${email}|${clientIp}`, log seguro de logins fallidos, y suite de tests e2e pasando al 100%. |
| 2026-11-19 | Revisión de la Fase 1: `PROXY_SECRET` fuera de `api.http` (`{{$dotenv PROXY_SECRET}}`), `normalizeEmail` único en `common/email.ts` (el script no aplicaba NFC), test de `X-Proxy-Secret` sobre `POST /auth/sign-in` (antes pasaba aunque no hubiera guard), los e2e borran su usuario de prueba, `AuthenticationModule.forRoot` sin repetir los defaults de la cookie, `UsersService` con `select` de columnas, `normalizeIp` en el throttler, `z.email()` |
| 2026-11-19 | Fase 2: tablas migradas (0002) y `purchased_at` pasa a `date` (0003; un `timestamptz` corría la fecha al día anterior en Bogotá). `AiModule` vive en `ReceiptsModule` (no es global), timeout 40 s y 2 intentos para no pasar los 100 s de Cloudflare. Subida a storage y Gemini en paralelo; si algo falla se borran las fotos (502) y el hash queda libre. Guardado en una transacción; CUFE repetido → 409. Las imágenes van como partes `file` (la parte `image` está deprecada en AI SDK 7). Ilegible si la IA lo dice o si no hay ítems (`no_es_factura`) o total (`cortada`). El NIT leído se guarda en la tienda solo si no tiene y no lo usa otra. `matchedProductId` solo se acepta si es del catálogo del usuario; `suggestedProduct` se devuelve por ítem y queda en `ai_raw` (la Fase 3 lo usa para crear productos). Ids de ruta validados como UUID (400). Tests e2e con `FakeModel` + `InMemoryDisk` sobre Neon real, incluidos los de aislamiento entre 2 usuarios. `@types/multer` agregado a `types` del tsconfig |
| 2026-11-20 | Prueba manual con foto real: Gemini rechazaba el `responseSchema` con *"too many states"* porque `extractionSchema` lleva enteros con min/max (total hasta 100 M), `items.max(200)` y `format: date`. Fix: `geminiExtractionSchema` sin cotas ni formatos para el model call y la salida se valida después con `extractionSchema.parse()` (las cotas de seguridad se conservan). `purchasedAt` tolera otro formato con `.catch(null)`, pero una fecha futura sigue rechazada (502) vía `.refine` posterior |
| 2026-11-20 | Prueba manual completa con la colección Bruno: factura real → `draft` (total 29.100, 3 ítems), foto ilegible → `unreadable` (`cortada`), duplicado → 409, archivo no imagen → 400, 3 fotos → 400, URLs firmadas y reintento OK. **Fase 2 cerrada** |
