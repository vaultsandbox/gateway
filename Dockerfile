# ===== Development Stage =====
# Local development with hot reload and bind mounts
FROM node:24-alpine@sha256:682368d8253e0c3364b803956085c456a612d738bd635926d73fa24db3ce53d7 AS development

WORKDIR /usr/src/app
COPY backend/package*.json ./
RUN npm ci

WORKDIR /usr/src/frontend
COPY frontend/package*.json ./
RUN npm ci

WORKDIR /usr/src/app
CMD ["npm", "run", "start:dev"]

# ===== Frontend Builder Stage =====
# Build the Angular frontend
FROM node:24-alpine@sha256:682368d8253e0c3364b803956085c456a612d738bd635926d73fa24db3ce53d7 AS frontend-builder

WORKDIR /usr/src/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ===== Backend Builder Stage =====
# Install dependencies, build NestJS, and keep only prod deps
FROM node:24-alpine@sha256:682368d8253e0c3364b803956085c456a612d738bd635926d73fa24db3ce53d7 AS backend-builder

WORKDIR /usr/src/app

COPY backend/package*.json ./
RUN npm ci

COPY backend/ ./
RUN npm run build && npm prune --omit=dev && npm cache clean --force

# ===== Production Stage =====
# Minimal runtime image with non-root user
# Note: Pin to specific SHA in production for immutability
# Get SHA with: docker pull node:24-alpine && docker inspect node:24-alpine | grep Id
FROM node:24-alpine@sha256:682368d8253e0c3364b803956085c456a612d738bd635926d73fa24db3ce53d7 AS production

# OCI metadata labels
LABEL org.opencontainers.image.title="VaultSandbox Gateway" \
      org.opencontainers.image.description="Secure receive-only SMTP server with automatic TLS certificate management" \
      org.opencontainers.image.version="0.8.0" \
      org.opencontainers.image.authors="Antero" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.source="https://github.com/vaultsandbox/gateway"

ENV NODE_ENV=production \
    VSB_SERVER_PORT=80

WORKDIR /usr/src/app

COPY --from=backend-builder /usr/src/app/dist ./dist
COPY --from=backend-builder /usr/src/app/node_modules ./node_modules
COPY backend/package*.json ./
COPY backend/assets ./assets

# Backend expects the compiled frontend in ../frontend/dist
COPY --from=frontend-builder /usr/src/frontend/dist ../frontend/dist

# Create non-root user and set permissions
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    mkdir -p /app/data && \
    chown -R nodejs:nodejs /usr/src /app/data

USER nodejs

EXPOSE 25 80 443

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:80/health || exit 1

CMD ["node", "dist/main"]
