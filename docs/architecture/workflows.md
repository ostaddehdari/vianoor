# قرارداد فرایندها

## رزرو پولی

1. Booking: ایجاد DRAFT با tenant و مالک معتبر؛ availability hold با کلید عملیات ثابت.
2. Availability: hold اتمیک با محدودیت عدم هم‌پوشانی در DB و زمان انقضا؛ نه صرفاً قفل Redis.
3. Payment: ایجاد intent برای همان مبلغ/ارز و کلید idempotency؛ ذخیره نتیجه.
4. verification معتبر درگاه، ثبت captured و outbox در یک تراکنش.
5. Booking: بررسی مبلغ، ارز، مرجع رزرو و انقضای hold؛ تأیید شرطی. اگر hold از دست رفته، جبران مالی و عدم تأیید رزرو.
6. Accounting/Wallet/Payout مصرف مستقل با inbox. Notification خطا کند، تأیید رزرو لغو نمی‌شود.

حالت رزرو: DRAFT → PENDING_PAYMENT → CONFIRMED → WAITING → READY → IN_SESSION → COMPLETED.
حالت‌های استثنا: CANCELLED / NO_SHOW / FAILED. وضعیت مالی REFUND_PENDING / REFUNDED در projection مالی کنار lifecycle نگه‌داری می‌شود تا تاریخچهٔ جلسه از بین نرود.

## درخواست فوری

صف پایدار در Instant؛ Redis فقط نمای سریع/حضور. پیشنهاد مدت‌دار با version و accept شرطی، فقط یک برنده. پس از قبول، همان چرخه Booking/Payment استفاده می‌شود. timeout، آفلاین‌شدن و انصراف تست جدا دارند.

## انتشار پاسخ

سؤال خصوصی → تخصیص → پیش‌نویس انسانی/AI کمکی → بررسی علمی → ناشناس‌سازی → بررسی رضایت انتشار → نسخه عمومی. هیچ projection عمومی متن خام خصوصی دریافت نمی‌کند.

## جلسه و ضبط

احراز مجوز هر شرکت‌کننده → رضایت لازم → توکن محدود به اتاق و مدت → انتظار → LiveKit. webhook امضاشده و تکراری کنترل می‌شود. پایان BusinessSession توسط قواعد Booking است؛ نه قطع یک call leg.

## AI

capability + data_classification + tenant policy → بررسی رضایت/اجازه خروج → حذف داده حساس طبق سیاست → مدل مجاز → timeout/budget → پاسخ کمکی. external_ai_allowed=false یعنی هیچ fallback بیرونی مجاز نیست.
