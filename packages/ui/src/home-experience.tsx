'use client';

import {
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  homeCopy,
} from './home-copy';

import {
  Icon,
  type IconName,
} from './icons';

import {
  languageValue,
} from './localization-runtime';

import {
  userApi,
} from './users-client';

import type {
  Locale,
} from './messages';

const base =
  process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const href = (
  locale: string,
  path = '',
) =>
  `${base}/${locale}${
    path ? '/' + path : ''
  }`;

type Language = {
  code: string;
  name_en: string;
  native_name: string | null;
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
    [key: string]: string | undefined;
  };

  active: boolean;
  position: number;
};

type SearchExpert = {
  code: string;
  slug: string;

  profile: {
    display_name?: string;
    title?: string;
    short_bio?: string;
    [key: string]: unknown;
  };

  specialties: {
    id: string;

    label: {
      fa?: string;
      en: string;
      [key: string]: string | undefined;
    };
  }[];

  languages: {
    code: string;
    level: string;
  }[];

  services: {
    id: string;
    booking_required: boolean;
    price_minor?: number;
    currency?: string;

    fields?: {
      title?: string;
      summary?: string;
    };
  }[];
};

type ExpertSearchResult = {
  items: SearchExpert[];
  next_offset: number | null;
};

type Question = {
  id: string;
  question: string;
  answer: string | null;
  author: string | null;
  updated_at: string;
};

const services: {
  key:
    | 'consultation'
    | 'questions'
    | 'events'
    | 'helpline';

  icon: IconName;
  path: string;
  tone: string;
}[] = [
  {
    key: 'consultation',
    icon: 'video',
    path: 'experts',
    tone: 'emerald',
  },
  {
    key: 'questions',
    icon: 'comments',
    path: 'questions',
    tone: 'violet',
  },
  {
    key: 'events',
    icon: 'calendar',
    path: 'events',
    tone: 'coral',
  },
  {
    key: 'helpline',
    icon: 'phone',
    path: 'services#talk-now',
    tone: 'gold',
  },
];

const insightCategories = [
  'family',
  'relationships',
  'spirituality',
  'parenting',
  'ethics',
  'mental',
  'beliefs',
  'rulings',
] as const;

const insights = [
  {
    slug:
      'listening',
    title:
      'insight1',
    icon:
      'comments' as IconName,
    minutes:
      4,
  },
  {
    slug:
      'better-questions',
    title:
      'insight2',
    icon:
      'book' as IconName,
    minutes:
      5,
  },
  {
    slug:
      'small-steps',
    title:
      'insight3',
    icon:
      'leaf' as IconName,
    minutes:
      6,
  },
] as const;

function Arrow() {
  return (
    <Icon
      name="arrow"
      className="direction-icon"
    />
  );
}

function SectionHead({
  title,
  text,
  action,
  actionHref,
}: {
  title: string;
  text: string;
  action?: string;
  actionHref?: string;
}) {
  return (
    <div className="home21-section-head">
      <div>
        <span
          className="home21-section-kicker"
          aria-hidden="true"
        />

        <h2>
          {title}
        </h2>

        <p>
          {text}
        </p>
      </div>

      {action &&
        actionHref && (
          <a
            href={actionHref}
            className="home21-text-link"
          >
            {action}
            <Arrow />
          </a>
        )}
    </div>
  );
}

function ServiceCard({
  locale,
  item,
  compact = false,
}: {
  locale: Locale;
  item: (typeof services)[number];
  compact?: boolean;
}) {
  const t =
    homeCopy[locale]!;

  const title =
    t[item.key];

  const description =
    t[
      `${item.key}Text` as
        | 'consultationText'
        | 'questionsText'
        | 'eventsText'
        | 'helplineText'
    ];

  const cta =
    t[
      `${item.key}Cta` as
        | 'consultationCta'
        | 'questionsCta'
        | 'eventsCta'
        | 'helplineCta'
    ];

  return (
    <a
      className={[
        'home21-service-card',
        compact
          ? 'compact'
          : '',
        `tone-${item.tone}`,
      ]
        .filter(Boolean)
        .join(' ')}
      href={href(
        locale,
        item.path,
      )}
    >
      <span className="home21-service-icon">
        <Icon name={item.icon} />
      </span>

      <span className="home21-service-copy">
        <strong>
          {title}
        </strong>

        {!compact && (
          <small>
            {description}
          </small>
        )}
      </span>

      <span className="home21-service-arrow">
        <Arrow />
      </span>

      {!compact && (
        <span className="home21-service-cta">
          {cta}
        </span>
      )}
    </a>
  );
}

function priceLabel(
  locale: string,
  expert: SearchExpert,
) {
  const paid =
    expert.services
      .map(
        (service) => ({
          amount:
            Number(
              service.price_minor ??
                0,
            ),

          currency:
            service.currency ??
            '',
        }),
      )
      .filter(
        (price) =>
          price.amount > 0,
      )
      .sort(
        (a, b) =>
          a.amount -
          b.amount,
      )[0];

  if (!paid)
    return null;

  try {
    return new Intl.NumberFormat(
      locale,
      {
        style: 'currency',
        currency:
          paid.currency ||
          'USD',
        maximumFractionDigits:
          2,
      },
    ).format(
      paid.amount / 100,
    );
  } catch {
    return (
      `${paid.amount / 100} ` +
      paid.currency
    );
  }
}

function initials(
  value: string,
) {
  return value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(
      (word) =>
        word.charAt(0),
    )
    .join('')
    .toUpperCase();
}

export function HomeExperience({
  locale,
}: {
  locale: Locale;
}) {
  const t =
    homeCopy[locale]!;

  const [
    languages,
    setLanguages,
  ] = useState<Language[]>([]);

  const [
    taxons,
    setTaxons,
  ] = useState<Taxon[]>([]);

  const [
    experts,
    setExperts,
  ] = useState<SearchExpert[]>([]);

  const [
    questions,
    setQuestions,
  ] = useState<Question[]>([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    topic,
    setTopic,
  ] = useState('');

  const [
    spokenLanguage,
    setSpokenLanguage,
  ] = useState(locale);

  const [
    time,
    setTime,
  ] = useState('today');

  useEffect(() => {
    let active = true;

    void Promise.allSettled([
      userApi<Language[]>(
        'languages',
      ),

      userApi<Taxon[]>(
        'taxonomy',
      ),

      userApi<ExpertSearchResult>(
        'search/experts?' +
          new URLSearchParams({
            language:
              locale,

            spoken_language:
              locale,

            limit:
              '6',
          }),
      ),

      userApi<Question[]>(
        'questions/public',
      ),
    ]).then(
      async (
        results,
      ) => {
        if (!active)
          return;

        if (
          results[0].status ===
          'fulfilled'
        ) {
          setLanguages(
            results[0].value,
          );

          if (
            !results[0].value.some(
              (language) =>
                language.code ===
                spokenLanguage,
            )
          ) {
            setSpokenLanguage(
              results[0].value[0]
                ?.code ??
                locale,
            );
          }
        }

        if (
          results[1].status ===
          'fulfilled'
        )
          setTaxons(
            results[1].value,
          );

        if (
          results[2].status ===
          'fulfilled'
        ) {
          setExperts(
            results[2].value.items,
          );
        } else {
          /*
           * Search may be temporarily
           * unavailable while OpenSearch
           * is rebuilding. Public expert
           * projection remains a safe
           * fallback.
           */
          await userApi<
            Array<{
              slug: string;
              public_id: string;
              display_name?: string;
              title?: string;
              short_bio?: string;
            }>
          >(
            'experts/public?' +
              new URLSearchParams({
                language:
                  locale,
              }),
          )
            .then(
              (rows) => {
                if (!active)
                  return;

                setExperts(
                  rows
                    .slice(0, 6)
                    .map(
                      (row) => ({
                        code:
                          row.public_id,

                        slug:
                          row.slug,

                        profile: {
                          display_name:
                            row.display_name ?? '',

                          title:
                            row.title ?? '',

                          short_bio:
                            row.short_bio ?? '',
                        },

                        specialties:
                          [],

                        languages:
                          [],

                        services:
                          [],
                      }),
                    ),
                );
              },
            )
            .catch(
              () => {},
            );
        }

        if (
          results[3].status ===
          'fulfilled'
        )
          setQuestions(
            results[3].value,
          );

        setLoading(false);
      },
    );

    return () => {
      active = false;
    };
  }, [
    locale,
  ]);

  const topics =
    useMemo(
      () =>
        taxons
          .filter(
            (item) =>
              item.active &&
              (
                item.kind ===
                  'specialty' ||
                item.kind ===
                  'category'
              ),
          )
          .sort(
            (a, b) =>
              a.position -
              b.position,
          )
          .slice(0, 20),
      [
        taxons,
      ],
    );

  const answered =
    questions.filter(
      (question) =>
        Boolean(
          question.answer,
        ),
    ).length;

  const latestQuestions =
    questions.slice(
      0,
      3,
    );

  const searchParams =
    new URLSearchParams();

  searchParams.set(
    'language',
    locale,
  );

  if (spokenLanguage)
    searchParams.set(
      'spoken_language',
      spokenLanguage,
    );

  if (topic) {
    const selected =
      taxons.find(
        (item) =>
          item.id === topic,
      );

    searchParams.set(
      selected?.kind ===
        'category'
        ? 'topic'
        : 'specialty',
      topic,
    );
  }

  searchParams.set(
    'time',
    time,
  );

  const smartHref =
    href(
      locale,
      `experts?${searchParams.toString()}`,
    );

  return (
    <main
      id="main-content"
      className="home21"
    >
      <section className="home21-hero">
        <div className="home21-hero-glow glow-one" />
        <div className="home21-hero-glow glow-two" />

        <div className="home21-hero-inner">
          <div className="home21-hero-copy">
            <div className="home21-eyebrow">
              <span>
                ✦
              </span>

              {t.eyebrow}
            </div>

            <h1>
              {t.title1}

              <strong>
                {t.title2}
              </strong>
            </h1>

            <p className="home21-hero-intro">
              {t.intro}
            </p>

            <div className="home21-hero-buttons">
              <a
                className="button"
                href="#smart-start"
              >
                {t.start}
                <Arrow />
              </a>

              <a
                className="button secondary"
                href="#services"
              >
                {t.explore}
              </a>
            </div>

            <div className="home21-proof">
              <span>
                <Icon name="shield" />
                {t.realData}
              </span>

              <span>
                <Icon name="globe" />
                {languages.length ||
                  '—'}{' '}
                {t.languages}
              </span>

              <span>
                <Icon name="comments" />
                {questions.length}{' '}
                {t.publishedQuestions}
              </span>
            </div>
          </div>

          <div className="home21-hero-services">
            {services.map(
              (item) => (
                <ServiceCard
                  key={
                    item.key
                  }
                  locale={
                    locale
                  }
                  item={
                    item
                  }
                  compact
                />
              ),
            )}

            <div className="home21-hero-orbit">
              <span />
              <span />
              <span />

              <div className="home21-hero-mark">
                <Icon name="sparkles" />
              </div>
            </div>
          </div>
        </div>

        <div
          id="smart-start"
          className="home21-smart-wrap"
        >
          <div className="home21-smart">
            <div className="home21-smart-title">
              <span className="home21-smart-icon">
                <Icon name="sparkles" />
              </span>

              <div>
                <strong>
                  {t.smartTitle}
                </strong>

                <small>
                  {t.smartText}
                </small>
              </div>
            </div>

            <label>
              <span>
                <Icon name="heart" />
                {t.need}
              </span>

              <select
                value={topic}
                onChange={(
                  event,
                ) =>
                  setTopic(
                    event.target
                      .value,
                  )
                }
              >
                <option value="">
                  {t.chooseTopic}
                </option>

                {topics.map(
                  (item) => (
                    <option
                      key={
                        item.id
                      }
                      value={
                        item.id
                      }
                    >
                      {languageValue(
                        item.label,
                        locale,
                      )}
                    </option>
                  ),
                )}
              </select>
            </label>

            <label>
              <span>
                <Icon name="globe" />
                {t.language}
              </span>

              <select
                value={
                  spokenLanguage
                }
                onChange={(
                  event,
                ) =>
                  setSpokenLanguage(
                    event.target
                      .value,
                  )
                }
              >
                {languages.map(
                  (
                    language,
                  ) => (
                    <option
                      key={
                        language.code
                      }
                      value={
                        language.code
                      }
                    >
                      {language.native_name ??
                        language.name_en}
                    </option>
                  ),
                )}
              </select>
            </label>

            <label>
              <span>
                <Icon name="clock" />
                {t.when}
              </span>

              <select
                value={
                  time
                }
                onChange={(
                  event,
                ) =>
                  setTime(
                    event.target
                      .value,
                  )
                }
              >
                <option value="today">
                  {t.today}
                </option>

                <option value="tomorrow">
                  {t.tomorrow}
                </option>

                <option value="week">
                  {t.thisWeek}
                </option>

                <option value="any">
                  {t.anytime}
                </option>
              </select>
            </label>

            <a
              className="button home21-smart-submit"
              href={smartHref}
            >
              {t.showExperts}
              <Arrow />
            </a>
          </div>
        </div>
      </section>

      <section
        id="services"
        className="home21-section home21-wrap"
      >
        <SectionHead
          title={
            t.fourWays
          }
          text={
            t.fourWaysText
          }
        />

        <div className="home21-service-grid">
          {services.map(
            (item) => (
              <ServiceCard
                key={
                  item.key
                }
                locale={
                  locale
                }
                item={
                  item
                }
              />
            ),
          )}
        </div>
      </section>

      <section className="home21-section home21-soft">
        <div className="home21-wrap">
          <SectionHead
            title={
              t.qnaTitle
            }
            text={
              t.qnaText
            }
            action={
              t.seeQuestions
            }
            actionHref={href(
              locale,
              'questions',
            )}
          />

          <div className="home21-qna-layout">
            <div className="home21-qna-stats">
              <article>
                <span>
                  <Icon name="comments" />
                </span>

                <strong>
                  {questions.length}
                </strong>

                <small>
                  {t.publishedQuestions}
                </small>
              </article>

              <article>
                <span>
                  <Icon name="check" />
                </span>

                <strong>
                  {answered}
                </strong>

                <small>
                  {t.answeredQuestions}
                </small>
              </article>

              <article>
                <span>
                  <Icon name="clock" />
                </span>

                <strong>
                  {Math.min(
                    questions.length,
                    3,
                  )}
                </strong>

                <small>
                  {t.latestQuestions}
                </small>
              </article>
            </div>

            <div className="home21-question-list">
              {loading && (
                <div className="home21-empty">
                  {t.loading}
                </div>
              )}

              {!loading &&
                !latestQuestions.length && (
                  <div className="home21-empty">
                    <Icon name="comments" />

                    <strong>
                      {t.noQuestions}
                    </strong>

                    <a
                      className="button compact"
                      href={href(
                        locale,
                        'questions',
                      )}
                    >
                      {t.askQuestion}
                    </a>
                  </div>
                )}

              {latestQuestions.map(
                (
                  question,
                  index,
                ) => (
                  <a
                    key={
                      question.id
                    }
                    className="home21-question"
                    href={href(
                      locale,
                      `questions/${question.id}`,
                    )}
                  >
                    <span className="home21-question-number">
                      {new Intl.NumberFormat(
                        locale,
                      ).format(
                        index +
                          1,
                      )}
                    </span>

                    <span className="home21-question-body">
                      <strong>
                        {question.question}
                      </strong>

                      <small>
                        {question.answer
                          ? t.answered
                          : t.awaiting}
                      </small>
                    </span>

                    <Arrow />
                  </a>
                ),
              )}

              <div className="home21-qna-actions">
                <a
                  className="button secondary compact"
                  href={href(
                    locale,
                    'questions',
                  )}
                >
                  {t.seeQuestions}
                </a>

                <a
                  className="button compact"
                  href={href(
                    locale,
                    'account/questions',
                  )}
                >
                  {t.askQuestion}
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="home21-section home21-wrap">
        <SectionHead
          title={
            t.expertsTitle
          }
          text={
            t.expertsText
          }
          action={
            t.consultationCta
          }
          actionHref={href(
            locale,
            'experts',
          )}
        />

        {!loading &&
        !experts.length ? (
          <div className="home21-empty home21-expert-empty">
            <Icon name="user" />
            <strong>
              {t.noExperts}
            </strong>
          </div>
        ) : (
          <div className="home21-expert-grid">
            {experts
              .slice(
                0,
                3,
              )
              .map(
                (
                  expert,
                  index,
                ) => {
                  const name =
                    expert.profile
                      .display_name ||
                    expert.profile
                      .title ||
                    expert.slug;

                  const price =
                    priceLabel(
                      locale,
                      expert,
                    );

                  return (
                    <article
                      key={
                        expert.code
                      }
                      className={`home21-expert tone-${index}`}
                    >
                      <div className="home21-expert-top">
                        <div className="home21-expert-avatar">
                          {initials(
                            name,
                          )}
                        </div>

                        <span className="home21-verified">
                          <Icon name="check" />
                          {t.verified}
                        </span>
                      </div>

                      <h3>
                        {name}
                      </h3>

                      {expert.profile
                        .title && (
                        <p className="home21-expert-title">
                          {
                            expert
                              .profile
                              .title
                          }
                        </p>
                      )}

                      {expert.profile
                        .short_bio && (
                        <p className="home21-expert-bio">
                          {
                            expert
                              .profile
                              .short_bio
                          }
                        </p>
                      )}

                      <div className="home21-expert-meta">
                        {!!expert
                          .specialties
                          .length && (
                          <span>
                            <Icon name="book" />

                            {expert.specialties
                              .slice(
                                0,
                                2,
                              )
                              .map(
                                (
                                  specialty,
                                ) =>
                                  languageValue(
                                    specialty.label,
                                    locale,
                                  ),
                              )
                              .join(
                                ' · ',
                              )}
                          </span>
                        )}

                        {!!expert
                          .languages
                          .length && (
                          <span>
                            <Icon name="globe" />

                            {expert.languages
                              .slice(
                                0,
                                3,
                              )
                              .map(
                                (
                                  language,
                                ) =>
                                  language.code,
                              )
                              .join(
                                ' · ',
                              )}
                          </span>
                        )}
                      </div>

                      <div className="home21-expert-footer">
                        <span>
                          {price
                            ? `${t.from} ${price}`
                            : t.free}
                        </span>

                        <a
                          href={href(
                            locale,
                            `experts/${expert.slug}`,
                          )}
                        >
                          {t.viewProfile}
                          <Arrow />
                        </a>
                      </div>
                    </article>
                  );
                },
              )}
          </div>
        )}
      </section>

      <section className="home21-section home21-events">
        <div className="home21-wrap">
          <SectionHead
            title={
              t.eventTitle
            }
            text={
              t.eventText
            }
            action={
              t.eventsCta
            }
            actionHref={href(
              locale,
              'events',
            )}
          />

          <div className="home21-event-empty">
            <div className="home21-event-art">
              <div className="home21-event-orbit orbit-one" />
              <div className="home21-event-orbit orbit-two" />

              <span>
                <Icon name="video" />
              </span>
            </div>

            <div className="home21-event-copy">
              <span className="home21-event-label">
                <Icon name="calendar" />
                {t.events}
              </span>

              <h3>
                {t.eventEmptyTitle}
              </h3>

              <p>
                {t.eventEmptyText}
              </p>

              <div className="home21-event-features">
                <span>
                  <Icon name="video" />
                  {t.eventLive}
                </span>

                <span>
                  <Icon name="comments" />
                  {t.eventQa}
                </span>

                <span>
                  <Icon name="mail" />
                  {t.eventChat}
                </span>
              </div>

              <a
                className="button secondary"
                href={href(
                  locale,
                  'events',
                )}
              >
                {t.eventsCta}
                <Arrow />
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="home21-section home21-wrap">
        <SectionHead
          title={
            t.insightsTitle
          }
          text={
            t.insightsText
          }
          action={
            t.read
          }
          actionHref={href(
            locale,
            'library',
          )}
        />

        <div className="home21-insight-categories">
          {insightCategories.map(
            (
              category,
            ) => (
              <a
                key={
                  category
                }
                href={href(
                  locale,
                  `library?category=${category}`,
                )}
              >
                {
                  t[
                    category
                  ]
                }
              </a>
            ),
          )}
        </div>

        <div className="home21-insight-grid">
          {insights.map(
            (
              article,
              index,
            ) => (
              <a
                key={
                  article.slug
                }
                className={`home21-insight-card insight-${index}`}
                href={href(
                  locale,
                  `library/${article.slug}`,
                )}
              >
                <div className="home21-insight-art">
                  <span>
                    <Icon name={article.icon} />
                  </span>
                </div>

                <div>
                  <small>
                    {article.minutes}{' '}
                    {t.minutes}
                  </small>

                  <h3>
                    {
                      t[
                        article.title
                      ]
                    }
                  </h3>

                  <span className="home21-text-link">
                    {t.read}
                    <Arrow />
                  </span>
                </div>
              </a>
            ),
          )}
        </div>
      </section>

      <section className="home21-wrap home21-final-wrap">
        <div className="home21-final">
          <div className="home21-final-orb orb-a" />
          <div className="home21-final-orb orb-b" />

          <div>
            <span className="home21-eyebrow light">
              ✦ {t.eyebrow}
            </span>

            <h2>
              {t.finalTitle}
            </h2>

            <p>
              {t.finalText}
            </p>
          </div>

          <div className="home21-final-actions">
            <a
              className="button home21-final-primary"
              href={href(
                locale,
                'experts',
              )}
            >
              {t.finalPrimary}
              <Arrow />
            </a>

            <a
              className="button secondary"
              href={href(
                locale,
                'questions',
              )}
            >
              {t.finalSecondary}
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
