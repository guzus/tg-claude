FROM oven/bun:1-alpine AS builder

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build


FROM oven/bun:1-alpine

# Install system dependencies
RUN apk add --no-cache git openssh-client curl bash

# Install Claude CLI
RUN curl -fsSL https://claude.ai/install.sh | bash

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/bun.lock* ./

RUN bun install --frozen-lockfile --production

# Create workspace and data directories
RUN mkdir -p /workspace /app/data /app/logs /app/config

EXPOSE 3000

CMD ["bun", "run", "dist/index.js"]
