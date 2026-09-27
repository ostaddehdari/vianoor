import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
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
  'stage 10 real catalogue, publication, OpenSearch, event invalidation, cache ACL and multilingual matching',
  { skip: process.env.DISCOVERY_TEST !== '1', timeout: 600000 },
  async () => {
    const config = env('identity-auth');
    assert.equal(config.AUTH_DEVELOPMENT, '1');
    assert.equal(config.AUTH_PUBLIC_URL, 'http://127.0.0.1:18886/vianoor');
    const fixture = JSON.parse(readFileSync('/test-output/scholars-browser.json', 'utf8')),
      schedule = JSON.parse(readFileSync('/test-output/scheduling-browser.json', 'utf8'));
    const headers = {
      'content-type': 'application/json',
      'x-internal-key': config.AUTH_INTERNAL_KEY!,
    };
    const api = async (path: string, token = '', method = 'GET', body?: unknown) => {
      const res = await fetch('http://api-gateway:4100/api/v2/' + path, {
        method,
        headers: { ...headers, authorization: 'Bearer ' + token },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: res.status, body: await res.json() };
    };
    const ok = (result: { status: number; body: unknown }) =>
      assert.equal(result.status, 200, JSON.stringify(result.body));
    const login = async (account: unknown) => {
      const r = await fetch('http://api-gateway:4100/api/v1/auth/login', {
        method: 'POST',
        headers: { ...headers, 'x-auth-client': 'stage10-' + randomUUID() },
        body: JSON.stringify(account),
      });
      assert.equal(r.status, 200);
      return (await r.json()).data.access;
    };
    const admin = await login(fixture.admin),
      expert = await login(fixture.expert),
      suffix = randomUUID().slice(0, 8);
    const languages = await api('languages');
    ok(languages);
    assert.equal(languages.body.data.length, 147);
    assert.equal(new Set(languages.body.data.map((l: { code: string }) => l.code)).size, 147);
    assert.equal((await api('languages/zz')).status, 404);
    assert.equal((await api('localization/coverage', expert)).status, 403);
    assert.equal((await api('search/synonyms', expert)).status, 403);
    const coverage = await api('localization/coverage', admin);
    ok(coverage);
    assert.equal(coverage.body.data.length, 147);
    const initial = await api('localization/bundle?language=fr');
    ok(initial);
    assert.ok(initial.body.data.fallback_keys.length > 500);
    assert.equal(initial.body.data.language.direction, 'LTR');
    assert.equal(
      (await api('localization/bundle?language=ar')).body.data.language.direction,
      'RTL',
    );
    const key = 'acceptance.' + suffix;
    ok(
      await api('localization/keys', admin, 'POST', {
        key,
        module: 'acceptance',
        value: 'Welcome {name}',
      }),
    );
    let row = (await api('localization/keys?language=fr&query=' + key, admin)).body.data[0];
    assert.equal(
      (
        await api('localization/translation', admin, 'POST', {
          key_id: row.id,
          language: 'fr',
          value: 'Bonjour',
          source_revision: row.revision,
          revision: 0,
        })
      ).body.error.code,
      'PLACEHOLDER_MISMATCH',
    );
    ok(
      await api('localization/translation', admin, 'POST', {
        key_id: row.id,
        language: 'fr',
        value: 'Bonjour {name}',
        source_revision: row.revision,
        revision: 0,
      }),
    );
    assert.equal(
      (await api('localization/translation?language=fr&key=' + key)).body.data.value,
      'Welcome {name}',
    );
    for (const status of ['HUMAN_REVIEWED', 'APPROVED']) {
      row = (await api('localization/keys?language=fr&query=' + key, admin)).body.data[0];
      ok(
        await api('localization/review', admin, 'POST', {
          key_id: row.id,
          language: 'fr',
          status,
          revision: row.translation_revision,
        }),
      );
    }
    assert.equal(
      (await api('localization/translation?language=fr&key=' + key)).body.data.value,
      'Bonjour {name}',
    );
    row = (await api('localization/keys?language=fr&query=' + key, admin)).body.data[0];
    ok(
      await api('localization/translation', admin, 'POST', {
        key_id: row.id,
        language: 'fr',
        value: 'Salut {name}',
        source_revision: row.revision,
        revision: row.translation_revision,
      }),
    );
    assert.equal(
      (await api('localization/translation?language=fr&key=' + key)).body.data.value,
      'Bonjour {name}',
    );
    ok(
      await api('localization/keys/' + row.id, admin, 'PUT', {
        value: 'Hello {name}',
        revision: row.revision,
      }),
    );
    assert.equal(
      (await api('localization/translation?language=fr&key=' + key)).body.data.value,
      'Hello {name}',
    );
    row = (await api('localization/keys?language=fr&query=' + key, admin)).body.data[0];
    assert.equal(
      (
        await api('localization/review', admin, 'POST', {
          key_id: row.id,
          language: 'fr',
          status: 'HUMAN_REVIEWED',
          revision: row.translation_revision,
        })
      ).body.error.code,
      'STALE_SOURCE',
    );
    ok(await api('localization/jobs', admin, 'POST', { key_id: row.id, target_language: 'ar' }));
    assert.equal(
      (await api('localization/jobs', admin)).body.data[0].status,
      'WAITING_FOR_PROVIDER',
    );
    ok(await api('profiles/language', expert, 'PUT', { language: 'fr' }));
    assert.equal((await api('profiles/language', expert)).body.data.language, 'fr');
    async function approveFixture() {
      let current = (await api('experts/admin/' + fixture.scholarId, admin)).body.data;
      if (current.status === 'DRAFT') ok(await api('experts/me/submit', expert, 'POST', {}));
      for (const status of ['UNDER_REVIEW', 'APPROVED']) {
        current = (await api('experts/admin/' + fixture.scholarId, admin)).body.data;
        if (current.status === 'APPROVED') break;
        ok(
          await api('experts/admin/' + fixture.scholarId + '/review', admin, 'POST', {
            status,
            revision: current.revision,
            reason: 'Stage 10 synthetic fixture',
            internal_note: '',
            valid_until: null,
          }),
        );
      }
    }
    await approveFixture();
    let scholar = (await api('experts/admin/' + fixture.scholarId, admin)).body.data;
    assert.equal(scholar.status, 'APPROVED');
    const original = { ...scholar.profile };
    const profile = {
      ...original,
      source_language: 'en',
      title: 'Family counseling ' + suffix,
      short_bio: 'Family counseling and parenting',
      visibility: 'PUBLIC',
    };
    ok(await api('experts/me', expert, 'PUT', { profile, revision: scholar.revision }));
    await approveFixture();
    let source = (await api('experts/translations?kind=expert&id=' + scholar.id, expert)).body.data;
    assert.ok(!('contact_phone' in source.source));
    assert.equal((await api('experts/translations?kind=expert&id=' + scholar.id, '')).status, 401);
    const translated = {
      ...source.source,
      title: 'مشاوره خانواده ' + suffix,
      short_bio: 'همراهی خانواده و فرزند',
    };
    ok(
      await api('experts/translations', expert, 'POST', {
        kind: 'expert',
        id: scholar.id,
        language: 'fa',
        fields: translated,
        source_hash: source.source_hash,
        revision:
          source.translations.find((x: { language: string }) => x.language === 'fa')?.revision ?? 0,
      }),
    );
    for (const status of ['HUMAN_REVIEWED', 'APPROVED']) {
      source = (await api('experts/translations?kind=expert&id=' + scholar.id, expert)).body.data;
      const translation = source.translations.find(
        (x: { language: string }) => x.language === 'fa',
      );
      ok(
        await api('experts/translations/review', admin, 'POST', {
          kind: 'expert',
          id: scholar.id,
          language: 'fa',
          revision: translation.revision,
          status,
        }),
      );
    }
    const detail = await api('experts/public/' + scholar.slug + '?language=fa');
    ok(detail);
    assert.equal(detail.body.data.profile.title, translated.title);
    assert.ok(!('contact_phone' in detail.body.data.profile));
    const specialty = scholar.profile.specialties[0];
    let tx = (await api('localization/specialties?id=' + specialty + '&language=ar', admin)).body
      .data;
    ok(
      await api('localization/specialties', admin, 'POST', {
        id: specialty,
        language: 'ar',
        value: 'الإرشاد الأسري',
        source_revision: tx.source.revision,
        revision: tx.translation?.revision ?? 0,
      }),
    );
    for (const status of ['HUMAN_REVIEWED', 'APPROVED']) {
      tx = (await api('localization/specialties?id=' + specialty + '&language=ar', admin)).body
        .data;
      ok(
        await api('localization/specialties/review', admin, 'POST', {
          id: specialty,
          language: 'ar',
          status,
          revision: tx.translation.revision,
        }),
      );
    }
    const phrase = 'پیوند ' + suffix;
    ok(
      await api('search/synonyms', admin, 'POST', {
        source: phrase,
        target: 'family counseling',
        source_language: 'fa',
        target_language: 'en',
        active: true,
      }),
    );
    async function until(predicate: () => Promise<boolean>, label: string) {
      for (let i = 0; i < 90; i++) {
        if (await predicate()) return;
        await new Promise((r) => setTimeout(r, 1000));
      }
      assert.fail(label);
    }
    const query = 'search/experts?language=fa&q=' + encodeURIComponent(phrase);
    await until(async () => {
      const r = await api(query);
      return (
        r.status === 200 &&
        r.body.data.items.some((x: { code: string }) => x.code === scholar.public_id)
      );
    }, 'event indexing and cross-language synonym search');
    const arabic = await api(
      'search/experts?language=ar&q=' + encodeURIComponent('الإرشاد الأسري'),
    );
    ok(arabic);
    assert.ok(arabic.body.data.items.some((x: { code: string }) => x.code === scholar.public_id));
    const result = await api(query);
    assert.equal(
      result.body.data.items.find((x: { code: string }) => x.code === scholar.public_id).profile
        .title,
      translated.title,
    );
    // A cached hit must not bypass the source owner's current visibility.
    scholar = (await api('experts/admin/' + fixture.scholarId, admin)).body.data;
    ok(
      await api('experts/me', expert, 'PUT', {
        profile: { ...profile, visibility: 'HIDDEN' },
        revision: scholar.revision,
      }),
    );
    assert.ok(
      !(await api(query)).body.data.items.some(
        (x: { code: string }) => x.code === scholar.public_id,
      ),
    );
    scholar = (await api('experts/admin/' + fixture.scholarId, admin)).body.data;
    ok(
      await api('experts/me', expert, 'PUT', {
        profile: { ...profile, title: 'Changed English ' + suffix },
        revision: scholar.revision,
      }),
    );
    await approveFixture();
    assert.equal(
      (await api('experts/public/' + scholar.slug + '?language=fa')).body.data.profile.title,
      'Changed English ' + suffix,
    );
    // Genuine scheduling owner resolution rejects DST gaps instead of guessing an instant.
    const gap = await api('matching/expert', admin, 'POST', {
      intent: '',
      language: 'en',
      spoken_language: 'en',
      local: '2027-03-14T02:30',
      timezone: 'America/New_York',
    });
    assert.equal(gap.body.error.code, 'AMBIGUOUS_OR_INVALID_TIME');
    const searchDb = new pg.Pool({ connectionString: env('search-service').DATABASE_URL });
    try {
      assert.ok(
        Number(
          (
            await searchDb.query(
              "SELECT count(*) FROM infra_inbox WHERE consumer='discovery-index'",
            )
          ).rows[0].count,
        ) > 0,
      );
    } finally {
      await searchDb.end();
    }
    // Preserve a public synthetic fixture for browser verification.
    scholar = (await api('experts/admin/' + fixture.scholarId, admin)).body.data;
    ok(await api('experts/me', expert, 'PUT', { profile, revision: scholar.revision }));
    await approveFixture();
    await until(async () => {
      const r = await api('search/experts?language=en&q=family');
      return (
        r.status === 200 &&
        r.body.data.items.some((x: { code: string }) => x.code === scholar.public_id)
      );
    }, 'restored fixture indexed');
    const available = await api(
      'availability/slots?' +
        new URLSearchParams({
          expert: schedule.expertCode,
          service: schedule.serviceId,
          from: schedule.date + 'T00:00:00Z',
          to: new Date(Date.parse(schedule.date + 'T00:00:00Z') + 86400000).toISOString(),
          timezone: 'UTC',
        }),
      admin,
    );
    ok(available);
    assert.ok(available.body.data.slots.length, 'Real free slot available');
    const spoken = languages.body.data.find(
      (l: { id: string }) => l.id === scholar.profile.languages[0].id,
    ).code;
    const matched = await api('matching/expert', admin, 'POST', {
      intent: 'family',
      language: 'en',
      spoken_language: spoken,
      local: available.body.data.slots[0].start_at.slice(0, 16),
      timezone: 'UTC',
    });
    ok(matched);
    assert.ok(
      matched.body.data.items.some(
        (x: { code: string; available: unknown[] }) =>
          x.code === scholar.public_id && x.available.length,
      ),
    );
    let serviceSource = (
      await api('experts/translations?kind=service&id=' + schedule.serviceId, expert)
    ).body.data;
    ok(
      await api('experts/translations', expert, 'POST', {
        kind: 'service',
        id: schedule.serviceId,
        language: 'fr',
        fields: { ...serviceSource.source, title: 'Consultation familiale' },
        source_hash: serviceSource.source_hash,
        revision:
          serviceSource.translations.find((x: { language: string }) => x.language === 'fr')
            ?.revision ?? 0,
      }),
    );
    for (const status of ['HUMAN_REVIEWED', 'APPROVED']) {
      serviceSource = (
        await api('experts/translations?kind=service&id=' + schedule.serviceId, expert)
      ).body.data;
      ok(
        await api('experts/translations/review', admin, 'POST', {
          kind: 'service',
          id: schedule.serviceId,
          language: 'fr',
          status,
          revision: serviceSource.translations.find(
            (x: { language: string }) => x.language === 'fr',
          ).revision,
        }),
      );
    }
    assert.equal(
      (await api('experts/public/' + scholar.slug + '?language=fr')).body.data.services.find(
        (s: { id: string }) => s.id === schedule.serviceId,
      ).details.title,
      'Consultation familiale',
    );
    console.log(
      'Stage 10 acceptance: 147 languages; publish/review/source invalidation; real OpenSearch+NATS+Redis; owner ACL; DST rejection. Scheduling fixture:',
      !!schedule.serviceId,
    );
  },
);
