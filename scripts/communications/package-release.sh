#!/usr/bin/env bash
set -Eeuo pipefail
root=$(pwd -P)
[[ "$root" == /opt/vianoor-stage12 ]] || { echo 'Expected stage 12 server checkout'; exit 1; }
container=${1:-vianoor-stage12-dev}
docker exec "$container" node -e 'if(require("/app/apps/web/.next/routes-manifest.json").basePath!=="/vianoor")throw Error("Build web with NEXT_PUBLIC_BASE_PATH=/vianoor")'
context="$root/.cache/communications-release"
mkdir -p "$context/source" "$context/runtime" "$context/web/apps/web"
tar -xzf /tmp/vianoor-stage12-source.tgz -C "$context/source"
cp package-lock.json "$context/source/package-lock.json"
cp scripts/discovery/ui-seed.json "$context/source/scripts/discovery/ui-seed.json"
docker exec "$container" sh -c 'cd /app && tar -cf - packages/contracts/dist packages/service-runtime/dist services/*/dist node_modules/ws services/messaging-service/node_modules/zod services/notification-service/node_modules/zod services/presence-service/node_modules/zod services/qa-service/node_modules/zod' | tar -xf - -C "$context/runtime"
docker exec "$container" sh -c 'cd /app && tar --exclude=apps/web/.next/cache -cf - apps/web/.next' | tar -xf - -C "$context/web"
cat > "$context/services.Dockerfile" <<'DOCKER'
FROM vianoor-services:stage11
COPY --chown=node:node source/ /app/
COPY --chown=node:node runtime/ /app/
DOCKER
cat > "$context/web.Dockerfile" <<'DOCKER'
FROM vianoor-web:stage11
USER root
RUN rm -rf /app/apps/web/.next
COPY --chown=node:node source/ /app/
COPY --chown=node:node web/ /app/
USER node
DOCKER
docker build -f "$context/services.Dockerfile" -t vianoor-services:stage12 "$context"
docker build -f "$context/web.Dockerfile" -t vianoor-web:stage12 "$context"
echo 'Stage 12 images packaged from selected files; no private env or test fixtures included.'
