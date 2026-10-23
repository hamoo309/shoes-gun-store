# تشغيل ونشر SHOES GUN

تم اختبار التطبيق وقاعدة البيانات محليًا خارج Docker. Docker غير مثبت على جهاز التطوير؛ ملفات الحاويات أُعدت وفُحصت نصيًا وتحتاج تنفيذ أوامر التحقق أدناه على مضيف Docker قبل النشر.

## تجربة Docker محلية

يتطلب Docker Engine مع Compose v2. قاعدة البيانات وواجهة API داخل شبكة Compose فقط. واجهة المتجر متاحة محليًا على `http://localhost:3000`.

1. أنشئ ملفًا خاصًا باسم `.env.docker` في جذر المشروع (لا ترفعه إلى Git):

```dotenv
POSTGRES_PASSWORD=REPLACE_WITH_RANDOM_HEX_64_CHARACTERS
SESSION_SECRET=REPLACE_WITH_ANOTHER_RANDOM_HEX_96_CHARACTERS
NEXT_PUBLIC_SITE_URL=http://localhost:3000
COOKIE_SECURE=false
```

لإنشاء قيمة عشوائية: `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"`. استخدم قيمتين مختلفتين. استخدم أحرف hex لكلمة مرور PostgreSQL حتى تظل صالحة داخل رابط الاتصال دون ترميز إضافي.

2. تحقق من الإعدادات وشغّل المشروع:

```sh
docker compose --env-file .env.docker config --quiet
docker compose --env-file .env.docker up --build -d
docker compose --env-file .env.docker ps
```

خدمة `migrate` تطبق Migrations قبل تشغيل API؛ إذا فشلت يتوقف تشغيل API. لا تُضاف بيانات تجريبية تلقائيًا عند إعادة تشغيل الإنتاج. لتجربة بيانات المنتجات والمحافظات وأسعار الشحن التجريبية:

```sh
docker compose --env-file .env.docker --profile seed run --rm seed
```

الـSeed يحافظ على تعديلات البيانات الموجودة ولا ينشئ حساب مسؤول. بعد تشغيله عدّل أسعار الشحن وتكلفة الشراء والمنتجات من Dashboard قبل أي استخدام تجاري. بدون Seed يجب إدخال المحافظات والإعدادات والتصنيفات من مسار إعداد مخصص؛ يوصى باستعمال Seed أول مرة ثم استبدال بيانات التجربة من Dashboard.

3. أنشئ أول مسؤول بكلمة مرور تختارها، دون حفظها في سجل الأوامر:

```sh
docker compose --env-file .env.docker exec api npm run admin:create --workspace @shoes-gun/api
```

أدخل الاسم والبريد وكلمة المرور المخفية عند الطلب. يدعم CLI أيضًا `--stdin` مع JSON `{ "name": "...", "email": "...", "password": "..." }` من مدير أسرار موثوق؛ لا تضع كلمة المرور مباشرة في سطر أوامر محفوظ. مسار Dashboard هو `/admin`.

## نشر HTTPS

اضبط DNS للنطاق النهائي نحو المضيف، وافتح 80 و443 فقط للعامة. أضف إلى `.env.docker`:

```dotenv
DOMAIN=shop.example.com
ACME_EMAIL=admin@example.com
NEXT_PUBLIC_SITE_URL=https://shop.example.com
COOKIE_SECURE=true
```

```sh
docker compose --env-file .env.docker -f docker-compose.yml -f compose.production.yml config --quiet
docker compose --env-file .env.docker -f docker-compose.yml -f compose.production.yml up --build -d
```

Caddy يصدر شهادة HTTPS ويوجّه `/api/*` وصور المنتجات مباشرة إلى API، وباقي الصفحات إلى Next.js. المنفذ 3000 مربوط بـ127.0.0.1 فقط؛ لا تُنشر منافذ PostgreSQL أو API. لا تضف طبقة proxy مجهولة أمام الخدمة دون ضبط `TRUST_PROXY` وسلسلة عناوين العميل الموثوقة؛ overlay الإنتاج يثق بقفزة Caddy الداخلية الواحدة عند الوصول العام إلى API.

قيم `NEXT_PUBLIC_SITE_URL` وروابط إعادة التوجيه إلى API تدخل بناء Next.js. غيّر الدومين ثم أعد بناء صورة web؛ تعديل متغير runtime وحده لا يكفي لتغيير هذه القيم. الـAPI يبقى `http://api:4000` داخل شبكة الحاويات. عدّل كذلك إعداد الدومين وSEO المخزن في Dashboard.

ملفات صور المنتجات في volume `media_data/products`، وإثباتات الدفع في `media_data/private`؛ المجلد الثاني لا يُنشر كملفات عامة. بيانات PostgreSQL في `postgres_data`. لا تستعمل `down -v` على متجر يحوي بيانات مطلوبة.

## فحص ما قبل إطلاق الطلبات الحقيقية

- اختبر تسجيل دخول المسؤول، إنشاء طلب COD، طلب InstaPay وإثباته، ومراجعة الدفع.
- نفّذ الطلب حتى Delivered ثم سجّل التحصيل؛ تحقق من التقرير والمرتجع الجزئي واستعادة المخزون.
- استبدل بيانات الاختبار، أدخل تكلفة شراء كل منتج وتكلفة الشحن الحقيقية، وراجع رقم InstaPay وWhatsApp.
- اضبط الدومين وSEO وبيانات البانر، وافحص الموبايل وsitemap وrobots.
- جرّب الاستعادة من نسخة احتياطية معزولة قبل فتح المتجر للعامة، واضبط مراقبة الحالة والسعة والنسخ الاحتياطي.

## التحديث

احتفظ بنسخة احتياطية متحققة قبل كل تحديث. اسحب الإصدار المراجع ثم شغّل أمر `up --build -d` أعلاه. افحص `logs --tail 100 migrate api web` و`ps`. لا تُجر تعديلات مباشرة على Migration مطبقة؛ أضف Migration جديدة. تراجع صورة التطبيق لا يعكس تغييرات قاعدة البيانات تلقائيًا.

إعدادات API الأساسية: `DATABASE_URL` و`SESSION_SECRET` (أو `APP_SECRET`) و`STORAGE_DIR` (أو `UPLOAD_DIR`) و`WEB_ORIGIN`. يجب أن يظل سر الجلسة ثابتًا ومحفوظًا منفصلًا؛ إعادة تشغيل الحاويات لا تولّد سرًا جديدًا. `COOKIE_SECURE=false` مخصص لبيئة HTTP المحلية فقط، والافتراضي في الإنتاج هو true.
