// อ่านรูปแบบ "วางในเซลล์" (Place in Cell) จากไฟล์ Excel แล้วจับคู่กับรหัสอะไหล่ในแถวเดียวกัน
// โครงสร้างไฟล์: เซลล์มี vm="N" → xl/metadata.xml → xl/richData/rdrichvalue.xml → richValueRel → xl/media/*
import JSZip from 'jszip';

const decode = (s) => s.replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

const CODE_HEADERS = ['code', 'part code', 'รหัส'];
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' };

/** @returns {Promise<{images: Array<{code, sheet, row, size, blob: () => Promise<Blob>}>, noCode: number}>} */
export async function extractCellImages(data) {
  const zip = await JSZip.loadAsync(data);
  const text = async (name) => (zip.file(name) ? zip.file(name).async('string') : '');

  const metadata = await text('xl/metadata.xml');
  if (!metadata || !zip.file('xl/richData/rdrichvalue.xml')) return { images: [], noCode: 0 };

  // richValueRel: ลำดับ → ไฟล์รูป
  const relsXml = await text('xl/richData/_rels/richValueRel.xml.rels');
  const target = {};
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0])?.[1];
    const t = /Target="([^"]+)"/.exec(m[0])?.[1];
    if (id && t) target[id] = `xl/${t.replace(/^\.\.\//, '')}`;
  }
  const relMedia = [...(await text('xl/richData/richValueRel.xml')).matchAll(/r:id="([^"]+)"/g)].map((m) => target[m[1]]);

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
  const future = [...metadata.matchAll(/<xlrd:rvb i="(\d+)"/g)].map((m) => Number(m[1]));
  const vmBlock = /<valueMetadata[^>]*>([\s\S]*?)<\/valueMetadata>/.exec(metadata)?.[1] || '';
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
    if (!pics.length) continue;
    // หาคอลัมน์รหัสจากหัวตาราง (Code / Part Code / รหัส) ใน 10 แถวแรก
    let codeCol = null, headerRow = 0;
    for (let r = 1; r <= 10 && !codeCol; r++) {
      for (const [col, v] of Object.entries(cells[r] || {})) {
        if (CODE_HEADERS.includes(v.toLowerCase())) { codeCol = col; headerRow = r; break; }
      }
    }
    for (const [row, media] of pics) {
      const code = codeCol && row > headerRow ? cells[row]?.[codeCol] : null;
      const f = zip.file(media);
      if (!code || !f) { noCode++; continue; }
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
