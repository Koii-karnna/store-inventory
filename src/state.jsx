// ข้อมูลกลางของแอป: โหลดจาก Firestore แบบ realtime แล้วแชร์ให้ทุกหน้า
import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { collection, doc, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from './firebase.js';
import { DEFAULT_SETTINGS, level, view } from './lib/model.js';

export const Ctx = createContext(null);
export const useData = () => useContext(Ctx);

function useLocal(key, initial) {
  const [v, setV] = useState(() => {
    try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : initial; } catch { return initial; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* โหมดส่วนตัว */ } }, [key, v]);
  return [v, setV];
}

export function DataProvider({ user, children }) {
  const [items, setItems] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [taxonomy, setTaxonomy] = useState(null);
  const [brands, setBrands] = useState([]);
  const [pos, setPos] = useState([]);
  const [users, setUsers] = useState([]);
  const [lastImport, setLastImport] = useState({});
  const [building, setBuilding] = useLocal('si.building', 'CMC');
  const [drafts, setDrafts] = useLocal(`si.drafts.${user.uid}`, { CMC: [], NP: [] });

  useEffect(() => {
    const listen = (ref, fn) => onSnapshot(ref, fn, (e) => console.error('โหลดข้อมูลไม่ได้', e));
    const subs = [
      listen(collection(db, 'items'), (s) => setItems(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
      listen(collection(db, 'vendors'), (s) => setVendors(s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name, 'th')))),
      listen(doc(db, 'settings', 'app'), (s) => setSettings({ ...DEFAULT_SETTINGS, ...(s.data() || {}) })),
      listen(doc(db, 'config', 'taxonomy'), (s) => setTaxonomy(s.data() || null)),
      listen(doc(db, 'config', 'brands'), (s) => setBrands(s.data()?.list || [])),
      listen(query(collection(db, 'pos'), orderBy('createdAt', 'desc'), limit(200)), (s) => setPos(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
      listen(collection(db, 'users'), (s) => setUsers(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
      // การนำเข้าล่าสุดของแต่ละอาคาร (ไม่ต้องสร้าง index เพิ่ม)
      listen(query(collection(db, 'imports'), orderBy('at', 'desc'), limit(30)), (s) => {
        const rows = s.docs.map((d) => ({ id: d.id, ...d.data() }));
        setLastImport(Object.fromEntries(['CMC', 'NP'].map((b) => [b, rows.find((r) => r.buildings?.includes(b)) || null])));
      }),
    ];
    return () => subs.forEach((u) => u());
  }, []);

  // คำนวณค่าที่แสดงและระดับแจ้งเตือนครั้งเดียว ใช้ร่วมกันทุกหน้า
  const rows = useMemo(() => (items || []).map((it) => ({ ...it, v: view(it, settings), lv: level(it, settings) })), [items, settings]);
  const byBuilding = useMemo(() => ({ CMC: rows.filter((r) => r.building === 'CMC'), NP: rows.filter((r) => r.building === 'NP') }), [rows]);

  const addToDraft = useCallback((b, ids) => {
    setDrafts((d) => {
      const cur = d[b] || [];
      const have = new Set(cur.map((l) => l.itemId));
      return { ...d, [b]: [...cur, ...ids.filter((id) => !have.has(id)).map((id) => ({ itemId: id, qty: null, price: null }))] };
    });
  }, [setDrafts]);

  const value = {
    user, isAdmin: user.role === 'admin',
    loading: items === null,
    rows, byBuilding, vendors, settings, taxonomy, brands, pos, users, lastImport,
    building, setBuilding,
    drafts, setDrafts, addToDraft,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
