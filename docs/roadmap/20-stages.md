# برنامهٔ ۲۰ مرحله‌ای

مرحلهٔ ۱ پایهٔ اجرایی است؛ زیرساخت مرحلهٔ ۲ پیاده‌سازی شده و شواهد پذیرش آن در `docs/stages/02-infrastructure.md` ثبت می‌شود. رابط مرحلهٔ ۳ و هویت ایمیلی مرحلهٔ ۴ پیاده‌سازی شده‌اند؛ شواهد و محدودیت‌ها در `docs/stages/03-responsive-ui.md` و `docs/stages/04-identity.md` ثبت می‌شوند. مراحل ۵ تا ۲۰ برنامه‌ریزی‌شده‌اند.

| مرحله | عنوان             | دامنه                                                                          | معیار پذیرش                                                 | وابستگی بیرونی                 |
| ----- | ----------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------ |
| 1     | معماری و مخزن     | ۳۲ سرویس؛ مالکیت داده؛ قرارداد API و event؛ مونوریپو و CI                      | ساخت تمام workspaceها، تست قرارداد و کنترل مرز سرویس        | بدون اتصال بیرونی              |
| 2     | زیرساخت           | Docker؛ DB/role مستقل؛ Redis؛ NATS؛ Gateway؛ Outbox/Inbox؛ trace و health      | آزمون restart، duplicate delivery، DB isolation و trace     | Docker و فضای ذخیره‌سازی       |
| 3     | رابط دو زبانه     | Design System؛ صفحات عمومی؛ پوسته ۱۲ داشبورد؛ RTL/LTR؛ موبایل                  | آزمون مسیر، ترجمه، keyboard و screenshot در چند viewport    | فونت و دارایی‌های برند         |
| 4     | ورود اصلی         | ایمیل/رمز؛ تأیید ایمیل؛ بازیابی؛ Argon2id؛ نشست و rotation؛ محدودیت تلاش       | ثبت‌نام تا خروج، token reuse، enumeration و rate limit      | SMTP یا email API              |
| 5     | سایر روش‌های ورود | OTP؛ Magic Link؛ Google؛ Apple؛ اتصال حساب؛ MFA و recovery                     | انقضا، replay، account-link takeover و callback نامعتبر     | ارائه‌دهنده پیامک و OAuth      |
| 6     | کاربران و سازمان  | پروفایل؛ سازمان/شعبه؛ permission؛ tenant isolation؛ consent؛ audit             | deny-by-default، عبور tenant، رضایت نسخه‌دار و audit        | بدون حساب بیرونی               |
| 7     | اتصال GapGPT      | آدرس API؛ secret؛ فهرست/ثبت مدل؛ مدل هر capability؛ budget و fallback          | کلید نامعتبر، مدل ناموجود، timeout، SSRF و منع خروج داده    | کلید GapGPT برای تست واقعی     |
| 8     | اساتید و فایل     | تخصص؛ مدارک؛ تأیید؛ تعرفه؛ private upload؛ malware scan                        | مالکیت فایل، MIME spoof، مدرک ردشده و signed URL            | Object Storage و scanner       |
| 9     | تقویم و رزرو      | schedule؛ timezone؛ hold اتمیک؛ saga؛ لغو و reschedule                         | رزرو همزمان یک slot، DST، انقضای hold و جبران               | PostgreSQL/Redis/NATS          |
| 10    | جست‌وجو و تطبیق   | OpenSearch؛ normalize فارسی؛ projection؛ presence؛ ranking                     | بازسازی نمایه، ACL نتیجه، داده کهنه و stale presence        | OpenSearch                     |
| 11    | مالی              | Payment؛ Wallet؛ Ledger؛ Payout؛ Dispute/refund؛ reconciliation                | جمع بدهکار=بستانکار، callback تکراری، late capture و refund | درگاه و حساب تسویه             |
| 12    | پیام و اعلان      | persistent chat؛ reply؛ voice/file؛ receipts؛ notification و reminder          | Refresh، عضویت، تکرار، ترتیب و خطای ارسال                   | SMTP/پیامک/ذخیره‌سازی          |
| 13    | تماس و جلسه       | waiting room؛ device check؛ LiveKit/TURN؛ reconnect؛ consent recording؛ rating | دو شرکت‌کننده، قطعی شبکه، توکن اتاق دیگر و رضایت ناظر       | LiveKit/TURN/TLS و دو دستگاه   |
| 14    | فوری و پشتیبانی   | Talk Now؛ timed offers؛ single winner؛ cancellation؛ tickets و complaint       | دو accept همزمان، timeout، آفلاین‌شدن و شکست پرداخت         | زیرساخت تماس و پرداخت          |
| 15    | سؤال و بانک دانش  | free/paid/priority؛ ناشناس؛ تخصیص؛ SLA؛ review؛ انتشار رضایتمند                | private-to-public leakage، مهلت پاسخ و نسخه انتشار          | بازبین علمی                    |
| 16    | کانال و محتوا     | follow؛ article/audio/video؛ playlist؛ draft/schedule؛ reports                 | انتشار زمان‌دار، دسترسی فایل و fanout اعلان                 | ذخیره‌سازی                     |
| 17    | منبر و رویداد     | public/private؛ paid/free؛ capacity؛ live chat؛ hand؛ polls؛ replay            | ظرفیت همزمان، نقش مدیر/مخاطب، بلیت و replay ACL             | LiveKit/Egress                 |
| 18    | AI پیشرفته        | classification؛ translation؛ STT؛ summary؛ embeddings؛ semantic search         | مدل فاقد capability، منع external و کیفیت خروجی انسانی      | مدل‌های سازگار و نمونه ارزیابی |
| 19    | تلفن و عملیات     | SIP/PSTN؛ IVR؛ CDR؛ costs؛ command center؛ aggregate map                       | تماس واقعی ورودی/خروجی، reconciliation CDR و داده تجمیعی    | SIP trunk و شماره              |
| 20    | تحویل             | E2E؛ load/security؛ backup/restore؛ migration/rollback؛ نصب و راهنمای فارسی    | چرخه کامل خدمت، restore روی محیط تمیز و گزارش ظرفیت         | سرور مقصد و سرویس‌های واقعی    |
