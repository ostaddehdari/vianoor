# Stage 22 — Dashboard Experience

Branch:

`stage/22-dashboard-experience`

## Goal

Rebuild the role-aware authenticated dashboards around a consistent and significantly simpler UX shell.

The public experience remains independent from the dashboard experience.

## Work 22.1 — Unified Dashboard Shell

Implemented:

### Shared role-aware shell

The authenticated `UserWorkspace` remains the common runtime for:

- client
- expert
- administrator
- operator/support
- scientific
- finance
- content
- organization
- auditor
- call center
- operations
- other permission-backed workspaces

### Sidebar

- expanded by default on desktop
- persistent collapsed state
- icon-only desktop mode
- tooltip in icon-only mode
- icon for every navigation item
- mobile off-canvas drawer
- Escape-to-close behavior
- body scroll locking while drawer is open
- dedicated close button on mobile
- active navigation marker
- independent User Card above navigation
- user display name instead of public/user ID
- role shown below the name
- workspace selector retained
- release metadata moved to sidebar footer
- security and back-to-site shortcuts retained

### Header

- current workspace/page title
- real user display name
- avatar/profile menu
- dashboard navigation search
- live message icon with unread counter
- live notification icon with unread counter
- Light/Dark toggle
- active language selector
- role-aware Quick Create menu

### Search

Header search currently searches the available navigation destinations for the active role. Global entity/content search remains a later experience concern.

### Quick Create

Work 22.1 provides the shared role-aware entry surface.

Operational creation flows themselves are intentionally redesigned in Work 22.4.

### Dark mode and directionality

The new shell uses Stage21 design tokens and supports:

- Light
- Dark
- RTL
- LTR

### Scope boundary

Work 22.1 does **not** reduce the large existing navigation structure.

That is deliberately handled by Work 22.2 — Navigation & Information Architecture, where client navigation is reduced to five principal areas and the other roles receive equivalent role-aware grouping.

## Work 22.2 — Navigation & Information Architecture

Implemented.

### Core principle

Backend capability names no longer define the primary Sidebar structure.

Related capabilities are grouped according to the user's task and mental model.

### Client

The Client Sidebar now has exactly five principal areas:

1. Dashboard
2. My services
3. Messages
4. Finances
5. Profile

`My services` contains:

- My sessions
- My questions
- My events
- Talk Now

`Finances` contains:

- Wallet
- Payments
- Transactions
- Refunds
- Invoices

`Profile` contains:

- Personal information
- Languages
- Security
- Connected accounts
- Settings

New booking remains available through Quick Create rather than becoming another permanent primary Sidebar entry.

### Expert

The Expert navigation is grouped into:

1. Dashboard
2. Services & sessions
3. Messages
4. Professional profile
5. Earnings & payouts

Operational details such as calendar, availability, credentials, offerings and channel management remain accessible as children rather than independent top-level items.

### Administrator

Administration is grouped into:

- Users & organizations
- Experts & services
- Operations & communications
- Finance & payments
- Platform & settings

### Support / Operator

Support is grouped around:

- operational queue / sessions / bookings
- messages
- tickets and complaints
- shifts and reports

### Call Center

Call Center navigation groups configuration separately from call history, recordings and cost/quality information.

### Other roles

Specialist roles retain their capabilities under one logical Workspace Tools group.

No backend capability has been removed. Existing routes remain directly addressable.

## Work 22.3 — Dashboard Overview & Real Statistics

Implemented.

The dashboard landing page is now an Overview rather than an operational form.

### Client Overview

Real data is loaded from the existing authenticated services:

- `bookings/scheduled`
- `questions`
- `communications/conversations`
- `notifications`
- `wallet`
- `wallet/history`
- `accounting/currencies`
- `payments`

The Client Overview displays:

- upcoming sessions
- completed sessions
- submitted questions
- received answers
- registered events
- unread messages
- available wallet balance

The Events metric intentionally remains zero with an explicit unavailable state because the events backend is not implemented yet. No demo event count is fabricated.

### Next Session

The nearest confirmed/rescheduled future booking is displayed with:

- service
- expert
- localized time
- countdown
- direct handoff to the real Session Workspace using the booking ID

### Recent Activity

The timeline combines actual activity from:

- payments
- wallet ledger history
- questions
- conversations
- notifications
- completed sessions

### Expert Overview

Uses real:

- expert bookings
- assigned questions
- answered questions
- unread messages
- available wallet balance
- next session

### Admin Overview

Uses real:

- booking totals/statuses
- pending question moderation
- managed inbox
- unread notifications

### Other roles

Other workspaces receive a clean statistics-only landing surface from the services they can access, without rendering permanent forms on the dashboard home.

### UX rule

Operational forms no longer render on the dashboard home.

Creation and operational actions remain in their dedicated pages / Quick Create and are redesigned further in Work 22.4.

## Work 22.4 — Table-first Pages & Quick Create

Implemented.

### Standard Data Table

A reusable dashboard table now provides:

- Search
- Sort
- Pagination
- Column visibility
- Empty state
- Row actions
- optional Bulk Actions
- responsive mobile cards

The component is used by the principal operational areas and can be reused by later Event and Content modules.

### Standard Drawer

Create/edit workflows now use a common accessible side Drawer with:

- modal semantics
- background lock
- Escape close
- click-outside close
- focus return
- Light/Dark support
- mobile full-width layout

### Bookings

The Sessions / Bookings page is now table-first.

Columns include:

- Expert
- Subject / service
- Date
- Time
- Status
- Amount
- Actions

`New booking` opens the real BookingFlow in a Drawer.

Rescheduling also opens in a Drawer instead of replacing the list.

### Questions

The permanent New Question form was removed.

The page is now table-first and `New question` opens a Drawer.

Answering, assignment, publication controls and visibility management are opened from Row Actions.

### Finance

The existing Finance table component now uses the shared dashboard table standard.

Payment / Wallet top-up is opened in a Drawer.

Withdrawal and destination management are opened in a Drawer.

Existing payment/refund/ledger/risk functionality is preserved.

### User management

The permanent Invite User form was removed.

Users are displayed using the shared Data Table.

`Add user` opens a Drawer.

### Expert services

Creating and editing an Expert Service now occurs inside the standard Drawer.

Existing service publication/review workflows remain unchanged.

### Quick Create

The unified Header Quick Create now sends users directly into create mode:

- Client → New Booking / New Question
- Expert → New Service
- Admin → Add User

The target page automatically opens its Drawer.

### Events and Articles

The reusable Table / Drawer infrastructure is ready for Event and Article create flows.

No fake Event or Article creation UI was connected because those service backends are not yet implemented.

This preserves the project rule that UI must not imply a working business capability when its backend owner does not yet exist.
