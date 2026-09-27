import { getCatalog } from '../../../../lib/localization';
import { AccountSecurity, isLocale } from '@vianoor/ui';
import { notFound } from 'next/navigation';
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await getCatalog(locale);
  if (!isLocale(locale)) notFound();
  return <AccountSecurity locale={locale} />;
}
