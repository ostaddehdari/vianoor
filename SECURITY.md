# امنیت

کلید، رمز، دادهٔ شخصی، متن مشاوره و فایل حساس در issue عمومی یا Git قرار نگیرد. رخداد حساس را از کانال خصوصی تعیین‌شده توسط مالک پروژه گزارش کنید؛ در حال حاضر ایمیل عمومی امنیت تعیین نشده است.

اسکلت مرحلهٔ ۱ فاقد authentication و business readiness است؛ به‌عنوان سرویس عملیاتی عمومی مستقر نشود. آدرس bind پیش‌فرض localhost است. صفحه‌های web/admin صرفاً معرفی توسعه‌اند.

در مراحل بعد: least privilege، permission و tenant در مالک داده، secret reference، log redaction، audit، consent، rate limits و کنترل فایل. package-lock نسخهٔ دقیق وابستگی‌ها را تثبیت می‌کند؛ CI audit وابستگی‌های production را بررسی می‌کند.
