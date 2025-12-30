FROM oven/bun:1-debian AS base

# Install Node.js (needed for Claude CLI) and git
RUN apt-get update && apt-get install -y \
    curl \
    git \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Claude CLI globally
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY src ./src
COPY tsconfig.json ./

# Create logs directory
RUN mkdir -p logs

# Expose health check port
EXPOSE 3000

# Run the application
CMD ["bun", "run", "start"]
