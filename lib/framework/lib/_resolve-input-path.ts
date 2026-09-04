import { constants as fsConstants } from "node:fs";
import { access, open } from "node:fs/promises";
import { extname, isAbsolute, resolve as resolvePath } from "node:path";
import { homedir } from "node:os";

export type InputFileCategory = "pdf" | "image" | "other";

export interface ResolvedInputPath {
  sourcePath: string;
  resolvedPath: string;
  extension: string;
  category: InputFileCategory;
}

export interface ResolveInputPathOptions {
  cwd: string;
  requireReadable?: boolean;
}

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
const NARROW_NO_BREAK_SPACE = "\u202F";
const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".tiff",
  ".tif",
  ".webp",
  ".svg",
]);

function normalizePathInput(input: string): string {
  return input.trim().replace(/^@/, "").replace(UNICODE_SPACES, " ");
}

function expandHomeDirectory(filePath: string): string {
  if (filePath === "~") return homedir();
  if (filePath.startsWith("~/")) return `${homedir()}${filePath.slice(1)}`;
  return filePath;
}

function macOsAmPmVariant(filePath: string): string {
  return filePath.replace(/ (AM|PM)\./g, `${NARROW_NO_BREAK_SPACE}$1.`);
}

function curlyQuoteVariant(filePath: string): string {
  return filePath.replace(/'/g, "\u2019");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveExistingPath(filePath: string, cwd: string): Promise<string> {
  const expanded = expandHomeDirectory(filePath);
  const resolved = isAbsolute(expanded) ? expanded : resolvePath(cwd, expanded);
  const nfd = resolved.normalize("NFD");

  for (const candidate of new Set([
    resolved,
    macOsAmPmVariant(resolved),
    nfd,
    curlyQuoteVariant(resolved),
    curlyQuoteVariant(nfd),
  ])) {
    if (await pathExists(candidate)) return candidate;
  }

  return resolved;
}

async function ensureReadableFile(filePath: string, sourcePath: string): Promise<void> {
  try {
    await access(filePath, fsConstants.R_OK);
  } catch {
    throw new Error(`File not found or not readable: ${sourcePath}`);
  }
}

async function readHeader(filePath: string, length: number): Promise<Buffer> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function categoryFromExtension(extension: string): InputFileCategory | undefined {
  if (extension === ".pdf") return "pdf";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  return undefined;
}

function isPdfHeader(header: Buffer): boolean {
  return header.length >= 4 && header.toString("utf8", 0, 4) === "%PDF";
}

function isPngHeader(header: Buffer): boolean {
  return (
    header.length >= 4 &&
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47
  );
}

function isJpegHeader(header: Buffer): boolean {
  return header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
}

async function inspectFile(filePath: string): Promise<{
  extension: string;
  category: InputFileCategory;
}> {
  const extension = extname(filePath).toLowerCase();
  const category = categoryFromExtension(extension);
  if (category) return { extension, category };

  try {
    const header = await readHeader(filePath, 16);
    if (isPdfHeader(header)) return { extension: extension || ".pdf", category: "pdf" };
    if (!extension && isPngHeader(header)) return { extension: ".png", category: "image" };
    if (!extension && isJpegHeader(header)) return { extension: ".jpg", category: "image" };
  } catch {
    // Best-effort inspection. Readability is validated separately.
  }

  return { extension, category: "other" };
}

export async function resolveInputPath(
  input: string,
  options: ResolveInputPathOptions,
): Promise<ResolvedInputPath> {
  const sourcePath = normalizePathInput(input);
  const resolvedPath = await resolveExistingPath(sourcePath, options.cwd);

  if (options.requireReadable ?? true) {
    await ensureReadableFile(resolvedPath, sourcePath);
  }

  const inspection = await inspectFile(resolvedPath);
  return { sourcePath, resolvedPath, ...inspection };
}
