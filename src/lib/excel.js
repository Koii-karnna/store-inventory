// สร้างไฟล์ Excel: ใบขอสั่งซื้อ (มีรูป) และรายการที่ Genedia ไม่ตรงกับ Master
import { fmtDateThai } from './model.js';

const FONT = 'Tahoma';
const thin = { style: 'thin', color: { argb: 'FFBFBFBF' } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

async function loadExcelJS() {
  const mod = await import('exceljs/dist/exceljs.min.js');
  return mod.default || mod;
}

export function download(buffer, fileName) {
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const IMG_BOX = 82; // px ภายในช่องรูป

/** อ่านขนาดรูป JPEG จาก header (เพื่อคงสัดส่วนรูปใน Excel) */
function jpegSize(dataUrl) {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1, dataUrl.indexOf(',') + 1 + 65536));
  for (let i = 2; i < bin.length - 9;) {
    if (bin.charCodeAt(i) !== 0xff) return null;
    const marker = bin.charCodeAt(i + 1);
    const len = (bin.charCodeAt(i + 2) << 8) + bin.charCodeAt(i + 3);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { h: (bin.charCodeAt(i + 5) << 8) + bin.charCodeAt(i + 6), w: (bin.charCodeAt(i + 7) << 8) + bin.charCodeAt(i + 8) };
    }
    i += 2 + len;
  }
  return null;
}

const COLS = [
  { h: 'ลำดับ', w: 6 }, { h: 'รูป', w: 14 }, { h: 'รหัส', w: 16 }, { h: 'ชื่อ', w: 40 }, { h: 'ยี่ห้อ', w: 13 },
  { h: 'หน่วย', w: 7 }, { h: 'คงเหลือ', w: 8 }, { h: 'Min/Max', w: 9 }, { h: 'รับเข้าล่าสุด\n(วันที่ / จำนวน)', w: 15 },
  { h: 'จำนวนสั่ง', w: 9 }, { h: 'ราคา/หน่วย', w: 11 }, { h: 'รวม', w: 13 }, { h: 'หมายเหตุ', w: 22 },
];
const C = { qty: 10, price: 11, total: 12, note: 13 };
const L = (col) => String.fromCharCode(64 + col); // 10 → J

/**
 * จัดรายการเป็น Group → หมวดย่อย (เรียงตามรหัสหมวดย่อย)
 * NP ไม่มีหมวดย่อย: sub = null ทั้ง Group
 */
export function groupLines(lines, groupOf = (l) => l.group, subOf = (l) => l.sub, codeOf = (l) => l.code) {
  const groups = {};
  for (const l of lines) {
    const g = groupOf(l) || 'ไม่ระบุ Group';
    const s = subOf(l) || '';
    ((groups[g] ??= {})[s] ??= []).push(l);
  }
  const key = (s) => s || 'zz';
  return Object.entries(groups)
    .map(([group, subs]) => {
      const keys = Object.keys(subs).sort((a, b) => key(a).localeCompare(key(b)));
      const noSubs = keys.length === 1 && keys[0] === '';
      return {
        group,
        first: key(keys[0]),
        subs: keys.map((s) => ({ sub: noSubs ? null : s, items: subs[s].sort((a, b) => codeOf(a).localeCompare(codeOf(b))) })),
      };
    })
    .sort((a, b) => a.first.localeCompare(b.first) || a.group.localeCompare(b.group));
}

/**
 * ใบขอสั่งซื้อ: หัวเอกสาร + โครงการ/วัตถุประสงค์ + แยกหัวข้อตาม Group และหมวดย่อย + ช่องลงนามผู้ขอซื้อ, ไม่รวม VAT
 * lines: [{code,name,brand,unit,stock,min,max,group,sub,lastIn,qty,price,note}]
 * images: { [itemId]: dataURL } · subNames: { [หมวดย่อย]: ชื่อ }
 */
export async function buildPoExcel({ building, date, project, lines, images, subNames }) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('ใบขอสั่งซื้อ', {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
  });
  ws.columns = COLS.map((c) => ({ width: c.w }));
  const last = COLS.length;

  ws.mergeCells(1, 1, 1, last);
  ws.getCell(1, 1).value = `ใบขอสั่งซื้ออะไหล่ อาคาร ${building}`;
  ws.getCell(1, 1).font = { name: FONT, size: 16, bold: true };
  ws.getCell(1, 1).alignment = { horizontal: 'center' };
  ws.mergeCells(2, 1, 2, last);
  ws.getCell(2, 1).value = `วันที่ ${fmtDateThai(date)}`;
  ws.getCell(2, 1).font = { name: FONT, size: 11 };
  ws.getCell(2, 1).alignment = { horizontal: 'center' };
  ws.mergeCells(3, 1, 3, last);
  ws.getCell(3, 1).value = `โครงการ / วัตถุประสงค์: ${project?.trim() || '.'.repeat(120)}`;
  ws.getCell(3, 1).font = { name: FONT, size: 11 };
  ws.getRow(3).height = 20;

  const HEAD = 5;
  const head = ws.getRow(HEAD);
  COLS.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.h;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = BORDER;
  });
  head.height = 32;
  ws.views = [{ state: 'frozen', ySplit: HEAD }];
  ws.pageSetup.printTitlesRow = `${HEAD}:${HEAD}`;

  let r = HEAD + 1, no = 1;
  const totalCells = [];
  const header = (text, argb, size) => {
    ws.mergeCells(r, 1, r, last);
    const c = ws.getCell(r, 1);
    c.value = text;
    c.font = { name: FONT, size, bold: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
    c.border = BORDER;
    ws.getRow(r).height = 20;
    r++;
  };
  const writeLine = (l) => {
    const row = ws.getRow(r);
    const minmax = `${l.min ?? '-'}/${l.max ?? '-'}`;
    const vals = [no++, '', l.code, l.name, l.brand || '', l.unit || '', l.stock ?? '', minmax, l.lastIn || '', l.qty || '', l.price ?? '', null, l.note || ''];
    vals.forEach((v, i) => { row.getCell(i + 1).value = v; });
    const q = `${L(C.qty)}${r}`, p = `${L(C.price)}${r}`;
    row.getCell(C.total).value = { formula: `IF(OR(${q}="",${p}=""),"",${q}*${p})` };
    totalCells.push(`${L(C.total)}${r}`);
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.font = { name: FONT, size: 10 };
      cell.border = BORDER;
      cell.alignment = { vertical: 'middle', wrapText: [4, 9, C.note].includes(col), horizontal: [1, 6, 7, 8, 9, C.qty].includes(col) ? 'center' : undefined };
    });
    row.getCell(C.price).numFmt = '#,##0.00';
    row.getCell(C.total).numFmt = '#,##0.00';
    row.height = 66;
    const img = images?.[l.itemId];
    if (img) {
      const id = wb.addImage({ base64: img, extension: 'jpeg' });
      const { w, h } = jpegSize(img) || { w: 1, h: 1 };
      const s = Math.min(IMG_BOX / w, IMG_BOX / h);
      ws.addImage(id, { tl: { col: 1.08, row: r - 1 + 0.06 }, ext: { width: Math.round(w * s), height: Math.round(h * s) }, editAs: 'oneCell' });
    }
    r++;
  };
  for (const { group, subs } of groupLines(lines)) {
    header(group, 'FFDDEBF7', 11);
    for (const { sub, items } of subs) {
      if (sub !== null) header(`   ${sub || '–'}  ${subNames?.[sub] || (sub ? '' : 'ไม่ระบุหมวดย่อย')}`, 'FFF2F2F2', 10);
      items.forEach(writeLine);
    }
  }
  ws.mergeCells(r, 1, r, C.total - 1);
  const tl = ws.getCell(r, 1);
  tl.value = 'รวมทั้งสิ้น (ไม่รวม VAT)';
  tl.font = { name: FONT, size: 11, bold: true };
  tl.alignment = { horizontal: 'right' };
  const tc = ws.getCell(r, C.total);
  tc.value = { formula: totalCells.length ? `SUM(${totalCells.join(',')})` : '0' };
  tc.numFmt = '#,##0.00';
  tc.font = { name: FONT, size: 11, bold: true };
  for (let c = 1; c <= last; c++) ws.getCell(r, c).border = BORDER;

  // ช่องลงนามผู้ขอซื้อ (ชิดขวา)
  r += 3;
  for (const text of ['ลงชื่อ ......................................................... ผู้ขอซื้อ', '( ......................................................... )', 'วันที่ ........ / ........ / ........']) {
    ws.mergeCells(r, C.price - 2, r, last);
    const c = ws.getCell(r, C.price - 2);
    c.value = text;
    c.font = { name: FONT, size: 11 };
    c.alignment = { horizontal: 'center' };
    ws.getRow(r).height = 24;
    r++;
  }

  return wb.xlsx.writeBuffer();
}

const ITEM_COLS = [
  { h: 'ลำดับ', k: 'no', w: 6 }, { h: 'รูป', k: 'img', w: 14 }, { h: 'อาคาร', k: 'building', w: 7 }, { h: 'รหัส', k: 'code', w: 16 },
  { h: 'ชื่อ', k: 'name', w: 44 }, { h: 'ยี่ห้อ', k: 'brand', w: 14 }, { h: 'Group', k: 'group', w: 20 }, { h: 'หมวดย่อย', k: 'sub', w: 26 },
  { h: 'หน่วย', k: 'unit', w: 8 }, { h: 'คงเหลือ', k: 'stock', w: 9, num: true }, { h: 'Min', k: 'min', w: 7, num: true }, { h: 'Max', k: 'max', w: 7, num: true },
  { h: 'ราคา/หน่วย (Genedia)', k: 'price', w: 12, money: true }, { h: 'สถานะ', k: 'status', w: 12 }, { h: 'ระดับแจ้งเตือน', k: 'level', w: 13 },
  { h: 'กำลังสั่ง', k: 'ordering', w: 10 }, { h: 'Vendor หลัก', k: 'vendor', w: 22 }, { h: 'Vendor อื่น', k: 'vendorsOther', w: 22 },
  { h: 'วันที่รับเข้าล่าสุด', k: 'lastInDate', w: 14 }, { h: 'จำนวนรับเข้าล่าสุด', k: 'lastInQty', w: 10, num: true },
  { h: 'หมายเหตุ', k: 'note', w: 30 }, { h: 'ชื่อใน Genedia', k: 'genediaName', w: 40 }, { h: 'หมายเหตุระบบ', k: 'flags', w: 22 },
];

/**
 * รายการอะไหล่ตามตัวกรอง พร้อมรายละเอียดทั้งหมด (รูปขนาดเดียวกับใบขอซื้อ)
 * rows: [{...ค่าตาม ITEM_COLS, itemId, thumb}] · images: { [itemId]: dataURL } (ไม่มี → ใช้ thumb)
 */
export async function buildItemsExcel({ building, filterText, rows, images = {} }) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`รายการ ${building}`, {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = ITEM_COLS.map((c) => ({ width: c.w }));
  const last = ITEM_COLS.length;
  const line = (r, text, font) => {
    ws.mergeCells(r, 1, r, 12);
    ws.getCell(r, 1).value = text;
    ws.getCell(r, 1).font = { name: FONT, ...font };
  };
  line(1, `รายการอะไหล่ อาคาร ${building}`, { size: 14, bold: true });
  line(2, `ข้อมูล ณ ${fmtDateThai(new Date())} · ${rows.length.toLocaleString('th-TH')} รายการ`, { size: 10 });
  line(3, `ตัวกรอง: ${filterText || 'ทั้งหมด'}`, { size: 10, color: { argb: 'FF555555' } });

  const HEAD = 5;
  ITEM_COLS.forEach((c, i) => {
    const cell = ws.getCell(HEAD, i + 1);
    cell.value = c.h;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = BORDER;
  });
  ws.getRow(HEAD).height = 30;
  ws.views = [{ state: 'frozen', ySplit: HEAD, xSplit: 4 }];
  ws.autoFilter = { from: { row: HEAD, column: 1 }, to: { row: HEAD, column: last } };

  rows.forEach((x, i) => {
    const r = HEAD + 1 + i;
    const row = ws.getRow(r);
    ITEM_COLS.forEach((c, ci) => {
      const cell = row.getCell(ci + 1);
      cell.value = c.k === 'no' ? i + 1 : c.k === 'img' ? '' : x[c.k] ?? '';
      cell.font = { name: FONT, size: 10 };
      cell.border = BORDER;
      cell.alignment = { vertical: 'middle', wrapText: ['name', 'sub', 'note', 'genediaName', 'vendorsOther'].includes(c.k), horizontal: c.num || c.k === 'no' ? 'center' : undefined };
      if (c.money) cell.numFmt = '#,##0.00';
    });
    const img = images[x.itemId] || x.thumb;
    row.height = img ? 66 : 20;
    if (img) {
      const id = wb.addImage({ base64: img, extension: 'jpeg' });
      const { w, h } = jpegSize(img) || { w: 1, h: 1 };
      const s = Math.min(IMG_BOX / w, IMG_BOX / h);
      ws.addImage(id, { tl: { col: 1.08, row: r - 1 + 0.06 }, ext: { width: Math.round(w * s), height: Math.round(h * s) }, editAs: 'oneCell' });
    }
  });
  return wb.xlsx.writeBuffer();
}

const YELLOW = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };

/**
 * ไฟล์ทบทวนสำหรับช่าง (Min-Max / Dead Stock / ยกเลิกแต่มีของ)
 * columns: [{h, k, w, num?, money?, tech?}] — tech = ช่องเหลืองให้ช่างแก้
 * howto: [[หัวข้อ, รายละเอียด]] · list: ตัวเลือก dropdown ของช่องแรกที่เป็น tech (ถ้ามี)
 */
export async function buildReviewExcel({ sheetName, columns, rows, howto, list }) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const info = wb.addWorksheet('วิธีใช้');
  info.columns = [{ width: 24 }, { width: 110 }];
  info.addRow(['หัวข้อ', 'รายละเอียด']).font = { name: FONT, bold: true };
  for (const r of howto) info.addRow(r).eachCell((c) => { c.font = { name: FONT, size: 10 }; c.alignment = { wrapText: true, vertical: 'top' }; });

  const ws = wb.addWorksheet(sheetName);
  ws.columns = columns.map((c) => ({ width: c.w || 12 }));
  const head = ws.getRow(1);
  columns.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.h;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: c.tech ? 'FF7F6000' : 'FFFFFFFF' } };
    cell.fill = c.tech ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD966' } } : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = BORDER;
  });
  head.height = 36;
  rows.forEach((r, ri) => {
    const row = ws.getRow(ri + 2);
    columns.forEach((c, ci) => {
      const cell = row.getCell(ci + 1);
      const v = r[c.k];
      cell.value = v === undefined || v === null ? '' : v;
      cell.font = { name: FONT, size: 10 };
      cell.border = BORDER;
      if (c.tech) cell.fill = YELLOW;
      if (c.money) cell.numFmt = '#,##0.00';
      else if (c.dec) cell.numFmt = '0.00';
      if (c.num || c.money || c.dec) cell.alignment = { horizontal: 'right' };
      if (c.wrap) cell.alignment = { wrapText: true, vertical: 'top' };
    });
  });
  const firstTech = columns.findIndex((c) => c.tech);
  if (list && firstTech >= 0 && rows.length) {
    const col = String.fromCharCode(65 + firstTech);
    ws.dataValidations.add(`${col}2:${col}${rows.length + 1}`, { type: 'list', allowBlank: true, formulae: [`"${list.join(',')}"`] });
  }
  ws.views = [{ state: 'frozen', ySplit: 1, xSplit: 2 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return wb.xlsx.writeBuffer();
}

/** รายการที่ต้องไปแก้ใน Genedia */
export async function buildMismatchExcel(rows, building) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`แก้ใน Genedia ${building}`);
  ws.columns = [
    { header: 'รหัส', key: 'code', width: 18 },
    { header: 'ประเภท', key: 'type', width: 30 },
    { header: 'ค่าใน Genedia (ปัจจุบัน)', key: 'genedia', width: 55 },
    { header: 'ค่าตาม Master (ต้องแก้เป็น)', key: 'master', width: 55 },
  ];
  rows.forEach((x) => ws.addRow(x));
  ws.getRow(1).font = { name: FONT, bold: true };
  ws.eachRow((row, i) => { if (i > 1) row.font = { name: FONT, size: 10 }; });
  ws.autoFilter = { from: 'A1', to: 'D1' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return wb.xlsx.writeBuffer();
}
