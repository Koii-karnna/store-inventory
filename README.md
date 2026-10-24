# store-inventory — คลังอะไหล่ CMC / NP

เว็บแอปสำหรับดูคลังอะไหล่จากระบบ Genedia มี Dashboard, แจ้งเตือนเมื่อใกล้ Min, เพิ่มรูป/ยี่ห้อ/Vendor, ทำใบขอสั่งซื้อ (Excel มีรูป) และเก็บ Log ผู้แก้ไข

- **เว็บ**: https://koii-karnna.github.io/store-inventory/ (GitHub Pages — อัปเดตอัตโนมัติทุกครั้งที่ Push)
- **ข้อมูล / Login**: Firebase โปรเจกต์ `set-store-inventory` (Firestore + Authentication) แผนฟรี (Spark)

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

- **ช่วงเปลี่ยนผ่าน**: เว็บแสดงชื่อ/หน่วยตาม Master (ปิดได้ที่ ตั้งค่า เมื่อ IT แก้ Genedia เสร็จ)
- **สถานะ**: ยกเลิกใน Genedia หรือ Master อย่างใดอย่างหนึ่ง = ยกเลิก (ไม่นับใน หมด / ต้องสั่ง / ไม่มี Min และสั่งซื้อไม่ได้)
- **ไม่ตรง Master**: รายการที่ต้องไปแก้ใน Genedia — Export Excel ส่ง IT ได้ เมื่อแก้แล้วนำเข้าใหม่ รายการจะหายเอง
- **ระดับแจ้งเตือน**: 🔴 หมด (0) · 🟠 ถึง Min · 🟡 ใกล้ Min (ไม่เกิน Min + 20% ปรับได้) · Min ว่างหรือ 0 = "ไม่มี Min"
- **กำลังสั่ง**: ติดป้ายเมื่อ Export ใบขอซื้อ · หายเองเมื่อนำเข้าแล้วคงเหลือเพิ่มขึ้น · หรือกด "ไม่อนุมัติ" / "ปิดใบ" / ยกเลิกรายตัว
- **รูป**: ระบบย่อให้อัตโนมัติ ด้านยาว 400px ไม่เกิน 80 KB
- **สิทธิ์**: Admin = นำเข้า แก้ไข ทำใบขอซื้อ จัดการผู้ใช้ · Viewer = ดูอย่างเดียว · ทุกการแก้ไขบันทึก Log (ใคร เมื่อไร ช่องไหน ค่าเดิม → ค่าใหม่)

---

## ติดตั้งครั้งแรก (ทำครั้งเดียว)

### 1. Firebase Console (https://console.firebase.google.com → โปรเจกต์ set-store-inventory)

1. **Authentication → Sign-in method → Email/Password → Enable**
2. **Authentication → Settings → Authorized domains → Add domain** → `koii-karnna.github.io`
3. **Firestore Database → Rules** → ลบของเดิมทั้งหมด → วางเนื้อหาไฟล์ [`firestore.rules`](firestore.rules) → **Publish**

(ไม่ต้องสร้าง Index เพิ่ม)

> ถ้าแก้ไฟล์ `firestore.rules` ภายหลัง ต้องวางใหม่ในข้อ 3 อีกครั้ง (เว็บจะไม่อัปเดต Rules ให้เอง)

### 2. เปิด GitHub Pages (ครั้งเดียว)

GitHub → repo `store-inventory` → **Settings → Pages → Build and deployment → Source: GitHub Actions**

### 3. Push โค้ด

**GitHub Desktop** → **Push origin** → รอ 1–2 นาที (ดูความคืบหน้าที่แท็บ **Actions** ใน GitHub) → เปิด https://koii-karnna.github.io/store-inventory/

### 4. สร้าง Admin คนแรก

เปิดเว็บ → หน้าแรกจะให้ **สร้าง Admin คนแรก** (ทำได้ครั้งเดียว ควรทำทันที) → จากนั้นนำเข้าไฟล์ Genedia **พร้อมไฟล์ Master** ในครั้งแรก

## การใช้อะไหล่ และ ทบทวน Min-Max / Dead Stock

- **ตั้งต้น (ครั้งเดียว):** นำเข้า `Store Part list/Output/Usage_Reconciliation_2023-2026_*_v2.xlsx` (ประวัติ G1+G2 ที่ตรวจแล้ว · แทนที่ข้อมูลการเบิกเดิมทั้งหมด)
- **ทุกเดือน:** Export **Part Usage Report** CMC + NP จาก Genedia (ไม่กรองวันที่) → นำเข้าไฟล์ → ระบบข้ามบรรทัดที่เคยนำเข้าแล้ว
  (ตรวจซ้ำด้วย อาคาร + ใบงาน + รหัส + จำนวน + วันปิดงาน + วันที่เบิก ระดับนาที และนับจำนวนบรรทัด)
- วันที่ของการเบิก = วันที่ปิดงาน · รหัสที่ไม่อยู่ใน Master เก็บเป็นประวัติ ไม่นับ
- **Min/Max เสนอ** (ให้ช่างทบทวนเท่านั้น): ใช้ต่อเดือน = เฉลี่ย 24 เดือนล่าสุด (CMC ไม่นับ ก.พ.–มี.ค. 2026 ที่ข้อมูลตกหล่น) · ระยะรอของ 2 เดือน
  · สั่งปีละ 2 ครั้งเมื่อใช้ ≥ 24/ปี (Admin เปลี่ยนรายตัวได้) · Min = ปัดขึ้น(ใช้/เดือน × 2) ≥ 1 · Max = ปัดขึ้น(ใช้/เดือน × 12/สั่งปีละ + ใช้/เดือน × 2) ≥ Min+1
  · ไม่ถูกเบิกใน 24 เดือน = Min 1 / Max 2 · ไม่คำนวณ: รายการยกเลิก และน้ำยา/เกลือที่หน่วยตอนเบิกไม่ตรง Master
- **ทบทวน** → Export Excel ให้ช่าง (ช่องเหลือง) → Admin แก้ใน Genedia → นำเข้า Store Part List ค่าใหม่ขึ้นเอง
- กติกาอยู่ใน `src/lib/usage.js` (USAGE_RULES, USAGE_GAPS) · สคริปต์สร้างไฟล์ตั้งต้น: `Store Part list/Output/build_usage_reconciliation.py`

## ออกรหัสใหม่ (Admin)

เมนู **ออกรหัสใหม่** → เลือกหมวด → กรอกชื่อ 5 ส่วน → ระบุหน่วย → **จองรหัส** → คัดลอก รหัส / ชื่อ / หน่วย ไปเพิ่มใน Genedia

- เลขถัดไปคิดตามมาตรฐานใน Master: นับรวมรายการที่ยกเลิก, รหัสเดิมที่รูปแบบผิด (เช่น 12-001-0019), ปิดหมวด 05-002 และรหัส 20, NP 21–23 ใช้ 3 หลัก
- ตรวจชื่อตามกติกาการตั้งชื่อ + คำมาตรฐาน + ชื่อซ้ำ (ซ้ำ = ใช้รหัสเดิม จองไม่ได้)
- CMC เปิดหมวดย่อยใหม่ได้ (เลข SSS ถัดไปของ Group) · นำเข้า Master ใหม่ไม่ลบหมวดที่เปิดในเว็บ
- รายการที่จองแล้วขึ้นสถานะ **รอเพิ่มใน Genedia** → นำเข้าไฟล์ Store Part List ที่มีรหัสนั้นแล้วเปลี่ยนเป็นปกติเอง
- แก้ชื่อ/หน่วยของรหัสที่จองได้ในหน้ารายละเอียด · ยกเลิกการจองได้ (เลขนั้นจะไม่ถูกนำกลับมาใช้)

## สำรองข้อมูล (เดือนละครั้ง)

เว็บ → **ตั้งค่า → สำรองข้อมูล → ดาวน์โหลดไฟล์สำรอง** → ได้ไฟล์ `store-backup_YYYY-MM-DD_HHMM.zip` → เก็บไว้ใน OneDrive / Shared Drive ของหน่วยงาน

- ไฟล์รวม: รายการ รูป Vendor หมายเหตุ ใบขอซื้อ ประวัตินำเข้า ผู้ใช้ ตั้งค่า และ Log
- Dashboard ของ Admin เตือนเมื่อไม่ได้สำรองเกิน 30 วัน
- **กู้คืน**: ตั้งค่า → **กู้คืนจากไฟล์สำรอง…** → ตรวจสรุป → ยืนยัน 2 ครั้ง
  - เขียนข้อมูลในไฟล์ทับข้อมูลปัจจุบันของรายการเดียวกัน (รายการที่เพิ่มหลังวันสำรองไม่ถูกลบ)
  - Log ไม่เขียนกลับ (Log ปัจจุบันยังอยู่ และ Log เดิมดูได้ในไฟล์ `logs.json`)
  - บัญชี login/รหัสผ่านไม่อยู่ในไฟล์

## ลืมรหัสผ่าน

**ผู้ใช้ทั่วไป / Admin ที่ยังมี Admin คนอื่น** (Admin อีกคนทำให้)
1. เว็บ → เมนู **ผู้ใช้** → **ปิดบัญชี** คนที่ลืม
2. Firebase Console → **Authentication → Users** → ค้นหา `username@store-inventory.local` → ⋮ → **Delete account**
3. เว็บ → **+ เพิ่มผู้ใช้** ด้วย Username เดิม และรหัสผ่านใหม่ (เลือกสิทธิ์เดิม)

**Admin คนเดียวในระบบลืมรหัสผ่าน** (ทำใน Firebase Console ทั้งหมด)
1. **Authentication → Users** → ลบบัญชีเดิม → **Add user** ใส่ `username@store-inventory.local` และรหัสผ่านใหม่ → คัดลอก **User UID**
2. **Firestore Database → Data → users** → **Add document** → Document ID = UID ที่คัดลอก → เพิ่มช่อง `username` (string), `name` (string), `role` = `admin` (string), `active` = `true` (boolean)

> แนะนำให้มี Admin อย่างน้อย 2 คน จะได้ไม่ต้องใช้วิธีที่ 2

## การอัปเดตเว็บครั้งต่อไป

แก้โค้ด → GitHub Desktop: **Commit to main** → **Push origin** → เว็บอัปเดตเองใน 1–2 นาที
(ไฟล์ Excel ข้อมูลจริงถูกตั้งไว้ไม่ให้ขึ้น GitHub แล้วใน `.gitignore`)

---

## สำหรับผู้พัฒนา

```bash
npm install
npm run dev
npm run test:parse
```

- `npm run dev` — เปิดเว็บในเครื่องที่ http://localhost:5173
- `npm run test:parse` — ทดสอบการอ่านไฟล์ Genedia/Master จริงจากโฟลเดอร์ `../../Store Part list`
- Deploy: `.github/workflows/deploy.yml` build และขึ้น GitHub Pages ทุกครั้งที่ push เข้า `main`

โครงสร้างหลัก:

```
src/lib/parse.js       อ่านไฟล์ Store Part List / Part List Report / Master
src/lib/importPlan.js  คำนวณการเปลี่ยนแปลงก่อนนำเข้า
src/lib/model.js       ค่าที่แสดง, ระดับแจ้งเตือน, ความไม่ตรงกับ Master
src/lib/excel.js       สร้าง Excel ใบขอซื้อ (มีรูป) / รายการแก้ Genedia
src/lib/db.js          เขียน Firestore พร้อม Log
src/pages/*            หน้าจอต่างๆ
firestore.rules        สิทธิ์การเข้าถึงข้อมูล (วางใน Firebase Console เอง)
```

ข้อมูลใน Firestore: `items` (รายการ), `images` (รูปขนาดเต็ม), `vendors`, `pos` (ใบขอซื้อ), `imports`, `logs`, `users`, `config` (Group/หมวดย่อย/ยี่ห้อ), `settings`

ข้อจำกัดแผนฟรี: อ่าน 50,000 / เขียน 20,000 ครั้งต่อวัน, พื้นที่ 1 GB — เพียงพอสำหรับข้อมูลขนาดนี้ · Admin ตั้งรหัสผ่านแทนผู้ใช้ไม่ได้ (ถ้าลืม ให้ปิดบัญชีเดิมแล้วสร้างใหม่)

## เฟส 2 (ยังไม่ทำ)

- ตัวช่วยออกรหัสใหม่ตามมาตรฐาน (หาเลขถัดไป ตรวจชื่อซ้ำ/คำผิด)
