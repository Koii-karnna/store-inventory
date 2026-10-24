// ทดสอบตัวช่วยออกรหัส/ตั้งชื่อ กับข้อมูลจริง: node scripts/test-codegen.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readWorkbook, parseFile } from '../src/lib/parse.js';
import { planImport } from '../src/lib/importPlan.js';
import { nextCode, nextSub, composeName, checkName } from '../src/lib/codegen.js';

const dir = join(import.meta.dirname, '..', '..', '..', 'Store Part list');
const files = readdirSync(dir).filter((f) => /\.xlsx?$/i.test(f)).map((f) => {
  const b = readFileSync(join(dir, f));
  return parseFile(f, readWorkbook(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
});
const plan = planImport([], files, null);
const items = plan.creates.map((c) => c.data);
const codes = (b) => items.filter((i) => i.building === b).map((i) => i.code);
let fail = 0;
const eq = (got, want, msg) => { const ok = got === want; if (!ok) fail++; console.log(`${ok ? 'ok' : 'FAIL'}: ${msg} → ${got}${ok ? '' : ` (ต้องได้ ${want})`}`); };

eq(nextCode({ building: 'CMC', sub: '01-002', mmyy: '1126' }, codes('CMC')).code, '01-002-39-1126', 'หลอด LED (RR ล่าสุด 38)');
eq(nextCode({ building: 'CMC', sub: '04-007', mmyy: '1126' }, codes('CMC')).code, '04-007-13-1126', 'อะไหล่ตู้น้ำดื่ม (RR ล่าสุด 12)');
eq(nextCode({ building: 'CMC', sub: '10-001', mmyy: '1126' }, codes('CMC')).code, '10-001-01-1126', 'อุปกรณ์ประตู (ยังไม่มีรายการ)');
eq(nextCode({ building: 'CMC', sub: '3661', mmyy: '1126' }, codes('CMC')).code, '3661-60-1126', 'AV (58 + รหัสเทส 59 นับด้วย)');
eq(nextCode({ building: 'NP', gg: '13' }, codes('NP')).code, '13-001-01-0117', 'NP 13 (ล่าสุด 0116)');
eq(nextCode({ building: 'NP', gg: '12' }, codes('NP')).code, '12-001-01-0020', 'NP 12 (รวม 12-001-0019 ที่รูปแบบผิด)');
eq(nextCode({ building: 'NP', gg: '21' }, codes('NP')).code, '21-001-01-005', 'NP 21 (3 หลัก)');
eq(nextCode({ building: 'NP', gg: '26' }, codes('NP')).code, '26-001-01-0001', 'NP 26 PIPEWORK ใหม่');
let err = ''; try { nextCode({ building: 'NP', gg: '20' }, codes('NP')); } catch (e) { err = e.message; }
eq(err, 'รหัส 20 ห้ามใช้', 'NP 20 ห้ามใช้');
eq(nextSub('CMC-LIGHTING', plan.taxonomy.subs), '01-012', 'หมวดย่อยใหม่ของ LIGHTING');
eq(nextSub('CMC-ARCHITECTURE', plan.taxonomy.subs), '10-002', 'หมวดย่อยใหม่ของ ARCHITECTURE (ไม่ใช้ 05 ที่ปิดรับ)');

eq(composeName({ type: 'สายไฟ', kind: 'THW สีดำ', spec: '1x2.5 SQMM.', brand: 'THAI YAZAKI' }), 'สายไฟ THW สีดำ 1x2.5 SQMM. THAI YAZAKI', 'รวมชื่อ 5 ส่วน');
eq(composeName({ type: 'สาย HDMI', brand: 'KEN' }, { avTag: '(AV60)' }), '(AV60) สาย HDMI KEN', 'tag AV');

const cmc = items.filter((i) => i.building === 'CMC');
const brands = plan.brands;
const bad = checkName('สวิทซ์ไฟ led 18 W ขนาด1/2" ยกเลิก', { brands, items: cmc });
console.log('ตรวจชื่อผิด:', bad.errors, bad.warnings);
eq(bad.errors.length >= 1 && bad.warnings.length >= 4, true, 'จับคำผิด/รูปแบบผิดได้');
const dup = checkName('Pilot Lamp LED XB7-EV0.MP สีเหลือง 230V SCHNEIDER', { brands, items: cmc });
eq(dup.duplicates[0]?.code, '01-001-05-0519', 'จับชื่อซ้ำ');
const good = checkName('สายไฟ THW สีม่วง 1x2.5 SQMM. THAI YAZAKI', { brands, items: cmc, brand: 'THAI YAZAKI', model: '' });
console.log('ชื่อถูก:', good.errors, good.warnings, 'คล้าย:', good.similar.map((s) => s.code).join(', '));
eq(good.errors.length + good.warnings.length, 0, 'ชื่อตามมาตรฐานไม่มีคำเตือน');
process.exitCode = fail ? 1 : 0;
