#!/usr/bin/env node
// A page and a small API on http://127.0.0.1:4173, for a task whose completion check reads network traffic (requestSeen, responseSeen).
// Run it, then in another terminal: npx rawstep run node_modules/rawstep/examples/api/api-cart.json --profile item-by-item
import { createServer } from 'node:http';

const page = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Demo mug - Demo shop</title></head>
  <body>
    <main>
      <h1>Demo mug</h1>
      <p>$12</p>
      <button id="add" type="button">Add to cart</button>
      <p id="status" role="status"></p>
    </main>
    <script>
      document.getElementById("add").addEventListener("click", async () => {
        const response = await fetch("/api/cart", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ item: "Demo mug" }) });
        document.getElementById("status").textContent = response.status === 201 ? "Added to cart" : "Could not add to cart";
      });
    </script>
  </body>
</html>`;

const port = Number(process.env.PORT ?? 4173);
createServer((request, response) => {
  if (request.method === 'POST' && request.url === '/api/cart') { request.resume(); response.writeHead(201, { 'content-type': 'application/json' }).end('{"items":1}'); return; }
  if (request.method === 'GET' && request.url === '/') { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page); return; }
  response.writeHead(404).end();
}).listen(port, '127.0.0.1', () => console.log(`Demo shop API example: http://127.0.0.1:${port}/ (Ctrl+C stops it)`));
