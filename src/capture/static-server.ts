import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, relative, resolve, sep } from "node:path";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
};

const insideRoot = (root: string, file: string): boolean => {
  const value = relative(root, file);
  return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !value.startsWith(sep));
};

export const startStaticServer = async (
  dir: string,
  port = 0,
): Promise<{ url: string; port: number; stop: () => Promise<void> }> => {
  const root = await realpath(resolve(dir));
  const rootStats = await stat(root);
  if (!rootStats.isDirectory()) throw new Error(`Static server root is not a directory: ${root}`);

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const pathname = decodeURIComponent(url.pathname);
      const requested = resolve(root, `.${pathname}`);
      if (!insideRoot(root, requested)) {
        response.writeHead(404).end("Not found");
        return;
      }

      let file = await realpath(requested).catch(() => null);
      if (!file || !insideRoot(root, file)) {
        response.writeHead(404).end("Not found");
        return;
      }
      let fileStats = await stat(file).catch(() => null);
      if (fileStats?.isDirectory()) {
        const index = await realpath(resolve(file, "index.html")).catch(() => null);
        if (!index || !insideRoot(root, index)) {
          response.writeHead(404).end("Not found");
          return;
        }
        file = index;
        fileStats = await stat(file).catch(() => null);
      }
      if (!fileStats?.isFile()) {
        response.writeHead(404).end("Not found");
        return;
      }

      response.writeHead(200, {
        "content-type": MIME_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
        "content-length": fileStats.size,
      });
      if (request.method === "HEAD") response.end();
      else createReadStream(file).pipe(response);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });

  await new Promise<void>((accept, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      accept();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Static server did not bind a TCP port");
  let stopped = false;
  return {
    url: `http://127.0.0.1:${address.port}`,
    port: address.port,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await new Promise<void>((accept, reject) => server.close((error) => error ? reject(error) : accept()));
    },
  };
};
