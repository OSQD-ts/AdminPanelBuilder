/**
 * The theme playground on http://127.0.0.1:9786/ — every theme, light and dark, with contrast
 * measured. See src/render/playground.ts.
 *
 *   npm run playground
 */
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { themePlaygroundHtml } from "../src/index.js";

const server = createServer((_request, response) => {
  const nonce = randomBytes(16).toString("base64");
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'` });
  response.end(themePlaygroundHtml(undefined, nonce));
});
server.listen(Number(process.env.PORT ?? 9786), "127.0.0.1", () => console.log("http://127.0.0.1:9786/"));
