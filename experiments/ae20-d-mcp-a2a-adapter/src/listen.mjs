import { writeFile } from "node:fs/promises";

export function listen(server, { port = 0, urlFile = "", basePath = "" } = {}) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", async () => {
      const address = server.address();
      const url = `http://127.0.0.1:${address.port}${basePath}`;
      if (urlFile) await writeFile(urlFile, `${url}\n`);
      resolve(url);
    });
  });
}
