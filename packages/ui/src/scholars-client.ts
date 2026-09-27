import { userApi } from './users-client';
export type Taxon = {
  id: string;
  kind: 'specialty' | 'category' | 'language';
  label: { fa: string; en: string };
  parent_id: string | null;
  active: boolean;
  position: number;
  icon: string;
  image_id: string | null;
  revision: number;
};
export type Professional = {
  display_name: string;
  title: string;
  slug: string;
  short_bio: string;
  biography: string;
  experience: string;
  education: string;
  years: number;
  city: string;
  country: string;
  links: string[];
  visibility: string;
  seo_title: string;
  seo_description: string;
  image_id: string | null;
  specialties: string[];
  languages: { id: string; level: string }[];
  viewpoints: { topic: string; text: string }[];
};
export type DocumentDetails = {
  kind: string;
  title: string;
  issuer: string;
  number: string;
  issued_at: string | null;
  expires_at: string | null;
  file_id: string;
  description: string;
  public_summary: boolean;
};
export type Offering = {
  title: string;
  summary: string;
  description: string;
  kind: string;
  specialty_id: string;
  category_id: string | null;
  duration_minutes: number | null;
  price_minor: number;
  currency: string;
  booking_required: boolean;
  image_id: string | null;
  terms: string;
};
export type Scholar = {
  id: string;
  public_id: string;
  profile: Professional;
  slug: string;
  status: string;
  revision: number;
  verified: boolean;
  valid_until: string | null;
  missing: string[];
  completion: number;
  documents: { id: string; details: DocumentDetails; status: string; reason: string }[];
  specialties: { specialty_id: string; status: string; reason: string }[];
  offerings: { id: string; details: Offering; status: string; reason: string; revision: number }[];
  decisions: {
    id: number;
    status: string;
    reason: string;
    internal_note?: string;
    created_at: string;
  }[];
};
export const emptyProfessional: Professional = {
  display_name: '',
  title: '',
  slug: '',
  short_bio: '',
  biography: '',
  experience: '',
  education: '',
  years: 0,
  city: '',
  country: '',
  links: [],
  visibility: 'HIDDEN',
  seo_title: '',
  seo_description: '',
  image_id: null,
  specialties: [],
  languages: [],
  viewpoints: [],
};
export async function uploadAsset(file: File, purpose: 'document' | 'image' | 'avatar') {
  const limits = await userApi<{ purpose: string; max_bytes: number }[]>('files/limits');
  if (file.size > (limits.find((l) => l.purpose === purpose)?.max_bytes ?? 0))
    throw new Error('FILE_TOO_LARGE');
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]!);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  return userApi<{ id: string; state: string }>('files/assets', 'POST', {
    name: file.name,
    mime: file.type,
    purpose,
    access: purpose === 'document' ? 'OWNER_ONLY' : 'PUBLIC',
    base64,
  });
}
export async function downloadAsset(id: string) {
  const link = await userApi<{ path: string }>('files/assets/' + id + '/link', 'POST', {});
  const file = await userApi<{ name: string; mime: string; base64: string }>(link.path);
  const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
