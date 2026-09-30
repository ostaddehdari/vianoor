# Stage 21 — Public Experience & Visual Identity

Branch: `stage/21-public-experience`

## Work 21.1 — Design System & Global Shell

Status: Work 21.1 and Work 21.2 accepted.

Implemented:

- shared color and spacing tokens
- Light and Dark themes
- persisted theme preference
- RTL/LTR-safe shell
- sticky glass public header
- solid/shadow header state after scrolling
- public Workspace shortcut removed from header
- active-language selector backed by Admin language registry
- icon-based header actions
- public social links backed by database settings
- Admin social-link management
- social link enable/disable and sort order
- theme-aware forms, cards, tables, modals and public surfaces
- responsive public navigation
- accessibility focus treatment

## Work 21.2 — Home Page FA/EN

Implemented:

- completely redesigned responsive home page
- powerful color-driven hero
- four primary service routes visible directly in the hero
- consultation, Q&A, events and Talk Now service cards
- Smart Start flow: topic → active language → preferred time
- active languages loaded from the administrator-controlled registry
- topics loaded from active taxonomy
- real public expert search with safe public-expert fallback
- real published Q&A data
- Q&A overview statistics and latest questions
- dynamic expert cards
- event section with truthful empty state until event publishing API exists
- Insights section renamed from Library in the home experience
- final conversion CTA
- complete Persian and English copy
- light/dark responsive styling

Important:

`event-service` currently has no public event data API. Work 21.2 therefore intentionally does not fabricate event records. The event home section provides the final visual shell and a real empty state. Live event data is connected in Work 23.3.

## Remaining Stage 21

- Work 21.3 — Services & Expert Discovery
- Work 21.4 — Expert Profile
- Work 21.5 — Insights, Events & Responsive Public UI
