import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { beforeAll } from "vitest";

const testsDir = __dirname;
const repoRoot = resolve(testsDir, "..");
const fixturesDir = resolve(repoRoot, "fixtures");
const examplesTasksDir = resolve(repoRoot, "examples", "tasks");

async function writeGeneratedFile(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

beforeAll(async () => {
  await Promise.all([
    writeGeneratedFile(resolve(fixturesDir, "simple-cta.html"), `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Simple CTA Fixture</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font-family: sans-serif; padding: 32px; }
      .status { margin-top: 16px; font-weight: 700; }
    </style>
  </head>
  <body>
    <a href="#main">Skip to main content</a>
    <main id="main">
      <h1>Simple CTA Fixture</h1>
      <p>Use the main call to action to continue.</p>
      <button id="start">Get started</button>
      <p id="result" class="status" hidden aria-live="polite"></p>
    </main>
    <script>
      const button = document.getElementById("start");
      const result = document.getElementById("result");
      button.addEventListener("click", () => {
        document.title = "Completed - Simple CTA Fixture";
        result.hidden = false;
        result.textContent = "Started!";
      });
    </script>
  </body>
</html>
`),
    writeGeneratedFile(resolve(fixturesDir, "bad-focus.html"), `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Bad Focus Fixture</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <h1>Bad Focus Fixture</h1>
    <p>This page intentionally has awkward focus behavior.</p>
    <a href="#one">Noise link one</a>
    <a href="#two">Noise link two</a>
    <div tabindex="0">Focusable container with no useful action.</div>
  </body>
</html>
`),
    writeGeneratedFile(resolve(fixturesDir, "email-login.html"), `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Email Login Fixture</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font-family: sans-serif; padding: 32px; }
      form { display: grid; gap: 12px; max-width: 420px; }
      .status { margin-top: 16px; font-weight: 700; }
    </style>
  </head>
  <body>
    <a href="#help">Help</a>
    <a href="#updates">Product updates</a>
    <h1>Email Login Fixture</h1>
    <form id="login-form">
      <label>
        Email
        <input id="email" name="email" type="email" autocomplete="email" />
      </label>
      <label>
        <input id="remember" name="remember" type="checkbox" />
        Remember this device
      </label>
      <button id="submit" type="submit">Send magic link</button>
    </form>
    <div id="status" class="status" hidden aria-live="polite"></div>
    <script>
      const form = document.getElementById("login-form");
      const email = document.getElementById("email");
      const status = document.getElementById("status");
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        document.title = "Completed - Email Login Fixture";
        status.hidden = false;
        status.textContent = "Magic link sent. " + email.value;
      });
    </script>
  </body>
</html>
`),
    writeGeneratedFile(resolve(fixturesDir, "credential-login.html"), `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Credential Login Fixture</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font-family: sans-serif; padding: 32px; }
      form { display: grid; gap: 12px; max-width: 420px; }
      .status { margin-top: 16px; font-weight: 700; }
    </style>
  </head>
  <body>
    <h1>Credential Login Fixture</h1>
    <form id="credential-form">
      <label>
        Email
        <input id="email" name="email" type="email" autocomplete="email" />
      </label>
      <label>
        Password
        <input id="password" name="password" type="password" autocomplete="current-password" />
      </label>
      <button id="submit" type="submit">Sign in</button>
    </form>
    <div id="status" class="status" hidden aria-live="polite"></div>
    <script>
      const form = document.getElementById("credential-form");
      const status = document.getElementById("status");
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        document.title = "Credential Login Completed";
        status.hidden = false;
        status.textContent = "Signed in.";
      });
    </script>
  </body>
</html>
`),
    writeGeneratedFile(resolve(fixturesDir, "search.html"), `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Search</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <h1>Search</h1>
    <label>
      Query
      <input type="search" name="q" />
    </label>
    <button type="button">Search</button>
  </body>
</html>
`),
    writeGeneratedFile(resolve(examplesTasksDir, "simple-cta.json"), JSON.stringify({
    id: "simple-cta",
    url: "../../fixtures/simple-cta.html",
    goal: "Get started 버튼을 찾아서 활성화하고, 결과 메시지가 보이는 상태로 만들어라.",
    mode: "keyboard",
    maxSteps: 20,
    timeoutMs: 180000,
    verify: {
      all: [
        { textVisible: "Started!" },
        { titleIncludes: "Completed" }
      ]
    }
  }, null, 2) + "\n"),
    writeGeneratedFile(resolve(examplesTasksDir, "email-login.json"), JSON.stringify({
    id: "email-login",
    url: "../../fixtures/email-login.html",
    goal: "이메일 입력칸에 email input 값을 넣고, Send magic link 버튼을 눌러 성공 메시지가 보이게 만들어라.",
    mode: "keyboard",
    maxSteps: 24,
    timeoutMs: 180000,
    input: {
      email: "traveler@example.com"
    },
    verify: {
      all: [
        { textVisible: "Magic link sent." },
        { textVisible: "traveler@example.com" },
        { titleIncludes: "Completed" }
      ]
    }
  }, null, 2) + "\n")
  ]);
});
