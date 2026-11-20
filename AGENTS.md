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

- Package manager and runtime: **Bun** (`bun add`, `bun run <script>`, `bunx`). The Dockerfile uses `oven/bun`; `dev.sh` runs the dev container.
- Living plan for this project (receipt scanning + price tracking): `.devin/workflows/plan-mercado.md`. Read it before starting a phase and update its checkboxes and changelog after.
- Stack decisions: Neon Postgres + Neon Object Storage (S3, `forcePathStyle: true`), Drizzle, `@nestjs/authentication` (session cookie), `@nestjs/ai` + `@ai-sdk/google` (`gemini-3.5-flash-lite`), deploy on Render. Multi-user data model (every owned table has `user_id`, every query filters by the session user, foreign resources return 404), one user at launch. Colombia only: amounts are integer COP.
- Keep it simple: modular monolith, controller → service → Drizzle, feature modules (`module`/`controller`/`service`/`schemas`), services use Drizzle directly, no repository layer or speculative abstractions.
- Comments only when needed: short, technical, explaining *why*. No comments that restate the code, no obvious JSDoc, no banners.
- Nothing is installed on the host (no Bun, Node or npm): everything runs in Docker. `./dev.sh` for the dev server, `./run.sh <cmd>` for anything else (`./run.sh bun add x`, `./run.sh bunx neon ...`). After changing dependencies, rebuild with `docker build --target dev -t backend-dev .`. Dependencies live in the `backend_node_modules` Docker volume, so the host `node_modules` is empty and the IDE can't find types; copy them over (IDE only) with `docker run --rm -v backend_node_modules:/from -v "$PWD/node_modules":/to alpine cp -a /from/. /to/`, again after each dependency change.
- Zod 4: import as `import * as z from 'zod'`. `import { z } from 'zod'` is `undefined` under Vitest.
- `tsconfig.json` restricts global types (`"types": [...]`): a new `@types/*` package that adds globals (like `multer` for `Express.Multer`) must be added there.
- E2E tests never call Gemini or the real bucket: `overrideModels(builder, { default: new FakeModel() })` from `@nestjs/ai/testing` and `.overrideProvider(STORAGE_MODULE_OPTIONS)` with an `InMemoryDisk` (see `test/receipts.e2e-spec.ts`). `AiModule` is not global; it's registered in `ReceiptsModule`.
- Verify: `./run.sh bun run build`, `./run.sh bun run lint`, `./run.sh bun run test`, `./run.sh bun run test:e2e` (hits the real Neon DB from `.env`). Migrations: `./run.sh bun run db:generate` / `./run.sh bun run db:migrate` (uses `DATABASE_URL_UNPOOLED`).
