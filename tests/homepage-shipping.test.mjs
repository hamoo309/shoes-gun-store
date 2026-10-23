// This suite intentionally refuses the live store. It uses the current-data QA
// clone prepared by the repair workflow, without migrations, reset or Seed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes, randomUUID, createHash, scryptSync } from 'node:crypto';

const expectedProject = resolve('C:/Users/moham/Documents/Codex/2026-10-16/files-pasted-by-the-user-shoes/work/updates-20261021/qa/shoes-gun');
const project = process.argv[2] ? resolve(process.argv[2]) : '';
const canonical = value => resolve(value).replaceAll('\\', '/').toLowerCase();
assert.equal(canonical(project), canonical(expectedProject), 'Pass only the explicitly allowlisted current-data QA project.');
assert.equal(canonical(await realpath(project)), canonical(expectedProject), 'QA project must not redirect through a junction or symlink.');
const require = createRequire(new URL('../package.json', import.meta.url));
const env = require('dotenv').parse(await readFile(join(project, '.env')));
const databaseUrl = new URL(env.DATABASE_URL);
assert.ok(['postgresql:', 'postgres:'].includes(databaseUrl.protocol), 'QA database must use PostgreSQL.');
assert.equal(databaseUrl.hostname, '127.0.0.1', 'QA must use the explicitly allowlisted loopback host.');
assert.equal(databaseUrl.port, '55439', 'Refusing any database other than the isolated QA port.');
assert.ok(!databaseUrl.searchParams.has('schema') || databaseUrl.searchParams.get('schema') === 'public', 'QA tests require the restored public schema.');
assert.equal(env.WEB_PORT, '3006', 'QA web port must be 3006.');
assert.equal(env.API_PORT, '4006', 'QA API port must be 4006.');
const storage = resolve(project, env.UPLOAD_DIR || env.STORAGE_DIR || './storage');
assert.equal(canonical(await realpath(storage)), canonical(join(expectedProject, 'storage')), 'QA media must belong to the isolated project.');
const pidLines = (await readFile(join(project, '.local/postgres/postmaster.pid'), 'utf8')).trimEnd().split(/\r?\n/);
assert.equal(canonical(pidLines[1]), canonical(join(expectedProject, '.local/postgres')), 'QA postmaster must own this exact project.');
assert.equal(pidLines[3], '55439', 'QA postmaster port does not match the allowlist.');
const { Client } = require('pg');
const guardConnection = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 10000 });
await guardConnection.connect();
try {
  const directory = (await guardConnection.query('SHOW data_directory')).rows[0].data_directory;
  const port = (await guardConnection.query('SHOW port')).rows[0].port;
  assert.equal(canonical(await realpath(directory)), canonical(join(expectedProject, '.local/postgres')), 'Connected PostgreSQL is not the owned QA cluster.');
  assert.equal(String(port), '55439', 'Connected PostgreSQL is not the owned QA listener.');
} finally { await guardConnection.end(); }

// No database/file write occurs above this line. The nonce proves that the HTTP
// server uses this same clone before any mutating HTTP request is permitted.
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
const api = 'http://127.0.0.1:4006', web = 'http://localhost:3006';
const run = randomBytes(7).toString('hex');
const tag = `QA Shipping ${run}`;
const canaryKey = `qa_isolation_${run}`, canaryValue = randomBytes(24).toString('hex');
const email = `qa-homepage-${run}@example.invalid`, password = randomBytes(32).toString('base64url');
const statusLabels = { NEW: 'بانتظار التأكيد', CONFIRMED: 'مؤكد', PREPARING: 'قيد التجهيز', SHIPPED: 'تم الشحن', DELIVERED: 'تم التسليم', CANCELLED: 'ملغي', RETURNED: 'مرتجع' };
let cookie = '', csrf = '', httpOwned = false, canaryCreated = false, variant, governorate, originalStock;
let originalSettings, originalBusiness, delivered, cancelled, prepaid, customCategory;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const persisted = sections => sections.map(({ key, visible }) => ({ key, visible }));

async function request(path, { method = 'GET', data, auth = false, csrfToken = csrf, origin } = {}) {
  if (!['GET', 'HEAD'].includes(method) && !httpOwned) throw new Error('HTTP ownership has not been verified.');
  const response = await fetch(api + path, {
    method, redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { ...(data ? { 'content-type': 'application/json' } : {}), ...(auth ? { cookie, 'x-csrf-token': csrfToken } : {}), ...(origin ? { origin } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data)
  });
  const text = await response.text();
  let json; try { json = JSON.parse(text); } catch { /* HTML is inspected separately. */ }
  return { status: response.status, json, headers: response.headers };
}
const admin = (path, options = {}) => request('/api/admin' + path, { ...options, auth: true });
function expectStatus(result, expected, operation) { assert.equal(result.status, expected, `${operation} returned an unexpected HTTP status.`); return result.json; }
async function publicSettings() { return expectStatus(await request('/api/settings'), 200, 'Read public settings'); }
async function layout() { return expectStatus(await admin('/homepage-layout'), 200, 'Read homepage layout').sections; }
async function saveLayout(sections) { return expectStatus(await admin('/homepage-layout', { method: 'PUT', data: { sections: persisted(sections) } }), 200, 'Save homepage layout').sections; }
async function stock() { return (await db.variant.findUniqueOrThrow({ where: { id: variant.id } })).stock; }
async function orderState(order) { return db.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } }); }
async function move(order, status, extra = {}) {
  const updated = expectStatus(await admin('/orders/' + order.id, { method: 'PATCH', data: { status, ...extra } }), 200, 'Update order status');
  assert.equal(updated.status, status);
  assert.equal(updated.statusLabel, statusLabels[status]);
  return updated;
}
async function createFixture(quantity = 1, method = 'COD') {
  const result = expectStatus(await request('/api/orders', { method: 'POST', data: {
    idempotencyKey: randomUUID(), governorateId: governorate.id, paymentMethod: method,
    customer: { fullName: tag, phone: '01012345678', address: 'QA isolated test building 42, Test Street, Cairo' },
    items: [{ variantId: variant.id, quantity }], ...(method === 'INSTAPAY' ? { transferReference: `QA-${run}` } : {})
  } }), 201, 'Create isolated order fixture');
  return { ...result.order, accessToken: result.accessToken };
}
async function publicFixture(order) {
  return expectStatus(await request('/api/orders/' + encodeURIComponent(order.orderNumber) + '?token=' + encodeURIComponent(order.accessToken)), 200, 'Read customer tracking');
}
async function fixtureCounts() { return expectStatus(await admin('/orders/counts?search=' + encodeURIComponent(tag)), 200, 'Read order counts'); }
async function storefrontHtml(path = '/') {
  const response = await fetch(web + path + '?qaReload=' + randomUUID(), { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200, 'Storefront failed to reload.');
  return response.text();
}
const tabText = value => value.replace(/<[^>]+>/g, '').replace(/↗/g, '').trim();
function tabButtons(html) {
  const controls = html.match(/class="category-tabs"[^>]*>([\s\S]*?)<\/div>/)?.[1];
  assert.ok(controls, 'Storefront category controls did not render.');
  return [...controls.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(match => ({ name: tabText(match[2]), selected: /aria-pressed="true"/.test(match[1]) }));
}
async function tabNames(path = '/') { return tabButtons(await storefrontHtml(path)).map(button => button.name); }
async function waitForQaHealth() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(api + '/api/health', { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(Math.max(1, Math.min(1500, deadline - Date.now()))) });
      if (response.status === 200 && (await response.json()).status === 'ok') return;
    } catch { /* Startup may still be opening the HTTP listener. Retry reads only. */ }
    await new Promise(resolve => setTimeout(resolve, Math.min(200, Math.max(0, deadline - Date.now()))));
  }
  assert.fail('QA API did not become healthy within 30 seconds; no fixture data was written.');
}
async function businessFingerprint() {
  return {
    admins: digest(await db.admin.findMany({ where: { email: { not: email } }, orderBy: { id: 'asc' } })),
    orders: digest(await db.order.findMany({ where: { customerName: { not: tag } }, orderBy: { id: 'asc' } })),
    variants: digest(await db.variant.findMany({ orderBy: { id: 'asc' } })),
    products: digest(await db.product.findMany({ orderBy: { id: 'asc' } })),
    images: digest(await db.productImage.findMany({ orderBy: { id: 'asc' } }))
  };
}

before(async () => {
  await waitForQaHealth();
  originalSettings = await db.setting.findMany({ orderBy: { key: 'asc' } });
  originalBusiness = await businessFingerprint();
  // Reading both legacy/current settings must never persist generated defaults.
  await publicSettings(); await publicSettings();
  assert.equal(digest(await db.setting.findMany({ orderBy: { key: 'asc' } })), digest(originalSettings), 'Settings reads unexpectedly wrote database defaults.');
  await db.setting.create({ data: { key: canaryKey, value: canaryValue } });
  canaryCreated = true;
  assert.equal((await publicSettings())[canaryKey], canaryValue, 'Refusing writes: API is not connected to the allowlisted QA database.');
  httpOwned = true;
  const salt = randomBytes(16).toString('hex');
  await db.admin.create({ data: { name: 'QA Homepage and Shipping', email, passwordHash: `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`, role: 'SUPER_ADMIN' } });
  const login = await request('/api/auth/login', { method: 'POST', data: { email, password } });
  expectStatus(login, 200, 'Sign in isolated administrator');
  cookie = login.headers.get('set-cookie')?.split(';')[0] || '';
  csrf = login.json.csrfToken;
  assert.ok(cookie && csrf, 'The isolated admin session was not established.');
  const privateBrowserFile = resolve(expectedProject, '../../qa-browser.json');
  assert.equal(canonical(await realpath(resolve(privateBrowserFile, '..'))), canonical(resolve(expectedProject, '../..')), 'Private QA credential location changed.');
  await writeFile(privateBrowserFile, JSON.stringify({ qaOnly: true, project, url: web + '/admin', email, password, createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  variant = await db.variant.findFirst({ where: { active: true, stock: { gte: 2 }, product: { published: true, archived: false } }, orderBy: { stock: 'desc' } });
  governorate = await db.governorate.findFirst({ where: { active: true }, orderBy: { id: 'asc' } });
  assert.ok(variant && governorate, 'The current-data clone needs an available product with two units and an active governorate.');
  originalStock = variant.stock;
}, { timeout: 45000 });

after(async () => {
  if (canaryCreated) await db.setting.deleteMany({ where: { key: canaryKey } });
  await db.$disconnect();
});

test('homepage layout preserves defaults, permissions, CSRF and unrelated settings', async () => {
  const before = await db.setting.findUnique({ where: { key: 'homepageSections' } });
  const sections = await layout();
  assert.equal(new Set(sections.map(section => section.key)).size, sections.length);
  if (!before) assert.deepEqual(sections.slice(0, 6).map(section => section.key), ['all', 'casual', 'sports', 'fashion', 'best-sellers', 'hot-deals']);
  assert.equal(digest(await db.setting.findUnique({ where: { key: 'homepageSections' } })), digest(before), 'Reading a legacy layout must not create a setting.');
  assert.equal((await request('/api/admin/homepage-layout')).status, 401);
  assert.equal((await request('/api/admin/homepage-layout', { method: 'PUT', data: { sections: persisted(sections) } })).status, 401);
  assert.equal((await admin('/homepage-layout', { method: 'PUT', data: { sections: persisted(sections) }, csrfToken: '' })).status, 403);
  assert.equal((await admin('/homepage-layout', { method: 'PUT', data: { sections: persisted(sections) }, origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await admin('/homepage-layout', { method: 'PUT', data: { sections: [{ key: 'all', visible: true }, { key: 'all', visible: false }] } })).status, 400);
  assert.equal((await admin('/homepage-layout', { method: 'PUT', data: { sections: [{ key: 'category:missing-qa-key', visible: true }] } })).status, 400);
  assert.equal((await admin('/homepage-layout', { method: 'PUT', data: { sections: [{ key: 'all', visible: 'false' }] } })).status, 400);
  assert.equal(digest(await db.setting.findUnique({ where: { key: 'homepageSections' } })), digest(before), 'Rejected layout requests changed the saved layout.');
});

test('a new category moves before Hot Deals, Best Sellers moves last, and visibility survives DB/API/SSR reloads', { timeout: 60000 }, async () => {
  const position = ((await db.category.aggregate({ _max: { position: true } }))._max.position || 0) + 1;
  customCategory = expectStatus(await admin('/categories', { method: 'POST', data: { name: `QA Layout ${run}`, slug: `qa-layout-${run}`, position, active: true } }), 201, 'Create isolated category');
  let sections = await layout();
  const key = `category:${customCategory.id}`;
  assert.equal(sections.filter(section => section.key === key).length, 1);
  assert.equal(sections.at(-1).key, key, 'A new category should append once to a saved/default layout.');
  const custom = sections.find(section => section.key === key);
  const hot = { ...sections.find(section => section.key === 'hot-deals'), visible: true };
  const best = { ...sections.find(section => section.key === 'best-sellers'), visible: true };
  sections = await saveLayout([{ ...custom, visible: true }, hot, ...sections.filter(section => ![key, 'hot-deals', 'best-sellers'].includes(section.key)), best]);
  assert.equal(sections[0].key, key);
  assert.equal(sections[1].key, 'hot-deals');
  assert.equal(sections.at(-1).key, 'best-sellers');
  assert.deepEqual((await db.setting.findUniqueOrThrow({ where: { key: 'homepageSections' } })).value, persisted(sections));
  assert.deepEqual(await layout(), sections);
  assert.deepEqual((await publicSettings()).homepageSections, sections);
  let names = await tabNames();
  assert.equal(names[0], customCategory.name);
  assert.ok(names.indexOf(customCategory.name) < names.indexOf('Hot Deals'));
  assert.equal(names.at(-1), 'Best Sellers');
  sections = await saveLayout(sections.map(section => section.key === 'hot-deals' ? { ...section, visible: false } : section));
  assert.equal((await layout()).find(section => section.key === 'hot-deals').visible, false);
  assert.equal((await publicSettings()).homepageSections.find(section => section.key === 'hot-deals').visible, false);
  assert.ok(!(await tabNames()).includes('Hot Deals'), 'Hidden tab reappeared after a fresh storefront request.');
  sections = await saveLayout(sections.map(section => section.key === 'hot-deals' ? { ...section, visible: true } : section));
  assert.ok((await tabNames()).includes('Hot Deals'));
  const later = expectStatus(await admin('/categories', { method: 'POST', data: { name: `QA Later ${run}`, slug: `qa-later-${run}`, position: position + 1, active: true } }), 201, 'Create later isolated category');
  const laterLayout = await layout();
  assert.equal(laterLayout.at(-1).key, `category:${later.id}`);
  assert.equal(laterLayout.filter(section => section.key === `category:${later.id}`).length, 1);
  assert.equal(new Set(laterLayout.map(section => section.slug)).size, laterLayout.length);
  await saveLayout([...laterLayout.filter(section => section.key !== 'best-sellers'), laterLayout.find(section => section.key === 'best-sellers')]);
  assert.equal((await tabNames()).at(-1), 'Best Sellers');
});

test('hiding every home tab leaves the full catalog usable, and hiding All selects matching server-rendered products', { timeout: 60000 }, async () => {
  const starting = await layout();
  try {
    await saveLayout(starting.map(section => ({ ...section, visible: false })));
    const hiddenHome = await storefrontHtml();
    assert.ok(!/<section\b[^>]*\bid="collection"/.test(hiddenHome), 'The homepage collection stayed visible after hiding every tab.');
    const fullCatalog = await storefrontHtml('/products');
    assert.ok(/collection-full/.test(fullCatalog), 'Hiding home tabs must not remove the full catalog.');
    const fullNames = tabButtons(fullCatalog).map(button => button.name);
    assert.ok(['All', 'Hot Deals', 'Best Sellers'].every(name => fullNames.includes(name)), 'The full catalog lost its standard categories.');
    let chosen, expectedProducts;
    for (const candidate of starting.filter(section => section.key !== 'all' && section.categoryActive)) {
      const products = expectStatus(await request('/api/products?category=' + encodeURIComponent(candidate.slug)), 200, 'Read candidate category products');
      chosen ??= candidate; expectedProducts ??= products;
      if (products.length) { chosen = candidate; expectedProducts = products; break; }
    }
    assert.ok(chosen, 'An available non-All category is required to check the selected tab.');
    const arranged = [{ ...chosen, visible: true }, ...starting.filter(section => section.key !== chosen.key).map(section => ({ ...section, visible: section.key !== 'all' }))];
    await saveLayout(arranged);
    const selectedHome = await storefrontHtml();
    const selectedButtons = tabButtons(selectedHome);
    assert.ok(!selectedButtons.some(button => button.name === 'All'));
    assert.deepEqual(selectedButtons.filter(button => button.selected).map(button => button.name), [chosen.name], 'The first visible category must be selected when All is hidden.');
    const renderedSlugs = [...selectedHome.matchAll(/<a\b(?=[^>]*class="product-image-link")(?=[^>]*href="\/products\/([^"]+)")[^>]*>/g)].map(match => match[1]);
    assert.deepEqual(renderedSlugs, expectedProducts.map(product => product.slug), 'Initial server-rendered products do not match the selected category.');
  } finally { await saveLayout(starting); }
});

test('a custom category keeps its saved position and visibility through renames and soft deletion', { timeout: 60000 }, async () => {
  const starting = await layout();
  let mutable;
  try {
    const position = ((await db.category.aggregate({ _max: { position: true } }))._max.position || 0) + 1;
    mutable = expectStatus(await admin('/categories', { method: 'POST', data: { name: `QA Mutable ${run}`, slug: `qa-mutable-${run}`, position, active: true } }), 201, 'Create mutable isolated category');
    const key = `category:${mutable.id}`;
    const current = await layout();
    const section = current.find(item => item.key === key);
    const ordered = [...current.filter(item => item.key !== key)];
    ordered.splice(1, 0, { ...section, visible: false });
    await saveLayout(ordered);
    const renamedName = `QA Renamed ${run}`, renamedSlug = `qa-renamed-${run}`;
    expectStatus(await admin('/categories/' + mutable.id, { method: 'PATCH', data: { name: renamedName, slug: renamedSlug } }), 200, 'Rename isolated category');
    let changed = await layout();
    assert.equal(changed[1].key, key); assert.equal(changed[1].name, renamedName); assert.equal(changed[1].slug, renamedSlug); assert.equal(changed[1].visible, false);
    assert.ok(!(await tabNames()).includes(renamedName), 'Renaming must not unhide a hidden category.');
    changed = await saveLayout(changed.map(item => item.key === key ? { ...item, visible: true } : item));
    assert.equal((await tabNames()).filter(name => name === renamedName).length, 1);
    expectStatus(await admin('/categories/' + mutable.id, { method: 'DELETE' }), 200, 'Soft-delete isolated category');
    changed = await layout();
    assert.equal(changed[1].key, key); assert.equal(changed[1].visible, true); assert.equal(changed[1].categoryActive, false);
    assert.ok(!(await tabNames()).includes(renamedName), 'An inactive category must not appear despite its saved visibility flag.');
    expectStatus(await admin('/categories/' + mutable.id, { method: 'PATCH', data: { active: true } }), 200, 'Reactivate isolated category');
    changed = await layout();
    assert.equal(changed[1].key, key); assert.equal(changed[1].visible, true); assert.equal(changed[1].categoryActive, true);
    assert.equal((await tabNames()).filter(name => name === renamedName).length, 1);
  } finally {
    if (mutable) {
      expectStatus(await admin('/categories/' + mutable.id, { method: 'PATCH', data: { active: false } }), 200, 'Leave test category inactive');
      const inactive = (await layout()).find(section => section.key === `category:${mutable.id}`);
      const restored = [...starting];
      const bestIndex = restored.findIndex(section => section.key === 'best-sellers');
      restored.splice(bestIndex < 0 ? restored.length : bestIndex, 0, { ...inactive, visible: false });
      await saveLayout(restored);
    } else await saveLayout(starting);
  }
});

test('shipping follows the complete chain with Arabic customer tracking and no extra stock or payment movement', async () => {
  delivered = await createFixture(2);
  assert.equal(await stock(), originalStock - 2);
  assert.equal(delivered.statusLabel, statusLabels.NEW);
  assert.equal((await admin('/orders/' + delivered.id, { method: 'PATCH', data: { status: 'SHIPPED' } })).status, 400);
  assert.equal((await orderState(delivered)).status, 'NEW');
  await move(delivered, 'CONFIRMED'); await move(delivered, 'PREPARING');
  const trackingNumber = `QA-TRACK-${run}`;
  const shipped = await move(delivered, 'SHIPPED', { trackingNumber });
  assert.deepEqual(shipped.allowedNextStatuses, ['DELIVERED', 'CANCELLED']);
  assert.equal(shipped.canReturnItems, false);
  await move(delivered, 'SHIPPED', { trackingNumber });
  assert.equal(await stock(), originalStock - 2);
  const customer = await publicFixture(delivered);
  assert.equal(customer.status, 'SHIPPED'); assert.equal(customer.statusLabel, statusLabels.SHIPPED); assert.equal(customer.trackingNumber, trackingNumber);
  assert.ok((await fixtureCounts()).byStatus.SHIPPED >= 1);
  const completed = await move(delivered, 'DELIVERED');
  assert.equal(completed.canReturnItems, true);
  await move(delivered, 'DELIVERED');
  assert.equal(await stock(), originalStock - 2);
  assert.equal((await orderState(delivered)).paymentStatus, 'PENDING');
  assert.equal(await db.financialEntry.count({ where: { orderId: delivered.id, kind: 'SALE' } }), 0, 'Shipping must not collect payment or recognize unpaid revenue.');
  assert.equal((await admin('/orders/' + delivered.id, { method: 'PATCH', data: { status: 'RETURNED' } })).status, 400, 'A direct returned status must not bypass item accounting.');
});

test('explicit collection and item returns update stock exactly once and block duplicate returned quantities', async () => {
  const collected = expectStatus(await admin('/orders/' + delivered.id + '/payment', { method: 'POST', data: { action: 'confirm', paymentFee: 0 } }), 200, 'Explicitly confirm collection');
  assert.equal(collected.paymentStatus, 'PAID');
  assert.equal(await stock(), originalStock - 2);
  await move(delivered, 'DELIVERED');
  assert.equal(await db.financialEntry.count({ where: { orderId: delivered.id, kind: 'SALE' } }), 1);
  const item = (await orderState(delivered)).items[0];
  const partial = expectStatus(await admin('/orders/' + delivered.id + '/returns', { method: 'POST', data: { items: [{ orderItemId: item.id, quantity: 1, restock: true }], refundAmount: 0, reason: 'QA isolated partial item return' } }), 200, 'Record partial return');
  assert.equal(partial.status, 'DELIVERED'); assert.equal(await stock(), originalStock - 1);
  const returned = expectStatus(await admin('/orders/' + delivered.id + '/returns', { method: 'POST', data: { items: [{ orderItemId: item.id, quantity: 1, restock: true }], refundAmount: delivered.total, reason: 'QA isolated remaining item and full refund' } }), 200, 'Record remaining return');
  assert.equal(returned.status, 'RETURNED'); assert.equal(returned.paymentStatus, 'REFUNDED'); assert.equal(returned.canReturnItems, false);
  assert.equal(await stock(), originalStock);
  assert.equal((await admin('/orders/' + delivered.id + '/returns', { method: 'POST', data: { items: [{ orderItemId: item.id, quantity: 1, restock: true }], refundAmount: 0, reason: 'QA duplicate return must fail' } })).status, 400);
  await move(delivered, 'RETURNED');
  assert.equal(await stock(), originalStock);
  assert.equal(await db.return.count({ where: { orderId: delivered.id } }), 2);
  assert.equal((await publicFixture(delivered)).statusLabel, statusLabels.RETURNED);
});

test('cancellation releases stock once, and collected orders require a separate refund first', async () => {
  cancelled = await createFixture();
  assert.equal(await stock(), originalStock - 1);
  await move(cancelled, 'CANCELLED'); await move(cancelled, 'CANCELLED');
  assert.equal(await stock(), originalStock);
  assert.equal((await orderState(cancelled)).stockReleased, true);
  assert.equal((await orderState(cancelled)).paymentStatus, 'PENDING');
  assert.equal((await admin('/orders/' + cancelled.id, { method: 'PATCH', data: { status: 'CONFIRMED' } })).status, 400);
  prepaid = await createFixture(1, 'INSTAPAY');
  assert.equal(prepaid.paymentStatus, 'PENDING_VERIFICATION');
  const collected = expectStatus(await admin('/orders/' + prepaid.id + '/payment', { method: 'POST', data: { action: 'confirm' } }), 200, 'Confirm isolated transfer');
  assert.deepEqual(collected.allowedNextStatuses, ['CONFIRMED']);
  assert.equal((await admin('/orders/' + prepaid.id, { method: 'PATCH', data: { status: 'CANCELLED' } })).status, 400);
  assert.equal(await stock(), originalStock - 1); assert.equal((await orderState(prepaid)).paymentStatus, 'PAID');
  expectStatus(await admin('/orders/' + prepaid.id + '/returns', { method: 'POST', data: { items: [], refundAmount: prepaid.total, reason: 'QA isolated refund before cancelling' } }), 200, 'Refund undelivered collected order');
  assert.equal(await stock(), originalStock - 1, 'A refund alone must not restock items.');
  await move(prepaid, 'CANCELLED'); await move(prepaid, 'CANCELLED');
  assert.equal(await stock(), originalStock); assert.equal((await orderState(prepaid)).paymentStatus, 'REFUNDED');
});

test('all seven order filters and server counts agree, including zero counts and refreshed mutations', async () => {
  const counts = await fixtureCounts();
  assert.deepEqual(Object.keys(counts.byStatus).sort(), Object.keys(statusLabels).sort());
  const expectedTotal = await db.order.count({ where: { customerName: tag } });
  assert.equal(counts.total, expectedTotal);
  assert.equal(counts.byStatus.RETURNED, 1); assert.equal(counts.byStatus.CANCELLED, 2);
  for (const status of Object.keys(statusLabels)) {
    const expected = await db.order.count({ where: { customerName: tag, status } });
    assert.equal(counts.byStatus[status], expected);
    const filtered = expectStatus(await admin('/orders?search=' + encodeURIComponent(tag) + '&status=' + status), 200, 'Filter isolated orders');
    assert.equal(filtered.length, expected); assert.ok(filtered.every(order => order.status === status && order.statusLabel === statusLabels[status]));
  }
  const independent = expectStatus(await admin('/orders/counts?search=' + encodeURIComponent(tag) + '&status=NEW'), 200, 'Count independently of selected status');
  assert.deepEqual(independent, counts);
  const paid = expectStatus(await admin('/orders/counts?search=' + encodeURIComponent(tag) + '&paymentStatus=REFUNDED&governorateId=' + encodeURIComponent(governorate.id)), 200, 'Filter counts by payment and governorate');
  assert.equal(paid.total, 2);
  const empty = expectStatus(await admin('/orders/counts?search=no-matching-qa-' + run), 200, 'Read zero counts');
  assert.equal(empty.total, 0); assert.ok(Object.values(empty.byStatus).every(value => value === 0));
  const future = expectStatus(await admin('/orders/counts?search=' + encodeURIComponent(tag) + '&from=2099-01-01&to=2099-01-02'), 200, 'Apply count date filters');
  assert.equal(future.total, 0);
});

test('original cloned accounts, orders, products, images, stock and footer settings remain intact', async () => {
  assert.equal(await stock(), originalStock);
  assert.deepEqual(await businessFingerprint(), originalBusiness, 'An original cloned business record changed outside the isolated fixtures.');
  const otherSettings = await db.setting.findMany({ where: { key: { notIn: ['homepageSections', canaryKey] } }, orderBy: { key: 'asc' } });
  assert.equal(digest(otherSettings), digest(originalSettings.filter(setting => setting.key !== 'homepageSections')), 'Unrelated settings or footer content changed.');
  const footer = (await publicSettings()).footer;
  assert.ok(footer && typeof footer.copyright === 'string');
  assert.equal((await fetch(web + '/admin', { redirect: 'error', signal: AbortSignal.timeout(30000) })).status, 200);
});
