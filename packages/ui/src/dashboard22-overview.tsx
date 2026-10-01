'use client';

import {
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  userApi,
} from './users-client';

import {
  Icon,
  type IconName,
} from './icons';

import {
  dashboard22OverviewCopy,
} from './dashboard22-overview-copy';

import {
  schedulingCopy,
} from './scheduling-copy';

type Booking = {
  id: string;

  expert_code: string;

  service_id: string;

  start_at: string;

  end_at: string | null;

  status: string;

  timezone: string;

  service:
    | {
        title?: string;
        expert_name?: string;
        price_minor?: number;
        currency?: string;
        kind?: string;
      }
    | null;
};

type Question = {
  id: string;

  is_owner?: boolean;

  can_answer?: boolean;

  question?: string;

  answer?: string | null;

  publication?: string;

  created_at?: string;
};

type Conversation = {
  id: string;

  type: string;

  state: string;

  unread: number;

  updated_at: string;
};

type Notification = {
  id: string;

  category: string;

  event: string;

  context_id: string;

  read_at: string | null;

  created_at: string;
};

type NotificationResponse = {
  items: Notification[];
  unread: number;
};

type WalletBalance = {
  currency: string;

  kind: string;

  balance: string;
};

type WalletHistory = {
  id: string;

  reference: string;

  description: string;

  created_at: string;

  kind: string;

  currency: string;

  debit: string;

  credit: string;
};

type Currency = {
  code: string;
  decimals: number;
};

type Payment = {
  id: string;

  provider: string;

  amount: string;

  currency: string;

  decimals: number;

  status: string;

  created_at: string;
};

type AdminInbox = {
  id: string;

  type: string;

  state: string;

  updated_at: string;
};

type Activity = {
  id: string;

  type:
    | 'payment'
    | 'wallet'
    | 'question'
    | 'answer'
    | 'message'
    | 'notification'
    | 'session';

  title: string;

  detail: string;

  at: string;

  icon: IconName;
};

type OverviewLinks = {
  sessions: string;
  bookings: string;
  questions: string;
  messages: string;
  notifications: string;
  wallet: string;
  events: string;
};

function validDate(
  value:
    | string
    | null
    | undefined,
) {
  if (!value)
    return false;

  return Number.isFinite(
    Date.parse(
      value,
    ),
  );
}

function formatDate(
  locale: string,
  value: string,
  timezone?: string,
) {
  try {
    return new Intl.DateTimeFormat(
      locale,
      {
        dateStyle:
          'medium',

        timeStyle:
          'short',

        ...(
          timezone
            ? {
                timeZone:
                  timezone,
              }
            : {}
        ),
      },
    ).format(
      new Date(
        value,
      ),
    );
  } catch {
    return value;
  }
}

function amount(
  locale: string,
  raw: string,
  currency: string,
  decimals = 2,
) {
  try {
    const divisor =
      10 **
      Math.max(
        0,
        decimals,
      );

    return new Intl.NumberFormat(
      locale,
      {
        style:
          'currency',

        currency,

        maximumFractionDigits:
          decimals,
      },
    ).format(
      Number(
        raw,
      ) /
        divisor,
    );
  } catch {
    return (
      `${raw} ${currency}`
    );
  }
}

function CountCard({
  icon,
  value,
  title,
  detail,
  href,
  disabled = false,
}: {
  icon: IconName;

  value: string;

  title: string;

  detail?: string | undefined;

  href?: string | undefined;

  disabled?: boolean | undefined;
}) {
  const body = (
    <>
      <div className="dash22-overview-stat-head">
        <span className="dash22-overview-stat-icon">
          <Icon
            name={
              icon
            }
          />
        </span>

        {href &&
          !disabled && (
          <Icon
            name="arrow"
            className="direction-icon dash22-overview-stat-arrow"
          />
        )}
      </div>

      <strong>
        {value}
      </strong>

      <span className="dash22-overview-stat-title">
        {title}
      </span>

      {detail && (
        <small>
          {detail}
        </small>
      )}
    </>
  );

  return href &&
    !disabled ? (
    <a
      className="dash22-overview-stat"
      href={
        href
      }
    >
      {body}
    </a>
  ) : (
    <article
      className={`dash22-overview-stat${
        disabled
          ? ' is-disabled'
          : ''
      }`}
    >
      {body}
    </article>
  );
}

export function DashboardOverview({
  locale,
  role,
  profileName,
  links,
}: {
  locale: string;

  role: string;

  profileName: string;

  links: OverviewLinks;
}) {
  const t =
    dashboard22OverviewCopy[
      locale
    ]!;

  const schedule =
    schedulingCopy[
      locale
    ]!;

  const [
    bookings,
    setBookings,
  ] =
    useState<Booking[]>([]);

  const [
    questions,
    setQuestions,
  ] =
    useState<Question[]>([]);

  const [
    conversations,
    setConversations,
  ] =
    useState<Conversation[]>([]);

  const [
    notifications,
    setNotifications,
  ] =
    useState<NotificationResponse>({
      items:
        [],

      unread:
        0,
    });

  const [
    balances,
    setBalances,
  ] =
    useState<WalletBalance[]>([]);

  const [
    walletHistory,
    setWalletHistory,
  ] =
    useState<WalletHistory[]>([]);

  const [
    currencies,
    setCurrencies,
  ] =
    useState<Currency[]>([]);

  const [
    payments,
    setPayments,
  ] =
    useState<Payment[]>([]);

  const [
    adminInbox,
    setAdminInbox,
  ] =
    useState<AdminInbox[]>([]);

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    partial,
    setPartial,
  ] =
    useState(false);

  const [
    now,
    setNow,
  ] =
    useState(
      Date.now(),
    );

  useEffect(() => {
    const timer =
      window.setInterval(
        () =>
          setNow(
            Date.now(),
          ),
        60000,
      );

    return () =>
      window.clearInterval(
        timer,
      );
  }, []);

  useEffect(() => {
    let alive =
      true;

    const requests: {
      key: string;
      request: Promise<unknown>;
    }[] = [
      {
        key:
          'conversations',

        request:
          userApi<
            Conversation[]
          >(
            'communications/conversations',
          ),
      },

      {
        key:
          'notifications',

        request:
          userApi<
            NotificationResponse
          >(
            'notifications',
          ),
      },
    ];

    if (
      [
        'account',
        'expert',
        'admin',
      ].includes(
        role,
      )
    ) {
      requests.push({
        key:
          'bookings',

        request:
          userApi<
            Booking[]
          >(
            'bookings/scheduled?' +
              new URLSearchParams({
                view:
                  role ===
                  'expert'
                    ? 'expert'
                    : role ===
                        'admin'
                      ? 'admin'
                      : 'mine',

                period:
                  'all',
              }),
          ),
      });
    }

    if (
      role ===
      'admin'
    ) {
      requests.push(
        {
          key:
            'questions',

          request:
            userApi<
              Question[]
            >(
              'questions/admin',
            ),
        },

        {
          key:
            'adminInbox',

          request:
            userApi<
              AdminInbox[]
            >(
              'communications/admin/inbox',
            ),
        },
      );
    } else if (
      role ===
        'account' ||
      role ===
        'expert'
    ) {
      requests.push({
        key:
          'questions',

        request:
          userApi<
            Question[]
          >(
            'questions',
          ),
      });
    }

    if (
      role ===
        'account' ||
      role ===
        'expert'
    ) {
      requests.push(
        {
          key:
            'balances',

          request:
            userApi<
              WalletBalance[]
            >(
              'wallet',
            ),
        },

        {
          key:
            'walletHistory',

          request:
            userApi<
              WalletHistory[]
            >(
              'wallet/history',
            ),
        },

        {
          key:
            'currencies',

          request:
            userApi<
              Currency[]
            >(
              'accounting/currencies',
            ),
        },
      );
    }

    if (
      role ===
      'account'
    ) {
      requests.push({
        key:
          'payments',

        request:
          userApi<
            Payment[]
          >(
            'payments',
          ),
      });
    }

    void Promise.allSettled(
      requests.map(
        (
          item,
        ) =>
          item.request,
      ),
    ).then(
      (
        results,
      ) => {
        if (
          !alive
        )
          return;

        let failure =
          false;

        results.forEach(
          (
            result,
            index,
          ) => {
            const key =
              requests[
                index
              ]!.key;

            if (
              result.status !==
              'fulfilled'
            ) {
              failure =
                true;

              return;
            }

            const value =
              result.value;

            switch (
              key
            ) {
              case 'bookings':
                setBookings(
                  value as Booking[],
                );
                break;

              case 'questions':
                setQuestions(
                  value as Question[],
                );
                break;

              case 'conversations':
                setConversations(
                  value as Conversation[],
                );
                break;

              case 'notifications':
                setNotifications(
                  value as NotificationResponse,
                );
                break;

              case 'balances':
                setBalances(
                  value as WalletBalance[],
                );
                break;

              case 'walletHistory':
                setWalletHistory(
                  value as WalletHistory[],
                );
                break;

              case 'currencies':
                setCurrencies(
                  value as Currency[],
                );
                break;

              case 'payments':
                setPayments(
                  value as Payment[],
                );
                break;

              case 'adminInbox':
                setAdminInbox(
                  value as AdminInbox[],
                );
                break;
            }
          },
        );

        setPartial(
          failure,
        );

        setLoading(
          false,
        );
      },
    );

    return () => {
      alive =
        false;
    };
  }, [
    role,
    locale,
  ]);

  const upcoming =
    useMemo(
      () =>
        bookings.filter(
          (
            item,
          ) =>
            Date.parse(
              item.start_at,
            ) >
              now &&
            ![
              'CANCELLED',
              'EXPIRED',
              'COMPLETED',
            ].includes(
              item.status,
            ),
        ),
      [
        bookings,
        now,
      ],
    );

  const completed =
    useMemo(
      () =>
        bookings.filter(
          (
            item,
          ) =>
            item.status ===
            'COMPLETED',
        ),
      [
        bookings,
      ],
    );

  const nextSession =
    useMemo(
      () =>
        upcoming
          .filter(
            (
              item,
            ) =>
              [
                'CONFIRMED',
                'RESCHEDULED',
                'RESCHEDULE_REQUESTED',
              ].includes(
                item.status,
              ),
          )
          .sort(
            (
              first,
              second,
            ) =>
              Date.parse(
                first.start_at,
              ) -
              Date.parse(
                second.start_at,
              ),
          )[0] ??
        null,
      [
        upcoming,
      ],
    );

  const unreadMessages =
    conversations.reduce(
      (
        total,
        item,
      ) =>
        total +
        Number(
          item.unread ??
            0,
        ),
      0,
    );

  const ownedQuestions =
    questions.filter(
      (
        item,
      ) =>
        role ===
        'account'
          ? item.is_owner !==
            false
          : true,
    );

  const answered =
    ownedQuestions.filter(
      (
        item,
      ) =>
        Boolean(
          item.answer,
        ),
    );

  const assigned =
    questions.filter(
      (
        item,
      ) =>
        Boolean(
          item.can_answer,
        ) &&
        !item.answer,
    );

  const primaryBalance =
    useMemo(
      () => {
        const available =
          balances.filter(
            (
              item,
            ) =>
              item.kind ===
              'AVAILABLE',
          );

        return (
          available.find(
            (
              item,
            ) =>
              item.currency ===
              'USD',
          ) ??
          available[0] ??
          null
        );
      },
      [
        balances,
      ],
    );

  const availableCurrencyCount =
    new Set(
      balances
        .filter(
          (
            item,
          ) =>
            item.kind ===
            'AVAILABLE',
        )
        .map(
          (
            item,
          ) =>
            item.currency,
        ),
    ).size;

  const currencyDecimals =
    (
      code: string,
    ) =>
      currencies.find(
        (
          item,
        ) =>
          item.code ===
          code,
      )?.decimals ??
      (
        [
          'IRR',
          'IRT',
        ].includes(
          code,
        )
          ? 0
          : 2
      );

  const balanceText =
    primaryBalance
      ? amount(
          locale,
          primaryBalance.balance,
          primaryBalance.currency,
          currencyDecimals(
            primaryBalance.currency,
          ),
        )
      : t.noBalance;

  const countdown =
    useMemo(
      () => {
        if (
          !nextSession
        )
          return null;

        const remaining =
          Math.max(
            0,
            Date.parse(
              nextSession.start_at,
            ) -
              now,
          );

        const minutes =
          Math.floor(
            remaining /
              60000,
          );

        const days =
          Math.floor(
            minutes /
              1440,
          );

        const hours =
          Math.floor(
            (
              minutes %
              1440
            ) /
              60,
          );

        const mins =
          minutes %
          60;

        return {
          days,
          hours,
          minutes:
            mins,
        };
      },
      [
        nextSession,
        now,
      ],
    );

  const activities =
    useMemo(
      () => {
        const list: Activity[] =
          [];

        payments.forEach(
          (
            item,
          ) => {
            if (
              !validDate(
                item.created_at,
              )
            )
              return;

            list.push({
              id:
                'payment-' +
                item.id,

              type:
                'payment',

              icon:
                'wallet',

              title:
                t.activityPayment,

              detail:
                `${amount(
                  locale,
                  item.amount,
                  item.currency,
                  item.decimals ??
                    currencyDecimals(
                      item.currency,
                    ),
                )} · ${
                  item.status
                }`,

              at:
                item.created_at,
            });
          },
        );

        walletHistory
          .slice(
            0,
            20,
          )
          .forEach(
            (
              item,
            ) => {
              if (
                !validDate(
                  item.created_at,
                )
              )
                return;

              list.push({
                id:
                  'wallet-' +
                  item.id,

                type:
                  'wallet',

                icon:
                  'wallet',

                title:
                  t.activityWallet,

                detail:
                  `${item.description} · ${item.currency}`,

                at:
                  item.created_at,
              });
            },
          );

        questions
          .slice(
            0,
            30,
          )
          .forEach(
            (
              item,
            ) => {
              if (
                !validDate(
                  item.created_at,
                )
              )
                return;

              list.push({
                id:
                  'question-' +
                  item.id,

                type:
                  item.answer
                    ? 'answer'
                    : 'question',

                icon:
                  'comments',

                title:
                  item.answer
                    ? t.activityAnswer
                    : t.activityQuestion,

                detail:
                  (
                    item.question ??
                    t.question
                  ).slice(
                    0,
                    110,
                  ),

                at:
                  item.created_at!,
              });
            },
          );

        conversations
          .filter(
            (
              item,
            ) =>
              validDate(
                item.updated_at,
              ),
          )
          .slice(
            0,
            20,
          )
          .forEach(
            (
              item,
            ) =>
              list.push({
                id:
                  'message-' +
                  item.id,

                type:
                  'message',

                icon:
                  'mail',

                title:
                  t.activityMessage,

                detail:
                  item.unread >
                  0
                    ? `${t.newMessage} · ${item.unread}`
                    : item.type,

                at:
                  item.updated_at,
              }),
          );

        notifications.items
          .filter(
            (
              item,
            ) =>
              validDate(
                item.created_at,
              ),
          )
          .slice(
            0,
            20,
          )
          .forEach(
            (
              item,
            ) =>
              list.push({
                id:
                  'notification-' +
                  item.id,

                type:
                  'notification',

                icon:
                  'bell',

                title:
                  t.activityNotification,

                detail:
                  item.event,

                at:
                  item.created_at,
              }),
          );

        completed
          .slice(
            0,
            12,
          )
          .forEach(
            (
              item,
            ) => {
              if (
                !validDate(
                  item.start_at,
                )
              )
                return;

              list.push({
                id:
                  'session-' +
                  item.id,

                type:
                  'session',

                icon:
                  'video',

                title:
                  t.activitySession,

                detail:
                  item.service
                    ?.expert_name ??
                  item.service
                    ?.title ??
                  item.expert_code,

                at:
                  item.start_at,
              });
            },
          );

        return list
          .sort(
            (
              first,
              second,
            ) =>
              Date.parse(
                second.at,
              ) -
              Date.parse(
                first.at,
              ),
          )
          .slice(
            0,
            8,
          );
      },
      [
        payments,
        walletHistory,
        questions,
        conversations,
        notifications,
        completed,
        locale,
        t,
        currencies,
      ],
    );

  const number = (
    value: number,
  ) =>
    new Intl.NumberFormat(
      locale,
    ).format(
      value,
    );

  const cards =
    role ===
    'account'
      ? [
          {
            icon:
              'calendar' as IconName,

            value:
              number(
                upcoming.length,
              ),

            title:
              t.upcomingSessions,

            href:
              links.bookings,
          },

          {
            icon:
              'check' as IconName,

            value:
              number(
                completed.length,
              ),

            title:
              t.completedSessions,

            href:
              links.sessions,
          },

          {
            icon:
              'comments' as IconName,

            value:
              number(
                ownedQuestions.length,
              ),

            title:
              t.myQuestions,

            href:
              links.questions,
          },

          {
            icon:
              'sparkles' as IconName,

            value:
              number(
                answered.length,
              ),

            title:
              t.receivedAnswers,

            href:
              links.questions,
          },

          {
            icon:
              'calendar' as IconName,

            value:
              t.eventZero,

            title:
              t.registeredEvents,

            detail:
              t.eventsUnavailable,

            href:
              links.events,

            disabled:
              true,
          },

          {
            icon:
              'mail' as IconName,

            value:
              number(
                unreadMessages,
              ),

            title:
              t.unreadMessages,

            href:
              links.messages,
          },

          {
            icon:
              'wallet' as IconName,

            value:
              balanceText,

            title:
              t.walletBalance,

            detail:
              availableCurrencyCount >
              1
                ? `${number(
                    availableCurrencyCount,
                  )} ${t.currencies}`
                : undefined,

            href:
              links.wallet,
          },
        ]
      : role ===
          'expert'
        ? [
            {
              icon:
                'calendar' as IconName,

              value:
                number(
                  upcoming.length,
                ),

              title:
                t.upcomingSessions,

              href:
                links.bookings,
            },

            {
              icon:
                'check' as IconName,

              value:
                number(
                  completed.length,
                ),

              title:
                t.completedSessions,

              href:
                links.sessions,
            },

            {
              icon:
                'comments' as IconName,

              value:
                number(
                  assigned.length,
                ),

              title:
                t.assignedQuestions,

              href:
                links.questions,
            },

            {
              icon:
                'sparkles' as IconName,

              value:
                number(
                  questions.filter(
                    (
                      item,
                    ) =>
                      item.can_answer &&
                      item.answer,
                  ).length,
                ),

              title:
                t.answeredQuestions,

              href:
                links.questions,
            },

            {
              icon:
                'mail' as IconName,

              value:
                number(
                  unreadMessages,
                ),

              title:
                t.unreadMessages,

              href:
                links.messages,
            },

            {
              icon:
                'wallet' as IconName,

              value:
                balanceText,

              title:
                t.walletBalance,

              href:
                links.wallet,
            },
          ]
        : role ===
            'admin'
          ? [
              {
                icon:
                  'calendar' as IconName,

                value:
                  number(
                    upcoming.length,
                  ),

                title:
                  t.upcomingSessions,

                href:
                  links.bookings,
              },

              {
                icon:
                  'check' as IconName,

                value:
                  number(
                    completed.length,
                  ),

                title:
                  t.completedSessions,

                href:
                  links.bookings,
              },

              {
                icon:
                  'comments' as IconName,

                value:
                  number(
                    questions.filter(
                      (
                        item,
                      ) =>
                        item.publication ===
                        'PENDING',
                    ).length,
                  ),

                title:
                  t.pendingQuestions,

                href:
                  links.questions,
              },

              {
                icon:
                  'mail' as IconName,

                value:
                  number(
                    adminInbox.length,
                  ),

                title:
                  t.managedInbox,

                href:
                  links.messages,
              },

              {
                icon:
                  'bell' as IconName,

                value:
                  number(
                    notifications.unread,
                  ),

                title:
                  t.unreadNotifications,

                href:
                  links.notifications,
              },
            ]
          : [
              {
                icon:
                  'mail' as IconName,

                value:
                  number(
                    unreadMessages,
                  ),

                title:
                  t.unreadMessages,

                href:
                  links.messages,
              },

              {
                icon:
                  'bell' as IconName,

                value:
                  number(
                    notifications.unread,
                  ),

                title:
                  t.unreadNotifications,

                href:
                  links.notifications,
              },
            ];

  const overviewLabel =
    role ===
    'account'
      ? t.accountOverview
      : role ===
          'expert'
        ? t.expertOverview
        : role ===
            'admin'
          ? t.adminOverview
          : t.workspaceOverview;

  return (
    <section className="dash22-overview">
      <header className="dash22-overview-heading">
        <div>
          <span className="dash22-overview-eyebrow">
            <Icon name="sparkles" />

            {overviewLabel}
          </span>

          <h1>
            {t.welcome}
            {profileName
              ? `، ${profileName}`
              : ''}
          </h1>

          <p>
            {t.overviewText}
          </p>
        </div>

        <span className="dash22-live-data">
          <i />

          {t.updated}
        </span>
      </header>

      {partial && (
        <div
          className="dash22-overview-warning"
          role="status"
        >
          <Icon name="help" />

          <span>
            {t.loadError}
          </span>
        </div>
      )}

      <div
        className={`dash22-overview-stats${
          loading
            ? ' is-loading'
            : ''
        }`}
        aria-busy={
          loading
        }
      >
        {cards.map(
          (
            card,
            index,
          ) => (
            <CountCard
              key={
                index
              }
              {...card}
            />
          ),
        )}
      </div>

      <div className="dash22-overview-layout">
        {(role ===
          'account' ||
          role ===
            'expert') && (
          <section className="dash22-next-session">
            <div className="dash22-section-heading">
              <div>
                <span>
                  <Icon name="video" />

                  {role ===
                  'account'
                    ? t.nextSession
                    : t.nextExpertSession}
                </span>
              </div>

              <a
                href={
                  links.sessions
                }
              >
                {t.viewSessions}
                <Icon
                  name="arrow"
                  className="direction-icon"
                />
              </a>
            </div>

            {nextSession ? (
              <div className="dash22-next-session-body">
                <div className="dash22-next-session-icon">
                  <Icon
                    name={
                      nextSession.service
                        ?.kind ===
                      'TEXT'
                        ? 'comments'
                        : 'video'
                    }
                  />
                </div>

                <div className="dash22-next-session-copy">
                  <strong>
                    {nextSession.service
                      ?.title ??
                      t.session}
                  </strong>

                  <span>
                    {t.expert}:{' '}
                    {nextSession.service
                      ?.expert_name ??
                      nextSession.expert_code}
                  </span>

                  <time
                    dateTime={
                      nextSession.start_at
                    }
                  >
                    <Icon name="calendar" />

                    {formatDate(
                      locale,
                      nextSession.start_at,
                      nextSession.timezone,
                    )}
                  </time>
                </div>

                {countdown && (
                  <div className="dash22-countdown">
                    <small>
                      {t.countdown}
                    </small>

                    <div>
                      {countdown.days >
                        0 && (
                        <span>
                          <strong>
                            {number(
                              countdown.days,
                            )}
                          </strong>

                          {t.day}
                        </span>
                      )}

                      <span>
                        <strong>
                          {number(
                            countdown.hours,
                          )}
                        </strong>

                        {t.hour}
                      </span>

                      <span>
                        <strong>
                          {number(
                            countdown.minutes,
                          )}
                        </strong>

                        {t.minute}
                      </span>
                    </div>
                  </div>
                )}

                <a
                  className="button dash22-session-join"
                  href={`${links.sessions}?booking=${encodeURIComponent(
                    nextSession.id,
                  )}`}
                >
                  <Icon name="play" />
                  {t.joinSession}
                </a>
              </div>
            ) : (
              <div className="dash22-next-session-empty">
                <Icon name="calendar" />

                <p>
                  {t.noNextSession}
                </p>

                <a
                  href={
                    links.bookings
                  }
                >
                  {t.viewBookings}
                </a>
              </div>
            )}
          </section>
        )}

        <section className="dash22-recent-activity">
          <div className="dash22-section-heading">
            <div>
              <span>
                <Icon name="clock" />

                {t.recentActivity}
              </span>

              <small>
                {t.recentActivityText}
              </small>
            </div>
          </div>

          {activities.length ? (
            <div className="dash22-activity-list">
              {activities.map(
                (
                  item,
                ) => (
                  <article
                    key={
                      item.id
                    }
                    className={`dash22-activity-item type-${item.type}`}
                  >
                    <span className="dash22-activity-icon">
                      <Icon
                        name={
                          item.icon
                        }
                      />
                    </span>

                    <div>
                      <strong>
                        {item.title}
                      </strong>

                      <p>
                        {item.detail}
                      </p>
                    </div>

                    <time
                      dateTime={
                        item.at
                      }
                    >
                      {formatDate(
                        locale,
                        item.at,
                      )}
                    </time>
                  </article>
                ),
              )}
            </div>
          ) : (
            <div className="dash22-activity-empty">
              <Icon name="clock" />

              <p>
                {loading
                  ? '…'
                  : t.activityEmpty}
              </p>
            </div>
          )}
        </section>
      </div>

      <div className="dash22-overview-links">
        <a
          href={
            links.bookings
          }
        >
          <Icon name="calendar" />
          {t.viewBookings}
        </a>

        <a
          href={
            links.questions
          }
        >
          <Icon name="comments" />
          {t.viewQuestions}
        </a>

        <a
          href={
            links.messages
          }
        >
          <Icon name="mail" />
          {t.viewMessages}
        </a>

        {(role ===
          'account' ||
          role ===
            'expert') && (
          <a
            href={
              links.wallet
            }
          >
            <Icon name="wallet" />
            {t.viewWallet}
          </a>
        )}
      </div>
    </section>
  );
}
