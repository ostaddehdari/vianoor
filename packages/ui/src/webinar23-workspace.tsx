'use client';

import {
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  Icon,
} from './icons';

import {
  userApi,
  usersBase,
} from './users-client';

import {
  events23Copy,
} from './events23-copy';

type EventRow = {
  id: string;
  presenter_code: string;
  sponsor_code: string | null;
  source: string;
  status: string;
  title: string;
  description: string;
  language: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  capacity: number;
  price_minor: string;
  currency: string;
  public: boolean;
  chat_enabled: boolean;
  qna_enabled: boolean;
  raise_hand_enabled: boolean;
  role: string | null;
  registration_status: string | null;
};

type Invitation = {
  id: string;
  webinar_id: string;
  invitee_code: string;
  role: string;
  status: string;
  title: string;
  starts_at: string;
  ends_at: string;
  language: string;
  presenter_code: string;
  event_status: string;
};

type RequestRow = {
  id: string;
  sponsor_code: string;
  proposed_expert_code: string | null;
  title: string;
  description: string;
  language: string;
  proposed_start: string;
  duration_minutes: number;
  expected_attendees: number;
  budget_minor: string | null;
  currency: string;
  status: string;
  counter_start: string | null;
  resulting_event_id: string | null;
};

function iso(
  value: string,
) {
  return new Date(
    value,
  ).toISOString();
}

function minor(
  value: string,
  currency: string,
) {
  const parsed =
    Number(
      value ||
      '0',
    );

  if (
    !Number.isFinite(
      parsed,
    ) ||
    parsed <
      0
  )
    return '0';

  const decimals =
    [
      'IRR',
      'IRT',
    ].includes(
      currency,
    )
      ? 0
      : 2;

  return String(
    Math.round(
      parsed *
        10 **
          decimals,
    ),
  );
}

export function WebinarWorkspace({
  locale,
  role,
}: {
  locale: string;

  role: string;
}) {
  const t =
    events23Copy[
      locale
    ]!;

  const [
    events,
    setEvents,
  ] =
    useState<
      EventRow[]
    >([]);

  const [
    invitations,
    setInvitations,
  ] =
    useState<
      Invitation[]
    >([]);

  const [
    requests,
    setRequests,
  ] =
    useState<
      RequestRow[]
    >([]);

  const [
    openRequests,
    setOpenRequests,
  ] =
    useState<
      RequestRow[]
    >([]);

  const [
    busy,
    setBusy,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState('');

  const [
    notice,
    setNotice,
  ] =
    useState('');

  const [
    inviteText,
    setInviteText,
  ] =
    useState<
      Record<
        string,
        string
      >
    >({});

  const [
    counterTime,
    setCounterTime,
  ] =
    useState<
      Record<
        string,
        string
      >
    >({});

  const [
    create,
    setCreate,
  ] =
    useState({
      title:
        '',

      description:
        '',

      language:
        locale,

      starts:
        '',

      ends:
        '',

      capacity:
        '100',

      price:
        '0',

      currency:
        'USD',

      public:
        true,

      chat:
        true,

      qna:
        true,

      raiseHand:
        true,
    });

  const [
    sponsor,
    setSponsor,
  ] =
    useState({
      title:
        '',

      description:
        '',

      language:
        locale,

      expert:
        '',

      start:
        '',

      duration:
        '60',

      audience:
        '100',

      budget:
        '0',

      currency:
        'USD',
    });

  const expert =
    role ===
    'expert';

  const managed =
    useMemo(
      () =>
        events.filter(
          (
            item,
          ) =>
            item.role ===
              'PRESENTER' ||
            item.presenter_code,
        ),
      [
        events,
      ],
    );

  async function load() {
    const [
      eventRows,
      invitationRows,
      requestRows,
    ] =
      await Promise.all([
        userApi<
          EventRow[]
        >(
          'events/mine',
        ),

        userApi<
          Invitation[]
        >(
          'events/invitations/mine',
        ),

        userApi<
          RequestRow[]
        >(
          'events/requests/mine',
        ),
      ]);

    setEvents(
      eventRows,
    );

    setInvitations(
      invitationRows,
    );

    setRequests(
      requestRows,
    );

    if (
      expert
    ) {
      try {
        setOpenRequests(
          await userApi<
            RequestRow[]
          >(
            'events/requests/open',
          ),
        );
      } catch {
        setOpenRequests(
          [],
        );
      }
    }
  }

  async function act(
    fn:
      () =>
        Promise<void>,
  ) {
    setBusy(
      true,
    );

    setError(
      '',
    );

    setNotice(
      '',
    );

    try {
      await fn();

      await load();
    } catch {
      setError(
        t.error,
      );
    } finally {
      setBusy(
        false,
      );
    }
  }

  useEffect(
    () => {
      void load()
        .catch(
          () =>
            setError(
              t.error,
            ),
        );
    },
    [
      locale,
      role,
    ],
  );

  return (
    <section className="user-card webinar23-workspace">
      <div className="user-heading">
        <div>
          <h2>
            {t.myEvents}
          </h2>
        </div>

        <a
          className="button"
          href={`${usersBase}/${locale}/events`}
        >
          {t.upcoming}
        </a>
      </div>

      {error && (
        <p
          className="user-error"
          role="alert"
        >
          {error}
        </p>
      )}

      {notice && (
        <p
          className="user-success"
          role="status"
        >
          {notice}
        </p>
      )}

      {expert && (
        <details className="webinar23-dashboard-card">
          <summary>
            {t.createWebinar}
          </summary>

          <p>
            {t.createWebinarHint}
          </p>

          <form
            className="webinar23-form"
            onSubmit={(
              event,
            ) => {
              event.preventDefault();

              void act(
                async () => {
                  await userApi(
                    'events',
                    'POST',
                    {
                      request_key:
                        crypto.randomUUID(),

                      webinar: {
                        title:
                          create.title,

                        description:
                          create.description,

                        language:
                          create.language,

                        starts_at:
                          iso(
                            create.starts,
                          ),

                        ends_at:
                          iso(
                            create.ends,
                          ),

                        timezone:
                          Intl
                            .DateTimeFormat()
                            .resolvedOptions()
                            .timeZone,

                        capacity:
                          Number(
                            create.capacity,
                          ),

                        price_minor:
                          minor(
                            create.price,
                            create.currency,
                          ),

                        currency:
                          create.currency,

                        public:
                          create.public,

                        chat_enabled:
                          create.chat,

                        qna_enabled:
                          create.qna,

                        raise_hand_enabled:
                          create.raiseHand,

                        image_id:
                          null,
                      },
                    },
                  );

                  setNotice(
                    t.created,
                  );
                },
              );
            }}
          >
            <label>
              {t.webinarTitle}

              <input
                required
                value={
                  create.title
                }
                onChange={(
                  event,
                ) =>
                  setCreate({
                    ...create,
                    title:
                      event.target
                        .value,
                  })
                }
              />
            </label>

            <label>
              {t.description}

              <textarea
                value={
                  create.description
                }
                onChange={(
                  event,
                ) =>
                  setCreate({
                    ...create,
                    description:
                      event.target
                        .value,
                  })
                }
              />
            </label>

            <label>
              {t.language}

              <input
                required
                value={
                  create.language
                }
                onChange={(
                  event,
                ) =>
                  setCreate({
                    ...create,
                    language:
                      event.target
                        .value,
                  })
                }
              />
            </label>

            <label>
              {t.start}

              <input
                type="datetime-local"
                required
                value={
                  create.starts
                }
                onChange={(
                  event,
                ) =>
                  setCreate({
                    ...create,
                    starts:
                      event.target
                        .value,
                  })
                }
              />
            </label>

            <label>
              {t.end}

              <input
                type="datetime-local"
                required
                value={
                  create.ends
                }
                onChange={(
                  event,
                ) =>
                  setCreate({
                    ...create,
                    ends:
                      event.target
                        .value,
                  })
                }
              />
            </label>

            <label>
              {t.capacity}

              <input
                type="number"
                min="2"
                max="1000"
                required
                value={
                  create.capacity
                }
                onChange={(
                  event,
                ) =>
                  setCreate({
                    ...create,
                    capacity:
                      event.target
                        .value,
                  })
                }
              />
            </label>

            <label>
              {t.price}

              <input
                type="number"
                min="0"
                step="0.01"
                value={
                  create.price
                }
                onChange={(
                  event,
                ) =>
                  setCreate({
                    ...create,
                    price:
                      event.target
                        .value,
                  })
                }
              />
            </label>

            <label>
              {t.price}

              <select
                value={
                  create.currency
                }
                onChange={(
                  event,
                ) =>
                  setCreate({
                    ...create,
                    currency:
                      event.target
                        .value,
                  })
                }
              >
                {[
                  'USD',
                  'EUR',
                  'GBP',
                  'AED',
                  'IRR',
                ].map(
                  (
                    value,
                  ) => (
                    <option
                      key={
                        value
                      }
                    >
                      {value}
                    </option>
                  ),
                )}
              </select>
            </label>

            {(
              [
                [
                  'public',
                  t.public,
                ],

                [
                  'chat',
                  t.chat,
                ],

                [
                  'qna',
                  t.qna,
                ],

                [
                  'raiseHand',
                  t.raiseHand,
                ],
              ] as const
            ).map(
              ([
                key,
                label,
              ]) => (
                <label
                  key={
                    key
                  }
                  className="webinar23-check"
                >
                  <input
                    type="checkbox"
                    checked={
                      Boolean(
                        create[
                          key as
                            | 'public'
                            | 'chat'
                            | 'qna'
                            | 'raiseHand'
                        ],
                      )
                    }
                    onChange={(
                      event,
                    ) =>
                      setCreate({
                        ...create,

                        [key]:
                          event
                            .target
                            .checked,
                      })
                    }
                  />

                  {label}
                </label>
              ),
            )}

            <button
              className="button"
              disabled={
                busy
              }
            >
              {t.create}
            </button>
          </form>
        </details>
      )}

      <details className="webinar23-dashboard-card">
        <summary>
          {t.requestWebinar}
        </summary>

        <p>
          {t.requestHint}
        </p>

        <form
          className="webinar23-form"
          onSubmit={(
            event,
          ) => {
            event.preventDefault();

            void act(
              async () => {
                await userApi(
                  'events/requests',
                  'POST',
                  {
                    request_key:
                      crypto.randomUUID(),

                    title:
                      sponsor.title,

                    description:
                      sponsor.description,

                    language:
                      sponsor.language,

                    proposed_start:
                      iso(
                        sponsor.start,
                      ),

                    duration_minutes:
                      Number(
                        sponsor.duration,
                      ),

                    expected_attendees:
                      Number(
                        sponsor.audience,
                      ),

                    budget_minor:
                      Number(
                        sponsor.budget,
                      ) >
                        0
                        ? minor(
                            sponsor.budget,
                            sponsor.currency,
                          )
                        : undefined,

                    currency:
                      sponsor.currency,

                    ...(
                      sponsor.expert.trim()
                        ? {
                            proposed_expert:
                              sponsor.expert.trim(),
                          }
                        : {}
                    ),
                  },
                );

                setNotice(
                  t.requestCreated,
                );
              },
            );
          }}
        >
          <label>
            {t.webinarTitle}

            <input
              required
              value={
                sponsor.title
              }
              onChange={(
                event,
              ) =>
                setSponsor({
                  ...sponsor,
                  title:
                    event.target
                      .value,
                })
              }
            />
          </label>

          <label>
            {t.description}

            <textarea
              value={
                sponsor.description
              }
              onChange={(
                event,
              ) =>
                setSponsor({
                  ...sponsor,
                  description:
                    event.target
                      .value,
                })
              }
            />
          </label>

          <label>
            {t.language}

            <input
              value={
                sponsor.language
              }
              onChange={(
                event,
              ) =>
                setSponsor({
                  ...sponsor,
                  language:
                    event.target
                      .value,
                })
              }
            />
          </label>

          <label>
            {t.proposedExpert}

            <input
              value={
                sponsor.expert
              }
              maxLength={
                13
              }
              onChange={(
                event,
              ) =>
                setSponsor({
                  ...sponsor,
                  expert:
                    event.target
                      .value,
                })
              }
            />
          </label>

          <label>
            {t.proposedDate}

            <input
              type="datetime-local"
              required
              value={
                sponsor.start
              }
              onChange={(
                event,
              ) =>
                setSponsor({
                  ...sponsor,
                  start:
                    event.target
                      .value,
                })
              }
            />
          </label>

          <label>
            {t.duration}

            <input
              type="number"
              min="15"
              max="480"
              value={
                sponsor.duration
              }
              onChange={(
                event,
              ) =>
                setSponsor({
                  ...sponsor,
                  duration:
                    event.target
                      .value,
                })
              }
            />
          </label>

          <label>
            {t.expectedAudience}

            <input
              type="number"
              min="2"
              max="1000"
              value={
                sponsor.audience
              }
              onChange={(
                event,
              ) =>
                setSponsor({
                  ...sponsor,
                  audience:
                    event.target
                      .value,
                })
              }
            />
          </label>

          <label>
            {t.budget}

            <input
              type="number"
              min="0"
              step="0.01"
              value={
                sponsor.budget
              }
              onChange={(
                event,
              ) =>
                setSponsor({
                  ...sponsor,
                  budget:
                    event.target
                      .value,
                })
              }
            />
          </label>

          <button
            className="button"
            disabled={
              busy
            }
          >
            {t.sendRequest}
          </button>
        </form>
      </details>

      <section className="webinar23-dashboard-card">
        <h3>
          {t.myEvents}
        </h3>

        <div className="webinar23-event-list">
          {managed.map(
            (
              item,
            ) => (
              <article
                key={
                  item.id
                }
              >
                <div>
                  <strong>
                    {item.title}
                  </strong>

                  <small>
                    {item.status}
                    {' · '}
                    {new Date(
                      item.starts_at,
                    ).toLocaleString(
                      locale,
                    )}
                  </small>
                </div>

                <div className="webinar23-event-actions">
                  {item.role ===
                    'PRESENTER' &&
                    item.status ===
                      'DRAFT' && (
                    <button
                      type="button"
                      disabled={
                        busy
                      }
                      onClick={() =>
                        void act(
                          async () => {
                            await userApi(
                              `events/${item.id}/publish`,
                              'POST',
                              {},
                            );
                          },
                        )
                      }
                    >
                      {t.publish}
                    </button>
                  )}

                  {item.role ===
                    'PRESENTER' &&
                    item.status ===
                      'PUBLISHED' && (
                    <button
                      type="button"
                      disabled={
                        busy
                      }
                      onClick={() =>
                        void act(
                          async () => {
                            await userApi(
                              `events/${item.id}/start`,
                              'POST',
                              {},
                            );
                          },
                        )
                      }
                    >
                      {t.startLive}
                    </button>
                  )}

                  {item.role ===
                    'PRESENTER' &&
                    item.status ===
                      'LIVE' && (
                    <button
                      type="button"
                      disabled={
                        busy
                      }
                      onClick={() =>
                        void act(
                          async () => {
                            await userApi(
                              `events/${item.id}/end`,
                              'POST',
                              {},
                            );
                          },
                        )
                      }
                    >
                      {t.endLive}
                    </button>
                  )}

                  {item.status ===
                    'LIVE' && (
                    <a
                      href={`${usersBase}/${locale}/events?id=${item.id}&live=1`}
                    >
                      {t.manageLive}
                    </a>
                  )}
                </div>

                {item.role ===
                  'PRESENTER' && (
                  <form
                    className="webinar23-inline-form"
                    onSubmit={(
                      event,
                    ) => {
                      event.preventDefault();

                      const values =
                        inviteText[
                          item.id
                        ] ??
                        '';

                      const invitees =
                        values
                          .split(
                            ',',
                          )
                          .map(
                            (
                              value,
                            ) =>
                              value.trim(),
                          )
                          .filter(
                            Boolean,
                          );

                      if (
                        !invitees.length
                      )
                        return;

                      void act(
                        async () => {
                          await userApi(
                            `events/${item.id}/invitations`,
                            'POST',
                            {
                              invitees,

                              role:
                                'ATTENDEE',
                            },
                          );

                          setInviteText({
                            ...inviteText,

                            [item.id]:
                              '',
                          });

                          setNotice(
                            t.invitationSent,
                          );
                        },
                      );
                    }}
                  >
                    <input
                      value={
                        inviteText[
                          item.id
                        ] ??
                        ''
                      }
                      placeholder={
                        t.inviteHint
                      }
                      onChange={(
                        event,
                      ) =>
                        setInviteText({
                          ...inviteText,

                          [item.id]:
                            event.target
                              .value,
                        })
                      }
                    />

                    <button
                      disabled={
                        busy
                      }
                    >
                      {t.invite}
                    </button>
                  </form>
                )}
              </article>
            ),
          )}
        </div>
      </section>

      <section className="webinar23-dashboard-card">
        <h3>
          {t.invitations}
        </h3>

        <div className="webinar23-invitation-list">
          {invitations.map(
            (
              invitation,
            ) => (
              <article
                key={
                  invitation.id
                }
              >
                <div>
                  <strong>
                    {invitation.title}
                  </strong>

                  <small>
                    {invitation.status}
                    {' · '}
                    {new Date(
                      invitation.starts_at,
                    ).toLocaleString(
                      locale,
                    )}
                  </small>
                </div>

                {invitation.status ===
                  'INVITED' && (
                  <div>
                    <button
                      type="button"
                      onClick={() =>
                        void act(
                          async () => {
                            await userApi(
                              `events/invitations/${invitation.id}/respond`,
                              'POST',
                              {
                                accepted:
                                  true,
                              },
                            );

                            setNotice(
                              t.invitationUpdated,
                            );
                          },
                        )
                      }
                    >
                      {t.accept}
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        void act(
                          async () => {
                            await userApi(
                              `events/invitations/${invitation.id}/respond`,
                              'POST',
                              {
                                accepted:
                                  false,
                              },
                            );

                            setNotice(
                              t.invitationUpdated,
                            );
                          },
                        )
                      }
                    >
                      {t.decline}
                    </button>
                  </div>
                )}
              </article>
            ),
          )}
        </div>
      </section>

      <section className="webinar23-dashboard-card">
        <h3>
          {t.requests}
        </h3>

        <div className="webinar23-request-list">
          {requests.map(
            (
              item,
            ) => (
              <article
                key={
                  item.id
                }
              >
                <strong>
                  {item.title}
                </strong>

                <small>
                  {item.status}
                  {' · '}
                  {new Date(
                    item.proposed_start,
                  ).toLocaleString(
                    locale,
                  )}
                </small>
              </article>
            ),
          )}
        </div>
      </section>

      {expert && (
        <section className="webinar23-dashboard-card">
          <h3>
            {t.openRequests}
          </h3>

          <div className="webinar23-request-list">
            {openRequests.map(
              (
                item,
              ) => (
                <article
                  key={
                    item.id
                  }
                >
                  <div>
                    <strong>
                      {item.title}
                    </strong>

                    <small>
                      <bdi>
                        {item.sponsor_code}
                      </bdi>
                      {' · '}
                      {new Date(
                        item.proposed_start,
                      ).toLocaleString(
                        locale,
                      )}
                    </small>
                  </div>

                  <div className="webinar23-event-actions">
                    <button
                      type="button"
                      onClick={() =>
                        void act(
                          async () => {
                            await userApi(
                              `events/requests/${item.id}/respond`,
                              'POST',
                              {
                                action:
                                  'ACCEPT',
                              },
                            );

                            setNotice(
                              t.requestUpdated,
                            );
                          },
                        )
                      }
                    >
                      {t.acceptRequest}
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        void act(
                          async () => {
                            await userApi(
                              `events/requests/${item.id}/respond`,
                              'POST',
                              {
                                action:
                                  'REJECT',
                              },
                            );

                            setNotice(
                              t.requestUpdated,
                            );
                          },
                        )
                      }
                    >
                      {t.rejectRequest}
                    </button>
                  </div>

                  <form
                    className="webinar23-inline-form"
                    onSubmit={(
                      event,
                    ) => {
                      event.preventDefault();

                      const value =
                        counterTime[
                          item.id
                        ];

                      if (
                        !value
                      )
                        return;

                      void act(
                        async () => {
                          await userApi(
                            `events/requests/${item.id}/respond`,
                            'POST',
                            {
                              action:
                                'COUNTER',

                              counter_start:
                                iso(
                                  value,
                                ),
                            },
                          );

                          setNotice(
                            t.requestUpdated,
                          );
                        },
                      );
                    }}
                  >
                    <input
                      type="datetime-local"
                      value={
                        counterTime[
                          item.id
                        ] ??
                        ''
                      }
                      onChange={(
                        event,
                      ) =>
                        setCounterTime({
                          ...counterTime,

                          [item.id]:
                            event.target
                              .value,
                        })
                      }
                    />

                    <button>
                      {t.counter}
                    </button>
                  </form>
                </article>
              ),
            )}
          </div>
        </section>
      )}
    </section>
  );
}
