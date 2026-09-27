import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  assertTransition,
  isVerified,
  professionalSchema,
  missingProfessional,
  documentSchema,
  offeringSchema,
} from '../services/scholar-service/src/model.js';
import { validateSignature } from '../services/file-service/src/assets.js';
import { grantsPermission } from '../services/organization-service/src/organization.js';
const profile = {
  display_name: 'Test expert',
  title: 'Teacher',
  slug: 'test-expert',
  short_bio: 'Introduction',
  biography: 'Biography',
  education: 'Education',
  experience: '',
  years: 3,
  city: '',
  country: '',
  links: [],
  image_id: null,
  visibility: 'HIDDEN' as const,
  seo_title: '',
  seo_description: '',
  specialties: [randomUUID()],
  languages: [{ id: randomUUID(), level: 'FLUENT' as const }],
  viewpoints: [],
};
test('qualification cannot skip review or self-publish from draft', () => {
  assert.throws(() => assertTransition('DRAFT', 'APPROVED'));
  assert.throws(() => assertTransition('SUBMITTED', 'APPROVED'));
  assert.throws(() => assertTransition('SUSPENDED', 'APPROVED'));
  assert.doesNotThrow(() => assertTransition('DRAFT', 'SUBMITTED'));
  assert.doesNotThrow(() => assertTransition('SUBMITTED', 'UNDER_REVIEW'));
  assert.doesNotThrow(() => assertTransition('UNDER_REVIEW', 'NEEDS_CHANGES'));
  assert.doesNotThrow(() => assertTransition('NEEDS_CHANGES', 'SUBMITTED'));
  assert.equal(isVerified('APPROVED', '2020-01-01T00:00:00Z'), false);
  assert.equal(isVerified('SUSPENDED', null), false);
  assert.equal(isVerified('APPROVED', null), true);
});
test('professional input rejects duplicate specialities, unsafe URLs and unknown fields', () => {
  assert.equal(professionalSchema.safeParse(profile).success, true);
  assert.equal(
    professionalSchema.safeParse({
      ...profile,
      specialties: [profile.specialties[0], profile.specialties[0]],
    }).success,
    false,
  );
  assert.equal(
    professionalSchema.safeParse({ ...profile, links: ['javascript:alert(1)'] }).success,
    false,
  );
  assert.equal(professionalSchema.safeParse({ ...profile, status: 'APPROVED' }).success, false);
  assert.deepEqual(missingProfessional(profile, []), ['documents']);
  assert.deepEqual(
    missingProfessional(profile, [{ status: 'APPROVED', expires_at: '2000-01-01' }]),
    ['documents'],
  );
  assert.deepEqual(missingProfessional(profile, [{ status: 'PENDING', expires_at: null }]), []);
});
test('document dates and exact integer money validated', () => {
  assert.equal(
    documentSchema.safeParse({
      kind: 'DEGREE',
      title: 'Degree',
      issuer: 'Test',
      number: '',
      issued_at: '2026-02-30',
      expires_at: null,
      file_id: randomUUID(),
      description: '',
      public_summary: false,
    }).success,
    false,
  );
  const value = {
    title: 'Consultation',
    summary: 'Test',
    description: '',
    kind: 'TEXT',
    specialty_id: randomUUID(),
    category_id: null,
    duration_minutes: null,
    price_minor: 200000,
    currency: 'IRR',
    booking_required: false,
    image_id: null,
    terms: '',
  };
  assert.equal(offeringSchema.safeParse(value).success, true);
  assert.equal(offeringSchema.safeParse({ ...value, price_minor: 0.1 }).success, false);
  assert.equal(offeringSchema.safeParse({ ...value, price_minor: -1 }).success, false);
});
test('file signature, MIME and extension must agree', () => {
  assert.throws(() =>
    validateSignature(Buffer.from('MZ executable'), 'degree.pdf', 'application/pdf'),
  );
  const pdf = Buffer.from('%PDF-1.4\nexample\n%%EOF');
  assert.equal(validateSignature(pdf, 'degree.pdf', 'application/pdf'), 'document');
  assert.throws(() => validateSignature(pdf, 'degree.png', 'image/png'));
  assert.throws(() => validateSignature(pdf, 'degree.exe', 'application/pdf'));
  assert.throws(() =>
    validateSignature(Buffer.from('<svg onload="alert(1)">'), 'degree.svg', 'image/svg+xml'),
  );
});
test('expert review permissions remain separate from user and file administration', () => {
  assert.equal(
    grantsPermission(
      [{ role: 'scientific', scope: 'platform' }],
      'expert.document.review',
      'platform',
    ),
    true,
  );
  assert.equal(
    grantsPermission([{ role: 'scientific', scope: 'platform' }], 'users.manage', 'platform'),
    false,
  );
  assert.equal(
    grantsPermission([{ role: 'scientific', scope: 'platform' }], 'file.admin', 'platform'),
    false,
  );
  assert.equal(
    grantsPermission([{ role: 'expert', scope: 'platform' }], 'expert.approve', 'platform'),
    false,
  );
  assert.equal(
    grantsPermission([{ role: 'scientific', scope: randomUUID() }], 'expert.approve', 'platform'),
    false,
  );
});
