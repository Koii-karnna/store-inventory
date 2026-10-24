import { fmtNum, fmtIsoDateThai } from '../lib/model.js';
import { useReceiveLines } from '../lib/receiveStore.js';
import { suspiciousPrice, referencePrice } from '../lib/receive.js';

/** ประวัติการรับเข้า (จาก Part Receive Report) ในหน้ารายละเอียดรายการ */
export default function ReceiveSection({ item }) {
  const { lines, loading } = useReceiveLines(item.building);
  if (loading) return null;
  const mine = lines.filter((l) => l.c === item.code).sort((a, b) => b.d.localeCompare(a.d));
  if (!mine.length) return null;
  const ref = referencePrice(item);
  return (
    <section>
      <h4>ประวัติการรับเข้า <small className="muted">({mine.length} ครั้ง จาก Part Receive Report)</small></h4>
      <table className="table compact">
        <thead><tr><th>วันที่รับ</th><th className="num">จำนวน</th><th className="num">ราคา (ตามไฟล์)</th><th>ผู้ขาย</th></tr></thead>
        <tbody>
          {mine.slice(0, 10).map((l, i) => (
            <tr key={i}>
              <td className="nowrap small">{fmtIsoDateThai(l.d)}</td>
              <td className="num">{fmtNum(l.q)}</td>
              <td className="num">
                {l.p !== undefined ? fmtNum(l.p) : '–'}
                {suspiciousPrice(l, ref) && <div className="t-orange small">อาจเป็นราคารวม (÷{l.q} = {fmtNum(Math.round((l.p / l.q) * 100) / 100)})</div>}
              </td>
              <td className="small">{l.s || <span className="muted">–</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
