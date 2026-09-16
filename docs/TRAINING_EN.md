# From Fitting to Training · Roadmap

<p align="center">
  <a href="./TRAINING.md"><img alt="中文" src="https://img.shields.io/badge/%E4%B8%AD%E6%96%87-switch-lightgrey?style=for-the-badge"></a>
  <a href="./TRAINING_EN.md"><img alt="English" src="https://img.shields.io/badge/English-current-blue?style=for-the-badge"></a>
</p>

<p align="center"><a href="../README_EN.md">← Back to README</a> · <a href="../USER-GUIDE_EN.md">User Guide</a></p>

---

> **This document answers one question**: once on-device models can be trained, how does fitting become *actually knowing you*?

## 0. First, an honest framing: fitting today is a stopgap

Three ways to make a model fit a particular user — with completely different cost structures:

| | Gets into the weights? | Per-turn cost | Scope | Possible today? |
|---|---|---|---|---|
| **A. Fine-tune / LoRA** | Yes | **Zero** (internalized) | All sessions on that model | No — shared API |
| **B. Context injection** | No | **Token rent, every turn** | Current session | The only option now |
| **C. External state + retrieval** | No | Pay on demand | Cross-session | Doable now |

This plugin currently sits at **B + C**. B has three structural flaws:

1. **Rent grows linearly with turns** — 100 turns, 100 payments
2. **It competes for context space with the user&apos;s actual content**
3. **Most importantly**: after 50 turns of injecting the same prompt, **the model&apos;s attention to it decays** — while anything in the weights does not

So the real problem is not "how to inject more" but **"how to make every injection still count."**

**A is the destination.** And A needs one thing: **data**. Which is exactly what this plugin has been collecting since day one.

---

## 1. What is already being collected

Every completed fitting writes a fit/feedback frame holding a quadruple:

~~~jsonc
{
  "type": "fit/feedback",
  "context":   "the situation (trigger line + workspace + round)",
  "modelDid":  "what the model did this round (questions asked / directions proposed)",
  "userSaid":  "the user&apos;s answer or correction",
  "verdict":   "accepted | corrected | rejected",
  "preference":"the preference rule extractable from it"
}
~~~

**That is a ready-made preference training set.** It is naturally shaped as "given this context, the model did X and the user accepted / corrected it to Y" — precisely what DPO / ORPO-style preference optimization wants.

### Why collect in this shape now

Because **you will not have to re-collect later**. When on-device training arrives, you will already have a year of data; re-collecting means starting from zero again.

**The stopgap and the endgame are not two projects. They are two stages of the same one.**

---

## 2. Is there enough data? Where the line is

| Goal | Roughly needed | Notes |
|---|---|---|
| **Style profile** (conclusion-first, etc.) | ~100 samples | Reached quickly. This layer suits context injection or a light system prompt |
| **Preference alignment** (when to comply vs. push back) | 1k–10k | Needs real *correction* events, not likes |
| **Domain intuition** (weighing things the way a practitioner would) | 10k+, with **hard negatives** | This is the layer that genuinely needs training |

**What matters is not the count — it is the correction rate.** If 90% of fittings end with "user accepts", those samples carry almost no information: the model guessed right to begin with.

**The highest-value samples are those with verdict = corrected**: the model guessed wrong and the user supplied the right answer. That is where preference pairs come from.

> **Design implication**: this plugin should record **what was wrong** when a proposal is rejected (did the user pick another direction, or say "none of these"?). Those are different signal strengths and deserve separate storage.

---

## 3. Three stages

### Stage 1 · Now (data collection)

**Goal**: collect clean, training-ready data.

- Done: the fit/feedback quadruple is being collected
- **TODO**: record *why* a proposal was rejected (field rejectedReason)
- **TODO**: add a **quality tier** to samples (deliberate vs. reflexive click)
- **TODO**: an export script (JSONL → a format training frameworks accept)

### Stage 2 · When on-device is viable (profile injection)

**Goal**: make the profile **cross-session**, and inject it **only when relevant**.

Technical seam: ctx.on(system-prompt/assemble) — participates in prompt assembly every turn.

**Core design: inject "style and known blind spots", never "conclusions".**

~~~
✅ Worth injecting (changes how the model works):
   · This user prefers the conclusion first
   · This user chose the conservative option in all three decisions on this project
   · This user repeatedly underestimates migration cost on config problems — verify before estimating

❌ Must NOT be injected (this is how you build an echo chamber):
   · This user believes library X needs no config   ← a factual claim; saying it once does not make it a preference
   · This user&apos;s last conclusion was X              ← last time&apos;s conclusion does not hold this time
~~~

**The test, in one line: if evidence could overturn it, it does not belong in the profile.** ("I hate long tables" cannot be overturned → in. "This library needs no config" is one lookup away → out.)

### Stage 3 · When on-device training is viable (weights)

**Goal**: turn the profile from "rent every turn" into "bought once".

**Techniques, lightest to heaviest**:

| Technique | Data needed | Best for | Risk |
|---|---|---|---|
| **LoRA / QLoRA** | 1k–10k preference pairs | Style, preference, domain tone | Low — pluggable, unload if broken |
| **DPO / ORPO** | Preference pairs (what this plugin collects) | "Comply vs. push back" | Medium — needs hard negatives |
| **Full fine-tune** | 10k+, high quality | Domain intuition | High — forgets general ability |
| **Continual learning** | A long-running data stream | Getting sharper over time | Highest — catastrophic forgetting |

**Start with LoRA**: cheap, reversible, leaves the base model untouched.

---

## 4. One thing to settle early: the boundary

Training makes a model **more like you**. But "like you" is not the same as "good for you."

This plugin already has that line built into its design:

| Layer | Content | Authority | Should it be fitted? |
|---|---|---|---|
| **Intent** | What you **want** (goals, preferences, taste, boundaries) | **You** | ✅ **Fully** |
| **Fact** | How this **should** be done (facts, constraints, feasibility) | **Evidence / professional standard** | ❌ **Never** |

**Training must preserve this line.** If the training data contains "the user&apos;s factual error was recorded as a preference," the model learns to **agree with the user&apos;s mistakes** — and that is not understanding, that is sycophancy.

**How to keep it, technically:**

- Samples carry a scope field; training takes **only scope = intent**
- scope = fact samples go down a separate path (training *how to correct*, not *what to correct to*)
- Run **inverse evaluation** periodically: hand the model a scenario where the user is clearly wrong, and check whether it still dares to push back

**This filter is the dividing line for whether the whole training route holds up.**

---

## 5. Three things you can do right now

If this roadmap makes sense, **you do not need to wait for on-device models**:

1. **Complete the fit/feedback fields** — especially rejectedReason and quality tiering
2. **Write the export script** — JSONL → preference-pair format (prompt / chosen / rejected)
3. **Run a small-scale validation** — at ~100 samples, train a minimal LoRA and see whether the style shifts. **Verify the data is worth anything**

Step 3 matters most: **it tells you whether the data you are collecting carries information at all.** If 100 samples produce nothing, the samples are almost all "the model already guessed right" — and the collection strategy needs to change (for example, by deliberately seeking more disagreement).

---

## 6. References

- Preference optimization: DPO (Rafailov et al., 2023), ORPO (Hong et al., 2024)
- Parameter-efficient fine-tuning: LoRA (Hu et al., 2021), QLoRA (Dettmers et al., 2023)
- Catastrophic forgetting & continual learning: see the various LLM continual-learning surveys

> This roadmap describes the project&apos;s **design intent**, not shipped functionality. The current version only collects data.

