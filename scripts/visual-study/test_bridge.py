"""Offline checks for the optional companion changes. Uses installed pinned tokenizer only."""
import base64,hashlib,importlib.util,json,os,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('bridge',ROOT/'examples/screenshot/onejev4b_server.py');bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)
class BridgeTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  from transformers import AutoTokenizer
  assets=Path(os.environ['RAWSTEP_ONEJEV_ASSETS']);cls.policy=bridge.OneJevPolicy.__new__(bridge.OneJevPolicy);cls.policy.tokenizer=AutoTokenizer.from_pretrained(str(assets/'tokenizer'),local_files_only=True,trust_remote_code=False);cls.policy.marker='<__media__>'
  import io
  from PIL import Image
  buf=io.BytesIO();Image.new('RGB',(32,32),'white').save(buf,format='PNG')
  cls.request={'protocol':'rawstep-screenshot-choice-v1','goal':'Use search','screenshot':{'pngBase64':base64.b64encode(buf.getvalue()).decode(),'viewport':{'w':1,'h':1}},'history':[{'step':i,'decision':{'action':{'kind':'key','key':'Tab'}}} for i in range(1,5)],'choices':[{'id':'a','label':'First','decision':{'stop':'uncertain'}},{'id':'b','label':'Second','decision':{'stop':'uncertain'}}],'visualState':{'sha256':'test','visits':1,'unchangedTransitions':0}}
 def setUp(self):self.policy.max_pixels=393216;self.policy.history_limit=12
 def test_default_pixel_budget(self):
  h,w=bridge.smart_resize(800,1280);self.assertEqual((h,w),(480,768))
 def test_higher_pixel_budget(self):
  h,w=bridge.smart_resize(800,1280,max_pixels=786432);self.assertEqual((h,w),(672,1120))
 def test_history_is_limited_before_prompt_render(self):
  self.policy.history_limit=1;prompt,_,_=self.policy.prepare(self.request);self.assertIn('"step": 4',prompt);self.assertNotIn('"step": 3',prompt)
 def test_focus_question_does_not_ask_for_an_action(self):
  prompt,_,_=self.policy.prepare({**self.request,'purpose':'focus-context'});self.assertIn('currently visible keyboard focus',prompt);self.assertNotIn('Which one keyboard action',prompt)
 def test_stop_reason_is_preserved(self):
  prompt,_,_=self.policy.prepare({**self.request,'purpose':'stop-reason'});self.assertIn('run has already stopped',prompt)
 def test_no_explanation_in_system_instruction(self):self.assertIn('with no explanation or reasoning',bridge.SYSTEM)
 def test_invalid_image_budget(self):
  with self.assertRaises(ValueError):bridge.OneJevPolicy('http://127.0.0.1:8768',max_pixels=100)
 def test_invalid_history_limit(self):
  with self.assertRaises(ValueError):bridge.OneJevPolicy('http://127.0.0.1:8768',history_limit=0)
 def test_default_cached_inference_and_explicit_disable(self):
  bodies=[];self.policy.post=lambda path,body:bodies.append(body) or {};self.policy.complete({},{});self.assertTrue(bodies[-1]['cache_prompt']);self.policy.cache_prompt=False;self.policy.complete({},{});self.assertFalse(bodies[-1]['cache_prompt']);del self.policy.cache_prompt
if __name__=='__main__':unittest.main()
