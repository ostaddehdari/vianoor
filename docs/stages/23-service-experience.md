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
