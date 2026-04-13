FROM node:22-alpine AS base

# Install bun
RUN npm install -g bun

FROM base AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG DATABASE_URL
ARG OPENROUTER_API_KEY
ARG JWT_SECRET
ENV DATABASE_URL=${DATABASE_URL}
ENV OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
ENV JWT_SECRET=${JWT_SECRET}

RUN bunx prisma generate
RUN bun run build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Copy all node_modules needed for runtime (prisma adapter + pg driver)
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/src/generated ./src/generated

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
