FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

FROM deps AS dev
RUN bun install --frozen-lockfile
EXPOSE 3000
CMD ["bun", "--bun", "run", "start:dev"]

FROM dev AS build
COPY . .
RUN bun --bun run build

FROM deps AS prod
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
USER bun
EXPOSE 3000
CMD ["bun", "dist/main.js"]
