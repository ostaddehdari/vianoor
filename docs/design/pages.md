# فهرست صفحات و نقش‌ها

این registry نقشهٔ محصول است، نه router فعال. مرحلهٔ ۳ پوسته‌ها را می‌سازد؛ اتصال هر قابلیت در businessStage. permission در API اجرا می‌شود؛ پنهان‌کردن منو امنیت نیست.

| صفحه                          | برنامه | مسیر                                         | نقش           | مرحله قابلیت |
| ----------------------------- | ------ | -------------------------------------------- | ------------- | ------------ |
| صفحه اول                      | web    | `/[locale]/`                                 | public        | 3            |
| درباره و مأموریت              | web    | `/[locale]/about`                            | public        | 3            |
| نحوه کار                      | web    | `/[locale]/how-it-works`                     | public        | 3            |
| خدمات                         | web    | `/[locale]/services`                         | public        | 3            |
| معرفی هر خدمت                 | web    | `/[locale]/services/[slug]`                  | public        | 3            |
| موضوعات                       | web    | `/[locale]/topics`                           | public        | 3            |
| صفحه موضوع                    | web    | `/[locale]/topics/[slug]`                    | public        | 3            |
| جست‌وجوی اساتید               | web    | `/[locale]/experts`                          | public        | 3            |
| پروفایل استاد                 | web    | `/[locale]/experts/[slug]`                   | public        | 3            |
| جست‌وجوی سراسری               | web    | `/[locale]/search`                           | public        | 3            |
| مرکز راهنما                   | web    | `/[locale]/help`                             | public        | 3            |
| راهنما                        | web    | `/[locale]/help/[slug]`                      | public        | 3            |
| پرسش‌های متداول               | web    | `/[locale]/faq`                              | public        | 3            |
| تماس                          | web    | `/[locale]/contact`                          | public        | 3            |
| اطلاعیه‌ها                    | web    | `/[locale]/announcements`                    | public        | 3            |
| جزئیات اطلاعیه                | web    | `/[locale]/announcements/[slug]`             | public        | 3            |
| همکاری استاد                  | web    | `/[locale]/join-experts`                     | public        | 3            |
| همکاری سازمانی                | web    | `/[locale]/organizations`                    | public        | 3            |
| قوانین، حریم خصوصی و سیاست‌ها | web    | `/[locale]/policies/[slug]`                  | public        | 3            |
| بانک دانش                     | web    | `/[locale]/questions`                        | public        | 15           |
| پاسخ منتشرشده                 | web    | `/[locale]/questions/[slug]`                 | public        | 15           |
| کتابخانه                      | web    | `/[locale]/library`                          | public        | 16           |
| مقاله/صوت/ویدئو               | web    | `/[locale]/library/[slug]`                   | public        | 16           |
| مجموعه                        | web    | `/[locale]/collections/[slug]`               | public        | 16           |
| کانال‌ها                      | web    | `/[locale]/channels`                         | public        | 16           |
| کانال استاد                   | web    | `/[locale]/channels/[slug]`                  | public        | 16           |
| فهرست برنامه‌ها               | web    | `/[locale]/events`                           | public        | 17           |
| تقویم رویداد                  | web    | `/[locale]/events/calendar`                  | public        | 17           |
| جزئیات رویداد                 | web    | `/[locale]/events/[slug]`                    | public        | 17           |
| بازپخش مجاز                   | web    | `/[locale]/events/[slug]/replay`             | public        | 17           |
| ورود                          | web    | `/[locale]/auth/login`                       | guest         | 4            |
| ثبت‌نام                       | web    | `/[locale]/auth/register`                    | guest         | 4            |
| تأیید ایمیل                   | web    | `/[locale]/auth/verify-email`                | guest         | 4            |
| فراموشی رمز                   | web    | `/[locale]/auth/forgot-password`             | guest         | 4            |
| تعیین رمز                     | web    | `/[locale]/auth/reset-password`              | guest         | 4            |
| کد پیامکی                     | web    | `/[locale]/auth/otp`                         | guest         | 5            |
| پیوند ورود                    | web    | `/[locale]/auth/magic-link`                  | guest         | 5            |
| بازگشت OAuth                  | web    | `/[locale]/auth/oauth/[provider]/callback`   | guest         | 5            |
| ورود دومرحله‌ای               | web    | `/[locale]/auth/mfa`                         | guest         | 5            |
| کد بازیابی                    | web    | `/[locale]/auth/recovery`                    | guest         | 5            |
| دعوت                          | web    | `/[locale]/auth/invitation`                  | guest         | 5            |
| مشخصات                        | web    | `/[locale]/settings/profile`                 | authenticated | 6            |
| ترجیحات                       | web    | `/[locale]/settings/preferences`             | authenticated | 6            |
| امنیت                         | web    | `/[locale]/settings/security`                | authenticated | 6            |
| دستگاه‌ها                     | web    | `/[locale]/settings/sessions`                | authenticated | 6            |
| روش‌های ورود                  | web    | `/[locale]/settings/connections`             | authenticated | 6            |
| رضایت و حریم خصوصی            | web    | `/[locale]/settings/privacy`                 | authenticated | 6            |
| درخواست داده                  | web    | `/[locale]/settings/data-requests`           | authenticated | 6            |
| انتخاب نقش و سازمان           | web    | `/[locale]/workspaces`                       | authenticated | 6            |
| داشبورد مراجعه‌کننده          | web    | `/[locale]/account`                          | client        | 9            |
| انتخاب خدمت/استاد/زمان        | web    | `/[locale]/account/book`                     | client        | 9            |
| جلسات                         | web    | `/[locale]/account/bookings`                 | client        | 9            |
| جزئیات رزرو                   | web    | `/[locale]/account/bookings/[id]`            | client        | 9            |
| جابه‌جایی                     | web    | `/[locale]/account/bookings/[id]/reschedule` | client        | 9            |
| لغو                           | web    | `/[locale]/account/bookings/[id]/cancel`     | client        | 9            |
| تست دستگاه                    | web    | `/[locale]/account/bookings/[id]/preflight`  | client        | 13           |
| انتظار                        | web    | `/[locale]/account/bookings/[id]/waiting`    | client        | 13           |
| جلسه                          | web    | `/[locale]/account/bookings/[id]/room`       | client        | 13           |
| نتیجه و بازخورد               | web    | `/[locale]/account/bookings/[id]/result`     | client        | 13           |
| مشاوره فوری                   | web    | `/[locale]/account/instant`                  | client        | 14           |
| صف و پیشنهاد                  | web    | `/[locale]/account/instant/[id]`             | client        | 14           |
| سؤال‌های من                   | web    | `/[locale]/account/questions`                | client        | 15           |
| ثبت سؤال                      | web    | `/[locale]/account/questions/new`            | client        | 15           |
| پاسخ و پیگیری                 | web    | `/[locale]/account/questions/[id]`           | client        | 15           |
| مکالمات                       | web    | `/[locale]/messages`                         | authenticated | 12           |
| گفت‌وگو                       | web    | `/[locale]/messages/[id]`                    | authenticated | 12           |
| اعلان‌ها                      | web    | `/[locale]/notifications`                    | authenticated | 12           |
| ترجیحات اعلان                 | web    | `/[locale]/settings/notifications`           | authenticated | 12           |
| کیف پول                       | web    | `/[locale]/account/wallet`                   | client        | 11           |
| پرداخت‌ها                     | web    | `/[locale]/account/payments`                 | client        | 11           |
| رسید                          | web    | `/[locale]/account/payments/[id]`            | client        | 11           |
| بازپرداخت و اعتراض            | web    | `/[locale]/account/refunds`                  | client        | 11           |
| نتیجه بازگشت از درگاه         | web    | `/[locale]/payments/return`                  | client        | 11           |
| دنبال‌شده‌ها                  | web    | `/[locale]/account/following`                | client        | 16           |
| ذخیره‌شده‌ها                  | web    | `/[locale]/account/saved`                    | client        | 16           |
| رویدادهای من                  | web    | `/[locale]/account/events`                   | client        | 17           |
| تیکت‌ها                       | web    | `/[locale]/tickets`                          | authenticated | 14           |
| ثبت تیکت                      | web    | `/[locale]/tickets/new`                      | authenticated | 14           |
| جزئیات تیکت                   | web    | `/[locale]/tickets/[id]`                     | authenticated | 14           |
| داشبورد استاد                 | web    | `/[locale]/expert`                           | expert        | 8            |
| شروع همکاری                   | web    | `/[locale]/expert/onboarding`                | expert        | 8            |
| پروفایل حرفه‌ای               | web    | `/[locale]/expert/profile`                   | expert        | 8            |
| مدارک                         | web    | `/[locale]/expert/credentials`               | expert        | 8            |
| خدمات و تعرفه‌ها              | web    | `/[locale]/expert/offerings`                 | expert        | 8            |
| فایل‌ها                       | web    | `/[locale]/expert/files`                     | expert        | 8            |
| تقویم                         | web    | `/[locale]/expert/calendar`                  | expert        | 9            |
| برنامه هفتگی و استثنا         | web    | `/[locale]/expert/availability`              | expert        | 9            |
| جلسات                         | web    | `/[locale]/expert/sessions`                  | expert        | 9            |
| جزئیات جلسه                   | web    | `/[locale]/expert/sessions/[id]`             | expert        | 9            |
| یادداشت و پیگیری              | web    | `/[locale]/expert/sessions/[id]/notes`       | expert        | 13           |
| مراجعان مجاز                  | web    | `/[locale]/expert/clients`                   | expert        | 13           |
| عملکرد و بازخورد              | web    | `/[locale]/expert/performance`               | expert        | 13           |
| درخواست فوری                  | web    | `/[locale]/expert/instant`                   | expert        | 14           |
| کارتابل سؤال                  | web    | `/[locale]/expert/questions`                 | expert        | 15           |
| پاسخ‌نویسی و کمک AI           | web    | `/[locale]/expert/questions/[id]`            | expert        | 15           |
| کانال من                      | web    | `/[locale]/expert/channel`                   | expert        | 16           |
| مدیریت محتوا                  | web    | `/[locale]/expert/content`                   | expert        | 16           |
| ویرایشگر محتوا                | web    | `/[locale]/expert/content/[id]/edit`         | expert        | 16           |
| رویدادها                      | web    | `/[locale]/expert/events`                    | expert        | 17           |
| اتاق سخنران                   | web    | `/[locale]/expert/events/[id]/studio`        | expert        | 17           |
| درآمد                         | web    | `/[locale]/expert/earnings`                  | expert        | 11           |
| تسویه                         | web    | `/[locale]/expert/payouts`                   | expert        | 11           |
| حساب مقصد                     | web    | `/[locale]/expert/payout-account`            | expert        | 11           |
| داشبورد علمی                  | admin  | `/[locale]/scientific`                       | scientific    | 15           |
| ارزیابی استاد                 | admin  | `/[locale]/scientific/credentials`           | scientific    | 15           |
| تخصیص                         | admin  | `/[locale]/scientific/assignments`           | scientific    | 15           |
| بررسی پاسخ                    | admin  | `/[locale]/scientific/reviews`               | scientific    | 15           |
| جزئیات بررسی                  | admin  | `/[locale]/scientific/reviews/[id]`          | scientific    | 15           |
| ارجاع و SLA                   | admin  | `/[locale]/scientific/escalations`           | scientific    | 15           |
| اجازه انتشار                  | admin  | `/[locale]/scientific/publication`           | scientific    | 15           |
| کیفیت                         | admin  | `/[locale]/scientific/quality`               | scientific    | 15           |
| راهنما و منابع                | admin  | `/[locale]/scientific/guidelines`            | scientific    | 15           |
| داشبورد پشتیبانی              | admin  | `/[locale]/support`                          | support       | 14           |
| صف فوری                       | admin  | `/[locale]/support/queue`                    | support       | 14           |
| مانیتور جلسات                 | admin  | `/[locale]/support/sessions`                 | support       | 14           |
| رسیدگی رزرو                   | admin  | `/[locale]/support/bookings`                 | support       | 14           |
| کارتابل تیکت                  | admin  | `/[locale]/support/tickets`                  | support       | 14           |
| رسیدگی تیکت                   | admin  | `/[locale]/support/tickets/[id]`             | support       | 14           |
| شکایت‌ها                      | admin  | `/[locale]/support/complaints`               | support       | 14           |
| گزارش شیفت                    | admin  | `/[locale]/support/shifts`                   | support       | 14           |
| داشبورد مالی                  | admin  | `/[locale]/finance`                          | finance       | 11           |
| تراکنش‌ها                     | admin  | `/[locale]/finance/transactions`             | finance       | 11           |
| تطبیق                         | admin  | `/[locale]/finance/reconciliation`           | finance       | 11           |
| کیف پول‌ها                    | admin  | `/[locale]/finance/wallets`                  | finance       | 11           |
| دفترکل                        | admin  | `/[locale]/finance/ledger`                   | finance       | 11           |
| سند حسابداری                  | admin  | `/[locale]/finance/journals/[id]`            | finance       | 11           |
| درآمد اساتید                  | admin  | `/[locale]/finance/earnings`                 | finance       | 11           |
| وجوه در انتظار                | admin  | `/[locale]/finance/holds`                    | finance       | 11           |
| تسویه                         | admin  | `/[locale]/finance/payouts`                  | finance       | 11           |
| بازپرداخت                     | admin  | `/[locale]/finance/refunds`                  | finance       | 11           |
| اختلاف                        | admin  | `/[locale]/finance/disputes`                 | finance       | 11           |
| کارمزد                        | admin  | `/[locale]/finance/fees`                     | finance       | 11           |
| گزارش‌ها                      | admin  | `/[locale]/finance/reports`                  | finance       | 11           |
| داشبورد محتوا                 | admin  | `/[locale]/content`                          | content       | 16           |
| صفحات عمومی                   | admin  | `/[locale]/content/pages`                    | content       | 16           |
| منو و پابرگ                   | admin  | `/[locale]/content/navigation`               | content       | 16           |
| کتابخانه                      | admin  | `/[locale]/content/library`                  | content       | 16           |
| بازبینی                       | admin  | `/[locale]/content/reviews`                  | content       | 16           |
| کانال‌ها                      | admin  | `/[locale]/content/channels`                 | content       | 16           |
| دسته و برچسب                  | admin  | `/[locale]/content/taxonomy`                 | content       | 16           |
| رسانه                         | admin  | `/[locale]/content/media`                    | content       | 16           |
| ترجمه و SEO                   | admin  | `/[locale]/content/translations`             | content       | 16           |
| مدیریت رویداد                 | admin  | `/[locale]/content/events`                   | content       | 17           |
| ثبت‌نام و عوامل               | admin  | `/[locale]/content/events/[id]`              | content       | 17           |
| کنترل زنده و تعامل            | admin  | `/[locale]/content/events/[id]/control`      | content       | 17           |
| ضبط و بازپخش                  | admin  | `/[locale]/content/recordings`               | content       | 17           |
| داشبورد سازمان                | admin  | `/[locale]/organization`                     | organization  | 6            |
| مشخصات                        | admin  | `/[locale]/organization/settings`            | organization  | 6            |
| مناطق و شعب                   | admin  | `/[locale]/organization/branches`            | organization  | 6            |
| اعضا                          | admin  | `/[locale]/organization/members`             | organization  | 6            |
| مجوزها                        | admin  | `/[locale]/organization/permissions`         | organization  | 6            |
| اساتید سازمان                 | admin  | `/[locale]/organization/experts`             | organization  | 19           |
| خدمات                         | admin  | `/[locale]/organization/services`            | organization  | 19           |
| جلسات و سؤال‌ها               | admin  | `/[locale]/organization/activity`            | organization  | 19           |
| مالی و عملکرد                 | admin  | `/[locale]/organization/reports`             | organization  | 19           |
| داشبورد کل                    | admin  | `/[locale]/admin`                            | admin         | 6            |
| کاربران                       | admin  | `/[locale]/admin/users`                      | admin         | 6            |
| جزئیات کاربر                  | admin  | `/[locale]/admin/users/[id]`                 | admin         | 6            |
| نقش و مجوز                    | admin  | `/[locale]/admin/roles`                      | admin         | 6            |
| سازمان‌ها                     | admin  | `/[locale]/admin/organizations`              | admin         | 6            |
| سیاست و رضایت                 | admin  | `/[locale]/admin/consents`                   | admin         | 6            |
| سابقه عملیات                  | admin  | `/[locale]/admin/audit`                      | admin         | 6            |
| تنظیمات عمومی                 | admin  | `/[locale]/admin/settings`                   | admin         | 6            |
| نمای AI                       | admin  | `/[locale]/admin/ai`                         | admin         | 7            |
| ارائه‌دهندگان                 | admin  | `/[locale]/admin/ai/providers`               | admin         | 7            |
| آدرس، کلید و آزمایش اتصال     | admin  | `/[locale]/admin/ai/providers/[id]`          | admin         | 7            |
| مدل‌ها                        | admin  | `/[locale]/admin/ai/models`                  | admin         | 7            |
| مدل هر کاربرد                 | admin  | `/[locale]/admin/ai/routes`                  | admin         | 7            |
| مصرف و بودجه                  | admin  | `/[locale]/admin/ai/usage`                   | admin         | 7            |
| حریم خصوصی و fallback         | admin  | `/[locale]/admin/ai/policies`                | admin         | 7            |
| دستورهای نسخه‌دار             | admin  | `/[locale]/admin/ai/prompts`                 | admin         | 18           |
| ارزیابی کیفیت                 | admin  | `/[locale]/admin/ai/evaluation`              | admin         | 18           |
| منابع معنایی                  | admin  | `/[locale]/admin/ai/sources`                 | admin         | 18           |
| نمای زنده                     | admin  | `/[locale]/call-center`                      | telephony     | 19           |
| صف                            | admin  | `/[locale]/call-center/queue`                | telephony     | 19           |
| داخلی‌ها                      | admin  | `/[locale]/call-center/extensions`           | telephony     | 19           |
| مسیر و IVR                    | admin  | `/[locale]/call-center/routes`               | telephony     | 19           |
| اتصال SIP                     | admin  | `/[locale]/call-center/trunks`               | telephony     | 19           |
| سوابق و CDR                   | admin  | `/[locale]/call-center/history`              | telephony     | 19           |
| ضبط‌های مجاز                  | admin  | `/[locale]/call-center/recordings`           | telephony     | 19           |
| هزینه و کیفیت                 | admin  | `/[locale]/call-center/costs`                | telephony     | 19           |
| سلامت سرویس‌ها                | admin  | `/[locale]/operations`                       | operations    | 19           |
| رخدادها                       | admin  | `/[locale]/operations/incidents`             | operations    | 19           |
| خطا و trace                   | admin  | `/[locale]/operations/traces`                | operations    | 19           |
| صف و DLQ                      | admin  | `/[locale]/operations/queues`                | operations    | 19           |
| کارهای پس‌زمینه               | admin  | `/[locale]/operations/jobs`                  | operations    | 19           |
| نمایه                         | admin  | `/[locale]/operations/search`                | operations    | 19           |
| رسانه                         | admin  | `/[locale]/operations/media`                 | operations    | 19           |
| ارسال اعلان                   | admin  | `/[locale]/operations/delivery`              | operations    | 19           |
| نسخه و استقرار                | admin  | `/[locale]/operations/releases`              | operations    | 19           |
| پشتیبان‌گیری                  | admin  | `/[locale]/operations/backups`               | operations    | 19           |
| هشدار امنیتی                  | admin  | `/[locale]/operations/security`              | operations    | 19           |

حالت‌های مشترک: loading، empty، error، success، expired، unauthorized، offline/reconnecting؛ صفحات 404/403/500 و نگهداری در مرحلهٔ ۳. تنظیمات حساب کارکنان در admin با اجزای مشترک ساخته می‌شوند؛ registry مسیر canonical در web را ثبت کرده است.
