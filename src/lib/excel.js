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
  { h: 'ลำดับ', w: 7 }, { h: 'รูป', w: 14 }, { h: 'รหัส', w: 17 }, { h: 'ชื่อ', w: 48 }, { h: 'ยี่ห้อ', w: 14 },
  { h: 'หน่วย', w: 8 }, { h: 'คงเหลือ', w: 9 }, { h: 'Min/Max', w: 10 }, { h: 'จำนวนสั่ง', w: 10 },
  { h: 'ราคา/หน่วย', w: 12 }, { h: 'รวม', w: 14 },
];

/**
 * ใบขอสั่งซื้อ: หัวเอกสาร + แยกหัวข้อตาม Group, ไม่รวม VAT
 * lines: [{code,name,brand,unit,stock,min,max,group,qty,price}]
 * images: { [itemId]: dataURL }
 */
export async function buildPoExcel({ building, date, lines, images }) {
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

  const head = ws.getRow(4);
  COLS.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.h;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = BORDER;
  });
  head.height = 22;
  ws.views = [{ state: 'frozen', ySplit: 4 }];
  ws.pageSetup.printTitlesRow = '4:4';

  const groups = [...new Set(lines.map((l) => l.group || 'ไม่ระบุ Group'))].sort();
  let r = 5, no = 1;
  const totalCells = [];
  for (const g of groups) {
    ws.mergeCells(r, 1, r, last);
    const gc = ws.getCell(r, 1);
    gc.value = g;
    gc.font = { name: FONT, size: 11, bold: true };
    gc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
    gc.border = BORDER;
    ws.getRow(r).height = 20;
    r++;
    for (const l of lines.filter((x) => (x.group || 'ไม่ระบุ Group') === g)) {
      const row = ws.getRow(r);
      const minmax = `${l.min ?? '-'}/${l.max ?? '-'}`;
      const vals = [no++, '', l.code, l.name, l.brand || '', l.unit || '', l.stock ?? '', minmax, l.qty || '', l.price ?? '', null];
      vals.forEach((v, i) => { row.getCell(i + 1).value = v; });
      row.getCell(11).value = { formula: `IF(OR(I${r}="",J${r}=""),"",I${r}*J${r})` };
      totalCells.push(`K${r}`);
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        cell.font = { name: FONT, size: 10 };
        cell.border = BORDER;
        cell.alignment = { vertical: 'middle', wrapText: col === 4, horizontal: [1, 6, 7, 8, 9].includes(col) ? 'center' : undefined };
      });
      row.getCell(10).numFmt = '#,##0.00';
      row.getCell(11).numFmt = '#,##0.00';
      row.height = 66;
      const img = images?.[l.itemId];
      if (img) {
        const id = wb.addImage({ base64: img, extension: 'jpeg' });
        const { w, h } = jpegSize(img) || { w: 1, h: 1 };
        const s = Math.min(IMG_BOX / w, IMG_BOX / h);
        ws.addImage(id, { tl: { col: 1.08, row: r - 1 + 0.06 }, ext: { width: Math.round(w * s), height: Math.round(h * s) }, editAs: 'oneCell' });
      }
      r++;
    }
  }
  ws.mergeCells(r, 1, r, last - 1);
  const tl = ws.getCell(r, 1);
  tl.value = 'รวมทั้งสิ้น (ไม่รวม VAT)';
  tl.font = { name: FONT, size: 11, bold: true };
  tl.alignment = { horizontal: 'right' };
  const tc = ws.getCell(r, last);
  tc.value = { formula: totalCells.length ? `SUM(${totalCells.join(',')})` : '0' };
  tc.numFmt = '#,##0.00';
  tc.font = { name: FONT, size: 11, bold: true };
  for (let c = 1; c <= last; c++) ws.getCell(r, c).border = BORDER;

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
