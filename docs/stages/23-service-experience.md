# Stage 23 — Service Experience

Branch:

`stage/23-service-experience`

Stage23 minimizes the number of decisions and clicks required to actually receive Vianoor services.

## Work 23.1 — Consultation Journey

Implemented as an eight-step guided experience.

### Step 1 — Need

The user selects a real active:

- specialty
- category

Data comes from the Taxonomy service.

### Step 2 — Language

The user selects from the active Language Registry.

The current site language is preferred by default when available.

### Step 3 — Time

Choices:

- Today
- Tomorrow
- This week
- Specific date

The client device timezone is used for display and matching.

### Step 4 — Suitable experts

Experts are discovered through the real multilingual Search service.

A service is matched against the selected specialty/category.

Each expert card can show:

- Match reason
- Supported languages
- Matching service
- Rating
- Matching availability
- Price
- Public profile link

Public Rating and Availability enrichment is non-blocking so the experience remains usable with an older Preview backend.

### Step 5 — Session time

Real public availability slots are displayed and filtered against the selected time preference.

The user selects the exact slot before any booking is created.

### Authentication continuity

The first five steps can be completed before sign-in.

When booking requires authentication:

- the selected topic
- language
- time preference
- expert
- service
- exact slot
- timezone

are saved locally.

The login route receives a safe internal return path.

After successful authentication the user returns to `/consultation?resume=1` and continues the same booking.

No external/open redirect is accepted.

### Step 6 — Booking and payment

The chosen slot is held through the existing atomic Booking service.

Free services:

- create the hold
- confirm directly
- skip external payment

Paid services:

- create `BOOKING_PENDING_PAYMENT`
- load real configured payment methods
- support Wallet
- Stripe / card / Apple Pay / Google Pay
- PayPal
- NOWPayments crypto
- optional crypto network selection

Payment creation remains idempotent.

External checkout URL and crypto payment address are displayed only when returned by the real Payment service.

### Step 7 — Confirmation

The journey refreshes the actual booking state and displays:

- booking ID
- status
- final session time

### Step 8 — Session

The final CTA opens the existing Live Session workspace using the real booking ID.

### Entry points

Work23.1 also connects:

- Home Smart Start → Consultation Journey
- Services consultation card → Consultation Journey
- Services primary expert/consultation CTA → Consultation Journey

### Truthfulness

The journey does not fabricate:

- experts
- ratings
- availability
- prices
- payment providers
- booking state

Unavailable enrichments remain unavailable instead of being replaced by demo data.

## Work 23.2 — Q&A & Text Consultation

Implemented.

### Public Q&A Experience

The `/questions` experience is now a dedicated Q&A surface rather than a generic content page.

Main filters:

- Search
- Topics
- Latest
- Unanswered
- Popular
- My questions

### Question model

Stage23 extends the existing question model with:

- Title
- Category
- Tags
- Original language
- View count
- Multiple answers
- Accepted answer
- Public comments
- Stored translations

All database extensions are additive and remain backward-compatible with the Stage12/22 question model.

### Public questions before answers

A public question may now be moderated and published before it has an answer.

This makes the `Unanswered` feed real instead of synthetic.

### Multiple answers

The existing assigned-expert security model is preserved.

Only the expert assigned to a question can submit answers.

The question owner alone can mark an answer as accepted.

The accepted answer is synchronized back to the legacy single-answer field so older Dashboard surfaces continue to work.

### Comments

Authenticated users may post public comments on:

- the question
- individual published answers

Comments are explicitly public.

### Translation

The Q&A detail view separates:

- Original
- Translated

The original language is always visible.

A translated view is shown only when a real stored translation exists.

Work23.2 does not fabricate translations or call an unconfigured external translation provider.

The new translation table and API are ready for automated translation later when Stage7 / AI is implemented.

### Private follow-up

When a question has an assigned expert, the existing secure Question conversation can be opened by:

- the question owner
- the assigned expert

This creates/reuses a separate private messaging thread.

### Text consultation

The Q&A Experience has a separate `Private text consultation` path.

It routes to the Work23.1 Consultation Journey with:

`mode=text`

The Consultation Journey then restricts matching services to real `TEXT` services.

Paid text consultation therefore continues through:

- real service
- real availability
- booking
- payment
- real `CONSULTATION` messaging context

### Public Web proxy

The Web proxy now correctly permits unauthenticated:

- `/questions/public`
- `/questions/public/:id`

The API Gateway already supported public question reads.

### Preview backend isolation

Work23.2 can run an isolated Stage23 `qa-service` for Preview by using:

`QA_PREVIEW_URL`

Only Preview Web traffic for the `questions` owner is redirected to that service.

Production Web and Production qa-service remain untouched.

## Work 23.3 — Webinar / Events Experience

### Backend checkpoint — Webinar Core

The Event service is no longer a Stage1 scaffold.

The Webinar domain supports two creation paths.

#### Expert-created Webinar

A verified expert can create and publish a Webinar with:

- title
- description
- language
- start and end time
- timezone
- capacity
- free or paid price
- public/private visibility
- text chat
- Q&A
- Raise Hand
- cover image reference

#### Sponsor-requested Webinar

An authenticated person can become the Sponsor / requester and submit:

- title
- purpose / description
- language
- proposed date
- expected duration
- estimated audience
- optional budget
- optional preferred expert

The requested expert may:

- accept
- reject
- propose another time

A request without a specified expert is visible to verified experts as an open Webinar request.

When accepted, the resulting Webinar records the Sponsor separately from the Presenter.

### Invitations

The Presenter can invite existing Vianoor accounts as:

- Attendee
- Moderator

Invitation lifecycle:

- INVITED
- ACCEPTED
- DECLINED
- REGISTERED
- JOINED

Invitation acceptance uses the normal Webinar registration and capacity rules.

### Registration and capacity

Registration is atomic against Webinar capacity.

Free Webinar:

- registration becomes REGISTERED immediately

Paid Webinar:

- registration becomes PENDING_PAYMENT
- a temporary capacity hold is created
- expired unpaid holds are released automatically

### Live Webinar roles

Roles:

- PRESENTER
- MODERATOR
- SPONSOR
- ATTENDEE

### LiveKit policy

Default Webinar media permissions are deliberately asymmetric.

PRESENTER:

- subscribe: ON
- microphone: ON
- camera: ON
- screen share: ON

MODERATOR / SPONSOR / ATTENDEE:

- subscribe: ON
- microphone: OFF by default
- camera: OFF by default
- screen share: OFF

The Presenter can grant or revoke microphone and camera independently for each participant.

Live permission changes are applied to an already connected LiveKit participant through `RoomServiceClient.updateParticipant`.

Persisted permission flags are also used for newly issued tokens.

### Raise Hand

Registered audience members can raise or lower their hand.

The Presenter participant list prioritizes raised hands.

Granting microphone/camera automatically clears the raised-hand state.

### Text chat

Webinar text chat does not use the LiveKit DataChannel.

LiveKit Webinar tokens set:

`canPublishData: false`

Text chat is a normal Vianoor `EVENT` conversation owned by `messaging-service`.

Only registered Webinar members can write to the Event conversation.

This preserves:

- persistent history
- read state
- normal moderation infrastructure
- notification behavior

### Lazy room creation

Defining or publishing a Webinar does not create a LiveKit Room.

The room is provisioned/opened only when the Presenter starts the Webinar near its scheduled start time.

### Reminder intents

Registered participants receive durable reminder intents at:

- 24 hours
- 1 hour
- 10 minutes

This checkpoint reuses the existing MESSAGES notification preference so no existing notification schema is broken.

### Payment preparation

Event service exposes internal:

- registration payment quote
- registration payment confirmation

These are intentionally separated from normal Consultation booking payments.

The next Work23.3 checkpoint connects them to payment-service and the Event UI.

### Preview isolation

The Event, Media and Messaging implementations are first validated through isolated Stage23 Preview containers.

Production application containers remain unchanged during this checkpoint.

### Work23.3 runtime correction

The initial isolated Event runtime exposed a PostgreSQL parameter typing issue in the reminder worker.

The same SQL parameter was previously used both as:

- text for interval construction
- integer for `webinar_reminders.minutes`

PostgreSQL therefore inferred incompatible types and raised:

`operator does not exist: integer = text`

The reminder query now uses explicit integer semantics:

- `$1::int * interval '1 minute'`
- `d.minutes = $1::int`

The event background worker is also fault-isolated:

- a reminder/cleanup tick failure no longer terminates event-service
- the next scheduled cycle retries the work

Runtime acceptance verifies that event-service remains running with zero restarts after the initial worker tick.

### Work23.3 Checkpoint 2 — Payment + Product UI + Live Room

#### Event payment context

Payment service now supports a second first-class payable context:

- `booking_id`
- `event_registration_id`

Only one payable context may be supplied per payment.

Event registration payment keeps all existing finance behavior:

- Wallet
- Stripe
- PayPal
- NOWPayments
- idempotency
- risk checks
- commission
- tax
- reconciliation
- refunds

An Event payment is not treated as a wallet top-up.

Payment fulfillment calls Event service to atomically convert:

`PENDING_PAYMENT → REGISTERED`

Refund cancellation calls Event service before funds are returned.

#### Public Webinar Experience

`/events` now provides:

- Public upcoming Webinars
- Presenter
- Schedule
- Capacity / remaining seats
- Language
- Free / paid price
- Webinar detail
- Registration
- Payment
- Secure external checkout
- Crypto payment details
- Live Webinar entry

#### Expert dashboard

Experts can:

- Create Webinar
- Set schedule
- Set language
- Set capacity
- Set price
- Enable/disable public page
- Enable text chat
- Enable Q&A
- Enable Raise Hand
- Publish Webinar
- Start Webinar
- End Webinar
- Send invitations
- Open Live control room

#### Sponsor flow

Authenticated users can become Webinar Sponsors and request:

- topic/title
- description/purpose
- language
- preferred expert
- proposed time
- duration
- expected audience
- optional budget

Verified experts can:

- Accept
- Reject
- Propose another time

#### Invitations

Dashboard includes:

- invitations received
- accept
- decline

Accepted invitations pass through the same registration/capacity/payment rules.

#### Live Webinar UI

The Live Webinar UI connects to the existing Stage23 LiveKit Webinar token.

Presenter can:

- publish microphone
- publish camera
- share screen
- view participants
- see Raised Hand
- grant/revoke microphone per participant
- grant/revoke camera per participant

Audience:

- subscribes to Presenter media
- cannot publish by default
- can Raise Hand
- receives microphone/camera controls only when server permission is granted

Participant permission state is polled from Event service so server-side revoke is reflected in UI.

#### Webinar chat

Live Webinar text chat uses the durable `EVENT` Messaging conversation.

It supports persistent message history and does not depend on LiveKit DataChannel.
