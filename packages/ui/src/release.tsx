import { localizedText } from './localization-runtime';
export const releaseVersion = 'V13.0.0-rc.1';
export function ReleaseBadge({ locale }: { locale: string }) {
  const label = localizedText(locale, 'release.installed', 'Installed version', 'نسخهٔ نصب‌شده');
  return (
    <small className="release-badge" title={label} aria-label={`${label}: ${releaseVersion}`}>
      <bdi>{releaseVersion}</bdi>
    </small>
  );
}
