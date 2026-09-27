import { cache } from 'react';
import { notFound } from 'next/navigation';
import { installCatalog, type PublicCatalog } from '@vianoor/ui';
export const getCatalog = cache(async (locale: string): Promise<PublicCatalog | null> => {
  if (process.env.DISCOVERY_ENABLED !== '1') {
    if (!['fa', 'en'].includes(locale)) notFound();
    return null;
  }
  const gateway = process.env.AUTH_GATEWAY_URL,
    key = process.env.AUTH_INTERNAL_KEY;
  if (!gateway || !key) throw Error('Localization configuration missing');
  const response = await fetch(
    new URL('/api/v2/localization/bundle?language=' + encodeURIComponent(locale), gateway),
    { cache: 'no-store', headers: { 'x-internal-key': key }, signal: AbortSignal.timeout(10000) },
  );
  if (response.status === 404 || response.status === 400) notFound();
  if (!response.ok) throw Error('Localization catalogue unavailable');
  const catalog = (await response.json()).data as PublicCatalog;
  installCatalog(catalog);
  return catalog;
});
