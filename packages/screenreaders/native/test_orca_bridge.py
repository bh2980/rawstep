"""Unit checks only. These are not native Orca/browser speech evidence."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch
from types import SimpleNamespace

SPEC = importlib.util.spec_from_file_location('rawstep_orca_bridge', Path(__file__).with_name('orca_bridge.py'))
bridge = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bridge)

def request(**params):
    return {'id':1,'method':'session.start','params': {'protocol':bridge.PROTOCOL,'sessionId':'test-session',**params}}

class ProtocolTests(unittest.TestCase):
    def test_valid_request(self):
        self.assertEqual(bridge.parse_request(json.dumps(request()))['id'],1)
    def test_invalid_json_rejected(self):
        with self.assertRaises(bridge.BridgeError): bridge.parse_request('{')
    def test_bool_id_rejected(self):
        with self.assertRaises(bridge.BridgeError): bridge.parse_request('{"id":true,"method":"session.start"}')
    def test_oversize_rejected(self):
        with self.assertRaises(bridge.BridgeError): bridge.parse_request('x'*(bridge.MAX_LINE+1))
    def test_invalid_params_rejected(self):
        with self.assertRaises(bridge.BridgeError): bridge.parse_request('{"id":1,"method":"session.start","params":[]}')
    def test_output_is_structured_ndjson(self):
        stream=io.StringIO()
        with patch.object(bridge,'OUT',stream): bridge.response(12,error=bridge.BridgeError('SAFE','Public safe detail'))
        self.assertEqual(json.loads(stream.getvalue()),{'type':'response','id':12,'error':{'code':'SAFE','message':'Public safe detail'}})

class PreflightTests(unittest.TestCase):
    def test_protocol_mismatch(self):
        req=request(protocol='wrong')
        with self.assertRaisesRegex(bridge.BridgeError,'Expected rawstep'): bridge.OrcaBridge(req).preflight(req['params'])
    def test_display_required(self):
        req=request()
        with patch.dict(os.environ,{},clear=True),self.assertRaisesRegex(bridge.BridgeError,'real X11 DISPLAY'): bridge.OrcaBridge(req).preflight(req['params'])
    def test_existing_bus_required(self):
        req=request()
        with patch.dict(os.environ,{'DISPLAY':':123'},clear=True),self.assertRaisesRegex(bridge.BridgeError,'existing session D-Bus'): bridge.OrcaBridge(req).preflight(req['params'])
    def test_exact_target_required(self):
        req=request()
        with patch.dict(os.environ,{'DISPLAY':':123','DBUS_SESSION_BUS_ADDRESS':'unix:path=/unused'},clear=True),self.assertRaisesRegex(bridge.BridgeError,'intended browser X11'): bridge.OrcaBridge(req).preflight(req['params'])
    def test_target_true_not_valid(self):
        req=request(targetWindowId=True)
        with patch.dict(os.environ,{'DISPLAY':':123','DBUS_SESSION_BUS_ADDRESS':'unix:path=/unused'},clear=True),self.assertRaises(bridge.BridgeError): bridge.OrcaBridge(req).preflight(req['params'])
    def test_remote_display_rejected(self):
        req=request(targetWindowId=1234)
        with patch.dict(os.environ,{'DISPLAY':'other-host:0','DBUS_SESSION_BUS_ADDRESS':'unix:path=/unused'},clear=True),self.assertRaisesRegex(bridge.BridgeError,'local Linux X11'):
            bridge.OrcaBridge(req).preflight(req['params'])
    def test_remote_bus_rejected(self):
        req=request(targetWindowId=1234)
        with patch.dict(os.environ,{'DISPLAY':':123','DBUS_SESSION_BUS_ADDRESS':'tcp:host=other'},clear=True),self.assertRaisesRegex(bridge.BridgeError,'local Unix-socket session bus'):
            bridge.OrcaBridge(req).preflight(req['params'])
    def test_remote_speech_rejected(self):
        req=request(targetWindowId=1234)
        with patch.dict(os.environ,{'DISPLAY':':123','DBUS_SESSION_BUS_ADDRESS':'unix:path=/unused','SPEECHD_ADDRESS':'inet_socket:other:6560'},clear=True),self.assertRaisesRegex(bridge.BridgeError,'local Unix-socket Speech Dispatcher'):
            bridge.OrcaBridge(req).preflight(req['params'])
    def test_explicit_target_valid(self):
        req=request(targetWindowId=1234)
        with patch.dict(os.environ,{'DISPLAY':':123','DBUS_SESSION_BUS_ADDRESS':'unix:path=/unused'},clear=True): self.assertEqual(bridge.OrcaBridge(req).preflight(req['params']),1234)

class SpeechHookTests(unittest.TestCase):
    def test_ssml_preserves_text_and_decodes_entities(self):
        self.assertEqual(bridge.speech_text('speak','<speak>Hello <mark name="0:5"/>A &amp; B</speak>'),'Hello A & B')
    def test_non_ssml_speak_is_not_invented(self):
        self.assertIsNone(bridge.speech_text('speak','Accessible button'))
    def test_wrong_markup_rejected(self):
        self.assertIsNone(bridge.speech_text('speak','<html>Page text</html>'))
    def test_character_is_forwarded(self):
        self.assertEqual(bridge.speech_text('char','X'),'X')
    def test_successful_original_call_precedes_capture(self):
        seen=[]
        class Client:
            def __init__(self, **kwargs): pass
            def speak(self,payload,*args,**kw): seen.append(('original',payload,kw)); return 71
            char=speak
            key=speak
        b=bridge.OrcaBridge(request()); b.on_speech=lambda *args:seen.append(('captured',*args))
        b.install_speech_hooks(SimpleNamespace(SSIPClient=Client))
        try:
            result=Client().speak('<speak>Real outgoing payload</speak>',callback='preserved')
            self.assertEqual(result,71)
            self.assertEqual(seen[0],('original','<speak>Real outgoing payload</speak>',{'callback':'preserved'}))
            self.assertEqual(seen[1],('captured','speak','<speak>Real outgoing payload</speak>',71))
        finally: b.cleanup()
    def test_failed_submission_never_generates_evidence(self):
        seen=[]
        class Client:
            def __init__(self, **kwargs): pass
            def speak(self,*args,**kw): raise RuntimeError('dispatcher disconnected')
            char=speak
            key=speak
        b=bridge.OrcaBridge(request()); b.on_speech=lambda *args:seen.append(args)
        b.install_speech_hooks(SimpleNamespace(SSIPClient=Client))
        try:
            with self.assertRaises(RuntimeError): Client().speak('<speak>Not submitted</speak>')
            self.assertEqual(seen,[])
        finally:b.cleanup()
    def test_other_window_speech_dropped(self):
        b=bridge.OrcaBridge(request()); b.keyboard=SimpleNamespace(is_target_ready=lambda:False)
        with patch.object(bridge,'emit') as output:
            b.on_speech('char','private',1)
            output.assert_not_called()
    def test_output_discloses_capture_stage(self):
        b=bridge.OrcaBridge(request()); b.keyboard=SimpleNamespace(is_target_ready=lambda:True)
        with patch.object(bridge,'emit') as output:
            b.on_speech('speak','<speak>Submit button</speak>',1)
            event=output.call_args.args[0]
            self.assertEqual(event['source'],'orca-speech')
            self.assertEqual(event['text'],'Submit button')
            self.assertEqual(event['captureStage'],'speech-dispatcher-submission')
            self.assertIs(event['audioVerified'],False)
    def test_stopping_drops_shutdown_utterance(self):
        b=bridge.OrcaBridge(request()); b.stopping=True
        with patch.object(bridge,'emit') as output:
            b.on_speech('char','x',1);output.assert_not_called()

class NativeKeyGuardUnitTests(unittest.TestCase):
    def keyboard(self, steal_after=None):
        obj=object.__new__(bridge.X11Keyboard)
        obj.display=123;obj.calls=[];obj.focused=True;obj.checks=0
        obj.x=SimpleNamespace(XStringToKeysym=lambda value:1,XKeysymToKeycode=lambda *args:9,XSync=lambda *args:None)
        def check():
            obj.checks+=1
            if not obj.focused:raise bridge.BridgeError('TARGET_NOT_FOCUSED','lost focus')
        def press(display,code,down,delay):
            obj.calls.append(down)
            if steal_after is not None and len(obj.calls)==steal_after:obj.focused=False
            return 1
        obj.xt=SimpleNamespace(XTestFakeKeyEvent=press)
        obj.ensure_target_focused=check
        return obj
    def test_reused_window_id_rejected(self):
        obj=object.__new__(bridge.X11Keyboard)
        obj.target_pid=20;obj.target_class='Chromium'
        obj.is_target_focused=lambda:True
        obj.validate_browser_window=lambda:('Chromium',21)
        with self.assertRaisesRegex(bridge.BridgeError,'identity changed'):obj.ensure_target_focused()
        self.assertFalse(obj.is_target_ready())
    def test_changed_window_class_rejected(self):
        obj=object.__new__(bridge.X11Keyboard)
        obj.target_pid=20;obj.target_class='Chromium'
        obj.is_target_focused=lambda:True
        obj.validate_browser_window=lambda:('Firefox',20)
        with self.assertRaisesRegex(bridge.BridgeError,'identity changed'):obj.ensure_target_focused()
    def test_rechecks_focus_before_each_key_and_after_release(self):
        obj=self.keyboard()
        obj.press(['Control_L','a'])
        self.assertEqual(obj.calls,[1,1,0,0]);self.assertEqual(obj.checks,4)
    def test_focus_loss_after_modifier_releases_and_never_presses_final_key(self):
        obj=self.keyboard(steal_after=1)
        with self.assertRaises(bridge.BridgeError):obj.press(['Control_L','a'])
        self.assertEqual(obj.calls,[1,0])
    def test_unsupported_key_never_injects(self):
        obj=self.keyboard()
        with self.assertRaises(bridge.BridgeError):obj.press(['XF86PowerOff'])
        self.assertEqual(obj.calls,[])
    def test_unfocused_window_never_injects(self):
        obj=self.keyboard();obj.focused=False
        with self.assertRaises(bridge.BridgeError):obj.press(['Return'])
        self.assertEqual(obj.calls,[])

if __name__ == '__main__':unittest.main()
