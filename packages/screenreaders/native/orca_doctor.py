#!/usr/bin/env python3
"""Read-only dependency/session diagnostics. Never starts or changes desktop services."""
import ctypes.util
import importlib.util
import json
import os
import platform
import re
import shutil
import sys

result = {'schemaVersion': 1, 'platform': platform.system(), 'checks': [],
          'captureKind': 'Orca text submitted to Speech Dispatcher; not recorded audio',
          'liveSpeechVerified': False}
def check(name, ok, detail):
    result['checks'].append({'name': name, 'ok': bool(ok), 'detail': detail})
check('linux', sys.platform == 'linux', 'Linux X11 is required')
for name in ['orca', 'gi', 'speechd']:
    check(name, importlib.util.find_spec(name) is not None, 'Python import availability')
for name in ['X11', 'Xtst']:
    check(name, ctypes.util.find_library(name) is not None, 'Native keyboard library availability')
check('display', bool(os.environ.get('DISPLAY')), 'DISPLAY must be shared with the headed browser')
check('localDisplay', bool(re.fullmatch(r'(?:unix)?:[0-9]+(?:\.[0-9]+)?', os.environ.get('DISPLAY',''))), 'Only a local X11 display is supported')
check('sessionBus', bool(os.environ.get('DBUS_SESSION_BUS_ADDRESS')), 'Existing D-Bus session required; no auto-launch is attempted')
check('localSessionBus', bool(os.environ.get('DBUS_SESSION_BUS_ADDRESS')) and all(address.startswith('unix:') for address in os.environ.get('DBUS_SESSION_BUS_ADDRESS','').split(';')), 'Only a local Unix-socket session bus is supported')
check('localSpeechServer', (not os.environ.get('SPEECHD_ADDRESS') or os.environ['SPEECHD_ADDRESS'].startswith('unix_socket:')) and os.environ.get('SPEECHD_HOST','localhost') in {'localhost','127.0.0.1','::1'}, 'Network speech servers are not supported')
try:
    target = int(os.environ.get('RAWSTEP_ORCA_TARGET_WINDOW_ID', '0'), 0)
except ValueError:
    target = 0
check('targetWindow', target > 1, 'Explicit browser X11 window id required; config may supply targetWindowId instead')
if importlib.util.find_spec('orca'):
    try:
        from orca import orca_platform
        check('orcaVersion', orca_platform.version.split('.')[0] == '48', orca_platform.version)
    except Exception:
        check('orcaVersion', False, 'Unable to import Orca version metadata')
if importlib.util.find_spec('gi'):
    import gi
    for name, version in [('Atspi', '2.0'), ('Gdk', '3.0'), ('Gtk', '3.0'), ('Gst', '1.0'), ('Wnck', '3.0')]:
        try:
            gi.require_version(name, version)
            check('gi-' + name, True, version)
        except Exception:
            check('gi-' + name, False, 'Introspection binding missing')
result['status'] = 'prerequisites-present-not-live-verified' if all(item['ok'] for item in result['checks']) else 'blocked'
print(json.dumps(result, indent=2))
sys.exit(0 if result['status'] != 'blocked' else 2)
