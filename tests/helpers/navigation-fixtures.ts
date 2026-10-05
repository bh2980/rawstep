// Historical HTTP fixtures retained verbatim for the new browser boundary.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
export async function createNavigationFixtureServers(): Promise<{
  baseUrl: string;
  externalUrl: string;
  close(): Promise<void>;
}> {
  let baseUrl = "";
  let externalUrl = "";

  const externalServer = createServer((req, res) => {
    const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html><head><title>External ${requestUrl.pathname}</title></head><body><h1>External ${requestUrl.pathname}</h1></body></html>`);
  });
  await listenServer(externalServer);
  externalUrl = getServerUrl(externalServer);

  const mainServer = createServer((req, res) => {
    const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    const html = renderNavigationFixturePage(requestUrl.pathname, baseUrl, externalUrl);
    if (!html) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "content-type": requestUrl.pathname.endsWith(".js")
        ? "application/javascript; charset=utf-8"
        : "text/html; charset=utf-8"
    });
    res.end(html);
  });
  await listenServer(mainServer);
  baseUrl = getServerUrl(mainServer);

  return {
    baseUrl,
    externalUrl,
    close: async () => {
      await closeServer(mainServer);
      await closeServer(externalServer);
    }
  };
}

function renderNavigationFixturePage(pathname: string, baseUrl: string, externalUrl: string): string | undefined {
  const pages: Record<string, string> = {
    "/same-origin-guard-start": `<!doctype html>
      <html><head><title>Same Origin Guard Start</title></head>
      <body>
        <a href="${externalUrl}/outside" id="external-link">External link</a>
        <a href="${baseUrl}/same-origin-target?from=start#done" id="same-origin-link">Same origin target</a>
      </body></html>`,
    "/same-origin-allowed-start": `<!doctype html>
      <html><head><title>Same Origin Allowed Start</title></head>
      <body>
        <a href="${baseUrl}/same-origin-target?from=start#done" id="same-origin-link">Same origin target</a>
      </body></html>`,
    "/same-origin-target": `<!doctype html>
      <html><head><title>Same Origin Target</title></head>
      <body><h1>Same Origin Target</h1></body></html>`,
    "/prefix/start": `<!doctype html>
      <html><head><title>Prefix Start</title></head>
      <body>
        <a href="${baseUrl}/prefix-outside" id="prefix-blocked-link">Prefix blocked</a>
        <a href="${baseUrl}/prefix/start/next" id="prefix-allowed-link">Prefix allowed</a>
      </body></html>`,
    "/prefix/start/next": `<!doctype html>
      <html><head><title>Prefix Allowed</title></head>
      <body><h1>Prefix Allowed</h1></body></html>`,
    "/prefix-outside": `<!doctype html>
      <html><head><title>Prefix Outside</title></head>
      <body><h1>Prefix Outside</h1></body></html>`,
    "/allow-list-start": `<!doctype html>
      <html><head><title>Allow List Start</title></head>
      <body>
        <a href="${baseUrl}/allow-unlisted" id="allow-unlisted-link">Allow unlisted</a>
        <a href="${baseUrl}/allow-listed/next" id="allow-listed-link">Allow listed</a>
      </body></html>`,
    "/allow-listed/next": `<!doctype html>
      <html><head><title>Allow Listed</title></head>
      <body><h1>Allow Listed</h1></body></html>`,
    "/allow-unlisted": `<!doctype html>
      <html><head><title>Allow Unlisted</title></head>
      <body><h1>Allow Unlisted</h1></body></html>`,
    "/assign-start": `<!doctype html>
      <html><head><title>Assign Start</title></head>
      <body>
        <button type="button" id="assign-blocked-button" onclick="window.location.assign('${externalUrl}/assign-outside')">Assign blocked</button>
        <a href="${baseUrl}/same-origin-target?from=assign#done" id="assign-fallback-link">Fallback same-origin link</a>
      </body></html>`,
    "/assign-allowed-start": `<!doctype html>
      <html><head><title>Assign Allowed Start</title></head>
      <body>
        <button type="button" id="assign-allowed-button" onclick="window.location.assign('${baseUrl}/same-origin-target?from=assign-allowed#done')">Assign allowed</button>
      </body></html>`,
    "/replace-start": `<!doctype html>
      <html><head><title>Replace Start</title></head>
      <body>
        <button type="button" id="replace-blocked-button" onclick="window.location.replace('${externalUrl}/replace-outside')">Replace blocked</button>
        <a href="${baseUrl}/same-origin-target?from=replace#done" id="replace-fallback-link">Fallback same-origin link</a>
      </body></html>`,
    "/form-start": `<!doctype html>
      <html><head><title>Form Start</title></head>
      <body>
        <form action="${externalUrl}/form-outside" method="get">
          <button type="submit" id="form-blocked-button">Submit blocked form</button>
        </form>
        <a href="${baseUrl}/same-origin-target?from=form#done" id="form-fallback-link">Fallback same-origin link</a>
      </body></html>`,
    "/form-popup-start": `<!doctype html>
      <html><head><title>Form Popup Start</title></head>
      <body>
        <form action="${externalUrl}/form-popup" method="get" target="_blank">
          <button type="submit" id="form-popup-button">Submit popup form</button>
        </form>
        <a href="${baseUrl}/same-origin-target?from=form-popup#done" id="form-popup-fallback-link">Fallback same-origin link</a>
      </body></html>`,
    "/relative-allow-list/start": `<!doctype html>
      <html><head><title>Relative Allow List Start</title></head>
      <body>
        <a href="./blocked" id="relative-allow-list-blocked-link">Relative blocked link</a>
        <a href="./allowed/next" id="relative-allow-list-allowed-link">Relative allowed link</a>
      </body></html>`,
    "/relative-allow-list/allowed/next": `<!doctype html>
      <html><head><title>Relative Allow Listed</title></head>
      <body><h1>Relative Allow Listed</h1></body></html>`,
    "/relative-allow-list/blocked": `<!doctype html>
      <html><head><title>Relative Allow Blocked</title></head>
      <body><h1>Relative Allow Blocked</h1></body></html>`,
    "/relative-form-allow-list/start": `<!doctype html>
      <html><head><title>Relative Form Allow List Start</title></head>
      <body>
        <form action="./blocked" method="get">
          <button type="submit" id="relative-form-blocked-button">Submit relative blocked form</button>
        </form>
        <a href="./allowed/next" id="relative-form-allowed-link">Relative allowed link</a>
      </body></html>`,
    "/relative-form-allow-list/allowed/next": `<!doctype html>
      <html><head><title>Relative Form Allow Listed</title></head>
      <body><h1>Relative Form Allow Listed</h1></body></html>`,
    "/relative-form-allow-list/blocked": `<!doctype html>
      <html><head><title>Relative Form Allow Blocked</title></head>
      <body><h1>Relative Form Allow Blocked</h1></body></html>`,
    "/popup-start": `<!doctype html>
      <html><head><title>Popup Start</title></head>
      <body>
        <a href="${externalUrl}/popup" target="_blank" rel="noopener" id="popup-link">Popup link</a>
        <a href="${baseUrl}/same-origin-target" id="popup-fallback-link">Fallback same-origin link</a>
      </body></html>`,
    "/guard-warning-start": `<!doctype html>
      <html><head><title>Guard Warning Start</title></head>
      <body>
        <script>
          const originalOpen = window.open;
          Object.defineProperty(window, "open", {
            configurable: true,
            get() {
              return originalOpen;
            },
            set() {
              throw new Error("window.open is locked by the page");
            }
          });
        </script>
        <a href="${externalUrl}/guard-warning-popup" target="_blank" rel="noopener" id="guard-warning-popup-link">Blocked popup link</a>
        <a href="${baseUrl}/guard-warning-allowed" id="guard-warning-allowed-link">Guard warning allowed</a>
      </body></html>`,
    "/guard-warning-allowed": `<!doctype html>
      <html><head><title>Guard Warning Allowed</title></head>
      <body><h1>Guard Warning Allowed</h1></body></html>`,
    "/sw-allow-list-start": `<!doctype html>
      <html>
        <head><title>SW Allow List Start</title></head>
        <body>
          <p id="sw-status">Preparing service worker fixture...</p>
          <div id="sw-links" hidden>
            <a href="${baseUrl}/sw-allow-list-blocked" id="sw-blocked-link">SW blocked link</a>
            <a href="${baseUrl}/sw-allow-list-allowed/next" id="sw-allowed-link">SW allowed link</a>
          </div>
          <script>
            async function initServiceWorkerFixture() {
              const status = document.getElementById("sw-status");
              const links = document.getElementById("sw-links");
              const revealLinks = (message) => {
                status.textContent = message;
                links.hidden = false;
              };
              const waitWithTimeout = async (promise, timeoutMs, label) => {
                const timeout = new Promise((_, reject) => {
                  setTimeout(() => reject(new Error(label)), timeoutMs);
                });
                return await Promise.race([promise, timeout]);
              };

              if (!("serviceWorker" in navigator)) {
                revealLinks("Service worker unsupported");
                return;
              }

              try {
                await waitWithTimeout(
                  navigator.serviceWorker.register("/sw-allow-list-sw.js", { scope: "/" }),
                  250,
                  "service worker registration timed out"
                );
                await waitWithTimeout(
                  navigator.serviceWorker.ready,
                  250,
                  "service worker ready timed out"
                );

                if (navigator.serviceWorker.controller) {
                  revealLinks("Service worker controlled");
                  return;
                }

                const controllerChanged = new Promise((resolve) => {
                  navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
                });
                const timeout = new Promise((resolve) => setTimeout(resolve, 200));
                await Promise.race([controllerChanged, timeout]);
                revealLinks(navigator.serviceWorker.controller
                  ? "Service worker controlled"
                  : "Service worker blocked");
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                revealLinks("Service worker blocked: " + message);
              }
            }

            void initServiceWorkerFixture();
          </script>
        </body>
      </html>`,
    "/sw-allow-list-sw.js": `
      self.addEventListener("install", (event) => {
        event.waitUntil(self.skipWaiting());
      });
      self.addEventListener("activate", (event) => {
        event.waitUntil(self.clients.claim());
      });
      self.addEventListener("fetch", (event) => {
        if (event.request.mode === "navigate") {
          event.respondWith(fetch(event.request));
        }
      });
    `,
    "/sw-allow-list-blocked": `<!doctype html>
      <html><head><title>SW Allow List Blocked</title></head>
      <body><h1>SW Allow List Blocked</h1></body></html>`,
    "/sw-allow-list-allowed/next": `<!doctype html>
      <html><head><title>SW Allow Listed</title></head>
      <body><h1>SW Allow Listed</h1></body></html>`
  };

  return pages[pathname];
}

async function listenServer(server: Server): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) {
        rejectPromise(error);
        return;
      }

      resolvePromise();
    });
  });
}

function getServerUrl(server: Server): string {
  const address = server.address() as AddressInfo | null;
  if (!address) {
    throw new Error("Server address is unavailable.");
  }

  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.close((error) => {
      if (error) {
        rejectPromise(error);
        return;
      }

      resolvePromise();
    });
  });
}
