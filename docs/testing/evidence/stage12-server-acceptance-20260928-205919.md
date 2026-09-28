# Stage 12 Server Acceptance Evidence

- Date: 2026-09-28T20:59:19+00:00
- Host: VMID-20571
- Branch: stage/12-communications
- Tested commit: 9f94eb8fa321a2519cda0b232ce74be98fdd48ed
- Integration result: PASS
- Integration failures: 0
- Environment: isolated Stage 12 acceptance runtime on Ubuntu server

## Verified scenarios

- PASS 100 concurrent messages: no loss, unique order, encrypted storage and history reload.
- PASS channel follow grants no direct access; administrative review/forward/reply/read.
- PASS administrators cannot read private consultation or its scanned attachment.
- PASS private Q&A, assignment, consent, moderated anonymous public copy.
- PASS real WebSocket delivery, one-use ticket and scoped presence.
- PASS durable notification inbox and recipient-scoped read status.

## Test summary

```text
PASS 100 concurrent messages: no loss, unique order, encrypted storage and history reload.
PASS channel follow grants no direct access; administrative review/forward/reply/read.
PASS administrators cannot read private consultation or its scanned attachment.
PASS private Q&A, assignment, consent, moderated anonymous public copy.
PASS real WebSocket delivery, one-use ticket and scoped presence.
PASS durable notification inbox and recipient-scoped read status.
✔ stage 12 isolated communication permissions, durable ordering, realtime, channels, private files and publication (4463.795439ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4663.958722
```

## Runtime notes

The Stage 12 source already declares `ws@8.18.3` in
`services/messaging-service/package.json` and `package-lock.json`.

The temporary acceptance runtime was based on the Stage 11 image,
which did not contain that newer dependency. For server acceptance,
`ws@8.18.3` was injected only into the disposable test container.
No source or lockfile changes were required.

The production Stage 12 image must therefore be built from the
Stage 12 dependency manifest rather than reusing the Stage 11
runtime dependency tree.

## Raw server logs

Raw logs remain on the server at:

- /opt/vianoor-stage09/.cache/stage09-test/infra/qa/stage12-integration-20260928-205707.log
- /opt/vianoor-stage09/.cache/stage09-test/infra/qa/stage12-acceptance-20260928-205707.log
