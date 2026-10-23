import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// These regressions use disposable directories only. They never load the store's
// .env, connect to its database, run setup/seed, or stop an existing process.
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureBase = join(projectRoot, '.local', 'startup-tests');
const fakePassword = 'fixture-private-password-do-not-print';
const fakeUrl = `postgresql://startup_fixture:${fakePassword}@127.0.0.1:65534/startup_fixture`;

function isChild(parent, child) {
  const suffix = relative(parent, child);
  return suffix !== '' && !isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith(`..${sep}`);
}

async function withFixture(run) {
  await mkdir(fixtureBase, { recursive: true });
  const canonicalProject = await realpath(projectRoot);
  const canonicalBase = await realpath(fixtureBase);
  assert.ok(isChild(canonicalProject, canonicalBase), 'Fixture base must stay inside this project.');
  const fixture = await mkdtemp(join(fixtureBase, 'guard-'));
  try {
    await run(fixture);
  } finally {
    // Verify both the absolute target and its canonical location immediately
    // before recursive cleanup, so an unrelated directory cannot be removed.
    const target = resolve(fixture);
    assert.ok(isChild(resolve(fixtureBase), target));
    assert.ok(isChild(canonicalBase, await realpath(target)));
    assert.equal((await lstat(target)).isSymbolicLink(), false);
    await rm(target, { recursive: true, force: true });
  }
}

async function snapshot(directory) {
  const files = [];
  async function visit(current) {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(current, entry.name);
      assert.equal(entry.isSymbolicLink(), false, 'Fixtures must not contain links.');
      if (entry.isDirectory()) {
        files.push([relative(directory, path), 'directory']);
        await visit(path);
      } else {
        files.push([relative(directory, path), createHash('sha256').update(await readFile(path)).digest('hex')]);
      }
    }
  }
  await visit(directory);
  return files;
}

function runNode(script, cwd, env = {}, args = ['--no-browser']) {
  const cleanEnv = { ...process.env };
  for (const name of Object.keys(cleanEnv)) {
    if (/^(?:DATABASE_URL|PG_BIN|NODE_OPTIONS|NODE_PATH|PORT|WEB_PORT|API_PORT|DOTENV_CONFIG_.*)$/i.test(name)) delete cleanEnv[name];
  }
  return new Promise((accept, reject) => {
    execFile(process.execPath, [script, ...args], {
      cwd,
      env: { ...cleanEnv, DATABASE_URL: fakeUrl, PG_BIN: join(cwd, 'no-postgresql-binaries'), ...env },
      windowsHide: true,
      timeout: 12_000,
      maxBuffer: 256 * 1024,
    }, (error, stdout, stderr) => {
      if (error && (error.killed || error.code !== 1)) return reject(new Error('Fixture process failed unexpectedly or exceeded its timeout.'));
      accept({ code: error?.code ?? 0, output: stdout + stderr });
    });
  });
}

async function copyLauncher(fixture) {
  await mkdir(join(fixture, 'scripts'));
  for (const name of ['local-run.mjs', 'app-preflight.mjs', 'local-db.mjs', 'start.mjs', 'dev.mjs']) {
    await copyFile(join(projectRoot, 'scripts', name), join(fixture, 'scripts', name));
  }
  return join(fixture, 'scripts', 'local-run.mjs');
}

function assertSafeFailure(result) {
  assert.equal(result.code, 1);
  assert.equal(result.output.includes(fakePassword), false, 'Private credentials must not be printed.');
  assert.doesNotMatch(result.output, /npm(?:\.cmd)?\s+(?:run\s+)?(?:setup|seed|db:seed)\b/i, 'Repair guidance must not instruct an existing store to initialize or seed.');
}

test('local startup rejects missing private settings without creating or changing files', async () => {
  await withFixture(async fixture => {
    const script = await copyLauncher(fixture);
    const before = await snapshot(fixture);
    const result = await runNode(script, fixture);
    assertSafeFailure(result);
    assert.match(result.output, /private \.env settings are missing/i);
    assert.match(result.output, /restore its current settings from your backup/i);
    assert.deepEqual(await snapshot(fixture), before);
  });
});

test('local startup gives dependency repair guidance without touching data or leaking credentials', async () => {
  await withFixture(async fixture => {
    const script = await copyLauncher(fixture);
    await writeFile(join(fixture, '.env'), `DATABASE_URL=${fakeUrl}\n`);
    const before = await snapshot(fixture);
    const result = await runNode(script, fixture);
    assertSafeFailure(result);
    assert.match(result.output, /Project dependencies are missing/i);
    assert.match(result.output, /npm\.cmd ci/);
    assert.match(result.output, /npm\.cmd run db:generate/);
    assert.match(result.output, /npm\.cmd run build/);
    assert.deepEqual(await snapshot(fixture), before);
  });
});

test('local database helper preserves a nonempty cluster with missing PG_VERSION before invoking binaries', async () => {
  await withFixture(async fixture => {
    const cluster = join(fixture, '.local', 'postgres');
    await mkdir(cluster, { recursive: true });
    await writeFile(join(cluster, 'existing-data-sentinel'), 'Existing store data must survive startup guards.\n');
    const before = await snapshot(fixture);
    const result = await runNode(join(projectRoot, 'scripts', 'local-db.mjs'), fixture, {
      DOTENV_CONFIG_PATH: join(fixture, 'absent-fixture.env'),
    });
    assertSafeFailure(result);
    assert.match(result.output, /saved PostgreSQL directory is missing PG_VERSION/i);
    assert.match(result.output, /Existing files were preserved/i);
    assert.doesNotMatch(result.output, /ENOENT|spawn|no-postgresql-binaries|Created development database/i);
    assert.deepEqual(await snapshot(fixture), before);
  });
});

for (const entry of ['dev.mjs', 'start.mjs']) {
  test(`${entry} rejects absent private settings before starting either application server`, async () => {
    await withFixture(async fixture => {
      await copyLauncher(fixture);
      const before = await snapshot(fixture);
      const result = await runNode(join(fixture, 'scripts', entry), fixture, { DATABASE_URL: '' });
      assertSafeFailure(result);
      assert.match(result.output, /private \.env settings are missing/i);
      assert.deepEqual(await snapshot(fixture), before);
    });
  });
}

for (const entry of ['local-run.mjs', 'dev.mjs', 'start.mjs']) {
  test(`${entry} preserves an incomplete saved cluster instead of initializing an empty store`, async () => {
    await withFixture(async fixture => {
      await copyLauncher(fixture);
      const cluster = join(fixture, '.local', 'postgres');
      await mkdir(cluster, { recursive: true });
      await writeFile(join(cluster, 'existing-data-sentinel'), 'Never initialize or replace these saved files.\n');
      await mkdir(join(fixture, 'node_modules', '@prisma', 'client'), { recursive: true });
      await mkdir(join(fixture, 'apps', 'web', '.next'), { recursive: true });
      await mkdir(join(fixture, 'apps', 'api', 'dist'), { recursive: true });
      await writeFile(join(fixture, 'apps', 'web', '.next', 'BUILD_ID'), 'fixture-build');
      await writeFile(join(fixture, 'apps', 'api', 'dist', 'server.js'), 'throw new Error("Fixture API must never be launched.");');
      await writeFile(join(fixture, '.env'), `DATABASE_URL=${fakeUrl}\nWEB_PORT=65532\nAPI_PORT=65533\n`);
      const before = await snapshot(fixture);
      const result = await runNode(join(fixture, 'scripts', entry), fixture);
      assertSafeFailure(result);
      assert.match(result.output, /saved PostgreSQL cluster is missing or incomplete/i);
      assert.match(result.output, /automatic store startup will not initialize a new database/i);
      assert.doesNotMatch(result.output, /ENOENT|spawn .*no-postgresql-binaries|Created development database|Fixture API must never be launched/i);
      assert.deepEqual(await snapshot(fixture), before);
    });
  });
}

test('existing-only database startup rejects an absent cluster without creating directories', async () => {
  await withFixture(async fixture => {
    const before = await snapshot(fixture);
    const result = await runNode(join(projectRoot, 'scripts', 'local-db.mjs'), fixture, {
      DOTENV_CONFIG_PATH: join(fixture, 'absent-fixture.env'),
    }, ['start', '--existing-only']);
    assertSafeFailure(result);
    assert.match(result.output, /saved PostgreSQL cluster is missing or incomplete/i);
    assert.deepEqual(await snapshot(fixture), before);
  });
});
