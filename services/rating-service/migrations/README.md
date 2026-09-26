# مالک migration: rating-service

فقط `rating_db` با credential همین سرویس. مرحلهٔ ۲ جدول‌های فنی Outbox/Inbox را با migration idempotent و advisory lock در runtime ایجاد می‌کند. migration دامنه هنوز اضافه نشده است؛ ابزار نسخه‌بندی migration دامنه همراه پیاده‌سازی همین سرویس افزوده خواهد شد.
