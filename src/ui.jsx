import { useEffect, useState, useSyncExternalStore } from 'react';
import { LEVELS } from './lib/model.js';

// ---------- เส้นทางหน้า (#/items?level=need) ----------
const subscribeHash = (cb) => { window.addEventListener('hashchange', cb); return () => window.removeEventListener('hashchange', cb); };
export function useRoute() {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash);
  const [path, qs] = (hash.replace(/^#/, '') || '/dashboard').split('?');
  return { path, params: Object.fromEntries(new URLSearchParams(qs || '')) };
}
export function go(path, params = {}) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null));
  const qs = new URLSearchParams(clean).toString();
  window.location.hash = path + (qs ? `?${qs}` : '');
}

// ---------- ส่วนประกอบเล็กๆ ----------
export function LevelBadge({ level }) {
  const l = LEVELS[level];
  return <span className={`badge badge-${l.color}`}>{l.label}</span>;
}

export function Badge({ color = 'gray', children, title }) {
  return <span className={`badge badge-${color}`} title={title}>{children}</span>;
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const f = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{title}</h3>
          {onClose && <button className="icon-btn" onClick={onClose} aria-label="ปิด">✕</button>}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ title, onClose, children }) {
  useEffect(() => {
    const f = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [onClose]);
  return (
    <div className="overlay overlay-drawer" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="ปิด">✕</button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function Thumb({ src, size = 40 }) {
  return src
    ? <img className="thumb" src={src} alt="" width={size} height={size} />
    : <span className="thumb thumb-none" style={{ width: size, height: size }} aria-hidden="true" />;
}

// ---------- แจ้งผลสั้นๆ ----------
let toastSet = null;
export function toast(msg, kind = 'ok') { toastSet?.({ msg, kind, at: Date.now() }); }
export function ToastHost() {
  const [t, setT] = useState(null);
  useEffect(() => { toastSet = setT; return () => { toastSet = null; }; }, []);
  useEffect(() => { if (!t) return; const id = setTimeout(() => setT(null), 3500); return () => clearTimeout(id); }, [t]);
  return t ? <div className={`toast toast-${t.kind}`} role="status">{t.msg}</div> : null;
}

/** ปุ่มที่กันกดซ้ำระหว่างทำงาน และแสดง error */
export function AsyncButton({ onClick, children, className = 'btn', disabled, ...rest }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      {...rest}
      className={className}
      disabled={disabled || busy}
      onClick={async (e) => {
        setBusy(true);
        try { await onClick(e); } catch (err) { console.error(err); toast(errorText(err), 'err'); } finally { setBusy(false); }
      }}
    >
      {busy ? 'กำลังทำงาน…' : children}
    </button>
  );
}

export function errorText(err) {
  const code = err?.code || '';
  if (code.includes('permission-denied')) return 'ไม่มีสิทธิ์ทำรายการนี้';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'Username หรือ Password ไม่ถูกต้อง';
  if (code.includes('email-already-in-use')) return 'Username นี้มีอยู่แล้ว';
  if (code.includes('weak-password')) return 'Password ต้องยาวอย่างน้อย 6 ตัวอักษร';
  if (code.includes('too-many-requests')) return 'ลองผิดหลายครั้งเกินไป กรุณารอสักครู่';
  if (code.includes('unavailable') || code.includes('network')) return 'เชื่อมต่อ server ไม่ได้ ตรวจสอบอินเทอร์เน็ต';
  return err?.message || 'เกิดข้อผิดพลาด';
}
