import { notFound } from 'next/navigation';
import { Experience, isLocale } from '@vianoor/ui';
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <Experience locale={locale} app="web" />;
}
