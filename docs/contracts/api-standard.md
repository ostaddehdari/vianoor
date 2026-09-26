# قرارداد HTTP

`openapi.json` فقط مسیرهای واقعاً موجود در مرحلهٔ ۱ را اعلام می‌کند. `api-inventory.json` نقشهٔ APIهای آینده است و endpoint فعال نیست.

- Base: `/api/v1`؛ JSON UTF-8، شناسه UUID؛ زمان UTC ISO8601؛ پول بدون float.
- موفق: `{data, meta, trace_id}`؛ صفحه‌بندی `{meta: {next_cursor}}`.
- خطا: `{error: {code, message, details}, trace_id}`؛ code پایدار و message محلی‌شده در مراحل کاربردی.
- 400 ورودی، 401 نیاز به هویت، 403 نبود مجوز، 404 منبع ناموجود/مخفی طبق سیاست، 409 تعارض یا نسخه، 422 قاعده دامنه، 429 محدودیت، 503 وابستگی ضروری آماده نیست.
- Idempotency-Key برای عملیات مالی و تغییرات حساس؛ namespace شامل tenant/actor/route. همان کلید با body متفاوت 409؛ ذخیره نتیجه و وضعیت in-flight در مالک عملیات. سیاست TTL در مرحلهٔ دامنه مشخص می‌شود.
- PATCH وضعیت حساس از version/If-Match استفاده کند. UUID ورودی جایگزین کنترل مالکیت نیست.
- identity/session در مرحله ۴ و service identity در مرحله ۲؛ هیچ endpoint scaffold مجوز کسب‌وکار ندارد.
- trace_id مرحله ۱ شناسه ردیابی پاسخ است، نه ادعای span ذخیره‌شده. propagation استاندارد OpenTelemetry در مرحله ۲.
- CORS allowlist، cookie HttpOnly/Secure، CSRF روی cookie session و rotation در مراحل ۲ و ۴.
- pagination بدون نشت tenant؛ signed cursor یا cursor opaque و محدودیت page size.
