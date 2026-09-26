import { AuthForm, isLocale, type AuthAction, Experience, routeInfo } from '@vianoor/ui';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
export const metadata: Metadata = {
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};
const actions = [
  'login',
  'register',
  'forgot-password',
  'reset-password',
  'verify-email',
  'resend-verification',
];
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; action: string }>;
}) {
  const { locale, action } = await params;
  if (!isLocale(locale)) notFound();
  if (!actions.includes(action)) {
    if (!routeInfo(`auth/${action}`, 'web')) notFound();
    return <Experience locale={locale} path={`auth/${action}`} app="web" />;
  }
  return <AuthForm locale={locale} action={action as AuthAction} />;
}
