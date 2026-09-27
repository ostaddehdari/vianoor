// Bootstrap identifiers only. Names, availability and capabilities are managed in PostgreSQL.
const initialCodes =
  'af am ar as az be bg bn bo br bs ca ce co cs cy da de dv dz el en eo es et eu fa fi fil fo fr fy ga gd gl gu ha he hi hr ht hu hy id ig is it ja jv ka kk km kn ko ku ky la lb lo lt lv mg mi mk ml mn mr ms mt my nb ne nl nn no ny oc om or pa pl ps pt qu ro ru rw sa sd si sk sl sm sn so sq sr st su sv sw ta te tg th ti tk tl tn tr ts tt ug uk ur uz vi wo xh yi yo zh zu aa ab ae ak an av ay ba bh bi ch cr cu cv ee ff fj gn gv ho hz ia ie ik io iu';
export const languageCodes = [
  ...new Set(initialCodes.split(' ').map((code) => Intl.getCanonicalLocales(code)[0]!)),
].slice(0, 147);
export function languageMetadata(code: string) {
  const canonical = Intl.getCanonicalLocales(code)[0]!;
  const english = new Intl.DisplayNames(['en'], { type: 'language' });
  const native = new Intl.DisplayNames([canonical], { type: 'language' });
  const nativeAvailable = native.resolvedOptions().locale.split('-')[0] === canonical.split('-')[0];
  const rtl = ['Arab', 'Hebr', 'Thaa', 'Nkoo', 'Adlm', 'Syrc', 'Rohg', 'Samr', 'Mand'].includes(
    new Intl.Locale(canonical).maximize().script ?? '',
  );
  return {
    code: canonical,
    name_en: english.of(canonical) ?? canonical,
    native_name: nativeAvailable ? (native.of(canonical) ?? null) : null,
    direction: rtl ? 'RTL' : 'LTR',
    status: 'ACTIVE',
    ai_supported: false,
    speech_supported: false,
    translation_supported: true,
  };
}
