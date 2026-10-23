# store-inventory — คลังอะไหล่ CMC / NP

เว็บแอปสำหรับดูคลังอะไหล่จากระบบ Genedia มี Dashboard, แจ้งเตือนเมื่อใกล้ Min, เพิ่มรูป/ยี่ห้อ/Vendor, ทำใบขอสั่งซื้อ (Excel มีรูป) และเก็บ Log ผู้แก้ไข

- **โค้ด**: GitHub (repo นี้)
- **ข้อมูล / Login / เว็บ**: Firebase (Firestore + Authentication + Hosting) ใช้แผนฟรี (Spark) ได้

---

## การใช้งานประจำ (สัปดาห์ละครั้งเป็นอย่างน้อย)

1. Export จาก Genedia: `Store Part List [CMC].xls`, `Store Part List [CMA].xls` และ `Part List Report`
2. เข้าเว็บ → เมนู **นำเข้าไฟล์** → ลากไฟล์ทั้ง 3 มาวาง
3. กด **ตรวจสอบการเปลี่ยนแปลง** → ดูสรุป → **ยืนยันนำเข้า**

> Dashboard จะเตือนสีส้มถ้าข้อมูลเก่าเกิน 7 วัน

## กติกาข้อมูล

| ข้อมูล | มาจาก | แก้ที่ไหน |
|---|---|---|
| คงเหลือ, Min, Max, ต้นทุน, ราคา, ชื่อ, สถานะ, หน่วยนับ | Genedia (Store Part List + Part List Report) | **Genedia** แล้วนำเข้าใหม่ |
| Group, หมวดย่อย, ยี่ห้อ | ตั้งต้นจากไฟล์ Master | เว็บ (Admin) |
| รูป, Vendor, หมายเหตุ | — | เว็บ (Admin) |

- **ช่วงเปลี่ยนผ่าน**: เว็บแสดงชื่อ/สถานะ/หน่วยตาม Master (ปิดได้ที่ ตั้งค่า เมื่อ IT แก้ Genedia เสร็จ)
- **ไม่ตรง Master**: รายการที่ต้องไปแก้ใน Genedia — Export Excel ส่ง IT ได้ เมื่อแก้แล้วนำเข้าใหม่ รายการจะหายเอง
- **ระดับแจ้งเตือน**: 🔴 หมด (0) · 🟠 ถึง Min · 🟡 ใกล้ Min (ไม่เกิน Min + 20% ปรับได้) · Min ว่างหรือ 0 = "ไม่มี Min"
- **กำลังสั่ง**: ติดป้ายเมื่อ Export ใบขอซื้อ · หายเองเมื่อนำเข้าแล้วคงเหลือเพิ่มขึ้น · หรือกด "ไม่อนุมัติ" / "ปิดใบ" / ยกเลิกรายตัว
- **รูป**: ระบบย่อให้อัตโนมัติ ด้านยาว 400px ไม่เกิน 80 KB
- **สิทธิ์**: Admin = นำเข้า แก้ไข ทำใบขอซื้อ จัดการผู้ใช้ · Viewer = ดูอย่างเดียว · ทุกการแก้ไขบันทึก Log (ใคร เมื่อไร ช่องไหน ค่าเดิม → ค่าใหม่)

---

## ติดตั้งครั้งแรก (ทำครั้งเดียว)

### 1. ตั้งค่า Firebase Console (https://console.firebase.google.com)

1. เลือกโปรเจกต์ → **Build → Authentication → Get started → Sign-in method → Email/Password → Enable**
2. **Build → Firestore Database → Create database** → Location: `asia-southeast1 (Singapore)` → Production mode
3. **⚙️ Project settings → General → Your apps → `</>` (Web)** → ตั้งชื่อ → Register → คัดลอกค่า `firebaseConfig`
4. นำค่าไปใส่ในไฟล์ `src/firebase-config.js`

### 2. ติดตั้งและ Deploy (ในโฟลเดอร์ repo นี้)

```bash
npm install
npx firebase login
npx firebase use --add
npm run deploy
```

- `firebase login` จะเปิดเบราว์เซอร์ให้ login ด้วย Google account ที่เป็นเจ้าของโปรเจกต์ Firebase
- `firebase use --add` เลือกโปรเจกต์ แล้วตั้งชื่อเล่นว่า `default`
- `npm run deploy` จะ build เว็บ + ส่งกติกาความปลอดภัย (firestore.rules) + ขึ้นเว็บ ได้ URL เช่น `https://<project-id>.web.app`

### 3. สร้าง Admin คนแรก

เปิด URL ของเว็บ → หน้าแรกจะให้ **สร้าง Admin คนแรก** (ทำได้ครั้งเดียว ควรทำทันทีหลัง deploy) → จากนั้นนำเข้าไฟล์ Genedia **พร้อมไฟล์ Master** ในครั้งแรก

### 4. ส่งโค้ดขึ้น GitHub

เปิด **GitHub Desktop** → เลือก repo `store-inventory` → ใส่ข้อความใน Summary → **Commit to main** → **Push origin**
(ไฟล์ Excel ข้อมูลจริงถูกตั้งไว้ไม่ให้ขึ้น GitHub แล้วใน `.gitignore`)

---

## สำหรับผู้พัฒนา

```bash
npm run dev
npm run test:parse
npm run deploy:rules
```

- `npm run dev` — เปิดเว็บในเครื่องที่ http://localhost:5173
- `npm run test:parse` — ทดสอบการอ่านไฟล์ Genedia/Master จริงจากโฟลเดอร์ `../../Store Part list`
- `npm run deploy:rules` — ส่งเฉพาะกติกาความปลอดภัยและ index

โครงสร้างหลัก:

```
src/lib/parse.js       อ่านไฟล์ Store Part List / Part List Report / Master
src/lib/importPlan.js  คำนวณการเปลี่ยนแปลงก่อนนำเข้า
src/lib/model.js       ค่าที่แสดง, ระดับแจ้งเตือน, ความไม่ตรงกับ Master
src/lib/excel.js       สร้าง Excel ใบขอซื้อ (มีรูป) / รายการแก้ Genedia
src/lib/db.js          เขียน Firestore พร้อม Log
src/pages/*            หน้าจอต่างๆ
firestore.rules        สิทธิ์การเข้าถึงข้อมูล
```

ข้อมูลใน Firestore: `items` (รายการ), `images` (รูปขนาดเต็ม), `vendors`, `pos` (ใบขอซื้อ), `imports`, `logs`, `users`, `config` (Group/หมวดย่อย/ยี่ห้อ), `settings`

ข้อจำกัดแผนฟรี: อ่าน 50,000 / เขียน 20,000 ครั้งต่อวัน, พื้นที่ 1 GB — เพียงพอสำหรับข้อมูลขนาดนี้ · Admin ตั้งรหัสผ่านแทนผู้ใช้ไม่ได้ (ถ้าลืม ให้ปิดบัญชีเดิมแล้วสร้างใหม่)

## เฟส 2 (ยังไม่ทำ)

- ตัวช่วยออกรหัสใหม่ตามมาตรฐาน (หาเลขถัดไป ตรวจชื่อซ้ำ/คำผิด)
