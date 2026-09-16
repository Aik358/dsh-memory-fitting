# Ask first, act later · Memory Fitting

<p align="center">
  <a href="./README.md"><img alt="中文" src="https://img.shields.io/badge/%E4%B8%AD%E6%96%87-switch-lightgrey?style=for-the-badge"></a>
  <a href="./README_EN.md"><img alt="English" src="https://img.shields.io/badge/English-current-blue?style=for-the-badge"></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@a9i5k4/dsh-memory-fitting"><img alt="npm" src="https://img.shields.io/npm/v/@a9i5k4/dsh-memory-fitting"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/License-MIT-yellow.svg"></a>
  <img alt="Platform" src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey">
</p>

**dsh-memory-fitting** — *It asks before it acts.*

> **EN** The agent predicts a few directions first, then asks in batches until one converges.
> **中文** 你先别急着说清楚，让它先猜。猜错了你纠正，比从头描述便宜得多。

<p align="center">
  <img width="820" alt="dsh-memory-fitting: it asks before it acts" src="docs/promo/banner.svg">
</p>

<p align="center">
  <a href="./USER-GUIDE_EN.md"><strong>📖 User Guide</strong></a> ·
  <a href="./docs/TRAINING_EN.md"><strong>🧪 Training Roadmap</strong></a> ·
  <a href="./CHANGELOG.md">Changelog</a>
</p>

---

## What this is

Most of the time, what blocks us isn't "we don't know how." It's "we can't say what we want."

You drop a line like *"just make that part better, it feels off"* and the agent can only guess. Guessing right is luck. Guessing wrong costs a full round of rework. **The wasted tokens and your wasted time both go into guessing.**

Memory Fitting flips the order:

> **Instead of letting the agent guess, let it put up targets first — then ask.**

It writes down 3-5 directions you might want, then asks in batches about **the places those directions still can't be told apart**. After each round it re-weighs every direction and **puts the updated list in front of you**. Once it's clear enough, it proposes: *"I read this as X — right?"*

**You never have to describe what you want. You only have to correct its guess.** And correcting is far cheaper than describing.

---

## How it works

```
① Predict  The agent writes down 3-5 directions you might want
           (each with: what it is, and what would be true if it's right)
                 ↓
② Compose  Design 2-4 questions for THIS round, aimed at
           the differences between directions — not at what's already known
                 ↓
③ Ask      await ctx.userQuestions.ask({ questions: [...] })
           One batch in, all answers back
                 ↓
④ Think    Digest the round → update directions (promote / drop / add / merge)
           【SHOW IT TO THE USER】← this step is not optional
                 ↓
          One direction clearly ahead and stable?
                 │                        │
                 no                       yes
                 │                        ↓
                 └──► back to ②   ⑤ Propose: "I read this as X" (+ the runners-up)
                                              ↓
                                       ⑥ You confirm → archive
```

### Why step ④ cannot be skipped

| | Without showing | With showing |
|---|---|---|
| The agent's claim | "I get it" — an unverifiable self-report | "Direction 3 leads; direction 1 is ruled out" — **verifiable** |
| What you do | Wait, and find out only if it's wrong | See at a glance whether it drifted, correct on the spot |

**Putting the agent's understanding in plain sight is the only substantive difference between this and "the agent asked a couple of things and then said it understood."**

---

## Interface

A floating panel in the bottom-right: **Settings** (default) · **Archive** · **Start a fitting**.

### Positioning: its own column, so nothing overlaps

The bottom-right of DSH is already a stack (dsh-cua and Ark9Canvas each probe for the other's FAB, but are **unaware of each other**):

| Plugin | FAB | Panel |
|---|---|---|
| dsh-cua | right:16 bottom:96 | right:16 bottom:152 |
| Ark9Canvas | right:16 bottom:96\|148 | right:16 bottom:152\|204 w-440 |
| **This plugin** | right:16 **bottom:16** | **right:472** bottom:16 · height min(78vh,660px) |

Our FAB sits at the very bottom of the stack; our panel moves to the **left of** the right-hand column and spans full height — completely clear of the \`right:16\` column, **no overlap whether or not the others are open**. On narrow screens (<900px) it degrades to a centered overlay.

---

## Switches: all off by default

This plugin makes a point of not getting in your way. All three "contamination surface" switches are **off by default**:

| Switch | Default | Meaning |
|---|---|---|
| \`injectContext\` | **off** | Inject one very short note each turn so the model knows it can start a fitting |
| \`writeMemory\` | **off** | Write the converged conclusion into dsh-auto-memory |
| \`exposeTools\` | **off** | Expose \`memory_fit_*\` tools to the model (registering costs tool-schema context every turn) |
| \`localArchive\` | **on** | The plugin's own local archive |

**Why off by default**: on a shared API, every turn of injection costs token rent — and the more often you inject, the more the model's attention to it decays. The right strategy isn't "inject more," it's "make every injection count." So: no injection unless you ask for it.

You don't need to touch the switches to use it: click **Start a fitting** in the panel. No tools need to be visible to the model.

---

## Where the data lives

```
~/.dsh/memory-fitting/
  config.json                              configuration
  sessions/<stamp>-<id>.jsonl              the whole fitting (append-only, never rewritten)
  sessions/index.json                      index (rebuildable)
```

**Keep the process to yourself; send only the conclusion to memory.** The full Q&A trace stays in local JSONL, immune to any other plugin's compaction. Only the converged conclusion goes to the memory plugin, and only if \`writeMemory\` is on.

> Those archives aren't just logs — they are **training-ready** samples. See the [Training Roadmap](docs/TRAINING_EN.md).

---

## ⚠️ The memory-write seatbelt

\`src/node/sanitize.js\` performs **character-level rewriting** on everything headed for the memory plugin.

**Background**: the write path in dsh-auto-memory does **not** filter the incoming body (\\\`appendAnchoredRecord\\\` only runs \`parseAnchors\` on the *existing* file). If a body ever contains the HTML-comment form of the memory anchor opening sequence, **every subsequent write to that file is fail-closed** — the entire memory file locks up.

**Critically: escaping does not help.** Backticks, code fences, HTML entities — none of it is understood. **You must rephrase.**

Because a fitting record **naturally contains the user's own words**, this plugin forces every archive through \`guard()\`. That is also why "raw user words go only to local JSONL, and only rewritten text reaches memory."

---

## Install

```bash
dsh plugin --profile web add @a9i5k4/dsh-memory-fitting
```

Or manually: link the package into the profile's \`node_modules\` and add \`@a9i5k4/dsh-memory-fitting\` to \`dsh.profile.bundles\`.

After changing host-side code, re-run \`node build.mjs\` and **restart dsh web**.

---

## Development

```bash
npm install       # esbuild is the only build dependency
npm run build     # → lib/index.js (node) + lib/client.js (browser)
npm test          # 51 regression checks
npm run verify    # dependency surface + safety self-check
```

### Hard constraints by design

- **Only a session root agent can start a fitting**: a subagent passing \`agent\` hits \`DELEGATED_CALLER\`. This plugin passes \`agent\` through as optional and falls back to the global waterfall.
- **\`ctx.userQuestions\` is deliberately not in \`inject\`**: it's an optional capability. If it's missing, we degrade — we don't fail to load.
- **Context injection uses imperatives + triggers**, not descriptions. The model treats "background information" and "a constraint I must follow" at different depths; at equal token cost the latter moves output far more.
- **Zero external deps on the node side, zero \`require\` on the client side** — sidestepping "one missed require and the whole plugin fails to load."

---

## Origin

This plugin is a port of the *intent fitting* stage from an SSVEP brain-computer-interface project.

In that setting the users were paralyzed: **their only channel for expressing intent was EEG**. The system couldn't wait for them to explain — it had to offer a small set of candidates repeatedly and infer intent from each choice, converging as it went.

Generalized: when a person's output bandwidth is low (can't articulate, hasn't decided, or simply won't) and the agent's prior is wide, **raising targets before asking is far cheaper than guessing**.

---

## License

MIT © Aik358
