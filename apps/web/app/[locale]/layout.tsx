export const dynamic = 'force-dynamic';
import { notFound } from 'next/navigation';
import { isLocale, copy, LocalizationProvider, localeDirection } from '@vianoor/ui';
import '@vianoor/ui/styles.css';
import type { Metadata } from 'next';
import { getCatalog } from '../../lib/localization';
export function generateStaticParams() {
  return [{ locale: 'fa' }, { locale: 'en' }];
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const catalog = await getCatalog(locale);
  return {
    title: catalog?.values['copy.brand'] ?? copy[locale]!.brand,
    description: catalog?.values['copy.intro'] ?? copy[locale]!.intro,
    robots: { index: false, follow: false },
  };
}
export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const catalog = await getCatalog(locale);
  return (
    <html
      lang={locale}
      dir={(catalog?.language.direction.toLowerCase() as 'rtl' | 'ltr') ?? localeDirection(locale)}
    >
      <body>
        <LocalizationProvider catalog={catalog}>{children}</LocalizationProvider>
      </body>
    </html>
  );
}
