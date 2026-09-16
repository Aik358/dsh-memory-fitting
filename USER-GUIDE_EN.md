# Memory Fitting · User Guide

<p align="center">
  <a href="./USER-GUIDE.md"><img alt="中文" src="https://img.shields.io/badge/%E4%B8%AD%E6%96%87-switch-lightgrey?style=for-the-badge"></a>
  <a href="./USER-GUIDE_EN.md"><img alt="English" src="https://img.shields.io/badge/English-current-blue?style=for-the-badge"></a>
</p>

<p align="center"><a href="./README_EN.md">← Back to README</a></p>

---

## Contents

- [1. When to use it](#1-when-to-use-it)
- [2. A fitting in three minutes](#2-a-fitting-in-three-minutes)
- [3. The panel&apos;s three tabs](#3-the-panels-three-tabs)
- [4. How to set the switches](#4-how-to-set-the-switches)
- [5. Two ways to start](#5-two-ways-to-start)
- [6. What is in an archive](#6-what-is-in-an-archive)
- [7. FAQ](#7-faq)
- [8. Data and privacy](#8-data-and-privacy)

---

## 1. When to use it

**Good fit**:

- You can not articulate what you want, but you will know it when you see it
- The requirement keeps changing and you are going in circles
- You are opening a new direction with only a vague feeling
- You need to brief someone (or the next AI session) about something you have not figured out yourself

**Poor fit**:

- The requirement is already clear → just say it
- You only want a factual answer → fitting will not help
- You are in a hurry → being asked costs your time; this is not free

The rule of thumb: **if one sentence conveys it, do not use this. If you are three sentences in and still circling, use it.**

---

## 2. A fitting in three minutes

**① Open the panel**

Click **Memory Fitting** at the bottom-right. The first open lands on **Settings** on purpose — so you can see the switch states up front.

**② Switch to the "Start a fitting" tab**

Write a trigger line, for example:

> Just make that memory part better, it feels off.

Hit **Start**.

**③ Go back to the chat window and answer**

The agent first lays out 3-5 directions, then asks the first round of 2-4 questions. **They appear in the chat window as selectable options** — just click. If none fit, type your own answer in the custom field.

After each round the agent digests and presents the next one. **Four rounds is the default cap.**

**④ Confirm the convergence**

When one direction is clearly ahead, the agent proposes: *"I read this as X — right?"*

- Right → confirm and archive
- Wrong → tell it what is off; it keeps fitting

**⑤ Look at the archive**

Switch to the **Archive** tab to see the whole session. Click into it for the event-stream replay.

---

## 3. The panel&apos;s three tabs

### Settings (default)

Four switches, two parameters, and an environment self-check. See section 4.

### Archive

Lists every past fitting: title (the converged direction, or a name you gave it), a status badge (Confirmed / Pending / In progress / Abandoned), time and trigger line.

**Click any entry** for the detail view:

| Action | Meaning |
|---|---|
| **Confirm and archive** | Mark as confirmed; writes to the memory plugin if that switch is on |
| **Rename** | Give it a readable title (a work-node name works well) |
| **Delete** | Removes the session file and index entry. **Irreversible**, and it asks twice |

Below that is the **full event stream**: start → directions → each round&apos;s questions → each round&apos;s answers → inter-round reflection → proposal → confirmation. It is the only evidence for why the agent judged things the way it did.

### Start a fitting

Write a trigger line and create the session. This tab also shows whether tool exposure is on — if it is, you can also let the agent start one on its own from the chat.

---

## 4. How to set the switches

### Contamination-surface switches (all off by default)

| Switch | What turning it on does | When to turn it on |
|---|---|---|
| **Inject session context** | Adds a short note every turn telling the model it may start a fitting when needs are vague | When you want the agent to **proactively** fit |
| **Write to memory plugin** | Writes the converged conclusion into dsh-auto-memory | When you want results **findable later** |
| **Expose tools to the model** | The model can see the four memory_fit_* tools | When you want to **ask in words** for a fitting |

**Off by default is deliberate**:

- **Injection costs tokens.** Every turn. Your money.
- **The more often you inject, the more the model&apos;s attention decays** — the same paragraph lands on turn 1 and becomes background noise by turn 50. The right strategy is few and precise, not many and broad.
- **Memory writes are a coupling point to another plugin.** Off by default so nothing breaks.

### This plugin&apos;s own storage

| Switch | Default | Meaning |
|---|---|---|
| **Local archive** | **on** | Writes the whole fitting to ~/.dsh/memory-fitting/sessions/ |
| **Remember panel state** | on | Off means the panel starts collapsed every launch |

> **What if you turn local archive off?** Fittings cannot start — there is nowhere to keep the process. That is intentional: better to refuse than to spawn sessions with nowhere to live.

### Fitting parameters

| Parameter | Default | Meaning |
|---|---|---|
| **Max questions per round** | 4 | How many questions one round may contain |
| **Max rounds** | 4 | Guards against asking forever. **Do not raise this casually** — by round five most people are already thinking "just do the thing" |

---

## 5. Two ways to start

### Way A: click in the panel (start here)

No switches needed. Panel → **Start a fitting** → write the trigger → Start.

### Way B: let the agent start it

Turn on **Expose tools to the model** and (optionally) **Inject session context**. Then just say:

> I have not figured out what I want yet — fit my intent.

The agent calls memory_fit_start to create the session, then memory_fit_ask to question you.

**Note**: exposing tools means every turn carries the schema of four tools — a fixed cost. If you only use this occasionally, **prefer Way A**.

---

## 6. What is in an archive

Each archive is a JSONL file, one frame per line:

| Frame | Content |
|---|---|
| fit/start | Trigger line, workspace, anchor |
| fit/directions | The directions the agent predicted |
| fit/ask | The questions and options for that round |
| fit/answer | Your answers |
| fit/reflect | The inter-round update to directions |
| fit/propose | The convergence proposal |
| fit/finish | Confirmed or abandoned |
| fit/feedback | The training-ready feedback triple |

**Why JSONL**: appends never rewrite the whole file, a crash never loses earlier rounds, and it doubles as a replay log.

The index file (index.json) exists only to render the list quickly. **If it breaks, nothing is lost — it can be rebuilt.**

---

## 7. FAQ

**Q: What if I stop answering halfway?**

Just close or cancel. Answered content is **kept in the local archive**. The session stays "in progress."

**Q: The agent asked something dumb. Now what?**

Pick "unsure" or write your own. **Fitting quality is capped by how good the predicted directions are.** If the first round is entirely off, just say "none of these — what I want is ..." That is itself the most valuable input you can give.

**Q: Why four rounds by default?**

Because by the fifth question most people are thinking "just do the thing."

**Q: Can I run several fittings at once?**

Yes. Each session is its own file.

**Q: Do archives ever expire?**

No — until you delete them. The index keeps the newest 200, but **session files are never auto-deleted**.

**Q: What if the memory-plugin write fails?**

**The local archive is unaffected.** Failure only means it will not be found by later retrieval. The panel shows the reason.

**Q: Does it work with memory plugins other than dsh-auto-memory?**

Only the auto-memory adapter exists today. Without it, the plugin degrades to local-only archiving and does not error.

---

## 8. Data and privacy

**All data is local**: ~/.dsh/memory-fitting/. The plugin sends nothing to any external service.

**What leaves the machine**:

- If you turn on **Write to memory plugin**, the converged conclusion goes into dsh-auto-memory (also a local file)
- The Q&A the model sees during fitting goes to your model provider with the normal conversation request — **exactly as ordinary chat does**

**What never leaves**: the full Q&A trace, the direction lists, the event stream.

### What happens before archiving

Everything headed for the memory plugin passes through **character-level rewriting**:

- **Why**: the write path in dsh-auto-memory does not inspect the incoming body. A particular character sequence in that body **locks the entire memory file**, after which every write is refused.
- **What it does**: rewrites that sequence into an equivalent descriptive phrase, leaving everything else byte-for-byte.
- **Note**: this is **rephrasing**, not escaping — backticks and code fences mean nothing to that parser.

Because fitting records naturally contain your own words, this step is mandatory.

---

<p align="center">
  <a href="./README_EN.md">← Back to README</a> ·
  <a href="./docs/TRAINING_EN.md">Training Roadmap →</a>
</p>
