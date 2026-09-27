import { z } from 'zod';
import { ServiceError } from '@vianoor/service-runtime';

export const applicationStatus = z.enum([
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'NEEDS_CHANGES',
  'APPROVED',
  'SUSPENDED',
  'REJECTED',
]);
export type ApplicationStatus = z.infer<typeof applicationStatus>;
export const text = z.string().trim().max(120);
const date = z.string().date();
const webUrl = z
  .string()
  .url()
  .max(500)
  .refine((v) => new URL(v).protocol === 'https:');
export const professionalSchema = z
  .object({
    source_language: z
      .string()
      .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
      .max(35)
      .default('und'),
    display_name: text,
    contact_phone: z
      .string()
      .regex(/^(?:\+?[0-9]{7,15})?$/)
      .default(''),
    title: text,
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .min(3)
      .max(80),
    short_bio: z.string().trim().max(400),
    biography: z.string().trim().max(12000),
    experience: z.string().trim().max(6000),
    education: z.string().trim().max(6000),
    years: z.number().int().min(0).max(90),
    city: text,
    country: text,
    links: z.array(webUrl).max(8),
    image_id: z.string().uuid().nullable(),
    visibility: z.enum(['PUBLIC', 'HIDDEN', 'INACTIVE']),
    seo_title: z.string().trim().max(160),
    seo_description: z.string().trim().max(300),
    languages: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            level: z.enum(['NATIVE', 'FLUENT', 'INTERMEDIATE', 'CONVERSATIONAL']),
          })
          .strict(),
      )
      .max(30),
    specialties: z.array(z.string().uuid()).max(30),
    viewpoints: z
      .array(z.object({ topic: text.min(1), text: z.string().trim().min(1).max(6000) }).strict())
      .max(30),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      new Set(v.specialties).size !== v.specialties.length ||
      new Set(v.languages.map((l) => l.id)).size !== v.languages.length
    )
      ctx.addIssue({ code: 'custom', message: 'Duplicate selection' });
  });
export type Professional = z.infer<typeof professionalSchema>;
export const documentSchema = z
  .object({
    kind: z.enum([
      'DEGREE',
      'SEMINARY',
      'CERTIFICATE',
      'LICENSE',
      'IDENTITY',
      'CV',
      'REFERENCE',
      'OTHER',
    ]),
    title: text.min(1),
    issuer: text,
    number: text,
    issued_at: date.nullable(),
    expires_at: date.nullable(),
    file_id: z.string().uuid(),
    description: z.string().trim().max(2000),
    public_summary: z.boolean(),
  })
  .strict()
  .refine((v) => !v.issued_at || !v.expires_at || v.issued_at <= v.expires_at);
export const offeringSchema = z
  .object({
    source_language: z
      .string()
      .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
      .max(35)
      .default('und'),
    title: text.min(1),
    summary: z.string().trim().min(1).max(400),
    description: z.string().trim().max(10000),
    kind: z.enum(['TEXT', 'AUDIO', 'VIDEO', 'IN_PERSON', 'QUESTION', 'CASE_REVIEW', 'TRAINING']),
    specialty_id: z.string().uuid(),
    category_id: z.string().uuid().nullable(),
    duration_minutes: z.number().int().min(1).max(1440).nullable(),
    price_minor: z.number().int().min(0).max(1000000000000),
    currency: z.enum(['IRR', 'IRT', 'USD', 'EUR', 'GBP', 'AED']),
    booking_required: z.boolean(),
    image_id: z.string().uuid().nullable(),
    terms: z.string().trim().max(5000),
  })
  .strict();
export const reviewSchema = z
  .object({
    status: z.enum(['UNDER_REVIEW', 'NEEDS_CHANGES', 'APPROVED', 'SUSPENDED', 'REJECTED']),
    reason: z.string().trim().min(1).max(2000),
    internal_note: z.string().trim().max(4000),
    valid_until: z.string().datetime().nullable(),
    revision: z.number().int().nonnegative(),
  })
  .strict();
const transitions: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['NEEDS_CHANGES', 'APPROVED', 'REJECTED'],
  NEEDS_CHANGES: ['SUBMITTED'],
  APPROVED: ['SUSPENDED'],
  SUSPENDED: ['UNDER_REVIEW'],
  REJECTED: ['SUBMITTED'],
};
export function assertTransition(from: ApplicationStatus, to: ApplicationStatus) {
  if (!transitions[from].includes(to)) throw new ServiceError(409, 'INVALID_TRANSITION');
}
export function missingProfessional(
  v: Professional,
  documents: { status: string; expires_at: string | null }[],
  now = new Date(),
) {
  const missing = ['display_name', 'title', 'short_bio', 'biography', 'education'].filter(
    (k) => !v[k as keyof Professional],
  );
  if (!v.specialties.length) missing.push('specialties');
  if (!v.languages.length) missing.push('languages');
  if (
    !documents.some(
      (d) =>
        !['REJECTED', 'EXPIRED'].includes(d.status) &&
        (!d.expires_at || d.expires_at.slice(0, 10) >= now.toISOString().slice(0, 10)),
    )
  )
    missing.push('documents');
  return missing;
}
export function isVerified(status: string, validUntil: string | null, now = Date.now()) {
  return status === 'APPROVED' && (!validUntil || Date.parse(validUntil) > now);
}
