// ทดสอบการอ่านไฟล์จริง: node scripts/test-parse.mjs [โฟลเดอร์ไฟล์]
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readWorkbook, parseFile } from '../src/lib/parse.js';
import { planImport } from '../src/lib/importPlan.js';
import { level, mismatches, DEFAULT_SETTINGS } from '../src/lib/model.js';

const dir = process.argv[2] || join(import.meta.dirname, '..', '..', '..', 'Store Part list');
const files = readdirSync(dir).filter((f) => /\.xlsx?$/i.test(f) && !f.startsWith('~$')).map((f) => {
  const buf = readFileSync(join(dir, f));
  const parsed = parseFile(f, readWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
  console.log(`${f} → ${parsed.kind}${parsed.building ? ' ' + parsed.building : ''} (${parsed.items?.length ?? 0} rows)`);
  return parsed;
});

const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('ok:', msg); };

const plan = planImport([], files, null);
console.log('summary', plan.summary);
const items = plan.creates.map((c) => c.data);
assert(items.filter((i) => i.building === 'CMC').length === 510, 'CMC = 510 รายการ (506 Master + 4 นอก Master)');
assert(items.filter((i) => i.building === 'NP').length === 391, 'NP = 391 รายการ (390 Genedia + 1 เฉพาะ Master)');
assert(plan.taxonomy.subs.length > 45, `หมวดย่อย CMC ${plan.taxonomy.subs.length}`);
assert(plan.taxonomy.npCodes.length >= 17, `รหัส GG ของ NP ${plan.taxonomy.npCodes.length}`);
console.log('brands', plan.brands.length);

const review = items.filter((i) => i.review);
console.log('รอตรวจ Group:', review.map((i) => `${i.code}→${i.group}`).join(', '));
assert(review.every((i) => i.group), 'รายการนอก Master เดา Group ได้ทุกตัว');

const mm = {};
for (const it of items) for (const x of mismatches(it)) mm[`${it.building}:${x.type}`] = (mm[`${it.building}:${x.type}`] || 0) + 1;
console.log('ไม่ตรง Master', mm);

const lv = {};
for (const it of items) { const l = `${it.building}:${level(it, DEFAULT_SETTINGS)}`; lv[l] = (lv[l] || 0) + 1; }
console.log('ระดับแจ้งเตือน', lv);

const a = items.find((i) => i.code === '01-001-05-0519');
console.log('ตัวอย่าง', JSON.stringify(a));
assert(a.g.unit && a.m.name && a.sub === '01-001' && a.group === 'CMC-LIGHTING', 'ตัวอย่างมีหน่วย/ชื่อ Master/หมวดย่อย/Group');

// นำเข้าซ้ำด้วยไฟล์เดิม ต้องไม่มีอะไรเปลี่ยน
const again = planImport(items, files, plan.taxonomy);
assert(again.creates.length === 0 && again.updates.length === 0, `นำเข้าซ้ำไม่มีการเปลี่ยนแปลง (${again.updates.length} updates)`);

// คงเหลือเปลี่ยน + ของเข้าหลังสั่ง
const store = files.find((f) => f.kind === 'store' && f.building === 'CMC');
const changed = { ...store, items: store.items.map((r) => (r.code === '01-001-05-0519' ? { ...r, stock: r.stock + 10 } : r)) };
const withOrder = items.map((i) => (i.code === '01-001-05-0519' ? { ...i, ordering: { poId: 'x', stockAtOrder: a.g.stock } } : i));
const third = planImport(withOrder, [changed], plan.taxonomy);
const u = third.updates.find((x) => x.code === '01-001-05-0519');
assert(third.updates.length === 1 && u.patch['g.stock'] === a.g.stock + 10 && u.patch.ordering === null, 'คงเหลือเพิ่ม → อัปเดต + ปลดป้ายกำลังสั่ง');
