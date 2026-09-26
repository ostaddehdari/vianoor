import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicId } from '../services/identity-service/src/public-id.ts';
import { formSchema, defaultForm, validateAnswers } from '../services/profile-service/src/forms.ts';
import { grantsPermission } from '../services/organization-service/src/organization.ts';
import { normalizeImage } from '../services/file-service/src/files.ts';
import sharp from 'sharp';
import { usersCopy } from '../packages/ui/src/users-copy.ts';
test('public IDs are exactly 13 mixed alphanumeric characters, independent and unique', () => {
  const ids = Array.from({ length: 10000 }, publicId);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    assert.match(id, /^[A-Za-z0-9]{13}$/);
    assert.match(id, /[A-Za-z]/);
    assert.match(id, /[0-9]/);
  }
});
test('permissions deny by default, isolate tenants and do not elevate auditors or organization managers', () => {
  assert.equal(grantsPermission([], 'users.manage', 'platform'), false);
  const manager = [{ role: 'organization', scope: 'tenant-a' }];
  assert.equal(grantsPermission(manager, 'membership.manage', 'tenant-a'), true);
  assert.equal(grantsPermission(manager, 'membership.manage', 'tenant-b'), false);
  assert.equal(grantsPermission(manager, 'permission.grant', 'platform'), false);
  assert.equal(
    grantsPermission([{ role: 'auditor', scope: 'platform' }], 'users.manage', 'platform'),
    false,
  );
  assert.equal(
    grantsPermission([{ role: 'admin', scope: 'platform' }], 'forms.manage', 'platform'),
    true,
  );
  assert.equal(
    grantsPermission([{ role: 'expert', scope: 'tenant-a' }], 'booking.attend', 'platform'),
    false,
  );
});
test('form definitions reject duplicate IDs, forward conditions and invalid options', () => {
  const duplicate = structuredClone(defaultForm);
  duplicate.sections[0]!.fields.push(duplicate.sections[0]!.fields[0]!);
  assert.equal(formSchema.safeParse(duplicate).success, false);
  const bad = structuredClone(defaultForm);
  bad.sections[0]!.fields[0]!.showWhen = { field: 'timezone', equals: 'x' };
  assert.equal(formSchema.safeParse(bad).success, false);
  const options = structuredClone(defaultForm);
  options.sections[0]!.fields[1]!.options = [];
  assert.equal(formSchema.safeParse(options).success, false);
});
test('required fields, forged fields, typed answers and conditional fields are validated on server', () => {
  assert.throws(() => validateAnswers(defaultForm, {}, true), /PROFILE_INCOMPLETE/);
  assert.throws(() => validateAnswers(defaultForm, { admin: true }, false), /INVALID_ANSWERS/);
  assert.throws(
    () => validateAnswers(defaultForm, { language: 'invented' }, false),
    /INVALID_ANSWERS/,
  );
  assert.deepEqual(
    validateAnswers(defaultForm, { language: 'fa', timezone: 'Asia/Tehran' }, true).missing,
    [],
  );
  const conditional = structuredClone(defaultForm);
  conditional.sections[1]!.fields[0]!.showWhen = { field: 'language', equals: 'en' };
  const validated = validateAnswers(
    conditional,
    { language: 'fa', timezone: 'unwanted hidden value' },
    true,
  );
  assert.equal('timezone' in validated.answers, false);
});
test('image uploads reject non-images and excessive bytes and are re-encoded without metadata', async () => {
  await assert.rejects(normalizeImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')));
  await assert.rejects(normalizeImage(Buffer.alloc(2 * 1024 * 1024 + 1)));
  const input = await sharp({
    create: { width: 800, height: 600, channels: 3, background: '#124833' },
  })
    .jpeg()
    .toBuffer();
  const output = await normalizeImage(input);
  const meta = await sharp(output).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.width, 512);
  assert.equal(meta.exif, undefined);
});
test('stage 6 Persian and English dictionaries stay synchronized', () => {
  assert.deepEqual(Object.keys(usersCopy.fa).sort(), Object.keys(usersCopy.en).sort());
  for (const key of ['errors', 'roleNames', 'fieldTypes'] as const)
    assert.deepEqual(Object.keys(usersCopy.fa[key]).sort(), Object.keys(usersCopy.en[key]).sort());
});
