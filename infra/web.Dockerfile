FROM node:24.19.0-bookworm-slim AS build
WORKDIR /app
ARG NEXT_PUBLIC_BASE_PATH=""
ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH NEXT_TELEMETRY_DISABLED=1
RUN npm install --global npm@11.9.0
COPY . .
RUN npm ci --no-audit --no-fund && npm run build --workspace @vianoor/web
FROM node:24.19.0-bookworm-slim
WORKDIR /app
ARG NEXT_PUBLIC_BASE_PATH=""
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "apps/web", "--hostname", "0.0.0.0", "--port", "3000"]
