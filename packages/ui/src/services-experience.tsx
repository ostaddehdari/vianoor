'use client';

import {
  servicesCopy,
} from './services-copy';

import {
  Icon,
  type IconName,
} from './icons';

import type {
  Locale,
} from './messages';

const base =
  process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const url = (
  locale: string,
  path: string,
) =>
  `${base}/${locale}/${path}`;

const cards = [
  {
    key:
      'consultation',
    icon:
      'video' as IconName,
    tone:
      'emerald',
    path:
      'consultation',
  },

  {
    key:
      'questions',
    icon:
      'comments' as IconName,
    tone:
      'violet',
    path:
      'questions',
  },

  {
    key:
      'events',
    icon:
      'calendar' as IconName,
    tone:
      'coral',
    path:
      'events',
  },

  {
    key:
      'helpline',
    icon:
      'phone' as IconName,
    tone:
      'gold',
    path:
      'services#talk-now',
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

export function ServicesExperience({
  locale,
}: {
  locale: Locale;
}) {
  const t =
    servicesCopy[locale]!;

  return (
    <section className="services21">
      <div className="services21-hero">
        <div className="services21-wrap">
          <span className="services21-eyebrow">
            ✦ {t.eyebrow}
          </span>

          <h1>
            {t.title}
          </h1>

          <p>
            {t.intro}
          </p>

          <div className="services21-hero-actions">
            <a
              className="button"
              href={url(
                locale,
                'consultation',
              )}
            >
              {t.experts}
              <Arrow />
            </a>

            <a
              className="button secondary"
              href={url(
                locale,
                'questions',
              )}
            >
              {t.questionsLink}
            </a>
          </div>
        </div>
      </div>

      <div className="services21-wrap services21-grid">
        {cards.map(
          (
            item,
            index,
          ) => {
            const key =
              item.key;

            const title =
              t[key];

            const lead =
              t[
                `${key}Lead` as
                  | 'consultationLead'
                  | 'questionsLead'
                  | 'eventsLead'
                  | 'helplineLead'
              ];

            const problem =
              t[
                `${key}Problem` as
                  | 'consultationProblem'
                  | 'questionsProblem'
                  | 'eventsProblem'
                  | 'helplineProblem'
              ];

            const audience =
              t[
                `${key}Audience` as
                  | 'consultationAudience'
                  | 'questionsAudience'
                  | 'eventsAudience'
                  | 'helplineAudience'
              ];

            const how =
              t[
                `${key}How` as
                  | 'consultationHow'
                  | 'questionsHow'
                  | 'eventsHow'
                  | 'helplineHow'
              ];

            const cost =
              t[
                `${key}Cost` as
                  | 'consultationCost'
                  | 'questionsCost'
                  | 'eventsCost'
                  | 'helplineCost'
              ];

            const cta =
              t[
                `${key}Start` as
                  | 'consultationStart'
                  | 'questionsStart'
                  | 'eventsStart'
                  | 'helplineStart'
              ];

            return (
              <article
                id={
                  key ===
                  'helpline'
                    ? 'talk-now'
                    : undefined
                }
                key={key}
                className={`services21-story tone-${item.tone}`}
              >
                <div className="services21-story-number">
                  {new Intl.NumberFormat(
                    locale,
                    {
                      minimumIntegerDigits:
                        2,
                    },
                  ).format(
                    index + 1,
                  )}
                </div>

                <div className="services21-story-intro">
                  <span className="services21-story-icon">
                    <Icon
                      name={
                        item.icon
                      }
                    />
                  </span>

                  <div>
                    <h2>
                      {title}
                    </h2>

                    <p>
                      {lead}
                    </p>
                  </div>
                </div>

                <div className="services21-story-details">
                  <div>
                    <strong>
                      {t.solves}
                    </strong>

                    <p>
                      {problem}
                    </p>
                  </div>

                  <div>
                    <strong>
                      {t.suitable}
                    </strong>

                    <p>
                      {audience}
                    </p>
                  </div>

                  <div>
                    <strong>
                      {t.how}
                    </strong>

                    <p>
                      {how}
                    </p>
                  </div>

                  <div>
                    <strong>
                      {t.cost}
                    </strong>

                    <p>
                      {cost}
                    </p>
                  </div>

                  <div>
                    <strong>
                      {t.languages}
                    </strong>

                    <p>
                      {t.languageText}
                    </p>
                  </div>
                </div>

                <a
                  href={url(
                    locale,
                    item.path,
                  )}
                  className="services21-story-cta"
                >
                  {cta}
                  <Arrow />
                </a>
              </article>
            );
          },
        )}
      </div>

      <div className="services21-wrap services21-faq">
        <h2>
          {t.faq}
        </h2>

        {[
          [
            t.faq1,
            t.faq1a,
          ],
          [
            t.faq2,
            t.faq2a,
          ],
          [
            t.faq3,
            t.faq3a,
          ],
        ].map(
          (
            item,
          ) => (
            <details
              key={
                item[0]
              }
            >
              <summary>
                {item[0]}
                <Icon name="down" />
              </summary>

              <p>
                {item[1]}
              </p>
            </details>
          ),
        )}
      </div>
    </section>
  );
}
