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
  talkNow23Copy,
} from './talknow23-copy';

import {
  TalkNowLive,
} from './talknow23-live';

type PublicStatus = {
  available_experts: number;
  queue_open: boolean;
};

type RequestRow = {
  id: string;
  client_id: string;
  client_code: string;
  language: string;
  mode:
    | 'AUDIO'
    | 'VIDEO';
  notes: string;
  status: string;
  expert_id: string | null;
  expert_code: string | null;
  price_minor: string;
  currency: string;
  session_minutes: number;
  payment_id: string | null;
  queue_position: number | null;
  created_at: string;
};

type Offer = {
  id: string;
  request_id: string;
  client_code: string;
  language: string;
  mode:
    | 'AUDIO'
    | 'VIDEO';
  notes: string;
  expires_at: string;
};

type ExpertSettings = {
  enabled: boolean;
  timezone: string;
  weekly_windows: {
    day: number;
    start: string;
    end: string;
  }[];
  languages: string[];
  modes:
    (
      | 'AUDIO'
      | 'VIDEO'
    )[];
  price_minor: string;
  currency: string;
  offer_seconds: number;
  session_minutes: number;
};

type PaymentMethods = {
  methods: {
    provider: string;
    enabled: boolean;
  }[];

  networks:
    Record<
      string,
      {
        coin?: string;
        network?: string;
      }
    >;
};

type Payment = {
  id: string;
  status: string;
  fulfillment: string;

  checkout?: {
    url?: string;
    address?: string;
    amount?: string;
    network?: string;
  };
};

type SupportCase = {
  id: string;

  kind:
    | 'TICKET'
    | 'COMPLAINT';

  subject: string;
  message: string;
  status: string;
  operator_note: string;
  created_at: string;
};

const dayKeys = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

export function TalkNowPublic({
  locale,
}: {
  locale: string;
}) {
  const t =
    talkNow23Copy[
      locale
    ]!;

  const [
    status,
    setStatus,
  ] =
    useState<
      PublicStatus | null
    >(null);

  useEffect(
    () => {
      const params =
        new URLSearchParams(
          window.location.search,
        );

      const payment =
        params.get(
          'payment',
        );

      if (payment) {
        window.location.replace(
          `${usersBase}/${locale}/account/instant?payment=${encodeURIComponent(
            payment,
          )}`,
        );

        return;
      }

      void userApi<
        PublicStatus
      >(
        'instant/public/status',
      )
        .then(
          setStatus,
        )
        .catch(
          () => {},
        );
    },
    [
      locale,
    ],
  );

  return (
    <section className="talk23-public">
      <div className="talk23-wrap">
        <span className="talk23-eyebrow">
          <Icon name="phone" />
          {t.eyebrow}
        </span>

        <h1>
          {t.title}
        </h1>

        <p>
          {t.intro}
        </p>

        <div className="talk23-availability">
          <strong>
            {status
              ?.available_experts ??
              0}
          </strong>

          <span>
            {status
              ?.queue_open
              ? t.available
              : t.unavailable}
          </span>
        </div>

        <a
          className="button"
          href={`${usersBase}/${locale}/account/instant`}
        >
          {t.startNow}
        </a>

        <small>
          {t.noBooking}
        </small>
      </div>
    </section>
  );
}

function SupportPanel({
  locale,
  requestId,
}: {
  locale: string;
  requestId:
    | string
    | null;
}) {
  const t =
    talkNow23Copy[
      locale
    ]!;

  const [
    kind,
    setKind,
  ] =
    useState<
      'TICKET'
      | 'COMPLAINT'
    >(
      'TICKET',
    );

  const [
    subject,
    setSubject,
  ] =
    useState('');

  const [
    message,
    setMessage,
  ] =
    useState('');

  const [
    rows,
    setRows,
  ] =
    useState<
      SupportCase[]
    >([]);

  const [
    notice,
    setNotice,
  ] =
    useState('');

  const [
    error,
    setError,
  ] =
    useState('');

  const load =
    async () =>
      setRows(
        await userApi<
          SupportCase[]
        >(
          'support/cases/mine',
        ),
      );

  useEffect(
    () => {
      void load()
        .catch(
          () => {},
        );
    },
    [],
  );

  return (
    <section className="talk23-support">
      <h3>
        {t.support}
      </h3>

      {notice && (
        <p className="talk23-success">
          {notice}
        </p>
      )}

      {error && (
        <p className="talk23-error">
          {error}
        </p>
      )}

      <form
        onSubmit={event => {
          event.preventDefault();

          setNotice(
            '',
          );

          setError(
            '',
          );

          void userApi(
            'support/cases',
            'POST',
            {
              kind,
              subject,
              message,

              instant_request_id:
                requestId,
            },
          )
            .then(
              async () => {
                setSubject(
                  '',
                );

                setMessage(
                  '',
                );

                setNotice(
                  t.caseCreated,
                );

                await load();
              },
            )
            .catch(
              () =>
                setError(
                  t.error,
                ),
            );
        }}
      >
        <select
          value={
            kind
          }
          onChange={event =>
            setKind(
              event.target
                .value as
                | 'TICKET'
                | 'COMPLAINT',
            )
          }
        >
          <option value="TICKET">
            {t.ticket}
          </option>

          <option value="COMPLAINT">
            {t.complaint}
          </option>
        </select>

        <input
          required
          minLength={
            3
          }
          maxLength={
            180
          }
          value={
            subject
          }
          placeholder={
            t.subject
          }
          onChange={event =>
            setSubject(
              event.target.value,
            )
          }
        />

        <textarea
          required
          minLength={
            5
          }
          maxLength={
            8000
          }
          value={
            message
          }
          placeholder={
            t.message
          }
          onChange={event =>
            setMessage(
              event.target.value,
            )
          }
        />

        <button className="button">
          {t.sendCase}
        </button>
      </form>

      <div className="talk23-case-list">
        <h4>
          {t.myCases}
        </h4>

        {rows.map(
          row => (
            <article
              key={
                row.id
              }
            >
              <strong>
                {row.kind ===
                'COMPLAINT'
                  ? t.complaint
                  : t.ticket}
                {' · '}
                {row.subject}
              </strong>

              <small>
                {row.status}
                {' · '}
                {new Date(
                  row.created_at,
                ).toLocaleString(
                  locale,
                )}
              </small>

              {row.operator_note && (
                <p>
                  {row.operator_note}
                </p>
              )}
            </article>
          ),
        )}
      </div>
    </section>
  );
}

function ClientTalkNow({
  locale,
}: {
  locale: string;
}) {
  const t =
    talkNow23Copy[
      locale
    ]!;

  const [
    language,
    setLanguage,
  ] =
    useState(
      locale ===
      'fa'
        ? 'fa'
        : 'en',
    );

  const [
    mode,
    setMode,
  ] =
    useState<
      'AUDIO'
      | 'VIDEO'
    >(
      'AUDIO',
    );

  const [
    notes,
    setNotes,
  ] =
    useState('');

  const [
    rows,
    setRows,
  ] =
    useState<
      RequestRow[]
    >([]);

  const [
    methods,
    setMethods,
  ] =
    useState<
      PaymentMethods | null
    >(null);

  const [
    provider,
    setProvider,
  ] =
    useState(
      'wallet',
    );

  const [
    network,
    setNetwork,
  ] =
    useState('');

  const [
    payment,
    setPayment,
  ] =
    useState<
      Payment | null
    >(null);

  const [
    liveRequest,
    setLiveRequest,
  ] =
    useState<
      string | null
    >(null);

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

  const current =
    useMemo(
      () =>
        rows.find(
          row =>
            [
              'QUEUED',
              'OFFERING',
              'AWAITING_PAYMENT',
              'READY',
              'LIVE',
            ].includes(
              row.status,
            ),
        ) ??
        null,
      [
        rows,
      ],
    );

  async function load() {
    const result =
      await userApi<
        RequestRow[]
      >(
        'instant/requests/mine',
      );

    setRows(
      result,
    );

    const pending =
      result.find(
        row =>
          row.status ===
          'AWAITING_PAYMENT',
      );

    if (
      pending &&
      !methods
    ) {
      const value =
        await userApi<
          PaymentMethods
        >(
          'payments/methods',
        );

      setMethods(
        value,
      );

      const first =
        value.methods.find(
          item =>
            item.enabled &&
            item.provider ===
              'wallet',
        ) ??
        value.methods.find(
          item =>
            item.enabled,
        );

      if (first)
        setProvider(
          first.provider,
        );

      const firstNetwork =
        Object.keys(
          value.networks ??
            {},
        )[0];

      if (firstNetwork)
        setNetwork(
          firstNetwork,
        );
    }
  }

  async function reconcile(
    id: string,
  ) {
    const value =
      await userApi<
        Payment
      >(
        `payments/${id}/reconcile`,
        'POST',
        {},
      );

    setPayment(
      value,
    );

    await load();
  }

  useEffect(
    () => {
      const params =
        new URLSearchParams(
          window.location.search,
        );

      const paymentId =
        params.get(
          'payment',
        );

      if (paymentId)
        void reconcile(
          paymentId,
        ).catch(
          () => {},
        );
      else
        void load()
          .catch(
            () =>
              setError(
                t.error,
              ),
          );

      const timer =
        window.setInterval(
          () => {
            void load()
              .catch(
                () => {},
              );
          },
          2500,
        );

      return () =>
        window.clearInterval(
          timer,
        );
    },
    [
      locale,
    ],
  );

  if (
    liveRequest
  )
    return (
      <TalkNowLive
        locale={
          locale
        }
        requestId={
          liveRequest
        }
        onBack={() => {
          setLiveRequest(
            null,
          );

          void load();
        }}
      />
    );

  async function createPayment() {
    if (!current)
      return;

    setBusy(
      true,
    );

    try {
      const result =
        await userApi<
          Payment
        >(
          'payments/create',
          'POST',
          {
            request_key:
              crypto.randomUUID(),

            provider,

            instant_request_id:
              current.id,

            locale,

            ...(
              provider ===
                'nowpayments'
                ? {
                    network,
                  }
                : {}
            ),
          },
        );

      setPayment(
        result,
      );

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

  return (
    <section className="talk23-client user-card">
      <div className="user-heading">
        <div>
          <h2>
            {t.queue}
          </h2>

          <p>
            {t.noBooking}
          </p>
        </div>

        <a
          href={`${usersBase}/${locale}/instant`}
        >
          {t.eyebrow}
        </a>
      </div>

      {error && (
        <p
          className="talk23-error"
          role="alert"
        >
          {error}
        </p>
      )}

      {!current && (
        <form
          className="talk23-request-form"
          onSubmit={event => {
            event.preventDefault();

            setBusy(
              true,
            );

            void userApi(
              'instant/requests',
              'POST',
              {
                request_key:
                  crypto.randomUUID(),

                topic_id:
                  null,

                language,
                mode,
                notes,
              },
            )
              .then(
                async () => {
                  setNotes(
                    '',
                  );

                  await load();
                },
              )
              .catch(
                () =>
                  setError(
                    t.error,
                  ),
              )
              .finally(
                () =>
                  setBusy(
                    false,
                  ),
              );
          }}
        >
          <h3>
            {t.request}
          </h3>

          <label>
            {t.language}

            <input
              required
              value={
                language
              }
              onChange={event =>
                setLanguage(
                  event.target.value,
                )
              }
            />
          </label>

          <label>
            {t.callMode}

            <select
              value={
                mode
              }
              onChange={event =>
                setMode(
                  event.target
                    .value as
                    | 'AUDIO'
                    | 'VIDEO',
                )
              }
            >
              <option value="AUDIO">
                {t.audio}
              </option>

              <option value="VIDEO">
                {t.video}
              </option>
            </select>
          </label>

          <label className="wide">
            {t.description}

            <textarea
              required
              maxLength={
                2000
              }
              value={
                notes
              }
              placeholder={
                t.descriptionPlaceholder
              }
              onChange={event =>
                setNotes(
                  event.target.value,
                )
              }
            />
          </label>

          <button
            className="button"
            disabled={
              busy ||
              !notes.trim()
            }
          >
            {t.joinQueue}
          </button>
        </form>
      )}

      {current && (
        <section className="talk23-current">
          <div className="talk23-current-head">
            <div>
              <span>
                {t.status}
              </span>

              <strong>
                {current.status}
              </strong>
            </div>

            <div>
              <span>
                {t.queuePosition}
              </span>

              <strong>
                {current.queue_position ??
                  '—'}
              </strong>
            </div>

            <div>
              <span>
                {t.expert}
              </span>

              <strong>
                <bdi>
                  {current.expert_code ??
                    '—'}
                </bdi>
              </strong>
            </div>
          </div>

          {current.status ===
            'QUEUED' && (
            <p>
              {t.waiting}
            </p>
          )}

          {current.status ===
            'OFFERING' && (
            <p>
              {t.offering}
            </p>
          )}

          {current.status ===
            'AWAITING_PAYMENT' && (
            <div className="talk23-payment">
              <h3>
                {t.payment}
              </h3>

              <p>
                {t.awaitingPayment}
              </p>

              <strong>
                {current.price_minor}
                {' '}
                {current.currency}
              </strong>

              <div className="talk23-payment-methods">
                {methods
                  ?.methods
                  .filter(
                    item =>
                      item.enabled,
                  )
                  .map(
                    item => (
                      <button
                        key={
                          item.provider
                        }
                        type="button"
                        className={
                          provider ===
                          item.provider
                            ? 'selected'
                            : ''
                        }
                        onClick={() =>
                          setProvider(
                            item.provider,
                          )
                        }
                      >
                        {item.provider ===
                        'wallet'
                          ? t.wallet
                          : item.provider ===
                              'stripe'
                            ? t.card
                            : item.provider ===
                                'paypal'
                              ? t.paypal
                              : t.crypto}
                      </button>
                    ),
                  )}
              </div>

              {provider ===
                'nowpayments' &&
                methods && (
                <select
                  value={
                    network
                  }
                  onChange={event =>
                    setNetwork(
                      event.target.value,
                    )
                  }
                >
                  {Object.keys(
                    methods.networks,
                  ).map(
                    item => (
                      <option
                        key={
                          item
                        }
                        value={
                          item
                        }
                      >
                        {item}
                      </option>
                    ),
                  )}
                </select>
              )}

              {!payment && (
                <button
                  type="button"
                  className="button"
                  disabled={
                    busy
                  }
                  onClick={() =>
                    void createPayment()
                  }
                >
                  {t.pay}
                </button>
              )}

              {payment && (
                <div className="talk23-payment-result">
                  <strong>
                    {payment.status ===
                    'SUCCESS'
                      ? t.paymentSuccess
                      : t.paymentPending}
                  </strong>

                  {payment.checkout
                    ?.url && (
                    <a
                      className="button"
                      href={
                        payment.checkout.url
                      }
                      rel="noreferrer"
                    >
                      {t.checkout}
                    </a>
                  )}

                  {payment.checkout
                    ?.address && (
                    <bdi>
                      {payment.checkout.address}
                      {' · '}
                      {payment.checkout.amount}
                      {' · '}
                      {payment.checkout.network}
                    </bdi>
                  )}

                  {payment.status !==
                    'SUCCESS' && (
                    <button
                      type="button"
                      onClick={() =>
                        void reconcile(
                          payment.id,
                        )
                      }
                    >
                      {t.checkPayment}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {[
            'READY',
            'LIVE',
          ].includes(
            current.status,
          ) && (
            <button
              type="button"
              className="button talk23-join"
              onClick={() =>
                setLiveRequest(
                  current.id,
                )
              }
            >
              <Icon name="phone" />
              {t.joinCall}
            </button>
          )}

          {![
            'LIVE',
            'COMPLETED',
            'CANCELLED',
          ].includes(
            current.status,
          ) && (
            <button
              type="button"
              className="talk23-cancel"
              onClick={() =>
                void userApi(
                  `instant/requests/${current.id}/cancel`,
                  'POST',
                  {},
                )
                  .then(
                    load,
                  )
              }
            >
              {t.cancel}
            </button>
          )}
        </section>
      )}

      <SupportPanel
        locale={
          locale
        }
        requestId={
          current?.id ??
          null
        }
      />
    </section>
  );
}

function ExpertTalkNow({
  locale,
}: {
  locale: string;
}) {
  const t =
    talkNow23Copy[
      locale
    ]!;

  const blankWindows =
    Array.from(
      {
        length: 7,
      },
      (
        _,
        day,
      ) => ({
        day,
        active:
          false,
        start:
          '09:00',
        end:
          '17:00',
      }),
    );

  const [
    enabled,
    setEnabled,
  ] =
    useState(false);

  const [
    timezone,
    setTimezone,
  ] =
    useState(
      Intl.DateTimeFormat()
        .resolvedOptions()
        .timeZone,
    );

  const [
    languages,
    setLanguages,
  ] =
    useState(
      'fa,en',
    );

  const [
    audio,
    setAudio,
  ] =
    useState(true);

  const [
    video,
    setVideo,
  ] =
    useState(true);

  const [
    price,
    setPrice,
  ] =
    useState(
      '0',
    );

  const [
    currency,
    setCurrency,
  ] =
    useState(
      'USD',
    );

  const [
    timeout,
    setTimeoutValue,
  ] =
    useState(
      '45',
    );

  const [
    duration,
    setDuration,
  ] =
    useState(
      '30',
    );

  const [
    windows,
    setWindows,
  ] =
    useState(
      blankWindows,
    );

  const [
    offer,
    setOffer,
  ] =
    useState<
      Offer | null
    >(null);

  const [
    current,
    setCurrent,
  ] =
    useState<
      RequestRow | null
    >(null);

  const [
    liveRequest,
    setLiveRequest,
  ] =
    useState<
      string | null
    >(null);

  const [
    now,
    setNow,
  ] =
    useState(
      Date.now(),
    );

  const [
    notice,
    setNotice,
  ] =
    useState('');

  const [
    error,
    setError,
  ] =
    useState('');

  const dayLabels = [
    t.sunday,
    t.monday,
    t.tuesday,
    t.wednesday,
    t.thursday,
    t.friday,
    t.saturday,
  ];

  async function loadSettings() {
    const value =
      await userApi<
        ExpertSettings | null
      >(
        'instant/expert/settings',
      );

    if (!value)
      return;

    setEnabled(
      value.enabled,
    );

    setTimezone(
      value.timezone,
    );

    setLanguages(
      value.languages.join(
        ',',
      ),
    );

    setAudio(
      value.modes.includes(
        'AUDIO',
      ),
    );

    setVideo(
      value.modes.includes(
        'VIDEO',
      ),
    );

    setPrice(
      value.price_minor,
    );

    setCurrency(
      value.currency,
    );

    setTimeoutValue(
      String(
        value.offer_seconds,
      ),
    );

    setDuration(
      String(
        value.session_minutes,
      ),
    );

    setWindows(
      blankWindows.map(
        item => {
          const match =
            value.weekly_windows.find(
              row =>
                row.day ===
                item.day,
            );

          return match
            ? {
                ...item,
                active:
                  true,
                start:
                  match.start,
                end:
                  match.end,
              }
            : item;
        },
      ),
    );
  }

  async function loadWork() {
    const [
      nextOffer,
      nextCurrent,
    ] =
      await Promise.all([
        userApi<
          Offer | null
        >(
          'instant/offers/current',
        ),

        userApi<
          RequestRow | null
        >(
          'instant/expert/current',
        ),
      ]);

    setOffer(
      nextOffer,
    );

    setCurrent(
      nextCurrent,
    );
  }

  useEffect(
    () => {
      void loadSettings()
        .catch(
          () => {},
        );

      void loadWork()
        .catch(
          () => {},
        );

      const timer =
        window.setInterval(
          () => {
            setNow(
              Date.now(),
            );

            void loadWork()
              .catch(
                () => {},
              );
          },
          1000,
        );

      return () =>
        window.clearInterval(
          timer,
        );
    },
    [
      locale,
    ],
  );

  const remaining =
    offer
      ? Math.max(
          0,
          Math.ceil(
            (
              Date.parse(
                offer.expires_at,
              ) -
              now
            ) /
              1000,
          ),
        )
      : 0;

  if (
    liveRequest
  )
    return (
      <TalkNowLive
        locale={
          locale
        }
        requestId={
          liveRequest
        }
        onBack={() => {
          setLiveRequest(
            null,
          );

          void loadWork();
        }}
      />
    );

  async function save() {
    const modes:
      (
        | 'AUDIO'
        | 'VIDEO'
      )[] =
        [];

    if (audio)
      modes.push(
        'AUDIO',
      );

    if (video)
      modes.push(
        'VIDEO',
      );

    if (!modes.length)
      throw new Error(
        'MODE_REQUIRED',
      );

    await userApi(
      'instant/expert/settings',
      'PUT',
      {
        enabled,
        timezone,

        weekly_windows:
          windows
            .filter(
              item =>
                item.active,
            )
            .map(
              item => ({
                day:
                  item.day,
                start:
                  item.start,
                end:
                  item.end,
              }),
            ),

        languages:
          languages
            .split(
              ',',
            )
            .map(
              value =>
                value.trim(),
            )
            .filter(
              Boolean,
            ),

        topics:
          [],

        modes,

        price_minor:
          price,

        currency,

        offer_seconds:
          Number(
            timeout,
          ),

        session_minutes:
          Number(
            duration,
          ),
      },
    );

    setNotice(
      t.saved,
    );
  }

  return (
    <section className="talk23-expert user-card">
      <div className="user-heading">
        <h2>
          {t.settings}
        </h2>

        <div className="talk23-presence">
          {[
            [
              'ONLINE',
              t.online,
            ],
            [
              'AWAY',
              t.away,
            ],
            [
              'OFFLINE',
              t.offline,
            ],
          ].map(
            ([
              state,
              label,
            ]) => (
              <button
                type="button"
                key={
                  state
                }
                onClick={() =>
                  void userApi(
                    'instant/expert/presence',
                    'POST',
                    {
                      state,
                    },
                  )
                }
              >
                {label}
              </button>
            ),
          )}
        </div>
      </div>

      {error && (
        <p className="talk23-error">
          {error}
        </p>
      )}

      {notice && (
        <p className="talk23-success">
          {notice}
        </p>
      )}

      {offer && (
        <section className="talk23-offer">
          <span>
            {t.incoming}
          </span>

          <h3>
            <bdi>
              {offer.client_code}
            </bdi>
          </h3>

          <p>
            {offer.notes}
          </p>

          <div>
            <span>
              {offer.language}
            </span>

            <span>
              {offer.mode}
            </span>

            <strong>
              {t.expiresIn}:{' '}
              {remaining}{' '}
              {t.seconds}
            </strong>
          </div>

          <div className="talk23-offer-actions">
            <button
              type="button"
              className="button"
              disabled={
                remaining <=
                0
              }
              onClick={() =>
                void userApi(
                  `instant/offers/${offer.id}/respond`,
                  'POST',
                  {
                    accepted:
                      true,
                  },
                )
                  .then(
                    loadWork,
                  )
              }
            >
              {t.accept}
            </button>

            <button
              type="button"
              onClick={() =>
                void userApi(
                  `instant/offers/${offer.id}/respond`,
                  'POST',
                  {
                    accepted:
                      false,
                  },
                )
                  .then(
                    loadWork,
                  )
              }
            >
              {t.reject}
            </button>
          </div>
        </section>
      )}

      {current && (
        <section className="talk23-current">
          <h3>
            {t.currentRequest}
          </h3>

          <div className="talk23-current-head">
            <div>
              <span>
                {t.client}
              </span>

              <strong>
                <bdi>
                  {current.client_code}
                </bdi>
              </strong>
            </div>

            <div>
              <span>
                {t.status}
              </span>

              <strong>
                {current.status}
              </strong>
            </div>

            <div>
              <span>
                {t.callMode}
              </span>

              <strong>
                {current.mode}
              </strong>
            </div>
          </div>

          {current.status ===
            'AWAITING_PAYMENT' && (
            <p>
              {t.waitingPayment}
            </p>
          )}

          {[
            'READY',
            'LIVE',
          ].includes(
            current.status,
          ) && (
            <button
              type="button"
              className="button"
              onClick={() =>
                setLiveRequest(
                  current.id,
                )
              }
            >
              {t.joinCall}
            </button>
          )}
        </section>
      )}

      <div className="talk23-settings-grid">
        <label className="talk23-check">
          <input
            type="checkbox"
            checked={
              enabled
            }
            onChange={event =>
              setEnabled(
                event.target.checked,
              )
            }
          />

          {t.enabled}
        </label>

        <label>
          {t.timezone}

          <input
            value={
              timezone
            }
            onChange={event =>
              setTimezone(
                event.target.value,
              )
            }
          />
        </label>

        <label>
          {t.languages}

          <input
            value={
              languages
            }
            onChange={event =>
              setLanguages(
                event.target.value,
              )
            }
          />
        </label>

        <fieldset>
          <legend>
            {t.modes}
          </legend>

          <label className="talk23-check">
            <input
              type="checkbox"
              checked={
                audio
              }
              onChange={event =>
                setAudio(
                  event.target.checked,
                )
              }
            />

            {t.audio}
          </label>

          <label className="talk23-check">
            <input
              type="checkbox"
              checked={
                video
              }
              onChange={event =>
                setVideo(
                  event.target.checked,
                )
              }
            />

            {t.video}
          </label>
        </fieldset>

        <label>
          {t.price}

          <input
            type="number"
            min="0"
            value={
              price
            }
            onChange={event =>
              setPrice(
                event.target.value,
              )
            }
          />
        </label>

        <label>
          {t.currency}

          <select
            value={
              currency
            }
            onChange={event =>
              setCurrency(
                event.target.value,
              )
            }
          >
            {[
              'USD',
              'EUR',
              'GBP',
              'AED',
              'IRR',
            ].map(
              value => (
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

        <label>
          {t.offerTimeout}

          <input
            type="number"
            min="15"
            max="120"
            value={
              timeout
            }
            onChange={event =>
              setTimeoutValue(
                event.target.value,
              )
            }
          />
        </label>

        <label>
          {t.duration}

          <input
            type="number"
            min="5"
            max="180"
            value={
              duration
            }
            onChange={event =>
              setDuration(
                event.target.value,
              )
            }
          />
        </label>
      </div>

      <section className="talk23-weekly">
        <h3>
          {t.weekly}
        </h3>

        {windows.map(
          (
            item,
            index,
          ) => (
            <div
              key={
                item.day
              }
            >
              <label className="talk23-check">
                <input
                  type="checkbox"
                  checked={
                    item.active
                  }
                  onChange={event => {
                    const next =
                      [
                        ...windows,
                      ];

                    next[index] = {
                      ...item,
                      active:
                        event.target.checked,
                    };

                    setWindows(
                      next,
                    );
                  }}
                />

                {dayLabels[
                  item.day
                ]}
              </label>

              <input
                type="time"
                disabled={
                  !item.active
                }
                value={
                  item.start
                }
                onChange={event => {
                  const next =
                    [
                      ...windows,
                    ];

                  next[index] = {
                    ...item,
                    start:
                      event.target.value,
                  };

                  setWindows(
                    next,
                  );
                }}
              />

              <input
                type="time"
                disabled={
                  !item.active
                }
                value={
                  item.end
                }
                onChange={event => {
                  const next =
                    [
                      ...windows,
                    ];

                  next[index] = {
                    ...item,
                    end:
                      event.target.value,
                  };

                  setWindows(
                    next,
                  );
                }}
              />
            </div>
          ),
        )}
      </section>

      <button
        type="button"
        className="button"
        onClick={() =>
          void save()
            .catch(
              () =>
                setError(
                  t.error,
                ),
            )
        }
      >
        {t.save}
      </button>
    </section>
  );
}

export function TalkNowWorkspace({
  locale,
  role,
}: {
  locale: string;
  role: string;
}) {
  return role ===
    'expert'
    ? (
        <ExpertTalkNow
          locale={
            locale
          }
        />
      )
    : (
        <ClientTalkNow
          locale={
            locale
          }
        />
      );
}

export function TalkNowOperator({
  locale,
}: {
  locale: string;
}) {
  const t =
    talkNow23Copy[
      locale
    ]!;

  const [
    rows,
    setRows,
  ] =
    useState<
      RequestRow[]
    >([]);

  const [
    error,
    setError,
  ] =
    useState('');

  async function load() {
    setRows(
      await userApi<
        RequestRow[]
      >(
        'instant/operator/queue',
      ),
    );
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

      const timer =
        window.setInterval(
          () => {
            void load()
              .catch(
                () => {},
              );
          },
          2500,
        );

      return () =>
        window.clearInterval(
          timer,
        );
    },
    [
      locale,
    ],
  );

  return (
    <section className="talk23-operator user-card">
      <div className="user-heading">
        <h2>
          {t.operatorQueue}
        </h2>

        <button
          type="button"
          onClick={() =>
            void load()
          }
        >
          {t.refresh}
        </button>
      </div>

      {error && (
        <p className="talk23-error">
          {error}
        </p>
      )}

      <div className="talk23-operator-list">
        {rows.map(
          row => (
            <article
              key={
                row.id
              }
            >
              <div>
                <strong>
                  <bdi>
                    {row.client_code}
                  </bdi>
                </strong>

                <small>
                  {row.language}
                  {' · '}
                  {row.mode}
                  {' · '}
                  {new Date(
                    row.created_at,
                  ).toLocaleString(
                    locale,
                  )}
                </small>
              </div>

              <span>
                {row.status}
              </span>

              <span>
                {row.queue_position ??
                  '—'}
              </span>

              <div>
                {![
                  'LIVE',
                  'COMPLETED',
                ].includes(
                  row.status,
                ) && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        void userApi(
                          `instant/operator/requests/${row.id}`,
                          'POST',
                          {
                            action:
                              'REQUEUE',
                          },
                        )
                          .then(
                            load,
                          )
                      }
                    >
                      {t.requeue}
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        void userApi(
                          `instant/operator/requests/${row.id}`,
                          'POST',
                          {
                            action:
                              'CANCEL',
                          },
                        )
                          .then(
                            load,
                          )
                      }
                    >
                      {t.operatorCancel}
                    </button>
                  </>
                )}
              </div>
            </article>
          ),
        )}
      </div>
    </section>
  );
}

export function SupportOperator({
  locale,
  kind,
}: {
  locale: string;

  kind:
    | 'TICKET'
    | 'COMPLAINT';
}) {
  const t =
    talkNow23Copy[
      locale
    ]!;

  const [
    rows,
    setRows,
  ] =
    useState<
      SupportCase[]
    >([]);

  const [
    notes,
    setNotes,
  ] =
    useState<
      Record<
        string,
        string
      >
    >({});

  async function load() {
    setRows(
      await userApi<
        SupportCase[]
      >(
        `support/operator/cases?kind=${kind}`,
      ),
    );
  }

  useEffect(
    () => {
      void load()
        .catch(
          () => {},
        );
    },
    [
      kind,
    ],
  );

  return (
    <section className="talk23-support-operator user-card">
      <div className="user-heading">
        <h2>
          {kind ===
          'COMPLAINT'
            ? t.complaint
            : t.ticket}
        </h2>

        <button
          type="button"
          onClick={() =>
            void load()
          }
        >
          {t.refresh}
        </button>
      </div>

      <div className="talk23-case-list">
        {rows.map(
          row => (
            <article
              key={
                row.id
              }
            >
              <strong>
                {row.subject}
              </strong>

              <p>
                {row.message}
              </p>

              <small>
                {row.status}
              </small>

              <textarea
                value={
                  notes[
                    row.id
                  ] ??
                  row.operator_note ??
                  ''
                }
                placeholder={
                  t.operatorNote
                }
                onChange={event =>
                  setNotes({
                    ...notes,

                    [row.id]:
                      event.target.value,
                  })
                }
              />

              <div className="talk23-case-actions">
                {[
                  [
                    'IN_PROGRESS',
                    t.inProgress,
                  ],
                  [
                    'RESOLVED',
                    t.resolved,
                  ],
                  [
                    'CLOSED',
                    t.closed,
                  ],
                ].map(
                  ([
                    status,
                    label,
                  ]) => (
                    <button
                      type="button"
                      key={
                        status
                      }
                      onClick={() =>
                        void userApi(
                          `support/operator/cases/${row.id}`,
                          'PATCH',
                          {
                            status,

                            operator_note:
                              notes[
                                row.id
                              ] ??
                              row.operator_note ??
                              '',
                          },
                        )
                          .then(
                            load,
                          )
                      }
                    >
                      {label}
                    </button>
                  ),
                )}
              </div>
            </article>
          ),
        )}
      </div>
    </section>
  );
}
