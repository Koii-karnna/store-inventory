// อ่านรูปจากไฟล์ Excel (.xlsx) แล้วจับคู่กับรหัสอะไหล่ในแถวเดียวกัน รองรับ 2 แบบ
// 1) วางในเซลล์ (Place in Cell): เซลล์มี vm="N" → xl/metadata.xml → xl/richData/rdrichvalue.xml → richValueRel → xl/media/*
// 2) ลอยบนเซลล์ (แบบเดิม): xl/drawings/drawingN.xml → anchor แถวมุมซ้ายบนของรูป → xl/media/*
import JSZip from 'jszip';

const decode = (s) => s.replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

const CODE_HEADERS = ['code', 'part code', 'รหัส', 'รหัสอะไหล่'];
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' };

/** @returns {Promise<{images: Array<{code, sheet, row, size, blob: () => Promise<Blob>}>, noCode: number}>} */
export async function extractCellImages(data) {
  const zip = await JSZip.loadAsync(data);
  const text = async (name) => (zip.file(name) ? zip.file(name).async('string') : '');

  const metadata = await text('xl/metadata.xml');
  const hasRich = !!metadata && !!zip.file('xl/richData/rdrichvalue.xml');

  // อ่านไฟล์ .rels → {rId: path ภายใน zip} (Target อ้างอิงจากโฟลเดอร์ของไฟล์ต้นทาง)
  const readRels = async (relsPath, baseDir) => {
    const out = {};
    for (const m of (await text(relsPath)).matchAll(/<Relationship\b[^>]*>/g)) {
      const id = /Id="([^"]+)"/.exec(m[0])?.[1];
      const t = /Target="([^"]+)"/.exec(m[0])?.[1];
      if (!id || !t) continue;
      const parts = (t.startsWith('/') ? t.slice(1) : `${baseDir}/${t}`).split('/');
      const stack = [];
      for (const p of parts) { if (p === '..') stack.pop(); else if (p && p !== '.') stack.push(p); }
      out[id] = stack.join('/');
    }
    return out;
  };

  // richValueRel: ลำดับ → ไฟล์รูป
  const target = hasRich ? await readRels('xl/richData/_rels/richValueRel.xml.rels', 'xl/richData') : {};
  const relMedia = hasRich ? [...(await text('xl/richData/richValueRel.xml')).matchAll(/r:id="([^"]+)"/g)].map((m) => target[m[1]]) : [];

  // rich value: ช่อง _rvRel:LocalImageIdentifier ชี้ไปที่ลำดับใน richValueRel
  const structs = [...(await text('xl/richData/rdrichvaluestructure.xml')).matchAll(/<s\b[^>]*>([\s\S]*?)<\/s>/g)]
    .map((s) => [...s[1].matchAll(/n="([^"]+)"/g)].map((k) => k[1]));
  const rvMedia = [...(await text('xl/richData/rdrichvalue.xml')).matchAll(/<rv\b[^>]*s="(\d+)"[^>]*>([\s\S]*?)<\/rv>/g)].map((rv) => {
    const keys = structs[Number(rv[1])] || [];
    const vals = [...rv[2].matchAll(/<v[^>]*>([\s\S]*?)<\/v>/g)].map((v) => v[1]);
    const i = keys.indexOf('_rvRel:LocalImageIdentifier');
    return i >= 0 ? relMedia[Number(vals[i])] : null;
  });

  // metadata: vm (เริ่มที่ 1) → ลำดับ rich value
  const future = [...(metadata || '').matchAll(/<xlrd:rvb i="(\d+)"/g)].map((m) => Number(m[1]));
  const vmBlock = /<valueMetadata[^>]*>([\s\S]*?)<\/valueMetadata>/.exec(metadata || '')?.[1] || '';
  const vmToMedia = [...vmBlock.matchAll(/<rc t="\d+" v="(\d+)"/g)].map((m) => rvMedia[future[Number(m[1])]]);

  const shared = [...(await text('xl/sharedStrings.xml')).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decode(m[1]).trim());
  const sheetNames = [...(await text('xl/workbook.xml')).matchAll(/<sheet\b[^>]*name="([^"]+)"/g)].map((m) => decode(m[1]));

  const images = [];
  let noCode = 0;
  const sheetFiles = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
  for (const [si, file] of sheetFiles.entries()) {
    const xml = await text(file);
    const cells = {}; // row → {col: value}
    const pics = []; // [row, media]
    for (const m of xml.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, col, rowS, attrs, inner = ''] = m;
      const row = Number(rowS);
      const vm = /vm="(\d+)"/.exec(attrs);
      if (vm) { const media = vmToMedia[Number(vm[1]) - 1]; if (media) pics.push([row, media]); continue; }
      let v = null;
      if (/t="s"/.test(attrs)) { const x = /<v>([\s\S]*?)<\/v>/.exec(inner); v = x ? shared[Number(x[1])] : null; }
      else if (/t="inlineStr"/.test(attrs)) v = decode(inner).trim();
      else { const x = /<v>([\s\S]*?)<\/v>/.exec(inner); v = x ? decode(x[1]).trim() : null; }
      if (v) (cells[row] ??= {})[col] = v;
    }
    // รูปลอยบนเซลล์: ใช้แถวที่จุดกึ่งกลางรูปอยู่ (รูปมักเริ่มที่ขอบล่างของแถวบนแล้วล้นลงแถวถัดไป)
    const EMU_PER_PT = 12700;
    const defH = Number(/<sheetFormatPr\b[^>]*defaultRowHeight="([\d.]+)"/.exec(xml)?.[1] || 15) * EMU_PER_PT;
    const rowH = {};
    for (const m of xml.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>/g)) {
      const ht = /\bht="([\d.]+)"/.exec(m[0]);
      if (ht) rowH[Number(m[1])] = Number(ht[1]) * EMU_PER_PT;
    }
    const h = (r) => rowH[r] ?? defH;
    const centerRow = (fromRow, fromOff, toRow, toOff) => {
      let height = toOff - fromOff;
      for (let r = fromRow; r < toRow; r++) height += h(r);
      let pos = fromOff + height / 2, r = fromRow;
      while (pos >= h(r) && r < toRow) { pos -= h(r); r++; }
      return r;
    };
    const sheetRels = await readRels(file.replace(/worksheets\/(sheet\d+\.xml)$/, 'worksheets/_rels/$1.rels'), 'xl/worksheets');
    for (const drawing of Object.values(sheetRels).filter((p) => /drawings\/drawing\d+\.xml$/.test(p))) {
      const dRels = await readRels(drawing.replace(/drawings\/(drawing\d+\.xml)$/, 'drawings/_rels/$1.rels'), 'xl/drawings');
      for (const a of (await text(drawing)).matchAll(/<xdr:(twoCellAnchor|oneCellAnchor)\b[\s\S]*?<\/xdr:\1>/g)) {
        if (!a[0].includes('<xdr:pic>')) continue;
        const from = /<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>\s*<xdr:rowOff>(-?\d+)<\/xdr:rowOff>/.exec(a[0]);
        const to = /<xdr:to>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>\s*<xdr:rowOff>(-?\d+)<\/xdr:rowOff>/.exec(a[0]);
        const embed = /r:embed="([^"]+)"/.exec(a[0]);
        if (!from || !embed || !dRels[embed[1]]) continue;
        const fr = Number(from[1]) + 1, fo = Number(from[2]);
        const row = to ? centerRow(fr, fo, Number(to[1]) + 1, Number(to[2])) : fr;
        pics.push([row, dRels[embed[1]]]);
      }
    }
    if (!pics.length) continue;
    // หาคอลัมน์รหัสจากหัวตาราง (Code / Part Code / รหัส) ใน 10 แถวแรก
    let codeCol = null, headerRow = 0;
    for (let r = 1; r <= 10 && !codeCol; r++) {
      for (const [col, v] of Object.entries(cells[r] || {})) {
        if (CODE_HEADERS.includes(v.toLowerCase())) { codeCol = col; headerRow = r; break; }
      }
    }
    const seen = new Set();
    for (const [row, media] of pics) {
      const code = codeCol && row > headerRow ? cells[row]?.[codeCol] : null;
      const f = zip.file(media);
      if (!code || !f) { noCode++; continue; }
      if (seen.has(code)) continue; // รหัสเดียวมีหลายรูป → ใช้รูปแรก
      seen.add(code);
      const ext = media.split('.').pop().toLowerCase();
      images.push({
        code, row, sheet: sheetNames[si] || file, media,
        size: f._data?.uncompressedSize ?? null,
        blob: async () => new Blob([await f.async('arraybuffer')], { type: MIME[ext] || 'image/png' }),
      });
    }
  }
  return { images, noCode };
}
