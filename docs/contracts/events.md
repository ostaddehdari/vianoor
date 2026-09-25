# قرارداد رویداد v1

Schema اجرایی در `packages/contracts/src/index.ts`؛ رویداد نمونه payment.payment.captured.v1 اکنون صرفاً قرارداد است، publisher و consumer در مرحلهٔ ۱۱ ساخته می‌شوند.

- Subject: `<domain>.<entity>.<action>.vN` و event_version باید منطبق باشند.
- UUID برای event/correlation/causation/aggregate. trace_id استاندارد ۳۲ رقم hex؛ زمان UTC با Z.
- tenant_id برای رویدادهای سراسری nullable؛ برای پرداخت اجباری. مجوز tenant خارج از schema کنترل می‌شود.
- aggregate_version برای جلوگیری از regression. payload بدون متن مشاوره، رمز و کلید API.
- Producer schema قبل از Outbox و consumer قبل از اثر کسب‌وکار validate می‌کند.
- کلید Inbox `(consumer_name,event_id)`؛ commit اثر و Inbox اتمیک. ack بعد از commit؛ retry با backoff و سقف، سپس DLQ.
- حذف/تغییر معنی فیلد یا افزودن فیلد در strict schema نیازمند نسخهٔ جدید؛ نسخه‌های قدیم تا مهاجرت consumer حفظ شوند.
- پول amount_minor رشته صحیح و currency مشخص است؛ تومان کد ذخیره‌سازی نیست.

## نمونه رویدادهای برنامه‌ریزی‌شده

| Subject | مالک | مصرف‌کننده | مرحله |
|---|---|---|---|
| identity.account.registered.v1 | Identity | Profile, Notification, Audit | ۴ |
| scholar.scholar.verified.v1 | Scholar | Search, Matching, Notification | ۸ |
| availability.slot.held.v1 | Availability | Booking | ۹ |
| booking.booking.confirmed.v1 | Booking | Notification, Messaging, Media | ۹–۱۳ |
| payment.payment.captured.v1 | Payment | Booking, Accounting, Wallet | ۱۱ |
| booking.session.completed.v1 | Booking | Payout, Rating, Analytics | ۱۳ |
| qa.answer.published.v1 | Q&A | Search, Notification | ۱۵ |
| content.post.published.v1 | Content | Search, Notification | ۱۶ |

فقط payment.captured payload در این مرحله schema اجرایی دارد؛ بقیه در مرحلهٔ مالک خود با payload حداقلی تثبیت می‌شوند.
