import { notFound } from 'next/navigation';
import { expertData, publicBase } from './data';
export const dynamic = 'force-dynamic';
export default async function Experts({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (locale !== 'fa' && locale !== 'en') notFound();
  const items =
    await expertData<{ slug: string; display_name: string; title: string; short_bio: string }[]>(
      'experts/public',
    );
  const t =
    locale === 'fa'
      ? {
          title: 'اساتید تأییدشده',
          empty: 'هنوز پروفایل عمومی منتشر نشده است.',
          unavailable: 'فهرست اساتید در دسترس نیست.',
          home: 'خانه',
        }
      : {
          title: 'Verified experts',
          empty: 'No public profiles have been published yet.',
          unavailable: 'Expert directory is unavailable.',
          home: 'Home',
        };
  return (
    <main className="public-experts" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
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
