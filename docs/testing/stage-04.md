# آزمون‌های مرحلهٔ ۴

- `tests/identity-security.test.ts`: Argon2id، salt مستقل، رمز غلط، دستکاری ciphertext، کلید اشتباه، محدودکننده و رد تنظیم production ناامن.
- `tests/integration/identity.test.ts`: PostgreSQL/Redis/NATS واقعی و SMTP به Mailpit؛ ثبت‌نام تا دریافت لینک، تأیید، ورود، rotation، بازپخش، ابطال همهٔ نشست‌ها، reset، عدم افشای وجود حساب و rate limit.
- آزمون هم‌زمانی refresh: فقط یک درخواست rotate می‌کند و مصرف دوباره خانواده را باطل می‌کند؛ نشست کاربر دیگر قابل ابطال نیست؛ انقضای access، refresh مطلق و لینک با زمان DB بررسی می‌شود.
- آزمون BFF واقعی: Origin نامعتبر و content-type نامناسب رد می‌شوند؛ توکن در JSON بیرون نمی‌آید؛ cookie HttpOnly/SameSite/Path دارد و خروج توکن قبلی را نامعتبر می‌کند. Secure در production از تنظیم HTTPS فعال می‌شود؛ محیط Docker CI از HTTP loopback استفاده می‌کند.
- `tests/ui/auth.spec.ts`: ۶ فرم × ۲ زبان × ۲ viewport؛ overflow، axe WCAG2 A/AA، تصویر صفحه، عدم تطابق رمز و پیام تنظیم‌نشدن backend.
- `tests/identity-ui/lifecycle.spec.ts`: چرخهٔ مرورگری ثبت‌نام، لینک SMTP، تأیید، ورود، امنیت حساب، خروج و بازیابی با backend واقعی در دو زبان و دو viewport.
- workflow `Identity integration`: ساخت کانتینرهای واقعی، آزمون چرخه، restart و readiness.
- workflowهای Foundation، Infrastructure و Responsive UI همچنان مرحله‌های قبلی را بررسی می‌کنند.

اجرای مرورگر فرم‌ها در workflow عمومی بدون backend است؛ آزمون‌های چرخهٔ HTTP در workflow Identity با backend واقعی اجرا می‌شوند. آزمون ارسال به SMTP بیرونی یا رسیدن به Gmail/سرویس ایمیل کاربر انجام نشده است. آزمون خودکار دسترس‌پذیری، گواهی کامل دسترس‌پذیری نیست.

منابع تصمیم‌های امنیتی:

- https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html

شاهد اولیهٔ موفق backend و restart: https://github.com/ostaddehdari/vianoor/actions/runs/36228015031 . بررسی نهایی مرورگر در workflowهای شاخه ثبت می‌شود.
