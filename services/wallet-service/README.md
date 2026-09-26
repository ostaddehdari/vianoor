# کیف پول | wallet-service

وضعیت: **اسکلت مرحلهٔ ۱**؛ منطق دامنه در مرحلهٔ 11 اضافه می‌شود.

مالکیت: ورودی تغییر موجودی، hold و مانده قابل بازسازی

Database: `wallet_db`؛ role: `wallet_app`. هیچ migration نمایشی اجرا نمی‌شود.

از ریشه: `npm run build:packages` سپس `npm run dev --workspace @vianoor/wallet-service`. پورت پیش‌فرض 4115.

- `GET /health/live`: زنده‌بودن process
- `GET /health/ready`: عمداً 503 تا اتصال زیرساخت و منطق واقعی
- `GET /api/v1`: مشخصات scaffold؛ هیچ endpoint کسب‌وکار فعال نیست.

Env به‌صورت خودکار بارگذاری نمی‌شود. نام‌ها در `.env.example`؛ رازهای DB در مرحلهٔ ۲ فقط برای همین سرویس تزریق می‌شوند. Docker و integration tests زیرساخت در مرحلهٔ ۲ تکمیل می‌شوند.
