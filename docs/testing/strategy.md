# راهبرد آزمون

## مرحلهٔ اول

- Unit/contract: پول بدون float، envelope نسخه‌دار/UTC/trace، payload پرداخت، tenant اجباری، تنظیمات AI بدون raw secret، برابری ترجمه‌ها.
- Architecture: ۳۲ سرویس، دیتابیس/role/port یکتا، ۲۰ مرحله، صفحه با مالک معتبر، منع import بین سرویس‌ها و browser→runtime.
- HTTP integration: runtime واقعی Nest، liveness=200، readiness=503، خطای امن 404.
- Build: تمام سرویس‌ها و هر دو برنامهٔ Next؛ typecheck و lint جدا از Next build.
- Smoke: اجرای تک‌تک ۳۲ process و دو برنامه production؛ fa/en و RTL/LTR، redirect و locale نامعتبر.

## مراحل بعد

Stage 2: PostgreSQL/Redis/NATS واقعی با crash/restart و duplicate/out-of-order. Stage 4–6: token replay، account linking، tenant escalation. Stage 9–11: رقابت slot، callback تکراری، توازن ledger و late capture. Stage 12–17: عضویت، persistent messaging، consent، اتاق اشتباه و replay ACL. Stage 18–19: AI data policy و SIP واقعی. Stage 20: E2E، بار، restore و rollout/rollback.

آزمون mock، توسعه و سرویس واقعی سه وضعیت مستقل‌اند؛ وجود scaffold به معنای موفقیت هیچ تست کسب‌وکار نیست.
