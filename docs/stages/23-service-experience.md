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

### Work23.3 Final End-to-End Acceptance

The complete Webinar/Event experience passed end-to-end acceptance after the Sponsor preferred-Expert resolver correction.

Validated through real Stage23 Preview APIs:

#### Expert-created Webinar

- verified Expert creates Webinar
- publishes Webinar
- public Webinar detail is available
- starts Live Webinar
- ends Webinar

#### Invitations and registration

- Presenter sends invitation
- attendee sees invitation
- attendee accepts invitation
- free registration becomes `REGISTERED`

#### Sponsor-requested Webinar

- Sponsor submits request
- Sponsor selects a preferred Expert
- preferred Expert resolves through Scholar qualification plus Identity account lookup
- Expert sees targeted Sponsor request
- Expert accepts request
- request becomes a Webinar with Sponsor and Presenter linkage

#### Paid Webinar contract

- paid Webinar can be created and published
- attendee registration becomes `PENDING_PAYMENT`
- Event payment quote returns Event context, registration ID, amount and currency
- payment-method discovery remains functional
- acceptance intentionally does not execute a real financial transaction

#### Live Webinar policy

Presenter receives:

- microphone
- camera
- screen share

Audience receives:

- subscribe access
- microphone disabled by default
- camera disabled by default
- screen share disabled

#### Raise Hand and media grants

Validated:

- Raise Hand
- Presenter visibility of Raised Hand
- microphone grant
- camera grant
- microphone revoke
- camera revoke
- attendee permission-state refresh

#### Persistent text chat

Validated:

- EVENT conversation creation
- attendee message
- durable message history
- Presenter read access

#### Interface acceptance

Validated:

- Persian
- English
- Light Mode
- Dark Mode
- responsive desktop/tablet/mobile rules
- public Webinar experience
- Expert/Sponsor dashboard experience
- Live Webinar room UI

#### Acceptance isolation

Acceptance notifications were redirected to a local no-op Notification endpoint.

No real payment was executed.

Temporary authentication sessions, Webinar rows, Sponsor requests, invitations, registrations, Event conversations/messages and Webinar room metadata were removed after the run.

Work23.3 is accepted and complete.

## Work23.4 — Helpline / Talk Now

### Checkpoint 1 — Durable queue core

The original `instant-service` was only a Stage1 scaffold.

Work23.4 replaces the scaffold with the real Talk Now queue domain.

### No booking

Talk Now deliberately does **not** create a calendar Booking.

The user enters a durable queue and is matched to the first currently eligible Expert.

### Expert opt-in

A verified Expert controls:

- Talk Now enabled/disabled
- timezone
- weekly Talk Now windows
- supported languages
- optional topic restrictions
- AUDIO / VIDEO modes
- instant consultation price
- currency
- timed offer duration
- session duration

### Online state

Talk Now uses the same Redis presence key as the existing Presence service.

An Expert must simultaneously be:

- verified
- opted in
- inside a configured Talk Now window
- ONLINE
- not already reserved by another instant request

### Client queue

A client request contains:

- language
- optional topic
- AUDIO / VIDEO mode
- short private need/notes

States:

- QUEUED
- OFFERING
- AWAITING_PAYMENT
- READY
- LIVE
- COMPLETED
- CANCELLED

Only one active Talk Now request is allowed per client.

### Timed offer

The queue worker sends a timed offer to one eligible Expert.

Offer states:

- OFFERED
- ACCEPTED
- REJECTED
- EXPIRED
- CANCELLED

While an offer is active, that Expert is reserved for that request.

If the Expert rejects or the offer expires:

- Expert reservation is released
- request returns to QUEUED
- the rejected/expired Expert is not offered the same request again
- worker can continue with another eligible Expert

### Expert acceptance

On acceptance:

Free consultation:

`OFFERING → READY`

Paid consultation:

`OFFERING → AWAITING_PAYMENT`

The accepted request snapshots:

- Expert
- price
- currency
- session duration

### Payment preparation

Instant service exposes internal:

- `payment-quote`
- `payment-confirm`

A paid accepted request has a ten-minute payment window.

Expired payment releases the Expert automatically.

Payment-service wiring is completed in Checkpoint 2.

### Live-session preparation

Instant service exposes internal session context and transitions:

- READY → LIVE
- LIVE → COMPLETED

Completing the session releases the Expert for the next queue request.

### Chat preparation

Only the matched client and Expert may use the future Instant consultation conversation after the request reaches READY.

Messaging integration is completed in Checkpoint 2.

### Public availability

A public status endpoint reports only aggregate availability:

- available Expert count
- whether Talk Now currently has an eligible Expert

No Expert identity is exposed by this endpoint.

### Next checkpoint

Work23.4 Checkpoint 2 adds:

- Payment-service first-class `instant_request_id`
- LiveKit 1:1 Talk Now room
- persistent `INSTANT` conversation
- public Helpline UI
- client queue screen
- Expert timed-offer UI
- Expert Talk Now hours/settings UI
- operator queue panel
- support ticket / complaint path

### Work23.4 Checkpoint 2A — Payment, LiveKit and persistent chat

Talk Now now has first-class integration with the finance, media and communication services.

#### Payment

Payment service supports:

`instant_request_id`

as a first-class payable context beside Booking and Webinar registration.

A Talk Now payment:

- fetches the authoritative quote from instant-service
- validates account, amount, currency and payment hold
- prevents duplicate active payments for the same Instant request
- snapshots the Instant quote
- applies ordinary commission/tax/risk rules
- fulfills the payment by calling instant-service
- transitions `AWAITING_PAYMENT → READY`
- uses `/instant?payment=...` as the external gateway return path
- supports the refund financial-cancel hook

#### LiveKit 1:1

media-service owns a dedicated `instant_rooms` table.

The Instant room is created lazily when a READY consultation is entered.

The room:

- max participants: 2
- persistent text chat is not sent through LiveKit DataChannel
- both parties can publish microphone
- VIDEO requests allow camera
- AUDIO requests do not allow camera
- screen share is available
- tokens are short-lived
- only the matched client and Expert receive tokens

Opening the room changes the Instant request:

`READY → LIVE`

Ending the room changes it:

`LIVE → COMPLETED`

and releases the Expert.

#### Persistent INSTANT conversation

Messaging supports conversation type:

`INSTANT`

The conversation is keyed by the Instant request and contains exactly:

- CUSTOMER
- EXPERT

Writes are authorized against instant-service, so unrelated accounts cannot use the conversation.

#### Join endpoint

The client or matched Expert enters an Instant consultation through the Instant request join endpoint.

The response combines:

- current Instant request
- persistent conversation ID
- LiveKit token and URL
- role and media capabilities
