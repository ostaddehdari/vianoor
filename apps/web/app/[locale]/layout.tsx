import { notFound } from 'next/navigation';
import { isLocale, messages } from '@vianoor/ui';
import '@vianoor/ui/styles.css';
import type { Metadata } from 'next';
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
  return {
    title: messages[locale].brand,
    description: messages[locale].intro,
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
  return (
    <html lang={locale} dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <body>{children}</body>
    </html>
  );
}
