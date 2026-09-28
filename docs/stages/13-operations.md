# عملیات مرحله ۱۳

این راهنما به معنی نصب عمومی نیست؛ شواهد در `../testing/stage-13.md` است.

پس از آماده‌سازی و پذیرش مرحله ۱۲، `node scripts/sessions/prepare.mjs` فایل Compose تولیدشده را برای مالک‌های media و rating گسترش می‌دهد. این اسکریپت تنظیمات SFU برنامه‌های دیگر سرور را تغییر نمی‌دهد.

فایل‌های محرمانه و خارج از Git:

- `infra/local/sessions-key.env`: کلید رمزگذاری تولیدشده؛ همراه بکاپ امن نگهداری شود.
- `infra/local/livekit.env`: متغیرهای LIVEKIT_HTTP_URL، LIVEKIT_PUBLIC_URL با wss، LIVEKIT_API_KEY و LIVEKIT_API_SECRET حداقل ۳۲ کاراکتر؛ LIVEKIT_EGRESS_ENABLED=0 تا زمان قبولی تست ضبط.
- `infra/local/recordings-storage.env`: کلیدهای RECORDINGS_S3_ACCESS_KEY و RECORDINGS_S3_SECRET_KEY و در صورت نیاز RECORDINGS_S3_ENDPOINT. حساب نوشتن محدود به recordings/\* باشد؛ کلید مرورگر یا bucket عمومی مجاز نیست. دانلود فقط از FileService انجام می‌شود.

LiveKit اختصاصی یا ظرفیت صریحاً تخصیص‌یافته لازم است. پورت signaling پشت reverse proxy، پورت‌های RTC/TURN طبق تنظیمات منتشر و گواهی TLS معتبر و IP عمومی صحیح ثبت شود. TURN الزامی است. webhook امضاشده LiveKit در شبکه خصوصی به `/webhooks/livekit` مالک media می‌رود. پورت‌های مالک‌ها، مدیریتی و metrics عمومی نشوند.

Egress worker جداگانه و ظرفیت اضافه می‌خواهد؛ مستندات LiveKit حداقل چهار CPU و چهار گیگابایت RAM را توصیه می‌کند. سرور فعلی ظرفیت آزاد کافی ندارد. برای تست، ClamAV دوم اجرا نشود. فایل MP4 تولیدشده توسط Egress مسیر خصوصی مستقل با بررسی قالب دارد؛ این مسیر ادعای اسکن آنتی‌ویروس ندارد. فایل آپلود کاربر همچنان اسکن می‌شود.

وضعیت ضبط STARTING → ACTIVE → STOP_REQUESTED → FINALIZING → READY یا FAILED/UNKNOWN است. شروع مبهم بر اساس Egress ID یا مسیر دقیق فایل reconcile می‌شود و دوباره اجرا نمی‌شود. درخواست توقف به معنی تأیید توقف نیست. پایان جلسه تا تعیین تکلیف ضبط فعال/مبهم منتظر می‌ماند؛ نهایی‌سازی فایل جداگانه تکرارپذیر است. دسترسی به فایل منقضی فوراً رد می‌شود و حذف فیزیکی هر دقیقه دوباره تلاش می‌شود.

پیش از انتشار: بکاپ دیتابیس مالک‌های تغییرکرده و env خصوصی، بررسی RAM/دیسک، ساخت ایمیج فقط از فایل‌های بررسی‌شده، `npm run check` و `npm run smoke` و سپس پذیرش HTTP، دو مرورگر، TURN و ضبط. نسخهٔ نمایشی فقط بعد از نصب تغییر کند. ایمیج و snapshot قبلی برای بازگشت نگهداری شود؛ جداول جدید افزایشی‌اند.

مرجع‌ها: [استقرار LiveKit](https://docs.livekit.io/transport/self-hosting/deployment/)، [پورت و فایروال](https://docs.livekit.io/transport/self-hosting/ports-firewall/)، [Egress](https://docs.livekit.io/transport/self-hosting/egress/)، [وب‌هوک امضاشده](https://docs.livekit.io/intro/basics/rooms-participants-tracks/webhooks-events/).
