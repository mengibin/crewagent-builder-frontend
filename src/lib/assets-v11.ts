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
      return { assets: [], map: {}, totalBytes: 0, error: "assetsJson 格式不正确（应为 object）" };
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
    return { assets: [], map: {}, totalBytes: 0, error: "assetsJson 解析失败（非法 JSON）" };
  }
}

const ASSET_PATH_PATTERN = /^[A-Za-z0-9._/-]+$/;
const ALLOWED_ASSET_EXTENSIONS = new Set([".md", ".txt", ".json", ".yaml", ".yml"]);

export function normalizeAssetsPath(input: string): { value: string | null; error: string | null } {
  const raw = input.trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (!raw) return { value: null, error: "path 不能为空" };
  if (raw.startsWith("/")) return { value: null, error: "path 必须是相对路径" };
  if (!raw.startsWith("assets/")) return { value: null, error: "path 必须以 assets/ 开头" };
  if (raw.endsWith("/")) return { value: null, error: "path 必须是文件路径（不能以 / 结尾）" };
  if (raw.includes("\u0000")) return { value: null, error: "path 不能包含空字符" };
  if (!ASSET_PATH_PATTERN.test(raw)) return { value: null, error: "path 含非法字符（仅允许 A-Z a-z 0-9 . _ / -）" };
  if (raw.split("/").some((part) => part === "" || part === "." || part === "..")) return { value: null, error: "path 不能包含 . 或 .." };
  const dot = raw.lastIndexOf(".");
  const ext = dot >= 0 ? raw.slice(dot).toLowerCase() : "";
  if (!ALLOWED_ASSET_EXTENSIONS.has(ext)) {
    return {
      value: null,
      error: `不支持的扩展名：${ext || "(none)"}（仅支持 ${Array.from(ALLOWED_ASSET_EXTENSIONS).join(" ")}）`,
    };
  }
  return { value: raw, error: null };
}

export function toRuntimeAssetPath(zipPath: string): string {
  const cleaned = zipPath.trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
  return cleaned.startsWith("assets/") ? `@pkg/${cleaned}` : `@pkg/assets/${cleaned.replace(/^\/+/, "")}`;
}

