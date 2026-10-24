// ตัวช่วยออกรหัสและตั้งชื่ออะไหล่ใหม่ ตาม "มาตรฐานการตั้งรหัส" และ "มาตรฐานการตั้งชื่อ" ในไฟล์ Master

export const mmyyNow = (d = new Date()) => `${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getFullYear()).slice(-2)}`;

const NP_SHORT = ['21', '22', '23']; // NP รหัส 21–23 ใช้ลำดับ 3 หลัก
const NP_FORBIDDEN = ['20'];

/**
 * เลขลำดับถัดไป (นับรวมรายการที่ยกเลิก และรหัสเดิมที่รูปแบบผิด)
 * CMC:  { building:'CMC', sub:'01-002', mmyy } → 01-002-RR-MMYY
 * AV:   { building:'CMC', sub:'3661', mmyy }   → 3661-RR-MMYY
 * NP:   { building:'NP', gg:'13' }             → 13-001-01-NNNN
 */
export function nextCode({ building, sub, gg, mmyy }, codes) {
  if (building === 'CMC') {
    if (!sub) throw new Error('เลือกหมวดย่อยก่อน');
    if (!/^\d{4}$/.test(mmyy || '')) throw new Error('MMYY ต้องเป็นตัวเลข 4 หลัก เช่น 1126');
    const re = sub === '3661' ? /^3661-(\d{2})-/ : new RegExp(`^${sub}-(\\d{2})-`);
    const max = Math.max(0, ...codes.map((c) => re.exec(c)).filter(Boolean).map((m) => Number(m[1])));
    const rr = max + 1;
    if (rr > 99) throw new Error(`หมวด ${sub} ใช้ลำดับครบ 99 แล้ว — ให้เปิดหมวดย่อยใหม่`);
    const RR = String(rr).padStart(2, '0');
    return { code: sub === '3661' ? `3661-${RR}-${mmyy}` : `${sub}-${RR}-${mmyy}`, seq: rr, last: max };
  }
  if (!gg) throw new Error('เลือกรหัส GG ก่อน');
  if (NP_FORBIDDEN.includes(gg)) throw new Error(`รหัส ${gg} ห้ามใช้`);
  const re = new RegExp(`^${gg}-001-(?:01-)?(\\d+)$`);
  const max = Math.max(0, ...codes.map((c) => re.exec(c)).filter(Boolean).map((m) => Number(m[1])));
  const width = NP_SHORT.includes(gg) ? 3 : 4;
  const n = max + 1;
  if (String(n).length > width) throw new Error(`รหัส ${gg} ใช้ลำดับครบแล้ว`);
  return { code: `${gg}-001-01-${String(n).padStart(width, '0')}`, seq: n, last: max };
}

/** เลขหมวดย่อยถัดไปของ Group (CMC) — ใช้ GG ของหมวดที่ยังเปิดรับอยู่ */
export function nextSub(group, subs) {
  const open = subs.filter((s) => s.group === group && !s.closed && s.code !== '3661');
  const ggCount = {};
  for (const s of open) ggCount[s.code.slice(0, 2)] = (ggCount[s.code.slice(0, 2)] || 0) + 1;
  const gg = Object.entries(ggCount).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!gg) throw new Error('Group นี้ไม่มีหมวดย่อยแบบ GG-SSS ให้อ้างอิง');
  const max = Math.max(0, ...subs.filter((s) => s.code.startsWith(`${gg}-`)).map((s) => Number(s.code.slice(3))));
  return `${gg}-${String(max + 1).padStart(3, '0')}`;
}

/** รวมชื่อ 5 ส่วน (เว้นวรรค 1 เคาะ ข้ามส่วนที่ว่าง) + tag AV */
export function composeName(parts, { avTag } = {}) {
  const name = [parts.type, parts.kind, parts.model, parts.spec, parts.brand].map((s) => (s || '').trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ');
  return avTag && name ? `${avTag} ${name}` : name;
}

// คำมาตรฐานที่ใช้บ่อย: [รูปแบบที่ผิด, คำที่ถูก]
const TYPOS = [
  [/สวิทซ์|สวิทช์|สวิซ/, 'สวิตช์'], [/เบรคเกอร์|เบรคกอร์|เบรกกอร์/, 'เบรกเกอร์'], [/ปลัีก|ปลั้ก/, 'ปลั๊ก'], [/กราว์ด|กราวน์/, 'กราวด์'],
  [/บัลลาส(?!ต์)/, 'บัลลาสต์'], [/แม็คเนติก|แมคเนติก/, 'แมกเนติก'], [/คาปาซิสเตอร์/, 'คาปาซิเตอร์'], [/สปอร์ตไลท์|สปอร์ไลน์|สปอตไลต์/, 'สปอตไลท์'],
  [/วาวล์|วาว์ล/, 'วาล์ว'], [/ฟลัสวาว์ล|ฟลัสวาล์ว|ฟลัชวาวล์/, 'ฟลัชวาล์ว'], [/สต๊อปวาล์ว|สต๊อปวาวล์/, 'สต็อปวาล์ว'], [/ชัดโครก/, 'ชักโครก'],
  [/ปัสวะ/, 'ปัสสาวะ'], [/ห้วฉีด/, 'หัวฉีด'], [/แค้ม(?!ป์)|แคล้มป์/, 'แคลมป์'], [/ก้ามปุ(?!ู)/, 'ก้ามปู'], [/ตระไคร่/, 'ตะไคร่'], [/ตระกรัน/, 'ตะกรัน'],
  [/ลิตร์/, 'ลิตร'], [/ใส้กรอง/, 'ไส้กรอง'], [/ปั้ม/, 'ปั๊ม'], [/โช๊ค/, 'โช้ค'], [/อไหล่/, 'อะไหล่'], [/สตันเลส|สแตนเลด/, 'สแตนเลส'],
  [/เกลี่ยว/, 'เกลียว'], [/ติดตั่ง/, 'ติดตั้ง'], [/โทรศัพย์/, 'โทรศัพท์'], [/ลิฟท์/, 'ลิฟต์'], [/เคาเตอร์/, 'เคาน์เตอร์'],
  [/Senser/i, 'Sensor'], [/Fillter/i, 'Filter'], [/Day Light/i, 'Daylight'], [/Gae Valve/i, 'Gate Valve'], [/เฮปปา/, 'HEPA'],
  [/\bMOD\s*:/i, 'Model:'], [/sq\.?\s?mm\.?/i, 'SQMM.'], [/\bWATT\b/i, 'W'],
];
const UPPER_WORDS = ['LED', 'PVC', 'HDPE', 'HEPA', 'CCTV', 'UV'];

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * ตรวจชื่อตามมาตรฐาน
 * @returns {{errors: string[], warnings: string[], duplicates: Array, similar: Array}}
 */
export function checkName(name, { brands = [], items = [], brand, model } = {}) {
  const errors = [], warnings = [];
  const n = name.trim();
  if (!n) return { errors: ['กรอกอย่างน้อยช่อง "ประเภท"'], warnings, duplicates: [], similar: [] };

  for (const [re, right] of TYPOS) {
    const m = re.exec(n);
    if (m && m[0] !== right) warnings.push(`"${m[0]}" ควรเขียนเป็น "${right}"`);
  }
  for (const w of UPPER_WORDS) {
    const m = new RegExp(`\\b${w}\\b`, 'i').exec(n);
    if (m && m[0] !== w) warnings.push(`"${m[0]}" ควรพิมพ์ใหญ่เป็น "${w}"`);
  }
  const mixed = /[฀-๿][A-Za-z0-9]|[A-Za-z0-9][฀-๿]/.exec(n);
  if (mixed) warnings.push(`เว้นวรรคระหว่างภาษาไทยกับอังกฤษ/ตัวเลข ("${mixed[0]}")`);
  const elec = /\d\s+(W|V|A|mA|K|uF)\b/.exec(n);
  if (elec) warnings.push(`หน่วยไฟฟ้าให้ติดตัวเลข เช่น "18W" ("${elec[0]}")`);
  if (/\d\s*(Uf|uf)\b/.test(n)) warnings.push('ใช้ "uF" (u เล็ก F ใหญ่)');
  const size = /\d(mm|cm|m)\b\.?/.exec(n) || /\d\s*(MM|CM|มิล)\b/.exec(n) || /\d\s+(mm|cm|m)(?!\.)\b/.exec(n);
  if (size) warnings.push(`หน่วยขนาดให้เว้นวรรคและมีจุด เช่น "20 mm." ("${size[0]}")`);
  if (/["”]|''/.test(n)) warnings.push('ขนาดนิ้วให้เขียนคำว่า "นิ้ว" แทน " หรือ \'\'');
  if (/ยกเลิก|ยกเลิกผลิต/.test(n)) errors.push('ไม่ใส่สถานะในชื่อ (ใช้สถานะของรายการแทน)');
  if (/ยี่ห้อ|รุ่น\s/.test(n)) warnings.push('ไม่ต้องเขียนคำว่า "ยี่ห้อ" / "รุ่น"');
  const first = n.replace(/^\(AV\d*\)\s*/, '').split(' ')[0].toUpperCase();
  if (brands.includes(first)) warnings.push('ขึ้นต้นด้วยประเภท ไม่ใช่ยี่ห้อ');
  if (brand && brand !== brand.toUpperCase()) warnings.push('ยี่ห้อพิมพ์ใหญ่ทั้งหมด');

  const target = norm(n);
  const duplicates = items.filter((it) => [it.m?.name, it.g?.name].some((x) => x && norm(x) === target));
  if (duplicates.length) errors.push(`ชื่อซ้ำกับรายการเดิม ${duplicates.map((d) => d.code).join(', ')} — ตามมาตรฐานให้ใช้รหัสเดิม`);

  // รายการที่คล้ายกัน: รุ่นเดียวกัน หรือ ประเภท + ยี่ห้อเดียวกัน
  const mdl = norm(model);
  const typeWord = norm(n.replace(/^\(AV\d*\)\s*/, '').split(' ')[0]);
  const similar = items.filter((it) => !duplicates.includes(it)).filter((it) => {
    const s = norm(it.m?.name || it.g?.name);
    if (mdl.length >= 3 && s.includes(mdl)) return true;
    return brand && typeWord.length >= 2 && s.startsWith(typeWord) && s.includes(norm(brand));
  }).slice(0, 8);

  return { errors, warnings: [...new Set(warnings)], duplicates, similar };
}
