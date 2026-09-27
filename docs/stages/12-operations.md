# عملیات ارتباطات مرحله ۱۲

دامنه در `12-scope.md` و شواهد در `../testing/stage-12.md` است. شاخه: `stage/12-communications`. وضعیت انتشار را از سند آزمون بخوانید؛ وجود این راهنما به معنی نصب نیست.

## داده و دسترسی

messaging مالک گفتگو، اعضا، پیام، رسید، کانال و صندوق مدیریتی است. qa سؤال خصوصی رمز‌شده و نسخه انتشار عمومی را جدا نگه می‌دارد. notification مالک inbox، ترجیحات و صف ارسال است. presence فقط lease کوتاه‌عمر Redis دارد. file به مالک گفتگو برای دانلود پیوست مراجعه می‌کند؛ مجوز file.admin مجوز خواندن فایل خصوصی نیست.

رزرو تأییدشده با API مالک booking یک گفتگوی یکتا می‌سازد؛ ارسال در رزرو لغوشده/منقضی مجاز نیست. مدیر فقط صندوق پشتیبانی/کانال را claim و ارجاع می‌کند، نه مشاوره خصوصی یا پرسش. دنبال‌کردن کانال دسترسی به چت خصوصی نمی‌دهد. انتشار سؤال نیازمند نسخه عمومی مستقل، انتخاب مالک و بازبینی مدیر است.

## آماده‌سازی استقرار

پس از قبولی تست یکپارچه، در checkout مرحله ۱۲ و روی compose مرحله ۱۱، `node scripts/communications/prepare.mjs` اجرا شود. چهار مالک messaging/presence/qa/notification فعال می‌شوند. اسکریپت کلید `infra/local/communication-key.env` را فقط در نبود فایل می‌سازد؛ این کلید باید همراه بکاپ دیتابیس امن نگهداری شود و نباید در Git قرار گیرد. کلید مالی قبلی تغییر نمی‌کند.

برای TLS عمومی، location دقیق `/vianoor/realtime` باید به `http://127.0.0.1:18892/realtime` با HTTP/1.1 و headerهای Upgrade/Connection پراکسی شود. `proxy_read_timeout 90s` و `proxy_send_timeout 90s` مناسب heartbeat ۲۵ثانیه‌ای است. مسیر REST همچنان از BFF احرازهویت‌شده می‌گذرد. بلیط WebSocket در اولین frame ارسال می‌شود، نه URL. Origin باید با AUTH_PUBLIC_URL تطابق داشته باشد. پورت ۱۸۸۹۲ فقط loopback است.

ساخت release از فایل‌های انتخاب‌شده انجام شود؛ کانتینر توسعه حامل fixture و تنظیمات آزمایشی است و نباید docker commit شود. قبل از تعویض ایمیج، پایگاه‌ها و کلیدها بکاپ شوند. نمونه stage11 برای بازگشت حفظ شود. تغییر V12.0.0 پس از قبولی آزمون و نصب انجام شود.

## پنل

پیام‌ها، کانال‌ها، پرسش‌ها و اعلان‌ها در همه نقش‌ها موجودند. ادمین/پشتیبانی صندوق مدیریتی دارند؛ ادمین تنظیمات اعلان و ارجاع پرسش را دارد. کانال استاد آدرس `/[locale]/experts/[slug]/channel` دارد. ارسال نظر/فایل/دنبال‌کردن نیازمند ورود است.

در تنظیمات اعلان ادمین، Twilio Account SID، Auth Token، Messaging Service SID و Verify Service SID ثبت می‌شود. شماره کاربر پیش از فعال‌کردن SMS با Verify تأیید می‌شود. SMS به‌طور پیش‌فرض خاموش است. محتوای خصوصی مشاوره در SMS/ایمیل قرار نمی‌گیرد. موفقیت پذیرش ارائه‌دهنده معادل تحویل نیست؛ صف، وضعیت provider را بررسی می‌کند. وضعیت UNKNOWN یا SENDING مبهم نباید کورکورانه دوباره ارسال شود؛ نیازمند تطبیق عملیاتی است.

ایمیل از صف identity و SMTP موجود استفاده می‌کند. QUEUED یعنی پذیرش در صف مالک identity، نه تأیید دریافت در صندوق کاربر. یادآوری‌ها ۲۴ ساعت، ۶۰ دقیقه و ۱۰ دقیقه‌اند؛ پنجره ارسال فعلی دو دقیقه است و اختلال طولانی ممکن است یادآوری همان آستانه را از دست بدهد.

## ادامه اعتبارسنجی

روی محیط جداگانه: `node --import tsx scripts/communications/acceptance-server.mjs` و سپس `COMMUNICATIONS_TEST=1 node --import tsx --test tests/integration/communications.test.ts`. harness فقط نشانی توسعه `http://127.0.0.1:18886/vianoor` را می‌پذیرد. fixture خروجی و تمام envها خصوصی و ignored هستند. سپس browser فارسی/انگلیسی، فایل و ضبط صدا، اتصال مجدد، رزرو→گفتگو و یادآوری بررسی شود.

منابع: [ws](https://github.com/websockets/ws)، [Twilio Messages](https://www.twilio.com/docs/messaging/api/message-resource)، [Twilio Verify](https://www.twilio.com/docs/verify/api/verification-check).
