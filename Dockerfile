# Base Stage
FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/shared/package.json packages/shared/
RUN npm install
COPY . .

# API Stage
FROM base AS api
EXPOSE 8080
CMD ["npx", "tsx", "apps/api/src/index.ts"]

# Web Stage
FROM base AS web
EXPOSE 3000
CMD ["npm", "run", "dev", "--workspace=@checky/web"]

# Worker Stage (Playwright + Claude Agent SDK)
FROM mcr.microsoft.com/playwright:v1.62.1-jammy AS worker
WORKDIR /app

# Install Node.js dependencies
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/shared/package.json packages/shared/
RUN npm install

# Install Claude-Code CLI / Agent SDK
RUN npm install -g @anthropic-ai/claude-code

# Copy source code
COPY . .

# Headful unter virtuellem Display (Xvfb) für Anti-Detection.
RUN chmod +x /app/docker-entrypoint.sh
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["npx", "tsx", "apps/worker/src/index.ts"]
