import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { detectDevServer, detectFramework, detectPackageManager, detectRoutes } from "../src/init/detect.js";

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "design-gate-detect-"));
}

function write(cwd: string, relative: string, contents = ""): void {
  const file = path.join(cwd, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents, "utf8");
}

describe("project detection", () => {
  it("detects a Next app router project, pnpm, custom port, and static routes", async () => {
    const cwd = await tempProject();
    write(cwd, "package.json", JSON.stringify({
      scripts: { dev: "next dev -p 3100" },
      dependencies: { next: "15.0.0", react: "19.0.0" },
    }));
    write(cwd, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
    write(cwd, "app/page.tsx");
    write(cwd, "app/pricing/page.tsx");
    write(cwd, "app/(marketing)/about/page.tsx");
    write(cwd, "app/blog/[slug]/page.tsx");

    const framework = detectFramework(cwd);
    const packageManager = detectPackageManager(cwd);
    const server = detectDevServer(cwd, framework, packageManager);
    expect(framework).toEqual({ framework: "next", router: "app" });
    expect(packageManager).toBe("pnpm");
    expect(server.url).toBe("http://localhost:3100");
    expect(server.command).toBe("pnpm run dev");
    expect(detectRoutes(cwd, framework)).toEqual(["/", "/about", "/pricing"]);
  });

  it("detects a Vite React project and its default port", async () => {
    const cwd = await tempProject();
    write(cwd, "package.json", JSON.stringify({
      scripts: { dev: "vite" },
      dependencies: { react: "19.0.0" },
      devDependencies: { vite: "7.0.0" },
    }));
    write(cwd, "package-lock.json", "{}");

    const framework = detectFramework(cwd);
    expect(framework).toEqual({ framework: "vite" });
    expect(detectPackageManager(cwd)).toBe("npm");
    expect(detectDevServer(cwd, framework, "npm").url).toBe("http://localhost:5173");
  });

  it("detects a static site, its routes, and the serve command", async () => {
    const cwd = await tempProject();
    write(cwd, "index.html", "<!doctype html>");
    write(cwd, "pricing.html", "<!doctype html>");

    const framework = detectFramework(cwd);
    const server = detectDevServer(cwd, framework, "npm");
    expect(framework).toEqual({ framework: "static" });
    expect(detectRoutes(cwd, framework)).toEqual(["/", "/pricing.html"]);
    expect(server.command).toBe("design-gate serve . --port 4173");
    expect(server.note).toMatch(/static/i);
  });
});
