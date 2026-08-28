// Simple JSON-file persistence layer. Atomic writes.
// Used because native better-sqlite3 is unavailable in this sandbox.
// For a personal, single-user tool this is sufficient and auditable.
import "server-only";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import type {
  AnalysisSession,
  TradeOutcome,
  ApiHealthStatus,
} from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const OUTCOMES_FILE = path.join(DATA_DIR, "outcomes.json");
const HEALTH_FILE = path.join(DATA_DIR, "health.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const AUDIT_FILE = path.join(DATA_DIR, "audit.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function readJson<T>(file: string, fallback: T): T {
  ensureDataDir();
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(file: string, data: T) {
  ensureDataDir();
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

export function newId(prefix = "sess"): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto
    .randomBytes(4)
    .toString("hex")}`;
}

export function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// ---------- Sessions ----------
export function listSessions(): AnalysisSession[] {
  return readJson<AnalysisSession[]>(SESSIONS_FILE, [])
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export function getSession(id: string): AnalysisSession | null {
  const all = readJson<AnalysisSession[]>(SESSIONS_FILE, []);
  return all.find((s) => s.session_id === id) ?? null;
}

export function saveSession(session: AnalysisSession) {
  const all = readJson<AnalysisSession[]>(SESSIONS_FILE, []);
  const idx = all.findIndex((s) => s.session_id === session.session_id);
  if (idx >= 0) all[idx] = session;
  else all.push(session);
  writeJson(SESSIONS_FILE, all);
}

// ---------- Trade outcomes ----------
export function listOutcomes(): TradeOutcome[] {
  return readJson<TradeOutcome[]>(OUTCOMES_FILE, []);
}

export function getOutcomesForSession(sessionId: string): TradeOutcome[] {
  return listOutcomes().filter((o) => o.session_id === sessionId);
}

export function saveOutcome(outcome: TradeOutcome) {
  const all = listOutcomes();
  const idx = all.findIndex(
    (o) => o.id === outcome.id
  );
  if (idx >= 0) all[idx] = outcome;
  else all.push(outcome);
  writeJson(OUTCOMES_FILE, all);
}

// ---------- Health cache ----------
export function getHealthCache(): Record<string, ApiHealthStatus> {
  return readJson<Record<string, ApiHealthStatus>>(HEALTH_FILE, {});
}
export function setHealthCache(rec: Record<string, ApiHealthStatus>) {
  writeJson(HEALTH_FILE, rec);
}

// ---------- Settings ----------
export interface AppSettings {
  models: {
    vision: { provider: string; model_id: string } | null;
    text: { provider: string; model_id: string } | null;
    judge: { provider: string; model_id: string } | null;
  };
  testMode: boolean;
}

// Defaults use Google Gemini direct (gemini-2.0-flash) — verified working with a
// standard GEMINI_API_KEY as of 2026-08. OpenRouter free-tier IDs (llama-3.1-8b
// :free etc.) now 404 ("unavailable for free") and NVIDIA returns 403, so they
// are NOT defaults anymore. They can still be selected manually in Settings.
// Same model across all 10 agents is acceptable for the initial working version;
// the model registry already supports routing slots to different providers.
const DEFAULT_SETTINGS: AppSettings = {
  models: {
    vision: { provider: "gemini", model_id: "gemini-2.0-flash" },
    text: { provider: "gemini", model_id: "gemini-2.0-flash" },
    judge: { provider: "gemini", model_id: "gemini-2.0-flash" },
  },
  testMode: false,
};

export function getSettings(): AppSettings {
  // Deep-merge stored settings over defaults PER MODEL SLOT, so that a stored
  // settings.json with null/missing slots (from an older deploy) can never
  // blank out the defaults and leave the Settings dropdowns stuck on "(disabled)".
  const stored = readJson<Partial<AppSettings>>(SETTINGS_FILE, {});
  const storedModels = stored.models ?? ({} as Partial<AppSettings["models"]>);
  return {
    models: {
      vision: storedModels.vision ?? DEFAULT_SETTINGS.models.vision,
      text: storedModels.text ?? DEFAULT_SETTINGS.models.text,
      judge: storedModels.judge ?? DEFAULT_SETTINGS.models.judge,
    },
    testMode:
      typeof stored.testMode === "boolean"
        ? stored.testMode
        : DEFAULT_SETTINGS.testMode,
  };
}
export function saveSettings(s: AppSettings) {
  writeJson(SETTINGS_FILE, s);
}

// ---------- Uploads ----------
export function uploadPath(filename: string): string {
  ensureDataDir();
  return path.join(UPLOADS_DIR, filename);
}
export function readUpload(filename: string): Buffer | null {
  const p = uploadPath(filename);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p);
}
export function writeUpload(filename: string, buf: Buffer) {
  ensureDataDir();
  fs.writeFileSync(uploadPath(filename), buf);
}
export function existsUpload(filename: string): boolean {
  return fs.existsSync(uploadPath(filename));
}

// ---------- Audit log ----------
export interface AuditEntry {
  id: string;
  timestamp: string;
  session_id?: string;
  provider: string;
  model?: string;
  agent?: string;
  request_status: "OK" | "ERROR";
  latency_ms?: number;
  data_source?: string;
  data_timestamp?: string;
  error?: string;
}
export function appendAudit(entry: Omit<AuditEntry, "id" | "timestamp">) {
  const all = readJson<AuditEntry[]>(AUDIT_FILE, []);
  all.push({
    id: newId("aud"),
    timestamp: new Date().toISOString(),
    ...entry,
  });
  // Cap log to last 2000 entries to keep file small
  writeJson(AUDIT_FILE, all.slice(-2000));
}
export function listAudit(limit = 200): AuditEntry[] {
  return readJson<AuditEntry[]>(AUDIT_FILE, []).slice(-limit).reverse();
}
