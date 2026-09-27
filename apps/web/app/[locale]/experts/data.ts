import 'server-only';
export async function expertData<T>(path: string): Promise<T | null> {
  const url = process.env.AUTH_GATEWAY_URL,
    key = process.env.AUTH_INTERNAL_KEY;
  if (!url || !key) return null;
  try {
    const response = await fetch(new URL('/api/v2/' + path, url), {
      headers: { 'x-internal-key': key },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    return (await response.json()).data as T;
  } catch {
    return null;
  }
}
export const publicBase = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
export type PublicExpert = {
  slug: string;
  public_id: string;
  verified: boolean;
  profile: {
    display_name: string;
    title: string;
    short_bio: string;
    biography: string;
    experience: string;
    education: string;
    years: number;
    city: string;
    country: string;
    links: string[];
    languages: { id: string; level: string }[];
    viewpoints: { topic: string; text: string }[];
    seo_title: string;
    seo_description: string;
    image_id: string | null;
  };
  specialties: string[];
  documents: { title: string; issuer: string; kind: string }[];
  services: {
    id: string;
    details: {
      title: string;
      summary: string;
      description: string;
      price_minor: number;
      currency: string;
      duration_minutes: number | null;
      terms: string;
    };
  }[];
};
