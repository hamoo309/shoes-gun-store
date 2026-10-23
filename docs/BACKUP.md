# النسخ الاحتياطي والاستعادة

النسخة الكاملة تشمل PostgreSQL وصور المنتجات وإثباتات الدفع الخاصة، مع الاحتفاظ بـ`SESSION_SECRET` في مدير أسرار منفصل. الأوامر التالية لا تعرض كلمات المرور. أرشيفات قاعدة البيانات وإثباتات الدفع تتضمن بيانات العملاء؛ احفظها بصلاحيات مقيدة وتشفير خارج المضيف. احتفظ يوميًا بنسخ متعددة واختبر الاستعادة دوريًا.

## بيئة Node / PostgreSQL المباشرة

بعد تحميل `.env`، ومع توفر `pg_dump` الخاص بـPostgreSQL 16 أو أحدث متوافق:

```sh
node scripts/backup.mjs /secure/backups/shoes-gun
```

على Windows يمكن ضبط `PG_BIN` لمجلد PostgreSQL bin، أو `PG_DUMP_BIN` للمسار الكامل. السكربت يستخدم `DATABASE_URL` و`STORAGE_DIR` ويحفظ `database.dump` و`media/` و`manifest.json` في مجلد مؤرخ. لا يتضمن ملف `.env` أو سر الجلسة. سيُعلن الفشل بدل الإبلاغ عن نجاح جزئي إذا تعذر نسخ قاعدة البيانات أو الوسائط.

## Docker Compose

للحصول على لقطة متسقة بين السجلات وملفات الإثبات، ضع المتجر في نافذة صيانة وأوقف web وapi فقط؛ اترك db يعمل. استخدم اسم مجلد جديد لكل نسخة، مثال `backup-2026-10-17`:

```sh
docker compose --env-file .env.docker stop web api
docker compose --env-file .env.docker exec db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U shoesgun -d shoes_gun -Fc --no-owner --no-acl -f /tmp/shoes-gun.dump'
docker compose --env-file .env.docker cp db:/tmp/shoes-gun.dump ./backup-2026-10-17/database.dump
docker compose --env-file .env.docker cp api:/app/storage ./backup-2026-10-17/media
docker compose --env-file .env.docker exec db rm -f /tmp/shoes-gun.dump
docker compose --env-file .env.docker start api web
```

أنشئ مجلد `backup-2026-10-17` محليًا قبل الأمر. على Windows استخدم PowerShell حديثًا؛ لا تستخدم إعادة توجيه stdout الثنائي من `pg_dump` في Windows PowerShell 5.1. طريقة `docker compose cp` تحفظ الملف الثنائي. أضف خيارات `-f docker-compose.yml -f compose.production.yml` إذا كانت بيئة الإنتاج شُغلت بالـoverlay، وأوقف/أعد تشغيل Caddy أيضًا أثناء الصيانة عند الحاجة.

السكريبت المباشر لا يوقف الكتابة تلقائيًا؛ أوقف التطبيق أو امنع الطلبات والتعديلات أثناء نسخ الوسائط إذا كنت تحتاج لقطة متزامنة تمامًا. `pg_dump` نفسه يعطي لقطة متسقة لقاعدة البيانات.

## الاستعادة إلى بيئة معزولة أولًا

1. أنشئ قاعدة بيانات جديدة فارغة وvolume وسائط جديدة؛ لا تستعد فوق قاعدة المتجر الحي.
2. على قاعدة الاستعادة الجديدة المعزولة فقط، استعد الأرشيف باستخدام `pg_restore --clean --if-exists --no-owner --no-acl --dbname <new-database> database.dump` مع بيانات الدخول عبر متغيرات PostgreSQL مثل `PGPASSWORD`، وليس كلمة مرور داخل سطر الأمر. خيارا clean/if-exists يعالجان وجود schema public الافتراضي في قاعدة جديدة.
3. استعد مجلدي `media/products` و`media/private` إلى `STORAGE_DIR`، مع صلاحيات تسمح فقط لحساب خدمة التطبيق بالوصول إلى الملفات الخاصة. على Docker يجب أن يمتلك مستخدم `node` (UID 1000 في الصورة) volume الوسائط.
4. وفّر سر الجلسة الأصلي من مدير الأسرار، مع متغيرات بيئة الاستعادة، ثم طبّق Migrations المفقودة فقط بواسطة `db:migrate`. لا تشغّل Seed فوق نسخة تجارية مستعادة دون حاجة.
5. اختبر عدد الطلبات ومخزون عدة Variants، والصور العامة، ووصول المسؤول فقط إلى إثباتات الدفع، وتقرير الأرباح لفترة معروفة. افحص طلبًا قديمًا برابطه الخاص.
6. بعد نجاح التحقق، خطط الانتقال واحتفظ بالنسخة السابقة ومسار تراجع واضح.

`pg_restore --clean` يحذف كائنات في قاعدة الهدف؛ لا تستخدمه إلا على قاعدة استعادة معزولة تأكدت من اسمها. النسخة لا تُعد موثوقة قبل نجاح اختبار استعادة فعلي. لم تُختبر أوامر Docker على جهاز التطوير لعدم توفر Docker؛ اختبرها على المضيف المستهدف.
