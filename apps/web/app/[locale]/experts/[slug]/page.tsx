import { expertsPublicCopy } from '@vianoor/ui';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { expertData, publicBase, type PublicExpert } from '../data';
export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ locale: string; slug: string }> };
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!/^[a-z0-9-]{3,80}$/.test(slug)) return {};
  const row = await expertData<PublicExpert>('experts/public/' + slug);
  if (!row) return { robots: { index: false, follow: false } };
  const title = row.profile.seo_title || row.profile.display_name,
    description = row.profile.seo_description || row.profile.short_bio;
  const url =
    (process.env.AUTH_PUBLIC_URL ?? '').replace(/\/$/, '') + '/' + locale + '/experts/' + slug;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: 'profile' },
  };
}
export default async function Expert({ params }: Params) {
  const { locale, slug } = await params;
  if ((locale !== 'fa' && locale !== 'en') || !/^[a-z0-9-]{3,80}$/.test(slug)) notFound();
  const row = await expertData<PublicExpert>('experts/public/' + slug);
  if (!row) notFound();
  const taxons =
    (await expertData<{ id: string; label: { fa: string; en: string } }[]>('taxonomy')) ?? [];
  const p = row.profile,
    image = p.image_id
      ? await expertData<{ mime: string; base64: string }>('files/public/' + p.image_id)
      : null;
  const t = expertsPublicCopy[locale];
  return (
    <main className="public-experts" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <a href={`${publicBase}/${locale}/experts`}>{t.back}</a>
      <header className="user-card">
        {image && (
          <img
            className="scholar-portrait"
            src={`data:${image.mime};base64,${image.base64}`}
            alt={p.display_name}
            width={160}
            height={160}
          />
        )}
        <h1>{p.display_name}</h1>
        <p>{p.title}</p>
        <span className="user-badge">{t.verified}</span>
        <p>{p.short_bio}</p>
      </header>
      <section className="user-card scholar-readonly">
        <p>{p.biography}</p>
        <h2>{t.education}</h2>
        <p>{p.education}</p>
        <h2>{t.experience}</h2>
        <p>{p.experience}</p>
        <p>
          {p.city} · {p.country}
        </p>
        <h2>{t.specialties}</h2>
        {row.specialties.map((id) => (
          <p key={id}>{taxons.find((x) => x.id === id)?.label[locale]}</p>
        ))}
        <h2>{t.languages}</h2>
        {p.languages.map((l) => (
          <p key={l.id}>{taxons.find((x) => x.id === l.id)?.label[locale]}</p>
        ))}
        {p.links.map((link) => (
          <p key={link}>
            <a href={link} rel="nofollow noopener noreferrer">
              {new URL(link).hostname}
            </a>
          </p>
        ))}
      </section>
      {p.viewpoints.map((v, i) => (
        <section className="user-card" key={i}>
          <h2>{v.topic}</h2>
          <p>{v.text}</p>
        </section>
      ))}
      <section className="user-card">
        <h2>{t.documents}</h2>
        {row.documents.map((d, i) => (
          <p key={i}>
            {d.title} · {d.issuer}
          </p>
        ))}
      </section>
      <section>
        <h2>{t.services}</h2>
        <p>{t.note}</p>
        {row.services.map((s) => (
          <article className="user-card" key={s.id}>
            <h3>{s.details.title}</h3>
            <p>{s.details.summary}</p>
            <p>{s.details.description}</p>
            <strong>
              {s.details.price_minor.toLocaleString(locale)} {s.details.currency}
            </strong>
            {s.details.duration_minutes && (
              <p>
                {s.details.duration_minutes} {t.minutes}
              </p>
            )}
            <p>{s.details.terms}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
