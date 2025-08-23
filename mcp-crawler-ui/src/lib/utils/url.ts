import fs from "node:fs";
import path from "node:path";
import normalizeUrl, { type Options as NormalizeOptions } from "normalize-url";

const IGNORE_LIST_PATH = path.resolve(process.cwd(), "data/ignore-extensions.txt");
const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
]);

let ignoredExt: string[] = [];
try {
  if (fs.existsSync(IGNORE_LIST_PATH)) {
    ignoredExt = fs
      .readFileSync(IGNORE_LIST_PATH, "utf8")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }
} catch {}

export function stripTrackingParams(u: URL) {
  for (const p of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(p)) u.searchParams.delete(p);
  }
}

const NORMALIZE_OPTS: NormalizeOptions = {
  // OJO: no usar stripFragment (no existe en tus tipos).
  removeDirectoryIndex: true,
  sortQueryParameters: true,
  removeTrailingSlash: true,
  stripWWW: false,
  forceHttp: false,
  forceHttps: false,
};

export function normalizeForKey(urlStr: string): string {
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    return urlStr;
  }

  // Normalizaciones manuales seguras para los tipos
  u.host = u.host.toLowerCase();
  u.hash = ""; // elimina el fragmento (#...)
  stripTrackingParams(u);

  // Normaliza con opciones válidas según los tipos instalados
  const normalized = normalizeUrl(u.toString(), NORMALIZE_OPTS);

  const u2 = new URL(normalized);
  u2.host = u2.host.toLowerCase(); // asegura host en minúsculas
  return u2.toString();
}

export function sameETLD1(a: URL, b: URL) {
  return a.hostname.split(".").slice(-2).join(".") === b.hostname.split(".").slice(-2).join(".");
}

export function isInternal(base: URL, target: URL, includeSubdomains = false) {
  if (!sameETLD1(base, target)) return false;
  if (!includeSubdomains) {
    return base.hostname === target.hostname;
  }
  return true;
}

export function hasIgnoredExtension(u: URL) {
  const ext = path.extname(u.pathname).toLowerCase();
  if (!ext) return false;
  const stripped = ext.replace(/^\./, "");
  return ignoredExt.includes(stripped) || ignoredExt.includes(ext);
}

export function absolutize(base: URL, href: string) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}
