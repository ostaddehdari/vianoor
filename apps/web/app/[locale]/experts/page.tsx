import {
  ExpertDiscovery,
  PublicPageShell,
  isLocale,
} from '@vianoor/ui';

import {
  getCatalog,
} from '../../../lib/localization';

import {
  notFound,
} from 'next/navigation';

export const dynamic =
  'force-dynamic';

export default async function Experts({
  params,
}: {
  params:
    Promise<{
      locale: string;
    }>;
}) {
  const {
    locale,
  } =
    await params;

  await getCatalog(
    locale,
  );

  if (
    !isLocale(
      locale,
    )
  )
    notFound();

  return (
    <PublicPageShell
      locale={locale}
      path="experts"
    >
      <ExpertDiscovery
        locale={locale}
      />
    </PublicPageShell>
  );
}
