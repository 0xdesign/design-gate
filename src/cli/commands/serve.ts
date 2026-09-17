import { resolve } from "node:path";

import { startStaticServer } from "../../capture/static-server.js";

export const serve = async (directory: string, port: number): Promise<void> => {
  const server = await startStaticServer(resolve(process.cwd(), directory), port);
  process.stdout.write(`${server.url}\n`);
  await new Promise<void>((accept) => {
    const stop = (): void => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      void server.stop().finally(accept);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
};
