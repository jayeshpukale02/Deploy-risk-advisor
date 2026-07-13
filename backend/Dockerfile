# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
# Prisma's native query engine requires OpenSSL on Alpine
RUN apk add --no-cache openssl
WORKDIR /app

# ── deps stage ────────────────────────────────────────────────────────────────
FROM base AS deps
COPY package*.json ./
RUN npm ci

# ── builder stage ─────────────────────────────────────────────────────────────
FROM deps AS builder
COPY . .
# Generate Prisma client from the schema
RUN npx prisma generate
# Compile TypeScript
RUN npm run build

# ── runner stage ──────────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma

# Startup: run migrations then launch the server
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]

EXPOSE 4000
