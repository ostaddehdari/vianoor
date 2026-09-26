import { notFound } from 'next/navigation';
import { Experience, isLocale, routeInfo, pagePaths, copy, publicPages } from '@vianoor/ui';
import type { Metadata } from 'next';
export function generateStaticParams() {
  return pagePaths('web')
    .filter((p) => !p.startsWith('auth/') && p !== 'account/security')
    .map((p) => ({ path: p.split('/') }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; path: string[] }>;
}): Promise<Metadata> {
  const { locale, path } = await params;
  if (!isLocale(locale)) notFound();
  const title =
    publicPages.find((p) => p.path === path[0])?.title[locale] ?? copy[locale].dashboards;
  return { title: `${title} | ${copy[locale].brand}` };
}
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; path: string[] }>;
}) {
  const { locale, path } = await params;
  if (!isLocale(locale) || !routeInfo(path.join('/'), 'web')) notFound();
  return <Experience locale={locale} path={path.join('/')} app="web" />;
}
