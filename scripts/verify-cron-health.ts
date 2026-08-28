/**
 * Cron sağlık takibi (FAZ 3 · Sıra 3.6).
 *
 * Çalıştırma (dev server ayakta olmalı):
 *   npx dotenv -e .env.local -- tsx scripts/verify-cron-health.ts
 *
 * ─── NEDEN BU TEST VAR ───────────────────────────────────────────────────
 * Hatırlatma cron'u başarısızlığı SESSİZCE yutuyordu:
 *
 *   • Tüm e-postalar başarısız olsa bile HTTP **200** dönüyordu. Vercel'in
 *     kendi cron izlemesi bu yüzden "başarılı" görüyordu — elde çalışan bir
 *     izleme mekanizması vardı ve ona yanlış sinyal veriliyordu.
 *   • Hata yalnızca `console.error` ile runtime loguna yazılıyordu; oraya
 *     kimse bakmıyor.
 *   • Admin panelinde hiçbir yerde görünmüyordu.
 *
 * Pratik sonuç: `RESEND_API_KEY` süresi dolsa, kota bitse veya hesap
 * askıya alınsa randevular alınmaya devam eder, tek bir hatırlatma gitmez
 * ve bu günlerce fark edilmez. Kuaför işinde bu doğrudan gelmeyen müşteri.
 *
 * ─── SINANAN DEĞİŞMEZLER ─────────────────────────────────────────────────
 *   • Gerçek başarısızlık varsa cron 5xx döner (Vercel'e sinyal).
 *   • Hiç başarısızlık yoksa 200 döner — yanlış alarm üretmez.
 *   • Günlük sağlık özeti dört sayıyı içerir: gönderilen, başarısız,
 *     iptal edilen doğrulanmamış randevu, yarınki randevu.
 *   • Özet günde YALNIZCA BİR KEZ gönderilir; cron tekrar çalışsa da
 *     ikinci kez gitmez (retry güvenliği).
 *   • Özetin kendisi gönderilemezse hata YUTULMAZ; yanıtta görünür ve
 *     cron başarısız sayılır.
 *   • Yetkisiz çağrı 401 döner ve hiçbir yan etki üretmez.
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
import { istanbulDateString, addIstanbulDays } from "../lib/tz";
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

const MARK = "ZZCRONHEALTH";
const PHONE_PREFIX = "0555999150";

/** Özetin gün başına bir kez gönderildiğini işaretleyen ayar anahtarı. */
const OZET_ANAHTARI = "cron_daily_summary_last_sent";

type CronYanit = { status: number; body: Record<string, unknown> };

/**
 * Cron'u Vercel'in kullandığı yolla çağırır: `Authorization: Bearer`.
 *
 * `?secret=` sorgu parametresi yalnızca `NODE_ENV !== "production"` iken
 * kabul ediliyor (bkz. lib/cron-auth.ts). Bu paket hem `next dev` hem
 * `next start` altında koştuğu için tek geçerli yol başlıktır.
 */
const cronCagir = (yol: string, secret?: string): Promise<CronYanit> => {
  return fetch(`${BASE}${yol}`, {
    cache: "no-store",
    headers: secret === undefined ? {} : { Authorization: `Bearer ${secret}` },
  }).then(async (r) => ({
    status: r.status,
    body: (await r.json().catch(() => ({}))) as Record<string, unknown>,
  }));
};

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

/** Test öncesi özet işaretinin değeri — sonunda birebir geri konur. */
let ozetIsaretiYedek: string | null | undefined;

async function cleanup() {
  const cust = await db.customer.findMany({
    where: { OR: [{ fullName: { startsWith: MARK } }, { phone: { startsWith: PHONE_PREFIX } }] },
    select: { id: true },
  });
  const ids = cust.map((c) => c.id);
  const barbers = await db.barber.findMany({ where: { name: { startsWith: MARK } }, select: { id: true } });
  const bids = barbers.map((b) => b.id);
  const appts = await db.appointment.findMany({
    where: { OR: [{ customerId: { in: ids } }, { barberId: { in: bids } }] },
    select: { id: true },
  });
  const aids = appts.map((a) => a.id);

  const audit = await db.auditLog.deleteMany({ where: { entityId: { in: [...aids, ...ids, ...bids] } } });
  await db.appointmentService.deleteMany({ where: { appointmentId: { in: aids } } });
  await db.notification.deleteMany({ where: { appointmentId: { in: aids } } });
  const randevu = await db.appointment.deleteMany({ where: { id: { in: aids } } });
  const musteri = await db.customer.deleteMany({ where: { id: { in: ids } } });
  const berber = await db.barber.deleteMany({ where: { id: { in: bids } } });
  const oksuz = await temizleAuditIzleri(db);

  return { audit: audit.count + oksuz, randevu: randevu.count, musteri: musteri.count, berber: berber.count };
}

async function main() {
  console.log("=".repeat(66));
  console.log("CRON SAGLIK TAKIBI — FAZ 3 · Sira 3.6");
  console.log("=".repeat(66));

  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET tanimli degil — testi calistiramam.");

  await cleanup();
  const isaret = await db.setting.findUnique({ where: { key: OZET_ANAHTARI } });
  ozetIsaretiYedek = isaret ? isaret.value : null;

  const service = await db.service.findFirst({ select: { id: true, name: true } });
  if (!service) throw new Error("Hizmet yok — testi calistiramam.");
  const barber = await db.barber.create({
    data: { name: `${MARK} Kalfa`, workerType: "COMMISSION", commissionRate: 40, isActive: true },
  });

  /** Yarına, hatırlatma bekleyen bir randevu kurar. */
  async function yarinRandevusu(etiket: string, email: string | null) {
    const musteri = await db.customer.create({
      data: {
        fullName: `${MARK} ${etiket}`,
        phone: `${PHONE_PREFIX}${Math.floor(Math.random() * 900 + 100)}`,
        email,
      },
    });
    return db.appointment.create({
      data: {
        customerId: musteri.id,
        barberId: barber.id,
        serviceId: service!.id,
        date: addIstanbulDays(new Date(), 1),
        startTime: "10:00",
        endTime: "11:00",
        status: "confirmed",
        reminderSent: false,
        appointmentPrice: 300,
        notes: MARK,
      },
    });
  }

  /** Özet işaretini siler — "bugün henüz gönderilmedi" durumuna döner. */
  const isaretiSifirla = () => db.setting.deleteMany({ where: { key: OZET_ANAHTARI } });

  try {
    // ── TEST 1 — Kod duzeyi: basarisizlikta 5xx var mi ───────────────────
    console.log("\nTEST 1 — Cron basarisizlikta 5xx donuyor mu (kod)");
    {
      const src = readFileSync("app/api/cron/route.ts", "utf8");
      // Kosullu donus (`status: basarisiz ? 500 : 200`) da gecerli sayilmali;
      // kalibi degil, 5xx donebilme YETENEGINI ariyoruz.
      check("Cron kodunda 5xx donus yolu VAR", /status:[^,;}]*\b5\d\d\b/.test(src), "hicbir 5xx donusu yok");
      check(
        "  ...karar basarisizlik sayisina bagli",
        /failed\s*>\s*0/.test(src),
        "5xx var ama basarisizliga bagli degil"
      );
      check("Saglik ozeti kodda VAR", /gunlukOzet|sendDailyHealthSummary/.test(src), "ozet yok");
      check("Ozet gun basina kilitleniyor", /ozetHakkiAl|updateMany/.test(src), "tekrar korumasi yok");
    }

    // ── TEST 2 — Yetkilendirme ───────────────────────────────────────────
    console.log("\nTEST 2 — Yetkilendirme");
    {
      const yetkisiz = await cronCagir("/api/cron", "yanlis-secret");
      check("Yanlis secret -> 401", yetkisiz.status === 401, `gelen ${yetkisiz.status}`);
      const secretsiz = await cronCagir("/api/cron");
      check("Secret'siz -> 401", secretsiz.status === 401, `gelen ${secretsiz.status}`);

      const isaretSonrasi = await db.setting.findUnique({ where: { key: OZET_ANAHTARI } });
      check(
        "  ...yetkisiz cagri ozet isareti BIRAKMADI",
        (isaretSonrasi?.value ?? null) === ozetIsaretiYedek,
        "yan etki uretti"
      );
    }

    // ── TEST 3 — Gercek basarisizlik: 5xx (calisma zamani) ───────────────
    //
    // Dev ortaminda RESEND_API_KEY gecerli degil; her gonderim basarisiz
    // olur. Bu, "tum mailler patliyor" senaryosunun tam karsiligidir.
    console.log("\nTEST 3 — Mailler basarisizken cron ne donuyor");
    {
      await isaretiSifirla();
      await yarinRandevusu("Hatirlatma1", "zz1@example.invalid");
      await yarinRandevusu("Hatirlatma2", "zz2@example.invalid");

      const r = await cronCagir("/api/cron", secret);
      console.log(`      yanit: HTTP ${r.status}  ${JSON.stringify(r.body).slice(0, 160)}`);

      check("Basarisizlik VAR (test kurulumu dogru)", n(r.body.failed) >= 2, `failed=${r.body.failed}`);
      check(
        "Cron 200 DONMUYOR — Vercel'e basarisizlik sinyali veriyor",
        r.status >= 500,
        `gelen ${r.status}`
      );
      check("  ...yanitta sayilar var", "sent" in r.body && "failed" in r.body, Object.keys(r.body).join(","));

      // Basarisiz gonderim `reminderSent` isaretlememeli (mevcut davranis)
      const isaretliler = await db.appointment.count({
        where: { notes: MARK, reminderSent: true },
      });
      check("  ...basarisiz gonderim reminderSent isaretlemedi", isaretliler === 0, `${isaretliler} isaretli`);
    }

    // ── TEST 4 — Saglik ozeti icerigi ────────────────────────────────────
    console.log("\nTEST 4 — Gunluk saglik ozeti");
    {
      await isaretiSifirla();
      const r = await cronCagir("/api/cron", secret);
      const ozet = (r.body.summary ?? {}) as Record<string, unknown>;
      console.log(`      ozet: ${JSON.stringify(ozet).slice(0, 200)}`);

      check("Yanitta `summary` bolumu var", Object.keys(ozet).length > 0, "ozet yok");
      for (const alan of ["reminderSent", "reminderFailed", "expiredCancelled", "tomorrowAppointments"]) {
        check(`  ...\`${alan}\` sayisi var`, alan in ozet, Object.keys(ozet).join(","));
      }
      check(
        "  ...yarinki randevu sayisi gercek (>=2)",
        n(ozet.tomorrowAppointments) >= 2,
        `${ozet.tomorrowAppointments}`
      );
      check("  ...alici `business_email`", "recipient" in ozet, Object.keys(ozet).join(","));
    }

    // ── TEST 5 — Ozet gunde BIR KEZ (retry guvenligi) ────────────────────
    //
    // Cron artik basarisizlikta 5xx donuyor; Vercel bunu yeniden deneyebilir.
    // Hatirlatmalarin tekrar denenmesi ISTENIR (reminderSent korur), ama
    // gunluk ozetin ikinci kez gitmesi ISTENMEZ.
    console.log("\nTEST 5 — Ozet gunde yalnizca bir kez gonderiliyor");
    {
      await isaretiSifirla();

      const ilk = await cronCagir("/api/cron", secret);
      const ilkOzet = (ilk.body.summary ?? {}) as Record<string, unknown>;
      check("Ilk cagri ozeti GONDERMEYI DENEDI", ilkOzet.attempted === true, JSON.stringify(ilkOzet).slice(0, 120));

      const bugun = istanbulDateString();
      const isaret2 = await db.setting.findUnique({ where: { key: OZET_ANAHTARI } });
      check("  ...bugunun tarihi isaretlendi", isaret2?.value === bugun, `${isaret2?.value} != ${bugun}`);

      const ikinci = await cronCagir("/api/cron", secret);
      const ikinciOzet = (ikinci.body.summary ?? {}) as Record<string, unknown>;
      check(
        "Ikinci cagri ozeti TEKRAR GONDERMEDI",
        ikinciOzet.attempted === false,
        JSON.stringify(ikinciOzet).slice(0, 120)
      );
      check(
        "  ...atlama sebebi belirtiliyor",
        typeof ikinciOzet.skipped === "string" && (ikinciOzet.skipped as string).length > 0,
        String(ikinciOzet.skipped)
      );

      // Es zamanli iki cagri: yalnizca biri gondermeli.
      await isaretiSifirla();
      const [a, b] = await Promise.all([cronCagir("/api/cron", secret), cronCagir("/api/cron", secret)]);
      const denemeSayisi =
        Number(((a.body.summary ?? {}) as Record<string, unknown>).attempted === true) +
        Number(((b.body.summary ?? {}) as Record<string, unknown>).attempted === true);
      check("Es zamanli iki cagride ozet YALNIZCA BIR KEZ denendi", denemeSayisi === 1, `${denemeSayisi} deneme`);
    }

    // ── TEST 6 — Ozet gonderilemezse yutulmuyor ──────────────────────────
    console.log("\nTEST 6 — Ozet gonderilemezse hata yutulmuyor");
    {
      await isaretiSifirla();
      const r = await cronCagir("/api/cron", secret);
      const ozet = (r.body.summary ?? {}) as Record<string, unknown>;

      // Dev'de RESEND anahtari gecersiz -> ozet gonderimi de basarisiz olur.
      check("Ozet gonderimi basarisiz (dev ortami)", ozet.delivered === false, `delivered=${ozet.delivered}`);
      check(
        "  ...hata SESSIZCE yutulmuyor, yanitta gorunuyor",
        typeof ozet.error === "string" && (ozet.error as string).length > 0,
        String(ozet.error)
      );
      check("  ...cron bu yuzden de basarisiz sayiliyor", r.status >= 500, `gelen ${r.status}`);
    }

    // ── TEST 7 — Basarisizlik yokken yanlis alarm uretmiyor ──────────────
    console.log("\nTEST 7 — Basarisizlik yokken 200 donuyor");
    {
      // E-postasi olmayan randevu: sendReminderEmail erken doner, hata yok.
      await db.appointment.deleteMany({ where: { notes: MARK } });
      await db.customer.updateMany({
        where: { fullName: { startsWith: MARK } },
        data: { email: null },
      });
      await yarinRandevusu("Epostasiz", null);

      // Ozet zaten bugun gonderildi -> tekrar denenmez, hata uretmez.
      const r = await cronCagir("/api/cron", secret);
      console.log(`      yanit: HTTP ${r.status}  ${JSON.stringify(r.body).slice(0, 160)}`);
      check("Basarisizlik yok", n(r.body.failed) === 0, `failed=${r.body.failed}`);
      check("Cron 200 donuyor — yanlis alarm YOK", r.status === 200, `gelen ${r.status}`);
    }
  } finally {
    console.log("\nTEMIZLIK...");
    const s = await cleanup();
    // Ozet isareti test oncesi haline dondurulur.
    if (ozetIsaretiYedek === null) {
      await db.setting.deleteMany({ where: { key: OZET_ANAHTARI } });
    } else if (ozetIsaretiYedek !== undefined) {
      await db.setting.upsert({
        where: { key: OZET_ANAHTARI },
        update: { value: ozetIsaretiYedek },
        create: { key: OZET_ANAHTARI, value: ozetIsaretiYedek },
      });
    }
    console.log(`  silinen: audit=${s.audit} randevu=${s.randevu} musteri=${s.musteri} berber=${s.berber}`);
    console.log(`  DB: ${await db.appointment.count()} randevu, ${await db.auditLog.count()} audit`);
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
