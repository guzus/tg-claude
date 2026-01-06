FROM oven/bun:1-alpine AS builder

ARG COMMIT_HASH=unknown

WORKDIR /app

COPY package.json bun.lockb ./
RUN bun install

COPY . .
RUN bun run build
RUN echo "$COMMIT_HASH" > dist/VERSION


FROM oven/bun:1-alpine

WORKDIR /app

RUN apk add --no-cache git openssh-client curl bash github-cli su-exec \
    # Node/npm for MCP servers that are typically launched via `npx`
    nodejs npm \
    # Chromium for Playwright MCP support
    chromium nss freetype harfbuzz ca-certificates ttf-freefont

# Playwright configuration (use system Chromium; avoid downloading browsers at build/runtime)
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_BROWSERS_PATH=0

# Pre-install Playwright MCP so `/mcp preset playwright` doesn't need a first-run download
RUN npm install -g --no-fund --no-audit @playwright/mcp@latest

# Install runtime JS dependencies (keep this layer cacheable across code changes)
COPY package.json bun.lockb ./
RUN bun install --production --ignore-scripts --no-save

# Copy built app after deps so rebuilds don't invalidate `bun install` cache
COPY --from=builder /app/dist ./dist

# Create non-root user for security (required for --dangerously-skip-permissions)
RUN addgroup -g 10001 appgroup && adduser -u 10001 -G appgroup -s /bin/sh -D appuser

# Install claude-code in a shared location accessible to all users
ENV BUN_INSTALL=/opt/bun
RUN mkdir -p $BUN_INSTALL && \
    bun install -g @anthropic-ai/claude-code && \
    chmod -R 755 $BUN_INSTALL /usr/local/bin && \
    chown -R appuser:appgroup /home/appuser

RUN mkdir -p /workspace /app/data /app/logs /app/config /app/bots

# For Railway single-volume setup: mount /persistent
# Then set DATA_PATH=/persistent in Railway env vars
RUN mkdir -p /persistent/workspace /persistent/app/data /persistent/app/logs /persistent/app/config

# Set ownership for non-root user
RUN chown -R appuser:appgroup /app /workspace /persistent

# Copy entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 5555

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bun", "run", "dist/index.js"]
