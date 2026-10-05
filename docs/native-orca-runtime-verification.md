# Native Orca runtime verification, 2026-10-01

## Result

The native adapter is implemented, but a genuine Orca-driven browser workflow is
**blocked in this cloud execution shell**. No successful native speech trace or
audible output is claimed. This is a measured environment limitation, not a claim
that Linux or Orca cannot support the integration.

## Executed checks

1. Inspected the shell runtime: Debian GNU/Linux 13, no `DISPLAY`, no
   `DBUS_SESSION_BUS_ADDRESS`, no installed Orca or Python `speechd` modules
2. Confirmed an independently exposed cloud desktop exists through the computer
   tools. No supported shared display/session-bus link from the execution shell
   was established; it was not silently treated as the same native session
3. Downloaded official Debian 13 packages into a task-local directory. Verified
   the Debian-signed `InRelease`, its SHA-256 of `Packages.xz`, and each downloaded
   package's SHA-256. No system files or security settings were modified
4. Imported the extracted Orca **48.1**, Speech Dispatcher bindings, GI Atspi/Gdk/
   Gtk/Gst/Wnck bindings, brlapi, louis, psutil, setproctitle, and dbus successfully
5. Attempted an ordinary task-local `dbus-run-session`. It failed:
   `Failed to open socket: Operation not permitted`
6. Retried only through the execution tool's supported permission-escalation
   route, with an owned writable runtime directory. The same D-Bus socket failure
   occurred. No sandbox disabling, IPC proxy, or terminal bypass was attempted
7. Ran the real bundled Python bridge through the common runner. Startup returned
   `DISPLAY_MISSING`; the runner recorded a step-0 `backend-start` failure with
   **zero browser launches and zero policy decisions**
8. Ran the portable native smoke entry point. It recorded `status: "blocked"`,
   `liveSpeechVerified: false`, and `audioVerified: false` before attempting a
   browser launch

## Checks that passed without proving native desktop behavior

- 45 TypeScript Orca adapter tests at the adapter handoff
- 30 Python protocol, preflight, SSML transport, hook, and focus-filter unit tests
- Python compilation and actual official Orca/dependency import checks
- Real native-process negative startup test, including no fake-success metadata

The positive transport tests use explicitly labeled local protocol fixtures.
They validate synchronization, cancellation, malformed messages, privacy,
buffering, exact target identity, and shutdown; they do not certify a running
screen reader or browser accessibility behavior.

## What is needed to establish a real pass

Use an authorized Linux X11 test desktop with native IPC, full headed Chromium,
Orca 48.x, AT-SPI, an existing Speech Dispatcher, and a verified browser window.
The [portable native smoke instructions](../examples/orca/README.md) precreate and
pair that exact browser with the existing runner. They retain Chromium's sandbox,
use genuine native keys, record Orca-to-Speech-Dispatcher submissions, verify the
fixture independently, and fail closed without live speech.

That run must actually finish before replacing the blocked result with a pass.
Speech text accepted by Speech Dispatcher still does not prove rendered audio,
speech completion, or VoiceOver/NVDA equivalence.

## Primary sources

- [GNOME Orca introduction and supported AT-SPI applications](https://gnome.pages.gitlab.gnome.org/orca/help/introduction.html)
- [Orca reading commands](https://gnome.pages.gitlab.gnome.org/orca/help/commands_reading.html)
- [Orca structural navigation](https://gnome.pages.gitlab.gnome.org/orca/help/commands_structural_navigation.html)
- [Official Debian Orca package and dependency list](https://packages.debian.org/trixie/orca)

The bridge capture implementation was checked against the downloaded, verified
Debian Orca 48.1 `speechdispatcherfactory.py` and Speech Dispatcher 0.12.0 Python
client. It hooks the original `SSIPClient.speak`, `char`, and `key` calls and emits
only after the original submission returns successfully.
