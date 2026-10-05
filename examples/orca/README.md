# Real Orca smoke test on Linux

This is a **native test**, not a simulator or an audio recording. It precreates a
visible Chromium window, uniquely pairs that Page to its X11 window, starts the
Orca bridge, and sends real XTest Enter keys based only on captured Orca speech.
Independent DOM/title verification checks the resulting fixture state.

The smoke test currently has **not completed in the development cloud**: that
execution shell has no shared `DISPLAY`/D-Bus, and D-Bus socket creation is denied.
It must be run in an authorized Linux X11 desktop where those capabilities exist.
Never disable a sandbox or switch to simulated output to make it pass.

## Setup

Use a disposable Linux X11 test desktop with a window manager, default US keyboard
layout, no unrelated applications/notifications, and no other running Orca. A real
X11 session can be a desktop or a separately provisioned test VM/container whose
policy permits native IPC. No macOS machine is involved.

1. Install Node 22+ and the normal project dependencies, then `npm run build`
2. Install the distro's official packages. On Debian 13, the dependencies include
   `orca`, `speech-dispatcher`, `speech-dispatcher-espeak-ng`, `python3-speechd`,
   `gir1.2-atspi-2.0`, `xdotool`, `chromium`, and the dependencies those packages
   declare. This bridge accepts Orca **48.x** only
3. Use a terminal inside the test X11 session. It must already have `DISPLAY` and
   `DBUS_SESSION_BUS_ADDRESS`. Do not invent addresses pointing at another desktop
4. Use an already-running Speech Dispatcher, or start one owned by this test as
   shown below. The bridge intentionally disables automatic server spawning

For a task-owned speech server, in a shell with the official packages installed:

```sh
work=$(mktemp -d)
speech-dispatcher --run-single --communication-method unix_socket \
  --socket-path "$work/speechd.sock" --pid-file "$work/speechd.pid" \
  --log-dir "$work" >"$work/server.log" 2>&1 &
speech_pid=$!
trap 'kill "$speech_pid" 2>/dev/null || true; wait "$speech_pid" 2>/dev/null || true' EXIT
export SPEECHD_ADDRESS="unix_socket:$work/speechd.sock"
for i in $(seq 1 50); do
  test -S "$work/speechd.sock" && break
  kill -0 "$speech_pid" 2>/dev/null || { cat "$work/server.log"; exit 1; }
  sleep 0.1
done
test -S "$work/speechd.sock" || { echo 'Speech Dispatcher did not start'; exit 1; }
node examples/orca/native-smoke.mjs ./orca-native-smoke
```

The supplied native smoke defaults to `/usr/bin/chromium`. Set
`RAWSTEP_NATIVE_BROWSER` to an installed compatible **full headed browser** if
needed. The existing serverless headless-shell binary is not a native desktop
substitute. `chromiumSandbox: true` is retained.

The script uses `xdotool` only to discover and activate its newly-created,
uniquely titled test window. The bridge independently checks the target's browser
class, local browser process, and native focus. It never activates another window
as a fallback. If any check fails, the run stops.

## Evidence and interpretation

Inspect `native-smoke-result.json` and `trace/trace.json`:

- `passed` requires real Orca announcements for Continue, Confirm, and completion,
  plus successful independent fixture verification
- `failed` means the native workflow did not establish that result
- `blocked` means prerequisites, target pairing, or startup failed
- `audioVerified` remains `false`: the capture is text accepted for submission to
  Speech Dispatcher, not a microphone/loopback audio recording
- No speech means no semantic fallback. AX, DOM, and screenshots never become
  fabricated Orca utterances

The fixture policy is deterministic and speech-gated. This smoke verifies the
native adapter path, not a pretrained model's decision quality. Broader screen
reader/browser/site compatibility needs separate runs.

Run protocol and preflight checks independently:

```sh
python3 -m unittest discover -s native -p 'test_*.py'
npx vitest run tests/orca-v2.test.ts
/usr/bin/python3 packages/screenreaders/native/orca_doctor.py
```

The doctor checks prerequisites, so before the smoke creates its browser it will
correctly report the missing target window. Even a fully positive doctor result
is not proof of actual speech or task success.

For a locally installed tarball release, the bridge and doctor sources belong to `node_modules/@rawstep/screenreaders/native/`. The Node adapter resolves its bridge from its own installed package. No Python/runtime installation occurs during npm installation or import.
