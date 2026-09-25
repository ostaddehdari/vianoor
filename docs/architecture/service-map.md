# مرز ۳۲ سرویس

مرجع ماشینی: [service-catalog.json](service-catalog.json). همهٔ runtimeها در این مرحله scaffold هستند.
API Gateway بدون دیتابیس دامنه است؛ ۳۱ سرویس دیگر credential و migration مستقل خواهند داشت. Presence از Redis برای lease و از پایگاه مستقل برای تنظیمات پایدار استفاده می‌کند.

| سرویس | عنوان | مالکیت داده | دیتابیس | مرحلهٔ قابلیت |
|---|---|---|---|---|
| api-gateway | درگاه API | بدون دادهٔ دامنه؛ مسیریابی و سیاست ورودی | stateless | 2 |
| identity-service | هویت | حساب، اعتبارنامه، نشست، روش ورود و MFA | identity_db | 4 |
| profile-service | پروفایل | مشخصات عمومی، زبان و منطقه زمانی کاربر | profile_db | 6 |
| organization-service | سازمان | سازمان، شعبه، عضویت و مجوزهای محدوده‌ای | organization_db | 6 |
| taxonomy-service | موضوعات | موضوع، تخصص، زبان و دیدگاه اختیاری | taxonomy_db | 8 |
| scholar-service | اساتید | پروفایل حرفه‌ای، مدارک، تأیید، خدمات و تعرفه | scholar_db | 8 |
| availability-service | دسترس‌پذیری | برنامه کاری، استثنا، slot و نگهداری اتمیک ظرفیت | availability_db | 9 |
| presence-service | حضور | lease حضور آنلاین و TTL؛ منبع حقیقت فقط حضور موقت | presence_db | 10 |
| matching-service | تطبیق | read model نامزدها و قواعد رتبه‌بندی؛ نه مالک پروفایل | matching_db | 10 |
| booking-service | رزرو | رزرو، چرخه جلسه کسب‌وکار و saga مستقل از transport | booking_db | 9 |
| instant-service | مشاوره فوری | درخواست فوری، صف پایدار، پیشنهاد و انقضای آن | instant_db | 14 |
| media-service | رسانه زنده | اتصال اتاق به جلسه، سیاست توکن، ضبط و webhook | media_db | 13 |
| messaging-service | پیام‌رسان | مکالمه پایدار، عضو، پیام و رسید خواندن | messaging_db | 12 |
| file-service | فایل | metadata، مالکیت، دسترسی و وضعیت اسکن؛ bytes در object storage | file_db | 8 |
| payment-service | پرداخت | intent، تراکنش درگاه، verification و idempotency | payment_db | 11 |
| wallet-service | کیف پول | ورودی تغییر موجودی، hold و مانده قابل بازسازی | wallet_db | 11 |
| accounting-service | حسابداری | دفترکل دوطرفه، اسناد و تطبیق؛ مرجع حسابداری | accounting_db | 11 |
| payout-service | تسویه | درآمد استاد، سهم، payable و انتقال تسویه | payout_db | 11 |
| dispute-service | اختلافات و بازپرداخت | پرونده اختلاف، تصمیم و orchestration بازپرداخت | dispute_db | 11 |
| content-service | محتوا و کانال | کانال، دنبال‌کردن، پست، مجموعه و انتشار | content_db | 16 |
| event-service | رویداد و منبر | رویداد، ظرفیت، ثبت‌نام، نقش‌ها، نظرسنجی و بازپخش | event_db | 17 |
| qa-service | پرسش‌وپاسخ | سؤال خصوصی، پاسخ، تخصیص، SLA و نسخه عمومی بانک دانش | qa_db | 15 |
| rating-service | ارزیابی | امتیاز پس از خدمت، بازخورد و aggregate اعتبار | rating_db | 13 |
| moderation-service | نظارت | پرونده بازبینی علمی/محتوایی، گزارش و تصمیم؛ نه متن اصلی | moderation_db | 15 |
| consent-service | رضایت | سیاست نسخه‌دار، پذیرش، لغو و دامنه رضایت | consent_db | 6 |
| notification-service | اعلان | قالب محلی‌شده، ترجیحات، کار ارسال و وضعیت تحویل | notification_db | 4 |
| search-service | جست‌وجو | نمایه قابل بازسازی و checkpoint؛ نه مالک محتوای اصلی | search_db | 10 |
| analytics-service | تحلیل | read model تجمیعی بدون query مستقیم پایگاه‌های عملیاتی | analytics_db | 19 |
| audit-service | حسابرسی | سوابق append-only عملیات حساس و دسترسی | audit_db | 6 |
| support-service | پشتیبانی | تیکت، مکاتبه پشتیبانی، ارجاع و پیگیری شکایت | support_db | 14 |
| ai-gateway | درگاه هوش مصنوعی | provider، مرجع کلید، مدل هر قابلیت، بودجه و سیاست داده | ai_gateway_db | 7 |
| telephony-service | تلفن اینترنتی | trunk، شماره، مسیر، call leg، IVR و CDR | telephony_db | 19 |

## قانون وابستگی

`dependencies` وابستگی منطقی از طریق HTTP یا رویداد است، نه اجازهٔ import، query یا فراخوانی هم‌زمان زنجیره‌ای. هیچ Entity میان سرویس‌ها مشترک نیست. Projection مالک نسخهٔ قابل بازسازی داده است و منبع حقیقت نیست.

## مالک جلسه

Booking مالک BusinessSession و چرخهٔ خدمت است. Media مالک room/token/recording binding است. Telephony مالک call leg و CDR است؛ افزودن SIP مدل رزرو را تغییر نمی‌دهد. Messaging مستقل از LiveKit و پایدار است.

## مرزهای مالی

Payment وضعیت پرداخت درگاه را تأیید می‌کند. Accounting سند متوازن و مرجع حسابداری نگه می‌دارد. Wallet entryهای idempotent و hold را مدیریت می‌کند و قابل تطبیق با دفترکل است. Payout درآمد و بدهی استاد و تسویه را مدیریت می‌کند. Dispute تصمیم بازپرداخت را صادر می‌کند؛ اجرای آن بر عهده Payment/Wallet و ثبت حسابداری بر عهده Accounting است.
