# Blades & Clover — Seed Finder Quiz

Two pages, no build step, no server. Drop the folder on Netlify and it runs.

| File | What it is |
|---|---|
| `quiz.html` | The customer-facing quiz |
| `builder.html` | Your private admin tool for tuning recommendations |
| `engine.js` | The scoring logic, shared by both so the test view never lies to you |
| `quiz-rules.json` | Every question, answer, and rule. The builder writes this file |
| `seed-data.csv` | Optional backup copy of the sheet (create it from the builder) |

## Getting it live

1. Upload all files to your site, keeping them in the same folder — e.g. `/quiz/`.
2. The quiz is at `yoursite.com/quiz/quiz.html`. Rename `quiz.html` to `index.html` if you'd rather it live at `yoursite.com/quiz/`.
3. Put `builder.html` behind Netlify password protection or Identity. It has no login of its own, and anyone who finds it can rewrite your recommendations.

To embed it in a Shopify page instead:

```html
<iframe src="https://bladesandclover.netlify.app/quiz/quiz.html?embed=1"
        style="width:100%;border:0" id="bcq" title="Find your blend"></iframe>
<script>
addEventListener('message', e => {
  if (e.data && e.data.bcQuizHeight) document.getElementById('bcq').style.height = e.data.bcQuizHeight + 'px';
});
</script>
```

## How a recommendation gets made

Every blend starts at zero and collects points question by question.

**Three things can remove a blend outright:**

1. **State** — never relaxed. If your sheet doesn't list the customer's state under `Grows In:`, that blend cannot be recommended, full stop.
2. **Light level** — relaxed only if nothing survives.
3. **Rules you set** — relaxed first if nothing survives.

If relaxing kicks in, the customer sees an honest "this is a close match, not a perfect one" notice instead of a confidently wrong answer.

**Everything else is points.** Each question has a weight (the goal question counts most at 1.6, the look-and-feel tiebreaker least at 0.6). The top scorer is always shown; second and third only appear if they score at least 70% of the leader. So a customer with clear answers gets one confident pick, and a customer with open-ended answers gets three to browse.

**When a customer picks several answers to one question** (the goal question and the site-conditions question both allow it), two things happen automatically:

- The question's points are damped rather than simply added up, so choosing three goals doesn't make that one question outweigh sun, traffic and upkeep combined. A blend that satisfies all three still beats one that satisfies one — just not by three times. You can switch this to a plain average or a straight total under Settings.
- If one answer removes a blend that another answer actively asked for, the removal is downgraded to a heavy penalty instead. Someone who picks both "picture-perfect green lawn" and "convert to clover" gets the honest middle ground rather than an empty page. State and light level are never softened this way — those are physical facts, not preferences.

Mark an answer **"Picking this clears every other answer"** in the builder for options like "I'm not sure yet" that shouldn't combine with anything.

The match percentage is the blend's score against the best score that was actually achievable for those answers — not a number invented for decoration.

## The builder

The goal question lets customers pick more than one answer. Any question can be switched between one answer and several under **Answer type** in the builder.

**Questions & rules** — pick a question on the left, then paint the grid. Choose an effect from the row of brushes, then click or drag across cells. Click an answer heading to fill that whole column; click a blend name to fill its whole row.

| Brush | Effect |
|---|---|
| Always recommend | Pins the blend to the top of the results |
| Much more likely / More likely | +4 / +2 points |
| No change | Clears the cell |
| Less likely / Much less likely | −2 / −4 points |
| Remove entirely | Drops the blend from these results |

Six of the eight questions also read the spreadsheet automatically — sun levels, wear tolerance, mowing and water, germination speed. That happens first; anything you paint is applied on top. Question 3 (the lawn goal) has no automatic scoring at all, so the grid is the only thing driving it, exactly as you asked.

**Spreadsheet rules** handle broad strokes without clicking 28 cells. "Overseed an existing lawn" already uses one: any blend not marked `Yes` under `Good for Overseeding?` is removed.

**Test the quiz** runs the real engine and shows the per-question point breakdown for each result, plus what just missed the cut and what got removed and why. This is where you'll catch a blend that's quietly never recommended.

**Coverage check** counts eligible blends per state and per light level.

Changes autosave in your browser as you work, but **they aren't live until you press Download quiz-rules.json and upload that file to your site.** The header button is the publish step.

## Two things worth knowing before launch

**Six states have exactly one eligible blend.** Arizona, Florida, Hawaii, Louisiana, New Mexico and Texas all resolve to Gulf Annual Ryegrass alone — and it's an annual, so it dies off after a season. A Texas customer currently gets a single result for a product that won't give them a lawn. Options: widen `Grows In:` where it's defensible, add a warm-season blend, or add Texas and friends to a short "we don't ship there yet" list. The quiz handles it gracefully today, but it's a weak first impression.

**Full shade has one blend nationally.** Premium Dense Shade Mix is the only exact match, so shade answers lean on the neighbouring-light-level fallback. That's working as intended, but a second true shade blend would strengthen it.

Also worth a look: 12 of your 40 rows are set to `No` in column D, including all four Pro Athletic / World Class sports blends and three clovers. Flipping the sports mixes on would give the "a lot of traffic" answer much more to work with.

## Editing the sheet later

Add a blend by adding a row and setting column D to `Yes` — the quiz picks it up on next load, no code change. New blends start neutral everywhere, so open the builder and paint them into the goal question or they'll only ever be recommended on automatic scoring.

Keep these column values spelled exactly as they are now, since the scoring matches on them: `Sun or Shade?`, `High Wear Tolerance?`, `Mowing Requirements`, `Water Usage`, `Germination Rate`, `Good for Overseeding?`, `Grows In:`. The engine accepts both `Occasional mowing` and the older `Occassional` spelling, so the fix you made is safe either way.

If Google is ever unreachable the quiz falls back to `seed-data.csv`. Press **Save data snapshot** in the builder whenever the sheet changes to keep that copy current.
