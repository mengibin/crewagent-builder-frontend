export type AssetListItem = {
  path: string;
  content: string;
  bytes: number;
};

export type AssetsJsonParseResult = {
  assets: AssetListItem[];
  map: Record<string, string>;
  totalBytes: number;
  error: string | null;
};

export function parseAssetsJson(raw: string): AssetsJsonParseResult {
  const trimmed = raw?.trim();
  if (!trimmed) return { assets: [], map: {}, totalBytes: 0, error: null };

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { assets: [], map: {}, totalBytes: 0, error: "Invalid assetsJson format (expected an object)." };
    }

    const map: Record<string, string> = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([keyRaw, value]) => {
      if (typeof value !== "string") return;
      const key = keyRaw.trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
      if (!key.startsWith("assets/")) return;
      if (key.split("/").some((part) => part === "" || part === "." || part === "..")) return;
      map[key] = value;
    });

    const encoder = new TextEncoder();
    const assets = Object.keys(map)
      .sort((a, b) => a.localeCompare(b))
      .map((path) => {
        const content = map[path] ?? "";
        const bytes = encoder.encode(content).length;
        return { path, content, bytes };
      });
    const totalBytes = assets.reduce((sum, item) => sum + item.bytes, 0);
    return { assets, map, totalBytes, error: null };
  } catch {
    return { assets: [], map: {}, totalBytes: 0, error: "Failed to parse assetsJson (invalid JSON)." };
  }
}

const ASSET_PATH_PATTERN = /^[A-Za-z0-9._/-]+$/;
const ALLOWED_ASSET_EXTENSIONS = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".py"]);

export function normalizeAssetsPath(input: string): { value: string | null; error: string | null } {
  const raw = input.trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (!raw) return { value: null, error: "path cannot be empty." };
  if (raw.startsWith("/")) return { value: null, error: "path must be a relative path." };
  if (!raw.startsWith("assets/")) return { value: null, error: "path must start with assets/." };
  if (raw.endsWith("/")) return { value: null, error: "path must be a file path (must not end with /)." };
  if (raw.includes("\u0000")) return { value: null, error: "path must not contain a null character." };
  if (!ASSET_PATH_PATTERN.test(raw))
    return { value: null, error: "path contains invalid characters (allowed: A-Z a-z 0-9 . _ / -)." };
  if (raw.split("/").some((part) => part === "" || part === "." || part === ".."))
    return { value: null, error: "path must not contain '.' or '..' segments." };
  const dot = raw.lastIndexOf(".");
  const ext = dot >= 0 ? raw.slice(dot).toLowerCase() : "";
  if (!ALLOWED_ASSET_EXTENSIONS.has(ext)) {
    return {
      value: null,
      error: `Unsupported extension: ${ext || "(none)"} (allowed: ${Array.from(ALLOWED_ASSET_EXTENSIONS).join(" ")})`,
    };
  }
  return { value: raw, error: null };
}

export function toRuntimeAssetPath(zipPath: string): string {
  const cleaned = zipPath.trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
  return cleaned.startsWith("assets/") ? `@pkg/${cleaned}` : `@pkg/assets/${cleaned.replace(/^\/+/, "")}`;
}
