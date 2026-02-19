import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const indexPath = path.join(__dirname, "index.html");
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3000);

const server = http.createServer(async (req, res) => {
  if (!req.url || req.url === "/" || req.url === "/index.html" || req.url === "/keccak") {
    try {
      const html = await fs.readFile(indexPath, "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Unable to load index.html");
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(port, host, () => {
  console.log(`Keccak app listening on http://${host}:${port}`);
});
