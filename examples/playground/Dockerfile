# Multi-stage production Dockerfile for @crispice/universal-content SEO Playground
FROM node:22-alpine AS builder

WORKDIR /app

# Copy root package files
COPY package*.json tsconfig.json tsup.config.ts ./
COPY src/ ./src/

# Install root dependencies and build package
RUN npm ci
RUN npm run build

# Build playground
WORKDIR /app/examples/playground
COPY examples/playground/package*.json examples/playground/tsconfig.json ./
COPY examples/playground/src/ ./src/
COPY examples/playground/content/ ./content/

WORKDIR /app

# Runner Stage
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV ROOT_DOMAIN=murageh.co.ke

COPY package*.json ./
COPY dist/ ./dist/
COPY examples/playground/package*.json ./examples/playground/
COPY examples/playground/content/ ./examples/playground/content/

# Install production dependencies
RUN npm ci --omit=dev

WORKDIR /app/examples/playground
RUN npm install tsx -g

EXPOSE 3000

CMD ["tsx", "src/server.ts"]
