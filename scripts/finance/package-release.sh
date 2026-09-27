#!/usr/bin/env bash
set -Eeuo pipefail
# Run on the VPS after npm run check + npm run smoke pass in the named build container.
root=$(pwd -P)
[[ "$root" == /opt/vianoor-stage11 ]] || { echo 'Expected stage 11 server checkout'; exit 1; }
container=${1:-vianoor-stage11-dev}
docker exec "$container" node -e 'if(require("/app/apps/web/.next/routes-manifest.json").basePath!=="/vianoor")throw Error("Build web with NEXT_PUBLIC_BASE_PATH=/vianoor")'
context="$root/.cache/finance-release"
mkdir -p "$context/source" "$context/runtime" "$context/web/apps/web"
# Only the source archive and explicitly selected build outputs enter the release.
tar -xzf /tmp/vianoor-stage11-source.tgz -C "$context/source"
cp package-lock.json "$context/source/package-lock.json"
cp scripts/discovery/ui-seed.json "$context/source/scripts/discovery/ui-seed.json"
docker exec "$container" sh -c 'cd /app && tar -cf - packages/contracts/dist packages/service-runtime/dist services/*/dist' | tar -xf - -C "$context/runtime"
docker exec "$container" sh -c 'cd /app && tar --exclude=apps/web/.next/cache -cf - apps/web/.next' | tar -xf - -C "$context/web"
cat > "$context/services.Dockerfile" <<'DOCKER'
FROM vianoor-services:stage10
COPY --chown=node:node source/ /app/
COPY --chown=node:node runtime/ /app/
DOCKER
cat > "$context/web.Dockerfile" <<'DOCKER'
FROM vianoor-web:stage10
USER root
RUN rm -rf /app/apps/web/.next
COPY --chown=node:node source/ /app/
COPY --chown=node:node web/ /app/
USER node
DOCKER
docker build -f "$context/services.Dockerfile" -t vianoor-services:stage11 "$context"
docker build -f "$context/web.Dockerfile" -t vianoor-web:stage11 "$context"
echo 'Stage 11 images packaged; private test env and fixture directories were excluded.'
