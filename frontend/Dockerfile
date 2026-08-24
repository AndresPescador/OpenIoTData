FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
ARG NEXT_PUBLIC_API_URL=/api/v1
ARG NEXT_PUBLIC_DEMO_MODE=false
ARG NEXT_PUBLIC_OIDC_URL=/auth
ARG NEXT_PUBLIC_OIDC_REALM=openiotdata
ARG NEXT_PUBLIC_OIDC_CLIENT_ID=openiotdata-web
ARG NEXT_PUBLIC_DEV_AUTH_BYPASS=false
ARG NEXT_PUBLIC_DEV_USER=local-developer
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_DEMO_MODE=${NEXT_PUBLIC_DEMO_MODE}
ENV NEXT_PUBLIC_OIDC_URL=${NEXT_PUBLIC_OIDC_URL}
ENV NEXT_PUBLIC_OIDC_REALM=${NEXT_PUBLIC_OIDC_REALM}
ENV NEXT_PUBLIC_OIDC_CLIENT_ID=${NEXT_PUBLIC_OIDC_CLIENT_ID}
ENV NEXT_PUBLIC_DEV_AUTH_BYPASS=${NEXT_PUBLIC_DEV_AUTH_BYPASS}
ENV NEXT_PUBLIC_DEV_USER=${NEXT_PUBLIC_DEV_USER}
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
