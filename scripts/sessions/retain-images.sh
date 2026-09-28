#!/usr/bin/env bash
set -Eeuo pipefail
# Keep the installed release, one tested rollback and every image referenced by a container.
# This never touches volumes, containers, other repositories, or global Docker build cache.
current=${1:?current release tag required, e.g. stage13}
rollback=${2:?rollback release tag required, e.g. stage11}
mode=${3:---dry-run}
[[ "$current" =~ ^stage[0-9][A-Za-z0-9.-]*$ && "$rollback" =~ ^stage[0-9][A-Za-z0-9.-]*$ ]] || exit 2
[[ "$mode" == --apply || "$mode" == --dry-run ]] || exit 2
for repository in vianoor-services vianoor-web vianoor-runtime; do
 while IFS= read -r reference; do
  [[ "$reference" == "$repository":* ]] || continue
  tag=${reference#*:}
  [[ "$tag" =~ ^stage[0-9][A-Za-z0-9.-]*$ ]] || continue
  [[ "$tag" == "$current" || "$tag" == "$rollback" ]] && continue
  [[ -z "$(docker ps -aq --filter "ancestor=$reference")" ]] || { printf 'KEEP referenced %s\n' "$reference"; continue; }
  if [[ "$mode" == --apply ]]; then docker image rm "$reference"; else printf 'WOULD REMOVE %s\n' "$reference"; fi
 done < <(docker images "$repository" --format '{{.Repository}}:{{.Tag}}' | sort -u)
done
docker system df
df -h /
