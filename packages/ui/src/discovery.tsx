'use client';

import {
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  userApi,
  usersBase,
} from './users-client';

import {
  discoveryCopy,
} from './discovery-copy';

import {
  Icon,
} from './icons';

import {
  languageValue,
} from './localization-runtime';

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
    [key: string]: string | undefined;
  };

  active: boolean;
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

type Result = {
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
      [key: string]: string | undefined;
    };
  }[];

  languages: {
    code: string;
    level: string;
  }[];

  services: Service[];
};

type SearchResponse = {
  items: Result[];
  next_offset: number | null;
};

type Availability = {
  expert_code: string;

  earliest: {
    service_id: string;
    start_at: string;
    end_at: string;
  } | null;

  available_today: boolean;
};

type Rating = {
  expert_code: string;
  average: number | null;
  count: number;
};

type Presence = {
  expert_code: string;

  state:
    | 'ONLINE'
    | 'AWAY'
    | 'OFFLINE';
};

type Sort =
  | 'recommended'
  | 'earliest'
  | 'rating'
  | 'price';

const initials = (
  value: string,
) =>
  value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(
      (part) =>
        part[0] ?? '',
    )
    .join('')
    .toUpperCase();

function minimumPrice(
  item: Result,
) {
  const values =
    item.services
      .map(
        (service) => ({
          amount:
            service.price_minor,

          currency:
            service.currency,
        }),
      )
      .filter(
        (value) =>
          Number.isFinite(
            value.amount,
          ),
      )
      .sort(
        (a, b) =>
          a.amount -
          b.amount,
      );

  return (
    values[0] ??
    null
  );
}

function money(
  locale: string,
  amount: number,
  currency: string,
) {
  try {
    return new Intl.NumberFormat(
      locale,
      {
        style:
          'currency',

        currency:
          currency ||
          'USD',

        maximumFractionDigits:
          2,
      },
    ).format(
      amount /
        (
          [
            'USD',
            'EUR',
            'GBP',
            'CAD',
            'AUD',
          ].includes(
            currency,
          )
            ? 100
            : 1
        ),
    );
  } catch {
    return (
      `${amount} ${currency}`
    );
  }
}

export function ExpertDiscovery({
  locale,
}: {
  locale: string;
}) {
  const t =
    discoveryCopy[locale]!;

  const [
    languages,
    setLanguages,
  ] = useState<Language[]>([]);

  const [
    taxonomy,
    setTaxonomy,
  ] = useState<Taxon[]>([]);

  const [
    query,
    setQuery,
  ] = useState('');

  const [
    spoken,
    setSpoken,
  ] = useState('');

  const [
    specialty,
    setSpecialty,
  ] = useState('');

  const [
    topic,
    setTopic,
  ] = useState('');

  const [
    maxPrice,
    setMaxPrice,
  ] = useState('');

  const [
    onlineOnly,
    setOnlineOnly,
  ] = useState(false);

  const [
    todayOnly,
    setTodayOnly,
  ] = useState(false);

  const [
    minimumRating,
    setMinimumRating,
  ] = useState('');

  const [
    sort,
    setSort,
  ] = useState<Sort>(
    'recommended',
  );

  const [
    timezone,
    setTimezone,
  ] = useState('UTC');

  const [
    items,
    setItems,
  ] = useState<Result[]>([]);

  const [
    next,
    setNext,
  ] = useState<
    number | null
  >(null);

  const [
    availability,
    setAvailability,
  ] = useState<
    Record<string, Availability>
  >({});

  const [
    ratings,
    setRatings,
  ] = useState<
    Record<string, Rating>
  >({});

  const [
    presence,
    setPresence,
  ] = useState<
    Record<string, Presence>
  >({});

  const [
    busy,
    setBusy,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState('');

  useEffect(() => {
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

    setQuery(
      params.get('q') ??
        '',
    );

    setSpoken(
      params.get(
        'spoken_language',
      ) ??
        '',
    );

    setSpecialty(
      params.get(
        'specialty',
      ) ??
        '',
    );

    setTopic(
      params.get(
        'topic',
      ) ??
        '',
    );

    void Promise.all([
      userApi<Language[]>(
        'languages',
      ),

      userApi<Taxon[]>(
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
        },
      )
      .catch(
        () => {
          setError(
            t.error,
          );
        },
      );

    void load(
      0,
      params,
    );
  }, [
    locale,
  ]);

  async function enrich(
    rows: Result[],
  ) {
    const codes =
      rows
        .map(
          (item) =>
            item.code,
        )
        .slice(
          0,
          50,
        );

    if (!codes.length) {
      setAvailability(
        {},
      );

      setRatings(
        {},
      );

      setPresence(
        {},
      );

      return;
    }

    const joined =
      codes.join(',');

    const [
      availabilityResult,
      ratingResult,
      presenceResult,
    ] =
      await Promise.allSettled([
        userApi<
          Availability[]
        >(
          'availability/public?' +
            new URLSearchParams({
              experts:
                joined,

              timezone,

              days:
                '7',
            }),
        ),

        userApi<
          Rating[]
        >(
          'ratings/public?' +
            new URLSearchParams({
              experts:
                joined,
            }),
        ),

        userApi<
          Presence[]
        >(
          'presence/public?' +
            new URLSearchParams({
              experts:
                joined,
            }),
        ),
      ]);

    if (
      availabilityResult.status ===
      'fulfilled'
    )
      setAvailability(
        Object.fromEntries(
          availabilityResult.value.map(
            (item) => [
              item.expert_code,
              item,
            ],
          ),
        ),
      );

    if (
      ratingResult.status ===
      'fulfilled'
    )
      setRatings(
        Object.fromEntries(
          ratingResult.value.map(
            (item) => [
              item.expert_code,
              item,
            ],
          ),
        ),
      );

    if (
      presenceResult.status ===
      'fulfilled'
    )
      setPresence(
        Object.fromEntries(
          presenceResult.value.map(
            (item) => [
              item.expert_code,
              item,
            ],
          ),
        ),
      );
  }

  async function load(
    offset = 0,
    initial?: URLSearchParams,
  ) {
    setBusy(
      true,
    );

    setError(
      '',
    );

    try {
      const initialQuery =
        initial?.get('q') ??
        query;

      const initialSpoken =
        initial?.get(
          'spoken_language',
        ) ??
        spoken;

      const initialSpecialty =
        initial?.get(
          'specialty',
        ) ??
        specialty;

      const params =
        new URLSearchParams({
          q:
            initialQuery,

          language:
            locale,

          offset:
            String(
              offset,
            ),

          limit:
            '50',

          ...(
            initialSpoken
              ? {
                  spoken_language:
                    initialSpoken,
                }
              : {}
          ),

          ...(
            initialSpecialty
              ? {
                  specialty:
                    initialSpecialty,
                }
              : {}
          ),
        });

      const response =
        await userApi<SearchResponse>(
          'search/experts?' +
            params,
        );

      setItems(
        response.items,
      );

      setNext(
        response.next_offset,
      );

      await enrich(
        response.items,
      );
    } catch (
      exception
    ) {
      setError(
        `${
          t.error
        } (${
          (
            exception as Error
          ).message
        })`,
      );
    } finally {
      setBusy(
        false,
      );
    }
  }

  const specialties =
    taxonomy
      .filter(
        (item) =>
          item.active &&
          item.kind ===
            'specialty',
      );

  const topics =
    taxonomy
      .filter(
        (item) =>
          item.active &&
          item.kind ===
            'category',
      );

  const filtered =
    useMemo(
      () => {
        const priceLimit =
          maxPrice
            ? Number(
                maxPrice,
              )
            : null;

        const ratingLimit =
          minimumRating
            ? Number(
                minimumRating,
              )
            : null;

        let result =
          items.filter(
            (item) => {
              if (
                topic &&
                !item.services.some(
                  (service) =>
                    service.category_id ===
                    topic,
                )
              )
                return false;

              if (
                priceLimit !==
                null
              ) {
                const price =
                  minimumPrice(
                    item,
                  );

                if (
                  !price ||
                  price.amount >
                    priceLimit
                )
                  return false;
              }

              if (
                onlineOnly &&
                presence[
                  item.code
                ]?.state !==
                  'ONLINE'
              )
                return false;

              if (
                todayOnly &&
                !availability[
                  item.code
                ]
                  ?.available_today
              )
                return false;

              if (
                ratingLimit !==
                null &&
                (
                  ratings[
                    item.code
                  ]?.average ??
                  0
                ) <
                  ratingLimit
              )
                return false;

              return true;
            },
          );

        result =
          [...result];

        if (
          sort ===
          'rating'
        ) {
          result.sort(
            (
              a,
              b,
            ) =>
              (
                ratings[
                  b.code
                ]?.average ??
                -1
              ) -
              (
                ratings[
                  a.code
                ]?.average ??
                -1
              ),
          );
        }

        if (
          sort ===
          'price'
        ) {
          result.sort(
            (
              a,
              b,
            ) =>
              (
                minimumPrice(
                  a,
                )?.amount ??
                Number.MAX_SAFE_INTEGER
              ) -
              (
                minimumPrice(
                  b,
                )?.amount ??
                Number.MAX_SAFE_INTEGER
              ),
          );
        }

        if (
          sort ===
          'earliest'
        ) {
          result.sort(
            (
              a,
              b,
            ) => {
              const av =
                availability[
                  a.code
                ]?.earliest
                  ?.start_at;

              const bv =
                availability[
                  b.code
                ]?.earliest
                  ?.start_at;

              if (
                !av &&
                !bv
              )
                return 0;

              if (!av)
                return 1;

              if (!bv)
                return -1;

              return (
                Date.parse(
                  av,
                ) -
                Date.parse(
                  bv,
                )
              );
            },
          );
        }

        return result;
      },
      [
        items,
        topic,
        maxPrice,
        onlineOnly,
        todayOnly,
        minimumRating,
        sort,
        availability,
        ratings,
        presence,
      ],
    );

  return (
    <main
      id="main"
      tabIndex={-1}
      className="expert21"
    >
      <section className="expert21-hero">
        <div className="expert21-wrap">
          <span className="expert21-eyebrow">
            ✦ {t.discoveryEyebrow}
          </span>

          <h1>
            {t.title}
          </h1>

          <p>
            {t.discoveryIntro}
          </p>

          <div className="expert21-search">
            <Icon name="search" />

            <input
              value={
                query
              }
              maxLength={
                300
              }
              placeholder={
                t.intent
              }
              aria-label={
                t.intent
              }
              onChange={(
                event,
              ) =>
                setQuery(
                  event
                    .target
                    .value,
                )
              }
            />

            <button
              type="button"
              className="button"
              disabled={
                busy
              }
              onClick={() =>
                void load(
                  0,
                )
              }
            >
              {busy
                ? t.busy
                : t.search}
            </button>
          </div>
        </div>
      </section>

      <section className="expert21-wrap expert21-layout">
        <aside className="expert21-filters">
          <div className="expert21-filter-head">
            <strong>
              {t.filters}
            </strong>

            <button
              type="button"
              onClick={() => {
                setSpoken('');
                setSpecialty('');
                setTopic('');
                setMaxPrice('');
                setOnlineOnly(false);
                setTodayOnly(false);
                setMinimumRating('');
                setSort(
                  'recommended',
                );
              }}
            >
              {t.clearFilters}
            </button>
          </div>

          <label>
            <span>
              <Icon name="globe" />
              {t.spoken}
            </span>

            <select
              value={
                spoken
              }
              onChange={(
                event,
              ) =>
                setSpoken(
                  event
                    .target
                    .value,
                )
              }
            >
              <option value="">
                {t.any}
              </option>

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
              <Icon name="book" />
              {t.specialty}
            </span>

            <select
              value={
                specialty
              }
              onChange={(
                event,
              ) =>
                setSpecialty(
                  event
                    .target
                    .value,
                )
              }
            >
              <option value="">
                {t.all}
              </option>

              {specialties.map(
                (
                  item,
                ) => (
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
              <Icon name="heart" />
              {t.topic}
            </span>

            <select
              value={
                topic
              }
              onChange={(
                event,
              ) =>
                setTopic(
                  event
                    .target
                    .value,
                )
              }
            >
              <option value="">
                {t.all}
              </option>

              {topics.map(
                (
                  item,
                ) => (
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
              <Icon name="wallet" />
              {t.maxPrice}
            </span>

            <input
              type="number"
              min="0"
              value={
                maxPrice
              }
              placeholder={
                t.anyPrice
              }
              onChange={(
                event,
              ) =>
                setMaxPrice(
                  event
                    .target
                    .value,
                )
              }
            />
          </label>

          <label>
            <span>
              <Icon name="star" />
              {t.minimumRating}
            </span>

            <select
              value={
                minimumRating
              }
              onChange={(
                event,
              ) =>
                setMinimumRating(
                  event
                    .target
                    .value,
                )
              }
            >
              <option value="">
                {t.anyRating}
              </option>

              <option value="4">
                4+
              </option>

              <option value="4.5">
                4.5+
              </option>

              <option value="4.8">
                4.8+
              </option>
            </select>
          </label>

          <label className="expert21-check">
            <input
              type="checkbox"
              checked={
                onlineOnly
              }
              onChange={(
                event,
              ) =>
                setOnlineOnly(
                  event
                    .target
                    .checked,
                )
              }
            />

            <span>
              {t.onlineNow}
            </span>
          </label>

          <label className="expert21-check">
            <input
              type="checkbox"
              checked={
                todayOnly
              }
              onChange={(
                event,
              ) =>
                setTodayOnly(
                  event
                    .target
                    .checked,
                )
              }
            />

            <span>
              {t.availableToday}
            </span>
          </label>

          <button
            type="button"
            className="button expert21-filter-submit"
            disabled={
              busy
            }
            onClick={() =>
              void load(
                0,
              )
            }
          >
            {t.applyFilters}
          </button>
        </aside>

        <div className="expert21-results">
          <div className="expert21-results-head">
            <div>
              <strong>
                {new Intl.NumberFormat(
                  locale,
                ).format(
                  filtered.length,
                )}{' '}
                {t.expertsFound}
              </strong>

              <small>
                {t.gridFirst}
              </small>
            </div>

            <label>
              {t.sort}

              <select
                value={
                  sort
                }
                onChange={(
                  event,
                ) =>
                  setSort(
                    event
                      .target
                      .value as Sort,
                  )
                }
              >
                <option value="recommended">
                  {t.recommended}
                </option>

                <option value="earliest">
                  {t.earliest}
                </option>

                <option value="rating">
                  {t.rating}
                </option>

                <option value="price">
                  {t.price}
                </option>
              </select>
            </label>
          </div>

          {error && (
            <p
              role="alert"
              className="expert21-error"
            >
              {error}
            </p>
          )}

          {!busy &&
            !error &&
            !filtered.length && (
              <div className="expert21-empty">
                <Icon name="search" />

                <strong>
                  {t.empty}
                </strong>

                <p>
                  {t.emptyHint}
                </p>
              </div>
            )}

          <div className="expert21-grid">
            {filtered.map(
              (
                item,
                index,
              ) => {
                const name =
                  item.profile
                    .display_name ||
                  item.profile
                    .title ||
                  item.slug;

                const currentPresence =
                  presence[
                    item.code
                  ]?.state ??
                  'OFFLINE';

                const rating =
                  ratings[
                    item.code
                  ];

                const slot =
                  availability[
                    item.code
                  ];

                const price =
                  minimumPrice(
                    item,
                  );

                return (
                  <article
                    key={
                      item.code
                    }
                    className={`expert21-card tone-${index % 4}`}
                  >
                    <div className="expert21-card-top">
                      <div className="expert21-avatar">
                        {initials(
                          name,
                        )}
                      </div>

                      <span
                        className={`expert21-presence state-${currentPresence.toLowerCase()}`}
                      >
                        <i />

                        {currentPresence ===
                        'ONLINE'
                          ? t.online
                          : currentPresence ===
                              'AWAY'
                            ? t.away
                            : t.offline}
                      </span>
                    </div>

                    <h2>
                      {name}
                    </h2>

                    <p className="expert21-title">
                      {item.profile
                        .title ??
                        ''}
                    </p>

                    <p className="expert21-bio">
                      {item.profile
                        .short_bio ??
                        ''}
                    </p>

                    <div className="expert21-rating">
                      <Icon name="star" />

                      {rating?.average
                        ? (
                            <>
                              <strong>
                                {rating.average.toFixed(
                                  1,
                                )}
                              </strong>

                              <span>
                                (
                                {rating.count}
                                )
                              </span>
                            </>
                          )
                        : (
                            <span>
                              {t.noRatings}
                            </span>
                          )}
                    </div>

                    {!!item.specialties.length && (
                      <div className="expert21-tags">
                        {item.specialties
                          .slice(
                            0,
                            3,
                          )
                          .map(
                            (
                              current,
                            ) => (
                              <span
                                key={
                                  current.id
                                }
                              >
                                {languageValue(
                                  current.label,
                                  locale,
                                )}
                              </span>
                            ),
                          )}
                      </div>
                    )}

                    <div className="expert21-info">
                      <span>
                        <Icon name="globe" />

                        {item.languages.length
                          ? item.languages
                              .slice(
                                0,
                                4,
                              )
                              .map(
                                (
                                  language,
                                ) =>
                                  languages.find(
                                    (
                                      candidate,
                                    ) =>
                                      candidate.code ===
                                      language.code,
                                  )
                                    ?.native_name ??
                                  language.code,
                              )
                              .join(
                                ' · ',
                              )
                          : '—'}
                      </span>

                      <span>
                        <Icon name="wallet" />

                        {price
                          ? `${t.from} ${money(
                              locale,
                              price.amount,
                              price.currency,
                            )}`
                          : t.priceUnavailable}
                      </span>

                      <span>
                        <Icon name="clock" />

                        {slot?.earliest
                          ? new Intl.DateTimeFormat(
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
                                slot
                                  .earliest
                                  .start_at,
                              ),
                            )
                          : t.noAvailability}
                      </span>
                    </div>

                    {slot?.available_today && (
                      <div className="expert21-today">
                        <Icon name="check" />
                        {t.availableToday}
                      </div>
                    )}

                    <div className="expert21-card-actions">
                      <a
                        className="button secondary compact"
                        href={`${usersBase}/${locale}/experts/${item.slug}`}
                      >
                        {t.viewProfile}
                      </a>

                      {slot?.earliest ? (
                        <a
                          className="button compact"
                          href={`${usersBase}/${locale}/account/book?expert=${item.code}&service=${slot.earliest.service_id}&start=${encodeURIComponent(
                            slot
                              .earliest
                              .start_at,
                          )}`}
                        >
                          {t.book}
                        </a>
                      ) : (
                        <a
                          className="button compact"
                          href={`${usersBase}/${locale}/experts/${item.slug}`}
                        >
                          {t.viewTimes}
                        </a>
                      )}
                    </div>
                  </article>
                );
              },
            )}
          </div>

          {next !==
            null && (
            <button
              type="button"
              className="button secondary expert21-more"
              disabled={
                busy
              }
              onClick={() =>
                void load(
                  next,
                )
              }
            >
              {t.next}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
