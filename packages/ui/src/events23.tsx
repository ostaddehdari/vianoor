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

import {
  WebinarLiveRoom,
} from './webinar23-live';

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
  registered: number;
  remaining: number;
};

type MineEvent =
  EventRow & {
    role: string | null;
    registration_status: string | null;
    raised_hand: boolean | null;
    microphone_allowed: boolean | null;
    camera_allowed: boolean | null;
  };

type Registration = {
  id: string;
  webinar_id: string;
  role: string;
  status: string;
  hold_expires_at: string | null;
};

type PaymentMethods = {
  methods: {
    provider: string;
    enabled: boolean;
  }[];

  networks: Record<
    string,
    {
      coin?: string;
      network?: string;
    }
  >;
};

type Payment = {
  id: string;
  event_registration_id: string | null;
  status: string;
  fulfillment: string;

  checkout: {
    url?: string;
    address?: string;
    amount?: string;
    network?: string;
  };
};

function formatMoney(
  locale: string,
  amount: string,
  currency: string,
) {
  if (
    BigInt(
      amount,
    ) ===
    0n
  )
    return null;

  const decimals =
    [
      'IRR',
      'IRT',
    ].includes(
      currency,
    )
      ? 0
      : 2;

  const divisor =
    10 **
    decimals;

  try {
    return new Intl.NumberFormat(
      locale,
      {
        style:
          'currency',

        currency,
      },
    ).format(
      Number(
        amount,
      ) /
        divisor,
    );
  } catch {
    return (
      `${amount} ${currency}`
    );
  }
}

function formatDate(
  locale: string,
  value: string,
) {
  try {
    return new Intl.DateTimeFormat(
      locale,
      {
        dateStyle:
          'full',

        timeStyle:
          'short',
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

export function EventsExperience({
  locale,
}: {
  locale: string;
}) {
  const t =
    events23Copy[
      locale
    ]!;

  const [
    list,
    setList,
  ] =
    useState<
      EventRow[]
    >([]);

  const [
    selected,
    setSelected,
  ] =
    useState<
      EventRow | null
    >(null);

  const [
    mine,
    setMine,
  ] =
    useState<
      MineEvent[]
    >([]);

  const [
    registration,
    setRegistration,
  ] =
    useState<
      Registration | null
    >(null);

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
    live,
    setLive,
  ] =
    useState(
      false,
    );

  const [
    busy,
    setBusy,
  ] =
    useState(
      false,
    );

  const [
    error,
    setError,
  ] =
    useState('');

  const selectedMine =
    useMemo(
      () =>
        selected
          ? mine.find(
              (
                item,
              ) =>
                item.id ===
                selected.id,
            ) ??
            null
          : null,
      [
        mine,
        selected
          ?.id,
      ],
    );

  async function loadMine() {
    try {
      const rows =
        await userApi<
          MineEvent[]
        >(
          'events/mine',
        );

      setMine(
        rows,
      );

      return rows;
    } catch {
      setMine(
        [],
      );

      return [];
    }
  }

  async function loadList() {
    const rows =
      await userApi<
        EventRow[]
      >(
        'events/public?limit=50',
      );

    setList(
      rows,
    );

    return rows;
  }

  async function open(
    id: string,
  ) {
    setBusy(
      true,
    );

    setError(
      '',
    );

    try {
      const row =
        await userApi<
          EventRow
        >(
          `events/public/${id}`,
        );

      setSelected(
        row,
      );

      await loadMine();

      window.history.replaceState(
        null,
        '',
        `${usersBase}/${locale}/events?id=${encodeURIComponent(
          id,
        )}`,
      );
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

  function close() {
    setSelected(
      null,
    );

    setRegistration(
      null,
    );

    setMethods(
      null,
    );

    setPayment(
      null,
    );

    setLive(
      false,
    );

    window.history.replaceState(
      null,
      '',
      `${usersBase}/${locale}/events`,
    );
  }

  async function loadPaymentMethods() {
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
        (
          item,
        ) =>
          item.enabled &&
          item.provider ===
            'wallet',
      ) ??
      value.methods.find(
        (
          item,
        ) =>
          item.enabled,
      );

    if (
      first
    )
      setProvider(
        first.provider,
      );

    const firstNetwork =
      Object.keys(
        value.networks ??
          {},
      )[0];

    if (
      firstNetwork
    )
      setNetwork(
        firstNetwork,
      );
  }

  async function register() {
    if (
      !selected
    )
      return;

    setBusy(
      true,
    );

    setError(
      '',
    );

    try {
      const result =
        await userApi<
          Registration
        >(
          `events/${selected.id}/register`,
          'POST',
          {},
        );

      setRegistration(
        result,
      );

      if (
        result.status ===
        'PENDING_PAYMENT'
      )
        await loadPaymentMethods();

      await Promise.all([
        loadMine(),

        open(
          selected.id,
        ),
      ]);
    } catch (
      exception
    ) {
      const code =
        exception instanceof
        Error
          ? exception.message
          : '';

      if (
        code ===
          'UNAUTHORIZED' ||
        code ===
          'INVALID_CREDENTIALS'
      ) {
        window.location.assign(
          `${usersBase}/${locale}/auth/login?return=${encodeURIComponent(
            `events?id=${selected.id}`,
          )}`,
        );

        return;
      }

      setError(
        code ===
          'EVENT_FULL'
          ? t.eventFull
          : t.error,
      );
    } finally {
      setBusy(
        false,
      );
    }
  }

  async function createPayment() {
    if (
      !registration
    )
      return;

    setBusy(
      true,
    );

    setError(
      '',
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

            event_registration_id:
              registration.id,

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

      if (
        result.status ===
        'SUCCESS'
      ) {
        await loadMine();

        setRegistration({
          ...registration,

          status:
            'REGISTERED',
        });
      }
    } catch (
      exception
    ) {
      const code =
        exception instanceof
        Error
          ? exception.message
          : '';

      setError(
        code ===
          'HOLD_EXPIRED'
          ? t.registrationExpired
          : t.error,
      );
    } finally {
      setBusy(
        false,
      );
    }
  }

  async function reconcile() {
    if (
      !payment
    )
      return;

    setBusy(
      true,
    );

    try {
      const result =
        await userApi<
          Payment
        >(
          `payments/${payment.id}/reconcile`,
          'POST',
          {},
        );

      setPayment(
        result,
      );

      if (
        result.status ===
        'SUCCESS'
      ) {
        await loadMine();

        if (
          registration
        )
          setRegistration({
            ...registration,

            status:
              'REGISTERED',
          });
      }
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
      const params =
        new URLSearchParams(
          window.location.search,
        );

      const id =
        params.get(
          'id',
        );

      if (
        params.get(
          'live',
        ) ===
          '1' &&
        id
      )
        setLive(
          true,
        );

      void Promise.all([
        loadList(),
        loadMine(),
      ]).then(
        ([
          rows,
        ]) => {
          if (
            id
          ) {
            const row =
              rows.find(
                (
                  item,
                ) =>
                  item.id ===
                  id,
              );

            if (
              row
            )
              setSelected(
                row,
              );
            else
              void open(
                id,
              );
          }
        },
      ).catch(
        () =>
          setError(
            t.error,
          ),
      );
    },
    [
      locale,
    ],
  );

  if (
    live &&
    selected
  )
    return (
      <WebinarLiveRoom
        locale={
          locale
        }
        eventId={
          selected.id
        }
        onBack={() => {
          setLive(
            false,
          );

          window.history.replaceState(
            null,
            '',
            `${usersBase}/${locale}/events?id=${selected.id}`,
          );
        }}
      />
    );

  if (
    selected
  ) {
    const price =
      formatMoney(
        locale,
        selected.price_minor,
        selected.currency,
      );

    const activeMethods =
      methods
        ?.methods
        .filter(
          (
            item,
          ) =>
            item.enabled,
        ) ??
      [];

    const registered =
      registration
        ?.status ===
        'REGISTERED' ||
      selectedMine
        ?.registration_status ===
        'REGISTERED';

    return (
      <main
        className="events23"
        id="main"
        tabIndex={-1}
      >
        <section className="events23-wrap events23-detail">
          <button
            type="button"
            className="events23-back"
            onClick={
              close
            }
          >
            {t.back}
          </button>

          {error && (
            <p
              role="alert"
              className="events23-error"
            >
              {error}
            </p>
          )}

          <article className="events23-detail-card">
            <div className="events23-live-badge">
              {selected.status ===
                'LIVE'
                ? t.live
                : selected.status}
            </div>

            <h1>
              {selected.title}
            </h1>

            <p className="events23-description">
              {selected.description}
            </p>

            <dl>
              <div>
                <dt>
                  {t.presenter}
                </dt>

                <dd>
                  <bdi>
                    {selected.presenter_code}
                  </bdi>
                </dd>
              </div>

              <div>
                <dt>
                  {t.date}
                </dt>

                <dd>
                  {formatDate(
                    locale,
                    selected.starts_at,
                  )}
                </dd>
              </div>

              <div>
                <dt>
                  {t.language}
                </dt>

                <dd>
                  <bdi>
                    {selected.language}
                  </bdi>
                </dd>
              </div>

              <div>
                <dt>
                  {t.remaining}
                </dt>

                <dd>
                  {selected.remaining.toLocaleString(
                    locale,
                  )}
                </dd>
              </div>

              <div>
                <dt>
                  {t.price}
                </dt>

                <dd>
                  {price ??
                    t.free}
                </dd>
              </div>
            </dl>

            {!registered &&
              !registration && (
                <button
                  type="button"
                  className="button"
                  disabled={
                    busy ||
                    selected.remaining <=
                      0
                  }
                  onClick={() =>
                    void register()
                  }
                >
                  {busy
                    ? t.registering
                    : t.register}
                </button>
              )}

            {registration
              ?.status ===
              'PENDING_PAYMENT' && (
              <section className="events23-payment">
                <h2>
                  {t.choosePayment}
                </h2>

                <p>
                  {t.pendingPayment}
                </p>

                <div className="events23-payment-methods">
                  {activeMethods.map(
                    (
                      method,
                    ) => (
                      <button
                        key={
                          method.provider
                        }
                        type="button"
                        className={
                          provider ===
                          method.provider
                            ? 'selected'
                            : ''
                        }
                        onClick={() =>
                          setProvider(
                            method.provider,
                          )
                        }
                      >
                        {method.provider ===
                        'wallet'
                          ? t.wallet
                          : method.provider ===
                              'stripe'
                            ? t.stripe
                            : method.provider ===
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
                  <label>
                    {t.network}

                    <select
                      value={
                        network
                      }
                      onChange={(
                        event,
                      ) =>
                        setNetwork(
                          event
                            .target
                            .value,
                        )
                      }
                    >
                      {Object.entries(
                        methods.networks,
                      ).map(
                        ([
                          key,
                          value,
                        ]) => (
                          <option
                            key={
                              key
                            }
                            value={
                              key
                            }
                          >
                            {value.coin ??
                              key}
                            {' · '}
                            {value.network ??
                              key}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                )}

                {!payment && (
                  <button
                    type="button"
                    className="button"
                    disabled={
                      busy ||
                      !activeMethods.length
                    }
                    onClick={() =>
                      void createPayment()
                    }
                  >
                    {t.pay}
                  </button>
                )}

                {payment && (
                  <div className="events23-payment-result">
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
                          payment
                            .checkout
                            .url
                        }
                        rel="noreferrer"
                      >
                        {t.secureCheckout}
                      </a>
                    )}

                    {payment.checkout
                      ?.address && (
                      <bdi>
                        {payment
                          .checkout
                          .address}
                        {' · '}
                        {payment
                          .checkout
                          .amount}
                        {' · '}
                        {payment
                          .checkout
                          .network}
                      </bdi>
                    )}

                    {payment.status !==
                      'SUCCESS' && (
                      <button
                        type="button"
                        onClick={() =>
                          void reconcile()
                        }
                      >
                        {t.checkPayment}
                      </button>
                    )}
                  </div>
                )}
              </section>
            )}

            {registered && (
              <div className="events23-registration-success">
                <Icon name="check" />
                {t.registrationComplete}
              </div>
            )}

            {registered &&
              selected.status ===
                'LIVE' && (
                <button
                  type="button"
                  className="button events23-live-enter"
                  onClick={() => {
                    setLive(
                      true,
                    );

                    window.history.replaceState(
                      null,
                      '',
                      `${usersBase}/${locale}/events?id=${selected.id}&live=1`,
                    );
                  }}
                >
                  <Icon name="video" />
                  {t.enterLive}
                </button>
              )}
          </article>
        </section>
      </main>
    );
  }

  return (
    <main
      className="events23"
      id="main"
      tabIndex={-1}
    >
      <section className="events23-hero">
        <div className="events23-wrap">
          <span className="events23-eyebrow">
            <Icon name="video" />
            {t.eyebrow}
          </span>

          <h1>
            {t.title}
          </h1>

          <p>
            {t.intro}
          </p>
        </div>
      </section>

      <section className="events23-wrap events23-list-section">
        <div className="events23-section-title">
          <h2>
            {t.upcoming}
          </h2>

          <a
            href={`${usersBase}/${locale}/account/events`}
          >
            {t.myEvents}
          </a>
        </div>

        {error && (
          <p
            role="alert"
            className="events23-error"
          >
            {error}
          </p>
        )}

        {!list.length ? (
          <div className="events23-empty">
            <Icon name="calendar" />
            {t.empty}
          </div>
        ) : (
          <div className="events23-grid">
            {list.map(
              (
                item,
              ) => {
                const price =
                  formatMoney(
                    locale,
                    item.price_minor,
                    item.currency,
                  );

                return (
                  <article
                    key={
                      item.id
                    }
                    className="events23-card"
                  >
                    {item.status ===
                      'LIVE' && (
                      <span className="events23-live-pill">
                        {t.live}
                      </span>
                    )}

                    <h2>
                      {item.title}
                    </h2>

                    <p>
                      {item.description.slice(
                        0,
                        260,
                      )}
                    </p>

                    <div className="events23-card-meta">
                      <span>
                        <Icon name="user" />
                        <bdi>
                          {item.presenter_code}
                        </bdi>
                      </span>

                      <span>
                        <Icon name="calendar" />
                        {formatDate(
                          locale,
                          item.starts_at,
                        )}
                      </span>

                      <span>
                        <Icon name="user" />
                        {t.remaining}:{' '}
                        {item.remaining.toLocaleString(
                          locale,
                        )}
                      </span>

                      <span>
                        <Icon name="wallet" />
                        {price ??
                          t.free}
                      </span>
                    </div>

                    <button
                      type="button"
                      className="button"
                      onClick={() =>
                        void open(
                          item.id,
                        )
                      }
                    >
                      {t.details}
                    </button>
                  </article>
                );
              },
            )}
          </div>
        )}
      </section>
    </main>
  );
}
