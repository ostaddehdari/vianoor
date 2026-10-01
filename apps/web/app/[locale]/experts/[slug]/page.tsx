import {
  getCatalog,
} from '../../../../lib/localization';

import {
  ExpertProfileExperience,
  PublicPageShell,
  isLocale,
} from '@vianoor/ui';

import {
  notFound,
} from 'next/navigation';

import type {
  Metadata,
} from 'next';

import {
  expertData,
  type PublicExpert,
} from '../data';

export const dynamic =
  'force-dynamic';

type Params = {
  params:
    Promise<{
      locale: string;
      slug: string;
    }>;
};

export async function generateMetadata({
  params,
}: Params): Promise<Metadata> {
  const {
    locale,
    slug,
  } =
    await params;

  await getCatalog(
    locale,
  );

  if (
    !/^[a-z0-9-]{3,80}$/.test(
      slug,
    )
  )
    return {};

  const row =
    await expertData<PublicExpert>(
      'experts/public/' +
        slug +
        '?language=' +
        encodeURIComponent(
          locale,
        ),
    );

  if (!row)
    return {
      robots: {
        index: false,
        follow: false,
      },
    };

  const title =
      row.profile
        .seo_title ||
      row.profile
        .display_name,
    description =
      row.profile
        .seo_description ||
      row.profile
        .short_bio;

  const canonical =
    (
      process.env
        .AUTH_PUBLIC_URL ??
      ''
    ).replace(
      /\/$/,
      '',
    ) +
    '/' +
    locale +
    '/experts/' +
    slug;

  return {
    title,
    description,

    alternates: {
      canonical,
    },

    openGraph: {
      title,
      description,
      url:
        canonical,
      type:
        'profile',
    },
  };
}

export default async function Expert({
  params,
}: Params) {
  const {
    locale,
    slug,
  } =
    await params;

  await getCatalog(
    locale,
  );

  if (
    !isLocale(
      locale,
    ) ||
    !/^[a-z0-9-]{3,80}$/.test(
      slug,
    )
  )
    notFound();

  const [
    row,
    taxons,
  ] =
    await Promise.all([
      expertData<PublicExpert>(
        'experts/public/' +
          slug +
          '?language=' +
          encodeURIComponent(
            locale,
          ),
      ),

      expertData<
        {
          id: string;
          kind?: string;
          code?: string;

          label: {
            fa?: string;
            en: string;
            [key: string]:
              string |
              undefined;
          };
        }[]
      >(
        'taxonomy',
      ),
    ]);

  if (!row)
    notFound();

  return (
    <PublicPageShell
      locale={locale}
      path="experts"
    >
      <ExpertProfileExperience
        locale={locale}
        expert={row}
        taxons={
          taxons ??
          []
        }
      />
    </PublicPageShell>
  );
}
