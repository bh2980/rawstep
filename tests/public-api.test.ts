import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
const roots = ['@rawstep/core', '@rawstep/policies', '@rawstep/browser', '@rawstep/screenreaders', '@rawstep/reports', '@rawstep/project', '@rawstep/cli', 'rawstep'];
const manifestPath = (name: string) => `packages/${name === 'rawstep' ? name : name.slice(9)}/package.json`;
const exportNames = async (specifier: string) => Object.keys(await import(specifier)).sort();
const internalNames = ['isRecord', 'positiveMilliseconds', 'record', 'validInterval', 'pngFor', 'KEYS'];

describe('public API surface', () => {
  // A change here is a public API change: update the docs and README in the same commit.
  it('pins the core root', async () => { expect(await exportNames('@rawstep/core')).toMatchInlineSnapshot(`
    [
      "BUILTIN_PROFILES",
      "DEFAULT_PROFILE",
      "FileTraceSink",
      "LOOPBACK_HOSTNAMES",
      "MAX_SCRIPT_SOURCE",
      "MemoryTraceSink",
      "RAWSTEP_DEFAULTS",
      "REDACTED",
      "RawstepError",
      "SCREENSHOT_KEYS",
      "TRACE_SCHEMA_VERSION",
      "TraceRecorder",
      "createRedactor",
      "describeInputs",
      "findRawstepError",
      "hydrateScreenshots",
      "isLoopbackHostname",
      "isLoopbackUrl",
      "isScreenshotRef",
      "matchesText",
      "readTrace",
      "resolveEnvironmentProfile",
      "resolveTask",
      "screenshotSha256",
      "traceFilePath",
      "validateNavigation",
      "validateTrace",
      "writeJsonAtomic",
    ]
  `); });
  it('pins the policies root', async () => { expect(await exportNames('@rawstep/policies')).toMatchInlineSnapshot(`
    [
      "DecisionClient",
      "FOCUS_CONTEXT_CHOICES",
      "FakeSystemOneClient",
      "SCREENSHOT_DECISION_PROMPT",
      "SCREENSHOT_MODEL_PROTOCOL",
      "SPEECH_DECISION_PROMPT",
      "STOP_REASON_CHOICES",
      "ScreenshotDecisionPolicy",
      "ScreenshotReplayPolicy",
      "ScriptedPolicy",
      "SystemOneDecisionModel",
      "SystemOneScreenshotAdapter",
      "SystemOneSpeechPolicy",
      "assertScreenshotReplayTaskSafety",
      "decisionError",
      "diagnoseScreenshotStop",
      "exportScreenshotReplay",
      "listGatewayDecisionModels",
      "loadPolicy",
      "modelBaseURL",
      "restrictChoicesByVisualFocus",
      "screenshotChoices",
      "screenshotReplayTaskHash",
      "speechChoices",
      "systemOneProviderOptions",
      "validateModelResponse",
      "validateScreenshotReplay",
    ]
  `); });
  it('pins the browser root', async () => { expect(await exportNames('@rawstep/browser')).toMatchInlineSnapshot(`
    [
      "BUILTIN_PROFILES",
      "BrowserAccessBlockedError",
      "BrowserSetupError",
      "DEFAULT_PROFILE",
      "OBSERVER_WORLD",
      "ProfileApplicationError",
      "SCREENSHOT_KEYS",
      "ScreenshotKeyboardBackend",
      "applyProfile",
      "collectBrowserDiagnostics",
      "createBrowserSession",
      "createChromiumTabZoomController",
      "evaluateVerifyRule",
      "installPageObserver",
      "resolveEnvironmentProfile",
      "runScreenshotReplay",
      "runScreenshotTask",
      "runTask",
      "verifyLiveProfile",
      "verifyTask",
    ]
  `); });
  it('pins the screenreaders root', async () => { expect(await exportNames('@rawstep/screenreaders')).toMatchInlineSnapshot(`
    [
      "AT_DRIVER_KEYS",
      "AtDriverBackend",
      "AtDriverClient",
      "AtDriverError",
      "MOCK_VOICEOVER_LIMITATIONS",
      "MOCK_VOICEOVER_PROFILE",
      "MOCK_VOICEOVER_WARNING",
      "MockVoiceOverBackend",
      "ORCA_NATIVE_PROTOCOL",
      "OrcaBackend",
      "OrcaBridgeClient",
      "OrcaBridgeError",
      "UnsupportedCorpusPatternError",
      "formatSimulatedSpeech",
      "getAtDriverProfile",
      "mapOrcaAction",
      "orcaBridgePath",
      "runMockVoiceOverTask",
    ]
  `); });
  it('pins the reports root', async () => { expect(await exportNames('@rawstep/reports')).toMatchInlineSnapshot(`
    [
      "ANALYSIS_SCHEMA_VERSION",
      "DEFAULT_HINT_THRESHOLDS",
      "HINTS_SCHEMA_VERSION",
      "HINT_SOURCES",
      "LlmTraceAnalyzer",
      "aggregateHints",
      "analyzeSavedTrace",
      "analyzeTrace",
      "deterministicAnalyzer",
      "extractHints",
      "loadAnalyzer",
      "readAnalysis",
      "renderReportHtml",
      "selectReference",
      "summarizeRun",
      "summarizeTrace",
      "summarizeTraceEvidence",
      "summarizeVisualExploration",
      "validateAnalysisReport",
      "validateAnalyzerResult",
      "writeHints",
      "writeReport",
    ]
  `); });
  it('pins the project root', async () => { expect(await exportNames('@rawstep/project')).toMatchInlineSnapshot(`
    [
      "CONFIG_FILE",
      "KEYED_PROVIDERS",
      "LlmChoiceClient",
      "LlmScreenshotAdapter",
      "LlmSpeechPolicy",
      "PROVIDERS",
      "ProjectError",
      "ProjectStore",
      "assertRunnable",
      "atomicJson",
      "backendCapabilities",
      "boundedJson",
      "buildModel",
      "checkRun",
      "configSchema",
      "credentialId",
      "credentialRequirements",
      "decisionProviderSchema",
      "defaultConfig",
      "defaultInstructions",
      "defaultModes",
      "defaultProfile",
      "defaultPrompt",
      "discover",
      "discoverRequestSchema",
      "executeRun",
      "finalizeRun",
      "findByIdOrName",
      "idSchema",
      "initProject",
      "llmProviderSchema",
      "machineSchema",
      "modelKeyEnv",
      "modelKeyRequired",
      "modelKindSchema",
      "modelSchema",
      "parseConfig",
      "permissionsSchema",
      "policySchema",
      "projectAnalyzer",
      "promptSchema",
      "providerKeyEnv",
      "providerPreset",
      "providerSchema",
      "providersOf",
      "readOptional",
      "requireKey",
      "resolveBaseURL",
      "resolvePermissions",
      "resolveRepetitionGuard",
      "resolveRunSettings",
      "runProfileSchema",
      "runTask",
      "supportsMode",
      "taskProfile",
      "taskSchema",
    ]
  `); });
  it('pins the cli root', async () => { expect(await exportNames('@rawstep/cli')).toMatchInlineSnapshot(`
    [
      "CLI_USAGE",
      "CliUsageError",
      "formatRunResult",
      "parseCliArguments",
      "runCli",
    ]
  `); });
  it('pins the rawstep facade root', async () => { expect(await exportNames('rawstep')).toMatchInlineSnapshot(`
    [
      "ANALYSIS_SCHEMA_VERSION",
      "AT_DRIVER_KEYS",
      "AtDriverBackend",
      "AtDriverClient",
      "AtDriverError",
      "BUILTIN_PROFILES",
      "DEFAULT_PROFILE",
      "DecisionClient",
      "FOCUS_CONTEXT_CHOICES",
      "FakeSystemOneClient",
      "FileTraceSink",
      "LlmTraceAnalyzer",
      "MAX_SCRIPT_SOURCE",
      "MOCK_VOICEOVER_LIMITATIONS",
      "MOCK_VOICEOVER_PROFILE",
      "MOCK_VOICEOVER_WARNING",
      "MemoryTraceSink",
      "MockVoiceOverBackend",
      "ORCA_NATIVE_PROTOCOL",
      "OrcaBackend",
      "OrcaBridgeClient",
      "OrcaBridgeError",
      "ProfileApplicationError",
      "ProjectError",
      "REDACTED",
      "SCREENSHOT_DECISION_PROMPT",
      "SCREENSHOT_KEYS",
      "SCREENSHOT_MODEL_PROTOCOL",
      "SPEECH_DECISION_PROMPT",
      "STOP_REASON_CHOICES",
      "ScreenshotDecisionPolicy",
      "ScreenshotKeyboardBackend",
      "ScreenshotReplayPolicy",
      "ScriptedPolicy",
      "SystemOneDecisionModel",
      "SystemOneScreenshotAdapter",
      "SystemOneSpeechPolicy",
      "TRACE_SCHEMA_VERSION",
      "TraceRecorder",
      "UnsupportedCorpusPatternError",
      "analyzeSavedTrace",
      "analyzeTrace",
      "applyProfile",
      "assertScreenshotReplayTaskSafety",
      "collectBrowserDiagnostics",
      "createChromiumTabZoomController",
      "createRedactor",
      "decisionError",
      "describeInputs",
      "deterministicAnalyzer",
      "diagnoseScreenshotStop",
      "exportScreenshotReplay",
      "formatSimulatedSpeech",
      "getAtDriverProfile",
      "hydrateScreenshots",
      "isScreenshotRef",
      "listGatewayDecisionModels",
      "loadAnalyzer",
      "loadPolicy",
      "mapOrcaAction",
      "matchesText",
      "modelBaseURL",
      "orcaBridgePath",
      "readAnalysis",
      "readTrace",
      "renderReportHtml",
      "resolveEnvironmentProfile",
      "resolveTask",
      "restrictChoicesByVisualFocus",
      "runMockVoiceOverTask",
      "runScreenshotReplay",
      "runScreenshotTask",
      "runTask",
      "screenshotChoices",
      "screenshotReplayTaskHash",
      "screenshotSha256",
      "speechChoices",
      "summarizeTrace",
      "summarizeTraceEvidence",
      "summarizeVisualExploration",
      "systemOneProviderOptions",
      "traceFilePath",
      "validateAnalysisReport",
      "validateAnalyzerResult",
      "validateModelResponse",
      "validateNavigation",
      "validateScreenshotReplay",
      "validateTrace",
      "verifyLiveProfile",
      "writeJsonAtomic",
      "writeReport",
    ]
  `); });

  it('exposes the high-level runTask on the facade and keeps the browser-safe project config free of Node imports', async () => {
    const facade = await import('rawstep'), project = await import('@rawstep/project');
    expect(facade.runTask).toBe(project.runTask);
    expect(await exportNames('rawstep/runner')).toContain('runTask');
    const config = await readFile('packages/project/dist/config.js', 'utf8');
    expect(config).not.toMatch(/from\s+['"]node:/);
    expect([...config.matchAll(/^import .* from '([^']+)'/gm)].map(match => match[1]).sort()).toEqual(['@rawstep/core/defaults', 'zod']);
    const manifest = JSON.parse(await readFile('packages/project/package.json', 'utf8'));
    expect(Object.keys(manifest.exports)).toEqual(expect.arrayContaining(['.', './config', './store', './plan', './execution', './run', './discover', './llm', './errors']));
  });

  it('keeps package-internal helpers out of every exports-map entry', async () => {
    for (const root of roots) {
      const manifest = JSON.parse(await readFile(manifestPath(root), 'utf8'));
      for (const key of Object.keys(manifest.exports).filter(key => key !== './package.json')) {
        const specifier = key === '.' ? root : `${root}/${key.slice(2)}`;
        expect(Object.keys(await import(specifier)).filter(name => internalNames.includes(name)), specifier).toEqual([]);
      }
    }
  });

  it('keeps the research corpus off the screenreaders root and removed subpaths unexported', async () => {
    const root = await exportNames('@rawstep/screenreaders');
    expect(root).not.toContain('EVIDENCE_CATALOG');
    expect(await exportNames('@rawstep/screenreaders/evidence')).toContain('EVIDENCE_CATALOG');
    const exportsMap = JSON.parse(await readFile(manifestPath('@rawstep/screenreaders'), 'utf8')).exports;
    for (const key of ['./evidence/data', './evidence/learned-data', './run-mock-voiceover', './orca/paths']) expect(exportsMap[key], key).toBeUndefined();
    expect(await exportNames('@rawstep/screenreaders/mock-voiceover')).toEqual(expect.arrayContaining(['runMockVoiceOverTask', 'MOCK_VOICEOVER_WARNING']));
    expect(await exportNames('@rawstep/screenreaders/orca')).toContain('orcaBridgePath');
  });

  it('does not load the evidence corpus data when importing the screenreaders root', () => {
    // A module-loader hook reports every evidence data module that gets loaded in a fresh process.
    const hooks = "export async function load(url, context, next) { if (/\\/evidence\\/(learned-)?data\\.js$/.test(url)) process.stderr.write('LOADED ' + url + '\\n'); return next(url, context); }";
    const register = `import { register } from 'node:module'; register(${JSON.stringify(`data:text/javascript,${encodeURIComponent(hooks)}`)});`;
    const loaded = (specifier: string) => {
      const result = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(register)}`, '--input-type=module', '-e', `await import(${JSON.stringify(specifier)})`], { cwd: process.cwd(), encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
      return result.stderr.match(/LOADED \S+/g) ?? [];
    };
    expect(loaded('@rawstep/screenreaders')).toEqual([]);
    expect(loaded('@rawstep/screenreaders/evidence').length).toBeGreaterThan(0); // control: proves the hook observes loads
  });
});
