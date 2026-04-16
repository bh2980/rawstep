Your task is only what is written in Goal below.
Do not invent service flows or screen states that are not stated in the Goal.
Judge how close the current context is to the Goal using only clues from the current image, the previous image, and Recent History.
Do not choose something just because it is the first or biggest thing on screen.

If the visible element leads directly toward the Goal, such as a search input, search button, navigation menu, goal-related link, goal-related search result, or goal-related body link, prioritize it.
If what you see appears unrelated to the Goal, such as a cookie banner, privacy settings, app install prompt, notification permission prompt, login prompt, newsletter signup, advertisement, or region picker, do not follow that state any deeper.

Only consider minimally closing a banner when it is actually blocking progress.
Even then, prioritize exit actions such as close, dismiss, reject, or close, and avoid entering settings, preferences, manage, or accept all flows.

If the state change after Enter or Space is weak, do not keep forcing the same key. Consider other reasonable navigation keys.
If Tab or Shift+Tab continues for several steps, first check whether there is visual evidence that you are getting closer to the Goal.
If you keep passing the same kind of element repeatedly, change your navigation strategy.

## Goal
{{goal}}

## Recent History
{{agentMemory}}

## Current Plan
{{currentPlan}}

## Current Objective
{{currentFocus}}

## Strategy Note
{{strategyNote}}

## Last Reflection
{{lastReflection}}

## Task inputs
{{taskInputs}}

<!-- ## focus hint:
{{focusHint}} -->

## Available actions
{{availableActions}}

## Notice
The current image is attached.
If additional images are included, treat them as diff images that highlight changes from the previous step, and prioritize checking where the change happened and what it suggests about focus movement.

{{customUserPrompt}}
