// config.js — loads env secrets (server-side only) and the editable model registry.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

dotenv.config({ path: path.join(ROOT, '.env') });

for (const d of [DATA_DIR, UPLOAD_DIR]) fs.mkdirSync(d, { recursive: true });

const REGISTRY_DEFAULT = path.join(__dirname, 'registry.default.json');
const REGISTRY_LIVE = path.join(DATA_DIR, 'registry.json');

export const SECRET_ENV_NAMES = [
  'NVIDIA_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'MINIMAX_API_KEY',
  'TWELVE_DATA_API_KEY', 'FRED_API_KEY', 'NEWS_API_KEY',
];

export function isTestMode() {
  return String(process.env.TEST_MODE || '').toLowerCase() === 'true';
}

/** Returns the secret value for internal server use only. Never send to client. */
export function getSecret(name) {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : null;
}

/** Safe for the client: only reports whether a secret is configured. */
export function secretStatus() {
  const out = {};
  for (const n of SECRET_ENV_NAMES) out[n] = getSecret(n) ? 'CONFIGURED' : 'NOT CONFIGURED';
  return out;
}

let _registry = null;

export function loadRegistry() {
  if (_registry) return _registry;
  if (fs.existsSync(REGISTRY_LIVE)) {
    try {
      _registry = JSON.parse(fs.readFileSync(REGISTRY_LIVE, 'utf8'));
      return _registry;
    } catch (e) {
      console.error('registry.json corrupt, falling back to defaults:', e.message);
    }
  }
  _registry = JSON.parse(fs.readFileSync(REGISTRY_DEFAULT, 'utf8'));
  return _registry;
}

export function saveRegistry(reg) {
  // Basic structural validation; also refuse anything that smells like a secret.
  if (!reg || typeof reg !== 'object' || !reg.providers || !Array.isArray(reg.models) || !reg.routing) {
    throw new Error('Invalid registry structure: requires providers, models[], routing.');
  }
  const s = JSON.stringify(reg);
  if (/(sk-or-v1-|nvapi-|AIza|Bearer\s+[A-Za-z0-9_\-\.]{20,})/i.test(s)) {
    throw new Error('Registry rejected: appears to contain an API key. Keys belong ONLY in server-side env vars.');
  }
  fs.writeFileSync(REGISTRY_LIVE, JSON.stringify(reg, null, 2));
  _registry = reg;
  return _registry;
}

export function getModelByKey(key) {
  const reg = loadRegistry();
  return reg.models.find(m => m.key === key) || null;
}

export function getProvider(name) {
  const reg = loadRegistry();
  return reg.providers[name] || null;
}

/** Resolve a routing slot (e.g. "agent_3") into an ordered list of usable model configs. */
export function resolveRoute(slot) {
  const reg = loadRegistry();
  const route = reg.routing[slot];
  if (!route) return [];
  const keys = [route.model_key, ...(route.fallbacks || [])];
  const models = [];
  for (const k of keys) {
    const m = getModelByKey(k);
    if (!m || !m.enabled || !m.model_id) continue;
    const p = getProvider(m.provider);
    if (!p || !p.base_url) continue;
    // In TEST_MODE the provider is never actually called (labelled mocks only),
    // so a missing key must not block pipeline testing.
    if (!getSecret(p.key_env) && !isTestMode()) continue;
    models.push({ ...m, provider_config: p });
  }
  return models;
}
