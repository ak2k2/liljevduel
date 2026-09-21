// serves the files and forwards jev calls to api.typesafe.ai (it sends no cors headers). key from the browser or .env.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 8787);
let envKey = process.env.TYPESAFE_API_KEY ?? "";
try {
  envKey ||= (await readFile(join(root, ".env"), "utf8")).match(/TYPESAFE_API_KEY=(\S+)/)?.[1] ?? "";
} catch {}
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".md": "text/plain",
};

createServer(async (req, res) => {
  if (req.url === "/api/systemone" && req.method === "POST") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const r = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { authorization: req.headers.authorization || "Bearer " + envKey, "content-type": "application/json" },
      body: Buffer.concat(chunks),
    });
    res.writeHead(r.status, { "content-type": "application/json" });
    res.end(await r.text());
    return;
  }
  const path = new URL(req.url, "http://x").pathname,
    file = normalize(path === "/" ? "index.html" : path.slice(1));
  try {
    if (file.startsWith("..") || file === ".env") throw new Error("nope");
    const body = await readFile(join(root, file));
    res.writeHead(200, {
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(port, () => console.log(`liljevduel on http://localhost:${port}`));
