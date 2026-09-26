export const roles = [
  {
    id: 'account',
    title: {
      fa: 'مراجعه‌کننده',
      en: 'My space',
    },
    headline: {
      fa: 'مسیر آرامش شما، از همین‌جا',
      en: 'A little clarity, every day',
    },
    icon: 'calendar',
    metrics: {
      fa: ['جلسات پیش رو', 'پرسش‌های من', 'پاسخ‌های دریافت‌شده', 'یادداشت‌های ذخیره‌شده'],
      en: ['Upcoming sessions', 'My questions', 'Answers received', 'Saved notes'],
    },
    values: [2, 4, 12, 6],
    items: {
      fa: ['جلسه مشاوره خانواده', 'پاسخ به پرسش شما', 'یادآوری جلسه آینده'],
      en: ['Family consultation', 'An answer to your question', 'Upcoming session reminder'],
    },
  },
  {
    id: 'expert',
    title: {
      fa: 'استاد و مشاور',
      en: 'Expert workspace',
    },
    headline: {
      fa: 'برای گفت‌وگوهای اثرگذار آماده‌اید؟',
      en: 'Make room for meaningful conversations',
    },
    icon: 'user',
    metrics: {
      fa: ['جلسات امروز', 'مراجعان این هفته', 'پرسش‌های تازه', 'رضایت نمونه'],
      en: ['Sessions today', 'Weekly clients', 'New questions', 'Sample satisfaction'],
    },
    values: [4, 18, 7, 96],
    items: {
      fa: ['گفت‌وگوی برنامه‌ریزی‌شده', 'بررسی برنامه هفتگی', 'پرسش درباره تربیت فرزند'],
      en: ['Scheduled conversation', 'Review weekly availability', 'A parenting question'],
    },
  },
  {
    id: 'responder',
    title: {
      fa: 'پاسخ‌گو',
      en: 'Responder workspace',
    },
    headline: {
      fa: 'هر پاسخ، چراغ یک مسیر',
      en: 'Every answer lights a way',
    },
    icon: 'comments',
    metrics: {
      fa: ['پرسش‌های منتظر', 'پاسخ‌های آماده', 'در بازبینی', 'پاسخ‌های منتشرشده'],
      en: ['Waiting questions', 'Draft answers', 'In review', 'Published answers'],
    },
    values: [8, 3, 5, 24],
    items: {
      fa: ['پرسش درباره اخلاق روزمره', 'بازبینی پاسخ پیشنهادی', 'تکمیل منابع پاسخ'],
      en: ['Everyday ethics question', 'Review a draft answer', 'Complete answer references'],
    },
  },
  {
    id: 'scientific',
    title: {
      fa: 'ناظر علمی',
      en: 'Scientific review',
    },
    headline: {
      fa: 'دقت علمی، پشتوانهٔ اعتماد',
      en: 'Careful review builds trust',
    },
    icon: 'shield',
    metrics: {
      fa: ['در انتظار بررسی', 'ارجاع‌های امروز', 'تأییدشده', 'نیازمند اصلاح'],
      en: ['Awaiting review', 'Today’s referrals', 'Approved', 'Needs revision'],
    },
    values: [12, 4, 36, 3],
    items: {
      fa: ['ارزیابی پاسخ مشاوره', 'بررسی مدارک استاد', 'بازبینی منبع علمی'],
      en: ['Review a guidance answer', 'Expert credential review', 'Verify a scientific reference'],
    },
  },
  {
    id: 'support',
    title: {
      fa: 'پشتیبانی',
      en: 'Support desk',
    },
    headline: {
      fa: 'یک همراهی خوب، با شنیدن شروع می‌شود',
      en: 'Good support starts with listening',
    },
    icon: 'headset',
    metrics: {
      fa: ['تیکت‌های باز', 'در انتظار پاسخ', 'حل‌شده امروز', 'میانگین پاسخ نمونه'],
      en: ['Open tickets', 'Awaiting reply', 'Resolved today', 'Sample response time'],
    },
    values: [18, 5, 27, 8],
    items: {
      fa: ['پیگیری تغییر زمان جلسه', 'راهنمای ورود به جلسه', 'درخواست پیگیری رزرو'],
      en: ['Session rescheduling', 'Help joining a session', 'Booking follow-up'],
    },
  },
  {
    id: 'finance',
    title: {
      fa: 'مدیریت مالی',
      en: 'Finance workspace',
    },
    headline: {
      fa: 'تصویری روشن از جریان مالی',
      en: 'A clear view of financial activity',
    },
    icon: 'wallet',
    metrics: {
      fa: ['تراکنش‌های نمونه', 'تسویه‌های منتظر', 'نیازمند تطبیق', 'بازپرداخت‌ها'],
      en: ['Sample transactions', 'Pending payouts', 'To reconcile', 'Refunds'],
    },
    values: [128, 12, 3, 2],
    items: {
      fa: ['درخواست تسویه استاد', 'تطبیق تراکنش نمونه', 'بررسی بازپرداخت'],
      en: ['Expert payout request', 'Reconcile sample transaction', 'Review a refund'],
    },
  },
  {
    id: 'content',
    title: {
      fa: 'محتوا و رویداد',
      en: 'Content studio',
    },
    headline: {
      fa: 'دانش ارزشمند، در قالبی ماندگار',
      en: 'Give meaningful knowledge a home',
    },
    icon: 'book',
    metrics: {
      fa: ['پیش‌نویس‌ها', 'منتظر بازبینی', 'رویدادهای آینده', 'محتوای منتشرشده'],
      en: ['Drafts', 'Awaiting review', 'Upcoming events', 'Published content'],
    },
    values: [9, 6, 3, 42],
    items: {
      fa: ['مقاله هنر گفت‌وگو', 'رویداد خانواده آگاه', 'ویرایش مجموعه آموزشی'],
      en: ['The art of conversation', 'Mindful family event', 'Edit a learning collection'],
    },
  },
  {
    id: 'organization',
    title: {
      fa: 'مدیریت سازمان',
      en: 'Organization workspace',
    },
    headline: {
      fa: 'همراهی هماهنگ، در تمام شعب',
      en: 'Connected people, shared purpose',
    },
    icon: 'building',
    metrics: {
      fa: ['شعب نمونه', 'اعضای فعال نمونه', 'اساتید همکار', 'برنامه‌های جاری'],
      en: ['Sample branches', 'Sample active members', 'Affiliated experts', 'Current programs'],
    },
    values: [6, 48, 16, 8],
    items: {
      fa: ['برنامه شعبه مرکزی', 'دعوت همکار جدید', 'گزارش فعالیت ماهانه'],
      en: ['Central branch program', 'New member invitation', 'Monthly activity report'],
    },
  },
  {
    id: 'admin',
    title: {
      fa: 'مدیریت کل',
      en: 'Administration',
    },
    headline: {
      fa: 'نگاهی جامع به دنیای ویانور',
      en: 'The bigger picture, thoughtfully organized',
    },
    icon: 'grid',
    metrics: {
      fa: ['کاربران نمونه', 'سازمان‌ها', 'درخواست‌های باز', 'سیاست‌های فعال نمونه'],
      en: ['Sample users', 'Organizations', 'Open requests', 'Sample policies'],
    },
    values: [1248, 12, 28, 6],
    items: {
      fa: ['بررسی درخواست سازمان', 'بازبینی نقش‌های دسترسی', 'به‌روزرسانی سیاست رضایت'],
      en: ['Organization request', 'Review access roles', 'Update consent policy'],
    },
  },
  {
    id: 'ai',
    title: {
      fa: 'مدیریت هوش مصنوعی',
      en: 'AI workspace',
    },
    headline: {
      fa: 'هوش مصنوعی، در خدمت همراهی انسانی',
      en: 'Intelligence in support of human care',
    },
    icon: 'sparkles',
    metrics: {
      fa: ['مسیرهای مدل', 'درخواست‌های نمونه', 'ارزیابی‌های منتظر', 'قابلیت‌ها'],
      en: ['Model routes', 'Sample requests', 'Pending evaluations', 'Capabilities'],
    },
    values: [6, 284, 4, 5],
    items: {
      fa: ['ارزیابی کیفیت خلاصه‌سازی', 'بازبینی مسیر ترجمه', 'بررسی سیاست داده'],
      en: ['Evaluate summary quality', 'Review translation route', 'Review data policy'],
    },
  },
  {
    id: 'call-center',
    title: {
      fa: 'مرکز تماس',
      en: 'Call center',
    },
    headline: {
      fa: 'هر تماس، فرصتی برای همراهی',
      en: 'Every call is a chance to help',
    },
    icon: 'phone',
    metrics: {
      fa: ['تماس‌های نمونه', 'در صف نمونه', 'پاسخ‌گوهای نمونه', 'تماس‌های پیگیری'],
      en: ['Sample calls', 'Sample queue', 'Sample agents', 'Follow-up calls'],
    },
    values: [8, 3, 6, 12],
    items: {
      fa: ['پیگیری تماس مشاوره', 'بررسی مسیر تماس', 'گزارش کیفیت ارتباط'],
      en: ['Consultation follow-up', 'Review call routing', 'Connection quality report'],
    },
  },
  {
    id: 'operations',
    title: {
      fa: 'عملیات فنی',
      en: 'Operations',
    },
    headline: {
      fa: 'پایداری، پشت صحنهٔ یک تجربهٔ خوب',
      en: 'Reliability behind every good experience',
    },
    icon: 'server',
    metrics: {
      fa: ['سرویس‌های نمونه', 'هشدارهای نمونه', 'کارهای منتظر', 'نسخه‌های ثبت‌شده'],
      en: ['Sample services', 'Sample alerts', 'Pending jobs', 'Recorded releases'],
    },
    values: [32, 2, 14, 8],
    items: {
      fa: ['بررسی هشدار نمونه', 'گزارش پشتیبان‌گیری', 'مرور صف پیام'],
      en: ['Review sample alert', 'Backup report', 'Review message queue'],
    },
  },
] as const;
export type RoleId = (typeof roles)[number]['id'];
export const publicPages = [
  {
    path: 'about',
    title: {
      fa: 'دربارهٔ ویانور',
      en: 'About Vianoor',
    },
  },
  {
    path: 'how-it-works',
    title: {
      fa: 'چگونه همراه شما هستیم؟',
      en: 'How it works',
    },
  },
  {
    path: 'services',
    title: {
      fa: 'راه‌های همراهی',
      en: 'Ways we can help',
    },
  },
  {
    path: 'topics',
    title: {
      fa: 'از کجا شروع کنیم؟',
      en: 'Find your starting point',
    },
  },
  {
    path: 'experts',
    title: {
      fa: 'همراهی یک نگاه آگاه',
      en: 'Find your expert',
    },
  },
  {
    path: 'search',
    title: {
      fa: 'جست‌وجو در ویانور',
      en: 'Explore Vianoor',
    },
  },
  {
    path: 'help',
    title: {
      fa: 'مرکز راهنما',
      en: 'Help center',
    },
  },
  {
    path: 'faq',
    title: {
      fa: 'پرسش‌های متداول',
      en: 'Frequently asked questions',
    },
  },
  {
    path: 'contact',
    title: {
      fa: 'با ما در ارتباط باشید',
      en: 'Get in touch',
    },
  },
  {
    path: 'announcements',
    title: {
      fa: 'تازه‌های ویانور',
      en: 'Vianoor updates',
    },
  },
  {
    path: 'join-experts',
    title: {
      fa: 'دانش شما، همراه راه دیگران',
      en: 'Share your expertise',
    },
  },
  {
    path: 'organizations',
    title: {
      fa: 'همکاری برای اثری ماندگار',
      en: 'Partner with Vianoor',
    },
  },
  {
    path: 'questions',
    title: {
      fa: 'پرسش شما، آغاز روشنایی',
      en: 'Questions and understanding',
    },
  },
  {
    path: 'library',
    title: {
      fa: 'برای دانستن و بهتر زیستن',
      en: 'Read, listen, reflect',
    },
  },
  {
    path: 'events',
    title: {
      fa: 'فرصتی برای با هم آموختن',
      en: 'Learn together',
    },
  },
  {
    path: 'dashboards',
    title: {
      fa: 'محیط‌های کاری ویانور',
      en: 'Explore the workspaces',
    },
  },
] as const;
export const sectionNames: Record<string, { fa: string; en: string }> = {
  book: {
    fa: 'رزرو جلسه',
    en: 'Book a session',
  },
  bookings: {
    fa: 'جلسات من',
    en: 'My sessions',
  },
  questions: {
    fa: 'پرسش‌ها',
    en: 'Questions',
  },
  messages: {
    fa: 'پیام‌ها',
    en: 'Messages',
  },
  wallet: {
    fa: 'کیف پول',
    en: 'Wallet',
  },
  favorites: {
    fa: 'ذخیره‌شده‌ها',
    en: 'Saved items',
  },
  notifications: {
    fa: 'اعلان‌ها',
    en: 'Notifications',
  },
  profile: {
    fa: 'پروفایل',
    en: 'Profile',
  },
  calendar: {
    fa: 'تقویم جلسات',
    en: 'Calendar',
  },
  availability: {
    fa: 'برنامهٔ هفتگی',
    en: 'Availability',
  },
  sessions: {
    fa: 'جلسات',
    en: 'Sessions',
  },
  clients: {
    fa: 'مراجعان',
    en: 'Clients',
  },
  performance: {
    fa: 'عملکرد',
    en: 'Performance',
  },
  earnings: {
    fa: 'درآمد',
    en: 'Earnings',
  },
  payouts: {
    fa: 'تسویه‌ها',
    en: 'Payouts',
  },
  reviews: {
    fa: 'بازبینی‌ها',
    en: 'Reviews',
  },
  credentials: {
    fa: 'مدارک',
    en: 'Credentials',
  },
  assignments: {
    fa: 'ارجاع‌ها',
    en: 'Assignments',
  },
  quality: {
    fa: 'کیفیت',
    en: 'Quality',
  },
  tickets: {
    fa: 'تیکت‌ها',
    en: 'Tickets',
  },
  queue: {
    fa: 'صف درخواست‌ها',
    en: 'Queue',
  },
  complaints: {
    fa: 'شکایت‌ها',
    en: 'Complaints',
  },
  transactions: {
    fa: 'تراکنش‌ها',
    en: 'Transactions',
  },
  reconciliation: {
    fa: 'تطبیق',
    en: 'Reconciliation',
  },
  ledger: {
    fa: 'دفترکل',
    en: 'Ledger',
  },
  reports: {
    fa: 'گزارش‌ها',
    en: 'Reports',
  },
  refunds: {
    fa: 'بازپرداخت‌ها',
    en: 'Refunds',
  },
  library: {
    fa: 'کتابخانه',
    en: 'Library',
  },
  events: {
    fa: 'رویدادها',
    en: 'Events',
  },
  channels: {
    fa: 'کانال‌ها',
    en: 'Channels',
  },
  media: {
    fa: 'رسانه‌ها',
    en: 'Media',
  },
  branches: {
    fa: 'شعب و مناطق',
    en: 'Branches',
  },
  members: {
    fa: 'اعضا',
    en: 'Members',
  },
  permissions: {
    fa: 'مجوزها',
    en: 'Permissions',
  },
  settings: {
    fa: 'تنظیمات',
    en: 'Settings',
  },
  users: {
    fa: 'کاربران',
    en: 'Users',
  },
  roles: {
    fa: 'نقش‌ها',
    en: 'Roles',
  },
  organizations: {
    fa: 'سازمان‌ها',
    en: 'Organizations',
  },
  audit: {
    fa: 'سابقهٔ عملیات',
    en: 'Audit log',
  },
  providers: {
    fa: 'ارائه‌دهندگان',
    en: 'Providers',
  },
  models: {
    fa: 'مدل‌ها',
    en: 'Models',
  },
  routes: {
    fa: 'مسیرها',
    en: 'Routes',
  },
  usage: {
    fa: 'مصرف',
    en: 'Usage',
  },
  policies: {
    fa: 'سیاست‌ها',
    en: 'Policies',
  },
  evaluation: {
    fa: 'ارزیابی',
    en: 'Evaluation',
  },
  extensions: {
    fa: 'داخلی‌ها',
    en: 'Extensions',
  },
  history: {
    fa: 'سوابق',
    en: 'History',
  },
  recordings: {
    fa: 'ضبط‌ها',
    en: 'Recordings',
  },
  incidents: {
    fa: 'رخدادها',
    en: 'Incidents',
  },
  traces: {
    fa: 'رهگیری درخواست',
    en: 'Traces',
  },
  queues: {
    fa: 'صف‌ها',
    en: 'Queues',
  },
  jobs: {
    fa: 'کارهای پس‌زمینه',
    en: 'Jobs',
  },
  backups: {
    fa: 'پشتیبان‌گیری',
    en: 'Backups',
  },
  security: {
    fa: 'امنیت',
    en: 'Security',
  },
  onboarding: {
    fa: 'شروع همکاری',
    en: 'Getting started',
  },
  offerings: {
    fa: 'خدمات و تعرفه‌ها',
    en: 'Offerings',
  },
  files: {
    fa: 'فایل‌ها',
    en: 'Files',
  },
  instant: {
    fa: 'درخواست فوری',
    en: 'Instant requests',
  },
  channel: {
    fa: 'کانال من',
    en: 'My channel',
  },
  content: {
    fa: 'محتوا',
    en: 'Content',
  },
  'payout-account': {
    fa: 'حساب مقصد',
    en: 'Payout account',
  },
  escalations: {
    fa: 'ارجاع تخصصی',
    en: 'Escalations',
  },
  publication: {
    fa: 'انتشار',
    en: 'Publication',
  },
  guidelines: {
    fa: 'راهنما و منابع',
    en: 'Guidelines',
  },
  shifts: {
    fa: 'شیفت‌ها',
    en: 'Shifts',
  },
  wallets: {
    fa: 'کیف پول‌ها',
    en: 'Wallets',
  },
  holds: {
    fa: 'وجوه در انتظار',
    en: 'Held funds',
  },
  disputes: {
    fa: 'اختلاف‌ها',
    en: 'Disputes',
  },
  fees: {
    fa: 'کارمزدها',
    en: 'Fees',
  },
  pages: {
    fa: 'صفحات عمومی',
    en: 'Public pages',
  },
  navigation: {
    fa: 'ناوبری',
    en: 'Navigation',
  },
  taxonomy: {
    fa: 'دسته‌بندی',
    en: 'Categories',
  },
  translations: {
    fa: 'ترجمه‌ها',
    en: 'Translations',
  },
  experts: {
    fa: 'اساتید',
    en: 'Experts',
  },
  services: {
    fa: 'خدمات',
    en: 'Services',
  },
  activity: {
    fa: 'فعالیت‌ها',
    en: 'Activity',
  },
  consents: {
    fa: 'رضایت‌ها',
    en: 'Consents',
  },
  ai: {
    fa: 'هوش مصنوعی',
    en: 'AI',
  },
  prompts: {
    fa: 'دستورها',
    en: 'Prompts',
  },
  sources: {
    fa: 'منابع',
    en: 'Sources',
  },
  trunks: {
    fa: 'اتصال تلفن',
    en: 'SIP trunks',
  },
  costs: {
    fa: 'هزینه‌ها',
    en: 'Costs',
  },
  search: {
    fa: 'جست‌وجو',
    en: 'Search',
  },
  delivery: {
    fa: 'ارسال‌ها',
    en: 'Delivery',
  },
  releases: {
    fa: 'نسخه‌ها',
    en: 'Releases',
  },
  preferences: {
    fa: 'ترجیحات',
    en: 'Preferences',
  },
  privacy: {
    fa: 'حریم خصوصی',
    en: 'Privacy',
  },
  'data-requests': {
    fa: 'درخواست داده',
    en: 'Data requests',
  },
  connections: {
    fa: 'روش‌های ورود',
    en: 'Sign-in methods',
  },
  saved: {
    fa: 'ذخیره‌شده‌ها',
    en: 'Saved items',
  },
  support: {
    fa: 'پشتیبانی',
    en: 'Support',
  },
  billing: {
    fa: 'صورتحساب',
    en: 'Billing',
  },
};
