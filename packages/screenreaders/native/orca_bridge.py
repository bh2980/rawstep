#!/usr/bin/env python3
"""Rawstep's local Orca 48 native bridge, NOT a W3C AT Driver server.

Requires an existing private X11 desktop/session bus and Speech Dispatcher.
Only text actually submitted by Orca to Speech Dispatcher is forwarded; no
DOM/AX-derived speech and no synthesized fallback. Text is not an audio recording.
"""
from __future__ import annotations
import ctypes
import ctypes.util
import json
import os
import re
import signal
import sys
import tempfile
import threading
import time
import xml.etree.ElementTree as ET

PROTOCOL = 'rawstep-orca-native-v1'
MAX_LINE = 65536
SUPPORTED_ORCA_MAJORS = {48}
OUT = sys.stdout
OUT_LOCK = threading.Lock()

class BridgeError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code, self.message = code, message

def emit(value):
    with OUT_LOCK:
        OUT.write(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n')
        OUT.flush()

def response(request_id, result=None, error=None):
    record = {'type': 'response', 'id': request_id}
    if error:
        record['error'] = {'code': error.code, 'message': error.message}
    else:
        record['result'] = result if result is not None else {}
    emit(record)

def parse_request(line):
    if len(line) > MAX_LINE:
        raise BridgeError('INVALID_REQUEST', 'Protocol line exceeds the limit.')
    try:
        value = json.loads(line)
    except (ValueError, TypeError):
        raise BridgeError('INVALID_REQUEST', 'Protocol request is not valid JSON.') from None
    if not isinstance(value, dict) or isinstance(value.get('id'), bool) or not isinstance(value.get('id'), int):
        raise BridgeError('INVALID_REQUEST', 'Protocol request requires an integer id.')
    if value['id'] < 0 or not isinstance(value.get('method'), str) or not isinstance(value.get('params', {}), dict):
        raise BridgeError('INVALID_REQUEST', 'Protocol request has invalid fields.')
    return value

def speech_text(kind, payload):
    """Decode Orca's SSML transport, not page semantics."""
    if not isinstance(payload, str):
        return None
    if kind == 'speak':
        try:
            root = ET.fromstring(payload)
            if root.tag.rsplit('}', 1)[-1] != 'speak':
                return None
            return ''.join(root.itertext())
        except ET.ParseError:
            # Orca 48 sends SSML; fail closed if its transport format changes.
            return None
    return payload

class XClassHint(ctypes.Structure):
    _fields_ = [('res_name', ctypes.c_void_p), ('res_class', ctypes.c_void_p)]

class X11Keyboard:
    MODIFIERS = {'Shift_L', 'Shift_R', 'Control_L', 'Control_R', 'Alt_L', 'Alt_R', 'Super_L', 'Super_R', 'Insert', 'Caps_Lock'}
    NAMED_KEYS = {'Tab','ISO_Left_Tab','Return','KP_Enter','space','Escape','BackSpace','Delete','Left','Right','Up','Down','Home','End','Page_Up','Page_Down','Insert','Caps_Lock','KP_Add','KP_Subtract','KP_Multiply','KP_Divide','KP_Decimal','comma','period','slash','semicolon','apostrophe','bracketleft','bracketright','backslash','minus','equal','grave'} | {f'F{i}' for i in range(1,13)} | {f'KP_{i}' for i in range(10)}
    def __init__(self, window_id):
        try:
            self.x = ctypes.CDLL(ctypes.util.find_library('X11') or 'libX11.so.6')
            self.xt = ctypes.CDLL(ctypes.util.find_library('Xtst') or 'libXtst.so.6')
        except OSError:
            raise BridgeError('X11_MISSING', 'X11 and XTest client libraries are required.') from None
        self.x.XInitThreads()
        self.x.XOpenDisplay.argtypes = [ctypes.c_char_p]; self.x.XOpenDisplay.restype = ctypes.c_void_p
        self.x.XCloseDisplay.argtypes = [ctypes.c_void_p]
        self.x.XStringToKeysym.argtypes = [ctypes.c_char_p]; self.x.XStringToKeysym.restype = ctypes.c_ulong
        self.x.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]; self.x.XKeysymToKeycode.restype = ctypes.c_ubyte
        self.x.XGetInputFocus.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_int)]
        self.x.XQueryTree.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.POINTER(ctypes.c_ulong)), ctypes.POINTER(ctypes.c_uint)]
        self.x.XFree.argtypes = [ctypes.c_void_p]
        self.x.XGetClassHint.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(XClassHint)]
        self.x.XInternAtom.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]; self.x.XInternAtom.restype = ctypes.c_ulong
        self.x.XGetWindowProperty.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_long, ctypes.c_long, ctypes.c_int, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.POINTER(ctypes.c_ubyte))]
        self.x.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
        self.xt.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
        self.xt.XTestFakeKeyEvent.restype = ctypes.c_int
        self.display = self.x.XOpenDisplay(None)
        if not self.display:
            raise BridgeError('DISPLAY_UNAVAILABLE', 'Cannot open the configured X11 display.')
        self.window_id = window_id
        try:
            self.ensure_target_focused()
            self.target_class, self.target_pid = self.validate_browser_window()
        except Exception:
            self.close()
            raise
    def validate_browser_window(self):
        hint = XClassHint()
        if not self.x.XGetClassHint(self.display, self.window_id, ctypes.byref(hint)):
            raise BridgeError('TARGET_NOT_BROWSER', 'Target has no X11 browser class metadata.')
        try:
            name = ctypes.string_at(hint.res_class).decode('utf-8', errors='replace') if hint.res_class else ''
        finally:
            if hint.res_name: self.x.XFree(hint.res_name)
            if hint.res_class: self.x.XFree(hint.res_class)
        if name.lower() not in {'chromium','chromium-browser','google-chrome','google-chrome-stable','google-chrome-beta','google-chrome-unstable','firefox','firefox-esr','navigator'}:
            raise BridgeError('TARGET_NOT_BROWSER', 'Target X11 class is not a supported Chromium or Firefox browser.')
        atom = self.x.XInternAtom(self.display, b'_NET_WM_PID', 1)
        actual_type, actual_format = ctypes.c_ulong(), ctypes.c_int()
        count, remaining = ctypes.c_ulong(), ctypes.c_ulong()
        value = ctypes.POINTER(ctypes.c_ubyte)()
        if not atom:
            raise BridgeError('TARGET_PROCESS_UNKNOWN', 'Browser target has no local process identity.')
        status = self.x.XGetWindowProperty(self.display, self.window_id, atom, 0, 1, 0, 6, ctypes.byref(actual_type), ctypes.byref(actual_format), ctypes.byref(count), ctypes.byref(remaining), ctypes.byref(value))
        try:
            if status != 0 or actual_format.value != 32 or count.value != 1 or not value:
                raise BridgeError('TARGET_PROCESS_UNKNOWN', 'Browser target has no valid local process identity.')
            pid = ctypes.cast(value, ctypes.POINTER(ctypes.c_ulong))[0]
        finally:
            if value: self.x.XFree(value)
        try:
            executable = os.path.basename(os.readlink(f'/proc/{pid}/exe'))
        except OSError:
            raise BridgeError('TARGET_PROCESS_UNKNOWN', 'Cannot verify the browser target process on this host.') from None
        if executable not in {'chromium','chromium-browser','chrome','firefox','firefox-bin','firefox-esr'}:
            raise BridgeError('TARGET_NOT_BROWSER', 'Target process is not a supported local browser executable.')
        return name, int(pid)
    def is_target_focused(self):
        if not self.display:
            return False
        focus, revert = ctypes.c_ulong(), ctypes.c_int()
        self.x.XGetInputFocus(self.display, ctypes.byref(focus), ctypes.byref(revert))
        current = focus.value
        for _ in range(128):
            if current == self.window_id:
                return True
            if current in (0, 1):
                return False
            root, parent = ctypes.c_ulong(), ctypes.c_ulong()
            children, count = ctypes.POINTER(ctypes.c_ulong)(), ctypes.c_uint()
            ok = self.x.XQueryTree(self.display, current, ctypes.byref(root), ctypes.byref(parent), ctypes.byref(children), ctypes.byref(count))
            if children:
                self.x.XFree(children)
            if not ok or parent.value in (0, current):
                return False
            current = parent.value
        return False
    def ensure_target_focused(self):
        if not self.is_target_focused():
            raise BridgeError('TARGET_NOT_FOCUSED', 'The configured browser window does not have X11 input focus.')
        if hasattr(self, 'target_pid'):
            window_class, process_id = self.validate_browser_window()
            if process_id != self.target_pid or window_class != self.target_class:
                raise BridgeError('TARGET_CHANGED', 'The configured browser window identity changed during the session.')
    def is_target_ready(self):
        try:
            self.ensure_target_focused()
            return True
        except BridgeError:
            return False
    def press(self, keys):
        if not isinstance(keys, list) or not 1 <= len(keys) <= 5:
            raise BridgeError('INVALID_KEYS', 'A key chord must contain one to five X11 key names.')
        codes = []
        for index, key in enumerate(keys):
            if not isinstance(key, str) or not (key in self.MODIFIERS or key in self.NAMED_KEYS or re.fullmatch('[A-Za-z0-9]', key)):
                raise BridgeError('INVALID_KEYS', 'Unsupported X11 key name.')
            if index < len(keys) - 1 and key not in self.MODIFIERS:
                raise BridgeError('INVALID_KEYS', 'Only modifiers may precede the final key.')
            keysym = self.x.XStringToKeysym(key.encode('ascii'))
            code = self.x.XKeysymToKeycode(self.display, keysym)
            if not code:
                raise BridgeError('KEY_UNAVAILABLE', 'A requested key is absent from the current X11 keymap.')
            codes.append(code)
        self.ensure_target_focused()
        pressed = []
        try:
            for code in codes:
                # Focus can change between modifiers and the final key. Recheck at
                # each native press; releases still run in finally on failure.
                self.ensure_target_focused()
                if not self.xt.XTestFakeKeyEvent(self.display, code, 1, 0):
                    raise BridgeError('INPUT_FAILED', 'XTest could not submit a native key event.')
                pressed.append(code)
                self.x.XSync(self.display, 0)
            self.x.XSync(self.display, 0)
            time.sleep(0.015)
        finally:
            for code in reversed(pressed):
                self.xt.XTestFakeKeyEvent(self.display, code, 0, 0)
            self.x.XSync(self.display, 0)
        # A race cannot retract a submitted key, but must prevent later actions.
        self.ensure_target_focused()
    def close(self):
        if self.display:
            self.x.XCloseDisplay(self.display)
            self.display = None

class OrcaBridge:
    def __init__(self, request):
        self.request_id = request['id']
        self.session_id = request.get('params', {}).get('sessionId')
        self.keyboard = None
        self.started = False
        self.stopping = False
        self.failure = None
        self.tmp = None
        self.orca = None
        self.input_thread = None
        self.request_ids = {request['id']}
        self.restore_hooks = []
        self.a11y_was_enabled = None
    def preflight(self, params):
        if params.get('protocol') != PROTOCOL or not isinstance(self.session_id, str) or not re.fullmatch('[A-Za-z0-9_-]{1,128}', self.session_id):
            raise BridgeError('PROTOCOL_MISMATCH', 'Expected rawstep-orca-native-v1 and a bounded session id.')
        if sys.platform != 'linux':
            raise BridgeError('PLATFORM_UNSUPPORTED', 'The native Orca bridge supports Linux X11 only.')
        if not os.environ.get('DISPLAY'):
            raise BridgeError('DISPLAY_MISSING', 'A real X11 DISPLAY shared with the browser is required.')
        if not re.fullmatch(r'(?:unix)?:[0-9]+(?:\.[0-9]+)?', os.environ['DISPLAY']):
            raise BridgeError('REMOTE_DISPLAY_UNSUPPORTED', 'Only a local Linux X11 display is supported.')
        if not os.environ.get('DBUS_SESSION_BUS_ADDRESS'):
            raise BridgeError('DBUS_MISSING', 'An existing session D-Bus address shared with the browser is required.')
        if any(not address.startswith('unix:') for address in os.environ['DBUS_SESSION_BUS_ADDRESS'].split(';')):
            raise BridgeError('REMOTE_DBUS_UNSUPPORTED', 'Only a local Unix-socket session bus is supported.')
        if os.environ.get('SPEECHD_ADDRESS') and not os.environ['SPEECHD_ADDRESS'].startswith('unix_socket:'):
            raise BridgeError('REMOTE_SPEECH_UNSUPPORTED', 'Use a local Unix-socket Speech Dispatcher, not a network speech server.')
        if os.environ.get('SPEECHD_HOST', 'localhost') not in {'localhost', '127.0.0.1', '::1'}:
            raise BridgeError('REMOTE_SPEECH_UNSUPPORTED', 'Remote Speech Dispatcher hosts are not supported.')
        target = params.get('targetWindowId', os.environ.get('RAWSTEP_ORCA_TARGET_WINDOW_ID'))
        try:
            if isinstance(target, bool): raise ValueError()
            target = int(str(target), 0)
            if target <= 1: raise ValueError()
        except (TypeError, ValueError):
            raise BridgeError('TARGET_MISSING', 'Provide the intended browser X11 window id as targetWindowId or RAWSTEP_ORCA_TARGET_WINDOW_ID.') from None
        return target
    def on_speech(self, kind, payload, dispatcher_result):
        if self.stopping or not self.keyboard or not self.keyboard.is_target_ready():
            return
        text = speech_text(kind, payload)
        if not text or not text.strip():
            return
        emit({'type':'speech', 'sessionId':self.session_id, 'source':'orca-speech', 'text':text,
              'captureStage':'speech-dispatcher-submission', 'utteranceKind':kind,
              'audioVerified':False})
    def install_speech_hooks(self, speechd):
        # Use the caller-owned server. Do not autospawn an untracked daemon.
        original_init = speechd.SSIPClient.__init__
        def init_without_autospawn(client, *args, **kwargs):
            kwargs['autospawn'] = False
            return original_init(client, *args, **kwargs)
        speechd.SSIPClient.__init__ = init_without_autospawn
        self.restore_hooks.append((speechd.SSIPClient, '__init__', original_init))
        # These are the real client calls used by Orca's speechdispatcherfactory.
        # Delegate unchanged first. Failed submissions never produce speech evidence.
        for name in ('speak', 'char', 'key'):
            original = getattr(speechd.SSIPClient, name)
            def hooked(client, payload, *args, _kind=name, _original=original, **kwargs):
                result = _original(client, payload, *args, **kwargs)
                self.on_speech(_kind, payload, result)
                return result
            setattr(speechd.SSIPClient, name, hooked)
            self.restore_hooks.append((speechd.SSIPClient, name, original))
    def ready(self):
        from orca import speech, event_manager
        if self.stopping:
            return False
        if speech.get_speech_server() is None:
            self.fail_start(BridgeError('SPEECH_UNAVAILABLE', 'Orca did not connect to a real Speech Dispatcher speech server.'))
            return False
        try:
            self.keyboard.ensure_target_focused()
        except BridgeError as error:
            self.fail_start(error)
            return False
        self.started = True
        response(self.request_id, {'protocol':PROTOCOL,'sessionId':self.session_id,'atName':'Orca',
                 'atVersion':self.version,'platformName':'linux','speechSource':'orca-speech',
                 'captureStage':'speech-dispatcher-submission','audioVerified':False,
                 'targetWindowId':self.keyboard.window_id,'targetClass':self.keyboard.target_class,
                 'targetProcessId':self.keyboard.target_pid})
        self.input_thread = threading.Thread(target=self.read_requests, daemon=True)
        self.input_thread.start()
        return False
    def fail_start(self, error):
        self.failure = error
        response(self.request_id, error=error)
        self.shutdown()
    def read_requests(self):
        from gi.repository import GLib
        while not self.stopping:
            line = sys.stdin.readline(MAX_LINE + 1)
            if not line:
                GLib.idle_add(self.shutdown)
                return
            try:
                request = parse_request(line)
            except BridgeError as error:
                response(-1, error=error)
                GLib.idle_add(self.shutdown)
                return
            GLib.idle_add(self.handle, request)
    def handle(self, request):
        request_id, method, params = request['id'], request['method'], request.get('params', {})
        try:
            if request_id in self.request_ids:
                raise BridgeError('DUPLICATE_REQUEST', 'Request id was already handled in this session.')
            self.request_ids.add(request_id)
            if self.stopping or params.get('sessionId') != self.session_id:
                raise BridgeError('SESSION_INVALID', 'Request does not belong to the active session.')
            if method == 'input.pressKeys':
                self.keyboard.press(params.get('keys'))
                response(request_id, {})
            elif method == 'session.stop':
                # Only this owned Orca instance is stopped. Never pgrep/kill another Orca.
                self.shutdown()
                response(request_id, {})
            else:
                raise BridgeError('METHOD_UNSUPPORTED', 'Unsupported native Orca bridge method.')
        except BridgeError as error:
            response(request_id, error=error)
        except Exception:
            response(request_id, error=BridgeError('NATIVE_FAILURE', 'The native Orca operation failed.'))
        return False
    def shutdown(self):
        if self.stopping:
            return False
        self.stopping = True
        if self.orca:
            self.orca.shutdown()
        return False
    def run(self, params):
        target = self.preflight(params)
        # Orca settings are session-private. No persistent desktop preference writes.
        self.tmp = tempfile.TemporaryDirectory(prefix='rawstep-orca-')
        os.environ['GSETTINGS_BACKEND'] = 'memory'
        os.environ['XDG_CACHE_HOME'] = os.path.join(self.tmp.name, 'cache')
        os.environ['XDG_CONFIG_HOME'] = os.path.join(self.tmp.name, 'config')
        os.environ['XDG_DATA_HOME'] = os.path.join(self.tmp.name, 'data')
        os.makedirs(os.environ['XDG_CACHE_HOME'], mode=0o700)
        # Initialize Xlib thread support before GTK imports or opens its connection.
        self.keyboard = X11Keyboard(target)
        try:
            import gi
            gi.require_version('Atspi','2.0'); gi.require_version('Gdk','3.0')
            from gi.repository import Atspi, Gdk, Gio, GLib
            import speechd
            from orca import orca, orca_platform, settings_manager, settings
        except (ImportError, ValueError):
            raise BridgeError('DEPENDENCY_MISSING', 'Install Orca 48, GI Atspi/Gdk bindings, and Python Speech Dispatcher dependencies.') from None
        self.version = orca_platform.version
        if int(self.version.split('.')[0]) not in SUPPORTED_ORCA_MAJORS:
            raise BridgeError('ORCA_VERSION_UNSUPPORTED', 'This experimental native bridge supports Orca 48.x only.')
        try:
            Gio.bus_get_sync(Gio.BusType.SESSION, None)
        except Exception:
            raise BridgeError('DBUS_UNAVAILABLE', 'Cannot connect to the existing D-Bus session.') from None
        if Gdk.Display.get_default() is None:
            raise BridgeError('DISPLAY_UNAVAILABLE', 'GTK cannot open the configured X11 display.')
        try:
            desktop = Atspi.get_desktop(0)
            if desktop is None:
                raise ValueError()
        except Exception:
            raise BridgeError('ATSPI_UNAVAILABLE', 'The session AT-SPI desktop is not available.') from None
        manager = settings_manager.get_manager()
        self.a11y_was_enabled = manager.is_accessibility_enabled()
        manager.activate(os.path.join(self.tmp.name, 'prefs'), {
            'enableSpeech':True,'enableBraille':False,'enableSound':False,
            'enableMouseReview':False,'speechServerFactory':'speechdispatcherfactory',
            'keyboardLayout':settings.GENERAL_KEYBOARD_LAYOUT_DESKTOP,
        })
        self.install_speech_hooks(speechd)
        self.orca = orca
        GLib.idle_add(self.ready)
        # Orca installs its own orderly SIGTERM handler in main().
        result = orca.main()
        if not self.started and not self.failure:
            raise BridgeError('ORCA_NOT_READY', 'Orca exited before its native event loop became ready.')
        return result
    def cleanup(self):
        for owner, name, original in reversed(self.restore_hooks):
            setattr(owner, name, original)
        if self.a11y_was_enabled is False:
            try:
                from orca import settings_manager
                settings_manager.get_manager().set_accessibility(False)
            except Exception:
                pass
        if self.keyboard:
            self.keyboard.close()
        if self.tmp:
            self.tmp.cleanup()

def main():
    # Keep third-party library prints out of the NDJSON channel.
    sys.stdout = sys.stderr
    request = None
    bridge = None
    try:
        request = parse_request(sys.stdin.readline(MAX_LINE + 1))
        if request['method'] != 'session.start':
            raise BridgeError('SESSION_REQUIRED', 'The first request must be session.start.')
        bridge = OrcaBridge(request)
        return bridge.run(request.get('params', {}))
    except BridgeError as error:
        response(request['id'] if request else -1, error=error)
        return 1
    except Exception:
        response(request['id'] if request else -1, error=BridgeError('NATIVE_FAILURE','Native Orca startup failed; run the environment diagnostic.'))
        return 1
    finally:
        if bridge:
            bridge.cleanup()

if __name__ == '__main__':
    raise SystemExit(main())
