// Read-only ownership gate shared by integration suites. A marker alone never
// authorizes writes: the on-disk cluster and connected PostgreSQL must agree.
import assert from 'node:assert/strict';
import { readFile, realpath, lstat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { Client } from 'pg';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const canonical = value => resolve(value).replaceAll('\\', '/').toLowerCase();
const childOf = (parent, child) => {
  const suffix = relative(parent, child);
  return suffix !== '' && !isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith(`..${sep}`);
};
const portNumber = value => {
  const port = Number(value);
  assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535, 'The QA marker contains an invalid port.');
  return port;
};
async function plainPath(path, label) {
  assert.ok(canonical(await realpath(path)) === canonical(path), `${label} must not redirect through a junction or symlink.`);
  assert.ok(!(await lstat(path)).isSymbolicLink(), `${label} must not be a symbolic link.`);
}

export async function verifyIsolatedProject(explicitProject, { requireInjectedDatabase = false } = {}) {
  assert.ok(typeof explicitProject === 'string' && explicitProject.trim(), 'Pass an explicit isolated QA project root.');
  const project = resolve(explicitProject);
  await plainPath(project, 'The QA project');
  assert.ok(canonical(project) !== canonical(sourceRoot), 'The main project must never be a mutable integration-test target.');
  assert.ok(!/(?:^|\/)shoes-gun-runtime$/.test(canonical(project)), 'The original store must never be a mutable integration-test target.');
  const markerPath = join(project, '.local', 'isolated-test.json');
  await plainPath(markerPath, 'The isolated-test marker');
  assert.ok((await lstat(markerPath)).isFile(), 'The isolated-test marker must be a regular file.');
  const marker = JSON.parse(await readFile(markerPath, 'utf8'));
  assert.ok(marker.purpose === 'SHOES_GUN_ISOLATED_TEST', 'The directory is not explicitly marked for isolated integration tests.');
  const databasePort = portNumber(marker.databasePort), webPort = portNumber(marker.webPort), apiPort = portNumber(marker.apiPort);
  const authApiPorts = (marker.authApiPorts || [4010, 4011, 4012]).map(portNumber);
  assert.ok(authApiPorts.length === 3 && new Set(authApiPorts).size === 3, 'The QA marker needs three distinct authentication API ports.');
  assert.ok(![databasePort, webPort, apiPort, ...authApiPorts].some(port => [3000, 4000, 55432].includes(port)), 'Integration tests must refuse the original store ports.');
  assert.ok(new Set([databasePort, webPort, apiPort, ...authApiPorts]).size === 6, 'The QA listeners must use distinct ports.');
  assert.ok(typeof marker.databaseName === 'string' && /^[a-zA-Z0-9_]+$/.test(marker.databaseName), 'The QA marker must name its isolated database.');
  const expectedCluster = join(project, '.local', 'postgres');
  assert.ok(typeof marker.dataDirectory === 'string' && isAbsolute(marker.dataDirectory), 'The marker must declare an absolute QA data directory.');
  assert.ok(canonical(marker.dataDirectory) === canonical(expectedCluster), 'The QA data directory must belong to this project.');
  assert.ok(childOf(project, expectedCluster), 'The QA cluster must stay inside the explicitly selected project.');
  await plainPath(expectedCluster, 'The QA cluster');
  const settingsPath = join(project, '.env');
  await plainPath(settingsPath, 'The QA private settings');
  const environment = parse(await readFile(settingsPath));
  let uri;
  try { uri = new URL(environment.DATABASE_URL); } catch { throw new Error('The isolated QA database URL is missing or malformed.'); }
  assert.ok(['postgresql:', 'postgres:'].includes(uri.protocol) && uri.hostname === '127.0.0.1', 'QA must connect explicitly to loopback PostgreSQL.');
  assert.ok(Number(uri.port) === databasePort && decodeURIComponent(uri.pathname.slice(1)) === marker.databaseName, 'The QA database does not match its ownership marker.');
  assert.ok(!uri.searchParams.has('schema') || uri.searchParams.get('schema') === 'public', 'QA tests require the restored public schema.');
  assert.ok(Number(environment.WEB_PORT) === webPort && Number(environment.API_PORT) === apiPort, 'The QA HTTP ports do not match the ownership marker.');
  if (requireInjectedDatabase) assert.ok(process.env.DATABASE_URL === environment.DATABASE_URL, 'The test runner must inject the exact isolated database settings.');
  const storage = resolve(project, environment.UPLOAD_DIR || environment.STORAGE_DIR || './storage');
  assert.ok(canonical(storage) === canonical(join(project, 'storage')), 'QA media must belong to the isolated project.');
  await plainPath(storage, 'The QA media directory');
  const pidPath = join(expectedCluster, 'postmaster.pid');
  await plainPath(pidPath, 'The QA PostgreSQL ownership file');
  const pidLines = (await readFile(pidPath, 'utf8')).trimEnd().split(/\r?\n/);
  assert.ok(/^\d+$/.test(pidLines[0]) && Number(pidLines[0]) > 0, 'The QA postmaster PID must be valid.');
  assert.ok(canonical(pidLines[1]) === canonical(expectedCluster) && Number(pidLines[3]) === databasePort, 'The QA postmaster does not own the expected directory and port.');
  const client = new Client({ connectionString: uri.href, connectionTimeoutMillis: 5000, query_timeout: 10000 });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const directory = (await client.query('SHOW data_directory')).rows[0].data_directory;
    const actualPort = Number((await client.query('SHOW port')).rows[0].port);
    const database = (await client.query('SELECT current_database() AS name')).rows[0].name;
    assert.ok(canonical(await realpath(directory)) === canonical(expectedCluster) && actualPort === databasePort && database === marker.databaseName, 'Connected PostgreSQL is not the marked, owned QA target.');
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query('ROLLBACK');
    await client.query("SET TIME ZONE 'UTC'");
  } catch {
    await client.end().catch(() => {});
    throw new Error('The read-only isolated PostgreSQL ownership check failed. No test writes were authorized.');
  }
  return { project, environment, uri, client, marker, webPort, apiPort, authApiPorts, canonical };
}
