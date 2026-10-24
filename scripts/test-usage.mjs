// ทดสอบข้อมูลการเบิก กับไฟล์จริง: node scripts/test-usage.mjs
import { readFileSync, readdirSync, copyFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readWorkbook, parseFile } from '../src/lib/parse.js';
import { planImport } from '../src/lib/importPlan.js';
import { view, level } from '../src/lib/model.js';
import { planUsage, usageStats, usageDocId, isDeadStock, isInactiveWithStock } from '../src/lib/usage.js';

const dir = join(import.meta.dirname, '..', '..', '..', 'Store Part list');
const tmp = mkdtempSync(join(tmpdir(), 'si-'));
const load = (p) => { // คัดลอกก่อนอ่าน (ไฟล์อาจเปิดค้างใน Excel)
  const t = join(tmp, p.split(/[\\/]/).pop()); copyFileSync(p, t);
  const b = readFileSync(t); return parseFile(t, readWorkbook(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
};
let fail = 0;
const ok = (c, m) => { console.log(`${c ? 'ok' : 'FAIL'}: ${m}`); if (!c) fail++; };

const base = load(join(dir, 'Output', 'Usage_Reconciliation_2023-2026_20261024_v2.xlsx'));
ok(base.kind === 'usageBaseline', `baseline detected (${base.usage.map((u) => `${u.building} ${u.lines.length}`).join(', ')})`);
ok(base.noMinMax.length === 18, `ไม่ใช้เสนอ Min/Max ${base.noMinMax.length} รายการ`);
const p1 = planUsage({}, base.usage, { replace: true });
const docs = Object.fromEntries(Object.entries(p1.docs).map(([id, lines]) => [id, { building: id.split('_')[1], lines }]));
const sumY = (b, y) => (docs[usageDocId(b, y)]?.lines || []).filter((l) => !l.x).reduce((s, l) => s + l.q, 0);
const want = { CMC: [4549, 3472, 2375, 236], NP: [2020, 1947, 1594, 1026.502] };
for (const b of ['CMC', 'NP']) [2023, 2024, 2025, 2026].forEach((y, i) => ok(Math.abs(sumY(b, y) - want[b][i]) < 1e-6, `${b} ${y} = ${sumY(b, y)}`));

const reports = readdirSync(dir).filter((f) => /^Part Usage Report (CMC|NP)\.xlsx$/.test(f)).map((f) => load(join(dir, f)));
ok(reports.length === 2 && reports.every((r) => r.kind === 'usageReport'), `G2 reports: ${reports.map((r) => `${r.building} ${r.items.length}`).join(', ')}`);
const p2 = planUsage(docs, reports.flatMap((r) => r.usage));
ok(p2.summary.CMC.added === 0 && p2.summary.NP.added === 0, `นำเข้า G2 ซ้ำกับ baseline ไม่เพิ่ม (ซ้ำ CMC ${p2.summary.CMC.duplicate}, NP ${p2.summary.NP.duplicate})`);

// บรรทัดใหม่จริง
const extra = [{ building: 'CMC', lines: [{ s: 'G2', o: 'WO_TEST', c: '01-002-24-0421', q: 3, f: '2026-10-30T10:00', d: '2026-10-30' }] }];
const p3 = planUsage(docs, extra);
ok(p3.summary.CMC.added === 1 && p3.changed.includes(usageDocId('CMC', 2026)), 'บรรทัดใหม่ถูกเพิ่มในเอกสาร CMC 2026');

// สถิติ + Min/Max เสนอ
const sp = readdirSync(dir).filter((f) => /\.xlsx?$/i.test(f) && /Store Part List|Part List Report|Master_Summary/.test(f)).map((f) => load(join(dir, f)));
const items = planImport([], sp, null).creates.map((c) => ({ ...c.data, v: view(c.data), lv: level(c.data) }));
const noMM = new Set(base.noMinMax);
for (const b of ['CMC', 'NP']) {
  const lines = Object.entries(docs).filter(([id]) => id.startsWith(`usage_${b}_`)).flatMap(([, d]) => d.lines);
  const r = usageStats(b, lines, items.filter((i) => i.building === b), noMM);
  console.log(b, 'end', r.endMonth, 'window from', r.windowFrom, 'months', r.windowMonths);
  ok(r.endMonth === '2026-10' && r.windowMonths === (b === 'CMC' ? 22 : 24), `${b} หน้าต่าง 24 เดือน (CMC ไม่นับเดือนตกหล่น)`);
  const pick = (code) => r.stats[`${b}_${code}`];
  if (b === 'CMC') {
    const s = pick('01-002-24-0421');
    console.log('LED T8-13.5W', { avg: s.avg.toFixed(2), freq: s.freq, proposal: s.proposal });
    ok(Math.abs(s.avg - 172 / 22) < 1e-9 || s.avg > 7, 'ใช้ต่อเดือนคำนวณได้');
    ok(s.freq === 2 && s.proposal.min === Math.max(1, Math.ceil(s.avg * 2 - 1e-9)) && s.proposal.max === Math.ceil(s.avg * 6 + s.avg * 2 - 1e-9), 'สั่งปีละ 2 ครั้ง + สูตร Min/Max');
    const idle = Object.entries(r.stats).find(([id, x]) => x.proposal?.idle);
    ok(idle && idle[1].proposal.min === 1 && idle[1].proposal.max === 2, `ไม่ถูกเบิก 24 เดือน → Min 1 / Max 2 (${idle?.[0]})`);
  }
  const its = items.filter((i) => i.building === b);
  console.log(b, 'dead stock', its.filter((i) => isDeadStock(i, r.stats[i.id])).length, '| ยกเลิกมีของ', its.filter(isInactiveWithStock).length,
    '| ไม่คำนวณ (หน่วย)', Object.values(r.stats).filter((x) => x.excludeReason === 'หน่วยตอนเบิกไม่ตรง Master').length);
}
process.exitCode = fail ? 1 : 0;
