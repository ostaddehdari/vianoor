# پیام‌رسان | messaging-service

وضعیت: **اسکلت مرحلهٔ ۱**؛ منطق دامنه در مرحلهٔ 12 اضافه می‌شود.

مالکیت: مکالمه پایدار، عضو، پیام و رسید خواندن

Database: `messaging_db`؛ role: `messaging_app`. هیچ migration نمایشی اجرا نمی‌شود.

از ریشه: `npm run build:packages` سپس `npm run dev --workspace @vianoor/messaging-service`. پورت پیش‌فرض 4112.

- `GET /health/live`: زنده‌بودن process
- `GET /health/ready`: عمداً 503 تا اتصال زیرساخت و منطق واقعی
- `GET /api/v1`: مشخصات scaffold؛ هیچ endpoint کسب‌وکار فعال نیست.

Env به‌صورت خودکار بارگذاری نمی‌شود. نام‌ها در `.env.example`؛ رازهای DB در مرحلهٔ ۲ فقط برای همین سرویس تزریق می‌شوند. Docker و integration tests زیرساخت در مرحلهٔ ۲ تکمیل می‌شوند.
