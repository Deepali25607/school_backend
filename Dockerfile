FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY index.js ./
COPY data ./data

# non-root user; pre-create the persistence dir so the mounted volume is writable
RUN addgroup -S app && adduser -S app -G app \
    && mkdir -p /app/db \
    && chown -R app:app /app
USER app

EXPOSE 4000
CMD ["node", "index.js"]
