import pg from 'pg';
import argon2 from 'argon2';

import {
  createHash,
} from 'node:crypto';

import {
  writeFile,
} from 'node:fs/promises';

import {
  sealJson,
} from '@vianoor/service-runtime';

import {
  createClient,
} from 'redis';

const {
  Pool,
} = pg;

const SEED =
  process.env.SEED_NAME ??
  'DEMO-SEED-21';

const OUTPUT =
  process.env.SEED_OUTPUT ??
  '/out';

const ACCOUNT_EMAIL =
  'dashboard-account@srun.ir';

const ACCOUNT_PASSWORD =
  'DemoAccount!2026#Vianoor';

const EXPERT_PASSWORD =
  'DemoExpert!2026#Vianoor';

function required(name) {
  const value =
    process.env[name];

  if (!value)
    throw new Error(
      `Missing ${name}`,
    );

  return value;
}

const pools = {};

function db(name) {
  if (!pools[name]) {
    pools[name] =
      new Pool({
        connectionString:
          required(
            name +
            '_DATABASE_URL',
          ),

        max:
          3,

        idleTimeoutMillis:
          5000,
      });
  }

  return pools[name];
}

function uuid(label) {
  const hex =
    createHash('sha256')
      .update(
        `${SEED}:${label}`,
      )
      .digest('hex')
      .slice(
        0,
        32,
      )
      .split('');

  hex[12] =
    '4';

  hex[16] =
    ['8', '9', 'a', 'b'][
      parseInt(
        hex[16],
        16,
      ) % 4
    ];

  const value =
    hex.join('');

  return [
    value.slice(0, 8),
    value.slice(8, 12),
    value.slice(12, 16),
    value.slice(16, 20),
    value.slice(20),
  ].join('-');
}

function expertCode(index) {
  return (
    'D21E' +
    String(index)
      .padStart(
        9,
        '0',
      )
  );
}

function clientCode(index) {
  return (
    'D21C' +
    String(index)
      .padStart(
        9,
        '0',
      )
  );
}

const now =
  Date.now();

const iso = (ms) =>
  new Date(ms)
    .toISOString();

function sourceHash(fields) {
  return createHash(
    'sha256',
  )
    .update(
      JSON.stringify(
        Object.entries(
          fields,
        ).sort(
          ([a], [b]) =>
            a.localeCompare(
              b,
            ),
        ),
      ),
    )
    .digest(
      'hex',
    );
}

function expertTextFields(profile) {
  const names = [
    'display_name',
    'title',
    'short_bio',
    'biography',
    'experience',
    'education',
    'city',
    'country',
    'seo_title',
    'seo_description',
  ];

  return Object.fromEntries(
    names.map(
      (key) => [
        key,
        typeof profile[key] ===
          'string'
          ? profile[key]
          : '',
      ],
    ),
  );
}

function serviceTextFields(details) {
  return Object.fromEntries(
    [
      'title',
      'summary',
      'description',
      'terms',
    ].map(
      (key) => [
        key,
        typeof details[key] ===
          'string'
          ? details[key]
          : '',
      ],
    ),
  );
}

async function tableExists(
  pool,
  name,
) {
  const row =
    (
      await pool.query(
        `SELECT to_regclass($1) AS name`,
        [name],
      )
    ).rows[0];

  return Boolean(
    row?.name,
  );
}

async function ensureIdentity({
  id,
  publicId,
  email,
  passwordHash,
}) {
  const identity =
    db('IDENTITY');

  const collision =
    (
      await identity.query(
        `SELECT email
           FROM identity_accounts
          WHERE public_id=$1
            AND email<>$2`,
        [
          publicId,
          email,
        ],
      )
    ).rows[0];

  if (collision)
    throw new Error(
      `Public ID collision ${publicId}`,
    );

  await identity.query(
    `INSERT INTO identity_accounts(
       id,
       email,
       password_hash,
       verified_at,
       public_id,
       disabled_at
     )
     VALUES(
       $1,$2,$3,now(),$4,NULL
     )
     ON CONFLICT(email)
     DO UPDATE SET
       password_hash=EXCLUDED.password_hash,
       verified_at=COALESCE(
         identity_accounts.verified_at,
         now()
       ),
       disabled_at=NULL
     `,
    [
      id,
      email,
      passwordHash,
      publicId,
    ],
  );

  return (
    await identity.query(
      `SELECT
         id,
         email,
         public_id
       FROM identity_accounts
       WHERE email=$1`,
      [
        email,
      ],
    )
  ).rows[0];
}

async function main() {
  console.log(
    '========================================',
  );

  console.log(
    ' DEMO SEED:',
    SEED,
  );

  console.log(
    '========================================',
  );

  const identity =
    db('IDENTITY');

  const profileDb =
    db('PROFILE');

  const organization =
    db('ORGANIZATION');

  const taxonomy =
    db('TAXONOMY');

  const scholar =
    db('SCHOLAR');

  const availability =
    db('AVAILABILITY');

  const qa =
    db('QA');

  const booking =
    db('BOOKING');

  const messaging =
    db('MESSAGING');

  const payment =
    db('PAYMENT');

  const ratingDb =
    db('RATING');

  const search =
    db('SEARCH');

  const before =
    (
      await identity.query(
        `SELECT *
           FROM identity_accounts
          WHERE email=$1`,
        [
          ACCOUNT_EMAIL,
        ],
      )
    ).rows[0] ??
    null;

  await writeFile(
    `${OUTPUT}/dashboard-account-before.json`,
    JSON.stringify(
      before,
      null,
      2,
    ),
    {
      mode:
        0o600,
    },
  );

  console.log(
    'Creating password hashes...',
  );

  const accountHash =
    await argon2.hash(
      ACCOUNT_PASSWORD,
      {
        type:
          argon2.argon2id,

        memoryCost:
          19456,

        timeCost:
          2,

        parallelism:
          1,
      },
    );

  const expertHash =
    await argon2.hash(
      EXPERT_PASSWORD,
      {
        type:
          argon2.argon2id,

        memoryCost:
          19456,

        timeCost:
          2,

        parallelism:
          1,
      },
    );

  /*
   * -----------------------------------------------------
   * Client account
   * -----------------------------------------------------
   */

  let accountRow =
    (
      await identity.query(
        `SELECT
           id,
           email,
           public_id
         FROM identity_accounts
         WHERE email=$1`,
        [
          ACCOUNT_EMAIL,
        ],
      )
    ).rows[0];

  if (accountRow) {
    await identity.query(
      `UPDATE identity_accounts
          SET password_hash=$2,
              verified_at=COALESCE(
                verified_at,
                now()
              ),
              disabled_at=NULL
        WHERE id=$1`,
      [
        accountRow.id,
        accountHash,
      ],
    );
  } else {
    accountRow =
      await ensureIdentity({
        id:
          uuid(
            'dashboard-account',
          ),

        publicId:
          'D21A000000001',

        email:
          ACCOUNT_EMAIL,

        passwordHash:
          accountHash,
      });
  }

  console.log(
    'Client:',
    accountRow.email,
    accountRow.public_id,
  );

  /*
   * Additional demo clients for Q&A variety.
   */

  const clients = [
    accountRow,
  ];

  for (
    let i = 1;
    i <= 5;
    i++
  ) {
    const row =
      await ensureIdentity({
        id:
          uuid(
            `client-${i}`,
          ),

        publicId:
          clientCode(
            i,
          ),

        email:
          `demo21-client-${String(
            i,
          ).padStart(
            2,
            '0',
          )}@srun.ir`,

        passwordHash:
          expertHash,
      });

    clients.push(
      row,
    );
  }

  /*
   * -----------------------------------------------------
   * User profiles
   * -----------------------------------------------------
   */

  const userProfiles = [
    {
      account:
        accountRow,

      name:
        'کاربر آزمایشی ویانور',
    },

    ...clients
      .slice(
        1,
      )
      .map(
        (
          account,
          index,
        ) => ({
          account,

          name:
            `مراجع آزمایشی ${index + 1}`,
        }),
      ),
  ];

  for (
    const item
    of userProfiles
  ) {
    await profileDb.query(
      `INSERT INTO profiles(
         account_id,
         public_id,
         display_name,
         avatar
       )
       VALUES(
         $1,$2,$3,$4
       )
       ON CONFLICT(account_id)
       DO UPDATE SET
         display_name=EXCLUDED.display_name,
         updated_at=now()`,
      [
        item.account.id,
        item.account.public_id,
        item.name,
        {
          kind:
            'preset',

          value:
            '1',
        },
      ],
    );
  }

  /*
   * -----------------------------------------------------
   * Languages
   * -----------------------------------------------------
   */

  const desiredLanguageCodes = [
    'fa',
    'en',
    'ar',
    'tr',
    'az',
    'ur',
    'fr',
    'de',
    'es',
    'ru',
  ];

  const languageBefore =
    (
      await taxonomy.query(
        `SELECT
           l.id,
           l.code,
           l.status,
           t.active
         FROM languages l
         LEFT JOIN taxonomy_entries t
           ON t.id=l.id
         WHERE l.code=ANY($1::text[])
         ORDER BY l.code`,
        [
          desiredLanguageCodes,
        ],
      )
    ).rows;

  await writeFile(
    `${OUTPUT}/languages-before.json`,
    JSON.stringify(
      languageBefore,
      null,
      2,
    ),
    {
      mode:
        0o600,
    },
  );

  await taxonomy.query(
    `UPDATE languages
        SET status='ACTIVE'
      WHERE code=ANY($1::text[])`,
    [
      desiredLanguageCodes,
    ],
  );

  await taxonomy.query(
    `UPDATE taxonomy_entries
        SET active=true
      WHERE id IN(
        SELECT id
        FROM languages
        WHERE code=ANY($1::text[])
      )`,
    [
      desiredLanguageCodes,
    ],
  );

  let languages =
    (
      await taxonomy.query(
        `SELECT
           id,
           code,
           name_en,
           native_name
         FROM languages
         WHERE code=ANY($1::text[])
           AND status='ACTIVE'
         ORDER BY
           array_position(
             $1::text[],
             code
           )`,
        [
          desiredLanguageCodes,
        ],
      )
    ).rows;

  if (
    languages.length <
    2
  )
    throw new Error(
      'Not enough active languages',
    );

  console.log(
    'Languages:',
    languages
      .map(
        (x) =>
          x.code,
      )
      .join(
        ', ',
      ),
  );

  /*
   * -----------------------------------------------------
   * Demo taxonomy
   * -----------------------------------------------------
   */

  const specialtySeed = [
    [
      'خانواده و ازدواج',
      'Family & Marriage',
    ],

    [
      'تربیت کودک',
      'Parenting',
    ],

    [
      'اعتقادات',
      'Beliefs',
    ],

    [
      'اخلاق و معنویت',
      'Ethics & Spirituality',
    ],

    [
      'احکام',
      'Religious Rulings',
    ],

    [
      'نوجوان و جوان',
      'Youth',
    ],

    [
      'سلامت روان و دین',
      'Mental Wellbeing & Faith',
    ],

    [
      'روابط اجتماعی',
      'Social Relations',
    ],
  ];

  const categorySeed = [
    [
      'خانواده',
      'Family',
    ],

    [
      'معنویت',
      'Spirituality',
    ],

    [
      'رشد فردی',
      'Personal Growth',
    ],

    [
      'تربیت',
      'Education',
    ],

    [
      'نیاز فوری',
      'Urgent Guidance',
    ],
  ];

  const specialtyIds = [];

  for (
    let i = 0;
    i <
    specialtySeed.length;
    i++
  ) {
    const id =
      uuid(
        `specialty-${i + 1}`,
      );

    specialtyIds.push(
      id,
    );

    await taxonomy.query(
      `INSERT INTO taxonomy_entries(
         id,
         kind,
         label,
         parent_id,
         active,
         position,
         icon,
         image_id,
         revision
       )
       VALUES(
         $1,
         'specialty',
         $2,
         NULL,
         true,
         $3,
         'sparkles',
         NULL,
         1
       )
       ON CONFLICT(id)
       DO UPDATE SET
         label=EXCLUDED.label,
         active=true,
         position=EXCLUDED.position,
         icon=EXCLUDED.icon`,
      [
        id,
        {
          fa:
            specialtySeed[i][0],

          en:
            specialtySeed[i][1],
        },

        2100 + i,
      ],
    );
  }

  const categoryIds = [];

  for (
    let i = 0;
    i <
    categorySeed.length;
    i++
  ) {
    const id =
      uuid(
        `category-${i + 1}`,
      );

    categoryIds.push(
      id,
    );

    await taxonomy.query(
      `INSERT INTO taxonomy_entries(
         id,
         kind,
         label,
         parent_id,
         active,
         position,
         icon,
         image_id,
         revision
       )
       VALUES(
         $1,
         'category',
         $2,
         NULL,
         true,
         $3,
         'sparkles',
         NULL,
         1
       )
       ON CONFLICT(id)
       DO UPDATE SET
         label=EXCLUDED.label,
         active=true,
         position=EXCLUDED.position,
         icon=EXCLUDED.icon`,
      [
        id,

        {
          fa:
            categorySeed[i][0],

          en:
            categorySeed[i][1],
        },

        2200 + i,
      ],
    );
  }

  /*
   * -----------------------------------------------------
   * 20 Experts
   * -----------------------------------------------------
   */

  const expertSeed = [
    [
      'دکتر مریم رضایی',
      'Dr. Maryam Rezaei',
    ],
    [
      'حجت‌الاسلام علی نوری',
      'Ali Nouri',
    ],
    [
      'دکتر سارا مهران',
      'Dr. Sara Mehran',
    ],
    [
      'دکتر محمد امینی',
      'Dr. Mohammad Amini',
    ],
    [
      'دکتر نرگس سلیمانی',
      'Dr. Narges Soleimani',
    ],
    [
      'حجت‌الاسلام رضا موسوی',
      'Reza Mousavi',
    ],
    [
      'دکتر الهام فرهمند',
      'Dr. Elham Farahmand',
    ],
    [
      'دکتر حسین کریمی',
      'Dr. Hossein Karimi',
    ],
    [
      'دکتر زینب حیدری',
      'Dr. Zeinab Heydari',
    ],
    [
      'دکتر امیر صالحی',
      'Dr. Amir Salehi',
    ],
    [
      'دکتر فاطمه رحمانی',
      'Dr. Fatemeh Rahmani',
    ],
    [
      'دکتر یوسف مدنی',
      'Dr. Yousef Madani',
    ],
    [
      'دکتر لیلا توکلی',
      'Dr. Leila Tavakoli',
    ],
    [
      'حجت‌الاسلام مهدی صادقی',
      'Mehdi Sadeghi',
    ],
    [
      'دکتر شیما اکبری',
      'Dr. Shima Akbari',
    ],
    [
      'دکتر احمد قاسمی',
      'Dr. Ahmad Ghasemi',
    ],
    [
      'دکتر مهسا رستگار',
      'Dr. Mahsa Rastegar',
    ],
    [
      'دکتر حمید زمانی',
      'Dr. Hamid Zamani',
    ],
    [
      'دکتر پریسا کاظمی',
      'Dr. Parisa Kazemi',
    ],
    [
      'حجت‌الاسلام سعید حسینی',
      'Saeed Hosseini',
    ],
  ];

  const countries = [
    [
      'تهران',
      'ایران',
      'Tehran',
      'Iran',
      'Asia/Tehran',
    ],

    [
      'قم',
      'ایران',
      'Qom',
      'Iran',
      'Asia/Tehran',
    ],

    [
      'باکو',
      'آذربایجان',
      'Baku',
      'Azerbaijan',
      'Asia/Baku',
    ],

    [
      'استانبول',
      'ترکیه',
      'Istanbul',
      'Türkiye',
      'Europe/Istanbul',
    ],

    [
      'دبی',
      'امارات',
      'Dubai',
      'United Arab Emirates',
      'Asia/Dubai',
    ],

    [
      'لندن',
      'بریتانیا',
      'London',
      'United Kingdom',
      'Europe/London',
    ],
  ];

  const experts = [];

  for (
    let i = 1;
    i <= 20;
    i++
  ) {
    const accountId =
      uuid(
        `expert-account-${i}`,
      );

    const scholarId =
      uuid(
        `scholar-${i}`,
      );

    const publicId =
      expertCode(
        i,
      );

    const slug =
      `demo21-expert-${String(
        i,
      ).padStart(
        2,
        '0',
      )}`;

    const email =
      `${slug}@srun.ir`;

    const account =
      await ensureIdentity({
        id:
          accountId,

        publicId,

        email,

        passwordHash:
          expertHash,
      });

    await organization.query(
      `INSERT INTO role_grants(
         account_id,
         public_id,
         role,
         scope
       )
       VALUES(
         $1,$2,'expert','platform'
       )
       ON CONFLICT DO NOTHING`,
      [
        account.id,
        account.public_id,
      ],
    );

    await profileDb.query(
      `INSERT INTO profiles(
         account_id,
         public_id,
         display_name,
         avatar
       )
       VALUES(
         $1,$2,$3,$4
       )
       ON CONFLICT(account_id)
       DO UPDATE SET
         display_name=EXCLUDED.display_name,
         updated_at=now()`,
      [
        account.id,
        account.public_id,
        expertSeed[i - 1][0],

        {
          kind:
            'preset',

          value:
            String(
              ((i - 1) % 8) +
                1,
            ),
        },
      ],
    );

    const primary =
      languages[
        (i - 1) %
          languages.length
      ];

    const second =
      languages[
        i %
          languages.length
      ];

    const third =
      languages.find(
        (language) =>
          language.code ===
          'fa',
      ) ??
      languages[0];

    const uniqueLanguageIds =
      [
        primary,
        second,
        third,
      ].filter(
        (
          current,
          index,
          all,
        ) =>
          all.findIndex(
            (other) =>
              other.id ===
              current.id,
          ) === index,
      );

    const s1 =
      specialtyIds[
        (i - 1) %
          specialtyIds.length
      ];

    const s2 =
      specialtyIds[
        (i + 2) %
          specialtyIds.length
      ];

    const location =
      countries[
        (i - 1) %
          countries.length
      ];

    const faName =
      expertSeed[i - 1][0];

    const enName =
      expertSeed[i - 1][1];

    const faTitle =
      [
        'مشاور خانواده و روابط',
        'پژوهشگر معارف اسلامی',
        'مشاور تربیت و نوجوان',
        'مشاور اخلاق و معنویت',
      ][
        (i - 1) %
          4
      ];

    const enTitle =
      [
        'Family & Relationship Counselor',
        'Islamic Studies Researcher',
        'Parenting & Youth Counselor',
        'Ethics & Spirituality Counselor',
      ][
        (i - 1) %
          4
      ];

    const profileSource = {
      source_language:
        'en',

      display_name:
        enName,

      contact_phone:
        '',

      title:
        enTitle,

      slug,

      short_bio:
        `Experienced Vianoor expert in ${enTitle.toLowerCase()} with a practical, respectful approach.`,

      biography:
        `This is a comprehensive demo expert profile created for Vianoor acceptance testing. Expert number ${i} provides structured consultation and written guidance.`,

      experience:
        `${8 + (i % 15)} years of consultation, teaching and research experience.`,

      education:
        i % 3 === 0
          ? 'Doctorate-level studies and advanced seminary education.'
          : 'Advanced university and professional studies in the relevant field.',

      years:
        8 +
        (
          i %
          15
        ),

      city:
        location[2],

      country:
        location[3],

      links: [
        `https://example.com/${slug}`,
      ],

      image_id:
        null,

      visibility:
        'PUBLIC',

      seo_title:
        `${enName} | Vianoor`,

      seo_description:
        `Consult ${enName} on Vianoor.`,

      specialties: [
        s1,
        s2,
      ],

      languages:
        uniqueLanguageIds.map(
          (
            language,
            index,
          ) => ({
            id:
              language.id,

            level:
              index === 0
                ? 'NATIVE'
                : index === 1
                  ? 'FLUENT'
                  : 'CONVERSATIONAL',
          }),
        ),

      viewpoints: [
        {
          topic:
            'Consultation approach',

          text:
            'Respectful dialogue, clear problem definition and practical next steps.',
        },

        {
          topic:
            'Privacy',

          text:
            'Confidentiality and informed user choice are central to the consultation process.',
        },
      ],
    };

    const validUntil =
      iso(
        now +
          365 *
            86400000,
      );

    await scholar.query(
      `INSERT INTO scholars(
         id,
         account_id,
         public_id,
         slug,
         profile,
         status,
         revision,
         valid_until,
         submitted_at,
         created_at,
         updated_at
       )
       VALUES(
         $1,$2,$3,$4,$5,
         'APPROVED',
         3,
         $6,
         now()-interval '90 days',
         now()-interval '120 days',
         now()
       )
       ON CONFLICT(id)
       DO UPDATE SET
         slug=EXCLUDED.slug,
         profile=EXCLUDED.profile,
         status='APPROVED',
         valid_until=EXCLUDED.valid_until,
         updated_at=now()`,
      [
        scholarId,
        account.id,
        publicId,
        slug,
        profileSource,
        validUntil,
      ],
    );

    for (
      const specialtyId
      of [
        s1,
        s2,
      ]
    ) {
      await scholar.query(
        `INSERT INTO scholar_specialties(
           scholar_id,
           specialty_id,
           status,
           reason
         )
         VALUES(
           $1,$2,'APPROVED','${SEED}'
         )
         ON CONFLICT(
           scholar_id,
           specialty_id
         )
         DO UPDATE SET
           status='APPROVED',
           reason=EXCLUDED.reason`,
        [
          scholarId,
          specialtyId,
        ],
      );
    }

    const documentId =
      uuid(
        `expert-document-${i}`,
      );

    await scholar.query(
      `INSERT INTO scholar_documents(
         id,
         scholar_id,
         details,
         status,
         reason,
         created_at
       )
       VALUES(
         $1,$2,$3,
         'APPROVED',
         $4,
         now()-interval '80 days'
       )
       ON CONFLICT(id)
       DO UPDATE SET
         details=EXCLUDED.details,
         status='APPROVED',
         reason=EXCLUDED.reason`,
      [
        documentId,
        scholarId,

        {
          kind:
            i % 2
              ? 'DEGREE'
              : 'SEMINARY',

          title:
            i % 2
              ? 'مدرک تخصصی تأییدشده'
              : 'گواهی تحصیلات حوزوی',

          issuer:
            'Vianoor Demo Verification',

          number:
            `DEMO21-${i}`,

          issued_at:
            '2020-01-01',

          expires_at:
            null,

          file_id:
            uuid(
              `fake-public-document-file-${i}`,
            ),

          description:
            'مدرک نمایشی برای آزمون رابط عمومی استاد.',

          public_summary:
            true,
        },

        SEED,
      ],
    );

    const profileFields =
      expertTextFields(
        profileSource,
      );

    const profileHash =
      sourceHash(
        profileFields,
      );

    const faFields = {
      display_name:
        faName,

      title:
        faTitle,

      short_bio:
        `استاد تأییدشده ویانور در زمینهٔ ${faTitle} با رویکرد کاربردی و محترمانه.`,

      biography:
        `این پروفایل جامع برای آزمون واقعی رابط ویانور ایجاد شده است. ${faName} در حوزهٔ ${faTitle} فعالیت می‌کند و برای مشاوره فردی و پاسخ‌گویی علمی در دسترس است.`,

      experience:
        `${8 + (i % 15)} سال سابقه مشاوره، آموزش و پژوهش.`,

      education:
        i % 3 === 0
          ? 'تحصیلات تکمیلی دانشگاهی و حوزوی.'
          : 'تحصیلات تخصصی دانشگاهی و حرفه‌ای در حوزه مرتبط.',

      city:
        location[0],

      country:
        location[1],

      seo_title:
        `${faName} | ویانور`,

      seo_description:
        `مشاوره با ${faName} در ویانور.`,
    };

    const enFields =
      profileFields;

    for (
      const [
        language,
        fields,
      ]
      of [
        [
          'fa',
          faFields,
        ],

        [
          'en',
          enFields,
        ],
      ]
    ) {
      await scholar.query(
        `INSERT INTO expert_translations(
           expert_id,
           language,
           fields,
           status,
           source_hash,
           revision,
           published_fields,
           published_source_hash,
           updated_at
         )
         VALUES(
           $1,$2,$3,
           'APPROVED',
           $4,
           1,
           $3,
           $4,
           now()
         )
         ON CONFLICT(
           expert_id,
           language
         )
         DO UPDATE SET
           fields=EXCLUDED.fields,
           status='APPROVED',
           source_hash=EXCLUDED.source_hash,
           published_fields=EXCLUDED.published_fields,
           published_source_hash=EXCLUDED.published_source_hash,
           updated_at=now()`,
        [
          scholarId,
          language,
          fields,
          profileHash,
        ],
      );
    }

    const services = [];

    for (
      let j = 1;
      j <= 2;
      j++
    ) {
      const serviceId =
        uuid(
          `service-${i}-${j}`,
        );

      const kind =
        j === 1
          ? 'VIDEO'
          : 'TEXT';

      const duration =
        j === 1
          ? 45
          : 30;

      const price =
        j === 1
          ? 3500 +
            i * 175
          : 1800 +
            i * 90;

      const details = {
        source_language:
          'en',

        title:
          j === 1
            ? `${enTitle} · Video consultation`
            : `${enTitle} · Text consultation`,

        summary:
          j === 1
            ? 'A private scheduled video consultation.'
            : 'A scheduled written consultation.',

        description:
          `Demo service ${j} for expert ${i}. Designed to test booking, pricing, availability and multilingual discovery.`,

        kind,

        specialty_id:
          j === 1
            ? s1
            : s2,

        category_id:
          categoryIds[
            (i + j) %
              categoryIds.length
          ],

        duration_minutes:
          duration,

        price_minor:
          price,

        currency:
          'USD',

        booking_required:
          true,

        call_policy: {
          client_screen_share:
            j === 1,

          observer:
            'WITH_BOTH_CONSENT',

          recording:
            'OFF',

          retention_days:
            30,

          recording_download:
            false,
        },

        image_id:
          null,

        terms:
          'Demo service for acceptance testing. Cancellation rules apply.',
      };

      await scholar.query(
        `INSERT INTO scholar_offerings(
           id,
           scholar_id,
           details,
           status,
           reason,
           revision,
           created_at
         )
         VALUES(
           $1,$2,$3,
           'PUBLISHED',
           $4,
           2,
           now()-interval '60 days'
         )
         ON CONFLICT(id)
         DO UPDATE SET
           details=EXCLUDED.details,
           status='PUBLISHED',
           reason=EXCLUDED.reason,
           revision=2`,
        [
          serviceId,
          scholarId,
          details,
          SEED,
        ],
      );

      const fields =
        serviceTextFields(
          details,
        );

      const hash =
        sourceHash(
          fields,
        );

      const faService = {
        title:
          j === 1
            ? `${faTitle} · مشاوره ویدیویی`
            : `${faTitle} · مشاوره متنی`,

        summary:
          j === 1
            ? 'جلسه خصوصی ویدیویی با زمان مشخص.'
            : 'مشاوره متنی زمان‌بندی‌شده.',

        description:
          `خدمت آزمایشی شماره ${j} برای ${faName}؛ مناسب آزمون رزرو، قیمت، زمان آزاد و جست‌وجوی چندزبانه.`,

        terms:
          'خدمت نمایشی برای آزمون پذیرش سامانه؛ قوانین لغو جلسه اعمال می‌شود.',
      };

      for (
        const [
          language,
          translated,
        ]
        of [
          [
            'fa',
            faService,
          ],

          [
            'en',
            fields,
          ],
        ]
      ) {
        await scholar.query(
          `INSERT INTO service_translations(
             service_id,
             language,
             fields,
             status,
             source_hash,
             revision,
             published_fields,
             published_source_hash,
             updated_at
           )
           VALUES(
             $1,$2,$3,
             'APPROVED',
             $4,
             1,
             $3,
             $4,
             now()
           )
           ON CONFLICT(
             service_id,
             language
           )
           DO UPDATE SET
             fields=EXCLUDED.fields,
             status='APPROVED',
             source_hash=EXCLUDED.source_hash,
             published_fields=EXCLUDED.published_fields,
             published_source_hash=EXCLUDED.published_source_hash,
             updated_at=now()`,
          [
            serviceId,
            language,
            translated,
            hash,
          ],
        );
      }

      services.push({
        id:
          serviceId,

        details,
      });
    }

    const calendar = {
      timezone:
        location[4],

      weekly: [
        {
          day:
            1,
          start:
            '09:00',
          end:
            '13:00',
        },

        {
          day:
            2,
          start:
            '14:00',
          end:
            '18:00',
        },

        {
          day:
            3,
          start:
            '09:00',
          end:
            '16:00',
        },

        {
          day:
            4,
          start:
            '10:00',
          end:
            '18:00',
        },

        {
          day:
            5,
          start:
            '09:00',
          end:
            '13:00',
        },
      ],

      breaks: [
        {
          day:
            3,
          start:
            '12:00',
          end:
            '13:00',
        },
      ],

      buffer_before:
        5,

      buffer_after:
        10,

      min_notice_minutes:
        60,

      horizon_days:
        60,

      cancellation_hours:
        24,

      revision:
        1,
    };

    await availability.query(
      `INSERT INTO expert_calendars(
         expert_code,
         settings,
         revision
       )
       VALUES(
         $1,$2,1
       )
       ON CONFLICT(expert_code)
       DO UPDATE SET
         settings=EXCLUDED.settings,
         revision=expert_calendars.revision+1`,
      [
        publicId,
        calendar,
      ],
    );

    await availability.query(
      `DELETE FROM availability_slot_sets
       WHERE expert_code=$1`,
      [
        publicId,
      ],
    );

    experts.push({
      index:
        i,

      account,

      accountId:
        account.id,

      scholarId,

      publicId,

      slug,

      email,

      faName,

      enName,

      faTitle,

      enTitle,

      specialties: [
        s1,
        s2,
      ],

      services,

      timezone:
        location[4],
    });
  }

  console.log(
    'Experts:',
    experts.length,
  );

  /*
   * -----------------------------------------------------
   * Presence
   * -----------------------------------------------------
   */

  const redis =
    createClient({
      url:
        required(
          'PRESENCE_REDIS_URL',
        ),
    });

  redis.on(
    'error',
    (error) =>
      console.error(
        'Redis:',
        error.message,
      ),
  );

  await redis.connect();

  for (
    let i = 0;
    i <
    experts.length;
    i++
  ) {
    const state =
      i < 8
        ? 'ONLINE'
        : i < 13
          ? 'AWAY'
          : 'OFFLINE';

    if (
      state ===
      'OFFLINE'
    ) {
      await redis.del(
        'presence:' +
          experts[i]
            .accountId,
      );
    } else {
      await redis.set(
        'presence:' +
          experts[i]
            .accountId,

        state,

        {
          EX:
            7 *
            86400,
        },
      );
    }
  }

  await redis.quit();

  console.log(
    'Presence seeded.',
  );

  /*
   * -----------------------------------------------------
   * 100 Published Questions and Answers
   * -----------------------------------------------------
   */

  const questionTopics = [
    [
      'چطور در اختلاف خانوادگی گفت‌وگوی سازنده‌تری داشته باشیم؟',
      'برای شروع، مسئله را از شخصیت افراد جدا کنید، زمان مناسب برای گفت‌وگو انتخاب کنید و درباره نیاز مشخص خود صحبت کنید. اگر اختلاف مزمن یا آسیب‌زا است، گفت‌وگوی تخصصی می‌تواند کمک‌کننده باشد.',
    ],

    [
      'در تصمیم‌های مهم چگونه بین احساس و عقل تعادل برقرار کنیم؟',
      'بهتر است احساس را به‌عنوان داده‌ای درباره وضعیت خود بشناسیم، اما تصمیم نهایی را پس از روشن‌کردن هدف، پیامدها و گزینه‌های ممکن بگیریم.',
    ],

    [
      'برای ایجاد عادت معنوی پایدار از کجا شروع کنیم؟',
      'از یک رفتار کوچک و قابل تکرار آغاز کنید. استمرار کوتاه اما واقعی معمولاً از برنامه سنگین و ناپایدار مؤثرتر است.',
    ],

    [
      'چطور با نوجوان درباره موضوعات دینی صحبت کنیم؟',
      'گفت‌وگو را با شنیدن پرسش واقعی نوجوان آغاز کنید. پاسخ‌دادن بدون فهمیدن مسئله اصلی معمولاً فاصله ایجاد می‌کند.',
    ],

    [
      'آیا برای هر مسئله‌ای مشاوره فردی لازم است؟',
      'خیر. برخی پرسش‌ها با مطالعه یا پاسخ مکتوب حل می‌شوند؛ اما مسائل شخصی، چندلایه یا تکرارشونده ممکن است به گفت‌وگوی اختصاصی نیاز داشته باشند.',
    ],

    [
      'در زمان اضطراب چگونه تصمیم مهم نگیریم؟',
      'اگر امکان دارد تصمیم غیرضروری را تا کاهش شدت اضطراب عقب بیندازید و اطلاعات، گزینه‌ها و پیامدها را روی کاغذ روشن کنید.',
    ],

    [
      'مرز احترام به والدین و استقلال فردی چیست؟',
      'احترام لزوماً به معنای واگذاری همه تصمیم‌های شخصی نیست. نوع تصمیم، مسئولیت فرد و آثار آن باید جداگانه بررسی شود.',
    ],

    [
      'چگونه پرسش دینی دقیق‌تری مطرح کنیم؟',
      'موضوع، موقعیت، محدودیت‌ها و چیزی را که دقیقاً نمی‌دانید روشن کنید. پرسش مشخص معمولاً پاسخ مفیدتری ایجاد می‌کند.',
    ],

    [
      'برای حل تعارض میان همسران از کدام نقطه شروع کنیم؟',
      'ابتدا الگوی تکرارشونده تعارض را پیدا کنید: چه چیزی آغازگر است، هر طرف چه برداشتی دارد و چه واکنشی چرخه را تشدید می‌کند.',
    ],

    [
      'چگونه میان کار، خانواده و عبادت تعادل ایجاد کنیم؟',
      'به جای جست‌وجوی تقسیم کاملاً مساوی زمان، اولویت‌ها و حداقل‌های پایدار هر حوزه را مشخص کنید و برنامه را بر همان اساس تنظیم کنید.',
    ],
  ];

  const questionIds = [];

  for (
    let i = 1;
    i <= 100;
    i++
  ) {
    const id =
      uuid(
        `question-${i}`,
      );

    questionIds.push(
      id,
    );

    const owner =
      clients[
        (i - 1) %
          clients.length
      ];

    const expert =
      experts[
        (i - 1) %
          experts.length
      ];

    const template =
      questionTopics[
        (i - 1) %
          questionTopics.length
      ];

    const question =
      `${template[0]} — نمونه ${i}`;

    const answer =
      `${template[1]} این پاسخ بخشی از دادهٔ آزمایشی ویانور برای بررسی تجربهٔ پرسش و پاسخ است.`;

    const requestKey =
      uuid(
        `question-request-${i}`,
      );

    const sealedQuestion =
      sealJson(
        question,

        'question:' +
          id,

        'COMMUNICATION_ENCRYPTION_KEY',
      );

    const sealedAnswer =
      sealJson(
        answer,

        'question:' +
          id +
          ':answer',

        'COMMUNICATION_ENCRYPTION_KEY',
      );

    await qa.query(
      `INSERT INTO questions(
         id,
         owner_id,
         owner_code,
         expert_id,
         sealed_question,
         sealed_answer,
         visibility,
         public_question,
         public_answer,
         publication,
         request_key,
         revision,
         created_at,
         updated_at
       )
       VALUES(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,
         'PUBLISHED',
         $10,
         4,
         $11,
         $11
       )
       ON CONFLICT(id)
       DO UPDATE SET
         expert_id=EXCLUDED.expert_id,
         sealed_question=EXCLUDED.sealed_question,
         sealed_answer=EXCLUDED.sealed_answer,
         visibility=EXCLUDED.visibility,
         public_question=EXCLUDED.public_question,
         public_answer=EXCLUDED.public_answer,
         publication='PUBLISHED',
         revision=4,
         updated_at=EXCLUDED.updated_at`,
      [
        id,
        owner.id,
        owner.public_id,
        expert.accountId,
        sealedQuestion,
        sealedAnswer,

        i % 5 === 0
          ? 'ANONYMOUS'
          : 'PUBLIC',

        question,
        answer,
        requestKey,

        new Date(
          now -
            i *
              5 *
              3600000,
        ),
      ],
    );
  }

  console.log(
    'Published Q&A: 100',
  );

  /*
   * -----------------------------------------------------
   * Bookings for dashboard-account
   * -----------------------------------------------------
   */

  const bookingDefinitions = [
    [
      'COMPLETED',
      -42,
    ],
    [
      'COMPLETED',
      -34,
    ],
    [
      'COMPLETED',
      -27,
    ],
    [
      'COMPLETED',
      -20,
    ],
    [
      'COMPLETED',
      -13,
    ],
    [
      'COMPLETED',
      -7,
    ],
    [
      'CONFIRMED',
      2,
    ],
    [
      'CONFIRMED',
      5,
    ],
    [
      'CONFIRMED',
      8,
    ],
    [
      'RESCHEDULED',
      12,
    ],
    [
      'CANCELLED',
      -3,
    ],
    [
      'EXPIRED',
      -1,
    ],
  ];

  const bookings = [];

  await booking.query(
    `DELETE FROM booking_events
      WHERE booking_id=ANY($1::uuid[])`,
    [
      bookingDefinitions.map(
        (
          _,
          index,
        ) =>
          uuid(
            `booking-${index + 1}`,
          ),
      ),
    ],
  );

  await booking.query(
    `DELETE FROM booking_notifications
      WHERE booking_id=ANY($1::uuid[])`,
    [
      bookingDefinitions.map(
        (
          _,
          index,
        ) =>
          uuid(
            `booking-${index + 1}`,
          ),
      ),
    ],
  );

  for (
    let i = 0;
    i <
    bookingDefinitions.length;
    i++
  ) {
    const [
      status,
      offsetDays,
    ] =
      bookingDefinitions[
        i
      ];

    const expert =
      experts[
        i %
          experts.length
      ];

    const service =
      expert.services[
        0
      ];

    const id =
      uuid(
        `booking-${i + 1}`,
      );

    const start =
      new Date(
        now +
          offsetDays *
            86400000,
      );

    start.setUTCHours(
      10 +
        (
          i %
          5
        ),
      0,
      0,
      0,
    );

    const end =
      new Date(
        start.getTime() +
          service.details
            .duration_minutes *
            60000,
      );

    const snapshot = {
      expert_id:
        expert.accountId,

      expert_code:
        expert.publicId,

      expert_name:
        expert.faName,

      specialty_id:
        service.details
          .specialty_id,

      country:
        'IR',

      kind:
        service.details.kind,

      call_policy:
        service.details
          .call_policy,

      title:
        service.details.title,

      duration_minutes:
        service.details
          .duration_minutes,

      price_minor:
        service.details
          .price_minor,

      currency:
        service.details
          .currency,

      cancellation_hours:
        24,

      expert_timezone:
        expert.timezone,

      penalty_minor:
        0,

      refund_mode:
        'STANDARD',
    };

    const requestKey =
      uuid(
        `booking-request-${i + 1}`,
      );

    await booking.query(
      `INSERT INTO scheduled_bookings(
         id,
         client_id,
         client_code,
         expert_code,
         service_id,
         start_at,
         end_at,
         status,
         expires_at,
         timezone,
         request_key,
         request_data,
         pending_action,
         operation_id,
         operation_actor,
         action_data,
         snapshot,
         revision,
         error_code,
         created_at,
         updated_at
       )
       VALUES(
         $1,$2,$3,$4,$5,$6,$7,$8,
         NULL,
         'Asia/Tehran',
         $9,$10,
         NULL,
         $11,$2,$12,$13,
         3,
         NULL,
         $14,$15
       )
       ON CONFLICT(id)
       DO UPDATE SET
         expert_code=EXCLUDED.expert_code,
         service_id=EXCLUDED.service_id,
         start_at=EXCLUDED.start_at,
         end_at=EXCLUDED.end_at,
         status=EXCLUDED.status,
         snapshot=EXCLUDED.snapshot,
         updated_at=EXCLUDED.updated_at`,
      [
        id,
        accountRow.id,
        accountRow.public_id,
        expert.publicId,
        service.id,
        start,
        end,
        status,
        requestKey,

        {
          seed:
            SEED,

          expert:
            expert.publicId,

          service:
            service.id,

          start_at:
            start.toISOString(),

          timezone:
            'Asia/Tehran',
        },

        uuid(
          `booking-operation-${i + 1}`,
        ),

        {
          intent:
            'demo-seed',
        },

        snapshot,

        new Date(
          start.getTime() -
            3 *
              86400000,
        ),

        new Date(
          Math.min(
            now,
            start.getTime(),
          ),
        ),
      ],
    );

    const events =
      status ===
      'COMPLETED'
        ? [
            'REQUESTED',
            'HELD',
            'CONFIRMED',
            'COMPLETED',
          ]
        : status ===
            'CANCELLED'
          ? [
              'REQUESTED',
              'HELD',
              'CANCELLED',
            ]
          : status ===
              'EXPIRED'
            ? [
                'REQUESTED',
                'EXPIRED',
              ]
            : status ===
                'RESCHEDULED'
              ? [
                  'REQUESTED',
                  'CONFIRMED',
                  'RESCHEDULE_REQUESTED',
                  'RESCHEDULED',
                ]
              : [
                  'REQUESTED',
                  'HELD',
                  'CONFIRMED',
                ];

    for (
      let eventIndex = 0;
      eventIndex <
      events.length;
      eventIndex++
    ) {
      const eventName =
        events[
          eventIndex
        ];

      const eventId =
        uuid(
          `booking-event-${i + 1}-${eventIndex + 1}`,
        );

      await booking.query(
        `INSERT INTO booking_events(
           id,
           booking_id,
           actor_id,
           event,
           details,
           created_at
         )
         VALUES(
           $1,$2,$3,$4,$5,$6
         )
         ON CONFLICT(id)
         DO NOTHING`,
        [
          eventId,
          id,
          accountRow.id,
          eventName,

          {
            seed:
              SEED,
          },

          new Date(
            start.getTime() -
              (
                events.length -
                eventIndex
              ) *
                3600000,
          ),
        ],
      );
    }

    const notificationId =
      uuid(
        `booking-notification-${i + 1}`,
      );

    await booking.query(
      `INSERT INTO booking_notifications(
         id,
         event_id,
         booking_id,
         account_id,
         event,
         delivered_at,
         read_at,
         created_at
       )
       VALUES(
         $1,$2,$3,$4,$5,
         now(),
         $6,
         $7
       )
       ON CONFLICT(id)
       DO UPDATE SET
         read_at=EXCLUDED.read_at`,
      [
        notificationId,

        uuid(
          `booking-event-${i + 1}-1`,
        ),

        id,
        accountRow.id,
        status,

        i % 3 === 0
          ? null
          : new Date(),

        new Date(
          Math.min(
            now,
            start.getTime(),
          ),
        ),
      ],
    );

    bookings.push({
      index:
        i + 1,

      id,

      status,

      start,

      end,

      expert,

      service,

      snapshot,
    });
  }

  /*
   * Prevent future confirmed demo bookings from
   * appearing as free slots.
   */

  for (
    const item
    of bookings.filter(
      (
        bookingItem,
      ) =>
        [
          'CONFIRMED',
          'RESCHEDULED',
        ].includes(
          bookingItem.status,
        ),
    )
  ) {
    await availability.query(
      `INSERT INTO slot_claims(
         booking_id,
         client_id,
         expert_code,
         service_id,
         start_at,
         end_at,
         busy_start,
         busy_end,
         state,
         expires_at,
         operation_id,
         snapshot
       )
       VALUES(
         $1,$2,$3,$4,$5,$6,$7,$8,
         'CONFIRMED',
         $9,$10,$11
       )
       ON CONFLICT(booking_id)
       DO UPDATE SET
         start_at=EXCLUDED.start_at,
         end_at=EXCLUDED.end_at,
         busy_start=EXCLUDED.busy_start,
         busy_end=EXCLUDED.busy_end,
         state='CONFIRMED',
         snapshot=EXCLUDED.snapshot`,
      [
        item.id,
        accountRow.id,
        item.expert.publicId,
        item.service.id,
        item.start,
        item.end,

        new Date(
          item.start.getTime() -
            5 *
              60000,
        ),

        new Date(
          item.end.getTime() +
            10 *
              60000,
        ),

        new Date(
          item.end.getTime() +
            86400000,
        ),

        uuid(
          `slot-operation-${item.index}`,
        ),

        item.snapshot,
      ],
    );

    await booking.query(
      `INSERT INTO live_session_provisions(
         booking_id,
         session_id
       )
       VALUES(
         $1,$2
       )
       ON CONFLICT(booking_id)
       DO NOTHING`,
      [
        item.id,

        uuid(
          `future-session-${item.index}`,
        ),
      ],
    );
  }

  console.log(
    'Bookings:',
    bookings.length,
  );

  /*
   * Session request history.
   */

  for (
    let i = 1;
    i <= 4;
    i++
  ) {
    const expert =
      experts[
        (
          i +
          10
        ) %
          experts.length
      ];

    const id =
      uuid(
        `session-request-${i}`,
      );

    await booking.query(
      `INSERT INTO session_requests(
         id,
         client_id,
         client_code,
         expert_id,
         expert_code,
         preferred_date,
         status,
         created_at,
         updated_at
       )
       VALUES(
         $1,$2,$3,$4,$5,$6,$7,$8,$8
       )
       ON CONFLICT(id)
       DO UPDATE SET
         status=EXCLUDED.status,
         updated_at=EXCLUDED.updated_at`,
      [
        id,
        accountRow.id,
        accountRow.public_id,
        expert.accountId,
        expert.publicId,

        new Date(
          now +
            (
              15 +
              i
            ) *
              86400000,
        )
          .toISOString()
          .slice(
            0,
            10,
          ),

        i <= 2
          ? 'requested'
          : 'reviewed',

        new Date(
          now -
            i *
              86400000,
        ),
      ],
    );
  }

  /*
   * -----------------------------------------------------
   * Conversations + 56 messages
   * -----------------------------------------------------
   */

  let totalMessages =
    0;

  const demoTexts = [
    'سلام، برای جلسه امروز چند نکته را از قبل آماده کرده‌ام.',
    'سلام، بسیار خوب. لطفاً اصلی‌ترین مسئله‌ای را که می‌خواهید روی آن تمرکز کنیم بنویسید.',
    'بیشتر می‌خواهم درباره تصمیمی که در خانواده داریم صحبت کنم.',
    'متوجه شدم. بهتر است در جلسه ابتدا گزینه‌ها و نگرانی‌های هر طرف را جدا کنیم.',
    'اگر لازم باشد می‌توانم چند مثال مشخص هم در جلسه مطرح کنم.',
    'حتماً؛ مثال‌های واقعی کمک می‌کنند مسئله دقیق‌تر روشن شود.',
    'ممنون. زمان جلسه برای من مناسب است.',
  ];

  for (
    let i = 0;
    i < 8;
    i++
  ) {
    const bookingItem =
      bookings[i];

    const conversationId =
      uuid(
        `conversation-${i + 1}`,
      );

    const contextKey =
      'booking:' +
      bookingItem.id;

    await messaging.query(
      `INSERT INTO conversations(
         id,
         type,
         context_key,
         context_id,
         created_by,
         state,
         category,
         next_sequence,
         created_at,
         updated_at
       )
       VALUES(
         $1,$2,$3,$4,$5,
         'OPEN',
         'DEMO',
         0,
         $6,$6
       )
       ON CONFLICT(context_key)
       DO UPDATE SET
         state='OPEN',
         category='DEMO',
         updated_at=EXCLUDED.updated_at
       RETURNING id`,
      [
        conversationId,

        bookingItem.service
          .details.kind ===
        'TEXT'
          ? 'CONSULTATION'
          : 'BOOKING',

        contextKey,
        bookingItem.id,
        accountRow.id,

        new Date(
          Math.min(
            now,
            bookingItem.start
              .getTime(),
          ) -
            2 *
              86400000,
        ),
      ],
    );

    await messaging.query(
      `INSERT INTO conversation_members(
         conversation_id,
         account_id,
         role,
         delivered_sequence,
         read_sequence
       )
       VALUES(
         $1,$2,'CUSTOMER',0,0
       )
       ON CONFLICT(
         conversation_id,
         account_id
       )
       DO UPDATE SET
         role='CUSTOMER'`,
      [
        conversationId,
        accountRow.id,
      ],
    );

    await messaging.query(
      `INSERT INTO conversation_members(
         conversation_id,
         account_id,
         role,
         delivered_sequence,
         read_sequence
       )
       VALUES(
         $1,$2,'EXPERT',0,0
       )
       ON CONFLICT(
         conversation_id,
         account_id
       )
       DO UPDATE SET
         role='EXPERT'`,
      [
        conversationId,
        bookingItem.expert
          .accountId,
      ],
    );

    await messaging.query(
      `DELETE FROM messages
       WHERE conversation_id=$1`,
      [
        conversationId,
      ],
    );

    await messaging.query(
      `DELETE FROM communication_notifications
       WHERE conversation_id=$1`,
      [
        conversationId,
      ],
    );

    for (
      let m = 0;
      m <
      demoTexts.length;
      m++
    ) {
      const messageId =
        uuid(
          `message-${i + 1}-${m + 1}`,
        );

      const sender =
        m % 2 === 0
          ? accountRow.id
          : bookingItem.expert
              .accountId;

      const requestKey =
        uuid(
          `message-request-${i + 1}-${m + 1}`,
        );

      const input = {
        request_key:
          requestKey,

        type:
          'TEXT',

        content:
          demoTexts[m],

        reply_to:
          null,

        files:
          [],
      };

      const fingerprint =
        createHash(
          'sha256',
        )
          .update(
            JSON.stringify(
              input,
            ),
          )
          .digest(
            'hex',
          );

      const sealed =
        sealJson(
          {
            text:
              demoTexts[m],

            duration:
              null,
          },

          'communication:' +
            messageId,

          'COMMUNICATION_ENCRYPTION_KEY',
        );

      await messaging.query(
        `INSERT INTO messages(
           id,
           conversation_id,
           sender_id,
           sequence,
           type,
           sealed_content,
           reply_to,
           files,
           request_key,
           fingerprint,
           created_at
         )
         VALUES(
           $1,$2,$3,$4,
           'TEXT',
           $5,
           NULL,
           '[]',
           $6,$7,$8
         )`,
        [
          messageId,
          conversationId,
          sender,
          m + 1,
          sealed,
          requestKey,
          fingerprint,

          new Date(
            Math.min(
              now,
              bookingItem.start
                .getTime(),
            ) -
              (
                demoTexts.length -
                m
              ) *
                15 *
                60000,
          ),
        ],
      );

      totalMessages++;
    }

    await messaging.query(
      `UPDATE conversations
          SET next_sequence=$2,
              updated_at=$3
        WHERE id=$1`,
      [
        conversationId,
        demoTexts.length,
        new Date(),
      ],
    );

    await messaging.query(
      `UPDATE conversation_members
          SET delivered_sequence=$3,
              read_sequence=$4
        WHERE conversation_id=$1
          AND account_id=$2`,
      [
        conversationId,
        accountRow.id,
        demoTexts.length,

        i >= 6
          ? demoTexts.length -
            2
          : demoTexts.length,
      ],
    );

    await messaging.query(
      `UPDATE conversation_members
          SET delivered_sequence=$3,
              read_sequence=$3
        WHERE conversation_id=$1
          AND account_id=$2`,
      [
        conversationId,
        bookingItem.expert
          .accountId,
        demoTexts.length,
      ],
    );

    if (
      i >= 6
    ) {
      await messaging.query(
        `INSERT INTO communication_notifications(
           id,
           account_id,
           conversation_id,
           event,
           delivered_at,
           created_at
         )
         VALUES(
           $1,$2,$3,
           'NEW_MESSAGE',
           now(),
           now()
         )
         ON CONFLICT(id)
         DO NOTHING`,
        [
          uuid(
            `communication-notification-${i + 1}`,
          ),

          accountRow.id,
          conversationId,
        ],
      );
    }

    await booking.query(
      `INSERT INTO communication_conversations(
         booking_id
       )
       VALUES($1)
       ON CONFLICT DO NOTHING`,
      [
        bookingItem.id,
      ],
    );
  }

  console.log(
    'Conversations: 8',
  );

  console.log(
    'Messages:',
    totalMessages,
  );

  /*
   * -----------------------------------------------------
   * Ratings
   * -----------------------------------------------------
   */

  for (
    let i = 0;
    i < 6;
    i++
  ) {
    const item =
      bookings[i];

    const sessionId =
      uuid(
        `completed-session-${i + 1}`,
      );

    const ratingId =
      uuid(
        `rating-${i + 1}`,
      );

    const score =
      i % 4 === 0
        ? 4
        : 5;

    const review =
      [
        'جلسه بسیار منظم و مفید بود.',
        'توضیحات روشن و کاربردی بود.',
        'از شیوه گفت‌وگو و جمع‌بندی جلسه راضی بودم.',
        'استاد با حوصله مسئله را بررسی کرد.',
        'جلسه به تصمیم‌گیری من کمک کرد.',
        'تجربه خوبی بود و احتمالاً دوباره رزرو می‌کنم.',
      ][i];

    const sealed =
      sealJson(
        review,

        'rating:' +
          sessionId,

        'SESSION_ENCRYPTION_KEY',
      );

    await ratingDb.query(
      `INSERT INTO session_ratings(
         id,
         session_id,
         booking_id,
         client_id,
         expert_id,
         overall,
         punctuality,
         communication,
         technical,
         technical_issues,
         sealed_review,
         created_at
       )
       VALUES(
         $1,$2,$3,$4,$5,
         $6,$6,5,5,
         '[]',
         $7,$8
       )
       ON CONFLICT(session_id)
       DO UPDATE SET
         overall=EXCLUDED.overall,
         punctuality=EXCLUDED.punctuality,
         communication=EXCLUDED.communication,
         technical=EXCLUDED.technical,
         sealed_review=EXCLUDED.sealed_review`,
      [
        ratingId,
        sessionId,
        item.id,
        accountRow.id,
        item.expert.accountId,
        score,
        sealed,

        new Date(
          item.end.getTime() +
            3600000,
        ),
      ],
    );
  }

  console.log(
    'Ratings: 6',
  );

  /*
   * -----------------------------------------------------
   * Payment history
   * -----------------------------------------------------
   */

  const paymentRows =
    [];

  for (
    let i = 0;
    i < 8;
    i++
  ) {
    const item =
      bookings[i];

    const paymentId =
      uuid(
        `payment-${i + 1}`,
      );

    const provider =
      [
        'wallet',
        'paypal',
        'stripe',
        'wallet',
        'nowpayments',
        'paypal',
        'wallet',
        'stripe',
      ][i];

    const status =
      i === 2
        ? 'REFUNDED'
        : i === 7
          ? 'FAILED'
          : 'SUCCESS';

    const amount =
      item.service
        .details
        .price_minor;

    const fee =
      Math.floor(
        amount *
          0.2,
      );

    await payment.query(
      `INSERT INTO payments(
         id,
         account_id,
         booking_id,
         expert_id,
         gateway_id,
         provider,
         amount,
         fee,
         tax,
         currency,
         decimals,
         status,
         reference,
         capture_reference,
         checkout,
         network,
         snapshot,
         request_key,
         request_data,
         fulfillment,
         released_at,
         disputed,
         last_checked,
         risk,
         risk_approved,
         risk_hold,
         created_at,
         updated_at
       )
       VALUES(
         $1,$2,$3,$4,
         NULL,
         $5,$6,$7,0,
         'USD',2,$8,
         $9,$10,
         '{}',
         NULL,
         $11,$12,$13,
         $14,$15,
         false,
         now(),
         $16,
         true,
         false,
         $17,$17
       )
       ON CONFLICT(id)
       DO UPDATE SET
         status=EXCLUDED.status,
         amount=EXCLUDED.amount,
         fee=EXCLUDED.fee,
         fulfillment=EXCLUDED.fulfillment,
         updated_at=now()`,
      [
        paymentId,
        accountRow.id,
        item.id,
        item.expert.accountId,
        provider,
        String(
          amount,
        ),
        String(
          fee,
        ),
        status,

        `DEMO21-${String(
          i + 1,
        ).padStart(
          3,
          '0',
        )}`,

        status ===
        'SUCCESS'
          ? `CAPTURE-DEMO21-${i + 1}`
          : null,

        {
          seed:
            SEED,

          commission_bps:
            2000,

          booking:
            item.snapshot,
        },

        uuid(
          `payment-request-${i + 1}`,
        ),

        {
          seed:
            SEED,

          locale:
            'fa',

          provider,
        },

        status ===
        'FAILED'
          ? 'PENDING'
          : 'APPLIED',

        status ===
        'SUCCESS'
          ? new Date()
          : null,

        {
          seed:
            SEED,

          ip_country:
            'IR',

          signals:
            [],
        },

        new Date(
          item.start.getTime() -
            2 *
              86400000,
        ),
      ],
    );

    await booking.query(
      `UPDATE scheduled_bookings
          SET payment_id=$2
        WHERE id=$1`,
      [
        item.id,
        paymentId,
      ],
    );

    if (
      status ===
        'SUCCESS' ||
      status ===
        'REFUNDED'
    ) {
      await payment.query(
        `INSERT INTO payment_notification_delivery(
           payment_id,
           delivered_at
         )
         VALUES(
           $1,now()
         )
         ON CONFLICT DO NOTHING`,
        [
          paymentId,
        ],
      );
    }

    if (
      status ===
      'REFUNDED'
    ) {
      await payment.query(
        `INSERT INTO payment_refunds(
           id,
           payment_id,
           requester,
           target,
           status,
           reason,
           provider_reference,
           funds_locked,
           created_at,
           updated_at
         )
         VALUES(
           $1,$2,$3,
           'WALLET',
           'COMPLETED',
           'CANCELLED',
           $4,
           true,
           now()-interval '5 days',
           now()-interval '4 days'
         )
         ON CONFLICT(payment_id)
         DO UPDATE SET
           status='COMPLETED',
           updated_at=EXCLUDED.updated_at`,
        [
          uuid(
            'refund-3',
          ),

          paymentId,
          accountRow.id,
          'DEMO21-REFUND-003',
        ],
      );
    }

    paymentRows.push({
      id:
        paymentId,

      amount,

      fee,

      status,

      item,
    });
  }

  /*
   * Wallet top-up payment
   */

  const topupPaymentId =
    uuid(
      'payment-topup',
    );

  await payment.query(
    `INSERT INTO payments(
       id,
       account_id,
       booking_id,
       expert_id,
       gateway_id,
       provider,
       amount,
       fee,
       tax,
       currency,
       decimals,
       status,
       reference,
       capture_reference,
       checkout,
       network,
       snapshot,
       request_key,
       request_data,
       fulfillment,
       released_at,
       disputed,
       last_checked,
       risk,
       risk_approved,
       risk_hold,
       created_at,
       updated_at
     )
     VALUES(
       $1,$2,
       NULL,NULL,NULL,
       'paypal',
       150000,0,0,
       'USD',2,
       'SUCCESS',
       'DEMO21-TOPUP',
       'DEMO21-TOPUP-CAPTURE',
       '{}',
       NULL,
       $3,$4,$5,
       'APPLIED',
       NULL,
       false,
       now(),
       $6,
       true,
       false,
       now()-interval '60 days',
       now()-interval '60 days'
     )
     ON CONFLICT(id)
     DO UPDATE SET
       status='SUCCESS'`,
    [
      topupPaymentId,
      accountRow.id,

      {
        seed:
          SEED,

        type:
          'TOPUP',
      },

      uuid(
        'payment-topup-request',
      ),

      {
        seed:
          SEED,

        provider:
          'paypal',

        locale:
          'fa',
      },

      {
        seed:
          SEED,

        ip_country:
          'IR',

        signals:
          [],
      },
    ],
  );

  await payment.query(
    `INSERT INTO payment_notification_delivery(
       payment_id,
       delivered_at
     )
     VALUES(
       $1,now()
     )
     ON CONFLICT DO NOTHING`,
    [
      topupPaymentId,
    ],
  );

  console.log(
    'Payments:',
    paymentRows.length +
      1,
  );

  /*
   * -----------------------------------------------------
   * Wallet + double-entry ledger through the real service
   * -----------------------------------------------------
   */

  async function walletCommand(
    input,
  ) {
    const response =
      await fetch(
        required(
          'WALLET_INTERNAL_URL',
        ) +
          '/internal/wallet/execute',

        {
          method:
            'POST',

          headers: {
            'content-type':
              'application/json',

            'x-internal-key':
              required(
                'AUTH_INTERNAL_KEY',
              ),
          },

          body:
            JSON.stringify(
              input,
            ),

          signal:
            AbortSignal.timeout(
              20000,
            ),
        },
      );

    const body =
      await response.text();

    if (
      !response.ok
    )
      throw new Error(
        `Wallet ${response.status}: ${body}`,
      );

    return JSON.parse(
      body,
    );
  }

  await walletCommand({
    key:
      'demo21-topup-account',

    reference:
      topupPaymentId,

    action:
      'TOPUP',

    account_id:
      accountRow.id,

    currency:
      'USD',

    amount:
      '150000',

    fee:
      '0',

    tax:
      '0',

    external:
      false,
  });

  for (
    let i = 0;
    i < 5;
    i++
  ) {
    const item =
      paymentRows[i];

    await walletCommand({
      key:
        `demo21-purchase-${i + 1}`,

      reference:
        item.id,

      action:
        'PURCHASE',

      account_id:
        accountRow.id,

      expert_id:
        item.item.expert
          .accountId,

      currency:
        'USD',

      amount:
        String(
          item.amount,
        ),

      fee:
        String(
          item.fee,
        ),

      tax:
        '0',

      external:
        false,
    });

    if (
      i < 2
    ) {
      await walletCommand({
        key:
          `demo21-release-${i + 1}`,

        reference:
          item.id,

        action:
          'RELEASE',

        account_id:
          accountRow.id,

        expert_id:
          item.item.expert
            .accountId,

        currency:
          'USD',

        amount:
          String(
            item.amount,
          ),

        fee:
          String(
            item.fee,
          ),

        tax:
          '0',

        external:
          false,
      });
    }
  }

  /*
   * Refund the third seeded purchase.
   */

  {
    const item =
      paymentRows[2];

    await walletCommand({
      key:
        'demo21-refund-3',

      reference:
        item.id,

      action:
        'REFUND_PENDING',

      account_id:
        accountRow.id,

      expert_id:
        item.item.expert
          .accountId,

      currency:
        'USD',

      amount:
        String(
          item.amount,
        ),

      fee:
        String(
          item.fee,
        ),

      tax:
        '0',

      external:
        false,
    });
  }

  console.log(
    'Wallet ledger: SEEDED',
  );

  /*
   * -----------------------------------------------------
   * Search index refresh
   * -----------------------------------------------------
   */

  if (
    await tableExists(
      search,
      'search_state',
    )
  ) {
    await search.query(
      `UPDATE search_state
          SET generation=generation+1,
              updated_at=now()
        WHERE id=1`,
    );
  }

  /*
   * -----------------------------------------------------
   * Final counts
   * -----------------------------------------------------
   */

  const expertCount =
    Number(
      (
        await scholar.query(
          `SELECT count(*)::int AS n
             FROM scholars
            WHERE slug LIKE 'demo21-expert-%'`,
        )
      ).rows[0].n,
    );

  const qaCount =
    Number(
      (
        await qa.query(
          `SELECT count(*)::int AS n
             FROM questions
            WHERE id=ANY($1::uuid[])`,
          [
            questionIds,
          ],
        )
      ).rows[0].n,
    );

  const bookingCount =
    Number(
      (
        await booking.query(
          `SELECT count(*)::int AS n
             FROM scheduled_bookings
            WHERE client_id=$1
              AND request_data->>'seed'=$2`,
          [
            accountRow.id,
            SEED,
          ],
        )
      ).rows[0].n,
    );

  const paymentCount =
    Number(
      (
        await payment.query(
          `SELECT count(*)::int AS n
             FROM payments
            WHERE account_id=$1
              AND (
                request_data->>'seed'=$2
                OR id=$3
              )`,
          [
            accountRow.id,
            SEED,
            topupPaymentId,
          ],
        )
      ).rows[0].n,
    );

  const conversationCount =
    Number(
      (
        await messaging.query(
          `SELECT count(*)::int AS n
             FROM conversations
            WHERE category='DEMO'
              AND created_by=$1`,
          [
            accountRow.id,
          ],
        )
      ).rows[0].n,
    );

  const messageCount =
    Number(
      (
        await messaging.query(
          `SELECT count(*)::int AS n
             FROM messages m
             JOIN conversations c
               ON c.id=m.conversation_id
            WHERE c.category='DEMO'
              AND c.created_by=$1`,
          [
            accountRow.id,
          ],
        )
      ).rows[0].n,
    );

  const ratingCount =
    Number(
      (
        await ratingDb.query(
          `SELECT count(*)::int AS n
             FROM session_ratings
            WHERE client_id=$1
              AND booking_id=ANY($2::uuid[])`,
          [
            accountRow.id,

            bookings
              .slice(
                0,
                6,
              )
              .map(
                (x) =>
                  x.id,
              ),
          ],
        )
      ).rows[0].n,
    );

  const report = {
    seed:
      SEED,

    created_at:
      new Date()
        .toISOString(),

    dashboard_account: {
      email:
        ACCOUNT_EMAIL,

      public_id:
        accountRow.public_id,

      password:
        ACCOUNT_PASSWORD,
    },

    expert_password:
      EXPERT_PASSWORD,

    counts: {
      experts:
        expertCount,

      q_and_a:
        qaCount,

      bookings:
        bookingCount,

      session_requests:
        4,

      payments:
        paymentCount,

      conversations:
        conversationCount,

      messages:
        messageCount,

      ratings:
        ratingCount,

      active_demo_languages:
        languages.length,
    },

    experts:
      experts.map(
        (
          item,
        ) => ({
          email:
            item.email,

          public_id:
            item.publicId,

          slug:
            item.slug,

          fa_name:
            item.faName,
        }),
      ),
  };

  await writeFile(
    `${OUTPUT}/seed-report.json`,
    JSON.stringify(
      report,
      null,
      2,
    ),
    {
      mode:
        0o600,
    },
  );

  const credentialLines = [
    '# Vianoor Demo Seed 21',
    '# root-only test credentials',
    '',
    'CLIENT',
    `${ACCOUNT_EMAIL} | ${ACCOUNT_PASSWORD}`,
    '',
    'EXPERTS',
    ...experts.map(
      (
        item,
      ) =>
        `${item.email} | ${EXPERT_PASSWORD}`,
    ),
    '',
  ];

  await writeFile(
    `${OUTPUT}/demo-credentials.txt`,
    credentialLines.join(
      '\n',
    ),
    {
      mode:
        0o600,
    },
  );

  console.log(
    '========================================',
  );

  console.log(
    ' FINAL COUNTS',
  );

  console.log(
    JSON.stringify(
      report.counts,
      null,
      2,
    ),
  );

  console.log(
    '========================================',
  );

  if (
    expertCount !== 20
  )
    throw new Error(
      `Expected 20 experts, got ${expertCount}`,
    );

  if (
    qaCount !== 100
  )
    throw new Error(
      `Expected 100 Q&A, got ${qaCount}`,
    );

  if (
    bookingCount !== 12
  )
    throw new Error(
      `Expected 12 bookings, got ${bookingCount}`,
    );

  if (
    conversationCount <
    8
  )
    throw new Error(
      `Expected at least 8 conversations, got ${conversationCount}`,
    );

  if (
    messageCount <
    50
  )
    throw new Error(
      `Expected at least 50 messages, got ${messageCount}`,
    );

  if (
    paymentCount <
    9
  )
    throw new Error(
      `Expected at least 9 payments, got ${paymentCount}`,
    );

  if (
    ratingCount !==
    6
  )
    throw new Error(
      `Expected 6 ratings, got ${ratingCount}`,
    );

  console.log(
    'DEMO_SEED_ACCEPTANCE_PASS',
  );
}

try {
  await main();
} finally {
  await Promise.allSettled(
    Object.values(
      pools,
    ).map(
      (
        pool,
      ) =>
        pool.end(),
    ),
  );
}
