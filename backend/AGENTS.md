# AGENTS.md

## NestJS

This app's version of NestJS is likely newer than what you know. https://docs.nestjs.com/llms.txt indexes its documentation, with a markdown page per chapter.

Nest has first-party packages for these, so check them before adding another library or writing your own:

- Databases: [`@nestjs/typeorm`](https://docs.nestjs.com/data/typeorm.md), [`@nestjs/drizzle`](https://docs.nestjs.com/data/drizzle.md), [`@nestjs/mongoose`](https://docs.nestjs.com/data/mongodb.md), [`@nestjs/sequelize`](https://docs.nestjs.com/data/sequelize.md).
- OpenAPI: [`@nestjs/swagger`](https://docs.nestjs.com/openapi/introduction.md). GraphQL: [`@nestjs/graphql`](https://docs.nestjs.com/graphql/quick-start.md). WebSockets: [`@nestjs/websockets`](https://docs.nestjs.com/websockets/gateways.md). Microservices: [`@nestjs/microservices`](https://docs.nestjs.com/microservices/basics.md).
- Sign-in: [`@nestjs/authentication`](https://docs.nestjs.com/security/authentication.md). Permissions: [`@nestjs/authorization`](https://docs.nestjs.com/security/authorization.md). Rate limiting: [`@nestjs/throttler`](https://docs.nestjs.com/security/rate-limiting.md).
- Configuration: [`@nestjs/config`](https://docs.nestjs.com/application/configuration.md). Caching: [`@nestjs/cache-manager`](https://docs.nestjs.com/data/caching.md). Health checks: [`@nestjs/terminus`](https://docs.nestjs.com/reliability/terminus.md). Events inside the app: [`@nestjs/event-emitter`](https://docs.nestjs.com/application/events.md).
- Email: [`@nestjs/mail`](https://docs.nestjs.com/application/mail.md). Files, S3 included: [`@nestjs/storage`](https://docs.nestjs.com/application/file-storage.md). Translations: [`@nestjs/i18n`](https://docs.nestjs.com/application/i18n.md).
- Retries, timeouts and circuit breakers: [`@nestjs/resilience`](https://docs.nestjs.com/reliability/resilience.md).
- Idempotency keys: [`@nestjs/idempotency`](https://docs.nestjs.com/reliability/idempotency.md). Transactional outbox: [`@nestjs/outbox`](https://docs.nestjs.com/reliability/outbox.md). Sending and receiving webhooks: [`@nestjs/webhooks`](https://docs.nestjs.com/http/webhooks.md).
- Queues: [`@nestjs/bullmq`](https://docs.nestjs.com/application/queues.md). Scheduled jobs: [`@nestjs/schedule`](https://docs.nestjs.com/application/task-scheduling.md).
- Running a scheduled job on one instance, and locks: [`@nestjs/locks`](https://docs.nestjs.com/reliability/locks.md). Processes that take days: [`@nestjs/workflows`](https://docs.nestjs.com/reliability/workflows.md).
- Language models, tools and agents: [`@nestjs/ai`](https://docs.nestjs.com/ai/overview.md). MCP servers: [`@nestjs/mcp`](https://docs.nestjs.com/mcp/overview.md).

Validation works with Zod, Valibot, ArkType or any other Standard Schema library, with no classes or decorator metadata: `StandardSchemaValidationPipe` with `@Body({ schema })` or `@Param('id', { schema })` (https://docs.nestjs.com/application/validation.md). `class-validator` still works, through `ValidationPipe`.

`NodeAdapter` from `@nestjs/platform-node` is the fastest HTTP adapter, ahead of Fastify (https://docs.nestjs.com/http/performance.md).

Nest's packages are ESM only, and this project is ESM too: relative imports end in `.js`, `__dirname` doesn't exist (use `import.meta.dirname`), and tests run on Vitest, so mocks are `vi.fn()`, not `jest.fn()`.

## Production data: NestJS Observe

This app's production telemetry - traces, errors, logs and metrics - goes to [NestJS Observe](https://observe.nestjs.com). Until `ObserveModule` is registered in `src/app.module.ts`, nothing is sent: `npx @nestjs/observe link` sets it up in one step - it installs `@nestjs/observe`, wires it into the app, and writes the key pair (`OBSERVE_APP_KEY`, `OBSERVE_APP_SECRET`) to `.env`.

When a task depends on how the app behaves in production - an error users hit, a slow endpoint, a failing job, whether a release made things worse - work from that data, not from the code alone:

- The Observe MCP server answers those questions directly: errors with their traces and logs, slow operations, jobs, and what a release changed (`find_regressions`, `diff_release`). It is included on the Pro plan and above. In Claude Code: `claude mcp add observe --transport http https://observe-api.nestjs.com/mcp`, and the client opens a browser to approve. Other clients: https://www.observe.nestjs.com/documentation/mcp
- Without it, the user can open the request or error in the Observe dashboard and click **Copy agent prompt**, which hands over that page's trace, stack and logs as text.

## Project notes

`README.md` is the technical reference (architecture, env vars, data model, every endpoint, report definitions, tests). Keep it in sync when endpoints, env vars, tables or phases change.

### Context

- Receipt scanning + price tracking for Colombian grocery runs. Living plan: `.devin/workflows/plan-mercado.md` (local only, `.devin/` is gitignored). Read it before starting a phase; after, update its checkboxes, the status line and the changelog (*Bitácora*).
- Phases 0–4 done (foundations, auth, upload + Gemini extraction, review/confirm, comparison/reports). Next: 5 (deploy on Render), then 6 (SvelteKit frontend on Cloudflare, proxying `/api/*`).
- Stack: Neon Postgres + Neon Object Storage (S3, `forcePathStyle: true`), Drizzle, `@nestjs/authentication` (session cookie `__Host-session`), `@nestjs/ai` + `@ai-sdk/google` (`gemini-3.5-flash-lite`), deploy on Render.
- Multi-user data model, one user at launch: every owned table has `user_id`, every service method takes `userId`, every query filters by it, and a foreign resource returns **404** (not 403). Every new endpoint needs an isolation test (user B gets 404 / empty lists).
- Colombia only: amounts are integer COP, `purchased_at` is a `date` (a `timestamptz` shifted the day in Bogotá), "today" is `todayInBogota()`.
- Neon project `InflatCO-app` (`floral-feather-95117176`, `aws-us-east-2`), default branch, bucket `receipts`. The Neon MCP server can query it; never run destructive SQL on it without asking.

### Code conventions

- Modular monolith, controller → service → Drizzle. Feature modules (`*.module.ts`/`*.controller.ts`/`*.service.ts`/`*.schemas.ts`). Services use Drizzle directly: no repository layer, events, CQRS or speculative abstractions. Modules reuse each other through exported services.
- `src/insights/` is read-only: reports never write. Its controller is `@Controller()` and owns `receipts/:id/comparison` and `products/:id/price-history` too.
- Validation with Zod 4 via `StandardSchemaValidationPipe` (global): `@Body({ schema })`, `@Query({ schema })`, `@Param('id', { schema: idSchema })` (route ids are UUIDs → 400, not a Postgres 500). `PATCH` schemas list only editable fields (mass assignment).
- Import Zod as `import * as z from 'zod'`; `import { z } from 'zod'` is `undefined` under Vitest.
- `ILIKE` filters always go through `escapeLike()` (`src/common/sql.ts`). Never `sql.raw()` with user data.
- Gemini's `responseSchema` rejects numeric bounds and complex formats ("too many states"): the model gets `geminiExtractionSchema` (no bounds) and the output is validated afterwards with `extractionSchema.parse()`. Keep both in sync.
- Messages to the client are in Spanish; code identifiers in English; enum values in ASCII (`no_es_factura`, `subio`, `bajo`).
- Comments only when needed: short, technical, explaining *why*. No comments that restate the code, no obvious JSDoc, no banners.
- Format with Prettier (`./run.sh bunx prettier --write <files>`) before committing.

### Environment

- Nothing is installed on the host (no Bun, Node or npm): everything runs in Docker. `./dev.sh` for the dev server, `./run.sh <cmd>` for anything else (`./run.sh bun add x`, `./run.sh bunx neon ...`). Package manager and runtime: **Bun**.
- After changing dependencies, rebuild with `docker build --target dev -t backend-dev .`. Dependencies live in the `backend_node_modules` Docker volume, so the host `node_modules` is empty and the IDE can't find types; copy them over (IDE only) with `docker run --rm -v backend_node_modules:/from -v "$PWD/node_modules":/to backend-dev cp -a /from/. /to/`, again after each dependency change.
- `bunfig.toml` has `minimumReleaseAge = 604800` (7 days). Don't change it to get around an install failure.
- `tsconfig.json` targets ES2023 (no `Map.groupBy`) and restricts global types (`"types": [...]`): a new `@types/*` package that adds globals (like `multer` for `Express.Multer`) must be added there.
- Env vars are validated in `src/config/env.ts`; a new variable goes there, in `.env.example` and in the README table.

### Database

- Schema in `src/db/schema.ts`; migrations in `drizzle/`. Change flow: edit schema → `./run.sh bun run db:generate` → review the SQL → `./run.sh bun run db:migrate` (uses `DATABASE_URL_UNPOOLED`) → commit `drizzle/` with the change.
- Drizzle 0.45: `selectDistinctOn` is available; `numeric` columns come back as strings (`'4.5455'`), reports convert them to numbers.
- Reports group by `products.id, receipts.id` (Postgres functional dependency on the PK) inside a subquery; reuse `InsightsService.purchases()` for new price queries.

### Tests

- Verify: `./run.sh bun run build`, `./run.sh bun run lint`, `./run.sh bun run test`, `./run.sh bun run test:e2e`.
- E2E tests hit the real Neon DB from `.env`: each spec creates its own `*@example.com` users and deletes them in `afterAll` (cascade). A `beforeAll` that builds several receipts needs a longer timeout (`}, 60_000)`), or `afterAll` deletes the user while the hook is still running (FK errors).
- E2E tests never call Gemini or the real bucket: `overrideModels(builder, { default: new FakeModel() })` from `@nestjs/ai/testing` and `.overrideProvider(STORAGE_MODULE_OPTIONS)` with an `InMemoryDisk` (see `test/receipts.e2e-spec.ts`). `AiModule` is not global; it's registered in `ReceiptsModule`.
- `ERROR [ReceiptsService] Falló la extracción...` lines during e2e come from the negative tests; they're expected.
- Manual tests: Bruno collection in `bruno-api/` (local only, gitignored: it has real receipt photos), numbered requests `00`–`27`, documented in `bruno-api/README.md`. Add requests there for new endpoints.

### Git

- Branches from an up-to-date `origin/main`: `feat/…`, `fix/…`, `chore/…`, `docs/…` with a short lowercase hyphenated description (no ticket ids in this repo).
- Conventional Commits in Spanish, imperative, lowercase, without accents: `feat(reportes): comparar precios, historial, mas barato y gasto`. Split feature and tests into separate commits. No Devin attribution lines in commit messages.
- Husky hooks run in Docker: `pre-commit` = lint + `tsc --noEmit`, `commit-msg` = commitlint.
- CI (`.github/workflows/ci.yml`) on PRs and pushes to `main`: install, lint, `tsc`, unit tests, build. E2E tests don't run in CI.
- `gh` is not installed: after pushing, give the user the PR URL with a suggested title and description.
