FROM node:24.19.0-bookworm-slim AS build
WORKDIR /app
RUN npm install -g npm@11.9.0
COPY . .
RUN npm ci --no-audit --no-fund && npm run build:packages && npm run build:services
FROM node:24.19.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0
COPY --from=build --chown=node:node /app /app
USER node
CMD ["node", "services/api-gateway/dist/main.js"]
