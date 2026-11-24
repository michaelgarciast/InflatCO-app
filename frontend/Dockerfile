FROM oven/bun:1-slim AS base
COPY --from=node:24-slim /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
EXPOSE 5173

# ---------- dev ----------
FROM base AS dev
CMD ["sh", "-c", "[ -d node_modules ] || bun install; bun --bun run dev --host 0.0.0.0"]
