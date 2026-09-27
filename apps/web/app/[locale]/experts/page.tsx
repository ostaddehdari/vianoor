import { ExpertDiscovery, localeDirection } from '@vianoor/ui';
import { getCatalog } from '../../../lib/localization';
import { isLocale } from '@vianoor/ui';
import { expertsPublicCopy } from '@vianoor/ui';
import { notFound } from 'next/navigation';
import { expertData, publicBase } from './data';
export const dynamic = 'force-dynamic';
export default async function Experts({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await getCatalog(locale);
  if (!isLocale(locale)) notFound();
  if (process.env.DISCOVERY_ENABLED === '1') return <ExpertDiscovery locale={locale} />;
  const items =
    await expertData<{ slug: string; display_name: string; title: string; short_bio: string }[]>(
      'experts/public',
    );
  const t = expertsPublicCopy[locale]!;
  return (
    <main className="public-experts" dir={localeDirection(locale)}>
      <a href={`${publicBase}/${locale}`}>{t.home}</a>
      <h1>{t.title}</h1>
      {items === null ? (
        <p role="alert">{t.unavailable}</p>
      ) : items.length === 0 ? (
        <p>{t.empty}</p>
      ) : (
        <div className="scholar-grid">
          {items.map((x) => (
            <article key={x.slug} className="user-card">
              <h2>
                <a href={`${publicBase}/${locale}/experts/${x.slug}`}>{x.display_name}</a>
              </h2>
              <p>{x.title}</p>
              <p>{x.short_bio}</p>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
