# مرحلهٔ ۵ — وضعیت جاری و فعال‌سازی ارائه‌دهندگان

این شاخه شروع مرحلهٔ ۵ است و هنوز انتشار کامل آن نیست. ورود ایمیل/رمز از مرحلهٔ ۴ به داشبورد حساب منتقل شده و فرم ورود در یک مودال دو مرحله‌ای روی سایت نمایش داده می‌شود. دکمه‌های سایر روش‌ها تا زمان پیاده‌سازی و آزمون callback و تنظیم کلیدها غیرفعال‌اند. داشبوردها و مسیر ویرایش پروفایل در کد فعلی پیش‌نمایش هستند؛ مجوز نقش، چند نقش، تکمیل اجباری پروفایل، اتصال حساب‌ها و کد بازیابی هنوز پیاده نشده‌اند.

## تشخیص تحویل ایمیل

`POST /register` یعنی درخواست پذیرفته و ایمیل در صف رمزگذاری‌شده ثبت شده است؛ رسیدن پیام به صندوق کاربر را تأیید نمی‌کند. سرویس هویت اکنون یک وضعیت داخلی با کلید مشترک دارد که بدون افشای گیرنده یا متن ایمیل، اتصال SMTP و تعداد صف و تلاش‌های مجدد را گزارش می‌کند. روی سرور اجرا کنید:

```bash
docker exec vianoor-stage4-identity-service-1 node -e '
fetch("http://127.0.0.1:4101/internal/mail-status", {
  headers: { "x-internal-key": process.env.AUTH_INTERNAL_KEY ?? "" }
}).then(async r => { console.log(r.status, await r.text()); if (!r.ok) process.exitCode = 1 })
.catch(() => { console.error("Identity unreachable"); process.exitCode = 1 })
'
```

`smtp_ready=false` یعنی ارتباط/احراز هویت SMTP از محل کانتینر کار نمی‌کند. `retried>0` یعنی worker برای پیام‌های صف‌شده شکست خورده است. `smtp_ready=true` فقط توان برقراری اتصال و ورود SMTP را نشان می‌دهد؛ تحویل نهایی را باید با ایمیل واقعی و گزارش ارائه‌دهنده آزمود. تنظیم `SMTP_HOST`، `SMTP_PORT`، `SMTP_FROM`، `SMTP_USER`، `SMTP_PASSWORD` در محیط امن سرور انجام می‌شود؛ رمزها را در Git یا خروجی ترمینال چاپ نکنید. پیش از آزمون ارسال، SPF/DKIM/DMARC دامنه و سیاست ارسال ارائه‌دهنده را بررسی کنید.

## اطلاعات مورد نیاز برای فعال‌سازی روش‌ها

| روش      | تنظیم در ارائه‌دهنده                                                     | کلید/تنظیم مورد نیاز در نصب                   |
| -------- | ------------------------------------------------------------------------ | --------------------------------------------- |
| Google   | پروژه و صفحه رضایت OAuth؛ وب کلاینت و redirect URI دقیق                  | Client ID و Secret                            |
| Facebook | اپ Meta و محصول Facebook Login؛ redirect URI معتبر و وضعیت انتشار مناسب  | App ID و App Secret                           |
| Apple    | App ID با Sign in with Apple، Services ID، دامنه و Return URL، کلید امضا | Services ID، Team ID، Key ID و private key    |
| موبایل   | حساب سرویس پیامک و شماره/سرویس تأیید مناسب با منطقه کاربر                | اعتبارنامه سرویس، سیاست هزینه و محدودیت ارسال |

Callback باید HTTPS و دقیقاً همان نشانی ثبت‌شده نزد ارائه‌دهنده باشد. کد این شاخه هنوز callback قابل استفاده ندارد؛ ثبت‌کردن نشانی حدسی یا روشن‌کردن دکمه‌ها پیش از تکمیل state، PKCE، اعتبارسنجی توکن و آزمون اتصال حساب امن نیست. برای اتصال یک روش جدید به حساب موجود، کاربر باید ابتدا نشست معتبر داشته باشد و هویت تازه مستقل تأیید شود؛ یکسان بودن ایمیل ارائه‌دهنده به‌تنهایی اجازه ادغام حساب نیست.

راهنمای رسمی: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)، [Meta Facebook Login](https://developers.facebook.com/docs/facebook-login/web/)، [Apple Sign in for the web](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/)، و [Twilio Verify SMS](https://www.twilio.com/docs/verify/sms). سرویس پیامک باید با شماره‌ها و کشور مخاطبان سازگار انتخاب شود؛ Twilio تنها یک نمونه است.
