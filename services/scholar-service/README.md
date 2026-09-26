# اساتید | scholar-service

وضعیت: **اسکلت مرحلهٔ ۱**؛ منطق دامنه در مرحلهٔ 8 اضافه می‌شود.

مالکیت: پروفایل حرفه‌ای، مدارک، تأیید، خدمات و تعرفه

Database: `scholar_db`؛ role: `scholar_app`. هیچ migration نمایشی اجرا نمی‌شود.

از ریشه: `npm run build:packages` سپس `npm run dev --workspace @vianoor/scholar-service`. پورت پیش‌فرض 4105.

- `GET /health/live`: زنده‌بودن process
- `GET /health/ready`: عمداً 503 تا اتصال زیرساخت و منطق واقعی
- `GET /api/v1`: مشخصات scaffold؛ هیچ endpoint کسب‌وکار فعال نیست.

Env به‌صورت خودکار بارگذاری نمی‌شود. نام‌ها در `.env.example`؛ در Compose مرحلهٔ ۲ credential مستقل به این سرویس تزریق می‌شود؛ `/health/infra` سلامت وابستگی‌ها را جدا گزارش می‌کند. راهنما: [زیرساخت](../../docs/stages/02-infrastructure.md).
