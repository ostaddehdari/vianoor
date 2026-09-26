export const releaseVersion = 'V3.0.1';
export function ReleaseBadge({ locale }: { locale: 'fa' | 'en' }) {
  const label = { fa: 'نسخهٔ نصب‌شده', en: 'Installed version' }[locale];
  return (
    <small className="release-badge" title={label} aria-label={`${label}: ${releaseVersion}`}>
      <bdi>{releaseVersion}</bdi>
    </small>
  );
}
