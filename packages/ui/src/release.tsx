import { localizedText } from './localization-runtime';
export const releaseVersion = 'V11.0.0';
export function ReleaseBadge({ locale }: { locale: string }) {
  const label = localizedText(locale, 'release.installed', 'Installed version', 'نسخهٔ نصب‌شده');
  return (
    <small className="release-badge" title={label} aria-label={`${label}: ${releaseVersion}`}>
      <bdi>{releaseVersion}</bdi>
    </small>
  );
}
