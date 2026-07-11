# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache wget su-exec
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src
COPY docs ./docs
RUN mkdir -p /app/uploads/customer-display && chown -R node:node /app/uploads
EXPOSE 47300
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:47300/health >/dev/null || exit 1
CMD ["sh", "-c", "mkdir -p /app/uploads/customer-display && chown -R node:node /app/uploads && exec su-exec node node src/index.js"]
