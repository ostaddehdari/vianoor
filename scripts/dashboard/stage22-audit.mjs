import {
  readFile,
} from 'node:fs/promises';

import {
  fileURLToPath,
} from 'node:url';

import {
  usersCopy,
} from '../../packages/ui/src/users-copy.ts';

import {
  schedulingCopy,
} from '../../packages/ui/src/scheduling-copy.ts';

import {
  sessionsCopy,
} from '../../packages/ui/src/sessions-copy.ts';

import {
  communicationCopy,
} from '../../packages/ui/src/communication-copy.ts';

import {
  financeCopy,
} from '../../packages/ui/src/finance-copy.ts';

import {
  scholarsCopy,
} from '../../packages/ui/src/scholars-copy.ts';

import {
  discoveryCopy,
} from '../../packages/ui/src/discovery-copy.ts';

import {
  threeCalendarCopy,
} from '../../packages/ui/src/three-calendar-copy.ts';

import {
  dashboard22Copy,
} from '../../packages/ui/src/dashboard22-copy.ts';

import {
  dashboard22OverviewCopy,
} from '../../packages/ui/src/dashboard22-overview-copy.ts';

import {
  dashboard22TableCopy,
} from '../../packages/ui/src/dashboard22-table-copy.ts';

import {
  buildDashboard22Navigation,
} from '../../packages/ui/src/dashboard22-navigation.ts';

const dictionaries = {
  usersCopy,
  schedulingCopy,
  sessionsCopy,
  communicationCopy,
  financeCopy,
  scholarsCopy,
  discoveryCopy,
  threeCalendarCopy,
  dashboard22Copy,
  dashboard22OverviewCopy,
  dashboard22TableCopy,
};

function flatten(
  value,
  prefix = '',
  output = new Map(),
) {
  if (
    typeof value ===
    'string'
  ) {
    output.set(
      prefix,
      value,
    );

    return output;
  }

  if (
    Array.isArray(
      value,
    )
  ) {
    value.forEach(
      (
        item,
        index,
      ) =>
        flatten(
          item,
          `${prefix}.${index}`,
          output,
        ),
    );

    return output;
  }

  if (
    value &&
    typeof value ===
      'object'
  ) {
    for (
      const [
        key,
        child,
      ]
      of Object.entries(
        value,
      )
    )
      flatten(
        child,
        prefix
          ? `${prefix}.${key}`
          : key,
        output,
      );
  }

  return output;
}

const persian =
  /[\u0600-\u06ff]/u;

const latin =
  /[A-Za-z]/u;

const technical =
  /^(?:PayPal|Stripe|NOWPayments|Visa|Mastercard|Apple Pay|Google Pay|Visa \/ Mastercard · Apple Pay \/ Google Pay|WebRTC|LiveKit|TURN|OAuth|OTP|SMS|SIP|IVR|API|IP|IPinfo|OpenSearch|JPG|PNG|WebP|PDF|USD|EUR|GBP|AED|IRR|IRT|USDT|USDC|BTC|ETH|ISO|UTC|IBAN)$/i;

const failures =
  [];

for (
  const [
    name,
    dictionary,
  ]
  of Object.entries(
    dictionaries,
  )
) {
  const fa =
    flatten(
      dictionary.fa,
    );

  const en =
    flatten(
      dictionary.en,
    );

  const faKeys =
    [
      ...fa.keys(),
    ].sort();

  const enKeys =
    [
      ...en.keys(),
    ].sort();

  if (
    JSON.stringify(
      faKeys,
    ) !==
    JSON.stringify(
      enKeys,
    )
  )
    failures.push(
      `${name}: FA/EN key parity failed`,
    );

  for (
    const key
    of new Set([
      ...faKeys,
      ...enKeys,
    ])
  ) {
    const faValue =
      fa.get(
        key,
      );

    const enValue =
      en.get(
        key,
      );

    if (
      typeof enValue ===
        'string' &&
      persian.test(
        enValue,
      )
    )
      failures.push(
        `${name}.${key}: Persian script leaked into EN -> ${JSON.stringify(enValue)}`,
      );

    if (
      typeof faValue ===
        'string' &&
      latin.test(
        faValue,
      ) &&
      !persian.test(
        faValue,
      ) &&
      !technical.test(
        faValue.trim(),
      )
    )
      failures.push(
        `${name}.${key}: English-only FA label -> ${JSON.stringify(faValue)}`,
      );

    if (
      typeof faValue ===
        'string' &&
      typeof enValue ===
        'string' &&
      faValue ===
        enValue &&
      latin.test(
        faValue,
      ) &&
      !technical.test(
        faValue.trim(),
      )
    )
      failures.push(
        `${name}.${key}: untranslated identical FA/EN value -> ${JSON.stringify(faValue)}`,
      );
  }
}

/*
 * UI text nodes must come from locale dictionaries.
 * API enum values and technical identifiers inside JS
 * are allowed; direct English JSX labels are not.
 */

const sourceFiles = [
  'user-workspace.tsx',
  'dashboard22-drawer.tsx',
  'dashboard22-table.tsx',
  'dashboard22-overview.tsx',
  'scheduling.tsx',
  'communication.tsx',
  'communication-panels.tsx',
  'finance.tsx',
  'scholars.tsx',
  'user-admin.tsx',
  'sessions.tsx',
];

const uiRoot =
  fileURLToPath(
    new URL(
      '../../packages/ui/src/',
      import.meta.url,
    ),
  );

for (
  const filename
  of sourceFiles
) {
  const source =
    await readFile(
      uiRoot +
        filename,
      'utf8',
    );

  /*
   * Inspect only literal text that is enclosed by a real
   * JSX opening/closing tag.
   *
   * The former pattern incorrectly interpreted TypeScript
   * generics such as Promise<T> and userApi<Row> as text
   * appearing between `>` and `<`.
   */
  const matches = [
    ...source.matchAll(
      /<[A-Za-z][A-Za-z0-9.-]*(?:\s[^<>]*?)?>\s*([A-Za-z][A-Za-z0-9 .,&/+():_-]{2,80})\s*<\/[A-Za-z][A-Za-z0-9.-]*>/g,
    ),
  ];

  for (
    const match
    of matches
  ) {
    const value =
      match[1]
        .replace(
          /\s+/g,
          ' ',
        )
        .trim();

    if (
      value &&
      !technical.test(
        value,
      )
    )
      failures.push(
        `${filename}: direct English JSX label -> ${JSON.stringify(value)}`,
      );
  }
}

/*
 * Role navigation acceptance.
 */

const route =
  part =>
    '/fa/account' +
    (
      part
        ? '/' + part
        : ''
    );

const links = [
  ['', 'داشبورد'],
  ['sessions', 'جلسات'],
  ['messages', 'پیام‌ها'],
  ['channels', 'کانال‌ها'],
  ['questions', 'پرسش‌ها'],
  ['notifications', 'اعلان‌ها'],
  ['inbox', 'صندوق'],
  ['book', 'رزرو'],
  ['bookings', 'رزروها'],
  ['calendar', 'تقویم'],
  ['professional', 'پروفایل حرفه‌ای'],
  ['experts', 'اساتید'],
  ['expert-applications', 'درخواست استاد'],
  ['verification', 'تأیید'],
  ['expert-documents', 'مدارک'],
  ['services', 'خدمات'],
  ['taxonomy', 'تخصص‌ها'],
  ['files', 'فایل‌ها'],
  ['wallet', 'کیف پول'],
  ['finance', 'مالی'],
  ['profile', 'پروفایل'],
  ['localization', 'ترجمه'],
  ['users', 'کاربران'],
  ['forms', 'فرم‌ها'],
  ['organizations', 'سازمان‌ها'],
  ['audit', 'حسابرسی'],
];

const roles = [
  'account',
  'expert',
  'admin',
  'support',
  'operations',
  'call',
  'secretary',
  'responder',
  'scientific',
  'finance',
  'content',
  'organization',
  'auditor',
  'ai',
];

for (
  const role
  of roles
) {
  const navigation =
    buildDashboard22Navigation({
      locale:
        'fa',

      role,

      admin:
        role ===
        'admin',

      links,

      route,

      securityHref:
        '/fa/account/security',
    });

  if (
    navigation.length <
    1
  )
    failures.push(
      `role ${role}: empty navigation`,
    );

  console.log(
    'PASS role',
    role,
    navigation.length,
  );
}

const client =
  buildDashboard22Navigation({
    locale:
      'fa',

    role:
      'account',

    admin:
      false,

    links,

    route,

    securityHref:
      '/fa/account/security',
  });

if (
  client.length !==
  5
)
  failures.push(
    `client top-level count ${client.length}, expected 5`,
  );

const expert =
  buildDashboard22Navigation({
    locale:
      'fa',

    role:
      'expert',

    admin:
      false,

    links,

    route,

    securityHref:
      '/fa/account/security',
  });

if (
  expert.length !==
  5
)
  failures.push(
    `expert top-level count ${expert.length}, expected 5`,
  );

if (
  failures.length
) {
  console.error(
    '\nSTAGE22 AUDIT FAILURES\n',
  );

  for (
    const failure
    of failures
  )
    console.error(
      '-',
      failure,
    );

  process.exit(
    1,
  );
}

console.log(
  'LOCALIZATION_PARITY_PASS',
);

console.log(
  'FA_SCRIPT_INTEGRITY_PASS',
);

console.log(
  'EN_SCRIPT_INTEGRITY_PASS',
);

console.log(
  'DIRECT_LABEL_AUDIT_PASS',
);

console.log(
  'ALL_ROLE_NAVIGATION_PASS',
);

console.log(
  'STAGE22_LOCALIZATION_ROLE_AUDIT_PASS',
);
