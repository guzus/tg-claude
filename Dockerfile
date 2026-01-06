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

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
RUN bun install --production --ignore-scripts --no-save

RUN apk add --no-cache git openssh-client curl bash github-cli \
    # Chromium for Puppeteer MCP support
    chromium nss freetype harfbuzz ca-certificates ttf-freefont

# Puppeteer configuration
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
RUN bun install -g @anthropic-ai/claude-code

# Create non-root user for security (required for --dangerously-skip-permissions)
RUN addgroup -g 1000 appgroup && adduser -u 1000 -G appgroup -s /bin/sh -D appuser

RUN mkdir -p /workspace /app/data /app/logs /app/config /app/bots

# For Railway single-volume setup: mount /persistent
# Then set DATA_PATH=/persistent in Railway env vars
RUN mkdir -p /persistent/workspace /persistent/app/data /persistent/app/logs /persistent/app/config

# Set ownership for non-root user
RUN chown -R appuser:appgroup /app /workspace /persistent

USER appuser

EXPOSE 5555

CMD ["bun", "run", "dist/index.js"]
