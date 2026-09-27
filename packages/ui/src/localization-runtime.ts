export type PublicCatalog = {
  language: { code: string; direction: 'RTL' | 'LTR'; name_en: string; native_name: string | null };
  revision: string | number;
  values: Record<string, string>;
  fallback_keys: string[];
};
type Widen<T> = T extends string ? string : T extends object ? { [K in keyof T]: Widen<T[K]> } : T;
type Localized<T> = T extends { en: infer E; fa: unknown }
  ? Record<string, Widen<E>> & { en: Widen<E>; fa: Widen<E> }
  : T extends object
    ? { [K in keyof T]: Localized<T[K]> }
    : T;
// Public, locale-keyed catalogue cache. It never contains sessions or user data.
const catalogs = new Map<string, PublicCatalog>();
export function languageValue<T>(value: { en: T; fa?: T }, locale: string): T;
export function languageValue<T>(
  value: { en: T; fa?: T } | undefined,
  locale: string,
): T | undefined;
export function languageValue<T>(
  value: { en: T; fa?: T } | undefined,
  locale: string,
): T | undefined {
  return value ? ((value as Record<string, T>)[locale] ?? value.en) : undefined;
}
export function installCatalog(catalog: PublicCatalog) {
  catalogs.delete(catalog.language.code);
  catalogs.set(catalog.language.code, catalog);
  if (catalogs.size > 256) catalogs.delete(catalogs.keys().next().value!);
}
export function localeDirection(locale: string) {
  return (
    (catalogs.get(locale)?.language.direction.toLowerCase() as 'rtl' | 'ltr' | undefined) ??
    (['Arab', 'Hebr', 'Thaa', 'Nkoo', 'Adlm', 'Syrc', 'Rohg'].includes(
      new Intl.Locale(locale).maximize().script ?? '',
    )
      ? 'rtl'
      : 'ltr')
  );
}
export function localizedText(locale: string, key: string, en: string, fa?: string) {
  const catalog = catalogs.get(locale);
  return catalog ? (catalog.values[key] ?? en) : locale === 'fa' && fa !== undefined ? fa : en;
}
function resolve(value: unknown, fallback: unknown, locale: string, path: string): unknown {
  if (typeof value === 'string')
    return catalogs.has(locale)
      ? (catalogs.get(locale)!.values[path] ?? value)
      : typeof fallback === 'string'
        ? fallback
        : value;
  if (Array.isArray(value))
    return value.map((child, index) =>
      resolve(
        child,
        Array.isArray(fallback) ? fallback[index] : undefined,
        locale,
        path + '.' + index,
      ),
    );
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        resolve(
          child,
          (fallback as Record<string, unknown> | undefined)?.[key],
          locale,
          path + '.' + key,
        ),
      ]),
    );
  return value;
}
export function createDictionary<T extends { en: unknown; fa: unknown }>(
  namespace: string,
  seed: T,
): Record<string, Widen<T['en']>> & { en: Widen<T['en']>; fa: Widen<T['fa']> } {
  const cache = new Map<string, { revision: unknown; value: unknown }>();
  return new Proxy(seed as object, {
    get(target, key) {
      if (typeof key !== 'string' || !/^([a-z]{2,3})(-[A-Za-z0-9]{2,8})*$/.test(key))
        return Reflect.get(target, key);
      const catalog = catalogs.get(key),
        revision = catalog ?? 'bootstrap';
      if (cache.get(key)?.revision === revision) return cache.get(key)!.value;
      const value = resolve(seed.en, (seed as Record<string, unknown>)[key], key, namespace);
      cache.set(key, { revision, value });
      if (cache.size > 256) cache.delete(cache.keys().next().value!);
      return value;
    },
  }) as Record<string, Widen<T['en']>> & { en: Widen<T['en']>; fa: Widen<T['fa']> };
}
export function localizeTree<T>(namespace: string, tree: T): Localized<T> {
  if (!tree || typeof tree !== 'object') return tree as Localized<T>;
  if ('en' in tree && 'fa' in tree)
    return createDictionary(namespace, tree as { en: unknown; fa: unknown }) as Localized<T>;
  if (Array.isArray(tree))
    return tree.map((item, index) => localizeTree(namespace + '.' + index, item)) as Localized<T>;
  return Object.fromEntries(
    Object.entries(tree).map(([key, value]) => [key, localizeTree(namespace + '.' + key, value)]),
  ) as Localized<T>;
}
