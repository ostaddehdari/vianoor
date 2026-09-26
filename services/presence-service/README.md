# حضور | presence-service

وضعیت: **اسکلت مرحلهٔ ۱**؛ منطق دامنه در مرحلهٔ 10 اضافه می‌شود.

مالکیت: lease حضور آنلاین و TTL؛ منبع حقیقت فقط حضور موقت

Database: `presence_db`؛ role: `presence_app`. هیچ migration نمایشی اجرا نمی‌شود.

از ریشه: `npm run build:packages` سپس `npm run dev --workspace @vianoor/presence-service`. پورت پیش‌فرض 4107.

- `GET /health/live`: زنده‌بودن process
- `GET /health/ready`: عمداً 503 تا اتصال زیرساخت و منطق واقعی
- `GET /api/v1`: مشخصات scaffold؛ هیچ endpoint کسب‌وکار فعال نیست.

Env به‌صورت خودکار بارگذاری نمی‌شود. نام‌ها در `.env.example`؛ رازهای DB در مرحلهٔ ۲ فقط برای همین سرویس تزریق می‌شوند. Docker و integration tests زیرساخت در مرحلهٔ ۲ تکمیل می‌شوند.
