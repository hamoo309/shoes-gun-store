# النسخ الاحتياطي واستعادة متجر قائم

هذه خطة تشغيل لاحقة؛ لم تُنفّذ استعادة أو هجرة أو نقل وسائط على المتجر الحالي ضمن التحضير. يلزم إثبات نجاح الاستعادة في هدف جديد ومعزول، فوجود dump وحده لا يكفي. أوامر Docker أدناه لم تُنفّذ على جهاز المراجعة لعدم توفر Docker. تُسجل أي تجربة PostgreSQL معزولة نُفذت فعليًا في تقرير المهمة المنفصل.

## مكونات النسخة الكاملة

احتفظ بمجموعة متطابقة في وقتها تضم:

- قاعدة PostgreSQL بكامل جداول التطبيق و`_prisma_migrations`، بما فيها الحسابات وhashes كلمات المرور والطلبات والمخزون والإعدادات والمحاسبة والجلسات والتدقيق. يُضم جدول `AuthLoginAttempt` للنسخ اللاحقة بعد تطبيق هجرته.
- كل ملفات `STORAGE_DIR/products` و`STORAGE_DIR/private`، أو `UPLOAD_DIR` إذا كان مستخدمًا؛ له أولوية على `STORAGE_DIR`. الإثباتات خاصة حتى إن كان المجلد فارغًا. لا تغيّر أسماء الملفات أو العناوين المخزنة أثناء النقل.
- المصدر وmigrations وlockfile ومراجع صور الإصدار، وإعدادات النطاق والتخزين، وmanifest يحوي أوقات النسخ والمنطقة الزمنية والأحجام والأعداد وبصمات SHA-256 وحدود التناسق.
- الأسرار الأصلية في مخزن أسرار **منفصل**: `SESSION_SECRET` و`APP_SECRET` إن كان مضبوطًا، واعتمادات PostgreSQL. لا تضع قيمها في manifest أو zip مراجعة أو سجلات. سر روابط الطلبات هو `APP_SECRET` إن وجد وإلا `SESSION_SECRET`؛ الاحتفاظ به لازم للروابط القديمة.

احفظ الصور المرفقة مع إصدار web ضمن المصدر/صورة الإصدار أيضًا. افحص أن لكل مرجع محلي مستخدم ملفًا في النسخة، وأن روابط HTTPS الخارجية متاحة؛ dump لا ينسخ صور الخدمات الخارجية. لا تُدخل نقلًا إلى S3 أو تغيير روابط الصور في نفس الانتقال.

`pg_dump` لا ينسخ ملفات الوسائط أو أدوار PostgreSQL العامة على مستوى cluster. في هذا المشروع تستخدم الجداول `public`؛ افحص schemas/extensions إضافية قبل اعتبار نسخة محددة بمخطط واحد نسخةً كاملة. يُجهز مالك قاعدة الهدف وصلاحياته من تجهيز المضيف دون تغيير حسابات التطبيق المستعادة. احفظ حالة شهادات Caddy منفصلة بصلاحيات مقيدة عند استخدامه.

شفّر النسخ خارج المضيف وحدد مالك مفاتيحها. احتفظ بعدة نقاط استعادة ونسخة خارج المضيف. اتفق على أقصى فقد بيانات مقبول (RPO) ومدة توقف مقبولة (RTO)؛ dump يومي قد يفقد طلبات أُنشئت بعده. إذا لزم فقد شبه صفري، يلزم تصميم واختبار أرشفة WAL/استعادة زمنية أو خدمة تدعمها.

## لقطة متسقة من PostgreSQL مباشر

في نافذة نسخ لاحقة معتمدة، امنع الطلبات والتعديلات الجديدة، وانتظر اكتمال الجاري ثم أوقف web وAPI بالطريقة التي يديرهما بها المشغّل. اترك PostgreSQL يعمل. `pg_dump` يعطي لقطة متسقة للقاعدة؛ تناسق السجلات مع الوسائط يتطلب منع الكتابة طوال نسخ الاثنين. [مرجع PostgreSQL](https://www.postgresql.org/docs/16/app-pgdump.html).

بعد التحقق من إعدادات المصدر الخاصة دون طباعتها:

```sh
node scripts/backup.mjs /secure/backups/shoes-gun
```

يقرأ السكربت `.env` في جذر المشروع ويدعم `PG_BIN`/`PG_DUMP_BIN` على Windows. ينتج مجلدًا مؤرخًا جديدًا فيه `database.dump` و`media/` و`manifest.json` ويعلن الفشل إذا فشل dump أو نسخ الوسائط. لا ينسخ `.env` أو السر. الإصدار المصحح ينسخ قاعدة كاملة عند استخدام `public` أو غياب schema، ولا يمرر `--schema=public`. إذا حُدد مخطط غير public تكون النسخة مقيدة به ويجب مراجعة نطاقها صراحةً.

بديل لنسخ قاعدة كاملة: وفّر PGHOST/PGPORT/PGUSER/PGDATABASE و`PGPASSFILE` بصلاحيات مقيدة من مدير الأسرار، وأنشئ مجلد نسخة خاصًا وجديدًا، ثم:

```sh
pg_dump --format=custom --no-owner --no-acl --file /secure/backups/NEW_BACKUP/database.dump
```

انسخ مسار الوسائط الفعلي كاملًا إلى `NEW_BACKUP/media` أثناء منع الكتابة، دون نقل أو تغيير الأصل أو نسخ symlink إلى مكان غير متوقع. لا تضع كلمة مرور أو رابطًا يحملها في سطر الأوامر أو تاريخ shell. لا تستخدم إعادة توجيه ثنائي من `pg_dump` في Windows PowerShell 5.1؛ ملف `--file` يحفظ الأرشيف مباشرة.

احسب SHA-256 للأرشيف ولكل ملف وسائط وسجّل الأعداد والإجمالي بالبايت. يدعم Windows `Get-FileHash -Algorithm SHA256` وLinux `sha256sum`. افحص الأرشيف قراءةً فقط باستخدام `pg_restore --list /secure/backups/NEW_BACKUP/database.dump` واحفظ القائمة بمكان خاص، ثم قارن البصمات بعد النسخ. نجاح القائمة لا يغني عن استعادة فعلية في هدف جديد.

## لقطة من Docker قائم لاحقًا

عرّف `source_dc` باستخدام **اسم مشروع المصدر الفعلي** وملفه الخاص وملفي Compose اللذين شُغّل بهما. لا تفترض اسمًا من مثال ولا تغيّر وصف volumes لمضيف قائم. أمثلة shell التالية ليست إذنًا بإيقاف المصدر أثناء التحضير:

```sh
SOURCE_PROJECT=REPLACE_WITH_VERIFIED_SOURCE_PROJECT
source_dc() { docker compose --env-file .env.production -p "$SOURCE_PROJECT" -f docker-compose.yml -f compose.production.yml "$@"; }
```

أنشئ مجلد `/secure/backups/NEW_BACKUP` خاصًا وجديدًا. في نافذة الصيانة المعتمدة أوقف المدخل العام ثم التطبيق. أدخل اسم قاعدة **المصدر الفعلية** بعد التحقق؛ قد يختلف عن `POSTGRES_DB` المخصص للتهيئة:

```sh
source_dc stop caddy web api
source_dc exec -T db sh -eu -c 'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_dump -U "$POSTGRES_USER" -d "$1" -Fc --no-owner --no-acl -f /tmp/shoes-gun-backup.dump' sh VERIFIED_SOURCE_DATABASE
source_dc cp db:/tmp/shoes-gun-backup.dump /secure/backups/NEW_BACKUP/database.dump
source_dc cp api:/app/storage /secure/backups/NEW_BACKUP/media
```

تحقق من نجاح كل أمر قبل التالي ثم من البصمات والأعداد. `docker compose cp` ينسخ من حاوية متوقفة أيضًا. بعد تحقق النسخة احذف ملف dump المؤقت المحدد داخل حاوية db فقط، وأعد تشغيل نفس الخدمات المتوقفة إذا انتهت نافذة النسخ ولم يبدأ القطع النهائي. أعلن أي فشل كنسخة غير مكتملة؛ لا تبلّغ نجاحًا جزئيًا. لا تستخدم حذف volumes أو reset.

## استعادة إلى قاعدة جديدة فارغة فقط

كل الأوامر التالية تغيّر **الهدف الجديد** وهي مؤجلة للموافقة على تجربة الاستعادة. لا تستعد فوق المصدر أو قاعدة حية، ولا تستخدم `--clean` أو `--create` أو reset أو حذف schema. إذا كان الاسم موجودًا أو ظهرت بيانات، توقف واختر هدفًا جديدًا بدل حذف شيء لحل التعارض.

استخدم PostgreSQL 16 وأدوات متوافقة مع المصدر. سجّل المضيف/المنفذ/اسم الهدف المختلف عن المصدر ومالك الهدف وvolume الجديدة دون أسرار. حمّل بيانات دخول **الهدف** فقط عبر libpq ثم أنشئ قاعدة جديدة من `template0`:

```sh
RESTORE_DB=shoes_gun_restore_YYYYMMDD
createdb --maintenance-db=postgres --template=template0 "$RESTORE_DB"
psql -X --dbname "$RESTORE_DB" -v ON_ERROR_STOP=1 -c 'SELECT current_database(), inet_server_addr(), inet_server_port();'
psql -X --dbname "$RESTORE_DB" -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f');"
```

يجب أن يرجع فحص العلاقات `0`. افحص الأرشيف الموثوق قبل التنفيذ ثم استعد:

```sh
pg_restore --exit-on-error --single-transaction --no-owner --no-acl --dbname "$RESTORE_DB" /secure/backups/NEW_BACKUP/database.dump
```

`--single-transaction` يمنع ترك استعادة جزئية عند خطأ SQL؛ لا تجمعه مع `--jobs`. لا تتجاهل رمز خروج غير صفري. [المثال الرسمي يستخدم قاعدة جديدة من template0](https://www.postgresql.org/docs/16/app-pgrestore.html). إذا تعارضت كائنات فتوقف وافحص السبب؛ لا تضف حذفًا أو تتجاهل أخطاء.

### توافق الأرشيفات القديمة المحددة بـpublic

السكريبت القديم كان يمرر `--schema=public`، وقد يتضمن الأرشيف سجل `SCHEMA - public`. حتى قاعدة جديدة من template0 تحتوي public افتراضيًا، لذلك قد تفشل استعادة هذا الأرشيف قبل الجداول برسالة وجود schema. لا تعالج ذلك بحذف public أو استخدام `--clean`.

افحص `pg_restore --list`، وبعد إثبات خلو الهدف الجديد من علاقات المستخدم، أنشئ نسخة قائمة مراجعة تُعلّق **سطر SCHEMA - public وحده** بوضع `;` في بدايته. لا تُعلّق TABLE أو TABLE DATA أو SEQUENCE أو TYPE أو CONSTRAINT أو INDEX أو `_prisma_migrations`، ولا تغيّر الأرشيف الأصلي. قارن القائمتين واثبت أن فرق السطر الوحيد هو إنشاء public الموجودة. استعد بالقائمة المراجعة:

```sh
pg_restore --exit-on-error --single-transaction --no-owner --no-acl --use-list /secure/backups/NEW_BACKUP/restore-reviewed.list --dbname "$RESTORE_DB" /secure/backups/NEW_BACKUP/database.dump
```

إذا لم تكن هذه هي المشكلة الوحيدة فلا توسّع قائمة الاستثناءات؛ أوقف التجربة وراجع الأرشيف/الهدف. النسخ الجديدة الكاملة من السكريبت المصحح لا تحتاج هذا الحل الخاص. احتفظ بنتيجة التجربة وببصمة القائمة المراجعة.

### الهدف المعزول في Docker

استخدم مشروع تجربة وvolumes جديدة وملف هدف خاصًا، وتعريف `dc` في DEPLOYMENT.md. بعد الموافقة شغّل db وحدها؛ لا تبدأ API/web/Caddy أو مهمة migrate:

```sh
dc up -d --no-build db
dc cp /secure/backups/NEW_BACKUP/database.dump db:/tmp/shoes-gun-restore.dump
dc exec -T db sh -eu -c 'PGPASSWORD="$POSTGRES_PASSWORD" exec createdb -U "$POSTGRES_USER" --maintenance-db=postgres --template=template0 "$1"' sh shoes_gun_restore_YYYYMMDD
dc exec -T db sh -eu -c 'PGPASSWORD="$POSTGRES_PASSWORD" exec psql -X -U "$POSTGRES_USER" -d "$1" -v ON_ERROR_STOP=1 -c "SELECT current_database(), inet_server_addr(), inet_server_port();"' sh shoes_gun_restore_YYYYMMDD
```

نفّذ فحص العدد `0` أعلاه أيضًا عبر `psql` داخل الهدف، ثم استعد الأرشيف الكامل الجديد:

```sh
dc exec -T db sh -eu -c 'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_restore -U "$POSTGRES_USER" --exit-on-error --single-transaction --no-owner --no-acl -d "$1" /tmp/shoes-gun-restore.dump' sh shoes_gun_restore_YYYYMMDD
```

للأرشيف القديم انسخ القائمة المراجعة إلى حاوية الهدف واستخدم `--use-list` كما سبق. اجعل `DATABASE_URL` و`MIGRATION_DATABASE_URL` يشيران إلى اسم الهدف الجديد نفسه، بهويتي التشغيل والهجرة المنفصلتين، قبل تشغيل أي API/Migration. امنح هوية التطبيق صلاحيات التشغيل المحدودة بعد الاستعادة والهجرة وفق DEPLOYMENT.md. `POSTGRES_DB` متغير تهيئة وليس تحويلًا تلقائيًا لاتصال التطبيق.

## استعادة الوسائط والتحقق

اختر `STORAGE_DIR` جديدًا وفارغًا وانسخ `media/products` و`media/private` مع بقاء الأسماء والروابط كما هي. لا تُبدّل المسار في المصدر. المثال التالي يكتب في volume **الهدف الجديد فقط**، ويرفض وجود ملفات سابقة، ويتطلب مجلدي النسخة. تحقق من اسم المشروع والمسار المطلق للنسخة وvolume الفعلية قبل التنفيذ:

```sh
dc run --rm --no-deps --user 0 --volume /secure/backups/NEW_BACKUP/media:/restore:ro --entrypoint sh api -eu -c 'test -d /restore/products; test -d /restore/private; test -z "$(find /app/storage -mindepth 1 ! -type d -print -quit)"; cp -a /restore/. /app/storage/; chown -R 1000:1000 /app/storage; chmod 700 /app/storage/private'
```

لا يشغّل هذا الأمر الخادم أو migration. افحص البصمات والأعداد والصلاحيات بعد النسخ. يجب أن تطابق الوسائط اللقطة وأن تكون قابلة للكتابة لمستخدم API، وprivate غير عامة. أثبت أن لكل `ProductImage.url` و`OrderItem.image` محلي مستخدم ولكل `Order.proofPath` ملفًا، دون عرض معلومات العميل أو tokens.

قبل أي Migration قارن أعداد الجداول والطلبات والحسابات والمنتجات والمخزون والإعدادات والقيود وسجل `_prisma_migrations` مع manifest اللقطة. احفظ schema-only خاصًا للمقارنة، ولا تنشر password hashes أو محتويات Settings. بعدها فقط تأتي تجربة الهجرة على النسخة وخطوات القبول في خطة التحضير.

وفّر السر الأصلي واختبر رابط طلب قديم معروف دون نشر token، والصور العامة ورفض الوصول العام للإثباتات والسماح للمسؤول المخوّل فقط. لا تغيّر كلمة مرور مسؤول. اختبارات الطلبات والتعديل تتم في النسخة المعزولة دون تغيير المصدر.

سجّل مدة الاستعادة ونتيجتها واسم الهدف وvolumes ومراجع الصور والبصمات وأسباب الفشل إن وجدت. احفظ النسخة السابقة خلال فترة القبول. اتبع PRODUCTION-PREPARATION.md للتراجع بعد استقبال طلبات جديدة؛ إعادة نسخة قديمة قد تفقد تغييرات ما بعد اللقطة.
