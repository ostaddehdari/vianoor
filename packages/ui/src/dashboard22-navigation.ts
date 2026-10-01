import type {
  IconName,
} from './icons';

import {
  dashboard22Copy,
} from './dashboard22-copy';

export type Dashboard22NavItem = {
  key: string;
  label: string;
  icon: IconName;
  href: string;
  activeSections: string[];
};

export type Dashboard22NavEntry =
  | {
      kind: 'link';
      key: string;
      item: Dashboard22NavItem;
    }
  | {
      kind: 'group';
      key: string;
      label: string;
      icon: IconName;
      items: Dashboard22NavItem[];
    };

type Input = {
  locale: string;
  role: string;
  admin: boolean;

  links: [
    string,
    string,
  ][];

  route: (
    part: string,
  ) => string;

  securityHref: string;
};

const iconFor = (
  part: string,
): IconName => {
  const icons: Record<
    string,
    IconName
  > = {
    '': 'grid',

    sessions:
      'video',

    bookings:
      'calendar',

    book:
      'calendar',

    calendar:
      'calendar',

    availability:
      'clock',

    requests:
      'calendar',

    instant:
      'phone',

    questions:
      'comments',

    events:
      'calendar',

    messages:
      'mail',

    channels:
      'comments',

    notifications:
      'bell',

    inbox:
      'mail',

    wallet:
      'wallet',

    payments:
      'wallet',

    refunds:
      'wallet',

    earnings:
      'wallet',

    payouts:
      'wallet',

    finance:
      'wallet',

    profile:
      'user',

    professional:
      'user',

    credentials:
      'shield',

    offerings:
      'sparkles',

    experts:
      'user',

    'expert-applications':
      'user',

    verification:
      'shield',

    'expert-documents':
      'book',

    services:
      'sparkles',

    taxonomy:
      'grid',

    files:
      'book',

    users:
      'user',

    organizations:
      'building',

    forms:
      'book',

    localization:
      'globe',

    audit:
      'shield',

    'calendar-settings':
      'calendar',

    holidays:
      'calendar',

    queue:
      'phone',

    tickets:
      'headset',

    complaints:
      'headset',

    shifts:
      'clock',

    extensions:
      'phone',

    routes:
      'filter',

    trunks:
      'server',

    history:
      'clock',

    recordings:
      'play',

    costs:
      'wallet',

    settings:
      'filter',
  };

  return (
    icons[part] ??
    'grid'
  );
};

function item(
  key: string,
  label: string,
  href: string,
  part = key,
  icon: IconName =
    iconFor(
      part,
    ),
  activeSections = [
    part,
  ],
): Dashboard22NavItem {
  return {
    key,
    label,
    icon,
    href,
    activeSections,
  };
}

function link(
  key: string,
  value: Dashboard22NavItem,
): Dashboard22NavEntry {
  return {
    kind:
      'link',

    key,

    item:
      value,
  };
}

function group(
  key: string,
  label: string,
  icon: IconName,
  items: Dashboard22NavItem[],
): Dashboard22NavEntry {
  return {
    kind:
      'group',

    key,
    label,
    icon,
    items,
  };
}

export function buildDashboard22Navigation({
  locale,
  role,
  admin,
  links,
  route,
  securityHref,
}: Input): Dashboard22NavEntry[] {
  const t =
    dashboard22Copy[locale]!;

  const labels =
    new Map(
      links,
    );

  const original = (
    part: string,
    fallback: string,
  ) =>
    labels.get(
      part,
    ) ??
    fallback;

  const dashboard =
    link(
      'dashboard',
      item(
        'dashboard',
        t.dashboard,
        route(''),
        '',
        'grid',
        [''],
      ),
    );

  /*
   * CLIENT
   *
   * Exactly five principal navigation areas:
   *
   * 1. Dashboard
   * 2. My services
   * 3. Messages
   * 4. Finances
   * 5. Profile
   */
  if (
    role ===
    'account'
  ) {
    return [
      dashboard,

      group(
        'my-services',
        t.myServices,
        'sparkles',
        [
          item(
            'my-sessions',
            t.mySessions,
            route(
              'bookings',
            ),
            'bookings',
            'calendar',
            [
              'bookings',
              'sessions',
              'book',
              'requests',
            ],
          ),

          item(
            'my-questions',
            t.myQuestions,
            route(
              'questions',
            ),
            'questions',
            'comments',
          ),

          item(
            'my-events',
            t.myEvents,
            route(
              'events',
            ),
            'events',
            'calendar',
          ),

          item(
            'talk-now',
            t.talkNow,
            route(
              'instant',
            ),
            'instant',
            'phone',
          ),
        ],
      ),

      link(
        'messages',
        item(
          'messages',
          t.messages,
          route(
            'messages',
          ),
          'messages',
          'mail',
          [
            'messages',
            'channels',
            'notifications',
          ],
        ),
      ),

      group(
        'finances',
        t.financeArea,
        'wallet',
        [
          item(
            'wallet',
            t.wallet,
            route(
              'wallet',
            ),
            'wallet',
            'wallet',
          ),

          item(
            'payments',
            t.payments,
            route(
              'wallet',
            ) +
              '#payments',
            'payments',
            'wallet',
          ),

          item(
            'transactions',
            t.transactions,
            route(
              'wallet',
            ) +
              '#history',
            'transactions',
            'clock',
          ),

          item(
            'refunds',
            t.refunds,
            route(
              'wallet',
            ) +
              '#payments',
            'refunds',
            'wallet',
          ),

          item(
            'invoices',
            t.invoices,
            route(
              'wallet',
            ) +
              '#payments',
            'invoices',
            'book',
          ),
        ],
      ),

      group(
        'profile',
        t.profileArea,
        'user',
        [
          item(
            'personal-info',
            t.personalInfo,
            route(
              'profile',
            ),
            'profile',
            'user',
          ),

          item(
            'languages',
            t.languages,
            route(
              'profile',
            ),
            'languages',
            'globe',
          ),

          item(
            'security',
            t.security,
            securityHref,
            'security',
            'shield',
          ),

          item(
            'connections',
            t.connectedAccounts,
            securityHref,
            'connections',
            'link',
          ),

          item(
            'settings',
            t.settings,
            route(
              'profile',
            ),
            'settings',
            'filter',
          ),
        ],
      ),
    ];
  }

  /*
   * EXPERT
   *
   * Same mental model as Client:
   * Dashboard / Work / Messages / Professional / Finance.
   */
  if (
    role ===
    'expert'
  ) {
    return [
      dashboard,

      group(
        'expert-work',
        t.expertWork,
        'video',
        [
          item(
            'expert-sessions',
            t.expertSessions,
            route(
              'sessions',
            ),
            'sessions',
            'video',
            [
              'sessions',
              'bookings',
              'calendar',
              'availability',
              'requests',
            ],
          ),

          item(
            'expert-calendar',
            original(
              'calendar',
              t.expertSessions,
            ),
            route(
              'calendar',
            ),
            'calendar',
            'calendar',
          ),

          item(
            'expert-questions',
            t.expertQuestions,
            route(
              'questions',
            ),
            'questions',
            'comments',
          ),

          item(
            'expert-instant',
            t.talkNow,
            route(
              'instant',
            ),
            'instant',
            'phone',
          ),
        ],
      ),

      link(
        'expert-messages',
        item(
          'expert-messages',
          t.messages,
          route(
            'messages',
          ),
          'messages',
          'mail',
          [
            'messages',
            'channels',
            'notifications',
          ],
        ),
      ),

      group(
        'professional',
        t.professional,
        'user',
        [
          item(
            'professional-info',
            t.professionalInfo,
            route(
              'professional',
            ),
            'professional',
            'user',
            [
              'professional',
              'profile',
            ],
          ),

          item(
            'credentials',
            t.credentials,
            route(
              'credentials',
            ),
            'credentials',
            'shield',
          ),

          item(
            'offerings',
            t.offerings,
            route(
              'offerings',
            ),
            'offerings',
            'sparkles',
          ),

          item(
            'channel',
            t.expertChannel,
            route(
              'channels',
            ),
            'channels',
            'comments',
          ),

          item(
            'expert-events',
            t.expertEvents,
            route(
              'events',
            ),
            'events',
            'calendar',
          ),
        ],
      ),

      group(
        'expert-finance',
        t.earnings,
        'wallet',
        [
          item(
            'earnings',
            t.income,
            route(
              'earnings',
            ),
            'earnings',
            'wallet',
          ),

          item(
            'payouts',
            t.payouts,
            route(
              'payouts',
            ),
            'payouts',
            'wallet',
          ),
        ],
      ),
    ];
  }

  /*
   * ADMIN
   */
  if (
    admin
  ) {
    return [
      dashboard,

      group(
        'people',
        t.people,
        'user',
        [
          item(
            'users',
            t.users,
            route(
              'users',
            ),
            'users',
            'user',
          ),

          item(
            'organizations',
            t.organizations,
            route(
              'organizations',
            ),
            'organizations',
            'building',
          ),

          item(
            'forms',
            t.forms,
            route(
              'forms',
            ),
            'forms',
            'book',
          ),
        ],
      ),

      group(
        'experts-area',
        t.expertsArea,
        'sparkles',
        [
          item(
            'experts',
            t.experts,
            route(
              'experts',
            ),
            'experts',
            'user',
          ),

          item(
            'applications',
            t.applications,
            route(
              'expert-applications',
            ),
            'expert-applications',
            'user',
          ),

          item(
            'verification',
            t.verification,
            route(
              'verification',
            ),
            'verification',
            'shield',
          ),

          item(
            'expert-documents',
            t.expertDocuments,
            route(
              'expert-documents',
            ),
            'expert-documents',
            'book',
          ),

          item(
            'services',
            t.services,
            route(
              'services',
            ),
            'services',
            'sparkles',
          ),

          item(
            'taxonomy',
            t.taxonomy,
            route(
              'taxonomy',
            ),
            'taxonomy',
            'grid',
          ),

          item(
            'files',
            t.files,
            route(
              'files',
            ),
            'files',
            'book',
          ),
        ],
      ),

      group(
        'operations',
        t.operations,
        'server',
        [
          item(
            'sessions',
            original(
              'sessions',
              t.monitoredSessions,
            ),
            route(
              'sessions',
            ),
            'sessions',
            'video',
          ),

          item(
            'bookings',
            t.bookings,
            route(
              'bookings',
            ),
            'bookings',
            'calendar',
          ),

          item(
            'calendar-settings',
            t.calendarSettings,
            route(
              'calendar-settings',
            ),
            'calendar-settings',
            'calendar',
          ),

          item(
            'messages',
            t.messages,
            route(
              'messages',
            ),
            'messages',
            'mail',
          ),

          item(
            'inbox',
            t.managedInbox,
            route(
              'inbox',
            ),
            'inbox',
            'mail',
          ),

          item(
            'notifications',
            t.notifications,
            route(
              'notifications',
            ),
            'notifications',
            'bell',
          ),
        ],
      ),

      group(
        'finance-admin',
        t.financeAdmin,
        'wallet',
        [
          item(
            'finance',
            t.financeAdmin,
            route(
              'finance',
            ),
            'finance',
            'wallet',
          ),
        ],
      ),

      group(
        'platform',
        t.platform,
        'filter',
        [
          item(
            'localization',
            t.localization,
            route(
              'localization',
            ),
            'localization',
            'globe',
          ),

          item(
            'audit',
            t.audit,
            route(
              'audit',
            ),
            'audit',
            'shield',
          ),
        ],
      ),
    ];
  }

  /*
   * SUPPORT / OPERATOR
   */
  if (
    role ===
      'support' ||
    role ===
      'operations'
  ) {
    return [
      dashboard,

      group(
        'support-operations',
        t.supportOperations,
        'headset',
        [
          item(
            'queue',
            t.queue,
            route(
              'queue',
            ),
            'queue',
            'phone',
          ),

          item(
            'sessions',
            t.monitoredSessions,
            route(
              'sessions',
            ),
            'sessions',
            'video',
          ),

          item(
            'bookings',
            t.supportBookings,
            route(
              'bookings',
            ),
            'bookings',
            'calendar',
          ),
        ],
      ),

      link(
        'support-messages',
        item(
          'support-messages',
          t.messages,
          route(
            'messages',
          ),
          'messages',
          'mail',
          [
            'messages',
            'notifications',
          ],
        ),
      ),

      group(
        'support-cases',
        t.supportCases,
        'headset',
        [
          item(
            'inbox',
            t.managedInbox,
            route(
              'inbox',
            ),
            'inbox',
            'mail',
          ),

          item(
            'tickets',
            t.tickets,
            route(
              'tickets',
            ),
            'tickets',
            'headset',
          ),

          item(
            'complaints',
            t.complaints,
            route(
              'complaints',
            ),
            'complaints',
            'headset',
          ),
        ],
      ),

      group(
        'shifts',
        t.shifts,
        'clock',
        [
          item(
            'shifts',
            t.shifts,
            route(
              'shifts',
            ),
            'shifts',
            'clock',
          ),
        ],
      ),
    ];
  }

  /*
   * CALL CENTER
   */
  if (
    role ===
    'call'
  ) {
    return [
      dashboard,

      group(
        'call-center',
        t.callOperations,
        'phone',
        [
          item(
            'queue',
            t.queue,
            route(
              'queue',
            ),
            'queue',
            'phone',
          ),

          item(
            'extensions',
            t.extensions,
            route(
              'extensions',
            ),
            'extensions',
            'phone',
          ),

          item(
            'routes',
            t.routes,
            route(
              'routes',
            ),
            'routes',
            'filter',
          ),

          item(
            'trunks',
            t.trunks,
            route(
              'trunks',
            ),
            'trunks',
            'server',
          ),
        ],
      ),

      group(
        'call-history',
        t.callHistory,
        'clock',
        [
          item(
            'history',
            t.callHistory,
            route(
              'history',
            ),
            'history',
            'clock',
          ),

          item(
            'recordings',
            t.recordings,
            route(
              'recordings',
            ),
            'recordings',
            'play',
          ),

          item(
            'costs',
            t.costs,
            route(
              'costs',
            ),
            'costs',
            'wallet',
          ),
        ],
      ),
    ];
  }

  /*
   * All other specialist workspaces:
   * keep access to existing functionality, but put it under
   * one logical tools group rather than rendering every
   * backend capability as a principal navigation item.
   */
  const fallback =
    links
      .filter(
        ([part]) =>
          part !== '',
      )
      .map(
        ([
          part,
          label,
        ]) =>
          item(
            part,
            label,
            route(
              part,
            ),
            part,
            iconFor(
              part,
            ),
          ),
      );

  return [
    dashboard,

    ...(fallback.length
      ? [
          group(
            'tools',
            t.tools,
            'grid',
            fallback,
          ),
        ]
      : []),
  ];
}

export function flattenDashboard22Navigation(
  entries: Dashboard22NavEntry[],
) {
  return entries.flatMap(
    (
      entry,
    ) =>
      entry.kind ===
      'link'
        ? [
            entry.item,
          ]
        : entry.items,
  );
}
