import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import { scan } from '../../services/file-service/src/scanner.js';
const env = (name: string) =>
  Object.fromEntries(
    readFileSync('/run/vianoor/' + name + '.env', 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((line) => {
        const i = line.indexOf('=');
        return [line.slice(0, i), line.slice(i + 1)];
      }),
  );
test(
  'stage 8 real qualification lifecycle, S3, ClamAV, file ACL, taxonomy and service publication',
  { skip: process.env.SCHOLARS_TEST !== '1', timeout: 600000 },
  async () => {
    const config = env('identity-auth');
    assert.equal(config.AUTH_DEVELOPMENT, '1');
    assert.equal(config.AUTH_PUBLIC_URL, 'http://127.0.0.1:18886/vianoor');
    const key = config.AUTH_INTERNAL_KEY!,
      suffix = randomUUID().slice(0, 8),
      password = 'Stage08 test only passphrase 2026!';
    const auth = async (action: string, data: unknown, access = '') => {
      const res = await fetch('http://api-gateway:4100/api/v1/auth/' + action, {
        method: action === 'session' ? 'GET' : 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-key': key,
          'x-auth-client': 'stage08-' + suffix,
          authorization: 'Bearer ' + access,
        },
        ...(action === 'session' ? {} : { body: JSON.stringify(data) }),
      });
      return { status: res.status, body: await res.json() };
    };
    const api = async (path: string, access = '', method = 'GET', data?: unknown) => {
      const res = await fetch('http://api-gateway:4100/api/v2/' + path, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-internal-key': key,
          authorization: 'Bearer ' + access,
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
      return { status: res.status, body: await res.json() };
    };
    async function account(name: string) {
      const email = `stage08-${suffix}-${name}@example.test`;
      assert.equal((await auth('register', { email, password, locale: 'en' })).status, 200);
      let token = '';
      for (let i = 0; i < 100 && !token; i++) {
        const messages = await fetch('http://mailpit:8025/api/v1/messages').then((r) => r.json());
        for (const m of messages.messages ?? []) {
          if (!m.To?.some((to: { Address: string }) => to.Address === email)) continue;
          const d = await fetch('http://mailpit:8025/api/v1/message/' + m.ID).then((r) => r.json());
          token = d.Text?.match(/verify-email#token=([A-Za-z0-9_-]{43})/)?.[1] ?? '';
        }
        if (!token) await new Promise((r) => setTimeout(r, 250));
      }
      assert.ok(token);
      assert.equal((await auth('verify-email', { token })).status, 200);
      const login = await auth('login', { email, password });
      assert.equal(login.status, 200);
      const session = await auth('session', {}, login.body.data.access);
      return { ...session.body.data.user, ...login.body.data, email };
    }
    const admin = await account('reviewer'),
      expert = await account('expert'),
      outsider = await account('outsider');
    const org = new pg.Pool({ connectionString: env('organization-service').DATABASE_URL });
    try {
      await org.query(
        "INSERT INTO role_grants(account_id,public_id,role,scope) VALUES($1,$2,'admin','platform')",
        [admin.id, admin.public_id],
      );
    } finally {
      await org.end();
    }
    const taxonomy = await api('taxonomy', expert.access);
    assert.equal(taxonomy.status, 200);
    const language = taxonomy.body.data.find((x: { kind: string }) => x.kind === 'language').id;
    const taxon = {
      kind: 'specialty',
      label: { fa: 'تخصص آزمایشی', en: 'Test specialty' },
      parent_id: null,
      active: true,
      position: 0,
      icon: '',
      image_id: null,
    };
    assert.equal((await api('taxonomy', outsider.access, 'POST', taxon)).status, 403);
    const createdTaxon = await api('taxonomy', admin.access, 'POST', taxon);
    assert.equal(createdTaxon.status, 200);
    const specialty = createdTaxon.body.data.id;
    assert.equal(
      (
        await api('taxonomy/' + specialty, admin.access, 'PUT', {
          ...taxon,
          parent_id: specialty,
          revision: 0,
        })
      ).status,
      400,
    );
    const profile = {
      display_name: 'Stage 8 Test Expert',
      title: 'Teacher',
      slug: 'test-' + suffix,
      short_bio: 'Test introduction',
      biography: 'Professional test biography',
      education: 'Test education',
      experience: 'Test experience',
      years: 4,
      city: '',
      country: '',
      links: [],
      image_id: null,
      visibility: 'PUBLIC',
      seo_title: 'Test expert profile',
      seo_description: 'Test only',
      specialties: [specialty],
      languages: [{ id: language, level: 'NATIVE' }],
      viewpoints: [{ topic: 'Test topic', text: 'Professional approach' }],
    };
    const create = await api('experts/me', expert.access, 'POST', profile);
    assert.equal(create.status, 200, JSON.stringify(create.body));
    const scholarId = create.body.data.id;
    assert.equal((await api('experts/public/' + profile.slug)).status, 404);
    assert.equal((await api('experts/me/submit', expert.access, 'POST', {})).status, 409);
    assert.equal((await api('experts/admin/' + scholarId, outsider.access)).status, 403);
    const pdf = Buffer.from(
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
    );
    const upload = {
      name: 'degree.pdf',
      mime: 'application/pdf',
      purpose: 'document',
      access: 'OWNER_ONLY',
      base64: pdf.toString('base64'),
    };
    assert.equal(
      (
        await api('files/assets', expert.access, 'POST', {
          ...upload,
          base64: Buffer.from('MZ executable').toString('base64'),
        })
      ).status,
      400,
    );
    assert.equal(
      (await api('files/assets', expert.access, 'POST', { ...upload, access: 'PUBLIC' })).status,
      400,
    );
    const file = await api('files/assets', expert.access, 'POST', upload);
    assert.equal(file.status, 200, JSON.stringify(file.body));
    const fileId = file.body.data.id;
    assert.equal(
      (await api('files/assets/' + fileId + '/link', expert.access, 'POST', {})).status,
      409,
    );
    async function waitFile(id: string) {
      for (let i = 0; i < 210; i++) {
        const row = await api('files/assets/' + id, expert.access);
        assert.equal(row.status, 200);
        if (['READY', 'INFECTED', 'REJECTED'].includes(row.body.data.state)) return row.body.data;
        await new Promise((r) => setTimeout(r, 1000));
      }
      throw Error('Scanner did not complete within 210 seconds');
    }
    assert.equal((await waitFile(fileId)).state, 'READY');
    // Existing avatar API must retain its contract while writing into central object storage.
    const sharp = (await import('sharp')).default;
    const avatar = await sharp({
      create: { width: 16, height: 16, channels: 3, background: '#448877' },
    })
      .png()
      .toBuffer();
    const legacyImage = await api('files/images', expert.access, 'POST', {
      kind: 'avatar',
      base64: avatar.toString('base64'),
    });
    assert.equal(legacyImage.status, 200, JSON.stringify(legacyImage.body));
    assert.equal(
      (await api('files/images/' + legacyImage.body.data.id, expert.access)).status,
      200,
    );
    assert.equal(
      (await api('files/assets/' + fileId + '/link', outsider.access, 'POST', {})).status,
      403,
    );
    assert.equal((await api('files/public/' + fileId)).status, 404);
    const privateLink = (await api('files/assets/' + fileId + '/link', expert.access, 'POST', {}))
      .body.data.path;
    assert.equal((await api(privateLink, expert.access)).status, 200);
    assert.equal((await api(privateLink, outsider.access)).status, 403);
    assert.equal((await api(privateLink + 'x', expert.access)).status, 403);
    const doc = {
      kind: 'DEGREE',
      title: 'Test degree',
      issuer: 'Test institution',
      number: 'PRIVATE-TEST-NUMBER',
      issued_at: '2020-01-01',
      expires_at: '2030-01-01',
      file_id: fileId,
      description: 'Private test description',
      public_summary: true,
    };
    const savedDoc = await api('experts/me/documents', expert.access, 'POST', doc);
    assert.equal(savedDoc.status, 200, JSON.stringify(savedDoc.body));
    const documentId = savedDoc.body.data.id;
    assert.equal(
      (await api('files/assets/' + fileId + '/action', expert.access, 'POST', { action: 'DELETE' }))
        .status,
      409,
    );
    assert.equal((await api('experts/me/submit', expert.access, 'POST', {})).status, 200);
    const review = async (status: string) => {
      const current = await api('experts/admin/' + scholarId, admin.access);
      const result = await api('experts/admin/' + scholarId + '/review', admin.access, 'POST', {
        status,
        reason: 'Test review reason',
        internal_note: 'INTERNAL-ONLY-TEST',
        valid_until: status === 'APPROVED' ? '2030-01-01T00:00:00Z' : null,
        revision: current.body.data.revision,
      });
      return result;
    };
    assert.equal((await review('APPROVED')).status, 409);
    assert.equal((await review('UNDER_REVIEW')).status, 200);
    const locked = await api('experts/me', expert.access);
    assert.equal(
      (
        await api('experts/me', expert.access, 'PUT', {
          profile,
          revision: locked.body.data.revision,
        })
      ).status,
      409,
    );
    assert.equal((await review('APPROVED')).status, 409);
    assert.equal(
      (
        await api(
          `experts/admin/${scholarId}/documents/${documentId}/review`,
          admin.access,
          'POST',
          { status: 'APPROVED', reason: 'Document checked' },
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await api(
          `experts/admin/${scholarId}/specialties/${specialty}/review`,
          admin.access,
          'POST',
          { status: 'APPROVED', reason: 'Specialty checked' },
        )
      ).status,
      200,
    );
    assert.equal((await review('NEEDS_CHANGES')).status, 200);
    const correction = await api('experts/me', expert.access);
    assert.ok(
      correction.body.data.decisions.every((d: object) => !Object.hasOwn(d, 'internal_note')),
    );
    assert.equal((await api('experts/me/submit', expert.access, 'POST', {})).status, 200);
    assert.equal((await review('UNDER_REVIEW')).status, 200);
    assert.equal((await review('APPROVED')).status, 200);
    const workspaces = await api('access/me', expert.access);
    assert.ok(workspaces.body.data.workspaces.some((w: { role: string }) => w.role === 'expert'));
    const offering = {
      title: 'Test consultation',
      summary: 'Test service',
      description: 'Test details',
      kind: 'VIDEO',
      specialty_id: specialty,
      category_id: null,
      duration_minutes: 30,
      price_minor: 300000,
      currency: 'IRR',
      booking_required: true,
      image_id: null,
      terms: 'Test terms',
    };
    const service = await api('experts/me/services', expert.access, 'POST', offering);
    assert.equal(service.status, 200, JSON.stringify(service.body));
    const serviceId = service.body.data.id;
    assert.equal(
      (await api('experts/me/services/' + serviceId + '/publish', expert.access, 'POST', {}))
        .status,
      200,
    );
    assert.equal((await api('experts/public/' + profile.slug)).body.data.services.length, 0);
    assert.equal(
      (
        await api(`experts/admin/${scholarId}/services/${serviceId}/review`, admin.access, 'POST', {
          status: 'PUBLISHED',
          reason: 'Service checked',
          revision: 1,
        })
      ).status,
      200,
    );
    const published = await api('experts/public/' + profile.slug);
    assert.equal(published.status, 200);
    assert.equal(published.body.data.services.length, 1);
    assert.ok(!JSON.stringify(published.body).includes('PRIVATE-TEST-NUMBER'));
    assert.ok(!JSON.stringify(published.body).includes(fileId));
    assert.ok(!JSON.stringify(published.body).includes('INTERNAL-ONLY-TEST'));
    // Standard harmless antivirus test marker embedded in a document; never executable malware.
    const marker = [
      'X5O!P%@AP[4',
      '\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
    ].join('');
    process.env.CLAMD_HOST = 'scanner';
    assert.equal(
      await scan(Buffer.from(marker)),
      'INFECTED',
      'Stock ClamAV must detect the exact EICAR test file',
    );
    const infected = await api('files/assets', expert.access, 'POST', {
      ...upload,
      name: 'scanner-test.pdf',
      base64: Buffer.from('%PDF-1.4\nVIANOOR-ANTIVIRUS-INTEGRATION-TEST\n%%EOF').toString('base64'),
    });
    assert.equal(infected.status, 200);
    assert.equal((await waitFile(infected.body.data.id)).state, 'INFECTED');
    assert.equal(
      (await api('files/assets/' + infected.body.data.id + '/link', expert.access, 'POST', {}))
        .status,
      409,
    );
    assert.equal((await review('SUSPENDED')).status, 200);
    assert.equal((await api('experts/public/' + profile.slug)).status, 404);
    assert.equal((await api('experts/me/services', expert.access, 'POST', offering)).status, 409);
    assert.equal(
      (
        await api('files/assets/' + fileId + '/action', admin.access, 'POST', {
          action: 'QUARANTINE',
        })
      ).status,
      200,
    );
    assert.equal((await api(privateLink, expert.access)).status, 403);
    assert.equal(
      (await api('files/assets/' + fileId + '/action', admin.access, 'POST', { action: 'RESCAN' }))
        .status,
      200,
    );
    assert.equal((await waitFile(fileId)).state, 'READY');
    writeFileSync(
      '/test-output/scholars-browser.json',
      JSON.stringify({
        admin: { email: admin.email, password },
        expert: { email: expert.email, password },
        scholarId,
        slug: profile.slug,
        fileId,
      }),
      { mode: 0o600 },
    );
  },
);
