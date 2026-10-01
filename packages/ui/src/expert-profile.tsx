'use client';

import {
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  ExpertAssetImage,
} from './scholars';

import {
  expertProfileCopy,
} from './expert-profile-copy';

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

export type ExpertProfileTaxon = {
  id: string;

  kind?: string;

  code?: string;

  label: {
    fa?: string;
    en: string;
    [key: string]: string | undefined;
  };
};

export type ExpertProfileData = {
  slug: string;

  public_id: string;

  verified: boolean;

  profile: {
    display_name: string;
    title: string;
    short_bio: string;
    biography: string;
    experience: string;
    education: string;
    years: number;
    city: string;
    country: string;
    links: string[];

    languages: {
      id: string;
      level: string;
    }[];

    viewpoints: {
      topic: string;
      text: string;
    }[];

    seo_title: string;
    seo_description: string;
    image_id: string | null;
  };

  specialties: string[];

  documents: {
    title: string;
    issuer: string;
    kind: string;
  }[];

  services: {
    id: string;

    details: {
      title: string;
      summary: string;
      description: string;
      kind?: string;
      specialty_id?: string;
      category_id?: string | null;
      price_minor: number;
      currency: string;
      duration_minutes: number | null;
      booking_required: boolean;
      terms: string;
      image_id: string | null;
    };
  }[];
};

type Presence = {
  expert_code: string;

  state:
    | 'ONLINE'
    | 'AWAY'
    | 'OFFLINE';
};

type Rating = {
  expert_code: string;
  average: number | null;
  count: number;
};

type AvailabilitySummary = {
  expert_code: string;

  earliest: {
    service_id: string;
    start_at: string;
    end_at: string;
  } | null;

  available_today: boolean;
};

type PublicStats = {
  expert_code: string;
  completed_sessions: number;
};

type Slot = {
  start_at: string;
  end_at: string;
};

type SlotResponse = {
  service: {
    service_id: string;
    expert_code: string;
    title: string;
    duration_minutes: number;
    price_minor: number;
    currency: string;
  };

  timezone: string;

  slots: Slot[];

  cancellation_hours: number;
};

type PublicQuestion = {
  id: string;
  question: string;
  answer: string | null;
  updated_at: string;
};

type Tab =
  | 'about'
  | 'specialties'
  | 'services'
  | 'availability'
  | 'reviews'
  | 'articles'
  | 'questions';

function initials(
  value: string,
) {
  return value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(
      (part) =>
        part[0] ?? '',
    )
    .join('')
    .toUpperCase();
}

function currency(
  locale: string,
  amount: number,
  code: string,
) {
  const divisor =
    [
      'USD',
      'EUR',
      'GBP',
      'CAD',
      'AUD',
      'AED',
    ].includes(code)
      ? 100
      : 1;

  if (
    amount === 0
  )
    return null;

  try {
    return new Intl.NumberFormat(
      locale,
      {
        style:
          'currency',

        currency:
          code,

        maximumFractionDigits:
          2,
      },
    ).format(
      amount /
        divisor,
    );
  } catch {
    return (
      `${amount / divisor} ${code}`
    );
  }
}

function formatSlot(
  locale: string,
  timezone: string,
  value: string,
) {
  return new Intl.DateTimeFormat(
    locale,
    {
      dateStyle:
        'medium',

      timeStyle:
        'short',

      timeZone:
        timezone,
    },
  ).format(
    new Date(
      value,
    ),
  );
}

function Stars({
  value,
}: {
  value: number;
}) {
  return (
    <span
      className="profile21-stars"
      aria-label={`${value.toFixed(1)} / 5`}
    >
      {Array.from(
        {
          length: 5,
        },
        (
          _,
          index,
        ) => (
          <Icon
            key={
              index
            }
            name="star"
            className={
              index <
              Math.round(
                value,
              )
                ? 'active'
                : ''
            }
          />
        ),
      )}
    </span>
  );
}

export function ExpertProfileExperience({
  locale,
  expert,
  taxons,
}: {
  locale: string;
  expert: ExpertProfileData;
  taxons: ExpertProfileTaxon[];
}) {
  const t =
    expertProfileCopy[locale]!;

  const [
    tab,
    setTab,
  ] =
    useState<Tab>(
      'about',
    );

  const [
    timezone,
    setTimezone,
  ] =
    useState(
      'UTC',
    );

  const [
    presence,
    setPresence,
  ] =
    useState<
      Presence['state']
    >(
      'OFFLINE',
    );

  const [
    rating,
    setRating,
  ] =
    useState<Rating>({
      expert_code:
        expert.public_id,

      average:
        null,

      count:
        0,
    });

  const [
    summary,
    setSummary,
  ] =
    useState<AvailabilitySummary>({
      expert_code:
        expert.public_id,

      earliest:
        null,

      available_today:
        false,
    });

  const [
    stats,
    setStats,
  ] =
    useState<PublicStats>({
      expert_code:
        expert.public_id,

      completed_sessions:
        0,
    });

  const bookable =
    useMemo(
      () =>
        expert.services.filter(
          (service) =>
            service.details
              .booking_required &&
            Boolean(
              service.details
                .duration_minutes,
            ),
        ),
      [
        expert.services,
      ],
    );

  const [
    serviceId,
    setServiceId,
  ] =
    useState(
      bookable[0]?.id ??
        '',
    );

  const [
    slots,
    setSlots,
  ] =
    useState<Slot[]>([]);

  const [
    selectedSlot,
    setSelectedSlot,
  ] =
    useState('');

  const [
    slotsBusy,
    setSlotsBusy,
  ] =
    useState(false);

  const [
    questions,
    setQuestions,
  ] =
    useState<
      PublicQuestion[]
    >([]);

  useEffect(() => {
    const current =
      Intl
        .DateTimeFormat()
        .resolvedOptions()
        .timeZone;

    setTimezone(
      current ||
        'UTC',
    );
  }, []);

  useEffect(() => {
    const code =
      expert.public_id;

    const params =
      new URLSearchParams({
        experts:
          code,
      });

    void Promise.allSettled([
      userApi<
        Presence[]
      >(
        'presence/public?' +
          params,
      ),

      userApi<
        Rating[]
      >(
        'ratings/public?' +
          params,
      ),

      userApi<
        PublicStats[]
      >(
        'bookings/public-stats?' +
          params,
      ),

      userApi<
        PublicQuestion[]
      >(
        'questions/public?' +
          new URLSearchParams({
            expert:
              code,
          }),
      ),
    ]).then(
      (
        results,
      ) => {
        if (
          results[0].status ===
            'fulfilled' &&
          results[0].value[0]
        )
          setPresence(
            results[0].value[0]
              .state,
          );

        if (
          results[1].status ===
            'fulfilled' &&
          results[1].value[0]
        )
          setRating(
            results[1].value[0],
          );

        if (
          results[2].status ===
            'fulfilled' &&
          results[2].value[0]
        )
          setStats(
            results[2].value[0],
          );

        if (
          results[3].status ===
            'fulfilled'
        )
          setQuestions(
            results[3].value,
          );
      },
    );
  }, [
    expert.public_id,
  ]);

  useEffect(() => {
    if (
      !timezone
    )
      return;

    void userApi<
      AvailabilitySummary[]
    >(
      'availability/public?' +
        new URLSearchParams({
          experts:
            expert.public_id,

          timezone,

          days:
            '14',
        }),
    )
      .then(
        (
          rows,
        ) => {
          if (
            rows[0]
          )
            setSummary(
              rows[0],
            );
        },
      )
      .catch(
        () => {},
      );
  }, [
    expert.public_id,
    timezone,
  ]);

  useEffect(() => {
    setSelectedSlot(
      '',
    );

    if (
      !serviceId ||
      !timezone
    ) {
      setSlots(
        [],
      );
      return;
    }

    let active =
      true;

    setSlotsBusy(
      true,
    );

    void userApi<SlotResponse>(
      'availability/public-slots?' +
        new URLSearchParams({
          expert:
            expert.public_id,

          service:
            serviceId,

          timezone,

          days:
            '14',
        }),
    )
      .then(
        (
          data,
        ) => {
          if (
            active
          )
            setSlots(
              data.slots,
            );
        },
      )
      .catch(
        () => {
          if (
            active
          )
            setSlots(
              [],
            );
        },
      )
      .finally(
        () => {
          if (
            active
          )
            setSlotsBusy(
              false,
            );
        },
      );

    return () => {
      active =
        false;
    };
  }, [
    serviceId,
    timezone,
    expert.public_id,
  ]);

  const selectedService =
    bookable.find(
      (
        service,
      ) =>
        service.id ===
        serviceId,
    ) ??
    null;

  const specialties =
    expert.specialties
      .map(
        (id) =>
          taxons.find(
            (
              item,
            ) =>
              item.id === id,
          ),
      )
      .filter(
        (
          item,
        ): item is ExpertProfileTaxon =>
          Boolean(
            item,
          ),
      );

  const languages =
    expert.profile.languages
      .map(
        (
          language,
        ) => ({
          ...language,

          taxon:
            taxons.find(
              (
                item,
              ) =>
                item.id ===
                language.id,
            ),
        }),
      );

  const presenceLabel =
    presence ===
    'ONLINE'
      ? t.online
      : presence ===
          'AWAY'
        ? t.away
        : t.offline;

  const profileName =
    expert.profile
      .display_name ||
    expert.slug;

  const tabs: {
    id: Tab;
    label: string;
  }[] = [
    {
      id:
        'about',
      label:
        t.about,
    },

    {
      id:
        'specialties',
      label:
        t.specialties,
    },

    {
      id:
        'services',
      label:
        t.services,
    },

    {
      id:
        'availability',
      label:
        t.availability,
    },

    {
      id:
        'reviews',
      label:
        t.reviewTab,
    },

    {
      id:
        'articles',
      label:
        t.articles,
    },

    {
      id:
        'questions',
      label:
        t.questions,
    },
  ];

  return (
    <main
      id="main"
      tabIndex={-1}
      className="profile21"
    >
      <section className="profile21-hero">
        <div className="profile21-wrap">
          <a
            className="profile21-back"
            href={`${usersBase}/${locale}/experts`}
          >
            <Icon
              name="arrow"
              className="direction-icon"
            />

            {t.back}
          </a>

          <div className="profile21-hero-grid">
            <div className="profile21-identity">
              <div className="profile21-photo">
                <span className="profile21-fallback">
                  {initials(
                    profileName,
                  )}
                </span>

                <ExpertAssetImage
                  id={
                    expert.profile
                      .image_id
                  }
                  alt={
                    profileName
                  }
                />

                <span
                  className={`profile21-presence state-${presence.toLowerCase()}`}
                >
                  <i />
                  {presenceLabel}
                </span>
              </div>

              <div className="profile21-main-copy">
                <div className="profile21-badges">
                  {expert.verified && (
                    <span className="profile21-verified">
                      <Icon name="check" />
                      {t.verified}
                    </span>
                  )}

                  <span>
                    <Icon name="shield" />
                    {t.publicOnly}
                  </span>
                </div>

                <h1>
                  {profileName}
                </h1>

                <p className="profile21-title">
                  {expert.profile.title}
                </p>

                <p className="profile21-short">
                  {expert.profile.short_bio}
                </p>

                <div className="profile21-tags">
                  {specialties
                    .slice(
                      0,
                      4,
                    )
                    .map(
                      (
                        item,
                      ) => (
                        <span
                          key={
                            item.id
                          }
                        >
                          {languageValue(
                            item.label,
                            locale,
                          )}
                        </span>
                      ),
                    )}
                </div>

                <div className="profile21-languages">
                  <Icon name="globe" />

                  {languages.length
                    ? languages
                        .slice(
                          0,
                          5,
                        )
                        .map(
                          (
                            language,
                          ) =>
                            language.taxon
                              ? languageValue(
                                  language
                                    .taxon
                                    .label,
                                  locale,
                                )
                              : language.id,
                        )
                        .join(
                          ' · ',
                        )
                    : '—'}
                </div>

                {(expert.profile.city ||
                  expert.profile.country) && (
                  <div className="profile21-location">
                    <Icon name="globe" />

                    {[
                      expert.profile.city,
                      expert.profile.country,
                    ]
                      .filter(
                        Boolean,
                      )
                      .join(
                        ' · ',
                      )}
                  </div>
                )}

                <div className="profile21-actions">
                  <a
                    className="button"
                    href="#booking-widget"
                  >
                    {t.book}
                    <Icon name="calendar" />
                  </a>

                  <a
                    className="button secondary"
                    href={`${usersBase}/${locale}/questions?expert=${expert.public_id}`}
                  >
                    {t.ask}
                    <Icon name="comments" />
                  </a>

                  <a
                    className="button secondary"
                    href={`${usersBase}/${locale}/experts/${expert.slug}/channel`}
                  >
                    {t.channel}
                    <Icon name="mail" />
                  </a>
                </div>
              </div>
            </div>

            <div className="profile21-metrics">
              <article>
                <span className="profile21-metric-icon">
                  <Icon name="star" />
                </span>

                <strong>
                  {rating.average
                    ? rating.average.toFixed(
                        1,
                      )
                    : '—'}
                </strong>

                <small>
                  {t.rating}
                </small>

                {rating.average && (
                  <Stars
                    value={
                      rating.average
                    }
                  />
                )}
              </article>

              <article>
                <span className="profile21-metric-icon">
                  <Icon name="video" />
                </span>

                <strong>
                  {new Intl.NumberFormat(
                    locale,
                  ).format(
                    stats.completed_sessions,
                  )}
                </strong>

                <small>
                  {t.sessions}
                </small>
              </article>

              <article className="profile21-metric-wide">
                <span className="profile21-metric-icon">
                  <Icon name="clock" />
                </span>

                <div>
                  <small>
                    {t.next}
                  </small>

                  <strong>
                    {summary.earliest
                      ? formatSlot(
                          locale,
                          timezone,
                          summary
                            .earliest
                            .start_at,
                        )
                      : t.noAvailability}
                  </strong>
                </div>
              </article>
            </div>
          </div>
        </div>
      </section>

      <section className="profile21-wrap profile21-body">
        <div className="profile21-content">
          <nav
            className="profile21-tabs"
            aria-label={
              t.profile
            }
          >
            {tabs.map(
              (
                item,
              ) => (
                <button
                  key={
                    item.id
                  }
                  type="button"
                  className={
                    tab ===
                    item.id
                      ? 'active'
                      : ''
                  }
                  aria-pressed={
                    tab ===
                    item.id
                  }
                  onClick={() =>
                    setTab(
                      item.id,
                    )
                  }
                >
                  {item.label}
                </button>
              ),
            )}
          </nav>

          <div className="profile21-tab-panel">
            {tab ===
              'about' && (
              <>
                <section className="profile21-section-card">
                  <h2>
                    {t.about}
                  </h2>

                  <p className="profile21-long-text">
                    {expert.profile.biography ||
                      expert.profile.short_bio}
                  </p>
                </section>

                <div className="profile21-two">
                  <section className="profile21-section-card">
                    <h3>
                      <Icon name="book" />
                      {t.education}
                    </h3>

                    <p>
                      {expert.profile.education ||
                        '—'}
                    </p>
                  </section>

                  <section className="profile21-section-card">
                    <h3>
                      <Icon name="sparkles" />
                      {t.experience}
                    </h3>

                    <p>
                      {expert.profile.experience ||
                        '—'}
                    </p>

                    {expert.profile.years >
                      0 && (
                      <strong className="profile21-years">
                        {new Intl.NumberFormat(
                          locale,
                        ).format(
                          expert.profile.years,
                        )}{' '}
                        {t.years}
                      </strong>
                    )}
                  </section>
                </div>

                {!!expert.profile
                  .viewpoints
                  .length && (
                  <section className="profile21-section-card">
                    <h2>
                      {t.viewpoints}
                    </h2>

                    <div className="profile21-viewpoints">
                      {expert.profile.viewpoints.map(
                        (
                          viewpoint,
                          index,
                        ) => (
                          <article
                            key={
                              index
                            }
                          >
                            <strong>
                              {viewpoint.topic}
                            </strong>

                            <p>
                              {viewpoint.text}
                            </p>
                          </article>
                        ),
                      )}
                    </div>
                  </section>
                )}

                <section className="profile21-section-card">
                  <h2>
                    {t.credentials}
                  </h2>

                  {expert.documents.length ? (
                    <div className="profile21-documents">
                      {expert.documents.map(
                        (
                          document,
                          index,
                        ) => (
                          <div
                            key={
                              `${document.title}-${index}`
                            }
                          >
                            <Icon name="shield" />

                            <span>
                              <strong>
                                {document.title}
                              </strong>

                              <small>
                                {document.issuer}
                              </small>
                            </span>
                          </div>
                        ),
                      )}
                    </div>
                  ) : (
                    <p>
                      {t.documentsEmpty}
                    </p>
                  )}
                </section>

                {!!expert.profile
                  .links
                  .length && (
                  <section className="profile21-section-card">
                    <h2>
                      {t.links}
                    </h2>

                    <div className="profile21-links">
                      {expert.profile.links.map(
                        (
                          link,
                        ) => (
                          <a
                            key={
                              link
                            }
                            href={
                              link
                            }
                            target="_blank"
                            rel="nofollow noopener noreferrer"
                          >
                            <Icon name="link" />

                            {new URL(
                              link,
                            ).hostname}
                          </a>
                        ),
                      )}
                    </div>
                  </section>
                )}
              </>
            )}

            {tab ===
              'specialties' && (
              <section className="profile21-section-card">
                <h2>
                  {t.specialties}
                </h2>

                <div className="profile21-specialty-grid">
                  {specialties.map(
                    (
                      item,
                    ) => (
                      <article
                        key={
                          item.id
                        }
                      >
                        <span>
                          <Icon name="book" />
                        </span>

                        <strong>
                          {languageValue(
                            item.label,
                            locale,
                          )}
                        </strong>
                      </article>
                    ),
                  )}
                </div>

                <h3 className="profile21-language-heading">
                  {t.languages}
                </h3>

                <div className="profile21-language-grid">
                  {languages.map(
                    (
                      language,
                    ) => (
                      <span
                        key={
                          language.id
                        }
                      >
                        <Icon name="globe" />

                        <strong>
                          {language.taxon
                            ? languageValue(
                                language
                                  .taxon
                                  .label,
                                locale,
                              )
                            : language.id}
                        </strong>

                        <small>
                          {t.languageLevel}:{' '}
                          {language.level}
                        </small>
                      </span>
                    ),
                  )}
                </div>
              </section>
            )}

            {tab ===
              'services' && (
              <section className="profile21-section-card">
                <h2>
                  {t.services}
                </h2>

                {expert.services.length ? (
                  <div className="profile21-services">
                    {expert.services.map(
                      (
                        service,
                      ) => {
                        const amount =
                          currency(
                            locale,
                            service.details
                              .price_minor,
                            service.details
                              .currency,
                          );

                        return (
                          <article
                            key={
                              service.id
                            }
                          >
                            <div className="profile21-service-head">
                              <span>
                                <Icon name="video" />
                              </span>

                              <div>
                                <h3>
                                  {service.details.title}
                                </h3>

                                <p>
                                  {service.details.summary}
                                </p>
                              </div>
                            </div>

                            <p className="profile21-service-description">
                              {service.details.description}
                            </p>

                            <div className="profile21-service-meta">
                              {service.details
                                .duration_minutes && (
                                <span>
                                  <Icon name="clock" />
                                  {
                                    service
                                      .details
                                      .duration_minutes
                                  }{' '}
                                  {t.minutes}
                                </span>
                              )}

                              <span>
                                <Icon name="wallet" />

                                {amount ??
                                  t.free}
                              </span>
                            </div>

                            {service.details
                              .booking_required && (
                              <button
                                type="button"
                                className="button compact"
                                onClick={() => {
                                  setServiceId(
                                    service.id,
                                  );

                                  setTab(
                                    'availability',
                                  );

                                  document
                                    .getElementById(
                                      'booking-widget',
                                    )
                                    ?.scrollIntoView({
                                      behavior:
                                        'smooth',
                                    });
                                }}
                              >
                                {t.book}
                                <Icon name="calendar" />
                              </button>
                            )}
                          </article>
                        );
                      },
                    )}
                  </div>
                ) : (
                  <p>
                    {t.serviceEmpty}
                  </p>
                )}
              </section>
            )}

            {tab ===
              'availability' && (
              <section className="profile21-section-card">
                <h2>
                  {t.availability}
                </h2>

                <p>
                  {t.timezone}
                </p>

                <div className="profile21-slot-grid">
                  {slotsBusy && (
                    <p>
                      {t.loadingSlots}
                    </p>
                  )}

                  {!slotsBusy &&
                    !slots.length && (
                    <p>
                      {t.noSlots}
                    </p>
                  )}

                  {slots.map(
                    (
                      slot,
                    ) => (
                      <button
                        type="button"
                        key={
                          slot.start_at
                        }
                        className={
                          selectedSlot ===
                          slot.start_at
                            ? 'selected'
                            : ''
                        }
                        onClick={() =>
                          setSelectedSlot(
                            slot.start_at,
                          )
                        }
                      >
                        <Icon name="clock" />

                        {formatSlot(
                          locale,
                          timezone,
                          slot.start_at,
                        )}
                      </button>
                    ),
                  )}
                </div>
              </section>
            )}

            {tab ===
              'reviews' && (
              <section className="profile21-section-card">
                <h2>
                  {t.reviewTab}
                </h2>

                {rating.average ? (
                  <div className="profile21-review-summary">
                    <strong>
                      {rating.average.toFixed(
                        1,
                      )}
                    </strong>

                    <Stars
                      value={
                        rating.average
                      }
                    />

                    <span>
                      {new Intl.NumberFormat(
                        locale,
                      ).format(
                        rating.count,
                      )}{' '}
                      {t.reviews}
                    </span>

                    <p>
                      {t.ratingSummary}
                    </p>
                  </div>
                ) : (
                  <p>
                    {t.noRatings}
                  </p>
                )}

                <p className="profile21-privacy-note">
                  <Icon name="shield" />
                  {t.reviewsPrivacy}
                </p>

                <p className="profile21-session-note">
                  {new Intl.NumberFormat(
                    locale,
                  ).format(
                    stats.completed_sessions,
                  )}{' '}
                  {t.sessions}
                  {' · '}
                  {t.sessionCountNote}
                </p>
              </section>
            )}

            {tab ===
              'articles' && (
              <section className="profile21-section-card profile21-empty">
                <Icon name="book" />

                <strong>
                  {t.articles}
                </strong>

                <p>
                  {t.articlesEmpty}
                </p>
              </section>
            )}

            {tab ===
              'questions' && (
              <section className="profile21-section-card">
                <h2>
                  {t.questions}
                </h2>

                {questions.length ? (
                  <div className="profile21-questions">
                    {questions
                      .slice(
                        0,
                        10,
                      )
                      .map(
                        (
                          question,
                        ) => (
                          <a
                            key={
                              question.id
                            }
                            href={`${usersBase}/${locale}/questions/${question.id}`}
                          >
                            <span>
                              <Icon name="comments" />
                            </span>

                            <div>
                              <strong>
                                {question.question}
                              </strong>

                              <small>
                                {t.answered}
                              </small>
                            </div>

                            <Icon
                              name="arrow"
                              className="direction-icon"
                            />
                          </a>
                        ),
                      )}
                  </div>
                ) : (
                  <p>
                    {t.questionsEmpty}
                  </p>
                )}
              </section>
            )}
          </div>
        </div>

        <aside
          id="booking-widget"
          className="profile21-booking"
        >
          <div className="profile21-booking-head">
            <span>
              <Icon name="calendar" />
            </span>

            <div>
              <h2>
                {t.bookingTitle}
              </h2>

              <p>
                {t.bookingText}
              </p>
            </div>
          </div>

          {bookable.length ? (
            <>
              <label>
                {t.selectService}

                <select
                  value={
                    serviceId
                  }
                  onChange={(
                    event,
                  ) =>
                    setServiceId(
                      event.target
                        .value,
                    )
                  }
                >
                  {bookable.map(
                    (
                      service,
                    ) => (
                      <option
                        key={
                          service.id
                        }
                        value={
                          service.id
                        }
                      >
                        {service.details.title}
                      </option>
                    ),
                  )}
                </select>
              </label>

              {selectedService && (
                <div className="profile21-booking-price">
                  <span>
                    <Icon name="wallet" />
                    {t.price}
                  </span>

                  <strong>
                    {currency(
                      locale,
                      selectedService
                        .details
                        .price_minor,
                      selectedService
                        .details
                        .currency,
                    ) ??
                      t.free}
                  </strong>

                  {selectedService
                    .details
                    .duration_minutes && (
                    <small>
                      {
                        selectedService
                          .details
                          .duration_minutes
                      }{' '}
                      {t.minutes}
                    </small>
                  )}
                </div>
              )}

              <div className="profile21-booking-slots">
                <strong>
                  {t.availableSlots}
                </strong>

                <small>
                  <Icon name="globe" />
                  {timezone}
                </small>

                {slotsBusy && (
                  <p>
                    {t.loadingSlots}
                  </p>
                )}

                {!slotsBusy &&
                  !slots.length && (
                  <p>
                    {t.noSlots}
                  </p>
                )}

                <div>
                  {slots
                    .slice(
                      0,
                      8,
                    )
                    .map(
                      (
                        slot,
                      ) => (
                        <button
                          key={
                            slot.start_at
                          }
                          type="button"
                          className={
                            selectedSlot ===
                            slot.start_at
                              ? 'selected'
                              : ''
                          }
                          onClick={() =>
                            setSelectedSlot(
                              slot.start_at,
                            )
                          }
                        >
                          {formatSlot(
                            locale,
                            timezone,
                            slot.start_at,
                          )}
                        </button>
                      ),
                    )}
                </div>
              </div>

              {selectedSlot && (
                <div className="profile21-selected">
                  <small>
                    {t.selected}
                  </small>

                  <strong>
                    {formatSlot(
                      locale,
                      timezone,
                      selectedSlot,
                    )}
                  </strong>
                </div>
              )}

              <a
                className={`button profile21-book-button${
                  !selectedSlot
                    ? ' disabled'
                    : ''
                }`}
                aria-disabled={
                  !selectedSlot
                }
                href={
                  selectedSlot
                    ? `${usersBase}/${locale}/account/book?expert=${expert.public_id}&service=${serviceId}&start=${encodeURIComponent(
                        selectedSlot,
                      )}`
                    : '#booking-widget'
                }
              >
                {t.continueBooking}
                <Icon name="arrow" />
              </a>

              <p className="profile21-login-note">
                <Icon name="shield" />
                {t.loginNote}
              </p>
            </>
          ) : (
            <p>
              {t.serviceEmpty}
            </p>
          )}
        </aside>
      </section>
    </main>
  );
}
