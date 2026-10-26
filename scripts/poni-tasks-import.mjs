#!/usr/bin/env node
// ===========================================================================
// ONE-TIME: THE ISLAND'S OLD LOCAL TASK LIST → os_entries, REVIEWED FIRST.
// ===========================================================================
//
// The desktop island (Oyen Poni fork) used to keep tasks in its own
// %APPDATA%\Poni\data.json (`tasks.tasks[]`: {id, text, done, created_unix,
// done_unix}). Its Tasks tab now shows Personal OS WORK tasks instead (D-28),
// so the old list is brought over once, by hand, in two steps:
//
//   review <data.json copy> <review.json>   parse + propose; the owner edits
//   sql    <review.json> <out.sql>          one transaction of INSERTs
//
// Nothing here talks to the database. The owner applies the SQL once (SQL
// editor / MCP execute_sql) and checks the trailing count.
//
// Proposals: domain "growth" (the seeded list is study pathway work), priority
// "normal" (an urgent row would enter the web's scored set the moment it
// exists — the owner flips it on purpose or not at all), include true.
// Every row is tagged `poni-import`, which is also the reversal:
//   delete from public.os_entries where 'poni-import' = any(tags);
//
// The payload mirrors the SPA's write path (supabaseRepository entryToRow):
// absent fields are absent keys, entry_date = dueDate for tasks.
//
// Node >= 18, no dependencies. Self-check: `node scripts/poni-tasks-import.mjs selftest`.

import { readFileSync, writeFileSync } from 'node:fs';

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// "… · due 31 Oct" or "… · due 4 Jan 2027". The separator in the seeded text
// is U+00B7; a plain hyphen or none is accepted too, so a hand-typed task
// with the same suffix parses the same.
const DUE = /\s*(?:[·\-–—]\s*)?due\s+(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?(?:\s+(\d{4}))?\s*$/i;

function pad(n) {
  return String(n).padStart(2, '0');
}

function isoDay(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function validDay(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/**
 * Splits the due suffix off a task's text. With no explicit year the day lands
 * in the year the task was created; a day already behind the creation date
 * means next year (a January deadline written in October is next January).
 */
export function parseTask(text, createdUnix) {
  const m = DUE.exec(text);
  if (!m) return { title: text.trim(), dueDate: null };
  const day = Number(m[1]);
  const month = MONTHS[m[2].toLowerCase()];
  if (!month) return { title: text.trim(), dueDate: null };
  const created = new Date(createdUnix * 1000);
  const createdDay = isoDay(created.getUTCFullYear(), created.getUTCMonth() + 1, created.getUTCDate());
  let year = m[3] ? Number(m[3]) : created.getUTCFullYear();
  if (!validDay(year, month, day)) return { title: text.trim(), dueDate: null };
  let due = isoDay(year, month, day);
  if (!m[3] && due < createdDay) {
    year += 1;
    due = isoDay(year, month, day);
  }
  return { title: text.slice(0, m.index).trim(), dueDate: due };
}

function review(dataPath, outPath) {
  const data = JSON.parse(readFileSync(dataPath, 'utf8'));
  const tasks = data?.tasks?.tasks;
  if (!Array.isArray(tasks)) throw new Error(`${dataPath}: no tasks.tasks array`);
  const rows = tasks.map((t) => {
    const { title, dueDate } = parseTask(String(t.text ?? ''), Number(t.created_unix ?? 0));
    return {
      include: !t.done,
      domain: 'growth',
      priority: 'normal',
      title,
      dueDate,
      done: Boolean(t.done),
      // Kept so a done task the owner chooses to include arrives done, with
      // the time it was ticked, rather than reopened.
      done_unix: t.done ? Number(t.done_unix ?? 0) || null : null,
      source_id: t.id,
      source_text: t.text,
    };
  });
  writeFileSync(outPath, JSON.stringify({ version: 1, rows }, null, 2) + '\n');
  const open = rows.filter((r) => !r.done).length;
  console.log(`${rows.length} tasks (${open} open) → ${outPath}`);
  for (const [i, r] of rows.entries()) {
    console.log(`${String(i + 1).padStart(2)}. ${r.dueDate ?? '          '}  ${r.domain.padEnd(6)} ${r.title}`);
  }
}

function sqlString(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

function sql(reviewPath, outPath) {
  const { rows } = JSON.parse(readFileSync(reviewPath, 'utf8'));
  const picked = rows.filter((r) => r.include);
  for (const r of picked) {
    if (!['work', 'growth'].includes(r.domain)) throw new Error(`bad domain: ${r.domain} (${r.title})`);
    if (!['normal', 'urgent'].includes(r.priority)) throw new Error(`bad priority: ${r.priority} (${r.title})`);
    if (!r.title || r.title.length > 500) throw new Error(`bad title: ${r.title}`);
    if (r.dueDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(r.dueDate)) throw new Error(`bad dueDate: ${r.dueDate}`);
  }
  const values = picked.map((r) => {
    const payload = { title: r.title, priority: r.priority, done: Boolean(r.done) };
    if (r.dueDate) payload.dueDate = r.dueDate;
    // Date.toISOString(), as the SPA writes completedAt.
    if (r.done) payload.completedAt = new Date((r.done_unix ?? 0) * 1000).toISOString();
    return `  ('task', ${sqlString(r.domain)}, '{poni-import}', ${r.dueDate ? sqlString(r.dueDate) : 'null'}, ${sqlString(JSON.stringify(payload))}::jsonb)`;
  });
  const out = [
    '-- One-time import of the island\'s old local task list (scripts/poni-tasks-import.mjs).',
    `-- ${picked.length} rows. Reversal: delete from public.os_entries where 'poni-import' = any(tags);`,
    'begin;',
    'do $$ begin',
    "  if exists (select 1 from public.os_entries where 'poni-import' = any(tags)) then",
    "    raise exception 'poni-import rows already exist; delete them first or do not re-run';",
    '  end if;',
    'end $$;',
    'insert into public.os_entries (type, domain, tags, entry_date, payload) values',
    values.join(',\n') + ';',
    "select domain, count(*) as imported from public.os_entries where 'poni-import' = any(tags) group by domain order by domain;",
    'commit;',
    '',
  ].join('\n');
  writeFileSync(outPath, out);
  console.log(`${picked.length} rows → ${outPath}`);
}

function selftest() {
  const oct25 = Date.UTC(2026, 9, 25, 15, 0) / 1000;
  const cases = [
    ['Register for Oxford SEE · due 31 Oct', 'Register for Oxford SEE', '2026-10-31'],
    ['Submit Imperial — Round 2 · due 4 Jan 2027', 'Submit Imperial — Round 2', '2027-01-04'],
    ['Something in January · due 4 Jan', 'Something in January', '2027-01-04'],
    ['Book IELTS on computer, 24 Dec or earlier weekday · due 1 Nov', 'Book IELTS on computer, 24 Dec or earlier weekday', '2026-11-01'],
    ['No suffix here', 'No suffix here', null],
    ['Bad date · due 31 Feb', 'Bad date · due 31 Feb', null],
  ];
  let bad = 0;
  for (const [text, title, due] of cases) {
    const got = parseTask(text, oct25);
    if (got.title !== title || got.dueDate !== due) {
      bad += 1;
      console.log(`FAIL ${JSON.stringify(text)} → ${JSON.stringify(got)}`);
    }
  }
  console.log(bad ? `${bad} failed` : `ok (${cases.length} cases)`);
  process.exit(bad ? 1 : 0);
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'review' && a && b) review(a, b);
else if (cmd === 'sql' && a && b) sql(a, b);
else if (cmd === 'selftest') selftest();
else {
  console.error('usage: poni-tasks-import.mjs review <data.json> <review.json> | sql <review.json> <out.sql> | selftest');
  process.exit(2);
}
