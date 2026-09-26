import { notFound } from 'next/navigation';
import { Foundation, isLocale } from '@vianoor/ui';
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <Foundation locale={locale} admin={true} />;
}
