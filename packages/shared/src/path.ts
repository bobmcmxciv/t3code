export function isWindowsDrivePath(value: string): boolean {
  return /^[a-zA-Z]:([/\\]|$)/.test(value);
}

export function isUncPath(value: string): boolean {
  return value.startsWith("\\\\");
}

/**
 * Windows treats `/` and `\` alike, so any two leading separators name a UNC
 * or device path. Touching one makes Windows sign in to that host with the
 * user's NTLM credentials, so agent-authored paths must not reach one.
 */
export function isNetworkPath(value: string): boolean {
  return /^[\\/]{2}/.test(value);
}

/** A `\\wsl.localhost\<distro>` or `\\wsl$\<distro>` share: a WSL distro's files seen from Windows over 9P. */
export function isWslSharePath(value: string): boolean {
  return /^[\\/]{2}(?:[?.][\\/]UNC[\\/])?wsl(?:\.localhost|\$)[\\/]/i.test(value.trim());
}

export function isWindowsAbsolutePath(value: string): boolean {
  return isUncPath(value) || isWindowsDrivePath(value);
}

export function isExplicitRelativePath(value: string): boolean {
  return (
    value === "." ||
    value === ".." ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith(".\\") ||
    value.startsWith("..\\")
  );
}

function isRootPath(value: string): boolean {
  // Bare C: means the current directory on C, not its root; require the drive separator.
  return value === "/" || value === "\\" || /^[a-zA-Z]:[/\\]$/.test(value);
}

function trimTrailingPathSeparators(value: string): string {
  if (value.length === 0 || isRootPath(value)) {
    return value;
  }
  const trimmed = value.startsWith("/")
    ? value.replace(/\/+$/g, "")
    : value.replace(/[\\/]+$/g, "");
  if (trimmed.length === 0) {
    return value;
  }
  return /^[a-zA-Z]:$/.test(trimmed) ? `${trimmed}\\` : trimmed;
}

export function normalizeProjectPathForDispatch(value: string): string {
  return trimTrailingPathSeparators(value.trim());
}

export function normalizeProjectPathForComparison(value: string): string {
  const normalized = normalizeProjectPathForDispatch(value);
  if (isWindowsDrivePath(normalized) || isUncPath(normalized)) {
    return normalized.replaceAll("/", "\\").toLowerCase();
  }
  return normalized;
}

// Windows refuses these as file names, with or without an extension.
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

// Latin letters NFKD leaves whole (ł, ø, ß) or splits with a spacing mark (Ŀ, ŉ).
const LATIN_FOLDS: Record<string, string> = {
  Ŀ: "L",
  ŀ: "l",
  ŉ: "n",
  Đ: "D",
  đ: "d",
  Ð: "D",
  ð: "d",
  ß: "ss",
  ẞ: "SS",
  Ł: "L",
  ł: "l",
  Ø: "O",
  ø: "o",
  Æ: "AE",
  æ: "ae",
  Œ: "OE",
  œ: "oe",
  Þ: "TH",
  þ: "th",
  Ħ: "H",
  ħ: "h",
  ı: "i",
  ĸ: "q",
  Ŋ: "N",
  ŋ: "n",
  Ŧ: "T",
  ŧ: "t",
};
const LATIN_FOLD_PATTERN = new RegExp(`[${Object.keys(LATIN_FOLDS).join("")}]`, "g");

/** Folds accented Latin letters to ASCII ("tìm" -> "tim"); other scripts pass through. */
export function foldLatinDiacritics(text: string): string {
  return text
    .replace(LATIN_FOLD_PATTERN, (letter) => LATIN_FOLDS[letter] ?? letter)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function newProjectFolderName(name: string): string {
  const slug = foldLatinDiacritics(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 64)
    .replace(/-+$/, "");
  if (slug.length === 0) return "project";
  return WINDOWS_RESERVED_NAME.test(slug) ? `${slug}-project` : slug;
}

const SLASH_PREFIXED_WINDOWS_DRIVE_PATTERN = /^\/[A-Za-z]:[\\/]/;

/** Browser URL parsers write `C:/foo` as `/C:/foo` for file URLs. */
export function stripSlashPrefixedWindowsDrive(path: string): string {
  return SLASH_PREFIXED_WINDOWS_DRIVE_PATTERN.test(path) ? path.slice(1) : path;
}

export function fileBasename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  if (trimmed.length === 0) return path;
  const separatorIndex = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return separatorIndex >= 0 ? trimmed.slice(separatorIndex + 1) : trimmed;
}

/** A path's last segment composed to NFC for display: macOS stores many names in NFD. */
export function fileDisplayName(path: string): string {
  return fileBasename(path).normalize("NFC");
}

export function workspaceRelativeFilePath(
  path: string,
  workspaceRoot: string | null | undefined,
): string | null {
  if (!workspaceRoot) return null;
  const caseInsensitive =
    isWindowsAbsolutePath(stripSlashPrefixedWindowsDrive(workspaceRoot)) ||
    (isNetworkPath(workspaceRoot) && isUncPath(path));
  const normalizedPath = caseInsensitive
    ? stripSlashPrefixedWindowsDrive(path.replaceAll("\\", "/"))
    : path;
  const normalizedRoot = (
    caseInsensitive
      ? stripSlashPrefixedWindowsDrive(workspaceRoot.replaceAll("\\", "/"))
      : workspaceRoot
  ).replace(/\/+$/, "");
  const pathForCompare = caseInsensitive ? normalizedPath.toLowerCase() : normalizedPath;
  const rootForCompare = caseInsensitive ? normalizedRoot.toLowerCase() : normalizedRoot;
  if (pathForCompare.replace(/\/+$/, "") === rootForCompare) return ".";
  if (!pathForCompare.startsWith(`${rootForCompare}/`)) return null;
  const relativePath = normalizedPath.slice(normalizedRoot.length + 1);
  // `/repo/../x` starts with the root but escapes it; the server rejects that as a workspace path.
  let depth = 0;
  for (const segment of relativePath.split("/")) {
    if (segment === "..") depth -= 1;
    else if (segment.length > 0 && segment !== ".") depth += 1;
    if (depth < 0) return null;
  }
  return relativePath;
}

export function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || isWindowsAbsolutePath(value);
}

/** Both ~/ and ~\ home prefixes are expanded by the destination server. */
export function isHostPath(value: string): boolean {
  return isAbsolutePath(value) || value.startsWith("~/") || value.startsWith("~\\");
}

// Finder and Explorer copy a path ready for a shell: `'/a b'`, `/a\'s\ b`, or `"C:\a b"`.
const QUOTED_PATH_AT_END = /(?:'((?:[^']|'\\'')+)'|"([^"]+)")\s*$/;
const SHELL_ESCAPE = /\\([\s'"\\()[\]{}<>|&;$`!*?#~^=])/g;

// Folder browsers only navigate `~/` home paths, so a pasted `~\` path is not a replacement.
function isPastedFolderPath(value: string): boolean {
  return isAbsolutePath(value) || value.startsWith("~/");
}

/**
 * What a folder box holds after a change. A full path pasted into it replaces the box, even after
 * the text already there, because `~/'/a b'` would create that nested folder.
 */
export function resolvePastedPath(previous: string, next: string): string {
  const isTyping = next.startsWith(previous)
    ? next.length === previous.length + 1
    : previous.startsWith(next);
  if (isTyping) return next;

  const match = QUOTED_PATH_AT_END.exec(next);
  // Text before the quote that wasn't in the box is a search, not a folder to paste after.
  if (match && previous.startsWith(next.slice(0, match.index).trimEnd())) {
    const quoted = match[1]?.replaceAll("'\\''", "'") ?? match[2] ?? "";
    if (isPastedFolderPath(quoted)) return quoted;
  }

  // Without a trailing separator, `/a` then `/a/b` is a longer path, not one pasted after a folder.
  const afterFolder = /[/\\]$/.test(previous) && next.startsWith(previous);
  const path = afterFolder ? next.slice(previous.length) : next;
  if (!isPastedFolderPath(path)) return next;
  // `\` separates folders in Windows paths, so it only escapes in `/` and `~/` paths.
  return isWindowsAbsolutePath(path) ? path : path.replace(SHELL_ESCAPE, "$1");
}

export function resolveWorkspaceFilePath(path: string, workspaceRoot: string): string {
  if (isAbsolutePath(path) || path.startsWith("~/") || path.startsWith("~\\")) return path;
  const base = workspaceRoot.replace(/[/\\]+$/, "");
  return isWindowsAbsolutePath(workspaceRoot)
    ? `${base}\\${path.replaceAll("/", "\\")}`
    : `${base}/${path}`;
}

export interface QuickBrowsePathOption {
  readonly path: string;
  readonly label: string;
}

export interface BrowsePathBreadcrumb {
  readonly label: string;
  readonly path: string;
}

function parentDirectoryOf(rawPath: string): string | null {
  const trimmed = trimTrailingPathSeparators(rawPath.trim());
  if (trimmed.length === 0 || isRootPath(trimmed) || trimmed === "~") {
    return null;
  }
  const lastSep = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (lastSep < 0) return null;
  if (lastSep === 0) return "/";
  const parent = trimmed.slice(0, lastSep);
  if (/^[a-zA-Z]:$/.test(parent)) {
    return `${parent}\\`;
  }
  return parent;
}

function ensureTrailingBrowseSeparator(path: string, isWindows: boolean): string {
  if (path === "~") return isWindows ? "~\\" : "~/";
  if (path.endsWith("/") || path.endsWith("\\")) return path;
  return isWindows || isWindowsDrivePath(path) ? `${path}\\` : `${path}/`;
}

/**
 * Derive quick-jump directory shortcuts for a machine's folder browser:
 * 1. Most-used parent directories of existing projects on that host
 * 2. Configured base directory (`addProjectBaseDirectory`)
 * 3. Home (`~`) and Windows drive roots (`C:\`, `D:\`, ...)
 */
export function deriveQuickBrowsePaths(input: {
  readonly projectWorkspaceRoots: ReadonlyArray<string>;
  readonly baseDirectory?: string | null | undefined;
  readonly isWindows: boolean;
  readonly maxItems?: number;
}): ReadonlyArray<QuickBrowsePathOption> {
  const maxItems = input.maxItems ?? 8;
  const counts = new Map<string, { path: string; count: number }>();
  const drives = new Set<string>();

  for (const root of input.projectWorkspaceRoots) {
    const trimmed = root.trim();
    if (!trimmed) continue;
    if (isWindowsDrivePath(trimmed)) {
      drives.add(`${trimmed[0]!.toUpperCase()}:\\`);
    }
    const parent = parentDirectoryOf(trimmed);
    if (!parent) continue;
    const normKey = normalizeProjectPathForComparison(parent);
    const existing = counts.get(normKey);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(normKey, { path: parent, count: 1 });
    }
  }

  const rankedParents = [...counts.values()]
    .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
    .map((entry) => entry.path);

  const candidates: Array<{ path: string; label?: string }> = [];
  for (const parent of rankedParents) {
    candidates.push({ path: parent });
  }
  if (input.baseDirectory && input.baseDirectory.trim().length > 0) {
    candidates.push({ path: input.baseDirectory.trim() });
  }
  candidates.push({ path: "~", label: "~ (Home)" });
  if (input.isWindows) {
    for (const drive of [...drives].sort()) {
      candidates.push({ path: drive, label: drive });
    }
    if (!drives.has("C:\\")) candidates.push({ path: "C:\\", label: "C:\\" });
    if (!drives.has("D:\\")) candidates.push({ path: "D:\\", label: "D:\\" });
  } else {
    candidates.push({ path: "/", label: "/" });
  }

  const seen = new Set<string>();
  const options: QuickBrowsePathOption[] = [];
  for (const candidate of candidates) {
    const browsePath = ensureTrailingBrowseSeparator(candidate.path, input.isWindows);
    const dedupeKey =
      candidate.path === "~" ? "~" : normalizeProjectPathForComparison(candidate.path);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const cleanDisplay = trimTrailingPathSeparators(candidate.path);
    options.push({
      path: browsePath,
      label: candidate.label ?? (cleanDisplay.length > 0 ? cleanDisplay : candidate.path),
    });
    if (options.length >= maxItems) break;
  }
  return options;
}

/** Split an absolute or home-relative directory path into clickable cumulative breadcrumbs. */
export function splitBrowsePathBreadcrumbs(
  rawPath: string,
  isWindows: boolean,
): ReadonlyArray<BrowsePathBreadcrumb> {
  const trimmed = rawPath.trim();
  if (trimmed.length === 0) return [];
  const sep = isWindows || isWindowsDrivePath(trimmed) ? "\\" : "/";

  if (trimmed === "~" || trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    const rest = trimmed.slice(1).replace(/^[\\/]+/, "").replace(/[\\/]+$/, "");
    const crumbs: BrowsePathBreadcrumb[] = [{ label: "~", path: `~${sep}` }];
    if (!rest) return crumbs;
    let acc = "~";
    for (const part of rest.split(/[\\/]+/).filter(Boolean)) {
      acc = `${acc}${sep}${part}`;
      crumbs.push({ label: part, path: `${acc}${sep}` });
    }
    return crumbs;
  }

  const driveMatch = /^([a-zA-Z]:)(?:[\\/](.*))?$/.exec(trimmed);
  if (driveMatch) {
    const drive = driveMatch[1]!.toUpperCase();
    const rest = (driveMatch[2] ?? "").replace(/[\\/]+$/, "");
    const crumbs: BrowsePathBreadcrumb[] = [{ label: `${drive}\\`, path: `${drive}\\` }];
    if (!rest) return crumbs;
    let acc = drive;
    for (const part of rest.split(/[\\/]+/).filter(Boolean)) {
      acc = `${acc}\\${part}`;
      crumbs.push({ label: part, path: `${acc}\\` });
    }
    return crumbs;
  }

  if (trimmed.startsWith("/")) {
    const rest = trimmed.slice(1).replace(/\/+$/, "");
    const crumbs: BrowsePathBreadcrumb[] = [{ label: "/", path: "/" }];
    if (!rest) return crumbs;
    let acc = "";
    for (const part of rest.split("/").filter(Boolean)) {
      acc = `${acc}/${part}`;
      crumbs.push({ label: part, path: `${acc}/` });
    }
    return crumbs;
  }

  return [];
}
