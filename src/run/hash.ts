import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

function escapeRegex(character: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(character) ? `\\${character}` : character;
}

function compileGlob(glob: string): string {
  let result = "";
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index] ?? "";
    if (character === "*") {
      if (glob[index + 1] === "*") {
        index += 1;
        if (glob[index + 1] === "/") {
          index += 1;
          result += "(?:.*/)?";
        } else {
          result += ".*";
        }
      } else {
        result += "[^/]*";
      }
    } else if (character === "?") {
      result += "[^/]";
    } else if (character === "{") {
      const close = glob.indexOf("}", index + 1);
      if (close === -1) {
        result += "\\{";
      } else {
        const alternatives = glob.slice(index + 1, close).split(",").map(compileGlob);
        result += `(?:${alternatives.join("|")})`;
        index = close;
      }
    } else {
      result += escapeRegex(character);
    }
  }
  return result;
}

export function globToRegex(glob: string): RegExp {
  return new RegExp(`^${compileGlob(glob.replaceAll("\\", "/"))}$`);
}

function normalizedRelative(cwd: string, path: string): string {
  return relative(cwd, path).split(sep).join("/");
}

export function listUiFiles(
  cwd: string,
  globs: string[],
  ignore = ["node_modules", ".git", "dist", ".next", "build", ".design-gate"],
): string[] {
  const root = resolve(cwd);
  const patterns = globs.map(globToRegex);
  const ignored = new Set(ignore.map((entry) => entry.replaceAll("\\", "/").replace(/^\.\//, "")));
  const files: string[] = [];

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      const rel = normalizedRelative(root, path);
      const isIgnored = [...ignored].some((name) =>
        rel === name || rel.startsWith(`${name}/`) || rel.split("/").includes(name),
      );
      if (isIgnored) continue;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && patterns.some((pattern) => pattern.test(rel))) files.push(rel);
    }
  };

  walk(root);
  return files.sort((left, right) => left.localeCompare(right));
}

export function fileHashes(cwd: string, files: string[]): Record<string, string> {
  const root = resolve(cwd);
  return Object.fromEntries(
    [...files]
      .map((file) => isAbsolute(file) ? normalizedRelative(root, file) : file.replaceAll("\\", "/"))
      .sort((left, right) => left.localeCompare(right))
      .map((file) => [
        file,
        createHash("sha256").update(readFileSync(resolve(root, file))).digest("hex"),
      ]),
  );
}

export function uiHash(hashes: Record<string, string>): string {
  const entries = Object.entries(hashes).sort(([left], [right]) => left.localeCompare(right));
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

export function changedFiles(
  previous: Record<string, string>,
  next: Record<string, string>,
): string[] {
  return [...new Set([...Object.keys(previous), ...Object.keys(next)])]
    .filter((file) => previous[file] !== next[file])
    .sort((left, right) => left.localeCompare(right));
}
