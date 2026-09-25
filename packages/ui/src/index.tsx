import { messages, type Locale } from './messages';
export { messages, isLocale } from './messages';

function Mark() {
  return <svg viewBox="0 0 40 40" width="36" height="36" aria-hidden="true"><path d="M20 2 26 12 38 14 30 23 32 36 20 31 8 36 10 23 2 14 14 12Z" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="20" cy="20" r="7" fill="none" stroke="currentColor" strokeWidth="2" /></svg>;
}

export function Foundation({ locale, admin = false }: { locale: Locale; admin?: boolean }) {
  const t = messages[locale];
  const items = admin
    ? [t.scientific, t.support, t.finance, t.organization, t.content, t.operations].map((title) => ({ title, text: t.later }))
    : [{ title: t.consultation, text: t.consultationText }, { title: t.questions, text: t.questionsText }, { title: t.experts, text: t.expertsText }, { title: t.events, text: t.eventsText }];
  return <>
    <a className="skip-link" href="#main">{t.skip}</a>
    <header className="header"><a className="brand" href={`/${locale}`}><Mark /><span>{t.brand}<small>{t.tagline}</small></span></a><a className="language" href={locale === 'fa' ? '/en' : '/fa'} lang={locale === 'fa' ? 'en' : 'fa'}>{t.language}<span aria-hidden="true"> ↗</span></a></header>
    <main id="main" className="main">
      <section className="hero" aria-labelledby="hero-title"><div className="hero-copy"><span className="eyebrow">{t.badge}</span><h1 id="hero-title">{admin ? t.adminTitle : t.title}</h1><p>{admin ? t.adminIntro : t.intro}</p><div className="notice">{t.notice}</div></div>
        <aside className="foundation"><span className="small-label">{t.foundation}</span><ul>{[t.independent,t.bilingual,t.identity,t.ai].map((label) => <li key={label}><span className="check" aria-hidden="true">✓</span>{label}</li>)}</ul></aside>
      </section>
      <section aria-labelledby="sections-title"><div className="section-heading"><span className="gold-line" aria-hidden="true"/><h2 id="sections-title">{admin ? t.staffSections : t.sections}</h2></div><div className="cards">{items.map((item,index) => <article className="card" key={item.title}><span className="card-number" aria-hidden="true">{new Intl.NumberFormat(locale).format(index+1).padStart(2,locale === 'fa' ? '۰' : '0')}</span><h3>{item.title}</h3><p>{item.text}</p></article>)}</div></section>
      <section className="next"><div><span className="small-label">{t.next}</span><h2>{t.nextTitle}</h2><p>{t.nextText}</p></div><span className="next-number" aria-hidden="true">{locale === 'fa' ? '۰۲' : '02'}</span></section>
    </main><footer>{t.footer}</footer>
  </>;
}
