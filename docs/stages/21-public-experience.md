# Stage 21 — Public Experience & Visual Identity

Branch: `stage/21-public-experience`

## Work 21.1 — Design System & Global Shell

Status: Work 21.1 through Work 21.4 accepted.

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

## Work 21.3 — Services & Expert Discovery

Implemented:

- complete `/services` storytelling page
- four primary service journeys
- problem / audience / flow / cost / language / CTA for every service
- FAQ for service discovery
- Grid-first expert discovery
- full-text expert search
- active-language filter
- specialty filter
- topic/category filter
- maximum-price filter
- online-now filter backed by live Redis presence
- available-today filter backed by real scheduling data
- earliest-appointment sorting
- public aggregate rating and rating sorting
- minimum-rating filter
- price sorting
- public expert cards with language, specialties, price and next availability
- only approved/public experts are exposed by enrichment endpoints
- rating endpoint exposes aggregates only; private review text is never returned
- availability endpoint exposes earliest available public booking slot only
- presence endpoint exposes ONLINE/AWAY/OFFLINE only
- global sticky Header/Footer retained on expert directory and profile routes
- Smart Start topic/category handoff fixed

## Work 21.4 — Expert Profile Experience

Implemented:

- fully redesigned public expert profile
- localized expert detail in the current site language
- professional profile Hero
- verified status
- public profile image with fallback identity mark
- live ONLINE/AWAY/OFFLINE presence
- specialty chips
- spoken languages
- city/country location
- aggregate rating
- completed-session count
- earliest real availability
- direct consultation CTA
- ask-question CTA
- expert-channel CTA
- About tab
- Specialties and languages tab
- Services and pricing tab
- Availability tab
- Reviews and rating summary tab
- Articles tab with truthful empty state until article ownership is implemented
- Published answered-questions tab filtered to the expert
- public credentials
- professional links
- viewpoints
- sticky Booking Widget
- public service selection
- real 14-day slot discovery
- user-timezone slot formatting
- direct handoff to booking with expert/service/start preselected
- public aggregate APIs expose no client data or private review text

## Remaining Stage 21

- Work 21.5 — Insights, Events & Responsive Public UI
