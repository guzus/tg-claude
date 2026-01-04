FROM oven/bun:1-alpine AS builder

ARG COMMIT_HASH=unknown

WORKDIR /app

COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build
RUN echo "$COMMIT_HASH" > dist/VERSION


FROM oven/bun:1-alpine

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/bun.lockb ./
RUN bun install --frozen-lockfile --production --ignore-scripts

RUN apk add --no-cache git openssh-client curl bash github-cli
RUN bun install -g @anthropic-ai/claude-code

RUN mkdir -p /workspace /app/data /app/logs /app/config

EXPOSE 5555

CMD ["bun", "run", "dist/index.js"]
