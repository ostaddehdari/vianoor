# Stage 12 Final Acceptance Evidence

- Date: 2026-09-30T08:09:22+00:00
- Host: VMID-20571
- Branch: stage/12-communications
- Base commit before final fixes: ab95b601b9fa1310c7cd632f93aa30b716b9023c
- Services image: vianoor-services:stage12
- Web image ID: sha256:059d081bcc1ef9f7559a83f887facb1f47103046e1b9a721a7df7cc91e8be3c2
- Integration: PASS
- Browser acceptance: PASS
- WCAG 2 A/AA: PASS
- Production remained on Stage 11 during acceptance.

## Integration

The clean isolated Stage 12 integration test passed with zero failures:

- 100 concurrent messages without loss
- encrypted durable history
- restricted channel access
- administrative review and forwarding
- private consultation/file access boundary
- private Q&A and assignment
- moderated anonymous publication
- real WebSocket delivery
- one-use WebSocket ticket
- presence
- durable notifications

Integration log:

`/opt/vianoor-stage09/.cache/stage09-test/infra/qa/stage12-final-20260930-052006/integration.log`

## Browser

Final browser acceptance passed:

- login
- conversation loading
- message send
- persistence after refresh
- multi-page historical message loading
- microphone recording
- voice upload/playback
- channel workflow
- English
- Persian RTL
- mobile layout
- WCAG 2 A/AA

## Final fixes

The browser history test now follows multiple history pages instead of
assuming that one Load more operation reaches a particular message
created concurrently.

The browser harness supports a system Chromium through
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

The secondary UI text color was changed from `#627869` to
`#607667`. Axe had measured the previous color against
`#f6f9f4` at 4.48:1, slightly below the required 4.5:1.

Browser log:

`/opt/vianoor-stage09/.cache/stage09-test/infra/qa/stage12-final-browser-20260930-080450/browser.log`

Screenshots:

- messages-en.png
- messages-mobile-fa.png
- channel-mobile-fa.png
