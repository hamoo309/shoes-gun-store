@echo off
setlocal
title SHOES GUN - Restore Complete Transfer
pushd "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22.12 or later and PostgreSQL 16, then try again.
  pause
  popd
  exit /b 1
)
rem Keep inherited machine settings from overriding this copy's private .env.
for %%V in (DATABASE_URL POSTGRES_PASSWORD SESSION_SECRET APP_SECRET PORT API_PORT WEB_PORT HOST WEB_ORIGIN PUBLIC_SITE_URL NEXT_PUBLIC_SITE_URL NODE_ENV COOKIE_SECURE STORAGE_DIR UPLOAD_DIR API_INTERNAL_URL API_URL ALLOW_INSECURE_LOCAL_PREVIEW LOGIN_RATE_LIMIT_STORE TRUST_PROXY MIGRATION_DATABASE_URL DIRECT_URL SHADOW_DATABASE_URL PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSERVICE PGSERVICEFILE PGOPTIONS PGSSLMODE PGSSLKEY PGSSLCERT PGSSLROOTCERT PGPASSFILE PGAPPNAME PG_DUMP_BIN) do set "%%V="
node.exe "scripts\restore-transfer.mjs" %*
if errorlevel 1 (
  pause
  popd
  exit /b 1
)
if /i "%~1"=="--verify" (
  popd
  exit /b 0
)
call "START-SHOES-GUN.cmd"
set "SG_EXIT=%errorlevel%"
popd
exit /b %SG_EXIT%
