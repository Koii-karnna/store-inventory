// ทดสอบข้อมูลรับเข้า กับไฟล์จริง: node scripts/test-receive.mjs
import { readFileSync, readdirSync, copyFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readWorkbook, parseFile } from '../src/lib/parse.js';
import { planImport } from '../src/lib/importPlan.js';
import { view } from '../src/lib/model.js';
import { planReceive, receiveSummary, receiveItemPatches, suspiciousPrice, referencePrice, receiveDocId } from '../src/lib/receive.js';

const dir = join(import.meta.dirname, '..', '..', '..', 'Store Part list');
const tmp = mkdtempSync(join(tmpdir(), 'si-'));
const load = (p) => { const t = join(tmp, p.split(/[\\/]/).pop()); copyFileSync(p, t); const b = readFileSync(t); return parseFile(t, readWorkbook(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))); };
let fail = 0;
const ok = (c, m) => { console.log(`${c ? 'ok' : 'FAIL'}: ${m}`); if (!c) fail++; };

const rc = load(join(dir, 'Part Receive Report CMC.xlsx'));
ok(rc.kind === 'receiveReport', `detected ${rc.kind} · ${rc.receive.map((r) => `${r.building} ${r.lines.length}`).join(', ')}`);
ok(rc.receive.length === 1 && rc.receive[0].building === 'CMC' && rc.receive[0].lines.length === 31, 'CMC 31 บรรทัด (อาคารจากชื่อ Group)');
const l0 = rc.receive[0].lines[0];
ok(l0.c === '03-004-02-1119' && l0.d === '2026-08-05' && l0.q === 20 && l0.p === 17000, `บรรทัดแรก ${JSON.stringify(l0)}`);

const p1 = planReceive({}, rc.receive);
ok(p1.summary.CMC.added === 31, 'นำเข้าครั้งแรก 31');
const docs = { [receiveDocId('CMC')]: { building: 'CMC', lines: p1.docs[receiveDocId('CMC')] } };
const p2 = planReceive(docs, rc.receive);
ok(p2.summary.CMC.added === 0 && p2.summary.CMC.duplicate === 31 && !p2.changed.length, 'นำเข้าซ้ำไม่เพิ่ม');

const sp = readdirSync(dir).filter((f) => /Store Part List|Part List Report|Master_Summary/.test(f)).map((f) => load(join(dir, f)));
const items = planImport([], sp, null).creates.map((c) => ({ ...c.data, v: view(c.data) })).filter((i) => i.building === 'CMC');
const byCode = Object.fromEntries(items.map((i) => [i.code, i]));
const flagged = rc.receive[0].lines.filter((l) => suspiciousPrice(l, referencePrice(byCode[l.c])));
console.log('ราคาน่าสงสัย:', flagged.map((l) => `${l.c} q${l.q} p${l.p} (ต้นทุน ${byCode[l.c]?.g?.cost})`).join(' · '));
ok(flagged.some((l) => l.c === '02-006-08-0321'), 'จับ Power supply ที่กรอกราคารวม');
const sum = receiveSummary(rc.receive[0].lines, byCode);
ok(sum['02-006-08-0321'].lastPrice === null, 'ราคาที่ติดธงไม่ใช้เป็นราคาซื้อล่าสุด');
ok(sum['01-002-02-1217'].lastPrice === 190 && sum['01-002-02-1217'].lastDate === '2026-05-29', 'ราคาซื้อล่าสุดปกติ');

// รับเข้าล่าสุด: ไฟล์ทับเมื่อใหม่กว่า + ปลดป้ายกำลังสั่ง
const test = [
  { ...byCode['01-002-02-1217'], lastInDate: '2026-01-01', lastInQty: 5 },
  { ...byCode['03-004-11-0223'], lastInDate: '2026-12-01', lastInQty: 1 },
  { ...byCode['04-007-12-1026'], ordering: { poId: 'x', at: new Date('2026-10-01T09:00:00') } },
];
const patches = Object.fromEntries(receiveItemPatches(rc.receive[0].lines, test).map((x) => [x.item.code, x.patch]));
ok(patches['01-002-02-1217']?.lastInDate === '2026-05-29' && patches['01-002-02-1217'].lastInQty === 175, 'วันที่ในไฟล์ใหม่กว่า → ทับ');
ok(!patches['03-004-11-0223'], 'วันที่ที่กรอกไว้ใหม่กว่า → คงค่าเดิม');
ok(patches['04-007-12-1026']?.ordering === null && patches['04-007-12-1026'].lastInDate === '2026-10-15', 'รับเข้าหลังวันสั่ง → ปลดป้ายกำลังสั่ง');
process.exitCode = fail ? 1 : 0;
