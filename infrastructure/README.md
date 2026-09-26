# زیرساخت — مرحلهٔ ۲

این مرحله قرارداد استقرار را مشخص می‌کند؛ compose اجرایی در مرحلهٔ ۲ اضافه خواهد شد.

- فقط web/admin و gateway در لبه؛ سایر سرویس‌ها شبکه داخلی.
- PostgreSQL: ۳۱ DB و role مستقل بر اساس service-catalog؛ هیچ superuser در app.
- NATS/JetStream با volume پایدار و subject ACL؛ Redis با auth و شبکه خصوصی.
- LiveKit/TURN و object storage جدا از backend؛ URL و پورت‌های واقعی بعد از دریافت دامنه و تنظیم سرور.
- OpenSearch، OpenTelemetry Collector، Prometheus و Grafana طبق پروفایل توسعه/تولید.
- readiness واقعی باید DB و وابستگی حیاتی همان سرویس را بررسی کند؛ وابستگی اختیاری AI مانع رزرو نیست.
- migration پیش از rollout، health gate، backup و rollback مستند. نقش migration جدا از runtime در تولید.
- هیچ Docker image یا حجم production در مرحلهٔ ۱ ساخته/تغییر داده نشده است.
