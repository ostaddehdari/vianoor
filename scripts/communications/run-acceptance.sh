#!/usr/bin/env bash
set -Eeuo pipefail
# Guard the VPS before starting the isolated stage 12 process. Never start a second ClamAV.
root=$(pwd -P)
[[ "$root" == /opt/vianoor-stage12 ]] || { echo 'Expected stage 12 server checkout'; exit 1; }
available_kb=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
swap_free_kb=$(awk '/^SwapFree:/ {print $2}' /proc/meminfo)
if (( available_kb < 1800000 || swap_free_kb < 524288 )); then
 echo 'Insufficient server memory headroom; stop unused isolated test workloads before continuing.'
 exit 1
fi
container=vianoor-stage12-dev
test "$(docker inspect "$container" --format '{{.State.Running}}')" = true
# Reuse only a reachable antivirus daemon; database/object storage stay isolated.
docker exec "$container" node -e 'const net=require("net"),s=net.connect(3310,"scanner");s.setTimeout(5000);s.on("connect",()=>s.end());s.on("error",()=>process.exit(1));s.on("timeout",()=>process.exit(1));'
docker exec -d "$container" sh -c 'node --import tsx scripts/communications/acceptance-server.mjs > /tmp/communications-owners.log 2>&1'
for attempt in $(seq 1 40); do
 if docker exec "$container" node -e 'fetch("http://127.0.0.1:4100/health/ready",{signal:AbortSignal.timeout(1000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'; then break; fi
 sleep 1
done
docker exec -e COMMUNICATIONS_TEST=1 "$container" node --import tsx --test tests/integration/communications.test.ts
