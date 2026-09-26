'use client';
import { useState, useRef, useEffect, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';
import { copy, roles, publicPages, sectionNames, rolePath, routeInfo } from './routing';
import registry from './page-registry.json';
import type { Locale } from './messages';

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const url = (locale: Locale, path = '') => `${base}/${locale}${path ? '/' + path : ''}`;
const numbers = (locale: Locale, n: number) => new Intl.NumberFormat(locale).format(n);
const experts = [
  {
    id: 'mina',
    initials: { fa: 'م ر', en: 'MR' },
    name: { fa: 'مینا رضایی', en: 'Mina Rezaei' },
    topic: 'family',
    color: 'rose',
  },
  {
    id: 'ali',
    initials: { fa: 'ع ن', en: 'AN' },
    name: { fa: 'علی نوری', en: 'Ali Nouri' },
    topic: 'faith',
    color: 'sage',
  },
  {
    id: 'sara',
    initials: { fa: 'س م', en: 'SM' },
    name: { fa: 'سارا مهر', en: 'Sara Mehr' },
    topic: 'parenting',
    color: 'sand',
  },
] as const;
const topics = ['family', 'faith', 'parenting', 'growth'] as const;
const topicIcons: IconName[] = ['heart', 'book', 'leaf', 'sparkles'];
function Brand({ locale }: { locale: Locale }) {
  return (
    <a className="brand" href={url(locale)}>
      <span className="brand-mark" aria-hidden="true">
        ✺
      </span>
      <span>
        {copy[locale].brand}
        <small>{copy[locale].tagline}</small>
      </span>
    </a>
  );
}
function Arrow() {
  return <Icon name="arrow" className="direction-icon" />;
}
function ButtonLink({
  locale,
  path,
  children,
  secondary = false,
}: {
  locale: Locale;
  path: string;
  children: ReactNode;
  secondary?: boolean;
}) {
  return (
    <a className={`button ${secondary ? 'secondary' : ''}`} href={url(locale, path)}>
      {children}
      <Arrow />
    </a>
  );
}
function Preview({ locale }: { locale: Locale }) {
  return (
    <div className="preview-note">
      <span className="status-dot" />
      {copy[locale].demo}
    </div>
  );
}
function Ornament() {
  return (
    <div className="ornament" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}
function Modal({
  locale,
  title,
  onClose,
  children,
}: {
  locale: Locale;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    d?.showModal();
    return () => {
      d?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-labelledby="modal-title"
    >
      <div className="modal-inner">
        <button
          className="icon-button modal-close"
          aria-label={copy[locale].close}
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
        <span className="icon-tile">
          <Icon name="leaf" />
        </span>
        <h2 id="modal-title">{title}</h2>
        {children}
        <button className="button" onClick={onClose}>
          {copy[locale].continue}
          <Icon name="check" />
        </button>
      </div>
    </dialog>
  );
}
function Header({ locale, path }: { locale: Locale; path: string }) {
  const t = copy[locale];
  const [open, setOpen] = useState(false);
  const nav = [
    ['', 'home'],
    ['experts', 'experts'],
    ['services', 'services'],
    ['library', 'library'],
    ['events', 'events'],
  ] as const;
  return (
    <>
      <div className="topline">
        <span>
          <Icon name="leaf" />
          {t.tagline}
        </span>
        <a href={url(locale, 'dashboards')}>
          {t.dashboards}
          <Arrow />
        </a>
      </div>
      <header className="site-header">
        <Brand locale={locale} />
        <nav className="desktop-nav" aria-label={t.navLabel}>
          {nav.map(([p, k]) => (
            <a
              key={p}
              className={path === p ? 'active' : ''}
              aria-current={path === p ? 'page' : undefined}
              href={url(locale, p)}
            >
              {t[k]}
            </a>
          ))}
        </nav>
        <div className="header-actions">
          <a
            className="language"
            href={url(locale === 'fa' ? 'en' : 'fa', path)}
            lang={locale === 'fa' ? 'en' : 'fa'}
          >
            <Icon name="globe" />
            {t.language}
          </a>
          <a className="button compact login-link" href={url(locale, 'auth/login')}>
            <Icon name="user" />
            {t.login}
          </a>
          <button
            className="icon-button mobile-menu"
            aria-expanded={open}
            aria-controls="mobile-navigation"
            aria-label={t.menu}
            onClick={() => setOpen(!open)}
          >
            <Icon name={open ? 'close' : 'menu'} />
          </button>
        </div>
      </header>
      {open && (
        <nav
          id="mobile-navigation"
          className="mobile-navigation"
          aria-label={t.navLabel}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
        >
          {nav.map(([p, k]) => (
            <a key={p} href={url(locale, p)}>
              {t[k]}
              <Arrow />
            </a>
          ))}
          <a href={url(locale, 'dashboards')}>
            {t.dashboards}
            <Icon name="grid" />
          </a>
          <a href={url(locale, 'auth/login')}>
            {t.login}
            <Icon name="user" />
          </a>
        </nav>
      )}
    </>
  );
}
function Footer({ locale }: { locale: Locale }) {
  const t = copy[locale];
  return (
    <footer className="site-footer">
      <div className="footer-grid">
        <div>
          <Brand locale={locale} />
          <p>{t.footerText}</p>
          <div className="footer-symbols">
            <Icon name="leaf" />
            <Icon name="book" />
            <Icon name="comments" />
          </div>
        </div>
        <div>
          <h3>{t.links}</h3>
          {[
            ['experts', t.experts],
            ['services', t.services],
            ['about', t.about],
            ['dashboards', t.dashboards],
          ].map(([p, title]) => (
            <a href={url(locale, p)} key={p}>
              {title}
            </a>
          ))}
        </div>
        <div>
          <h3>{t.help}</h3>
          {[
            ['help', t.help],
            ['faq', t.faq],
            ['contact', t.contact],
            ['policies/privacy', t.privacy],
            ['policies/terms', t.terms],
          ].map(([p, title]) => (
            <a href={url(locale, p)} key={p}>
              {title}
            </a>
          ))}
        </div>
        <div className="footer-note">
          <Icon name="sparkles" />
          <h3>{t.wellbeing}</h3>
          <p>{t.wellbeingText}</p>
          <Preview locale={locale} />
        </div>
      </div>
      <div className="footer-bottom">
        <span>{t.copyright}</span>
        <span>FA / EN</span>
      </div>
    </footer>
  );
}
function SectionTitle({
  locale,
  title,
  subtitle,
  path,
}: {
  locale: Locale;
  title: string;
  subtitle?: string;
  path?: string;
}) {
  return (
    <div className="section-title">
      <div>
        <span className="section-stroke" />
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {path && (
        <a className="text-link" href={url(locale, path)}>
          {copy[locale].viewAll}
          <Arrow />
        </a>
      )}
    </div>
  );
}
function ExpertCard({ locale, expert }: { locale: Locale; expert: (typeof experts)[number] }) {
  const t = copy[locale];
  return (
    <article className="expert-card">
      <div className={`expert-cover ${expert.color}`}>
        <span className="cover-lines" />
        <span className="sample-tag">{t.sampleExpert}</span>
        <div className={`avatar large ${expert.color}`}>{expert.initials[locale]}</div>
      </div>
      <div className="expert-body">
        <h3>{expert.name[locale]}</h3>
        <p>{t[expert.topic]}</p>
        <div className="expert-meta">
          <span>
            <Icon name="video" />
            {t.online}
          </span>
          <span>
            <Icon name="globe" />
            {locale === 'fa' ? 'فارسی' : 'Persian'}
          </span>
        </div>
        <a className="expert-link" href={url(locale, `experts/${expert.id}`)}>
          {t.profile}
          <Arrow />
        </a>
      </div>
    </article>
  );
}
function Articles({ locale }: { locale: Locale }) {
  const t = copy[locale];
  return (
    <div className="article-grid">
      {(['listening', 'better-questions', 'small-steps'] as const).map((slug, i) => (
        <a className="article-card" href={url(locale, `library/${slug}`)} key={slug}>
          <div className={`article-art art-${i}`}>
            <div className="art-circle" />
            <Icon name={(['comments', 'book', 'leaf'] as IconName[])[i]!} />
            <span className="sample-tag">{t.preview}</span>
          </div>
          <div className="article-copy">
            <span className="muted small">
              {t[topics[i]!]} · {numbers(locale, 4 + i)} {t.minutes}
            </span>
            <h3>{t[(['article1', 'article2', 'article3'] as const)[i]!]}</h3>
            <span className="text-link">
              {t.readMore}
              <Arrow />
            </span>
          </div>
        </a>
      ))}
    </div>
  );
}
function Home({ locale }: { locale: Locale }) {
  const t = copy[locale];
  return (
    <>
      <section className="home-hero wrap">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="tiny-star">✦</span>
            {t.eyebrow}
          </div>
          <h1>
            {t.hero1}
            <br />
            <em>{t.hero2}</em>
          </h1>
          <p>{t.intro}</p>
          <div className="button-row">
            <ButtonLink locale={locale} path="experts">
              {t.findExpert}
            </ButtonLink>
            <ButtonLink locale={locale} path="questions" secondary>
              {t.ask}
            </ButtonLink>
          </div>
          <div className="hero-assurance">
            <span className="mini-seal">
              <Icon name="shield" />
            </span>
            <span>
              {t.trust1}
              <small>{t.trustText}</small>
            </span>
          </div>
        </div>
        <div className="hero-visual">
          <div className="arch-scene">
            <Ornament />
            <span className="hero-star star-one" aria-hidden="true">
              ✦
            </span>
            <span className="hero-star star-two" aria-hidden="true">
              ✧
            </span>
            <div className="book-sculpture">
              <div />
              <div />
              <span />
            </div>
            <div className="quote-panel">
              <Icon name="leaf" />
              <p>{t.quote}</p>
              <small>{t.quoteSource}</small>
            </div>
          </div>
          <div className="floating-card">
            <span className="icon-tile">
              <Icon name="comments" />
            </span>
            <div>
              <strong>{t.online}</strong>
              <small>{t.trust3}</small>
            </div>
            <span className="float-check">
              <Icon name="check" />
            </span>
          </div>
          <div className="floating-pill">
            <Icon name="heart" />
            {t.trust2}
          </div>
        </div>
      </section>
      <div className="wrap">
        <div className="trust-strip">
          {(['trust1', 'trust2', 'trust3'] as const).map((k, i) => (
            <div key={k}>
              <span className="icon-tile">
                <Icon name={(['shield', 'leaf', 'globe'] as IconName[])[i]!} />
              </span>
              <span>
                <strong>{t[k]}</strong>
                <small>{t.trustText}</small>
              </span>
            </div>
          ))}
        </div>
      </div>
      <section className="section wrap">
        <SectionTitle
          locale={locale}
          title={t.specialties}
          subtitle={t.specialtiesIntro}
          path="topics"
        />
        <div className="topics-grid">
          {topics.map((topic, i) => (
            <a className="topic-card" key={topic} href={url(locale, `topics/${topic}`)}>
              <span className={`topic-icon tone-${i}`}>
                <Icon name={topicIcons[i]!} />
              </span>
              <h3>{t[topic]}</h3>
              <span>
                {t.explore}
                <Arrow />
              </span>
            </a>
          ))}
        </div>
      </section>
      <section className="section soft-section">
        <div className="wrap">
          <SectionTitle
            locale={locale}
            title={t.expertsTitle}
            subtitle={t.expertsIntro}
            path="experts"
          />
          <div className="expert-grid">
            {experts.map((e) => (
              <ExpertCard key={e.id} locale={locale} expert={e} />
            ))}
          </div>
        </div>
      </section>
      <section className="section wrap">
        <SectionTitle locale={locale} title={t.journey} />
        <div className="journey-grid">
          {([1, 2, 3] as const).map((n, i) => (
            <article key={n}>
              <span className="step-number">
                {numbers(locale, n).padStart(2, locale === 'fa' ? '۰' : '0')}
              </span>
              <div>
                <h3>{t[(['step1', 'step2', 'step3'] as const)[i]!]}</h3>
                <p>{t[(['step1Text', 'step2Text', 'step3Text'] as const)[i]!]}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="section wrap">
        <SectionTitle locale={locale} title={t.reading} path="library" />
        <Articles locale={locale} />
      </section>
      <section className="wrap">
        <div className="cta-panel">
          <Ornament />
          <div>
            <span className="eyebrow light">{t.tagline}</span>
            <h2>{t.cta}</h2>
            <p>{t.ctaText}</p>
          </div>
          <ButtonLink locale={locale} path="topics" secondary>
            {t.viewTopics}
          </ButtonLink>
        </div>
      </section>
    </>
  );
}
function Gallery({ locale }: { locale: Locale }) {
  const t = copy[locale];
  return (
    <section className="wrap section">
      <div className="page-heading">
        <Preview locale={locale} />
        <h1>{t.dashboards}</h1>
        <p>{t.roleIntro}</p>
      </div>
      <div className="role-grid">
        {roles.map((role, i) => (
          <a className="role-card" href={url(locale, `preview/${role.id}`)} key={role.id}>
            <div className="role-card-top">
              <span className={`icon-tile tone-${i % 4}`}>
                <Icon name={role.icon} />
              </span>
              <span className="muted">
                {numbers(locale, i + 1).padStart(2, locale === 'fa' ? '۰' : '0')}
              </span>
            </div>
            <h2>{role.title[locale]}</h2>
            <p>{role.headline[locale]}</p>
            <span className="text-link">
              {t.viewDashboard}
              <Arrow />
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}
function ExpertDirectory({ locale }: { locale: Locale }) {
  const t = copy[locale];
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState('all');
  const filtered = experts.filter(
    (e) =>
      (topic === 'all' || e.topic === topic) &&
      `${e.name[locale]} ${t[e.topic]}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="filter-bar">
        <label className="search-field">
          <Icon name="search" />
          <input
            aria-label={t.searchExperts}
            placeholder={t.searchExperts}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="select-label">
          <Icon name="filter" />
          <select aria-label={t.filters} value={topic} onChange={(e) => setTopic(e.target.value)}>
            <option value="all">{t.all}</option>
            {topics.map((k) => (
              <option key={k} value={k}>
                {t[k]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted small" role="status">
        {numbers(locale, filtered.length)} {t.sampleExpert}
      </p>
      {filtered.length ? (
        <div className="expert-grid">
          {filtered.map((e) => (
            <ExpertCard key={e.id} locale={locale} expert={e} />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <Icon name="search" />
          <h2>{t.empty}</h2>
          <p>{t.emptyHint}</p>
          <button
            className="button secondary"
            onClick={() => {
              setQuery('');
              setTopic('all');
            }}
          >
            {t.clear}
          </button>
        </div>
      )}
    </>
  );
}
function FAQ({ locale }: { locale: Locale }) {
  const t = copy[locale];
  return (
    <div className="faq-list">
      {([1, 2, 3] as const).map((n, i) => (
        <details key={n}>
          <summary>
            {t[(['faq1', 'faq2', 'faq3'] as const)[i]!]}
            <Icon name="down" />
          </summary>
          <p>{t[(['faq1Answer', 'faq2Answer', 'faq3Answer'] as const)[i]!]}</p>
        </details>
      ))}
    </div>
  );
}
function PublicPage({ locale, path }: { locale: Locale; path: string }) {
  const t = copy[locale];
  const root = path.split('/')[0]!;
  const slug = path.split('/')[1];
  const [modal, setModal] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const expert = experts.find((e) => e.id === slug);
  const title =
    root === 'policies'
      ? slug === 'privacy'
        ? t.privacy
        : t.terms
      : root === 'auth'
        ? t.login
        : (publicPages.find((p) => p.path === root)?.title[locale] ?? t.library);
  return (
    <section className="wrap section public-page">
      <nav className="breadcrumbs" aria-label={t.navLabel}>
        <a href={url(locale)}>{t.home}</a>
        <Icon name="chevron" />
        <span>{title}</span>
      </nav>
      <div className="page-heading">
        <Preview locale={locale} />
        <h1>{root === 'experts' && expert ? expert.name[locale] : title}</h1>
        <p>
          {root === 'experts'
            ? t.expertsIntro
            : root === 'contact'
              ? t.contactText
              : root === 'auth'
                ? t.authText
                : root === 'policies'
                  ? t.policyText
                  : root === 'about'
                    ? t.aboutText
                    : t.specialtiesIntro}
        </p>
      </div>
      {root === 'experts' && !slug ? (
        <ExpertDirectory locale={locale} />
      ) : root === 'experts' && expert ? (
        <div className="profile-layout">
          <article className="panel profile-summary">
            <div className={`avatar extra ${expert.color}`}>{expert.initials[locale]}</div>
            <h2>{expert.name[locale]}</h2>
            <p>{t[expert.topic]}</p>
            <span className="badge">{t.sampleExpert}</span>
          </article>
          <article className="panel">
            <h2>{t.approach}</h2>
            <p>{t.expertBio}</p>
            <h3>{t.available}</h3>
            <div className="button-row">
              {['10:00', '14:30', '17:00'].map((time) => (
                <button
                  className="button secondary"
                  onClick={() => setModal(`${t.available} · ${time}`)}
                  key={time}
                >
                  <Icon name="clock" />
                  {time}
                </button>
              ))}
            </div>
          </article>
        </div>
      ) : ['faq', 'help'].includes(root) ? (
        <FAQ locale={locale} />
      ) : root === 'search' ? (
        <>
          <label className="search-field wide">
            <Icon name="search" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={t.search}
              placeholder={t.searchHint}
            />
          </label>
          <div className="role-grid search-results">
            {publicPages
              .filter((p) => p.title[locale].toLowerCase().includes(query.toLowerCase()))
              .map((p) => (
                <a className="panel" key={p.path} href={url(locale, p.path)}>
                  <Icon name="search" />
                  <h2>{p.title[locale]}</h2>
                  <Arrow />
                </a>
              ))}
          </div>
          {!publicPages.some((p) =>
            p.title[locale].toLowerCase().includes(query.toLowerCase()),
          ) && <p role="status">{t.empty}</p>}
        </>
      ) : root === 'library' && !slug ? (
        <Articles locale={locale} />
      ) : (root === 'topics' || root === 'services') && !slug ? (
        <div className="topics-grid">
          {(root === 'topics' ? topics : ['consultation', 'questions', 'events']).map((k, i) => (
            <a className="topic-card" key={k} href={url(locale, `${root}/${k}`)}>
              <span className={`topic-icon tone-${i}`}>
                <Icon name={topicIcons[i]!} />
              </span>
              <h2>
                {k === 'consultation'
                  ? t.online
                  : k === 'questions'
                    ? t.ask
                    : k === 'events'
                      ? t.events
                      : t[k as (typeof topics)[number]]}
              </h2>
              <span>
                {t.explore}
                <Arrow />
              </span>
            </a>
          ))}
        </div>
      ) : root === 'events' ? (
        <div className="event-feature">
          <div className="event-art">
            <Icon name="book" />
            <Ornament />
          </div>
          <div>
            <span className="badge">{t.preview}</span>
            <h2>{t.family}</h2>
            <p>{t.eventText}</p>
            <button className="button" onClick={() => setModal(t.events)}>
              {t.details}
              <Arrow />
            </button>
          </div>
        </div>
      ) : root === 'auth' ? (
        <div className="panel narrow">
          <Icon name="shield" />
          <h2>{t.working}</h2>
          <p>{t.authText}</p>
          <ButtonLink locale={locale} path="dashboards">
            {t.dashboards}
          </ButtonLink>
        </div>
      ) : root === 'contact' ? (
        <div className="info-grid">
          {[
            ['help', t.help, 'help'],
            ['faq', t.faq, 'comments'],
            ['about', t.about, 'leaf'],
          ].map(([p, label, icon]) => (
            <a href={url(locale, p)} className="panel" key={p}>
              <span className="icon-tile">
                <Icon name={icon as IconName} />
              </span>
              <h2>{label}</h2>
              <Arrow />
            </a>
          ))}
        </div>
      ) : root === 'how-it-works' ? (
        <div className="journey-grid">
          {([0, 1, 2] as const).map((i) => (
            <article key={i}>
              <span className="step-number">{numbers(locale, i + 1)}</span>
              <div>
                <h2>{t[(['step1', 'step2', 'step3'] as const)[i]]}</h2>
                <p>{t[(['step1Text', 'step2Text', 'step3Text'] as const)[i]]}</p>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <article className="reading-panel">
          <span className="icon-tile">
            <Icon name={root === 'policies' ? 'shield' : 'book'} />
          </span>
          <h2>
            {root === 'topics' && slug
              ? t[slug as (typeof topics)[number]]
              : root === 'library'
                ? t[
                    slug === 'better-questions'
                      ? 'article2'
                      : slug === 'small-steps'
                        ? 'article3'
                        : 'article1'
                  ]
                : title}
          </h2>
          <p>
            {root === 'policies'
              ? t.policyText
              : ['join-experts', 'organizations'].includes(root)
                ? t.joinText
                : root === 'about'
                  ? t.aboutText
                  : t.articleText}
          </p>
          <blockquote>{t.quote}</blockquote>
          <p>{t.trustText}</p>
          <ButtonLink locale={locale} path={root === 'policies' ? 'help' : 'experts'}>
            {root === 'policies' ? t.help : t.findExpert}
          </ButtonLink>
        </article>
      )}
      {modal && (
        <Modal locale={locale} title={modal} onClose={() => setModal(null)}>
          <p>{t.sampleNotice}</p>
          <p>{t.noAction}</p>
        </Modal>
      )}
    </section>
  );
}
function Calendar({
  locale,
  day,
  onSelect,
}: {
  locale: Locale;
  day: number;
  onSelect: (day: number) => void;
}) {
  const t = copy[locale];
  return (
    <div className="calendar">
      <div className="calendar-heading">
        <h3>{locale === 'fa' ? 'مهر ۱۴۰۵ · نمونه' : 'October 2026 · Sample'}</h3>
        <Icon name="calendar" />
      </div>
      <div className="calendar-grid">
        {t.weekdays.split(' ').map((label, i) => (
          <span className="day-name" key={i}>
            {label}
          </span>
        ))}
        {Array.from({ length: locale === 'fa' ? 4 : 3 }, (_, i) => (
          <span aria-hidden="true" key={`blank-${i}`} />
        ))}
        {Array.from({ length: locale === 'fa' ? 30 : 31 }, (_, i) => (
          <button
            key={i}
            className={day === i + 1 ? 'selected' : ''}
            aria-pressed={day === i + 1}
            aria-label={`${t.calendar} ${numbers(locale, i + 1)}`}
            onClick={() => {
              onSelect(i + 1);
            }}
          >
            {numbers(locale, i + 1)}
            {[8, 15, 23].includes(i + 1) && <i />}
          </button>
        ))}
      </div>
    </div>
  );
}
function Chart({
  locale,
  period,
  roleIndex,
}: {
  locale: Locale;
  period: string;
  roleIndex: number;
}) {
  const t = copy[locale];
  const values = period === 'month' ? [32, 58, 44, 75, 63, 91, 70] : [35, 52, 40, 68, 57, 83, 64];
  return (
    <div
      className="chart"
      role="img"
      aria-label={`${t.activityHint}: ${values.map((n) => numbers(locale, n + roleIndex)).join(', ')}`}
    >
      <div className="chart-grid">
        <span>100</span>
        <span>75</span>
        <span>50</span>
        <span>25</span>
      </div>
      <div className="chart-bars">
        {values.map((n, i) => (
          <div key={i}>
            <div className="bar-track">
              <span style={{ height: `${n}%` }} />
              <i style={{ height: `${Math.max(10, n - 23)}%` }} />
            </div>
            <small>{t.weekdays.split(' ')[i]}</small>
          </div>
        ))}
      </div>
    </div>
  );
}
function Dashboard({
  locale,
  path,
  roleId,
  section = '',
}: {
  locale: Locale;
  path: string;
  roleId: string;
  section?: string;
}) {
  const t = copy[locale];
  const role = roles.find((r) => r.id === roleId) ?? roles[0];
  const roleIndex = roles.findIndex((r) => r.id === role.id);
  const [menu, setMenu] = useState(false),
    [modal, setModal] = useState<string | null>(null),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all'),
    [period, setPeriod] = useState('week'),
    [saved, setSaved] = useState(false),
    [selectedDay, setSelectedDay] = useState(15);
  const [narrow, setNarrow] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 980px)');
    const update = () => {
      setNarrow(media.matches);
      if (!media.matches) setMenu(false);
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!menu || !narrow) return;
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sidebarRef.current?.querySelector<HTMLElement>('button')?.focus();
    return () => {
      document.body.style.overflow = oldOverflow;
      previous?.focus();
    };
  }, [menu, narrow]);
  const preview = path.startsWith('preview/');
  const prefix = preview ? `preview/${role.id}` : rolePath(role.id);
  const actualNav = registry
    .filter(
      (p) =>
        p.path.startsWith(`/[locale]/${prefix}/`) &&
        p.path.split('/').length === prefix.split('/').length + 3 &&
        !p.path.includes('[', 11),
    )
    .map((p) => p.path.split('/').pop()!);
  const sections = preview
    ? ['activity', 'calendar', 'messages', 'settings']
    : actualNav.length
      ? actualNav
      : ['questions', 'calendar', 'messages', 'settings'];
  const labels: Record<string, string> = {
    activity: t.activity,
    calendar: t.calendar,
    messages: t.notifications,
    settings: t.settings,
  };
  const sectionLabel = sectionNames[section]?.[locale] ?? labels[section] ?? t.dashboard;
  const nav = [
    { path: prefix, label: t.dashboard, icon: 'grid' as IconName },
    ...sections.map((s, i) => ({
      path: `${prefix}/${s}`,
      label: sectionNames[s]?.[locale] ?? labels[s] ?? t.details,
      icon: (
        [
          'calendar',
          'comments',
          'wallet',
          'book',
          'user',
          'shield',
          'building',
          'server',
        ] as IconName[]
      )[i % 8]!,
    })),
  ];
  const statuses = [t.scheduled, t.review, t.complete];
  const rows = role.items[locale].map((title, i) => ({
    title,
    status: statuses[i]!,
    time: ['10:30', '14:00', '16:30'][i]!,
    id: i,
  }));
  const filtered = rows.filter(
    (r) =>
      (filter === 'all' || String(r.id) === filter) &&
      r.title.toLowerCase().includes(query.toLowerCase()),
  );
  const download = () => {
    const data = JSON.stringify({ preview: true, role: role.id, records: rows }, null, 2);
    const link = document.createElement('a');
    const object = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    link.href = object;
    link.download = `vianoor-${role.id}-sample.json`;
    link.click();
    URL.revokeObjectURL(object);
  };
  return (
    <div className="workspace">
      <a className="skip-link" href="#main">
        {t.skip}
      </a>
      <aside
        ref={sidebarRef}
        id="workspace-navigation"
        inert={narrow && !menu}
        className={`sidebar ${menu ? 'open' : ''}`}
        onKeyDown={(e) => {
          if (!narrow || !menu) return;
          if (e.key === 'Escape') {
            setMenu(false);
            menuRef.current?.focus();
          }
          if (e.key === 'Tab') {
            const items = Array.from(
              sidebarRef.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled])') ??
                [],
            ).filter((el) => el.getClientRects().length);
            const first = items[0],
              last = items[items.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <div className="sidebar-brand">
          <Brand locale={locale} />
          <button
            className="icon-button mobile-menu"
            aria-label={t.close}
            onClick={() => setMenu(false)}
          >
            <Icon name="close" />
          </button>
        </div>
        <a className="workspace-switch" href={url(locale, 'dashboards')}>
          <span className="icon-tile">
            <Icon name={role.icon} />
          </span>
          <span>
            <small>{t.chooseRole}</small>
            <strong>{role.title[locale]}</strong>
          </span>
          <Icon name="down" />
        </a>
        <div className="side-caption">{t.dashboard}</div>
        <nav aria-label={t.workspaceNav}>
          {nav.map((n) => (
            <a
              key={n.path}
              href={url(locale, n.path)}
              className={path === n.path ? 'active' : ''}
              aria-current={path === n.path ? 'page' : undefined}
            >
              <Icon name={n.icon} />
              {n.label}
              {path === n.path && <span className="nav-dot" />}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="side-help">
            <span className="icon-tile">
              <Icon name="headset" />
            </span>
            <h3>{t.helpCard}</h3>
            <p>{t.helpCardText}</p>
            <a href={url(locale, 'help')}>
              {t.viewGuide}
              <Arrow />
            </a>
          </div>
          <a className="back-home" href={url(locale)}>
            <Icon name="exit" />
            {t.backHome}
          </a>
        </div>
      </aside>
      {menu && (
        <button className="sidebar-backdrop" aria-label={t.close} onClick={() => setMenu(false)} />
      )}
      <div className="workspace-main" inert={narrow && menu}>
        <header className="workspace-header">
          <div className="workspace-heading">
            <button
              className="icon-button mobile-menu"
              aria-label={t.menu}
              ref={menuRef}
              aria-expanded={menu}
              aria-controls="workspace-navigation"
              onClick={() => setMenu(!menu)}
            >
              <Icon name="menu" />
            </button>
            <div>
              <small>
                {t.dashboards} / {role.title[locale]}
              </small>
              <strong>{section ? sectionLabel : t.dashboard}</strong>
            </div>
          </div>
          <div className="workspace-tools">
            <a className="language" href={url(locale === 'fa' ? 'en' : 'fa', path)}>
              {t.language}
              <Icon name="globe" />
            </a>
            <button
              className="icon-button notification-button"
              aria-label={t.notifications}
              onClick={() => setModal(t.notifications)}
            >
              <Icon name="bell" />
              <i />
            </button>
            <span className="header-separator" />
            <span className="avatar small-avatar">{locale === 'fa' ? 'و' : 'V'}</span>
          </div>
        </header>
        <main tabIndex={-1} id="main" className="dashboard-main">
          <div className="dashboard-topline">
            <Preview locale={locale} />
            <span className="date-label">
              <Icon name="calendar" />
              {t.sampleDate}
            </span>
          </div>
          <div className="dashboard-title">
            <div>
              <h1>
                {section
                  ? sectionLabel
                  : role.id === 'account'
                    ? `${t.greeting} ✦`
                    : role.title[locale]}
              </h1>
              <p>{section ? t.sectionIntro : t.overviewText}</p>
            </div>
            <button className="button secondary compact" onClick={download}>
              <Icon name="download" />
              {t.download}
            </button>
          </div>
          {!section && (
            <>
              <section className={`welcome-banner role-${role.id}`}>
                <Ornament />
                <div>
                  <span className="eyebrow light">{t.tagline}</span>
                  <h2>{role.headline[locale]}</h2>
                  <p>{role.id === 'account' ? t.wellbeingText : t.overviewText}</p>
                  <button className="button cream compact" onClick={() => setModal(t.upcoming)}>
                    {t.roleAction}
                    <Arrow />
                  </button>
                </div>
                <div className="welcome-symbol">
                  <Icon name={role.icon} />
                  <span />
                  <i />
                </div>
              </section>
              <section className="stats-grid" aria-label={t.recent}>
                {role.metrics[locale].map((label, i) => (
                  <article className="stat-card" key={label}>
                    <div>
                      <span className={`icon-tile tone-${i}`}>
                        <Icon
                          name={(['calendar', role.icon, 'comments', 'check'] as IconName[])[i]!}
                        />
                      </span>
                      <span className="muted small">{t.preview}</span>
                    </div>
                    <strong>{numbers(locale, role.values[i]!)}</strong>
                    <p>{label}</p>
                    <span className="stat-foot">
                      <span className="status-dot" />
                      {t[period === 'week' ? 'week' : 'month']}
                    </span>
                  </article>
                ))}
              </section>
            </>
          )}
          <div className="dashboard-grid">
            <div className="dashboard-primary">
              {!section && (
                <section className="panel chart-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>{t.activity}</h2>
                      <p>{t.activityHint}</p>
                    </div>
                    <div className="segmented">
                      {(['week', 'month'] as const).map((p) => (
                        <button
                          key={p}
                          onClick={() => setPeriod(p)}
                          aria-pressed={period === p}
                          className={period === p ? 'active' : ''}
                        >
                          {t[p]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <Chart locale={locale} period={period} roleIndex={roleIndex} />
                  <div className="chart-legend">
                    <span>
                      <i />
                      {role.metrics[locale][0]}
                    </span>
                    <span>
                      <i />
                      {role.metrics[locale][1]}
                    </span>
                  </div>
                </section>
              )}
              {section.includes('calendar') || section === 'availability' ? (
                <section className="panel">
                  <h2>{t.calendar}</h2>
                  <p>{t.calendarHint}</p>
                  <Calendar locale={locale} day={selectedDay} onSelect={setSelectedDay} />
                  <p role="status">
                    {t.selectedDay}: {numbers(locale, selectedDay)} · 10:30
                  </p>
                </section>
              ) : section === 'settings' ? (
                <section className="panel settings-panel">
                  <h2>{t.settings}</h2>
                  <p>{t.sampleNotice}</p>
                  <label>
                    {t.language}
                    <select
                      value={locale}
                      onChange={(e) => {
                        window.location.href = url(e.target.value as Locale, path);
                      }}
                    >
                      <option value="fa">فارسی</option>
                      <option value="en">English</option>
                    </select>
                  </label>
                  <label className="toggle-row">
                    {t.notifications}
                    <input
                      type="checkbox"
                      checked={saved}
                      onChange={(e) => setSaved(e.target.checked)}
                    />
                  </label>
                  <p role="status">{saved ? t.saved : t.demoDetail}</p>
                </section>
              ) : (
                <section className="panel records-panel">
                  <div className="panel-heading">
                    <h2>{section ? sectionLabel : t.upcoming}</h2>
                    <span className="count-badge">{numbers(locale, filtered.length)}</span>
                  </div>
                  <div className="record-filters">
                    <label className="search-field">
                      <Icon name="search" />
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={t.searchWork}
                        aria-label={t.searchWork}
                      />
                    </label>
                    <select
                      aria-label={t.status}
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option value="all">{t.all}</option>
                      {statuses.map((s, i) => (
                        <option key={s} value={String(i)}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="record-list">
                    {filtered.map((row) => (
                      <article className="record" key={row.id}>
                        <span className={`record-icon tone-${row.id}`}>
                          <Icon name={role.icon} />
                        </span>
                        <div className="record-info">
                          <h3>{row.title}</h3>
                          <span>
                            <Icon name="clock" />
                            {row.time} · {t.preview}
                          </span>
                        </div>
                        <span className={`badge badge-${row.id}`}>{row.status}</span>
                        <button
                          className="icon-button"
                          aria-label={`${t.details}: ${row.title}`}
                          onClick={() => setModal(row.title)}
                        >
                          <Icon name="chevron" className="direction-icon" />
                        </button>
                      </article>
                    ))}
                    {!filtered.length && (
                      <div className="empty-state">
                        <Icon name="search" />
                        <h3>{t.empty}</h3>
                        <button
                          className="button secondary"
                          onClick={() => {
                            setQuery('');
                            setFilter('all');
                          }}
                        >
                          {t.clear}
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="records-footer">
                    <span className="muted small">{t.sampleNotice}</span>
                    {!section && (
                      <a className="text-link" href={url(locale, nav[1]?.path ?? prefix)}>
                        {t.showAll}
                        <Arrow />
                      </a>
                    )}
                  </div>
                </section>
              )}
              {role.id === 'ai' && (
                <section className="panel provider-panel">
                  <span className="icon-tile">
                    <Icon name="sparkles" />
                  </span>
                  <div>
                    <h2>GapGPT</h2>
                    <p>{t.noAction}</p>
                  </div>
                  <span className="badge">{t.working}</span>
                </section>
              )}
              {role.id === 'operations' && (
                <section className="panel">
                  <h2>{t.emptyLive}</h2>
                  <p>{t.demoDetail}</p>
                  <div className="service-grid">
                    {['PostgreSQL', 'Redis', 'NATS', 'Gateway'].map((name) => (
                      <div key={name}>
                        <Icon name="server" />
                        <span>{name}</span>
                        <small>{t.preview}</small>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
            <aside className="dashboard-aside">
              <section className="panel">
                <div className="panel-heading">
                  <h2>{t.quick}</h2>
                  <Icon name="sparkles" />
                </div>
                <div className="quick-grid">
                  {nav.slice(1, 5).map((n) => (
                    <a href={url(locale, n.path)} key={n.path}>
                      <span className="icon-tile">
                        <Icon name={n.icon} />
                      </span>
                      <span>{n.label}</span>
                    </a>
                  ))}
                </div>
              </section>
              <section className="panel calendar-panel">
                <Calendar locale={locale} day={selectedDay} onSelect={setSelectedDay} />
                <div className="calendar-note" role="status">
                  <span className="status-dot" />
                  {t.selectedDay} {numbers(locale, selectedDay)}
                  <strong>10:30</strong>
                </div>
              </section>
              <section className="reflection-card">
                <Icon name="leaf" />
                <h3>{t.wellbeing}</h3>
                <p>{t.wellbeingText}</p>
                <button
                  className={`save-button ${saved ? 'saved' : ''}`}
                  aria-pressed={saved}
                  onClick={() => setSaved(!saved)}
                >
                  <Icon name="bookmark" />
                  {saved ? t.saved : t.save}
                </button>
              </section>
            </aside>
          </div>
          <p className="dashboard-disclaimer">{t.demoDetail}</p>
        </main>
        <nav className="mobile-bottom" aria-label={t.workspaceNav}>
          {nav.slice(0, 4).map((n) => (
            <a className={path === n.path ? 'active' : ''} key={n.path} href={url(locale, n.path)}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
            </a>
          ))}
        </nav>
      </div>
      {modal && (
        <Modal locale={locale} title={modal} onClose={() => setModal(null)}>
          <p>{modal === t.notifications ? t.notificationText : t.sampleNotice}</p>
          <div className="modal-detail">
            <Icon name={role.icon} />
            <span>
              {role.title[locale]}
              <small>{t.noAction}</small>
            </span>
          </div>
        </Modal>
      )}
    </div>
  );
}
export function Experience({
  locale,
  path = '',
  app = 'web',
}: {
  locale: Locale;
  path?: string;
  app?: 'web' | 'admin';
}) {
  const info = routeInfo(path, app);
  if (info?.kind === 'dashboard')
    return (
      <Dashboard
        key={`${locale}:${path}`}
        locale={locale}
        path={path}
        roleId={info.role!}
        section={info.section ?? ''}
      />
    );
  return (
    <>
      <a className="skip-link" href="#main">
        {copy[locale].skip}
      </a>
      <Header locale={locale} path={path} />
      <main tabIndex={-1} id="main">
        {info?.kind === 'home' ? (
          <Home locale={locale} />
        ) : info?.kind === 'gallery' ? (
          <Gallery locale={locale} />
        ) : (
          <PublicPage key={`${locale}:${path}`} locale={locale} path={path} />
        )}
      </main>
      <Footer locale={locale} />
    </>
  );
}
