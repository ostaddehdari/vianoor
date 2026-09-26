# ارزیابی | rating-service

وضعیت: **اسکلت مرحلهٔ ۱**؛ منطق دامنه در مرحلهٔ 13 اضافه می‌شود.

مالکیت: امتیاز پس از خدمت، بازخورد و aggregate اعتبار

Database: `rating_db`؛ role: `rating_app`. هیچ migration نمایشی اجرا نمی‌شود.

از ریشه: `npm run build:packages` سپس `npm run dev --workspace @vianoor/rating-service`. پورت پیش‌فرض 4122.

- `GET /health/live`: زنده‌بودن process
- `GET /health/ready`: عمداً 503 تا اتصال زیرساخت و منطق واقعی
- `GET /api/v1`: مشخصات scaffold؛ هیچ endpoint کسب‌وکار فعال نیست.

Env به‌صورت خودکار بارگذاری نمی‌شود. نام‌ها در `.env.example`؛ رازهای DB در مرحلهٔ ۲ فقط برای همین سرویس تزریق می‌شوند. Docker و integration tests زیرساخت در مرحلهٔ ۲ تکمیل می‌شوند.
