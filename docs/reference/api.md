# Programmatic TypeScript API

Rawstep is published as a single package (`rawstep`) with modular subpath exports (`rawstep/*`). You can run single tasks, execute multi-profile suites, inspect traces, or extract friction hints directly from TypeScript or JavaScript.

---

## 1. Subpath Exports Overview

| Import Path | Key Exports |
| :--- | :--- |
| **`rawstep`** | Root barrel re-exporting `runTask`, `runSuite`, `extractHints`, `aggregateHints`, `runEnding`, `readTrace`, `OrchestratedSpeechPolicy`, `LlmPlanner`, `MockVoiceOverBackend`, `AtDriverBackend`, `writeReport`, and core contracts. |
| **`rawstep/project`** | `runTask`, `runSuite`, `ProjectStore`, `initProject`, `parseConfig`, `defaultConfig`, `PROVIDERS`, `ProjectError`. |
| **`rawstep/contracts`** | `resolveTask`, `validateNavigation`, `describeInputs`, `matchesText`, `Task`, `VerifyRule`, `DecisionPolicy`, `Backend`, `ScreenReaderObservation`. |
| **`rawstep/policy`** | `OrchestratedSpeechPolicy`, `FixedPlanner`, `followPlan`, `applyDraft`, `renderPlanMarkdown`, `speechChoices`, `ScriptedPolicy`, `loadPolicy`. |
| **`rawstep/runner`** | Low-level `runWithPolicy(task, options)`, `RunOptions`, `validateDecision`, `confirmationHeard`. |
| **`rawstep/mock-voiceover`** | `MockVoiceOverBackend`, `runMockVoiceOverTask`, `formatSimulatedSpeech`, `MOCK_VOICEOVER_PROFILE`. |
| **`rawstep/at-driver`** | `AtDriverBackend`, `AtDriverClient`, `getAtDriverProfile`, `AT_DRIVER_KEYS`, `AtDriverError`. |
| **`rawstep/hints`** | `extractHints`, `aggregateHints`, `writeHints`, `selectReference`, `summarizeRun`, `runEnding`, `DEFAULT_HINT_THRESHOLDS`, `HINTS_SCHEMA_VERSION` (`"3.0"`), `buildBatchSummary`, `compareSummaries`, `SUMMARY_SCHEMA_VERSION` (`"1.0"`). |
| **`rawstep/report`** | `renderReportHtml`, `writeReport`, `summarizeTrace`. |
| **`rawstep/analyze`** | `analyzeTrace`, `analyzeSavedTrace`, `deterministicAnalyzer`, `LlmTraceAnalyzer`, `readAnalysis`. |
| **`rawstep/trace`** | `TraceRecorder`, `FileTraceSink`, `MemoryTraceSink`, `readTrace`, `validateTrace`, `createRedactor`, `TRACE_SCHEMA_VERSION` (`"3.0"`). |
| **`rawstep/verify`** | `verifyTask`, `evaluateVerifyRule`, `runScriptCheck`, `formatVerificationFeedback`. |
| **`rawstep/browser`** | `createBrowserSession`, `closeBrowserSession`, `settlePage`, `isBotCheckPage`, `watchPageActivity`. |
| **`rawstep/profiles`** | `resolveEnvironmentProfile`, `BUILTIN_PROFILES`, `DEFAULT_PROFILE`, `applyProfile`, `verifyLiveProfile`, `collectBrowserDiagnostics`. |
| **`rawstep/evidence`** | Read-only data on 2,914 third-party reported-result records, used to measure what evidence covers and where it has gaps (runs do not use it): `EVIDENCE_CATALOG`, `formatEvidenceSpeech`, `formatCorpusSpeech`, `summarizeEvidenceCoverage`, `selectEvidenceCases`, `compareEvidenceCase`, `runCorpusMockTask`. |
| **`rawstep/cli`** | `runCli`, `parseCliArguments`, `CLI_USAGE`, `CliUsageError`. |

---

## 2. Usage Examples

### 2.1 Run a Project Task or Suite (`rawstep/project`)

When your project has a `rawstep.config.json`:

```typescript
import { runTask, runSuite } from 'rawstep/project';
import { runEnding } from 'rawstep/hints';

// Run a single task 3 times under a profile
const taskResult = await runTask('checkout', {
  projectDir: process.cwd(),
  profile: 'by-headings',
  repeat: 3,
});

for (const run of taskResult.runs) {
  const stopSource = run.outcome?.policyStopSource;
  const ending = runEnding(run.outcome, typeof stopSource === 'string' ? stopSource : undefined);
  console.log(run.runId, ending?.ending ?? 'no outcome', `moves=${run.hints.steps}`);
}

// Or run a tagged suite across multiple profiles in parallel
const suiteResult = await runSuite({
  projectDir: process.cwd(),
  tags: ['smoke'],
  profiles: ['linear', 'by-headings'],
  repeat: 2,
  parallel: 2,
});

console.log('Batch saved at:', suiteResult.batch.dir);
```

### 2.2 Run a Standalone Simulated VoiceOver Task (`rawstep/mock-voiceover` + `rawstep/policy`)

Run a task in code without `rawstep.config.json` using a pre-written plan (`FixedPlanner`) or custom `Planner`:

```typescript
import { createHash } from 'node:crypto';
import { runMockVoiceOverTask } from 'rawstep/mock-voiceover';
import { OrchestratedSpeechPolicy, FixedPlanner } from 'rawstep/policy';
import type { PlanDraft } from 'rawstep/policy';
import { extractHints, runEnding } from 'rawstep/hints';

const draft: PlanDraft = {
  complete: false,
  rationale: 'Jump to the main heading and activate the Sign Up button.',
  strategy: 'Use headings navigation, then step to the CTA button.',
  criteria: [{ id: 'C1', text: 'Confirmation message is announced' }],
  assumptions: [{ id: 'A1', text: 'Sign Up button announces confirmation' }],
  phases: [
    {
      title: 'Reach and activate Sign Up',
      criteria: ['C1'],
      tasks: [
        {
          goal: 'Move to the Sign Up button',
          done: 'Sign Up, button is heard',
          cue: { name: 'Sign Up', role: 'button' },
          moves: ['next'],
          serves: ['C1'],
          relies: ['A1'],
        },
        {
          goal: 'Activate the Sign Up button',
          done: 'Welcome confirmation is heard',
          cue: 'Welcome',
          activates: true,
          serves: ['C1'],
          relies: ['A1'],
        },
      ],
    },
  ],
};

// The second argument records where the plan came from (a file name and the SHA-256 of its content).
const planner = new FixedPlanner(draft, {
  file: 'sign-up-plan.json',
  sha256: createHash('sha256').update(JSON.stringify(draft)).digest('hex'),
});

// `outDir` is a folder path; the trace (trace.json, trace.jsonl) is written there.
const trace = await runMockVoiceOverTask(
  {
    url: 'https://example.com',
    goal: 'Activate the Sign Up button',
    verify: {
      all: [{ textVisible: 'Welcome' }],
    },
  },
  {
    policy: new OrchestratedSpeechPolicy(planner),
    outDir: './out/sign-up-run',
  }
);

const stopSource = trace.outcome?.policyStopSource;
console.log('Ending:', runEnding(trace.outcome, typeof stopSource === 'string' ? stopSource : undefined));
console.log('Hints:', extractHints(trace).hints);
```

### 2.3 Extract Hints & Generate Reports Offline (`rawstep/trace`, `rawstep/hints`, `rawstep/report`)

```typescript
import { readTrace } from 'rawstep/trace';
import { extractHints } from 'rawstep/hints';
import { writeReport } from 'rawstep/report';

const trace = await readTrace('.rawstep/experiments/<batch-id>/<run-id>');
const hints = extractHints(trace);

const { htmlPath, jsonPath } = await writeReport(
  trace,
  undefined,
  '.rawstep/experiments/<batch-id>/<run-id>',
  { hints }
);

console.log('Generated HTML report:', htmlPath);
```

## Writing Your Own Policy

When calling `runMockVoiceOverTask` or `runWithPolicy` (`rawstep/runner`) from code, you can implement the `DecisionPolicy` interface directly (or load a `.mjs`/`.js` policy module with `loadPolicy`):

```typescript
import type { DecisionPolicy } from 'rawstep/contracts';
import { runMockVoiceOverTask } from 'rawstep/mock-voiceover';

const myPolicy: DecisionPolicy = {
  async decide({ observation, allowedActions }) {
    const spoken = observation.speech.join(' ');
    if (spoken.includes('Get started') && allowedActions.intents.includes('activate')) {
      return { action: { kind: 'intent', intent: 'activate' } };
    }
    return { action: { kind: 'intent', intent: 'next' } };
  },
};

const trace = await runMockVoiceOverTask(
  {
    url: 'https://example.com',
    goal: 'Press Get started',
    verify: { all: [{ textVisible: 'Welcome' }] },
  },
  { policy: myPolicy, outDir: './out/custom-policy-run' }
);
```

---

## 3. Local Repository Development Commands

When working on the Rawstep monorepo itself:

```bash
# Install workspace dependencies (requires Node >= 22.12.0 and pnpm 10)
corepack enable pnpm
pnpm install

# Build all packages in dependency order and bundle packages/rawstep
npm run build

# Run TypeScript typechecking across all packages and tests
npm run typecheck

# Run the unit test suite (Vitest)
npm test

# Run the serial Playwright browser integration tests
npm run test:integration

# Pack packages/rawstep into a tarball and run isolated package smoke tests
npm run test:package

# Run the full pre-push verification gate (build + typecheck + unit + integration + package smoke)
npm run check
```
