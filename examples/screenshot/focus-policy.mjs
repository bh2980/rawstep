import { ScreenshotDecisionPolicy, HttpScreenshotModel } from 'rawstep/screenshot';
// Experimental opt-in. Uncalibrated visual focus predictions only restrict choices.
// Keep the independent runner input gate and goal verification enabled.
export default new ScreenshotDecisionPolicy({
  model: new HttpScreenshotModel({endpoint:process.env.RAWSTEP_MODEL_ENDPOINT??'http://127.0.0.1:8767/choose',timeoutMs:240_000}),
  focusGate:{minimumProbability:0.75,minimumMargin:0.25},
  historyLimit:1,
});
