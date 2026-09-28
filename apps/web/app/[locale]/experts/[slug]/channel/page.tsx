import { getCatalog } from '../../../../../lib/localization';
import { isLocale, localeDirection, communicationCopy } from '@vianoor/ui';
import { notFound } from 'next/navigation';
import { expertData, publicBase } from '../../data';
export const dynamic = 'force-dynamic';
export default async function Channel({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  await getCatalog(locale);
  if (!isLocale(locale) || !/^[a-z0-9-]{3,80}$/.test(slug)) notFound();
  const row = await expertData<{
    id: string;
    title: string;
    description: string;
    posts: { id: string; body: string; created_at: string; attachment_count: number }[];
  }>('channels/public/' + slug);
  if (!row) notFound();
  const t = communicationCopy[locale]!;
  return (
    <main className="public-experts" dir={localeDirection(locale)}>
      <h1>{row.title}</h1>
      <p>{row.description}</p>
      <a
        className="button"
        href={publicBase + '/' + locale + '/account/channels?channel=' + row.id}
      >
        {t.follow} / {t.comments}
      </a>
      {row.posts.map((p) => (
        <article className="user-card" key={p.id}>
          <p style={{ whiteSpace: 'pre-wrap' }}>{p.body}</p>
          <time dateTime={p.created_at}>{new Date(p.created_at).toLocaleDateString(locale)}</time>
          {p.attachment_count > 0 && (
            <p>
              <a href={publicBase + '/' + locale + '/account/channels?channel=' + row.id}>
                {t.attachment}
              </a>
            </p>
          )}
        </article>
      ))}
    </main>
  );
}
