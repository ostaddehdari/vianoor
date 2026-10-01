export type PublicCatalog = {
  language: {
    code: string;
    direction: 'RTL' | 'LTR';
    name_en: string;
    native_name: string | null;
  };

  revision: string | number;

  values: Record<string, string>;

  /*
   * Keys for which the localization service
   * returned the English source because a
   * published target-language translation
   * does not exist.
   */
  fallback_keys: string[];
};

type Widen<T> =
  T extends string
    ? string
    : T extends object
      ? {
          [K in keyof T]:
            Widen<T[K]>
        }
      : T;

type Localized<T> =
  T extends {
    en: infer E;
    fa: unknown;
  }
    ? Record<
        string,
        Widen<E>
      > & {
        en: Widen<E>;
        fa: Widen<E>;
      }
    : T extends object
      ? {
          [K in keyof T]:
            Localized<T[K]>
        }
      : T;

const catalogs =
  new Map<
    string,
    PublicCatalog
  >();

const fallbackSets =
  new WeakMap<
    PublicCatalog,
    Set<string>
  >();

function fallbackSet(
  catalog: PublicCatalog,
) {
  let result =
    fallbackSets.get(
      catalog,
    );

  if (!result) {
    result =
      new Set(
        catalog.fallback_keys,
      );

    fallbackSets.set(
      catalog,
      result,
    );
  }

  return result;
}

function shouldUseBundledLocale(
  locale: string,
  catalog: PublicCatalog,
  key: string,
  englishSource: string,
  bundledLocale: string,
) {
  /*
   * Explicit fallback from the backend:
   * use our reviewed bundled locale text.
   */
  if (
    fallbackSet(
      catalog,
    ).has(
      key,
    )
  )
    return true;

  const databaseValue =
    catalog.values[key];

  /*
   * Key is newer than the DB catalogue.
   */
  if (
    databaseValue ===
    undefined
  )
    return true;

  /*
   * Critical Persian repair:
   *
   * Some FA rows historically contain the
   * English source itself and were therefore
   * treated as "translated".
   *
   * If bundled Persian differs from English
   * while the DB value equals English, the
   * bundled Persian copy is authoritative.
   */
  if (
    locale === 'fa' &&
    bundledLocale !==
      englishSource &&
    databaseValue.trim() ===
      englishSource.trim()
  )
    return true;

  return false;
}

export function languageValue<T>(
  value: {
    en: T;
    fa?: T;
  },
  locale: string,
): T;

export function languageValue<T>(
  value:
    | {
        en: T;
        fa?: T;
      }
    | undefined,
  locale: string,
): T | undefined;

export function languageValue<T>(
  value:
    | {
        en: T;
        fa?: T;
      }
    | undefined,
  locale: string,
): T | undefined {
  if (!value)
    return undefined;

  return (
    (
      value as Record<
        string,
        T
      >
    )[locale] ??
    value.en
  );
}

export function installCatalog(
  catalog: PublicCatalog,
) {
  catalogs.delete(
    catalog.language.code,
  );

  catalogs.set(
    catalog.language.code,
    catalog,
  );

  if (
    catalogs.size >
    256
  )
    catalogs.delete(
      catalogs.keys().next()
        .value!,
    );
}

export function localeDirection(
  locale: string,
) {
  return (
    (
      catalogs
        .get(locale)
        ?.language
        .direction
        .toLowerCase() as
        | 'rtl'
        | 'ltr'
        | undefined
    ) ??
    (
      [
        'Arab',
        'Hebr',
        'Thaa',
        'Nkoo',
        'Adlm',
        'Syrc',
        'Rohg',
      ].includes(
        new Intl.Locale(
          locale,
        )
          .maximize()
          .script ??
          '',
      )
        ? 'rtl'
        : 'ltr'
    )
  );
}

export function localizedText(
  locale: string,
  key: string,
  en: string,
  fa?: string,
) {
  const bundledLocale =
    locale === 'fa' &&
    fa !== undefined
      ? fa
      : en;

  const catalog =
    catalogs.get(
      locale,
    );

  if (!catalog)
    return bundledLocale;

  if (
    shouldUseBundledLocale(
      locale,
      catalog,
      key,
      en,
      bundledLocale,
    )
  )
    return bundledLocale;

  return (
    catalog.values[key] ??
    bundledLocale
  );
}

function resolve(
  englishValue: unknown,
  localizedValue: unknown,
  locale: string,
  path: string,
): unknown {
  if (
    typeof englishValue ===
    'string'
  ) {
    const bundledLocale =
      typeof localizedValue ===
      'string'
        ? localizedValue
        : englishValue;

    const catalog =
      catalogs.get(
        locale,
      );

    if (!catalog)
      return bundledLocale;

    if (
      shouldUseBundledLocale(
        locale,
        catalog,
        path,
        englishValue,
        bundledLocale,
      )
    )
      return bundledLocale;

    return (
      catalog.values[path] ??
      bundledLocale
    );
  }

  if (
    Array.isArray(
      englishValue,
    )
  )
    return englishValue.map(
      (
        child,
        index,
      ) =>
        resolve(
          child,

          Array.isArray(
            localizedValue,
          )
            ? localizedValue[index]
            : undefined,

          locale,

          path +
            '.' +
            index,
        ),
    );

  if (
    englishValue &&
    typeof englishValue ===
      'object'
  )
    return Object.fromEntries(
      Object.entries(
        englishValue,
      ).map(
        ([
          key,
          child,
        ]) => [
          key,

          resolve(
            child,

            (
              localizedValue as
                | Record<
                    string,
                    unknown
                  >
                | undefined
            )?.[key],

            locale,

            path +
              '.' +
              key,
          ),
        ],
      ),
    );

  return englishValue;
}

export function createDictionary<
  T extends {
    en: unknown;
    fa: unknown;
  },
>(
  namespace: string,
  seed: T,
): Record<
  string,
  Widen<T['en']>
> & {
  en: Widen<T['en']>;
  fa: Widen<T['fa']>;
} {
  const cache =
    new Map<
      string,
      {
        revision: unknown;
        value: unknown;
      }
    >();

  return new Proxy(
    seed as object,
    {
      get(
        target,
        key,
      ) {
        if (
          typeof key !==
            'string' ||
          !/^([a-z]{2,3})(-[A-Za-z0-9]{2,8})*$/.test(
            key,
          )
        )
          return Reflect.get(
            target,
            key,
          );

        const catalog =
            catalogs.get(
              key,
            ),
          revision =
            catalog ??
            'bootstrap';

        if (
          cache.get(
            key,
          )?.revision ===
          revision
        )
          return cache.get(
            key,
          )!.value;

        const localizedSeed =
          (
            seed as Record<
              string,
              unknown
            >
          )[key];

        const value =
          resolve(
            seed.en,
            localizedSeed,
            key,
            namespace,
          );

        cache.set(
          key,
          {
            revision,
            value,
          },
        );

        if (
          cache.size >
          256
        )
          cache.delete(
            cache.keys().next()
              .value!,
          );

        return value;
      },
    },
  ) as Record<
    string,
    Widen<T['en']>
  > & {
    en: Widen<T['en']>;
    fa: Widen<T['fa']>;
  };
}

export function localizeTree<T>(
  namespace: string,
  tree: T,
): Localized<T> {
  if (
    !tree ||
    typeof tree !==
      'object'
  )
    return tree as Localized<T>;

  if (
    'en' in tree &&
    'fa' in tree
  )
    return createDictionary(
      namespace,
      tree as {
        en: unknown;
        fa: unknown;
      },
    ) as Localized<T>;

  if (
    Array.isArray(
      tree,
    )
  )
    return tree.map(
      (
        item,
        index,
      ) =>
        localizeTree(
          namespace +
            '.' +
            index,
          item,
        ),
    ) as Localized<T>;

  return Object.fromEntries(
    Object.entries(
      tree,
    ).map(
      ([
        key,
        value,
      ]) => [
        key,

        localizeTree(
          namespace +
            '.' +
            key,
          value,
        ),
      ],
    ),
  ) as Localized<T>;
}
