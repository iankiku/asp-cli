# ASP — Agent Search Protocol
#
# Build:  docker build -t asp .
# Serve:  docker run -p 3000:3000 -v $(pwd)/.asp:/app/.asp asp serve
# Index:  docker run --rm \
#           -v $(pwd)/.asp:/app/.asp \
#           -v $(pwd)/knowledge:/app/knowledge \
#           asp index https://docs.example.com
# MCP:    docker run --rm -i asp mcp

# ── Stage 1: compile the binary ───────────────────────────────────────────────
FROM oven/bun:1 AS builder

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY src/ ./src/
COPY scripts/ ./scripts/
COPY tsconfig.json ./

RUN node scripts/build.mjs

# ── Stage 2: runtime image ────────────────────────────────────────────────────
FROM node:22-slim AS runtime

WORKDIR /app

# qmd needs Node at runtime — it's already here since we're on node:22-slim.
# Copy compiled ASP binary and qmd package.
COPY --from=builder /app/bin/asp-linux-x64 /usr/local/bin/asp
RUN chmod +x /usr/local/bin/asp

# Install qmd (needed by the asp binary at runtime for search/index ops)
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts=false @tobilu/qmd 2>&1 | tail -5

# Volumes: .asp = per-project index, knowledge = crawled docs
VOLUME ["/app/.asp", "/app/knowledge"]

EXPOSE 3000 8182

ENV ASP_PORT=3000 \
    ASP_MCP_PORT=8182 \
    ASP_INDEX_DIR=/app/.asp \
    ASP_KNOWLEDGE_DIR=/app/knowledge \
    ASP_MAX_PAGES=50 \
    ASP_CRAWL_DEPTH=3 \
    ASP_USE_JS_CRAWLER=false

WORKDIR /app
ENTRYPOINT ["asp"]
CMD ["serve"]
