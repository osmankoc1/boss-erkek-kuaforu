/**
 * Randevu silme denetim izi (FAZ 3 · Sıra 3.2).
 *
 * Çalıştırma (dev server ayakta olmalı):
 *   npx dotenv -e .env.local -- tsx scripts/verify-appointment-delete-audit.ts
 *
 * ─── NEDEN BU TEST VAR ───────────────────────────────────────────────────
 * `DELETE /api/appointments/[id]` randevuyu siliyor ama HİÇBİR denetim izi
 * bırakmıyordu. Daha kötüsü: `Sale.appointmentId` opsiyonel bir ilişki
 * olduğu için Prisma silme sırasında onu NULL'a çekiyor. Yani silinen
 * randevuya ait satış ayakta kalıyor, parası duruyor, ama **hangi randevudan
 * geldiği bilgisi kalıcı olarak kayboluyor**. Ne satışta, ne randevuda, ne de
 * denetim izinde bu bağ bir daha kurulamıyor.
 *
 * ─── SINANAN DEĞİŞMEZLER ─────────────────────────────────────────────────
 *   • Randevu silme `AuditLog`'a `Appointment/DELETE` satırı yazıyor.
 *   • İlişki koparılmadan ÖNCE okunan `saleIds` denetim izinde saklanıyor.
 *   • Silinen randevunun satışı hayatta kalıyor ve tutarı değişmiyor.
 *   • Denetim satırı, entity'si silindikten sonra da okunabiliyor.
 *   • Aktör ADMIN; `userId`/`userEmail` dolu.
 *   • Yetkisiz veya var olmayan silme denemesi denetim satırı ÜRETMİYOR.
 *   • Denetim yazılamazsa randevu da SİLİNMİYOR (aynı transaction).
 *   • Hassas alanlar (`verificationToken`, `ipAddress`, `userAgent`) denetim
 *     izine sızmıyor — fail-closed whitelist.
 *
 * UYARI: Dev veritabanına test verisi yazar ve sonunda siler.
 * Production endpoint'ine karşı çalışmayı reddeder.
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { assertWritableTestDatabase } from "../lib/db-guard";
import { SignJWT } from "jose";
import { writeAudit } from "../lib/audit";
import { temizleAuditIzleri } from "./audit-temizlik";

neonConfig.webSocketConstructor = ws;

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const { connectionString: cs } = assertWritableTestDatabase();
const db = new PrismaClient({ adapter: new PrismaNeon({ connectionString: cs }) });

let passed = 0;
let failed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`   PASS  ${name}`);
  } else {
    failed++;
    failures.push(name + (detail ? ` — ${detail}` : ""));
    console.log(`   FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const MARK = "ZZAPPTDELAUDIT";
const PHONE_PREFIX = "0555999140";

/**
 * Silinen randevuların id'leri.
 *
 * Denetim satırları bilinçli olarak "öksüz" kalır (entity silinmiştir), bu
 * yüzden temizlik onları id üzerinden bulmak zorunda — MARK ile bulunamazlar.
 */
const silinenRandevuIds: string[] = [];

type Yanit = { status: number; body: Record<string, unknown> };
let cookie = "";

const get = (u: string) =>
  fetch(`${BASE}${u}`, { headers: { Cookie: cookie }, cache: "no-store" }).then((r) => r.json());
const post = (u: string, body: unknown): Promise<Yanit> =>
  fetch(`${BASE}${u}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }));
const del = (u: string, withCookie = true): Promise<Yanit> =>
  fetch(`${BASE}${u}`, { method: "DELETE", headers: withCookie ? { Cookie: cookie } : {} }).then(async (r) => ({
    status: r.status,
    body: (await r.json().catch(() => ({}))) as Record<string, unknown>,
  }));

type AuditSatir = {
  id: string;
  entity: string;
  entityId: string;
  action: string;
  source: string;
  userId: string | null;
  userEmail: string | null;
  changes: Record<string, { before: unknown; after: unknown }> | null;
  createdAt: string;
};

/** Bir varlığa ait denetim satırlarını doğrudan veritabanından okur. */
async function auditSatirlari(entityId: string): Promise<AuditSatir[]> {
  const rows = await db.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    entity: r.entity,
    entityId: r.entityId,
    action: r.action,
    source: r.source,
    userId: r.userId,
    userEmail: r.userEmail,
    changes: (r.changes ?? null) as AuditSatir["changes"],
    createdAt: r.createdAt.toISOString(),
  }));
}

async function cleanup() {
  const cust = await db.customer.findMany({
    where: { OR: [{ fullName: { startsWith: MARK } }, { phone: { startsWith: PHONE_PREFIX } }] },
    select: { id: true },
  });
  const ids = cust.map((c) => c.id);
  const barbers = await db.barber.findMany({ where: { name: { startsWith: MARK } }, select: { id: true } });
  const bids = barbers.map((b) => b.id);
  const sales = await db.sale.findMany({
    where: { OR: [{ customerId: { in: ids } }, { note: { startsWith: MARK } }, { barberId: { in: bids } }] },
    select: { id: true },
  });
  const sids = sales.map((s) => s.id);
  const appts = await db.appointment.findMany({
    where: { OR: [{ customerId: { in: ids } }, { barberId: { in: bids } }] },
    select: { id: true },
  });
  const aids = appts.map((a) => a.id);
  const pays = await db.customerPayment.findMany({ where: { saleId: { in: sids } }, select: { id: true } });

  const audit = await db.auditLog.deleteMany({
    where: { entityId: { in: [...sids, ...aids, ...ids, ...bids, ...silinenRandevuIds, ...pays.map((p) => p.id)] } },
  });
  await db.customerPayment.deleteMany({ where: { OR: [{ saleId: { in: sids } }, { customerId: { in: ids } }] } });
  await db.saleItem.deleteMany({ where: { saleId: { in: sids } } });
  const satis = await db.sale.deleteMany({ where: { id: { in: sids } } });
  await db.appointmentService.deleteMany({ where: { appointmentId: { in: aids } } });
  await db.notification.deleteMany({ where: { appointmentId: { in: aids } } });
  const randevu = await db.appointment.deleteMany({ where: { id: { in: aids } } });
  const musteri = await db.customer.deleteMany({ where: { id: { in: ids } } });
  const berber = await db.barber.deleteMany({ where: { id: { in: bids } } });

  // Testin kendi sildigi satislar (TEST 4/5) denetim satirlarini oksuz
  // birakir; MARK ile bulunamazlar. Oksuz supurme onlari toplar.
  const oksuz = await temizleAuditIzleri(db);

  return {
    audit: audit.count + oksuz,
    satis: satis.count,
    randevu: randevu.count,
    musteri: musteri.count,
    berber: berber.count,
  };
}

async function main() {
  console.log("=".repeat(66));
  console.log("RANDEVU SILME DENETIM IZI — FAZ 3 · Sira 3.2");
  console.log("=".repeat(66));

  const admin = await db.user.findFirst({ select: { id: true, email: true } });
  if (!admin) throw new Error("Admin kullanici yok — testi calistiramam.");
  const key = new TextEncoder().encode(process.env.SESSION_SECRET);
  cookie = `session=${await new SignJWT({ userId: admin.id, expiresAt: new Date(Date.now() + 7 * 864e5) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(key)}`;

  await cleanup();

  const service = await db.service.findFirst({ select: { id: true, name: true, price: true } });
  if (!service) throw new Error("Hizmet yok — testi calistiramam.");
  const barber = await db.barber.create({
    data: { name: `${MARK} Kalfa`, workerType: "COMMISSION", commissionRate: 40, isActive: true },
  });

  /** Test için randevu oluşturur. */
  async function randevuOlustur(etiket: string, ekstra: Record<string, unknown> = {}) {
    const musteri = await db.customer.create({
      data: { fullName: `${MARK} ${etiket}`, phone: `${PHONE_PREFIX}${Math.floor(Math.random() * 900 + 100)}` },
    });
    const appt = await db.appointment.create({
      data: {
        customerId: musteri.id,
        barberId: barber.id,
        serviceId: service!.id,
        date: new Date(),
        startTime: "10:00",
        endTime: "11:00",
        status: "confirmed",
        appointmentPrice: 500,
        notes: MARK,
        ...ekstra,
      },
    });
    return { musteri, appt };
  }

  try {
    // ── TEST 1 — Kod duzeyi: DELETE rotasi denetim yaziyor mu ────────────
    console.log("\nTEST 1 — DELETE rotasi denetim izi yaziyor mu (kod)");
    {
      const src = readFileSync("app/api/appointments/[id]/route.ts", "utf8");
      const deleteBlok = src.slice(src.indexOf("export async function DELETE"));
      check("DELETE bloku bulundu", deleteBlok.length > 0);
      check("DELETE bloku `writeAudit` cagiriyor", /writeAudit\s*\(/.test(deleteBlok), "cagri yok");
      check(
        "  ...eylem DELETE olarak kaydediliyor",
        /action:\s*"DELETE"/.test(deleteBlok),
        "action: \"DELETE\" yok"
      );
      check(
        "  ...varlik Appointment olarak kaydediliyor",
        /entity:\s*"Appointment"/.test(deleteBlok),
        "entity: \"Appointment\" yok"
      );
      check(
        "  ...denetim, silme ile AYNI transaction icinde",
        /\$transaction\([\s\S]*writeAudit/.test(deleteBlok),
        "transaction disinda"
      );
      check(
        "  ...aktor oturumdan cozuluyor (adminActor)",
        /adminActor\s*\(/.test(deleteBlok),
        "adminActor cagrilmiyor"
      );
      // Sira KRITIK: silme `Sale.appointmentId`'yi NULL'a ceker. Bag ancak
      // silmeden once okunursa yakalanabilir.
      const okuma = deleteBlok.indexOf("sale.findMany");
      const silme = deleteBlok.indexOf("appointment.delete");
      check(
        "  ...bagli satislar silmeden ONCE okunuyor",
        okuma !== -1 && silme !== -1 && okuma < silme,
        okuma === -1 ? "sale.findMany hic yok" : `okuma@${okuma} silme@${silme}`
      );
    }

    // ── TEST 2 — Whitelist saleIds'i tasiyor mu ──────────────────────────
    console.log("\nTEST 2 — Fail-closed whitelist `saleIds` alanini taniyor mu");
    {
      const auditSrc = readFileSync("lib/audit.ts", "utf8");
      const apptSatiri = auditSrc.slice(
        auditSrc.indexOf("Appointment: ["),
        auditSrc.indexOf("]", auditSrc.indexOf("Appointment: ["))
      );
      check("Appointment whitelist bulundu", apptSatiri.includes("Appointment: ["), apptSatiri.slice(0, 60));
      check("  ...`saleIds` whitelist'te", apptSatiri.includes("saleIds"), `mevcut: ${apptSatiri.replace(/\s+/g, " ")}`);
      check(
        "  ...hassas alanlar whitelist DISINDA",
        !/verificationToken|ipAddress|userAgent|riskReasons/.test(apptSatiri),
        "hassas alan sizmis"
      );
    }

    // ── TEST 3 — Satissiz randevu silme ──────────────────────────────────
    console.log("\nTEST 3 — Satissiz randevu silinince denetim satiri olusuyor mu");
    {
      const { appt } = await randevuOlustur("Sade");
      silinenRandevuIds.push(appt.id);

      const oncesi = (await auditSatirlari(appt.id)).length;
      const r = await del(`/api/appointments/${appt.id}`);
      check("Silme basarili (200)", r.status === 200, `gelen ${r.status}`);
      check("Randevu gercekten silindi", (await db.appointment.findUnique({ where: { id: appt.id } })) === null);

      const izler = await auditSatirlari(appt.id);
      check("Denetim satiri OLUSTU", izler.length > oncesi, `oncesi ${oncesi}, sonrasi ${izler.length}`);

      const silme = izler.find((l) => l.action === "DELETE");
      check("  ...eylem DELETE", !!silme, izler.map((l) => l.action).join(",") || "hic satir yok");
      check("  ...varlik Appointment", silme?.entity === "Appointment", silme?.entity ?? "-");
      check("  ...kaynak ADMIN", silme?.source === "ADMIN", silme?.source ?? "-");
      check("  ...aktor userId dolu", !!silme?.userId, String(silme?.userId));
      check("  ...aktor userEmail dolu", !!silme?.userEmail, String(silme?.userEmail));
      check(
        "  ...entityId silinen randevunun id'si",
        silme?.entityId === appt.id,
        `${silme?.entityId} != ${appt.id}`
      );

      const ch = silme?.changes ?? {};
      check("  ...randevu durumu izde", "status" in ch, Object.keys(ch).join(",") || "bos");
      check("  ...randevu tarihi izde", "date" in ch, Object.keys(ch).join(",") || "bos");
      check("  ...silmede `after` degerleri null", Object.values(ch).every((d) => d.after === null), "null degil");
    }

    // ── TEST 4 — Satisli randevu: saleId izde korunuyor mu ───────────────
    console.log("\nTEST 4 — Satisli randevu silinince `saleId` izde korunuyor mu");
    {
      const { musteri, appt } = await randevuOlustur("Satisli");
      silinenRandevuIds.push(appt.id);

      const s = await post("/api/cash", {
        appointmentId: appt.id,
        customerId: musteri.id,
        barberId: barber.id,
        customerName: musteri.fullName,
        customerPhone: musteri.phone,
        serviceName: service!.name,
        serviceId: service!.id,
        listedPrice: 500,
        saleAmount: 500,
        paidAmount: 500,
        paymentMethod: "CASH",
        note: MARK,
      });
      const saleId = (s.body.sale as { id?: string } | undefined)?.id ?? "";
      check("Randevudan satis olusturuldu", s.status === 201 && !!saleId, `HTTP ${s.status}`);

      const oncekiSatis = await db.sale.findUnique({ where: { id: saleId } });
      check("  ...satis randevuya bagli", oncekiSatis?.appointmentId === appt.id, String(oncekiSatis?.appointmentId));

      const r = await del(`/api/appointments/${appt.id}`);
      check("Satisli randevu silinebiliyor (engellenmiyor)", r.status === 200, `gelen ${r.status}`);

      // ── Asil mesele: bag koptu mu, koptuysa izde duruyor mu ──
      const sonrakiSatis = await db.sale.findUnique({ where: { id: saleId } });
      check("Satis HAYATTA kaldi", !!sonrakiSatis, "satis da silinmis");
      check("  ...satis tutari degismedi", Number(sonrakiSatis?.saleAmount) === 500, String(sonrakiSatis?.saleAmount));
      check("  ...satis.appointmentId NULL'a cekildi", sonrakiSatis?.appointmentId === null, String(sonrakiSatis?.appointmentId));

      const izler = await auditSatirlari(appt.id);
      const silme = izler.find((l) => l.action === "DELETE");
      check("Silme denetim satiri var", !!silme, "yok");

      const ch = silme?.changes ?? {};
      check("  ...`saleIds` alani izde VAR", "saleIds" in ch, Object.keys(ch).join(",") || "bos");
      check(
        "  ...`saleIds` silinen bagin satis id'sini iceriyor",
        typeof ch.saleIds?.before === "string" && (ch.saleIds.before as string).includes(saleId),
        `izdeki deger: ${String(ch.saleIds?.before)} / beklenen: ${saleId}`
      );

      // Kopan bagin denetim izinden GERI KURULABILMESI
      const izdenBulunan = (String(ch.saleIds?.before ?? "")).split(",").map((x) => x.trim()).filter(Boolean);
      const geriKurulan = await db.sale.findMany({ where: { id: { in: izdenBulunan } }, select: { id: true, saleAmount: true } });
      check(
        "  ...iz uzerinden satis GERI BULUNABILIYOR",
        geriKurulan.some((x) => x.id === saleId),
        `izden ${izdenBulunan.length} id cozuldu, ${geriKurulan.length} satis bulundu`
      );

      // Hassas alan sizintisi
      const dump = JSON.stringify(ch);
      for (const alan of ["verificationToken", "ipAddress", "userAgent", "riskReasons", "notes"]) {
        check(`  ...\`${alan}\` denetim izinde YOK`, !dump.includes(alan), "sizmis");
      }

      await db.sale.deleteMany({ where: { id: saleId } });
    }

    // ── TEST 5 — Coklu satis (void + yeniden giris) ──────────────────────
    //
    // `/api/cash` ayni randevuya IKINCI bir aktif satis actirmiyor (409
    // SALE_ALREADY_EXISTS, advisory lock ile korunuyor). Ama sema
    // `sales Sale[]` ve void edilmis satis satiri silinmiyor: satis void
    // edilip yeniden girilirse randevu GERCEKTEN iki satis satirina sahip
    // olur. Denetim izi bu durumda HER IKISINI de tasimali; alanin cogul
    // olmasinin sebebi budur.
    console.log("\nTEST 5 — Void + yeniden giris: randevuda IKI satis satiri");
    {
      const { musteri, appt } = await randevuOlustur("Coklu");
      silinenRandevuIds.push(appt.id);

      const satisAc = async (tutar: number) => {
        const s = await post("/api/cash", {
          appointmentId: appt.id,
          customerId: musteri.id,
          barberId: barber.id,
          customerName: musteri.fullName,
          customerPhone: musteri.phone,
          serviceName: service!.name,
          serviceId: service!.id,
          listedPrice: tutar,
          saleAmount: tutar,
          paidAmount: tutar,
          paymentMethod: "CASH",
          note: `${MARK} ${tutar}`,
        });
        return { status: s.status, id: (s.body.sale as { id?: string } | undefined)?.id ?? "" };
      };

      const ilk = await satisAc(300);
      check("Ilk satis acildi", ilk.status === 201 && !!ilk.id, `HTTP ${ilk.status}`);

      const cakisan = await satisAc(200);
      check(
        "Ikinci AKTIF satis reddediliyor (mevcut is kurali)",
        cakisan.status === 409,
        `gelen ${cakisan.status}`
      );

      const v = await post(`/api/cash/${ilk.id}/void`, { voidReason: `${MARK} yeniden giris` });
      check("Ilk satis void edildi", v.status === 200, `gelen ${v.status}`);

      const ikinci = await satisAc(200);
      check("Void sonrasi yeni satis acilabiliyor", ikinci.status === 201 && !!ikinci.id, `HTTP ${ikinci.status}`);

      const saleIds = [ilk.id, ikinci.id].filter(Boolean);
      const gercekSayi = await db.sale.count({ where: { appointmentId: appt.id } });
      check("Randevuda gercekten IKI satis satiri var", gercekSayi === 2, `${gercekSayi} satir`);

      await del(`/api/appointments/${appt.id}`);
      const izler = await auditSatirlari(appt.id);
      const ch = izler.find((l) => l.action === "DELETE")?.changes ?? {};
      const izdeki = String(ch.saleIds?.before ?? "");
      check(
        "Denetim izi HER IKI satis id'sini de tasiyor (void dahil)",
        saleIds.length === 2 && saleIds.every((id) => izdeki.includes(id)),
        `iz: ${izdeki || "(bos)"}`
      );

      await db.customerPayment.deleteMany({ where: { saleId: { in: saleIds } } });
      await db.saleItem.deleteMany({ where: { saleId: { in: saleIds } } });
      await db.sale.deleteMany({ where: { id: { in: saleIds } } });
    }

    // ── TEST 6 — Yetkisiz ve var olmayan silme iz BIRAKMIYOR ─────────────
    console.log("\nTEST 6 — Yetkisiz / var olmayan silme denetim satiri uretmiyor");
    {
      const { appt } = await randevuOlustur("Yetkisiz");

      const oncekiToplam = await db.auditLog.count();
      const r1 = await del(`/api/appointments/${appt.id}`, false);
      check("Oturumsuz silme 401", r1.status === 401, `gelen ${r1.status}`);
      check("  ...randevu SILINMEDI", (await db.appointment.findUnique({ where: { id: appt.id } })) !== null);
      check("  ...denetim satiri yazilmadi", (await db.auditLog.count()) === oncekiToplam);

      const yokId = "zz-faz32-boyle-bir-randevu-yok";
      const r2 = await del(`/api/appointments/${yokId}`);
      check("Var olmayan randevu silme 404", r2.status === 404, `gelen ${r2.status}`);
      check("  ...denetim satiri yazilmadi", (await db.auditLog.count()) === oncekiToplam);
      check("  ...sahte id icin iz olusmadi", (await auditSatirlari(yokId)).length === 0);
    }

    // ── TEST 7 — Denetim yazilamazsa randevu da silinmiyor ───────────────
    console.log("\nTEST 7 — Denetim yazilamazsa silme geri aliniyor (atomiklik)");
    {
      const { appt } = await randevuOlustur("Atomik");

      let hataAlindi = false;
      try {
        await db.$transaction(async (tx) => {
          await tx.appointment.delete({ where: { id: appt.id } });
          // Bilerek gecersiz varlik: writeAudit fail-closed dogrulamada patlar.
          await writeAudit(tx, {
            entity: "BilinmeyenVarlik" as never,
            entityId: appt.id,
            action: "DELETE",
            actor: { source: "ADMIN", userId: admin.id, userEmail: admin.email },
          });
        });
      } catch {
        hataAlindi = true;
      }

      check("Denetim yazimi basarisiz oldu", hataAlindi, "hata firlatmadi");
      check(
        "  ...RANDEVU SILINMEDI (rollback)",
        (await db.appointment.findUnique({ where: { id: appt.id } })) !== null,
        "randevu silinmis — denetimsiz silme mumkun"
      );
    }

    // ── TEST 8 — Denetim ekrani ve API filtresi ──────────────────────────
    console.log("\nTEST 8 — Silme kaydi denetim ekraninda okunabiliyor mu");
    {
      const filtreli = (await get("/api/audit?entity=Appointment&action=DELETE")) as { logs: AuditSatir[] };
      check("entity=Appointment&action=DELETE filtresi calisiyor", Array.isArray(filtreli.logs), typeof filtreli.logs);
      check(
        "  ...donen kayitlarin hepsi Appointment/DELETE",
        filtreli.logs.every((l) => l.entity === "Appointment" && l.action === "DELETE"),
        `${filtreli.logs.length} kayit`
      );
      check(
        "  ...bu testte silinen randevular listede",
        silinenRandevuIds.some((id) => filtreli.logs.some((l) => l.entityId === id)),
        `${filtreli.logs.length} kayit dondu`
      );

      // Entity silinmis olsa da satir okunabilir olmali
      const ilk = silinenRandevuIds[0];
      const tekil = (await get(`/api/audit?entityId=${ilk}`)) as { logs: AuditSatir[] };
      check("Silinmis randevunun izi entityId ile okunabiliyor", tekil.logs.length > 0, `${tekil.logs.length} kayit`);

      const html = await fetch(`${BASE}/admin/denetim`, { headers: { Cookie: cookie } }).then((r) => r.text());
      check("Denetim ekrani render oluyor", !/Application error|Internal Server Error/.test(html));
      check("  ...`Randevu` etiketi tanimli", html.includes("Randevu"), "etiket yok");
      check("  ...`Silme` etiketi tanimli", html.includes("Silme"), "etiket yok");

      const tabloSrc = readFileSync("app/(admin)/admin/(protected)/denetim/AuditTable.tsx", "utf8");
      check("Alan etiketlerinde `saleIds` karsiligi var", /saleIds\s*:/.test(tabloSrc), "ham alan adi gosterilecek");
    }
  } finally {
    console.log("\nTEMIZLIK...");
    const s = await cleanup();
    console.log(
      `  silinen: audit=${s.audit} satis=${s.satis} randevu=${s.randevu} musteri=${s.musteri} berber=${s.berber}`
    );
    console.log(
      `  DB: ${await db.appointment.count()} randevu, ${await db.sale.count()} satis, ${await db.auditLog.count()} audit`
    );
  }

  console.log("\n" + "=".repeat(66));
  console.log(`TOPLAM: ${passed + failed}   GECEN: ${passed}   KALAN: ${failed}`);
  if (failed > 0) {
    console.log("\nBASARISIZ:");
    for (const f of failures) console.log("  - " + f);
  }
  console.log("=".repeat(66));
}

main()
  .then(() => db.$disconnect().then(() => process.exit(failed > 0 ? 1 : 0)))
  .catch(async (e) => {
    console.error("HATA:", e);
    await db.$disconnect();
    process.exit(1);
  });
