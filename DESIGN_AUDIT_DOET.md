# DESIGN_AUDIT_DOET.md

A scoring rubric for any Chippi surface, derived from Norman's *The Design of
Everyday Things*.

## What this is

A checklist. Pick a surface (FocusCard, the Chippi bar composer, an
onboarding stage, an AlertDialog, the settings page, an error fallback), open
it, and run the surface against the eleven checks below. Each check is
1-to-5. You finish with a number, a list of failed checks, and — for every
failure — a named fix pattern.

**When to apply.** Any time a surface ships, before merge. Any time a surface
feels "off" in use. Any time you suspect featuritis. Any time a reviewer
asks "is this good?" and you want a defensible answer instead of taste.

**Who scores.** Anyone working on the surface, including the agent. The
rubric is designed so a junior engineer produces the same score a senior
would, because every check names what passing looks like, in Chippi's
vocabulary, with concrete examples. Score from the code, not from memory.

**Scoring scale (every check).**

| Score | Means |
|---|---|
| 5 | Exemplary — this is how the rest of the product should learn the principle. |
| 4 | Passing — meets the bar, no fix needed. |
| 3 | Soft fail — works but degrades on edge cases, low-end devices, or under stress. Open a follow-up. |
| 2 | Fail — a realtor will hit this in a normal session and feel it. Fix before merge. |
| 1 | Broken — the surface mis-communicates or makes an irreversible wrong action easy. Block the ship. |

The surface's score is the **minimum** of all checks, not the average. One
broken check breaks the surface — averaging hides it. Average is for
reports; minimum is for decisions.

---

## 1. Discoverability

**Question scored.** A realtor opens this surface for the first time. Without
reading docs, hovering tooltips, or asking Chippi, can they name every
action they can take here?

**Passes when.** Every available action is visible as a control or as a
labeled affordance. The FocusCard's Send / Edit / Hold for later trio is
visible the moment the card lands — no menu, no "..." overflow, no hover
discovery. The chippi-bar shows its placeholder text *and* the send arrow
*and* the mic icon at rest.

**Fails when.** Primary actions hide behind a kebab, a long-press, an
unmarked icon, or a hover-only state. Mobile users especially: hover does
not exist. The classic fail is a settings page where the destructive action
is one of nine equal-weight rows with no signal that it's the one that ends
the session.

**Score scale.**

| Score | What it looks like |
|---|---|
| 5 | Every action is visible AND labeled with a verb. A new realtor in a usability test names them all. |
| 4 | Every action is visible. Two are icon-only but the icons are unambiguous (mail, send). |
| 3 | One primary action is icon-only with no tooltip, or a secondary action is in an overflow menu. |
| 2 | Primary action is hover-revealed or hidden in a menu. |
| 1 | The surface looks finished but a required action is undiscoverable without docs. |

**Fix pattern.** Promote one hidden action per pass. Surface the verb in
text where space allows; pair an icon with a tooltip where it does not. If
a kebab is hiding more than two items, the surface has too many actions and
the question is not "where do they go" but "which ones get cut."

---

## 2. Understanding

**Question scored.** Once the realtor sees the controls, does the surface
match the mental model they already brought with them — a working
professional running a book of business — or does it force them to learn
Chippi's internal terms?

**Passes when.** Labels are the realtor's words, not the product team's.
"Drafts" not "AgentDraftQueue". "Sent" not "delivery_state=delivered". The
status sentence under every h1 reads the surface in one sentence: "You
have 3 leads to follow up with." A realtor who has never used a CRM can
read this and act.

**Fails when.** The screen uses table names, API status codes, or product
neologisms. A realtor sees "intake activation" without context, or
"awaiting_signoff" in chrome, or a verb that demands they remember whether
"Resolve" means "close" or "approve."

**Score scale.**

| Score | What it looks like |
|---|---|
| 5 | Copy reads like a sharp colleague. One status sentence per page; verbs are unambiguous. |
| 4 | Copy is mostly the realtor's vocabulary. One label could be tightened in a polish pass. |
| 3 | One control uses product-internal language a new realtor would have to map. |
| 2 | Multiple labels are internal jargon. The surface needs a glossary to operate. |
| 1 | Copy is engineering-facing: enum values, table names, or untranslated codes are user-visible. |

**Fix pattern.** Write one status sentence per page first; design around it.
Replace every noun with the realtor's noun. Replace every enum with a verb.
If a label needs a tooltip to be understood, the label is wrong.

---

## 3. Affordances + Signifiers

**Question scored.** Does each control *look like* what it does, and is
that look reinforced by a signifier (label, icon, position) the realtor can
read at a glance?

**Passes when.** The default button (black, rounded-md, h-9) reads as
primary because it carries the most foreground weight on the page. The
outline button reads as secondary because it has weight only on its
border. The CHIPPI_PILL reads as "this calls Chippi" because the warm
hover halo signifies the brand. The destructive AlertDialog action is red
because red is the cultural signifier for stop. Inputs read as inputs
because their border + radius + h-9 match the Chippi input vocabulary —
not a div pretending to be a field.

**Fails when.** A clickable div has no hover state. A drop zone has no
border-dashed signifier. A primary action sits in outline style next to a
loud orange decoration that *isn't* clickable. A ghost button looks
identical to a label. An icon that triggers an action looks identical to
one that's decorative.

**Score scale.**

| Score | What it looks like |
|---|---|
| 5 | Every interactive element has hover, focus, and active states. Decorative elements never look interactive. |
| 4 | Affordances are clean; one tertiary control could carry a slightly stronger signifier. |
| 3 | One control's affordance is weak (e.g., link styled as plain text without underline-on-hover). |
| 2 | A primary action visually equals a secondary action; the realtor has to read to choose. |
| 1 | Decorative elements appear interactive, or interactive elements look like decoration. |

**Fix pattern.** Reach for the `components/ui/button.tsx` cva variants
instead of hand-rolling. Use the destructive variant for irreversible
actions. Add `active:scale-[0.98]` on anything that ought to feel like a
press. Never style a non-button to look like a button — promote it to a
real button or strip the affordance.

---

## 4. Mappings

**Question scored.** Is the spatial relationship between a control and the
thing it controls correct? When the realtor moves their eye from the control
to the result, is the path obvious?

**Passes when.** The FocusCard's Send button sits at the bottom of the
draft it sends — controls are with the content. The composer's send arrow
is inside the input rim, immediately right of the text. The sidebar's
active rail sits on the left edge of the active row — the indicator hugs
the item it indicates. The status sentence sits directly under the page
title — the explainer is with the thing it explains.

**Fails when.** A "Save" button at the bottom of a long settings page
controls a toggle at the top — the realtor has to remember the change to
verify the save. An action on row N affects rows M and K with no spatial
hint. A modal's "Confirm" verb is on the opposite side from where the user
just dragged the slider.

**Score scale.**

| Score | What it looks like |
|---|---|
| 5 | Every control is adjacent to or pointing at its result. No scrolling to verify. |
| 4 | Mappings are clean; one control-and-result pair is one viewport apart but signposted. |
| 3 | One control affects state out of viewport with no immediate confirmation in viewport. |
| 2 | Multiple controls map ambiguously; the realtor experiments to find what changed. |
| 1 | A control changes a different surface entirely with no link or hint. |

**Fix pattern.** Move the control to the content. Where that's not possible
(long-form settings), put the save action in a sticky footer with an
inline summary of what changed. If a control affects another surface,
show the change inline on the originating surface with a one-line
confirmation or a toast (Chippi voice: lowercase verb, period).

---

## 5. Feedback

**Question scored.** Every action the realtor takes — does it get
acknowledged with the *right amount* of signal? Too little is the same as
none. Too much is annoying. Delayed is abandonment-bait.

**Passes when.** A draft approval lands a one-sentence toast ("Sent to
Sarah Chen.") within 200ms. The composer's send arrow disables and shows
the loader the moment it's pressed. The chippi-bar shows the
"Chippi is thinking" thinking state before the first token streams. Errors
arrive as one calm sentence ("I lost the connection. Try again.") with the
recovery action attached. Long-running work (>1s) shows a status line
before silence becomes confusing.

**Fails when.** A button looks the same after press as before press. A
modal closes silently with no toast confirming what happened. A slow
network turns a 4-second action into invisible work — no spinner, no
disabled state, just dead silence. A toast pile-on fires three toasts for
one logical action.

**Score scale.**

| Score | What it looks like |
|---|---|
| 5 | Every action acknowledges within 200ms. Long actions show progressive status. Errors are calm, named, and recoverable. |
| 4 | Acknowledgment is clean; one slow path could surface a status line earlier. |
| 3 | Synchronous actions feel right; an async path goes silent for >1s. |
| 2 | Multiple actions lack any acknowledgment, or feedback is loud where calm is needed (animated confetti on a routine send). |
| 1 | A destructive action returns no feedback at all, or a failed action shows a stack trace. |

**Fix pattern.** Wire the button's disabled + loader state to the request
lifecycle. Show a one-sentence Chippi-voiced toast on success. On error,
say what happened in one sentence and offer the recovery action inline. If
work exceeds 1s, replace the spinner with a status line ("Drafting…",
"Reading the thread…") — the realtor reads "Chippi is working" as
confidence; a naked spinner reads as "the page is broken."

---

## 6. Constraints

**Question scored.** Are wrong actions blocked, hidden, or made difficult?
Or does the surface let the realtor walk into a known mistake and then
clean up after?

**Passes when.** The send button is disabled while a draft is empty. The
intake link's slug field rejects invalid characters at the keystroke, not
at submit. The role picker in onboarding offers two choices, not a free
text field. The AlertDialog forces a Cancel-or-Confirm choice — there's no
ambiguous third path. The composer can't submit an empty message. The
broker permission helpers (`requireBroker`, etc.) prevent a non-broker
from reaching a broker-only action *before* the surface renders, not
after.

**Fails when.** A surface accepts garbage input, validates on submit, and
returns a long error message. A delete button is enabled even when nothing
is selected. A form lets the realtor enter a phone number with letters in
it. A toggle is interactive while disabled.

**Score scale.**

| Score | What it looks like |
|---|---|
| 5 | All four constraint types apply (physical layout, cultural color, semantic context, logical disabling). Wrong actions are impossible. |
| 4 | Constraints are sound; one validation could move from submit to keystroke. |
| 3 | One known wrong action is allowed and surfaced as an error after the fact. |
| 2 | Multiple wrong actions are allowed; the realtor learns by submitting. |
| 1 | An irreversible wrong action is enabled with no confirmation. |

**Fix pattern.** Disable the button when the form is invalid. Validate as
the realtor types, not on submit. Constrain the input shape (numeric
inputs, slug normalization, phone masks). Reach for AlertDialog (not
Dialog) when the action is irreversible. Where two paths are possible,
pick one — configuration is failure to decide.

---

## 7. Error handling

**Question scored.** When something goes wrong — network, validation,
agent failure — does the surface prevent the error, undo it, or recover
it? And does it speak about it like a colleague, not a stack trace?

**Passes when.** Drafts can be edited before send and held for later if
the realtor isn't ready. Approval is the gate, not the undo. Toasts on
failed sends say "Couldn't send that. Try again." in Chippi voice and
keep the draft in place — the realtor doesn't lose work. The Chippi bar's
"I lost the connection. Try again." is one sentence and recoverable.
Where an action is irreversible (disable Chippi, delete a workspace), the
AlertDialog gates with explicit Confirm/Cancel. The trust promise in
onboarding — "I draft. You approve. Nothing leaves without your name on
it." — is the constraint at the system level.

**Fails when.** A failed action wipes the realtor's input. An error
message reads as engineering ("400 Bad Request"). A destructive action has
no confirmation. Undo doesn't exist for an action where a mistake is
predictable. The surface treats the wrong action as the realtor's fault
("Invalid entry") instead of helping them complete it ("That phone number
needs 10 digits — I'll add the area code if you tell me where").

**Score scale.**

| Score | What it looks like |
|---|---|
| 5 | Errors prevented at constraint time. Undo or hold available for predictable mistakes. Copy is calm and helpful. |
| 4 | Error handling is sound; one edge-case error could carry the recovery action inline. |
| 3 | An error blames the realtor instead of guiding them, or the recovery action requires extra clicks. |
| 2 | Multiple errors leak engineering terms or wipe input on failure. |
| 1 | An irreversible action lacks confirmation, or a failed send loses the realtor's work. |

**Fix pattern.** Preserve input on every failure path. Replace error codes
with one-sentence Chippi voice. Add an undo or a hold for any predictable
mistake. Add an AlertDialog for irreversible work. Treat the realtor's
action as an approximation to a goal — guide them to the goal instead of
rejecting the input.

---

## Chippi-specific checks

Three checks specific to an autonomous-agent product. The surface isn't a
passive form — the agent does work on the realtor's behalf, so the bar
shifts.

## 8. Gulf bridging (execution + evaluation)

**Question scored.** Norman's two gulfs. **Execution**: how does the
realtor make Chippi do what they want? **Evaluation**: how does the
realtor verify Chippi did the right thing? A surface that bridges only
one is half-built.

**Passes when.** The Chippi bar bridges execution with the composer (one
keystroke ⌘/ from anywhere, plain natural language input) AND evaluation
with the floating panel above it showing the live exchange, the
"thinking" state, the live call IDs, and a link out to the full
transcript. The FocusCard bridges execution (Send / Edit / Hold) AND
evaluation (the draft text is visible, the reasoning is one click away,
the toast after send names who was sent to). Onboarding's `reveal` stage
bridges both — the realtor literally watches Chippi work in real time, no
ambiguity about what just happened.

**Fails when.** Execution is easy but the realtor can't verify the result
("did it actually send?"). Or the result is visible but the path to *do
anything* is unclear ("I see Chippi drafted this, now what?"). Or the
agent does work in the background with no surface that names what it did
(no morning replay, no activity feed, no toast).

**Score scale.**

| Score | What it looks like |
|---|---|
| 5 | Both gulfs explicitly bridged. The surface has a "do this" affordance and a "here's what happened" affordance in the same view. |
| 4 | Both bridged; one side is one click away rather than inline. |
| 3 | One gulf is bridged inline; the other requires navigation to a different surface. |
| 2 | Execution is clear, evaluation is silent (or vice versa). |
| 1 | Neither gulf is bridged — the realtor types and hopes. |

**Fix pattern.** For execution, give the surface one canonical verb +
control + keyboard shortcut. For evaluation, show the result inline:
toast on success, status line during work, transcript visible after.
Where the result lives elsewhere, link to it with the recovery verb
("see what I sent →") in the same toast that confirms it.

---

## 9. Three-level processing (visceral, behavioral, reflective)

**Question scored.** Does the surface land all three of Norman's
processing levels — visceral (first glance), behavioral (next action
matches expectation), reflective (would a realtor tell three friends)?

**Passes when.** **Visceral**: the surface reads calm, paper-flat, with
one focal element. Serif Times h1 + status sentence. No competing
elements. The brand orange shows up only where Chippi spoke. **Behavioral**:
every control does what its shape predicts. Buttons press with the 0.98
scale; the send arrow sends; the AlertDialog cancels with Cancel.
**Reflective**: after using the surface, the realtor could explain to a
peer what Chippi just did for them and why it was worth it. The morning
replay, the typed onboarding reveal, the FocusCard's "one decision at a
time" — these are the surfaces a realtor screenshots and sends to another
realtor.

**Fails when.** Visceral: the surface is loud, busy, or has two focal
elements competing. Behavioral: a control's effect surprises the realtor
(the "Save" button discards changes; the X closes the page instead of the
modal). Reflective: the realtor finishes the task but couldn't explain
the value to anyone — the surface did something, but it wasn't worth
talking about.

**Score scale.**

| Score | What it looks like |
|---|---|
| 5 | First glance is calm and focal. Every interaction confirms expectation. The surface is the one a realtor screenshots. |
| 4 | Visceral and behavioral pass; reflective is sound but not memorable — it works, but no one is telling anyone about it. |
| 3 | One level fails — usually visceral (too busy) or reflective (no story to tell). |
| 2 | Two levels fail. Surface works mechanically but feels generic or noisy. |
| 1 | All three fail. The surface is a configuration page pretending to be a product. |

**Fix pattern.** Visceral: cut one focal competitor. The screen has one h1
and one status sentence; everything else recedes. Behavioral: align every
control to the cva variants in `components/ui/*`. Reflective: name the
single emotional outcome of the surface in one sentence. If the sentence
is "this gets out of the way," the visual chrome should disappear. If the
sentence is "Chippi did the work overnight," show the work, not the
diagnostics.

---

## 10. Knowledge balance (in the world vs. in the head)

**Question scored.** Norman's central insight, sharpened for an
agentic product: does this surface let knowledge live in the world (the
agent does it, the system remembers it, the screen shows it) instead of
forcing the realtor to carry it in their head?

**Passes when.** The realtor doesn't have to remember the lead's
context — the FocusCard surfaces the contact name, the draft, the
reasoning, the channel. The realtor doesn't have to remember how to draft
in their own voice — the onboarding reveal does it. The realtor doesn't
have to remember which leads need follow-up — Chippi opens the day with
the status sentence. Slugs auto-derive from business names; the realtor
edits only if they want to. The intake link's URL is constructed; the
realtor doesn't type it.

**Fails when.** The surface asks the realtor to remember context Chippi
already has. The realtor is asked to retype the lead's name when Chippi
knows it. The realtor has to maintain a mental model of which leads are
"hot" instead of seeing the lead-warm pill. A settings page forces the
realtor to pick from twelve toggles instead of one decided default. The
realtor is asked to do a task the agent could have done.

**Score scale.**

| Score | What it looks like |
|---|---|
| 5 | The agent carries the knowledge; the surface shows the result. The realtor's only job is to approve, edit, or redirect. |
| 4 | Mostly carried by the agent; one piece of context the realtor has to fetch from another tab. |
| 3 | The realtor has to remember one piece of context the agent could have provided. |
| 2 | The surface is a form that asks the realtor to do the agent's job. |
| 1 | The surface is configuration that should have been a decision. |

**Fix pattern.** For every field, ask: does Chippi already know this? If
yes, show it as a default the realtor can override. For every toggle,
ask: is there one right answer? If yes, pick it and delete the toggle.
For every required input, ask: could the agent do this and surface the
result for approval instead? That move converts a form into the actual
product.

---

## 11. Featuritis check

**Question scored.** Does this surface earn its place in the product, or
is it accretion? Can you say what this surface is *for* in one sentence?
Is there one idea here, or many?

**Passes when.** One idea is statable in one sentence. The Chippi bar's
sentence: "Chippi is one keystroke away from anywhere in the workspace."
The FocusCard's sentence: "One decision at a time — Chippi's queue,
distilled." The onboarding reveal's sentence: "Chippi works for you
before you walk in." A surface that resists a one-sentence summary
already has a featuritis problem.

**Fails when.** The surface stacks multiple unrelated capabilities behind
tabs, accordions, or "more" disclosures. A settings page has nine sections
because nine teams asked for one each. A dashboard has six widgets
because nobody could decide which one mattered. The surface is "and"
instead of "or" — every feature kept its seat because no one fought for
it to be cut.

**Score scale.**

| Score | What it looks like |
|---|---|
| 5 | One idea, one sentence, one focal element. Everything else serves it. |
| 4 | One idea; one secondary element could be promoted out or demoted further. |
| 3 | Two ideas competing. The surface works but feels like a compromise between two product directions. |
| 2 | Three or more ideas. Tabs or accordions are hiding the indecision. |
| 1 | The surface is a junk drawer. Nobody can say what it's for. |

**Fix pattern.** Write the one-sentence purpose at the top of the file as
a comment. Cut every element that doesn't directly serve it. If a tab or
accordion is hiding a second idea, the second idea belongs on its own
surface — or it doesn't belong at all. Default move: delete first, ship,
add back only what's missed.

---

## How to use the rubric

### When to apply

- **Before merge.** Score the surface you just changed. A score below 4 on
  any check blocks the ship.
- **In a design review.** Score the surface and discuss the failed checks.
  The rubric is the agenda; the fix patterns are the actions.
- **In an audit.** Score every primary surface (Chippi home, FocusCard,
  onboarding stages, settings, AlertDialog flows) and rank by minimum
  score. The lowest minimum is what gets fixed next.
- **When something feels wrong.** Run the rubric. Name the failed check.
  The check is the diagnosis.

### Scoring method

1. **Open the file.** Read the actual code. Do not score from memory or
   from the conversation history. CLAUDE.md is explicit: audit from the
   files. An audit grounded in the code is defensible; one grounded in
   memory is a guess.
2. **Score each of the eleven checks.** Use the scale tables. Write the
   score next to the check name.
3. **Take the minimum.** That's the surface's score. Average hides
   failures.
4. **For every check below 4, name the fix pattern.** The fix pattern is
   the action.

### How to act on the score

| Score (min of checks) | Action |
|---|---|
| 5 | Ship. Note the exemplary check(s) so others can learn from this surface. |
| 4 | Ship. Open follow-ups for any 4s if the rubric named a clear next step. |
| 3 | Ship only if the failing check is a soft fail (edge case, low-end device). Otherwise fix first. |
| 2 | Do not ship. Fix the failing check before merge. |
| 1 | Block. The surface mis-communicates or makes an irreversible wrong action easy. |

### A note on the agent's role

When the agent (Chippi or the coding agent) runs this rubric, the dual
persona from CLAUDE.md still applies: the audit is design work, so it is
scored from the Jobs lens — the standard is "would this make a realtor
tell three friends?" not "does it compile?" The Musk lens kicks in on the
fix pass: simplest change that flips the failing check from 2 to 4. No
gold-plating; no rearchitecting the surface to chase a 5 the realtor will
never feel.

### What the rubric does not do

- It does not replace usability testing. It catches the principles a
  realtor will feel; testing catches the things only a realtor will
  notice.
- It does not score accessibility (contrast, keyboard, screen reader)
  as a numbered axis — those are pass/fail prerequisites that live in
  the `tests/style/*` enforcement layer and in the component primitives.
  If a surface fails an accessibility check, it fails the discoverability
  check too — it's discoverable to some but not all.
- It does not score performance. Slow surfaces fail the feedback check —
  if a 4-second action shows no status line, that's a feedback 2, not a
  separate performance score.
- It does not score code quality. Good design and clean code overlap but
  are not the same thing; the rubric scores what a realtor feels, not what
  a reviewer reads.

The rubric is the floor, not the ceiling. A 5 across the board means the
surface is *correct*. Whether it's *great* is the harder question — and
the only honest test for that is whether a realtor uses it twice and tells
another realtor about it.
