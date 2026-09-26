# ردیابی نیازمندی‌ها

مرجع: پروپوزال «Pasted text(4).txt» و درخواست‌های همین گفت‌وگو. برنامهٔ ۲۰ مرحله‌ای، ورود ایمیل‌محور و GapGPT بر ترتیب کلی فازهای پروپوزال مقدم‌اند.

این جدول از requirements.json ساخته شده است؛ وجود ردیف به معنای پیاده‌سازی نیست. تست‌های مراحل آینده هنوز اجرا نشده‌اند.

| شناسه  | نیازمندی                | مرحله | معیار پذیرش                                                 | وضعیت                          |
| ------ | ----------------------- | ----- | ----------------------------------------------------------- | ------------------------------ |
| R01-01 | ۳۲ سرویس                | 1     | ساخت تمام workspaceها، تست قرارداد و کنترل مرز سرویس        | foundation                     |
| R01-02 | مالکیت داده             | 1     | ساخت تمام workspaceها، تست قرارداد و کنترل مرز سرویس        | foundation                     |
| R01-03 | قرارداد API و event     | 1     | ساخت تمام workspaceها، تست قرارداد و کنترل مرز سرویس        | foundation                     |
| R01-04 | مونوریپو و CI           | 1     | ساخت تمام workspaceها، تست قرارداد و کنترل مرز سرویس        | foundation                     |
| R02-01 | Docker                  | 2     | آزمون restart، duplicate delivery، DB isolation و trace     | planned                        |
| R02-02 | DB/role مستقل           | 2     | آزمون restart، duplicate delivery، DB isolation و trace     | planned                        |
| R02-03 | Redis                   | 2     | آزمون restart، duplicate delivery، DB isolation و trace     | planned                        |
| R02-04 | NATS                    | 2     | آزمون restart، duplicate delivery، DB isolation و trace     | planned                        |
| R02-05 | Gateway                 | 2     | آزمون restart، duplicate delivery، DB isolation و trace     | planned                        |
| R02-06 | Outbox/Inbox            | 2     | آزمون restart، duplicate delivery، DB isolation و trace     | planned                        |
| R02-07 | trace و health          | 2     | آزمون restart، duplicate delivery، DB isolation و trace     | planned                        |
| R03-01 | Design System           | 3     | آزمون مسیر، ترجمه، keyboard و screenshot در چند viewport    | planned                        |
| R03-02 | صفحات عمومی             | 3     | آزمون مسیر، ترجمه، keyboard و screenshot در چند viewport    | planned                        |
| R03-03 | پوسته ۱۲ داشبورد        | 3     | آزمون مسیر، ترجمه، keyboard و screenshot در چند viewport    | planned                        |
| R03-04 | RTL/LTR                 | 3     | آزمون مسیر، ترجمه، keyboard و screenshot در چند viewport    | planned                        |
| R03-05 | موبایل                  | 3     | آزمون مسیر، ترجمه، keyboard و screenshot در چند viewport    | planned                        |
| R04-01 | ایمیل/رمز               | 4     | ثبت‌نام تا خروج، token reuse، enumeration و rate limit      | implemented-integration-tested |
| R04-02 | تأیید ایمیل             | 4     | ثبت‌نام تا خروج، token reuse، enumeration و rate limit      | implemented-integration-tested |
| R04-03 | بازیابی                 | 4     | ثبت‌نام تا خروج، token reuse، enumeration و rate limit      | implemented-integration-tested |
| R04-04 | Argon2id                | 4     | ثبت‌نام تا خروج، token reuse، enumeration و rate limit      | implemented-integration-tested |
| R04-05 | نشست و rotation         | 4     | ثبت‌نام تا خروج، token reuse، enumeration و rate limit      | implemented-integration-tested |
| R04-06 | محدودیت تلاش            | 4     | ثبت‌نام تا خروج، token reuse، enumeration و rate limit      | implemented-integration-tested |
| R05-01 | OTP                     | 5     | انقضا، replay، account-link takeover و callback نامعتبر     | planned                        |
| R05-02 | Magic Link              | 5     | انقضا، replay، account-link takeover و callback نامعتبر     | planned                        |
| R05-03 | Google                  | 5     | انقضا، replay، account-link takeover و callback نامعتبر     | planned                        |
| R05-04 | Apple                   | 5     | انقضا، replay، account-link takeover و callback نامعتبر     | planned                        |
| R05-05 | اتصال حساب              | 5     | انقضا، replay، account-link takeover و callback نامعتبر     | planned                        |
| R05-06 | MFA و recovery          | 5     | انقضا، replay، account-link takeover و callback نامعتبر     | planned                        |
| R06-01 | پروفایل                 | 6     | deny-by-default، عبور tenant، رضایت نسخه‌دار و audit        | planned                        |
| R06-02 | سازمان/شعبه             | 6     | deny-by-default، عبور tenant، رضایت نسخه‌دار و audit        | planned                        |
| R06-03 | permission              | 6     | deny-by-default، عبور tenant، رضایت نسخه‌دار و audit        | planned                        |
| R06-04 | tenant isolation        | 6     | deny-by-default، عبور tenant، رضایت نسخه‌دار و audit        | planned                        |
| R06-05 | consent                 | 6     | deny-by-default، عبور tenant، رضایت نسخه‌دار و audit        | planned                        |
| R06-06 | audit                   | 6     | deny-by-default، عبور tenant، رضایت نسخه‌دار و audit        | planned                        |
| R07-01 | آدرس API                | 7     | کلید نامعتبر، مدل ناموجود، timeout، SSRF و منع خروج داده    | planned                        |
| R07-02 | secret                  | 7     | کلید نامعتبر، مدل ناموجود، timeout، SSRF و منع خروج داده    | planned                        |
| R07-03 | فهرست/ثبت مدل           | 7     | کلید نامعتبر، مدل ناموجود، timeout، SSRF و منع خروج داده    | planned                        |
| R07-04 | مدل هر capability       | 7     | کلید نامعتبر، مدل ناموجود، timeout، SSRF و منع خروج داده    | planned                        |
| R07-05 | budget و fallback       | 7     | کلید نامعتبر، مدل ناموجود، timeout، SSRF و منع خروج داده    | planned                        |
| R08-01 | تخصص                    | 8     | مالکیت فایل، MIME spoof، مدرک ردشده و signed URL            | planned                        |
| R08-02 | مدارک                   | 8     | مالکیت فایل، MIME spoof، مدرک ردشده و signed URL            | planned                        |
| R08-03 | تأیید                   | 8     | مالکیت فایل، MIME spoof، مدرک ردشده و signed URL            | planned                        |
| R08-04 | تعرفه                   | 8     | مالکیت فایل، MIME spoof، مدرک ردشده و signed URL            | planned                        |
| R08-05 | private upload          | 8     | مالکیت فایل، MIME spoof، مدرک ردشده و signed URL            | planned                        |
| R08-06 | malware scan            | 8     | مالکیت فایل، MIME spoof، مدرک ردشده و signed URL            | planned                        |
| R09-01 | schedule                | 9     | رزرو همزمان یک slot، DST، انقضای hold و جبران               | planned                        |
| R09-02 | timezone                | 9     | رزرو همزمان یک slot، DST، انقضای hold و جبران               | planned                        |
| R09-03 | hold اتمیک              | 9     | رزرو همزمان یک slot، DST، انقضای hold و جبران               | planned                        |
| R09-04 | saga                    | 9     | رزرو همزمان یک slot، DST، انقضای hold و جبران               | planned                        |
| R09-05 | لغو و reschedule        | 9     | رزرو همزمان یک slot، DST، انقضای hold و جبران               | planned                        |
| R10-01 | OpenSearch              | 10    | بازسازی نمایه، ACL نتیجه، داده کهنه و stale presence        | planned                        |
| R10-02 | normalize فارسی         | 10    | بازسازی نمایه، ACL نتیجه، داده کهنه و stale presence        | planned                        |
| R10-03 | projection              | 10    | بازسازی نمایه، ACL نتیجه، داده کهنه و stale presence        | planned                        |
| R10-04 | presence                | 10    | بازسازی نمایه، ACL نتیجه، داده کهنه و stale presence        | planned                        |
| R10-05 | ranking                 | 10    | بازسازی نمایه، ACL نتیجه، داده کهنه و stale presence        | planned                        |
| R11-01 | Payment                 | 11    | جمع بدهکار=بستانکار، callback تکراری، late capture و refund | planned                        |
| R11-02 | Wallet                  | 11    | جمع بدهکار=بستانکار، callback تکراری، late capture و refund | planned                        |
| R11-03 | Ledger                  | 11    | جمع بدهکار=بستانکار، callback تکراری، late capture و refund | planned                        |
| R11-04 | Payout                  | 11    | جمع بدهکار=بستانکار، callback تکراری، late capture و refund | planned                        |
| R11-05 | Dispute/refund          | 11    | جمع بدهکار=بستانکار، callback تکراری، late capture و refund | planned                        |
| R11-06 | reconciliation          | 11    | جمع بدهکار=بستانکار، callback تکراری، late capture و refund | planned                        |
| R12-01 | persistent chat         | 12    | Refresh، عضویت، تکرار، ترتیب و خطای ارسال                   | planned                        |
| R12-02 | reply                   | 12    | Refresh، عضویت، تکرار، ترتیب و خطای ارسال                   | planned                        |
| R12-03 | voice/file              | 12    | Refresh، عضویت، تکرار، ترتیب و خطای ارسال                   | planned                        |
| R12-04 | receipts                | 12    | Refresh، عضویت، تکرار، ترتیب و خطای ارسال                   | planned                        |
| R12-05 | notification و reminder | 12    | Refresh، عضویت، تکرار، ترتیب و خطای ارسال                   | planned                        |
| R13-01 | waiting room            | 13    | دو شرکت‌کننده، قطعی شبکه، توکن اتاق دیگر و رضایت ناظر       | planned                        |
| R13-02 | device check            | 13    | دو شرکت‌کننده، قطعی شبکه، توکن اتاق دیگر و رضایت ناظر       | planned                        |
| R13-03 | LiveKit/TURN            | 13    | دو شرکت‌کننده، قطعی شبکه، توکن اتاق دیگر و رضایت ناظر       | planned                        |
| R13-04 | reconnect               | 13    | دو شرکت‌کننده، قطعی شبکه، توکن اتاق دیگر و رضایت ناظر       | planned                        |
| R13-05 | consent recording       | 13    | دو شرکت‌کننده، قطعی شبکه، توکن اتاق دیگر و رضایت ناظر       | planned                        |
| R13-06 | rating                  | 13    | دو شرکت‌کننده، قطعی شبکه، توکن اتاق دیگر و رضایت ناظر       | planned                        |
| R14-01 | Talk Now                | 14    | دو accept همزمان، timeout، آفلاین‌شدن و شکست پرداخت         | planned                        |
| R14-02 | timed offers            | 14    | دو accept همزمان، timeout، آفلاین‌شدن و شکست پرداخت         | planned                        |
| R14-03 | single winner           | 14    | دو accept همزمان، timeout، آفلاین‌شدن و شکست پرداخت         | planned                        |
| R14-04 | cancellation            | 14    | دو accept همزمان، timeout، آفلاین‌شدن و شکست پرداخت         | planned                        |
| R14-05 | tickets و complaint     | 14    | دو accept همزمان، timeout، آفلاین‌شدن و شکست پرداخت         | planned                        |
| R15-01 | free/paid/priority      | 15    | private-to-public leakage، مهلت پاسخ و نسخه انتشار          | planned                        |
| R15-02 | ناشناس                  | 15    | private-to-public leakage، مهلت پاسخ و نسخه انتشار          | planned                        |
| R15-03 | تخصیص                   | 15    | private-to-public leakage، مهلت پاسخ و نسخه انتشار          | planned                        |
| R15-04 | SLA                     | 15    | private-to-public leakage، مهلت پاسخ و نسخه انتشار          | planned                        |
| R15-05 | review                  | 15    | private-to-public leakage، مهلت پاسخ و نسخه انتشار          | planned                        |
| R15-06 | انتشار رضایتمند         | 15    | private-to-public leakage، مهلت پاسخ و نسخه انتشار          | planned                        |
| R16-01 | follow                  | 16    | انتشار زمان‌دار، دسترسی فایل و fanout اعلان                 | planned                        |
| R16-02 | article/audio/video     | 16    | انتشار زمان‌دار، دسترسی فایل و fanout اعلان                 | planned                        |
| R16-03 | playlist                | 16    | انتشار زمان‌دار، دسترسی فایل و fanout اعلان                 | planned                        |
| R16-04 | draft/schedule          | 16    | انتشار زمان‌دار، دسترسی فایل و fanout اعلان                 | planned                        |
| R16-05 | reports                 | 16    | انتشار زمان‌دار، دسترسی فایل و fanout اعلان                 | planned                        |
| R17-01 | public/private          | 17    | ظرفیت همزمان، نقش مدیر/مخاطب، بلیت و replay ACL             | planned                        |
| R17-02 | paid/free               | 17    | ظرفیت همزمان، نقش مدیر/مخاطب، بلیت و replay ACL             | planned                        |
| R17-03 | capacity                | 17    | ظرفیت همزمان، نقش مدیر/مخاطب، بلیت و replay ACL             | planned                        |
| R17-04 | live chat               | 17    | ظرفیت همزمان، نقش مدیر/مخاطب، بلیت و replay ACL             | planned                        |
| R17-05 | hand                    | 17    | ظرفیت همزمان، نقش مدیر/مخاطب، بلیت و replay ACL             | planned                        |
| R17-06 | polls                   | 17    | ظرفیت همزمان، نقش مدیر/مخاطب، بلیت و replay ACL             | planned                        |
| R17-07 | replay                  | 17    | ظرفیت همزمان، نقش مدیر/مخاطب، بلیت و replay ACL             | planned                        |
| R18-01 | classification          | 18    | مدل فاقد capability، منع external و کیفیت خروجی انسانی      | planned                        |
| R18-02 | translation             | 18    | مدل فاقد capability، منع external و کیفیت خروجی انسانی      | planned                        |
| R18-03 | STT                     | 18    | مدل فاقد capability، منع external و کیفیت خروجی انسانی      | planned                        |
| R18-04 | summary                 | 18    | مدل فاقد capability، منع external و کیفیت خروجی انسانی      | planned                        |
| R18-05 | embeddings              | 18    | مدل فاقد capability، منع external و کیفیت خروجی انسانی      | planned                        |
| R18-06 | semantic search         | 18    | مدل فاقد capability، منع external و کیفیت خروجی انسانی      | planned                        |
| R19-01 | SIP/PSTN                | 19    | تماس واقعی ورودی/خروجی، reconciliation CDR و داده تجمیعی    | planned                        |
| R19-02 | IVR                     | 19    | تماس واقعی ورودی/خروجی، reconciliation CDR و داده تجمیعی    | planned                        |
| R19-03 | CDR                     | 19    | تماس واقعی ورودی/خروجی، reconciliation CDR و داده تجمیعی    | planned                        |
| R19-04 | costs                   | 19    | تماس واقعی ورودی/خروجی، reconciliation CDR و داده تجمیعی    | planned                        |
| R19-05 | command center          | 19    | تماس واقعی ورودی/خروجی، reconciliation CDR و داده تجمیعی    | planned                        |
| R19-06 | aggregate map           | 19    | تماس واقعی ورودی/خروجی، reconciliation CDR و داده تجمیعی    | planned                        |
| R20-01 | E2E                     | 20    | چرخه کامل خدمت، restore روی محیط تمیز و گزارش ظرفیت         | planned                        |
| R20-02 | load/security           | 20    | چرخه کامل خدمت، restore روی محیط تمیز و گزارش ظرفیت         | planned                        |
| R20-03 | backup/restore          | 20    | چرخه کامل خدمت، restore روی محیط تمیز و گزارش ظرفیت         | planned                        |
| R20-04 | migration/rollback      | 20    | چرخه کامل خدمت، restore روی محیط تمیز و گزارش ظرفیت         | planned                        |
| R20-05 | نصب و راهنمای فارسی     | 20    | چرخه کامل خدمت، restore روی محیط تمیز و گزارش ظرفیت         | planned                        |
