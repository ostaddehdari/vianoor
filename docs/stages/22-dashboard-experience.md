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
