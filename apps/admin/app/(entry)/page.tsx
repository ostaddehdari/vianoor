export const dynamic = 'force-dynamic';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
export default async function Page() {
  let language = 'fa';
  if (process.env.DISCOVERY_ENABLED === '1') {
    const preferred = (await cookies()).get('vianoor-language')?.value;
    if (preferred && /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(preferred)) {
      const gateway = process.env.AUTH_GATEWAY_URL,
        key = process.env.AUTH_INTERNAL_KEY;
      if (gateway && key) {
        try {
          const r = await fetch(new URL('/api/v2/languages/' + preferred, gateway), {
            headers: { 'x-internal-key': key },
            cache: 'no-store',
            signal: AbortSignal.timeout(5000),
          });
          if (r.ok) language = preferred;
        } catch {
          /* Use the default language when catalogue lookup is unavailable. */
        }
      }
    }
  }
  redirect((process.env.NEXT_PUBLIC_BASE_PATH ?? '') + '/' + language);
}
