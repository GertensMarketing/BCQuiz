/* =====================================================================
   Blades & Clover — quiz engine
   Shared by quiz.html (live quiz) and builder.html (rule editor).
   No dependencies. Works as a plain <script> or an ES module import.
   ===================================================================== */
(function (root) {
  'use strict';

  /* ---------------------------------------------------------------- CSV */

  // Full RFC-4180 parser: handles quoted fields, embedded commas,
  // embedded newlines and doubled ("") escapes.
  function parseCSV(text) {
    text = String(text).replace(/^\uFEFF/, '');
    const rows = [];
    let row = [], field = '', i = 0, inQuotes = false;

    while (i < text.length) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
    return rows;
  }

  // Column headers in the sheet contain hard line breaks and stray spaces.
  const normKey = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const clean   = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const lc      = s => clean(s).toLowerCase();

  function rowsToObjects(rows) {
    if (!rows.length) return { headers: [], records: [] };
    const headers = rows[0].map(normKey);
    const records = [];
    for (let r = 1; r < rows.length; r++) {
      if (rows[r].every(v => clean(v) === '')) continue;
      const o = {};
      headers.forEach((h, c) => { o[h] = clean(rows[r][c]); });
      records.push(o);
    }
    return { headers, records };
  }

  const NAME_COL    = 'Grass Seed Blend/Mix';
  const LINK_COL    = 'Link to product on website:';
  const INCLUDE_COL = 'Include in Quiz?';

  // Split a multi-value cell such as "Full Sun (6+ hours), Partial Sun (3-4 hours)".
  // Splits only on commas that are NOT inside parentheses.
  function splitMulti(value) {
    const out = []; let buf = '', depth = 0;
    for (const ch of String(value || '')) {
      if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      if (ch === ',' && depth === 0) { out.push(buf); buf = ''; continue; }
      buf += ch;
    }
    out.push(buf);
    return out.map(clean).filter(Boolean);
  }

  function loadBlends(csvText) {
    const { headers, records } = rowsToObjects(parseCSV(csvText));
    const all = records.filter(r => clean(r[NAME_COL]));
    const included = all.filter(r => lc(r[INCLUDE_COL]) === 'yes');
    included.forEach(r => {
      r._name   = clean(r[NAME_COL]);
      r._link   = clean(r[LINK_COL]);
      r._sun    = splitMulti(r['Sun or Shade?']);
      r._states = splitMulti(r['Grows In:']);
    });
    return { headers, all, blends: included };
  }

  /* ------------------------------------------------------------ helpers */

  const EFFECTS = ['must', 'strongUp', 'up', 'neutral', 'down', 'strongDown', 'eliminate'];
  const DEFAULT_WEIGHTS = {
    must: 0, strongUp: 4, up: 2, neutral: 0, down: -2, strongDown: -4, eliminate: 0
  };
  const EFFECT_LABEL = {
    must: 'Always recommend', strongUp: 'Much more likely', up: 'More likely',
    neutral: 'No change', down: 'Less likely', strongDown: 'Much less likely',
    eliminate: 'Remove entirely'
  };

  function effectPoints(effect, weights) {
    const w = Object.assign({}, DEFAULT_WEIGHTS, weights || {});
    return w[effect] != null ? w[effect] : 0;
  }

  function cellMatches(cellValue, op, target) {
    const parts = splitMulti(cellValue).map(lc);
    const cell = lc(cellValue);
    const t = lc(target);
    switch (op) {
      case 'equals':    return cell === t || parts.includes(t);
      case 'notEquals': return !(cell === t || parts.includes(t));
      case 'contains':  return cell.indexOf(t) !== -1;
      case 'notContains': return cell.indexOf(t) === -1;
      case 'nonEmpty':  return cell !== '' && cell !== 'na';
      default:          return false;
    }
  }

  function answeredOptions(question, answer) {
    if (answer == null) return [];
    const ids = Array.isArray(answer) ? answer : [answer];
    return (question.options || []).filter(o =>
      ids.includes(o.id) || ids.includes(o.value) || ids.includes(o.label));
  }

  /* ------------------------------------------------------- auto rule set */

  // Each returns { points, eliminate, reason }.
  const AUTO = {

    stateFilter(ctx) {
      const state = clean(ctx.answerValue);
      if (!state) return { points: 0 };
      const grows = ctx.blend._states.map(lc);
      if (!grows.includes(lc(state))) {
        return { points: 0, eliminate: 'hard', reason: 'Not proven in ' + state };
      }
      return { points: 0, reason: 'Grows in ' + state };
    },

    sunLadder(ctx) {
      const auto = ctx.auto;
      const ladder = (auto.ladder || []).map(lc);
      const chosen = ladder.indexOf(lc(ctx.answerValue));
      if (chosen === -1) return { points: 0 };
      const idxs = ctx.blend._sun.map(s => ladder.indexOf(lc(s))).filter(i => i !== -1);
      if (!idxs.length) return { points: 0 };
      const dist = Math.min.apply(null, idxs.map(i => Math.abs(i - chosen)));
      if (dist === 0) return { points: auto.exactPoints != null ? auto.exactPoints : 4,
                               reason: 'Built for this exact light level' };
      if (dist === 1) {
        if (auto.farAction === 'eliminateNeighbor') return { points: 0, eliminate: 'sun' };
        return { points: auto.neighborPoints != null ? auto.neighborPoints : 0.5,
                 reason: 'Tolerates this light level' };
      }
      if (auto.farAction === 'penalise') return { points: -4, reason: 'Wrong light level' };
      return { points: 0, eliminate: 'sun', reason: 'Wrong light level' };
    },

    wearMatch(ctx) {
      const table = (ctx.auto.table || {})[ctx.optionId];
      if (!table) return { points: 0 };
      const cell = clean(ctx.blend[ctx.auto.column || 'High Wear Tolerance?']);
      let hit = null;
      Object.keys(table).forEach(k => { if (lc(k) === lc(cell)) hit = table[k]; });
      if (hit == null) return { points: 0 };
      if (hit === 'eliminate') return { points: 0, eliminate: 'rule', reason: 'Will not survive this traffic' };
      return { points: Number(hit) || 0, reason: hit > 0 ? cell : null };
    },

    effortMatch(ctx) {
      const a = ctx.auto;
      const mow   = a.mowScale[clean(ctx.blend[a.mowColumn])];
      const water = a.waterScale[clean(ctx.blend[a.waterColumn])];
      if (mow == null && water == null) return { points: 0 };
      const load   = (mow || 0) + (water || 0);            // 0 (easiest) … 6 (most work)
      const target = (a.targets || {})[ctx.optionId];
      if (target == null) return { points: 0 };
      const max = a.points != null ? a.points : 4;
      // Linear falloff: perfect match = full points, opposite end = 0.
      const points = Math.max(0, max * (1 - Math.abs(load - target) / 6));
      let reason = null;
      if (points > max * 0.6) {
        reason = clean(ctx.blend[a.mowColumn]) + ' · ' + clean(ctx.blend[a.waterColumn]);
      }
      return { points: Math.round(points * 100) / 100, reason };
    },

    germinationMatch(ctx) {
      const table = (ctx.auto.table || {})[ctx.optionId];
      if (!table) return { points: 0 };
      const cell = clean(ctx.blend[ctx.auto.column || 'Germination Rate']);
      let hit = null;
      Object.keys(table).forEach(k => { if (lc(k) === lc(cell)) hit = table[k]; });
      if (hit == null) return { points: 0 };
      if (hit === 'eliminate') return { points: 0, eliminate: 'rule' };
      const label = clean(ctx.blend['Time to Germinate']);
      return { points: Number(hit) || 0, reason: hit > 1 && label ? 'Germinates in ' + label : null };
    }
  };

  /* ------------------------------------------------------------ scoring */

  // Scores one blend against ONE selected answer.
  function scoreOption(blend, question, opt, weights) {
    const out = { points: 0, eliminate: null, must: false, reasons: [] };
    const bump = (tier) => {
      const order = { hard: 3, sun: 2, rule: 1 };
      if (!out.eliminate || order[tier] > order[out.eliminate]) out.eliminate = tier;
    };

    // 1. auto rule
    const auto = question.auto;
    if (auto && auto.enabled !== false && AUTO[auto.kind]) {
      const a = AUTO[auto.kind]({
        blend, auto, question,
        optionId: opt.id,
        answerValue: opt.value != null ? opt.value : opt.id
      }) || {};
      out.points += a.points || 0;
      if (a.eliminate) bump(a.eliminate);
      if (a.reason) out.reasons.push(a.reason);
    }

    // 2. column rules
    (opt.columnRules || []).forEach(cr => {
      if (!cr.column || !cr.effect) return;
      if (!cellMatches(blend[normKey(cr.column)], cr.op || 'equals', cr.value)) return;
      if (cr.effect === 'eliminate') { bump('rule'); return; }
      if (cr.effect === 'must') { out.must = true; return; }
      const p = effectPoints(cr.effect, weights);
      out.points += p;
      if (p > 0) out.reasons.push(clean(cr.column) + ': ' + clean(blend[normKey(cr.column)]));
    });

    // 3. manual overrides from the builder — these win over everything above
    const eff = (opt.overrides || {})[blend._name];
    if (eff && eff !== 'neutral') {
      if (eff === 'eliminate') { bump('rule'); return out; }
      if (eff === 'must') { out.must = true; out.reasons.push('Hand-picked for this answer'); return out; }
      const p = effectPoints(eff, weights);
      out.points += p;
      if (p > 0) out.reasons.push('Hand-picked for this answer');
    }
    return out;
  }

  // Scores one blend for one question. Returns
  // { points, eliminate: null|'hard'|'sun'|'rule', must: bool, reasons: [] }
  function scoreQuestion(blend, question, answer, weights, settings) {
    const res = { points: 0, eliminate: null, must: false, reasons: [] };
    const opts = answeredOptions(question, answer);
    if (!opts.length) return res;

    const bump = (tier) => {
      const order = { hard: 3, sun: 2, rule: 1 };
      if (!res.eliminate || order[tier] > order[res.eliminate]) res.eliminate = tier;
    };

    const per = opts.map(opt => scoreOption(blend, question, opt, weights));
    const multi = opts.length > 1;

    per.forEach((o, idx) => {
      res.points += o.points;
      if (o.must) res.must = true;
      o.reasons.forEach(r => { if (res.reasons.indexOf(r) === -1) res.reasons.push(r); });

      if (!o.eliminate) return;
      // When someone picks several answers, one answer removing a blend that a
      // DIFFERENT answer actively asked for is a contradiction, not a verdict.
      // Demote it to a heavy penalty so the blend can still compete.
      // Only rule-based removals are rescued — state and light are physical facts.
      const rescued = multi && o.eliminate === 'rule' &&
        per.some((x, j) => j !== idx && (x.points > 0 || x.must));
      if (rescued) res.points += effectPoints('strongDown', weights);
      else bump(o.eliminate);
    });

    // Picking three goals should not make that question count three times as
    // much as every other question. Damp it, while still rewarding a blend
    // that satisfies more of what they asked for.
    if (multi) {
      const mode = (settings && settings.multiAnswerScoring) || 'sqrt';
      if (mode === 'sqrt') res.points /= Math.sqrt(opts.length);
      else if (mode === 'mean') res.points /= opts.length;
    }

    return res;
  }

  /**
   * Run the whole quiz.
   * @param {Array}  blends  from loadBlends().blends
   * @param {Object} rules   quiz-rules.json
   * @param {Object} answers { questionId: optionId | [optionId, …] }
   * @returns {Object} { results, all, relaxed, answeredCount }
   */
  function runQuiz(blends, rules, answers) {
    const settings = rules.settings || {};
    const weights  = settings.weights || DEFAULT_WEIGHTS;
    const questions = (rules.questions || []).filter(q => q.enabled !== false);

    const rows = blends.map(blend => {
      const row = {
        blend, name: blend._name, score: 0, must: false,
        eliminate: null, reasons: [], perQuestion: {}
      };
      questions.forEach(q => {
        const w = q.weight != null ? Number(q.weight) : 1;
        const r = scoreQuestion(blend, q, answers[q.id], weights, settings);
        const pts = r.points * w;
        row.perQuestion[q.id] = { points: pts, eliminate: r.eliminate, reasons: r.reasons };
        row.score += pts;
        if (r.must) row.must = true;
        if (r.eliminate) {
          const order = { hard: 3, sun: 2, rule: 1 };
          if (!row.eliminate || order[r.eliminate] > order[row.eliminate]) row.eliminate = r.eliminate;
        }
        r.reasons.forEach(x => { if (row.reasons.indexOf(x) === -1) row.reasons.push(x); });
      });
      row.score = Math.round(row.score * 100) / 100;
      return row;
    });

    // Progressive relaxation. Hard state filter is never relaxed — we would
    // rather show nothing than sell someone seed that will not establish.
    let relaxed = null;
    let pool = rows.filter(r => !r.eliminate);
    if (!pool.length) {
      pool = rows.filter(r => r.eliminate !== 'hard' && r.eliminate !== 'sun');
      if (pool.length) relaxed = 'rules';
    }
    if (!pool.length) {
      pool = rows.filter(r => r.eliminate !== 'hard');
      if (pool.length) relaxed = 'sun';
    }

    // Ideal score = best result any surviving blend could have posted on each
    // question, summed. Gives an absolute, explainable match percentage.
    let ideal = 0;
    questions.forEach(q => {
      let best = 0;
      pool.forEach(r => { const p = r.perQuestion[q.id]; if (p && p.points > best) best = p.points; });
      ideal += best;
    });

    pool.forEach(r => {
      const raw = ideal > 0 ? Math.round((r.score / ideal) * 100) : 90;
      r.match = Math.max(relaxed ? 55 : 40, Math.min(99, raw));
      r.stretch = !!relaxed;
    });

    pool.sort((a, b) => (b.must - a.must) || (b.score - a.score) || a.name.localeCompare(b.name));

    const max      = settings.maxResults != null ? settings.maxResults : 3;
    const thresh   = settings.secondaryThreshold != null ? settings.secondaryThreshold : 0.7;
    const results  = [];
    const topScore = pool.length ? Math.max(pool[0].score, 0.0001) : 0;

    pool.forEach(r => {
      if (results.length >= max) return;
      if (r.must || results.length === 0) { results.push(r); return; }
      if (r.score >= topScore * thresh && r.score > 0) results.push(r);
    });

    const answeredCount = questions.filter(q => {
      const a = answers[q.id];
      return Array.isArray(a) ? a.length > 0 : a != null && a !== '';
    }).length;

    return { results, all: pool, eliminated: rows.filter(r => r.eliminate), relaxed, answeredCount };
  }

  /* ------------------------------------------------- data-quality report */

  function coverageReport(blends, rules) {
    const stateQ = (rules.questions || []).find(q => q.id === 'state');
    const states = stateQ ? stateQ.options.map(o => o.label) : [];
    return states.map(s => {
      const pool = blends.filter(b => b._states.map(lc).includes(lc(s)));
      const sun = {};
      ['Full Sun (6+ hours of direct sun)', 'Full Sun to Partial Shade (4-6 hours of sun)',
       'Partial Sun to Full Shade (3-4 hours of sun)', 'Full Shade (less than 3 hours of sun)']
        .forEach(l => { sun[l] = pool.filter(b => b._sun.map(lc).includes(lc(l))).length; });
      return { state: s, count: pool.length, sun, names: pool.map(b => b._name) };
    });
  }

  /* ------------------------------------------------------------- fetch */

  // Google's published-CSV endpoint sends CORS headers, but redirects and the
  // occasional outage happen. Try direct, then read-only mirrors, then a
  // locally-baked snapshot so the quiz never hard-fails in front of a customer.
  async function fetchCSV(url, snapshotUrl) {
    const attempts = [
      url,
      'https://api.allorigins.win/raw?url=' + encodeURIComponent(url),
      'https://corsproxy.io/?' + encodeURIComponent(url)
    ];
    for (const u of attempts) {
      try {
        const res = await fetch(u, { cache: 'no-store' });
        if (!res.ok) continue;
        const text = await res.text();
        if (text && text.indexOf(NAME_COL) !== -1) {
          return { text, source: u === url ? 'live' : 'mirror' };
        }
      } catch (e) { /* try the next one */ }
    }
    if (snapshotUrl) {
      try {
        const res = await fetch(snapshotUrl, { cache: 'no-store' });
        if (res.ok) return { text: await res.text(), source: 'snapshot' };
      } catch (e) { /* fall through */ }
    }
    throw new Error('Could not load the seed data.');
  }

  root.BCQuiz = {
    parseCSV, rowsToObjects, loadBlends, splitMulti, normKey, clean,
    runQuiz, scoreQuestion, coverageReport, fetchCSV,
    EFFECTS, EFFECT_LABEL, DEFAULT_WEIGHTS, AUTO,
    COLUMNS: { NAME_COL, LINK_COL, INCLUDE_COL }
  };
})(typeof window !== 'undefined' ? window : globalThis);
