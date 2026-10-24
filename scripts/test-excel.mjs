// ทดสอบสร้างใบขอซื้อ Excel: node scripts/test-excel.mjs <รูป.jpg> <ไฟล์ผลลัพธ์.xlsx>
import { readFileSync, writeFileSync } from 'node:fs';
import { buildPoExcel } from '../src/lib/excel.js';

const [imgPath, outPath] = process.argv.slice(2);
const img = `data:image/jpeg;base64,${readFileSync(imgPath).toString('base64')}`;
const lines = [
  { itemId: 'CMC_01-001-05-0519', code: '01-001-05-0519', name: 'Pilot Lamp LED XB7-EV0.MP สีเหลือง 230V SCHNEIDER', brand: 'SCHNEIDER', unit: 'ตัว', stock: 4, min: 5, max: 10, group: 'CMC-LIGHTING', sub: '01-001', lastIn: '12 ต.ค. 2569 / 10 ตัว', qty: 6, price: 99, note: 'ใช้กับตู้ MDB ชั้น 3' },
  { itemId: 'CMC_01-002-02-1217', code: '01-002-02-1217', name: 'หลอด LED T8 16W L&E', brand: 'L&E', unit: 'หลอด', stock: 0, min: 50, max: 200, group: 'CMC-LIGHTING', sub: '01-002', qty: 200, price: 190 },
  { itemId: 'CMC_02-005-01-1217', code: '02-005-01-1217', name: 'สายไฟ THW สีดำ 1x2.5 SQMM. THAI YAZAKI', brand: 'THAI YAZAKI', unit: 'ม้วน', stock: 0, min: 2, max: 5, group: 'CMC-ELECTRICAL', sub: '02-005', qty: 5, price: null },
];
const subNames = { '01-001': 'หลอดไส้ / Pilot Lamp', '01-002': 'หลอด LED', '02-005': 'สายไฟฟ้า' };
const buf = await buildPoExcel({ building: 'CMC', date: new Date('2026-10-23'), project: 'สำรองอะไหล่ไตรมาส 4/2569', lines, images: { 'CMC_01-001-05-0519': img }, subNames });
writeFileSync(outPath, Buffer.from(buf));
console.log('wrote', outPath, buf.byteLength, 'bytes');
