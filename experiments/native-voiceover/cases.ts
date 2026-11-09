import type { Task } from '@rawstep/core/contracts';
import type { RunEnding } from '@rawstep/reports/endings';
import type { PlanDraft } from '@rawstep/policies/policy';

type PlanTask = PlanDraft['phases'][number]['tasks'][number];
export type Case = {
  id: string; group: 'smoke' | 'workflow' | 'limit' | 'fault' | 'contract'; purpose: string;
  /**
   * What a person wants done here, all a planner model is told. It names no key, way of moving or page structure. A case without one
   * stays on its written plan even with a model: it sets up a fault or a refusal that a model would plan its way around.
   */
  userGoal?: string;
  page: string; tasks: PlanTask[]; actions: string[]; speech: string[];
  input?: Task['input']; replace?: boolean; survey?: boolean;
  fault?: 'cancel' | 'disconnect' | 'focus-loss'; timeoutMs?: number;
  /** How many documents the run has to get the reader into. Every case that reaches page content goes into at least the first. */
  pages?: number;
  /** A rotor routine the case exercises, proved by the keys that only a found list leads to: Down reads a list, Return picks from it. */
  rotor?: 'reads-list' | 'picks-item';
  expected: { status: string; reason?: string; errorCode?: string; ending?: RunEnding; confirmed?: false };
};

const move = (cue: string, intent = 'next'): PlanTask => ({ goal: `Find ${cue}`, done: `Hear ${cue}`, cue, activates: false, moves: [intent] });
const press = (cue = 'Completed'): PlanTask => ({ goal: 'Activate the current item', done: `Hear ${cue}`, cue, activates: true });
const type = (name = 'query'): PlanTask => ({ goal: `Enter the provided ${name}`, done: 'The input was entered', cue: '', types: name });
const success = { status: 'success', reason: 'verified', ending: 'reached' } as const;
/** The page reached its goal, and nothing shows the user knew: a note beside the ending. */
const unconfirmed = { ...success, confirmed: false } as const;
/** What VoiceOver says when a new page opens: its title and "web content". The page's own text comes only when the cursor walks to it. */
const newPage = 'Native engine check web content';

/**
 * Plans describe what to hear, never DOM selectors. The fixture verifier alone reads page state. Real VoiceOver starts on the browser
 * window and goes back there on every page load; the engine gets it into the page, so no plan here walks there itself.
 */
export const CASES: readonly Case[] = [
  { id: 'S01-button', userGoal: 'Finish the check on this page.', group: 'smoke', purpose: 'Item navigation, activation, native output and task verification', page: 'button',
    tasks: [move('Finish check'), press()], actions: ['intent:next', 'intent:activate'], speech: ['Finish check'], expected: success },
  { id: 'S02-heading', userGoal: 'Go to the target section of this page and finish the check there.', group: 'smoke', purpose: 'Heading navigation followed by item navigation and activation', page: 'heading',
    tasks: [move('Target section', 'heading.next'), move('Finish check'), press()], actions: ['intent:heading.next', 'intent:activate'], speech: ['Target section'], expected: success },
  { id: 'S03-navigation', userGoal: 'Open the destination page and find out whether the check is completed there.', group: 'smoke', purpose: 'Follow a link to a new document and walk on to its confirmation', page: 'link', pages: 2,
    tasks: [move('Open destination', 'link.next'), press(newPage), move('Completed')], actions: ['intent:link.next', 'intent:activate', 'intent:next'], speech: ['Open destination', 'Destination reached', 'Completed'], expected: success },
  { id: 'W01-input', userGoal: 'Enter the query you were given and submit the check.', group: 'workflow', purpose: 'Find an edit field, enter ASCII text using native keys and submit', page: 'form', input: { query: 'TEST42' },
    tasks: [move('Query', 'form.next'), type(), move('Submit check', 'form.next'), press()], actions: ['intent:form.next', 'typeText', 'intent:activate'], speech: ['Query'], expected: success },
  { id: 'W02-replace', userGoal: 'Change the query on this form to the one you were given and submit the check.', group: 'workflow', purpose: 'Replace a prefilled value; verify replacement rather than appending', page: 'replace', input: { query: 'TEST42' }, replace: true,
    // VoiceOver says a filled field's value and caret before its name, and a plan file ends a task only on its cue as written.
    tasks: [move('OLD Insertion at end of text. Query edit text', 'form.next'), type(), move('Submit check', 'form.next'), press()], actions: ['replaceText', 'intent:activate'], speech: ['Query'], expected: success },
  { id: 'W03-form', userGoal: 'Enter the query and the code you were given and submit the check.', group: 'workflow', purpose: 'Enter two named inputs and submit a complete form', page: 'two-fields', input: { query: 'TEST42', code: 'CODE7' },
    tasks: [move('Query', 'form.next'), type(), move('Code', 'form.next'), type('code'), move('Submit check', 'form.next'), press()],
    actions: ['typeText', 'typeText', 'intent:activate'], speech: ['Query', 'Code'], expected: success },
  { id: 'W04-dialog', userGoal: 'Open the dialog, then close it.', group: 'workflow', purpose: 'Open a modal, follow the changed focus and close it', page: 'dialog',
    // Opening moves the cursor onto the close button by itself, so the next press closes it. Literal VoiceOver speech.
    // Closing moves focus back and VoiceOver speaks that, not the status the page updated at the same moment.
    tasks: [move('Open dialog'), press('dialog with 2 items Close dialog button'), press('Open dialog button main')], actions: ['intent:activate', 'intent:activate'], speech: ['Open dialog', 'Close dialog'], expected: unconfirmed },
  { id: 'W05-headings-rotor', userGoal: 'Go to the target section of this page and finish the check there.', group: 'workflow', purpose: 'Read the headings list through the product initial survey, then finish the task', page: 'heading', survey: true, rotor: 'reads-list',
    tasks: [move('Target section', 'heading.next'), move('Finish check'), press()], actions: ['intent:headings.list', 'intent:heading.next', 'intent:activate'], speech: ['Target section'], expected: success },
  { id: 'W06-form-rotor', userGoal: 'Enter the query you were given and submit the check.', group: 'workflow', purpose: 'Open the form controls rotor, pick a field, type and submit', page: 'form', input: { query: 'TEST42' }, rotor: 'picks-item',
    tasks: [move('Query', 'formControls.rotor'), type(), move('Submit check', 'form.next'), press()], actions: ['intent:formControls.rotor', 'typeText', 'intent:activate'], speech: ['Query'], expected: success },
  { id: 'W07-delayed', userGoal: 'Finish the check on this page.', group: 'workflow', purpose: 'Handle a live-region update 1.5 seconds after activation', page: 'delayed',
    tasks: [move('Finish check'), press()], actions: ['intent:activate'], speech: ['Finish check'], expected: success },
  { id: 'W08-late', userGoal: 'Finish the check on this page.', group: 'workflow', purpose: 'Keep a completion update delayed by 4.5 seconds; expose collection-window limits', page: 'late',
    tasks: [move('Finish check'), press()], actions: ['intent:activate'], speech: ['Finish check'], expected: success },
  { id: 'W09-silent', userGoal: 'Finish the check on this page.', group: 'workflow', purpose: 'Separate a verified page change from whether its confirmation was heard', page: 'silent',
    tasks: [move('Finish check'), press()], actions: ['intent:activate'], speech: ['Finish check'], expected: unconfirmed },
  { id: 'W10-next-page', userGoal: 'Open the next page and finish the check there.', group: 'workflow', purpose: 'Carry on with the task on the document a link leads to', page: 'onward', pages: 2,
    tasks: [move('Open next page', 'link.next'), press(newPage), move('Finish check'), press()], actions: ['intent:link.next', 'intent:activate', 'intent:next', 'intent:activate'], speech: ['Open next page', 'Next page', 'Finish check', 'Completed'], expected: success },
  { id: 'L01-missing-target', userGoal: 'Find the Submit payment button on this page and press it.', group: 'limit', purpose: 'Walk a page to its end looking for what is not there, under the default rules', page: 'button', timeoutMs: 60_000,
    tasks: [move('This cue never exists')], actions: ['intent:next'], speech: ['Finish check', 'end of main'], expected: { status: 'failure', reason: 'policy-stuck', ending: 'gave-up' } },
  { id: 'F01-timeout', group: 'fault', purpose: 'End a non-progressing task by its actual task deadline', page: 'button', timeoutMs: 20_000,
    tasks: [move('This cue never exists')], actions: ['intent:next'], speech: [], expected: { status: 'inconclusive', reason: 'timeout' } },
  { id: 'F02-cancel', group: 'fault', purpose: 'Cancel after a real native movement; verify bounded cleanup', page: 'button', fault: 'cancel',
    tasks: [move('This cue never exists')], actions: ['intent:next'], speech: [], expected: { status: 'aborted', reason: 'aborted' } },
  { id: 'F03-disconnect', group: 'fault', purpose: 'Drop only this run’s TCP connection after an acknowledged native movement', page: 'button', fault: 'disconnect',
    tasks: [move('This cue never exists')], actions: ['intent:next'], speech: [], expected: { status: 'failure', reason: 'error' } },
  { id: 'F04-focus-loss', group: 'fault', purpose: 'Move foreground to Finder before the first key; the harness must prevent dispatch', page: 'button', fault: 'focus-loss',
    tasks: [move('Finish check'), press()], actions: [], speech: [], expected: { status: 'aborted', reason: 'aborted' } },
  { id: 'C01-simulation-only', group: 'contract', purpose: 'Reject readCurrent before opening a native session', page: 'button',
    tasks: [move('Finish check', 'readCurrent')], actions: ['intent:readCurrent'], speech: [], expected: { status: 'not-started', errorCode: 'unsupported-action' } },
  { id: 'C02-unicode', group: 'contract', purpose: 'Reject unmappable text before select-all/delete or any character is sent', page: 'form', input: { query: '한글' },
    tasks: [], actions: [], speech: [], expected: { status: 'not-started', errorCode: 'unsupported action' } },
];

export function planFor(c: Case): PlanDraft {
  return { complete: false, rationale: '', strategy: c.purpose, criteria: [{ id: 'C1', text: 'The independent fixture state check passes' }], assumptions: [],
    phases: [{ title: c.id, criteria: ['C1'], tasks: c.tasks }] };
}

export const BASE_INTENTS = ['next', 'previous', 'activate', 'heading.next', 'form.next', 'link.next', 'formControls.rotor'];
/** What a planner model may use. Not `links.list`: it has not been run on a live VoiceOver. */
export const MODEL_INTENTS = [...BASE_INTENTS, 'headings.list'];
