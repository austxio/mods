# austxio mods

Claude Code mods by austxio.

## intent-guard

Checks each prompt you type or dictate before Claude gets it. When the goal is unclear, contradicts itself,
or mixes in another language, it asks up to three short questions, rewrites the prompt as clear English
(Task / Why / Guardrails / Done when), and lets you pick **Send clean** or **Send my original**.
Clear prompts and short replies such as "yes" go straight through. Each prompt uses one small Haiku call
from your plan; an unclear one uses two.

Made for people who work with Claude in English as a second language, typed or by voice.

Short replies of three words or fewer (yes, ok, 2, do it) skip the check. While it checks, the line
`intent-guard: checking…` shows under the prompt; if the AI does not answer within 15 seconds, your
original is sent. A dialog nobody answers for 10 minutes also lets your original through; the
dialog stays on screen and a late answer is ignored. When the check or the rewrite fails, a short notice says
your original was sent, along with any answers you already gave.

A side agent's note you forward is sent word for word. Only the words you add after it are checked and
rewritten, and a note with no words of yours goes straight through.

The rewrite only has `Why`, `Guardrails` and `Done when` lines when your words or answers state them. Under
**Other** in the last dialog you can add a note or paste your edited copy of the proposal, which then replaces
it.

The AI cannot see attached images. It is told they are there and keeps each `[Image #N]`.

### Turn it off, pick a mode, see the cost

```
/intent-guard status                 on or off, mode, its AI cost, and what happened to prompts lately
/intent-guard log [n]                what happened to each prompt, without its words (default 20)
/intent-guard on | off               off stays off in every session until you turn it on
/intent-guard mode [replace|attach]  replace (default): Claude gets only the clean prompt
                                     attach: your words stay in the chat; Claude also gets the
                                     clean version as a hidden note
```

While it is off, the line `intent-guard: off` shows under the prompt. The cost in `status` counts the
tokens of every intent-guard AI call and estimates the price at Claude Haiku 5.5 list price ($0.10 per
million input tokens, $0.50 per million output tokens). These calls are not in Claude Code's own usage
total.

### Your original words

When a prompt is rewritten, your original is saved next to the clean version, in the mod's own file in
your Claude Code settings folder. Saved originals and the log are deleted automatically after 7 days.
Each session keeps its own counts and originals, so sessions running at once do not overwrite each other.

```
/intent-guard last [n]   your original next to the clean version sent (newest first, up to 20)
/intent-guard clear      delete every saved original now
```

### Install

At the prompt of a Claude Code terminal session:

```
/plugin install intent-guard --marketplace austxio/mods
```

From a shell:

```
claude plugin install intent-guard --marketplace austxio/mods
```

Answer `y` to add the marketplace, then pick a scope.

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins,
Add marketplace with `austxio/mods`, then Add plugin.
