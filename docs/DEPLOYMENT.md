# تجهيز تشغيل SHOES GUN على الإنتاج

هذه تعليمات لمشغّل الإصدار لاحقًا، وليست سجل نشر تم تنفيذه. لم يُنشر المتجر ولم تُطبّق Migration على قاعدة المتجر الحالية. Docker غير متاح على جهاز المراجعة؛ بناء الحاويات وتشغيل Compose وTLS يحتاج تحققًا على مضيف معزول قبل السماح بالنشر.

ابدأ بـ[خطة الانتقال والتراجع](PRODUCTION-PREPARATION.md)، ثم [النسخ الاحتياطي والاستعادة](BACKUP.md). المتجر القائم يُنقل بنسخته الكاملة وحساباته الحالية؛ لا تستخدم `setup` أو Seed أو إعادة ضبط قاعدة البيانات أو إنشاء مسؤول جديد لتجهيزه.

## الإعدادات والملفات الدائمة

انسخ `.env.production.example` إلى ملف خاص `.env.production` على المضيف المستهدف، واملأه من مدير الأسرار. لا تعدّل `.env` المحلي الحالي ولا ترفع الملف الخاص أو مخرجات إعداداته إلى مستودع أو تذكرة. استخدام `config --quiet` أدناه يتجنب طباعة القيم المحلولة. عند حفظ سر يحوي `$` أو `#` في ملف Compose الخاص، استخدم صيغة الاقتباس الحرفية المناسبة دون تغيير القيمة؛ لا تسمح بإحلال متغيرات داخل السر. اختبر قراءة القيم بوسيلة خاصة لا تطبعها.

| الإعداد | الاستخدام |
| --- | --- |
| `API_IMAGE`, `WEB_IMAGE` | صورتا الإصدار المراجع؛ digest أو tag إصدار فريد لا يُعاد استخدامه. احتفظ بمراجع الإصدار السابق أيضًا. |
| `POSTGRES_IMAGE`, `CADDY_IMAGE` | مراجع صور البنية المختبرة، ويفضل digest. أبقِ PostgreSQL على الإصدار الرئيسي 16؛ الترقية الرئيسية عملية منفصلة. |
| `DOMAIN`, `ACME_EMAIL` | اسم نطاق HTTPS النهائي وعنوان تواصل الشهادة. `DOMAIN` اسم مضيف فقط. |
| `NEXT_PUBLIC_SITE_URL` | أصل HTTPS مطابق للنطاق، دون مسار أو شرطة مائلة نهائية. قيمة عامة تدخل بناء web. |
| `STORE_NETWORK_SUBNET`, `CADDY_PROXY_IP` | شبكة خاصة لا تتعارض مع شبكات المضيف/VPN، وعنوان Caddy ثابت داخلها. يثق API بهذا العنوان وحده. |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | تهيئة volume PostgreSQL جديدة فقط. تغييرها لا يغيّر بيانات دخول volume موجودة. |
| `DATABASE_URL` | اتصال API بهوية تشغيل محدودة الصلاحيات في قاعدة الهدف الصحيحة؛ رمز اسم المستخدم وكلمة المرور كقيم URI. لا تستخدم هوية مالك PostgreSQL. |
| `MIGRATION_DATABASE_URL` | اتصال منفصل بمالك الهجرة في قاعدة الهدف نفسها؛ يصل إلى مهمة migrate فقط، ولا يصل إلى API أو web. |
| `SESSION_SECRET`, و`APP_SECRET` إن كان مستخدمًا | انقل القيم الأصلية كما هي من المخزن الخاص. `APP_SECRET` يأخذ أولوية في روابط الطلبات؛ وإلا تُستخدم `SESSION_SECRET`. تغييره قد يبطل روابط العملاء القديمة. |
| `LOGIN_RATE_LIMIT_STORE=postgres` | مخزن مشترك لحد محاولات الدخول؛ يحتاج Migration جدول `AuthLoginAttempt`. لا تستبدله بالذاكرة في الإنتاج. |

الأسرار واتصالات القاعدة تصل إلى api ومهمة migrate فقط، مع فصل هوية التشغيل عن هوية الهجرة. لا تمرّرها إلى web أو `NEXT_PUBLIC_*` أو Docker build arguments. `COOKIE_SECURE=true` و`ALLOW_INSECURE_LOCAL_PREVIEW=false` مفروضان في إعداد الإنتاج. المعاينة المحلية المباشرة عبر HTTP لها استثناء صريح مقيد بعنوان loopback؛ لا تستخدمه في الحاويات العامة التي تستمع على `0.0.0.0`.

| المسار في الحاوية | التخزين | النشر |
| --- | --- | --- |
| `/var/lib/postgresql/data` | volume `postgres_data` | شبكة Compose فقط؛ بلا منفذ PostgreSQL عام. |
| `/app/storage/products` | volume `media_data` | صور عامة عبر `/media/products/`. |
| `/app/storage/private` | نفس volume `media_data` | إثباتات خاصة؛ الوصول عبر مسار المسؤول المحمي فقط. |
| `/data`, `/config` في Caddy | `caddy_data`, `caddy_config` | حالة الشهادات؛ احفظها لحماية استمرارية TLS. |

أسماء volumes الفعلية مرتبطة باسم مشروع Compose. استخدم اسمًا ثابتًا لكل بيئة، واسمًا مختلفًا تمامًا لكل تجربة استعادة. لا تربط volumes المصدر بتجربة، ولا تستخدم حذف volumes أو `down -v` أو تنظيف Docker العام على المتجر. API يعمل كمستخدم `node`، ووسائطه يجب أن تكون قابلة للكتابة بواسطة UID/GID 1000:1000. لا تجعل مجلد `private` عامًا أو مشتركًا مع خادم ملفات.

لا تنسخ عملية بدء API صورًا افتراضية ولا تزرع بيانات. بعد النقل تكون الملفات المستعادة هي المصدر المعتمد؛ لذلك يلزم استعادة الوسائط قبل السماح بالطلبات. `scripts/init-media.mjs` مخصص للإعداد المحلي المنفصل وليس خطوة نشر للمتجر القائم.

## تحقق التحضير دون تشغيل خدمات

### فصل صلاحيات PostgreSQL على الهدف الجديد

هوية `POSTGRES_USER` في صورة PostgreSQL الرسمية هي هوية تهيئة قوية الصلاحيات؛ لا تستخدمها لتشغيل API. يستخدم القالب `shoesgun_app` للتطبيق و`shoesgun_owner` للاستعادة والهجرة. لا ينشئ هذا التحضير أدوارًا ولا يغيّر صلاحيات القاعدة الحالية.

بعد اعتماد الهدف الجديد، ينشئ المشغّل هوية التطبيق من جلسة psql خاصة بالمالك. المثال التالي للهدف الجديد فقط؛ أدخل كلمة المرور عبر `\password` المخفي، وليس في SQL أو سجل أوامر:

```sql
CREATE ROLE shoesgun_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
\password shoesgun_app
GRANT CONNECT ON DATABASE shoes_gun_restore_YYYYMMDD TO shoesgun_app;
GRANT USAGE ON SCHEMA public TO shoesgun_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO shoesgun_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO shoesgun_app;
ALTER DEFAULT PRIVILEGES FOR ROLE shoesgun_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO shoesgun_app;
ALTER DEFAULT PRIVILEGES FOR ROLE shoesgun_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO shoesgun_app;
```

استبدل اسم قاعدة المثال بالهدف المتحقق منه، ونفّذ منح صلاحيات المخطط داخل تلك القاعدة بعد الاستعادة والهجرة. لا تجعل هوية التطبيق مالكًا للقاعدة/المخطط أو عضوًا في هوية المالك، وتحقق أنها لا تملك CREATE على المخطط من منح قديم أو PUBLIC. إذا اختلف مالك تنفيذ الهجرات فاضبط default privileges لتلك الهوية الفعلية؛ لا تمنح صلاحيات أوسع لتجاوز خطأ. احتفظ بهوية التهيئة/الصيانة منفصلة عن التشغيل العام.

ضع اتصال التطبيق في `DATABASE_URL`، واتصال مالك الهجرة في `MIGRATION_DATABASE_URL`. افحص من اتصال التطبيق `current_user` و`rolsuper/rolcreatedb/rolcreaterole` و`has_schema_privilege(current_user,'public','CREATE')` دون طباعة اتصالات. يجب ألا يملك امتيازات إدارة أو إنشاء كائنات. جرّب الدخول والحد المشترك وحفظ طلب **في النسخة المعزولة فقط** بهذه الهوية المحدودة قبل النشر.

الأوامر التالية أمثلة shell على مضيف Docker المستهدف لاحقًا. عرّف اختصارًا ثابتًا لتجنب نسيان اسم المشروع أو overlay. اختر اسم مشروع تجربة جديدًا، ولا تستخدم اسم مشروع المتجر الحالي:

```sh
TARGET_PROJECT=shoes-gun-rehearsal-YYYYMMDD
dc() { docker compose --env-file .env.production -p "$TARGET_PROJECT" -f docker-compose.yml -f compose.production.yml "$@"; }
dc config --quiet
dc config --services
dc config --volumes
```

الخدمات الأساسية db وapi وweb وcaddy؛ migrate مهمة في profile `maintenance`. لا تنشّط كل profiles باستخدام `*`. [Docker يوضح أن استهداف خدمة ذات profile صراحة يشغّلها](https://docs.docker.com/compose/how-tos/profiles/)؛ لذلك أمر `run migrate` عملية تغيير حقيقية حتى دون تفعيل profile يدويًا.

على جهاز بناء موثوق، وبعد اختيار مراجع الصور وقيمة الموقع النهائيين، يمكن بناء الصور دون تشغيل التطبيق أو الاتصال بقاعدة المتجر:

```sh
dc build api web
```

سجّل مراجع الصور ومعرّفاتها الناتجة، وانقلها عبر سجل خاص أو أرشيف موثوق. استخدم الصور نفسها في الاختبار والنشر؛ لا تعِد بناء الإصدار القديم عند التراجع. يمكن استخدام `dc pull api web` بدل البناء إذا كانت الصور المراجعة متاحة. لا تكتب فوق tag إصدار سبق اعتماده. عند اختيار digest اسحب الصورة من السجل؛ لا تحاول بناء صورة مباشرةً تحت اسم digest.

`NEXT_PUBLIC_SITE_URL` ووجهة rewrites إلى API تدخلان بناء Next.js. تغيير النطاق يتطلب صورة web مبنية بالقيمة الصحيحة؛ تعديل runtime وحده لا يكفي. لا تستخدم أسرارًا حقيقية في البناء. قالب API يُولّد Prisma Client باستخدام اتصال وهمي محلي خاص بخطوة البناء فقط.

## التشغيل بعد الموافقة ونجاح تجربة الاستعادة فقط

هذه الخطوات غير مصرح بتنفيذها ضمن مهمة التحضير الحالية. نفّذها لاحقًا فقط بعد اكتمال سجل التحقق والموافقة على الانتقال، وبقاعدة وvolume وسائط جديدتين مستعادتين وفق BACKUP.md.

1. تحقق من DNS وHTTPS ومطابقة أصل الموقع. افتح 80 و443 فقط للجمهور؛ لا تنشر 4000 أو 5432. منفذ web 3000 مربوط بـ127.0.0.1 فقط.
2. استعد النسخة النهائية بعد منع الكتابة في المصدر. راجع اسم المشروع والقاعدة وvolumes دون عرض السر. اترك المصدر السابق محفوظًا ومعزولًا.
3. افحص حالة الهجرة قراءةً فقط أولًا، ثم نفّذ مهمة الهجرة الصريحة على الهدف المتحقق منه. نجاح `migrate status` لا يثبت خلو المخطط من اختلافات يدوية؛ راجع DDL أيضًا.

```sh
dc run --rm --no-deps migrate node node_modules/prisma/build/index.js migrate status --schema apps/api/prisma/schema.prisma
# عملية تغيير على الهدف المعتمد فقط؛ ليست خطوة فحص:
dc run --rm --no-deps migrate
```

4. لا تبدأ API إذا فشلت الهجرة أو بقيت معلّقة. لا تستخدم reset أو db push أو migrate dev أو resolve عشوائيًا لتجاوز الفشل.
5. شغّل الخدمات المراجعة دون إعادة بناء أو هجرة تلقائية، وافحص الصحة والسجلات المنقحة من بيانات العملاء:

```sh
dc up -d --no-build db api web caddy
dc ps
dc logs --tail 100 api web caddy
```

`up` أو restart لا يطبّق Migration ولا Seed الآن. مسؤول الإصدار يمنع بدء التطبيق قبل نجاح خطوة الهجرة المنفصلة. لا تنشئ أو تعِد ضبط حسابًا؛ حسابات المسؤولين وhashes كلمات المرور موجودة في النسخة المستعادة.

Caddy يوجّه `/api/*` وصور المنتجات العامة إلى API وباقي الصفحات إلى Next.js. إعداد `TRUST_PROXY` يساوي عنوان Caddy الثابت فقط؛ لا يُستخدم عدّ قفزات `1` في الإنتاج. لا تضف CDN/proxy آخر أو تفتح API مباشرةً دون مراجعة سلسلة العناوين واختبار الحد الفعلي. إعداد Caddy الحالي لا يفعّل access log؛ لا تفعّل تسجيل query string يحمل token طلب دون تنقيحه.

اختبارات إنشاء الطلب وتغيير الحالة/التحصيل/المرتجع تتم على النسخة المعزولة فقط. لا تنشئ أو تحذف بيانات اختبار على متجر المستخدم الحالي. قائمة القبول وسجل التراجع في [PRODUCTION-PREPARATION.md](PRODUCTION-PREPARATION.md).
