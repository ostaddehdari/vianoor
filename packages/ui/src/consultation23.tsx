'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  Icon,
} from './icons';

import {
  languageValue,
} from './localization-runtime';

import {
  userApi,
  usersBase,
} from './users-client';

import {
  consultation23Copy,
} from './consultation23-copy';

type Language = {
  code: string;
  native_name: string | null;
  name_en: string;
};

type Taxon = {
  id: string;

  kind:
    | 'specialty'
    | 'category'
    | 'language';

  label: {
    fa?: string;
    en: string;
    [key: string]:
      | string
      | undefined;
  };

  active: boolean;

  position?: number;
  icon?: string;
};

type Service = {
  id: string;
  booking_required: boolean;
  price_minor: number;
  currency: string;
  duration_minutes: number | null;
  specialty_id: string;
  category_id: string | null;
  kind: string;

  fields: {
    title?: string;
    summary?: string;
  };
};

type Expert = {
  code: string;
  slug: string;

  profile: {
    display_name?: string;
    title?: string;
    short_bio?: string;
  };

  specialties: {
    id: string;

    label: {
      fa?: string;
      en: string;
      [key: string]:
        | string
        | undefined;
    };
  }[];

  languages: {
    code: string;
    level: string;
  }[];

  services: Service[];
};

type SearchResponse = {
  items: Expert[];
  next_offset: number | null;
};

type Rating = {
  expert_code: string;
  average: number | null;
  count: number;
};

type Slot = {
  start_at: string;
  end_at: string;
};

type SlotResponse = {
  service: {
    service_id?: string;
    title?: string;
    price_minor?: number;
    currency?: string;
    duration_minutes?: number;
  };

  timezone: string;

  slots: Slot[];

  cancellation_hours: number;
};

type Match = {
  expert: Expert;
  service: Service;
  slots: Slot[];
  rating: Rating | null;
};

type Booking = {
  id: string;
  expert_code: string;
  service_id: string;
  start_at: string;
  end_at: string | null;
  status: string;
  expires_at: string | null;
  timezone: string;
  revision: number;

  service:
    | {
        title?: string;
        expert_name?: string;
        price_minor?: number;
        currency?: string;
        duration_minutes?: number;
      }
    | null;
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
  status: string;
  fulfillment?: string;
  amount?: string;
  currency?: string;
  decimals?: number;

  checkout?: {
    url?: string;
    address?: string;
    amount?: string;
    network?: string;
  };
};

type TimeChoice =
  | 'today'
  | 'tomorrow'
  | 'week'
  | 'specific';

const draftKey =
  'vianoor:consultation23-draft';

function money(
  locale: string,
  amount: number,
  currency: string,
) {
  if (
    amount ===
    0
  )
    return null;

  const divisor =
    [
      'USD',
      'EUR',
      'GBP',
      'CAD',
      'AUD',
      'AED',
    ].includes(
      currency,
    )
      ? 100
      : 1;

  try {
    return new Intl.NumberFormat(
      locale,
      {
        style:
          'currency',

        currency,
        maximumFractionDigits:
          2,
      },
    ).format(
      amount /
        divisor,
    );
  } catch {
    return (
      `${amount} ${currency}`
    );
  }
}

function dayKey(
  value: Date,
  timezone: string,
) {
  const parts =
    new Intl.DateTimeFormat(
      'en-CA',
      {
        timeZone:
          timezone,

        year:
          'numeric',

        month:
          '2-digit',

        day:
          '2-digit',
      },
    ).formatToParts(
      value,
    );

  const map =
    Object.fromEntries(
      parts.map(
        (
          part,
        ) => [
          part.type,
          part.value,
        ],
      ),
    );

  return (
    `${map.year}-${map.month}-${map.day}`
  );
}

function tomorrowKey(
  timezone: string,
) {
  return dayKey(
    new Date(
      Date.now() +
        86400000,
    ),
    timezone,
  );
}

function formatDate(
  locale: string,
  timezone: string,
  value: string,
) {
  try {
    return new Intl.DateTimeFormat(
      locale,
      {
        timeZone:
          timezone,

        dateStyle:
          'medium',

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

function serviceForNeed(
  expert: Expert,
  need:
    | Taxon
    | null,
  preferredKind = '',
) {
  if (!need)
    return null;

  const candidates =
    expert.services
      .filter(
        (
          service,
        ) =>
          service.booking_required !==
            false &&
          (
            !preferredKind ||
            service.kind ===
              preferredKind
          ) &&
          (
            need.kind ===
              'specialty'
              ? service.specialty_id ===
                need.id
              : service.category_id ===
                need.id
          ),
      )
      .sort(
        (
          a,
          b,
        ) =>
          a.price_minor -
          b.price_minor,
      );

  return (
    candidates[0] ??
    null
  );
}

export function ConsultationJourney({
  locale,
}: {
  locale: string;
}) {
  const t =
    consultation23Copy[
      locale
    ]!;

  const [
    step,
    setStep,
  ] =
    useState(1);

  const [
    languages,
    setLanguages,
  ] =
    useState<
      Language[]
    >([]);

  const [
    taxonomy,
    setTaxonomy,
  ] =
    useState<
      Taxon[]
    >([]);

  const [
    needId,
    setNeedId,
  ] =
    useState('');

  const [
    preferredKind,
    setPreferredKind,
  ] =
    useState('');

  const [
    spokenLanguage,
    setSpokenLanguage,
  ] =
    useState(
      locale,
    );

  const [
    timeChoice,
    setTimeChoice,
  ] =
    useState<TimeChoice>(
      'today',
    );

  const [
    specificDate,
    setSpecificDate,
  ] =
    useState('');

  const [
    timezone,
    setTimezone,
  ] =
    useState(
      'UTC',
    );

  const [
    matches,
    setMatches,
  ] =
    useState<
      Match[]
    >([]);

  const [
    selected,
    setSelected,
  ] =
    useState<
      Match | null
    >(null);

  const [
    selectedSlot,
    setSelectedSlot,
  ] =
    useState<
      Slot | null
    >(null);

  const [
    booking,
    setBooking,
  ] =
    useState<
      Booking | null
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
    busy,
    setBusy,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState('');

  const bookingAttempt =
    useRef<{
      fingerprint: string;
      key: string;
    } | null>(
      null,
    );

  const paymentAttempt =
    useRef<{
      fingerprint: string;
      key: string;
    } | null>(
      null,
    );

  const needs =
    useMemo(
      () =>
        taxonomy
          .filter(
            (
              item,
            ) =>
              item.active &&
              (
                item.kind ===
                  'specialty' ||
                item.kind ===
                  'category'
              ),
          )
          .sort(
            (
              a,
              b,
            ) =>
              (
                a.position ??
                0
              ) -
              (
                b.position ??
                0
              ),
          ),
      [
        taxonomy,
      ],
    );

  const selectedNeed =
    useMemo(
      () =>
        needs.find(
          (
            item,
          ) =>
            item.id ===
            needId,
        ) ??
        null,
      [
        needs,
        needId,
      ],
    );

  const languageName =
    (
      code: string,
    ) =>
      languages.find(
        (
          item,
        ) =>
          item.code ===
          code,
      )?.native_name ??
      languages.find(
        (
          item,
        ) =>
          item.code ===
          code,
      )?.name_en ??
      code;

  const slotsForTime =
    (
      slots: Slot[],
    ) => {
      const now =
        Date.now();

      const today =
        dayKey(
          new Date(
            now,
          ),
          timezone,
        );

      const tomorrow =
        tomorrowKey(
          timezone,
        );

      return slots.filter(
        (
          slot,
        ) => {
          const start =
            Date.parse(
              slot.start_at,
            );

          if (
            !Number.isFinite(
              start,
            )
          )
            return false;

          if (
            timeChoice ===
            'today'
          )
            return (
              dayKey(
                new Date(
                  start,
                ),
                timezone,
              ) ===
              today
            );

          if (
            timeChoice ===
            'tomorrow'
          )
            return (
              dayKey(
                new Date(
                  start,
                ),
                timezone,
              ) ===
              tomorrow
            );

          if (
            timeChoice ===
            'week'
          )
            return (
              start >=
                now &&
              start <=
                now +
                  7 *
                    86400000
            );

          return (
            Boolean(
              specificDate,
            ) &&
            dayKey(
              new Date(
                start,
              ),
              timezone,
            ) ===
              specificDate
          );
        },
      );
    };

  useEffect(
    () => {
      setTimezone(
        Intl
          .DateTimeFormat()
          .resolvedOptions()
          .timeZone ||
          'UTC',
      );

      const params =
        new URLSearchParams(
          window.location.search,
        );

      const requestedMode =
        params.get(
          'mode',
        );

      if (
        requestedMode ===
        'text'
      )
        setPreferredKind(
          'TEXT',
        );

      const initialLanguage =
        params.get(
          'spoken_language',
        ) ??
        params.get(
          'language',
        ) ??
        locale;

      setSpokenLanguage(
        initialLanguage,
      );

      setTimeChoice(
        (
          [
            'today',
            'tomorrow',
            'week',
            'specific',
          ].includes(
            params.get(
              'time',
            ) ??
              '',
          )
            ? params.get(
                'time',
              )
            : 'today'
        ) as TimeChoice,
      );

      const initialNeed =
        params.get(
          'specialty',
        ) ??
        params.get(
          'topic',
        ) ??
        params.get(
          'need',
        ) ??
        '';

      if (
        initialNeed
      )
        setNeedId(
          initialNeed,
        );

      const saved =
        params.get(
          'resume',
        ) ===
          '1'
          ? window.localStorage.getItem(
              draftKey,
            )
          : null;

      if (
        saved
      ) {
        try {
          const draft =
            JSON.parse(
              saved,
            ) as {
              needId?: string;
              spokenLanguage?: string;
              timeChoice?: TimeChoice;
              specificDate?: string;
              timezone?: string;
              selected?: Match;
              selectedSlot?: Slot;
            };

          if (
            draft.needId
          )
            setNeedId(
              draft.needId,
            );

          if (
            draft.spokenLanguage
          )
            setSpokenLanguage(
              draft.spokenLanguage,
            );

          if (
            draft.timeChoice
          )
            setTimeChoice(
              draft.timeChoice,
            );

          if (
            draft.specificDate
          )
            setSpecificDate(
              draft.specificDate,
            );

          if (
            draft.timezone
          )
            setTimezone(
              draft.timezone,
            );

          if (
            draft.selected
          )
            setSelected(
              draft.selected,
            );

          if (
            draft.selectedSlot
          )
            setSelectedSlot(
              draft.selectedSlot,
            );

          if (
            draft.selected &&
            draft.selectedSlot
          )
            setStep(
              5,
            );
        } catch {
          window.localStorage.removeItem(
            draftKey,
          );
        }
      }

      void Promise.all([
        userApi<
          Language[]
        >(
          'languages',
        ),

        userApi<
          Taxon[]
        >(
          'taxonomy',
        ),
      ])
        .then(
          ([
            languageRows,
            taxonRows,
          ]) => {
            setLanguages(
              languageRows,
            );

            setTaxonomy(
              taxonRows,
            );

            if (
              !languageRows.some(
                (
                  item,
                ) =>
                  item.code ===
                  initialLanguage,
              )
            )
              setSpokenLanguage(
                languageRows.find(
                  (
                    item,
                  ) =>
                    item.code ===
                    locale,
                )?.code ??
                  languageRows[0]
                    ?.code ??
                  locale,
              );
          },
        )
        .catch(
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

  async function findExperts() {
    if (
      !selectedNeed
    )
      return;

    if (
      timeChoice ===
        'specific' &&
      !specificDate
    )
      return;

    setBusy(
      true,
    );

    setError(
      '',
    );

    try {
      const params =
        new URLSearchParams({
          q:
            '',

          language:
            locale,

          spoken_language:
            spokenLanguage,

          offset:
            '0',

          limit:
            '30',

          ...(
            selectedNeed.kind ===
              'specialty'
              ? {
                  specialty:
                    selectedNeed.id,
                }
              : {}
          ),
        });

      const response =
        await userApi<
          SearchResponse
        >(
          'search/experts?' +
            params.toString(),
        );

      const filtered =
        response.items
          .map(
            (
              expert,
            ) => ({
              expert,

              service:
                serviceForNeed(
                  expert,
                  selectedNeed,
                  preferredKind,
                ),
            }),
          )
          .filter(
            (
              value,
            ): value is {
              expert: Expert;
              service: Service;
            } =>
              Boolean(
                value.service,
              ),
          )
          .slice(
            0,
            20,
          );

      const codes =
        filtered
          .map(
            (
              value,
            ) =>
              value.expert
                .code,
          )
          .join(
            ',',
          );

      let ratingMap:
        Record<
          string,
          Rating
        > = {};

      if (
        codes
      ) {
        try {
          const ratingRows =
            await userApi<
              Rating[]
            >(
              'ratings/public?' +
                new URLSearchParams({
                  experts:
                    codes,
                }),
            );

          ratingMap =
            Object.fromEntries(
              ratingRows.map(
                (
                  item,
                ) => [
                  item.expert_code,
                  item,
                ],
              ),
            );
        } catch {
          /*
           * Rating enrichment is non-blocking.
           * Stage21 public rating API may not yet exist
           * on an older Preview backend.
           */
        }
      }

      const enriched =
        await Promise.all(
          filtered.map(
            async (
              value,
            ): Promise<Match> => {
              let slots:
                Slot[] = [];

              try {
                const data =
                  await userApi<
                    SlotResponse
                  >(
                    'availability/public-slots?' +
                      new URLSearchParams({
                        expert:
                          value
                            .expert
                            .code,

                        service:
                          value
                            .service
                            .id,

                        timezone,

                        days:
                          '14',
                      }),
                  );

                slots =
                  slotsForTime(
                    data.slots,
                  );
              } catch {
                /*
                 * Keep the expert visible.
                 * Availability can be rechecked after sign-in
                 * against the authenticated booking service.
                 */
              }

              return {
                expert:
                  value.expert,

                service:
                  value.service,

                slots,

                rating:
                  ratingMap[
                    value
                      .expert
                      .code
                  ] ??
                  null,
              };
            },
          ),
        );

      enriched.sort(
        (
          first,
          second,
        ) => {
          if (
            Boolean(
              first.slots
                .length,
            ) !==
            Boolean(
              second.slots
                .length,
            )
          )
            return first
              .slots.length
              ? -1
              : 1;

          const ratingDifference =
            (
              second.rating
                ?.average ??
              -1
            ) -
            (
              first.rating
                ?.average ??
              -1
            );

          if (
            ratingDifference
          )
            return ratingDifference;

          return (
            first.service
              .price_minor -
            second.service
              .price_minor
          );
        },
      );

      setMatches(
        enriched,
      );

      setSelected(
        null,
      );

      setSelectedSlot(
        null,
      );

      setStep(
        4,
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

  function saveDraft() {
    try {
      window.localStorage.setItem(
        draftKey,
        JSON.stringify({
          needId,
          spokenLanguage,
          timeChoice,
          specificDate,
          timezone,
          selected,
          selectedSlot,
        }),
      );
    } catch {
      /* localStorage is optional */
    }
  }

  function signInAndReturn() {
    saveDraft();

    const returnTo =
      'consultation?resume=1';

    window.location.assign(
      `${usersBase}/${locale}/auth/login?return=${encodeURIComponent(
        returnTo,
      )}`,
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

  async function refreshBooking(
    id: string,
  ) {
    const rows =
      await userApi<
        Booking[]
      >(
        'bookings/scheduled?view=mine&period=all',
      );

    const found =
      rows.find(
        (
          item,
        ) =>
          item.id ===
          id,
      );

    if (
      found
    )
      setBooking(
        found,
      );

    return found;
  }

  async function reserve() {
    if (
      !selected ||
      !selectedSlot
    )
      return;

    setBusy(
      true,
    );

    setError(
      '',
    );

    try {
      const data = {
        expert:
          selected.expert
            .code,

        service:
          selected.service
            .id,

        start_at:
          selectedSlot
            .start_at,

        timezone,
      };

      const fingerprint =
        JSON.stringify(
          data,
        );

      if (
        bookingAttempt.current
          ?.fingerprint !==
        fingerprint
      )
        bookingAttempt.current = {
          fingerprint,

          key:
            crypto.randomUUID(),
        };

      let created:
        Booking;

      try {
        created =
          await userApi<
            Booking
          >(
            'bookings/scheduled',
            'POST',
            {
              request_key:
                bookingAttempt
                  .current
                  .key,

              ...data,
            },
          );
      } catch (
        exception
      ) {
        const code =
          exception instanceof
          Error
            ? exception.message
            : '';

        if (
          [
            'UNAUTHORIZED',
            'INVALID_CREDENTIALS',
          ].includes(
            code,
          )
        ) {
          signInAndReturn();
          return;
        }

        if (
          [
            'SLOT_UNAVAILABLE',
            'SLOT_ALREADY_RESERVED',
          ].includes(
            code,
          )
        )
          setError(
            t.slotUnavailable,
          );
        else
          setError(
            t.error,
          );

        return;
      }

      bookingAttempt.current =
        null;

      setBooking(
        created,
      );

      window.localStorage.removeItem(
        draftKey,
      );

      if (
        created.status ===
        'HELD'
      ) {
        const confirmed =
          await userApi<
            Booking
          >(
            'bookings/scheduled/' +
              created.id +
              '/confirm',
            'POST',
            {
              revision:
                created.revision,

              request_key:
                crypto.randomUUID(),
            },
          );

        setBooking(
          confirmed,
        );

        setStep(
          7,
        );

        return;
      }

      if (
        [
          'CONFIRMED',
          'RESCHEDULED',
        ].includes(
          created.status,
        )
      ) {
        setStep(
          7,
        );

        return;
      }

      if (
        created.status ===
        'BOOKING_PENDING_PAYMENT'
      ) {
        await loadPaymentMethods();

        setStep(
          6,
        );

        return;
      }

      setStep(
        7,
      );
    } finally {
      setBusy(
        false,
      );
    }
  }

  async function createPayment() {
    if (
      !booking
    )
      return;

    setBusy(
      true,
    );

    setError(
      '',
    );

    try {
      const data = {
        provider,
        booking_id:
          booking.id,
        locale,

        ...(
          provider ===
            'nowpayments'
            ? {
                network,
              }
            : {}
        ),
      };

      const fingerprint =
        JSON.stringify(
          data,
        );

      if (
        paymentAttempt.current
          ?.fingerprint !==
        fingerprint
      )
        paymentAttempt.current = {
          fingerprint,

          key:
            crypto.randomUUID(),
        };

      const created =
        await userApi<
          Payment
        >(
          'payments/create',
          'POST',
          {
            ...data,

            request_key:
              paymentAttempt
                .current
                .key,
          },
        );

      setPayment(
        created,
      );

      if (
        created.status ===
        'SUCCESS'
      ) {
        paymentAttempt.current =
          null;

        await refreshBooking(
          booking.id,
        );

        setStep(
          7,
        );
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

  async function reconcilePayment() {
    if (
      !payment ||
      !booking
    )
      return;

    setBusy(
      true,
    );

    setError(
      '',
    );

    try {
      const current =
        await userApi<
          Payment
        >(
          'payments/' +
            payment.id +
            '/reconcile',
          'POST',
          {},
        );

      setPayment(
        current,
      );

      if (
        current.status ===
        'SUCCESS'
      ) {
        paymentAttempt.current =
          null;

        await refreshBooking(
          booking.id,
        );

        setStep(
          7,
        );
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

  async function refreshConfirmation() {
    if (
      !booking
    )
      return;

    setBusy(
      true,
    );

    setError(
      '',
    );

    try {
      await refreshBooking(
        booking.id,
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

  function reset() {
    setStep(
      1,
    );

    setNeedId(
      '',
    );

    setSpokenLanguage(
      locale,
    );

    setTimeChoice(
      'today',
    );

    setSpecificDate(
      '',
    );

    setMatches(
      [],
    );

    setSelected(
      null,
    );

    setSelectedSlot(
      null,
    );

    setBooking(
      null,
    );

    setMethods(
      null,
    );

    setPayment(
      null,
    );

    setError(
      '',
    );

    window.localStorage.removeItem(
      draftKey,
    );

    window.history.replaceState(
      null,
      '',
      `${usersBase}/${locale}/consultation`,
    );
  }

  const steps = [
    t.step1,
    t.step2,
    t.step3,
    t.step4,
    t.step5,
    t.step6,
    t.step7,
    t.step8,
  ];

  const activeMethods =
    methods?.methods.filter(
      (
        item,
      ) =>
        item.enabled,
    ) ??
    [];

  const providerLabel =
    (
      value: string,
    ) =>
      value ===
      'wallet'
        ? t.wallet
        : value ===
            'stripe'
          ? t.stripe
          : value ===
              'paypal'
            ? t.paypal
            : t.nowpayments;

  return (
    <main
      id="main"
      tabIndex={-1}
      className="consult23"
    >
      <section className="consult23-hero">
        <div className="consult23-wrap">
          <span className="consult23-eyebrow">
            <Icon name="sparkles" />
            {t.eyebrow}
          </span>

          <h1>
            {t.title}
          </h1>

          <p>
            {t.intro}
          </p>

          <div className="consult23-live">
            <span />

            {t.realData}
          </div>
        </div>
      </section>

      <section className="consult23-wrap consult23-layout">
        <div className="consult23-main">
          <ol className="consult23-progress">
            {steps.map(
              (
                label,
                index,
              ) => {
                const number =
                  index +
                  1;

                return (
                  <li
                    key={
                      label
                    }
                    className={
                      number ===
                      step
                        ? 'active'
                        : number <
                            step
                          ? 'done'
                          : ''
                    }
                  >
                    <span>
                      {number <
                      step ? (
                        <Icon name="check" />
                      ) : (
                        new Intl.NumberFormat(
                          locale,
                        ).format(
                          number,
                        )
                      )}
                    </span>

                    <small>
                      {label}
                    </small>
                  </li>
                );
              },
            )}
          </ol>

          {error && (
            <div
              className="consult23-error"
              role="alert"
            >
              <Icon name="help" />
              {error}
            </div>
          )}

          {step ===
            1 && (
            <section className="consult23-step">
              <header>
                <span>
                  {t.step}{' '}
                  ۱
                </span>

                <h2>
                  {t.needTitle}
                </h2>

                <p>
                  {t.needText}
                </p>
              </header>

              {!needs.length ? (
                <div className="consult23-loading">
                  {t.loading}
                </div>
              ) : (
                <div className="consult23-choice-grid">
                  {needs.map(
                    (
                      item,
                    ) => (
                      <button
                        key={
                          item.id
                        }
                        type="button"
                        className={
                          needId ===
                          item.id
                            ? 'selected'
                            : ''
                        }
                        onClick={() =>
                          setNeedId(
                            item.id,
                          )
                        }
                      >
                        <span className="consult23-choice-icon">
                          <Icon
                            name={
                              item.kind ===
                              'specialty'
                                ? 'book'
                                : 'heart'
                            }
                          />
                        </span>

                        <strong>
                          {languageValue(
                            item.label,
                            locale,
                          )}
                        </strong>

                        {needId ===
                          item.id && (
                          <Icon name="check" />
                        )}
                      </button>
                    ),
                  )}
                </div>
              )}

              <footer>
                <span />

                <button
                  type="button"
                  className="button"
                  disabled={
                    !needId
                  }
                  onClick={() =>
                    setStep(
                      2,
                    )
                  }
                >
                  {t.next}
                  <Icon
                    name="arrow"
                    className="direction-icon"
                  />
                </button>
              </footer>
            </section>
          )}

          {step ===
            2 && (
            <section className="consult23-step">
              <header>
                <span>
                  {t.step}{' '}
                  ۲
                </span>

                <h2>
                  {t.languageTitle}
                </h2>

                <p>
                  {t.languageText}
                </p>
              </header>

              <div className="consult23-language-grid">
                {languages.map(
                  (
                    language,
                  ) => (
                    <button
                      key={
                        language.code
                      }
                      type="button"
                      className={
                        spokenLanguage ===
                        language.code
                          ? 'selected'
                          : ''
                      }
                      onClick={() =>
                        setSpokenLanguage(
                          language.code,
                        )
                      }
                    >
                      <Icon name="globe" />

                      <strong>
                        {language.native_name ??
                          language.name_en}
                      </strong>

                      <small>
                        {language.code.toUpperCase()}
                      </small>

                      {spokenLanguage ===
                        language.code && (
                        <Icon name="check" />
                      )}
                    </button>
                  ),
                )}
              </div>

              <footer>
                <button
                  type="button"
                  onClick={() =>
                    setStep(
                      1,
                    )
                  }
                >
                  {t.back}
                </button>

                <button
                  type="button"
                  className="button"
                  disabled={
                    !spokenLanguage
                  }
                  onClick={() =>
                    setStep(
                      3,
                    )
                  }
                >
                  {t.next}
                  <Icon
                    name="arrow"
                    className="direction-icon"
                  />
                </button>
              </footer>
            </section>
          )}

          {step ===
            3 && (
            <section className="consult23-step">
              <header>
                <span>
                  {t.step}{' '}
                  ۳
                </span>

                <h2>
                  {t.whenTitle}
                </h2>

                <p>
                  {t.timezone}:{' '}
                  <bdi>
                    {timezone}
                  </bdi>
                </p>
              </header>

              <div className="consult23-time-grid">
                {(
                  [
                    [
                      'today',
                      t.today,
                    ],

                    [
                      'tomorrow',
                      t.tomorrow,
                    ],

                    [
                      'week',
                      t.week,
                    ],

                    [
                      'specific',
                      t.specific,
                    ],
                  ] as const
                ).map(
                  ([
                    value,
                    label,
                  ]) => (
                    <button
                      key={
                        value
                      }
                      type="button"
                      className={
                        timeChoice ===
                        value
                          ? 'selected'
                          : ''
                      }
                      onClick={() =>
                        setTimeChoice(
                          value,
                        )
                      }
                    >
                      <Icon
                        name={
                          value ===
                          'today'
                            ? 'clock'
                            : 'calendar'
                        }
                      />

                      <strong>
                        {label}
                      </strong>

                      {timeChoice ===
                        value && (
                        <Icon name="check" />
                      )}
                    </button>
                  ),
                )}
              </div>

              {timeChoice ===
                'specific' && (
                <label className="consult23-date">
                  {t.chooseDate}

                  <input
                    type="date"
                    min={
                      new Date()
                        .toISOString()
                        .slice(
                          0,
                          10,
                        )
                    }
                    value={
                      specificDate
                    }
                    onChange={(
                      event,
                    ) =>
                      setSpecificDate(
                        event
                          .target
                          .value,
                      )
                    }
                  />
                </label>
              )}

              <footer>
                <button
                  type="button"
                  onClick={() =>
                    setStep(
                      2,
                    )
                  }
                >
                  {t.back}
                </button>

                <button
                  type="button"
                  className="button"
                  disabled={
                    busy ||
                    (
                      timeChoice ===
                        'specific' &&
                      !specificDate
                    )
                  }
                  onClick={() =>
                    void findExperts()
                  }
                >
                  {busy
                    ? t.searching
                    : t.next}

                  <Icon
                    name="arrow"
                    className="direction-icon"
                  />
                </button>
              </footer>
            </section>
          )}

          {step ===
            4 && (
            <section className="consult23-step consult23-expert-step">
              <header>
                <span>
                  {t.step}{' '}
                  ۴
                </span>

                <h2>
                  {t.expertsTitle}
                </h2>

                <p>
                  {t.expertsText}
                </p>
              </header>

              {busy && (
                <div className="consult23-loading">
                  {t.searching}
                </div>
              )}

              {!busy &&
                !matches.length && (
                <div className="consult23-empty">
                  <Icon name="search" />

                  <p>
                    {t.noExperts}
                  </p>

                  <button
                    type="button"
                    onClick={() =>
                      setStep(
                        3,
                      )
                    }
                  >
                    {t.change}
                  </button>
                </div>
              )}

              <div className="consult23-experts">
                {matches.map(
                  (
                    match,
                  ) => {
                    const price =
                      money(
                        locale,
                        match.service
                          .price_minor,
                        match.service
                          .currency,
                      );

                    const firstSlot =
                      match.slots[0];

                    return (
                      <article
                        key={
                          match.expert
                            .code
                        }
                        className="consult23-expert"
                      >
                        <div className="consult23-expert-top">
                          <span className="consult23-avatar">
                            {(
                              match.expert
                                .profile
                                .display_name ??
                              match.expert
                                .code
                            )
                              .trim()
                              .split(
                                /\s+/,
                              )
                              .slice(
                                0,
                                2,
                              )
                              .map(
                                (
                                  part,
                                ) =>
                                  part[0] ??
                                  '',
                              )
                              .join(
                                '',
                              )}
                          </span>

                          <div>
                            <h3>
                              {match
                                .expert
                                .profile
                                .display_name ??
                                match
                                  .expert
                                  .code}
                            </h3>

                            <p>
                              {match
                                .expert
                                .profile
                                .title ??
                                match
                                  .service
                                  .fields
                                  .title}
                            </p>
                          </div>

                          <div className="consult23-rating">
                            <Icon name="star" />

                            {match.rating
                              ?.average !==
                            null &&
                            match.rating
                              ?.average !==
                            undefined ? (
                              <>
                                <strong>
                                  {match.rating.average.toFixed(
                                    1,
                                  )}
                                </strong>

                                <small>
                                  (
                                  {match.rating.count}
                                  )
                                </small>
                              </>
                            ) : (
                              <small>
                                {t.noRating}
                              </small>
                            )}
                          </div>
                        </div>

                        <div className="consult23-match">
                          <strong>
                            {t.matchReason}
                          </strong>

                          <span>
                            <Icon name="check" />
                            {t.topicMatch}
                          </span>

                          <span>
                            <Icon name="check" />
                            {t.languageMatch}
                          </span>

                          {!!match.slots
                            .length && (
                            <span>
                              <Icon name="check" />
                              {t.availabilityMatch}
                            </span>
                          )}
                        </div>

                        <div className="consult23-expert-info">
                          <div>
                            <Icon name="globe" />

                            <span>
                              <small>
                                {t.languages}
                              </small>

                              <strong>
                                {match.expert.languages
                                  .slice(
                                    0,
                                    4,
                                  )
                                  .map(
                                    (
                                      item,
                                    ) =>
                                      languageName(
                                        item.code,
                                      ),
                                  )
                                  .join(
                                    ' · ',
                                  ) ||
                                  '—'}
                              </strong>
                            </span>
                          </div>

                          <div>
                            <Icon name="book" />

                            <span>
                              <small>
                                {t.service}
                              </small>

                              <strong>
                                {match.service
                                  .fields
                                  .title ??
                                  '—'}
                              </strong>
                            </span>
                          </div>

                          <div>
                            <Icon name="clock" />

                            <span>
                              <small>
                                {t.availability}
                              </small>

                              <strong>
                                {firstSlot
                                  ? formatDate(
                                      locale,
                                      timezone,
                                      firstSlot.start_at,
                                    )
                                  : t.unavailable}
                              </strong>
                            </span>
                          </div>

                          <div>
                            <Icon name="wallet" />

                            <span>
                              <small>
                                {t.price}
                              </small>

                              <strong>
                                {price ??
                                  t.free}
                              </strong>
                            </span>
                          </div>
                        </div>

                        <div className="consult23-expert-actions">
                          <a
                            href={`${usersBase}/${locale}/experts/${match.expert.slug}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t.profile}
                          </a>

                          <button
                            type="button"
                            className="button"
                            disabled={
                              !match
                                .slots
                                .length
                            }
                            onClick={() => {
                              setSelected(
                                match,
                              );

                              setSelectedSlot(
                                null,
                              );

                              setStep(
                                5,
                              );
                            }}
                          >
                            {t.selectExpert}
                          </button>
                        </div>
                      </article>
                    );
                  },
                )}
              </div>

              <footer>
                <button
                  type="button"
                  onClick={() =>
                    setStep(
                      3,
                    )
                  }
                >
                  {t.back}
                </button>

                <span />
              </footer>
            </section>
          )}

          {step ===
            5 &&
            selected && (
            <section className="consult23-step">
              <header>
                <span>
                  {t.step}{' '}
                  ۵
                </span>

                <h2>
                  {t.slotTitle}
                </h2>

                <p>
                  {t.slotText}
                </p>
              </header>

              <div className="consult23-selected-expert">
                <strong>
                  {selected.expert
                    .profile
                    .display_name ??
                    selected.expert
                      .code}
                </strong>

                <span>
                  {selected.service
                    .fields
                    .title}
                </span>
              </div>

              <div className="consult23-slots">
                {selected.slots.map(
                  (
                    slot,
                  ) => (
                    <button
                      key={
                        slot.start_at
                      }
                      type="button"
                      className={
                        selectedSlot
                          ?.start_at ===
                        slot.start_at
                          ? 'selected'
                          : ''
                      }
                      onClick={() =>
                        setSelectedSlot(
                          slot,
                        )
                      }
                    >
                      <Icon name="calendar" />

                      <time
                        dateTime={
                          slot.start_at
                        }
                      >
                        {formatDate(
                          locale,
                          timezone,
                          slot.start_at,
                        )}
                      </time>

                      {selectedSlot
                        ?.start_at ===
                        slot.start_at && (
                        <Icon name="check" />
                      )}
                    </button>
                  ),
                )}
              </div>

              {!selected.slots
                .length && (
                <div className="consult23-empty">
                  {t.noSlots}
                </div>
              )}

              <footer>
                <button
                  type="button"
                  onClick={() =>
                    setStep(
                      4,
                    )
                  }
                >
                  {t.back}
                </button>

                <button
                  type="button"
                  className="button"
                  disabled={
                    !selectedSlot ||
                    busy
                  }
                  onClick={() =>
                    void reserve()
                  }
                >
                  {busy
                    ? t.creatingBooking
                    : t.next}

                  <Icon
                    name="arrow"
                    className="direction-icon"
                  />
                </button>
              </footer>
            </section>
          )}

          {step ===
            6 &&
            booking && (
            <section className="consult23-step">
              <header>
                <span>
                  {t.step}{' '}
                  ۶
                </span>

                <h2>
                  {t.paymentTitle}
                </h2>

                <p>
                  {t.paymentText}
                </p>
              </header>

              {!methods ? (
                <div className="consult23-loading">
                  {t.loading}
                </div>
              ) : !activeMethods
                  .length ? (
                <div className="consult23-empty">
                  {t.paymentUnavailable}
                </div>
              ) : (
                <>
                  <div className="consult23-payment-methods">
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
                          <Icon
                            name={
                              method.provider ===
                              'wallet'
                                ? 'wallet'
                                : 'shield'
                            }
                          />

                          {providerLabel(
                            method.provider,
                          )}

                          {provider ===
                            method.provider && (
                            <Icon name="check" />
                          )}
                        </button>
                      ),
                    )}
                  </div>

                  {provider ===
                    'nowpayments' &&
                    methods.networks && (
                    <label className="consult23-network">
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
                            code,
                            value,
                          ]) => (
                            <option
                              key={
                                code
                              }
                              value={
                                code
                              }
                            >
                              {value.coin ??
                                code}
                              {' · '}
                              {value.network ??
                                code}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                  )}

                  {!payment && (
                    <button
                      type="button"
                      className="button consult23-pay"
                      disabled={
                        busy
                      }
                      onClick={() =>
                        void createPayment()
                      }
                    >
                      <Icon name="wallet" />
                      {t.pay}
                    </button>
                  )}

                  {payment && (
                    <article className="consult23-payment-status">
                      <strong>
                        {payment.status ===
                        'SUCCESS'
                          ? t.paymentSuccess
                          : t.paymentPending}
                      </strong>

                      <bdi>
                        {payment.id}
                      </bdi>

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
                        <div className="consult23-crypto">
                          <span>
                            {t.cryptoAddress}
                          </span>

                          <bdi>
                            {payment
                              .checkout
                              .address}
                          </bdi>

                          <span>
                            {t.cryptoAmount}
                          </span>

                          <bdi>
                            {payment
                              .checkout
                              .amount}
                            {' · '}
                            {payment
                              .checkout
                              .network}
                          </bdi>
                        </div>
                      )}

                      {payment.status !==
                        'SUCCESS' && (
                        <button
                          type="button"
                          disabled={
                            busy
                          }
                          onClick={() =>
                            void reconcilePayment()
                          }
                        >
                          {t.checkPayment}
                        </button>
                      )}
                    </article>
                  )}
                </>
              )}

              <footer>
                <button
                  type="button"
                  disabled={
                    Boolean(
                      payment,
                    )
                  }
                  onClick={() =>
                    setStep(
                      5,
                    )
                  }
                >
                  {t.back}
                </button>

                <span />
              </footer>
            </section>
          )}

          {step ===
            7 &&
            booking && (
            <section className="consult23-step consult23-confirmation">
              <header>
                <span>
                  {t.step}{' '}
                  ۷
                </span>

                <h2>
                  {t.confirmationTitle}
                </h2>

                <p>
                  {t.confirmationText}
                </p>
              </header>

              <div className="consult23-confirm-card">
                <span className="consult23-confirm-icon">
                  <Icon name="check" />
                </span>

                <dl>
                  <div>
                    <dt>
                      {t.bookingId}
                    </dt>

                    <dd>
                      <bdi>
                        {booking.id}
                      </bdi>
                    </dd>
                  </div>

                  <div>
                    <dt>
                      {t.status}
                    </dt>

                    <dd>
                      {[
                        'CONFIRMED',
                        'RESCHEDULED',
                      ].includes(
                        booking.status,
                      )
                        ? t.sessionStatusConfirmed
                        : booking.status ===
                            'BOOKING_PENDING_PAYMENT'
                          ? t.sessionStatusPending
                          : t.sessionStatusHeld}
                    </dd>
                  </div>

                  <div>
                    <dt>
                      {t.selectedTime}
                    </dt>

                    <dd>
                      {formatDate(
                        locale,
                        booking.timezone ||
                          timezone,
                        booking.start_at,
                      )}
                    </dd>
                  </div>
                </dl>
              </div>

              <footer>
                {![
                  'CONFIRMED',
                  'RESCHEDULED',
                ].includes(
                  booking.status,
                ) ? (
                  <button
                    type="button"
                    className="button"
                    disabled={
                      busy
                    }
                    onClick={() =>
                      void refreshConfirmation()
                    }
                  >
                    {t.refresh}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="button"
                    onClick={() =>
                      setStep(
                        8,
                      )
                    }
                  >
                    {t.next}
                    <Icon
                      name="arrow"
                      className="direction-icon"
                    />
                  </button>
                )}
              </footer>
            </section>
          )}

          {step ===
            8 &&
            booking && (
            <section className="consult23-step consult23-join">
              <span className="consult23-join-icon">
                <Icon name="video" />
              </span>

              <h2>
                {t.joinTitle}
              </h2>

              <p>
                {t.joinText}
              </p>

              <div className="consult23-join-actions">
                <a
                  className="button"
                  href={`${usersBase}/${locale}/account/sessions?booking=${encodeURIComponent(
                    booking.id,
                  )}`}
                >
                  <Icon name="video" />
                  {t.joinSession}
                </a>

                <a
                  className="button secondary"
                  href={`${usersBase}/${locale}/account/bookings`}
                >
                  {t.myBookings}
                </a>

                <button
                  type="button"
                  onClick={
                    reset
                  }
                >
                  {t.restart}
                </button>
              </div>
            </section>
          )}
        </div>

        <aside className="consult23-summary">
          <h2>
            {t.summary}
          </h2>

          <div>
            <Icon name="heart" />

            <span>
              <small>
                {t.step1}
              </small>

              <strong>
                {selectedNeed
                  ? languageValue(
                      selectedNeed.label,
                      locale,
                    )
                  : t.notSelected}
              </strong>
            </span>
          </div>

          <div>
            <Icon name="globe" />

            <span>
              <small>
                {t.step2}
              </small>

              <strong>
                {spokenLanguage
                  ? languageName(
                      spokenLanguage,
                    )
                  : t.notSelected}
              </strong>
            </span>
          </div>

          <div>
            <Icon name="clock" />

            <span>
              <small>
                {t.step3}
              </small>

              <strong>
                {timeChoice ===
                'today'
                  ? t.today
                  : timeChoice ===
                      'tomorrow'
                    ? t.tomorrow
                    : timeChoice ===
                        'week'
                      ? t.week
                      : specificDate ||
                        t.specific}
              </strong>
            </span>
          </div>

          <div>
            <Icon name="user" />

            <span>
              <small>
                {t.selectedExpert}
              </small>

              <strong>
                {selected
                  ? selected.expert
                      .profile
                      .display_name ??
                    selected.expert
                      .code
                  : t.notSelected}
              </strong>
            </span>
          </div>

          <div>
            <Icon name="calendar" />

            <span>
              <small>
                {t.selectedTime}
              </small>

              <strong>
                {selectedSlot
                  ? formatDate(
                      locale,
                      timezone,
                      selectedSlot.start_at,
                    )
                  : t.notSelected}
              </strong>
            </span>
          </div>
        </aside>
      </section>
    </main>
  );
}
