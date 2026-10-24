import { config } from 'dotenv';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export function loadApplicationSettings({ requirePrivateFile = false } = {}) {
  process.chdir(projectRoot);
  const environmentPath = join(projectRoot, '.env');
  if (!existsSync(environmentPath) && (requirePrivateFile || !process.env.DATABASE_URL)) {
    throw new Error('The private .env settings are missing. For an existing store, restore its current settings from your backup before starting. Do not run setup or seed to repair an existing store.');
  }
  config({ path: environmentPath, quiet: true });
}

function runSavedDatabase() {
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, [join(projectRoot, 'scripts/local-db.mjs'), 'start', '--existing-only'], {
      cwd: projectRoot,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', () => reject(new Error('The saved database helper could not start. Existing files were preserved.')));
    child.once('exit', code => code === 0 ? accept() : reject(new Error('The saved database is not ready. See the message above; no application server was started.')));
  });
}

export async function prepareDatabase() {
  let uri;
  try { uri = new URL(process.env.DATABASE_URL || ''); }
  catch { throw new Error('A valid PostgreSQL DATABASE_URL is required in the private settings.'); }
  if (!['postgresql:', 'postgres:'].includes(uri.protocol)) throw new Error('DATABASE_URL must select PostgreSQL.');

  const loopback = ['127.0.0.1', 'localhost'].includes(uri.hostname);
  const localCluster = existsSync(join(projectRoot, '.local/postgres'));
  const skipLocalDb = process.env.SKIP_LOCAL_DB === 'true' || process.env.DIRECT_DATABASE === 'true';
  if (!skipLocalDb && loopback && (localCluster || ((uri.port || '5432') === '55432' && (process.env.PG_BIN || existsSync('C:/Program Files/PostgreSQL/16/bin'))))) {
    console.log('Checking the existing SHOES GUN database before starting the store.');
    await runSavedDatabase();
  }

  // Also verify that the selected application database accepts queries. The
  // local helper verifies cluster ownership; external databases are read only.
  const client = new pg.Client({ connectionString: uri.href, connectionTimeoutMillis: 5000, query_timeout: 5000, statement_timeout: 5000 });
  client.on('error', () => {});
  try {
    await client.connect();
    await client.query('SELECT 1');
  } catch {
    throw new Error('The configured PostgreSQL database is unavailable or the saved login was rejected. Check the database service and current private settings. Existing data was not initialized or replaced.');
  } finally { await client.end().catch(() => {}); }
}

export async function prepareApplication({ production = false, requirePrivateFile = false } = {}) {
  loadApplicationSettings({ requirePrivateFile });
  if (!existsSync(join(projectRoot, 'node_modules/@prisma/client'))) {
    throw new Error('Project dependencies are missing. Run npm.cmd ci, then npm.cmd run db:generate and npm.cmd run build. Existing stores do not need setup or seed.');
  }
  if (production && (!existsSync(join(projectRoot, 'apps/web/.next/BUILD_ID')) || !existsSync(join(projectRoot, 'apps/api/dist/server.js')))) {
    throw new Error('Production build is missing. Run npm.cmd run build once, then start again.');
  }
  await prepareDatabase();
}
