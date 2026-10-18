#!/usr/bin/env node
// Lanzador del modo host de OpenIoTData: prepara el entorno y arranca la API y el
// frontend sin Docker. Compatible con Windows, macOS y Linux (requiere Node.js 22).
//
// Uso: node scripts/dev.mjs [--api-only|--web-only] [--no-seed] [--reset|--env|--help]

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backendDir = join(rootDir, "backend");
const frontendDir = join(rootDir, "frontend");
const dataDir = join(backendDir, "data");
const envPath = join(rootDir, "scripts", "dev-local.env");
const isWindows = process.platform === "win32";

const flags = new Set(process.argv.slice(2));
const wantsHelp = flags.has("-h") || flags.has("--help");
const wantsEnv = flags.has("--env");
const wantsReset = flags.has("--reset");
const apiOnly = flags.has("--api-only");
const webOnly = flags.has("--web-only");
const noSeed = flags.has("--no-seed");

function log(message) {
  console.log(`[dev] ${message}`);
}

function fail(message) {
  console.error(`[dev] Error: ${message}`);
  process.exit(1);
}

function printUsage() {
  console.log(`Modo host de OpenIoTData (backend + frontend, sin Docker)

Uso: node scripts/dev.mjs [opciones]

  (sin opciones)  Prepara el entorno, carga los datos demo y arranca API y frontend
  --api-only      Arranca sólo la API en http://localhost:8000
  --web-only      Arranca sólo el frontend en http://localhost:3000
  --no-seed       No carga el catálogo ilustrativo
  --reset         Elimina backend/data (base local y objetos) y termina
  --env           Muestra la configuración resuelta y termina
  -h, --help      Muestra esta ayuda

Este modo omite ClamAV, Keycloak/OIDC, PostGIS y el worker Celery. No sustituye a
'make validate-beta' ni debe usarse en entornos compartidos.`);
}

function parseEnvFile(path) {
  const result = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function run(command, commandArgs, cwd, useShell = false) {
  const result = spawnSync(command, commandArgs, {
    cwd,
    env: hostEnv,
    shell: useShell,
    stdio: "inherit",
  });
  if (result.error) fail(`no se pudo ejecutar ${command}: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} terminó con código ${result.status}`);
}

function pipeOutput(stream, label) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) console.log(`${label} ${line}`);
    }
  });
  stream.on("end", () => {
    if (buffer.trim()) console.log(`${label} ${buffer}`);
  });
}

const children = [];
let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("deteniendo servicios...");
  for (const child of children) {
    if (child.exitCode !== null || child.killed) continue;
    if (isWindows) {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        try {
          child.kill("SIGTERM");
        } catch {
          /* proceso ya finalizado */
        }
      }
    }
  }
  setTimeout(() => process.exit(code), 800);
}

function launch(label, command, commandArgs, cwd, useShell = false) {
  const child = spawn(command, commandArgs, {
    cwd,
    env: hostEnv,
    shell: useShell,
    detached: !isWindows,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  if (child.stdout) pipeOutput(child.stdout, label);
  if (child.stderr) pipeOutput(child.stderr, label);
  child.on("error", (error) => fail(`no se pudo iniciar ${label}: ${error.message}`));
  child.on("exit", (code) => {
    if (shuttingDown) return;
    log(`${label} finalizó con código ${code ?? "?"}; deteniendo el resto.`);
    shutdown(code ?? 1);
  });
  return child;
}

function venvPythonCandidates() {
  return [join(backendDir, ".venv"), join(backendDir, ".venv312")].map((dir) =>
    isWindows ? join(dir, "Scripts", "python.exe") : join(dir, "bin", "python"),
  );
}

function existingVenvPython() {
  return venvPythonCandidates().find((candidate) => existsSync(candidate)) ?? null;
}

function detectPython() {
  const candidates = isWindows
    ? [["py", ["-3.12"]], ["python", []], ["python3", []]]
    : [["python3.12", []], ["python3", []], ["python", []]];
  for (const [command, baseArgs] of candidates) {
    const probe = spawnSync(command, [...baseArgs, "--version"], { encoding: "utf8" });
    if (probe.error || probe.status !== 0) continue;
    const match = `${probe.stdout ?? ""}${probe.stderr ?? ""}`.match(/Python (\d+)\.(\d+)/);
    if (!match) continue;
    const major = Number(match[1]);
    const minor = Number(match[2]);
    if (major === 3 && minor >= 12) return { command, baseArgs, version: `${major}.${minor}` };
  }
  return null;
}

function hasBackendDeps(python) {
  const probe = spawnSync(
    python,
    ["-c", "import fastapi, uvicorn, duckdb, pyarrow, sqlalchemy, aiosqlite"],
    { cwd: backendDir, env: hostEnv, stdio: "ignore" },
  );
  return probe.status === 0;
}

function ensureBackend() {
  mkdirSync(dataDir, { recursive: true });
  let python = existingVenvPython();
  if (!python) {
    const found = detectPython();
    if (!found) fail("no se encontró Python 3.12 o superior. Instálelo y vuelva a intentar.");
    log(`creando backend/.venv con ${found.command} (Python ${found.version})...`);
    run(found.command, [...found.baseArgs, "-m", "venv", join(backendDir, ".venv")], rootDir);
    python = existingVenvPython();
    if (!python) fail("no se pudo crear backend/.venv");
    log("instalando dependencias del backend...");
    run(python, ["-m", "pip", "install", "--upgrade", "pip"], backendDir);
    run(python, ["-m", "pip", "install", "-r", "requirements.lock"], backendDir);
  } else if (!hasBackendDeps(python)) {
    log("instalando dependencias del backend...");
    run(python, ["-m", "pip", "install", "-r", "requirements.lock"], backendDir);
  }
  return python;
}

function ensureFrontend() {
  const sentinel = join(frontendDir, "node_modules", "next", "package.json");
  if (existsSync(sentinel)) return;
  log("instalando dependencias del frontend (npm ci)...");
  run("npm", ["ci"], frontendDir, isWindows);
}

function showEnvironment() {
  const keys = [
    "APP_ENV",
    "DATABASE_URL",
    "STORAGE_BACKEND",
    "LOCAL_STORAGE_PATH",
    "CELERY_TASK_ALWAYS_EAGER",
    "DEV_AUTH_BYPASS",
    "CLAMAV_REQUIRED",
    "NEXT_PUBLIC_API_URL",
    "NEXT_PUBLIC_DEV_AUTH_BYPASS",
  ];
  console.log("Configuración del modo host (scripts/dev-local.env):");
  for (const key of keys) {
    console.log(`  ${key.padEnd(28)} ${hostEnv[key] ?? ""}`);
  }
}

if (wantsHelp) {
  printUsage();
  process.exit(0);
}

if (apiOnly && webOnly) fail("--api-only y --web-only son mutuamente excluyentes.");
if (!existsSync(envPath)) fail(`no se encontró ${envPath}`);

const hostEnv = { ...process.env, ...parseEnvFile(envPath) };
if (hostEnv.APP_ENV === "production") {
  fail("el modo host no puede ejecutarse con APP_ENV=production.");
}

log("modo host: sin ClamAV, sin OIDC/Keycloak, sin PostGIS y sin worker Celery.");

if (wantsReset) {
  if (existsSync(dataDir)) {
    rmSync(dataDir, { recursive: true, force: true });
    log("datos locales eliminados (backend/data).");
  } else {
    log("no hay datos locales que eliminar.");
  }
  process.exit(0);
}

if (wantsEnv) {
  showEnvironment();
  process.exit(0);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

let python = null;
if (!webOnly) python = ensureBackend();
if (!apiOnly) ensureFrontend();

if (!webOnly && !noSeed) {
  log("cargando el catálogo ilustrativo (operación idempotente)...");
  run(python, ["-m", "app.seed"], backendDir);
}

if (!webOnly) {
  launch(
    "[api]",
    python,
    ["-m", "uvicorn", "app.main:app", "--reload", "--host", "127.0.0.1", "--port", "8000"],
    backendDir,
  );
}
if (!apiOnly) {
  launch("[web]", "npm", ["run", "dev"], frontendDir, isWindows);
}

log("API: http://localhost:8000   UI: http://localhost:3000");
log("Pulse Ctrl+C para detener.");
