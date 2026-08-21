/**
 * Seed / admin varsayılanları hijyen testi.
 *
 * Çalıştırma (dev server GEREKMEZ):
 *   npx dotenv -e .env.local -- tsx scripts/verify-seed-hygiene.ts
 *
 * UYARI: Bölüm C, seed'i dev veritabanına karşı gerçekten çalıştırır ve
 * seed'in oluşturduğu TÜM kayıtları sonunda siler (öncesinde id anlık
 * görüntüsü alınır, sonrasında yalnızca YENİ id'ler silinir).
 * Gerçek kayıtlara ve mevcut admin hesabına dokunulmaz.
 * Production endpoint'ine karşı çalışmayı reddeder.
 */
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { assertWritableTestDatabase } from "../lib/db-guard";
import bcrypt from "bcryptjs";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

neonConfig.webSocketConstructor = ws;

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

const TEST_EMAIL = "zzseedtest@example.invalid";
const PASS_1 = "ilk-parola-uzun-1";
const PASS_2 = "ikinci-parola-uzun-2";

/** Seed'i alt süreçte çalıştırır. `env` içindeki null değerler silinir. */
function runSeed(env: Record<string, string | null>) {
  const childEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) childEnv[k] = v;
  for (const [k, v] of Object.entries(env)) {
    if (v === null) delete childEnv[k];
    else childEnv[k] = v;
  }
  const res = spawnSync("npx", ["--no-install", "tsx", "prisma/seed.ts"], {
    env: childEnv as NodeJS.ProcessEnv,
    encoding: "utf8",
    shell: true,
    timeout: 300000,
  });
  return {
    code: res.status,
    out: `${res.stdout ?? ""}`,
    err: `${res.stderr ?? ""}`,
    all: `${res.stdout ?? ""}${res.stderr ?? ""}`,
  };
}

/** Seed'in yazdığı tabloların mevcut id'leri. */
async function snapshot() {
  const [users, barbers, services, customers, appointments, workingHours, campaigns, settings] = await Promise.all([
    db.user.findMany({ select: { id: true } }),
    db.barber.findMany({ select: { id: true } }),
    db.service.findMany({ select: { id: true } }),
    db.customer.findMany({ select: { id: true } }),
    db.appointment.findMany({ select: { id: true } }),
    db.workingHour.findMany({ select: { id: true } }),
    db.campaign.findMany({ select: { id: true } }),
    db.setting.findMany({ select: { key: true } }),
  ]);
  return {
    users: users.map((r) => r.id),
    barbers: barbers.map((r) => r.id),
    services: services.map((r) => r.id),
    customers: customers.map((r) => r.id),
    appointments: appointments.map((r) => r.id),
    workingHours: workingHours.map((r) => r.id),
    campaigns: campaigns.map((r) => r.id),
    settings: settings.map((r) => r.key),
  };
}

type Snapshot = Awaited<ReturnType<typeof snapshot>>;

/** Anlık görüntüden sonra eklenen HER kaydı siler (FK güvenli sırada). */
async function restore(before: Snapshot) {
  const now = await snapshot();
  const yeni = <T extends keyof Snapshot>(k: T) => now[k].filter((id) => !before[k].includes(id));
  const silinen: Record<string, number> = {};

  const apptIds = yeni("appointments");
  if (apptIds.length) {
    await db.appointmentService.deleteMany({ where: { appointmentId: { in: apptIds } } });
    await db.notification.deleteMany({ where: { appointmentId: { in: apptIds } } });
    silinen.randevu = (await db.appointment.deleteMany({ where: { id: { in: apptIds } } })).count;
  }
  const whIds = yeni("workingHours");
  if (whIds.length) silinen.calismaSaati = (await db.workingHour.deleteMany({ where: { id: { in: whIds } } })).count;
  const custIds = yeni("customers");
  if (custIds.length) silinen.musteri = (await db.customer.deleteMany({ where: { id: { in: custIds } } })).count;
  const svcIds = yeni("services");
  if (svcIds.length) silinen.hizmet = (await db.service.deleteMany({ where: { id: { in: svcIds } } })).count;
  const barbIds = yeni("barbers");
  if (barbIds.length) silinen.berber = (await db.barber.deleteMany({ where: { id: { in: barbIds } } })).count;
  const campIds = yeni("campaigns");
  if (campIds.length) silinen.kampanya = (await db.campaign.deleteMany({ where: { id: { in: campIds } } })).count;
  const userIds = yeni("users");
  if (userIds.length) silinen.kullanici = (await db.user.deleteMany({ where: { id: { in: userIds } } })).count;
  const keys = yeni("settings");
  if (keys.length) silinen.ayar = (await db.setting.deleteMany({ where: { key: { in: keys } } })).count;

  return silinen;
}

async function main() {
  // ── BÖLÜM A — Statik kod taraması ────────────────────────────────────
  console.log("BOLUM A — Sabit kodlanmis kimlik bilgisi kalmis mi");
  const seedSrc = readFileSync("prisma/seed.ts", "utf8");
  const loginSrc = readFileSync("app/(admin)/admin/login/page.tsx", "utf8");

  check("seed.ts icinde 'boss2024' YOK", !seedSrc.includes("boss2024"));
  check("seed.ts icinde 'admin@boss.com' YOK", !seedSrc.includes("admin@boss.com"));
  check("seed.ts SEED_ADMIN_EMAIL okuyor", seedSrc.includes("SEED_ADMIN_EMAIL"));
  check("seed.ts SEED_ADMIN_PASSWORD okuyor", seedSrc.includes("SEED_ADMIN_PASSWORD"));
  check("login sayfasi placeholder'inda 'admin@boss.com' YOK", !loginSrc.includes("admin@boss.com"));

  // Log satirlarinda sifre/hash degiskeni gecmemeli.
  const logSatirlari = seedSrc.split("\n").filter((l) => /console\.(log|info|warn|error)/.test(l));
  const sizdiran = logSatirlari.filter((l) => /\$\{[^}]*(assword|asswordHash|Hash)[^}]*\}/.test(l));
  check("seed.ts log satirlari sifre/hash yazdirmiyor", sizdiran.length === 0, sizdiran.join(" | ").slice(0, 120));

  console.log("\nBOLUM A2 — Urun kodu genelinde tarama");
  const taranan = [
    "prisma/seed.ts",
    "app/(admin)/admin/login/page.tsx",
    "app/actions/auth.ts",
    "lib/session.ts",
    "lib/dal.ts",
    "lib/login-rate-limit.ts",
  ];
  for (const f of taranan) {
    let src = "";
    try {
      src = readFileSync(f, "utf8");
    } catch {
      check(`${f} okunabildi`, false, "dosya yok");
      continue;
    }
    check(`${f} · eski varsayilanlar YOK`, !src.includes("boss2024") && !src.includes("admin@boss.com"));
  }

  // ── BÖLÜM B — Env eksik/hatalıysa güvenli fail ───────────────────────
  console.log("\nBOLUM B — Env eksik/hataliysa seed guvenli sekilde durmali");
  const dbOnce = await snapshot();

  const senaryolar: [string, Record<string, string | null>, string][] = [
    ["her ikisi de yok", { SEED_ADMIN_EMAIL: null, SEED_ADMIN_PASSWORD: null }, "SEED_ADMIN_EMAIL"],
    ["yalniz e-posta var", { SEED_ADMIN_EMAIL: TEST_EMAIL, SEED_ADMIN_PASSWORD: null }, "SEED_ADMIN_PASSWORD"],
    ["yalniz sifre var", { SEED_ADMIN_EMAIL: null, SEED_ADMIN_PASSWORD: PASS_1 }, "SEED_ADMIN_EMAIL"],
    ["e-posta bos string", { SEED_ADMIN_EMAIL: "   ", SEED_ADMIN_PASSWORD: PASS_1 }, "SEED_ADMIN_EMAIL"],
    ["sifre cok kisa", { SEED_ADMIN_EMAIL: TEST_EMAIL, SEED_ADMIN_PASSWORD: "kisa" }, "karakter"],
    ["e-posta gecersiz", { SEED_ADMIN_EMAIL: "duz-metin", SEED_ADMIN_PASSWORD: PASS_1 }, "e-posta"],
  ];
  for (const [label, env, beklenenMetin] of senaryolar) {
    const r = runSeed(env);
    check(`${label} -> sifir olmayan cikis kodu`, r.code !== 0, `kod=${r.code}`);
    check(`  ...hata mesaji yol gosteriyor ('${beklenenMetin}')`, r.all.includes(beklenenMetin),
      r.all.split("\n").slice(0, 2).join(" ").slice(0, 100));
    check(`  ...sifre ciktida gecmiyor`, !r.all.includes(PASS_1) && !r.all.includes("kisa\n"), "sifre sizdi");
  }
  const dbSonra = await snapshot();
  check("Basarisiz seed denemeleri veritabanina HICBIR sey yazmadi",
    dbSonra.users.length === dbOnce.users.length &&
      dbSonra.barbers.length === dbOnce.barbers.length &&
      dbSonra.customers.length === dbOnce.customers.length &&
      dbSonra.appointments.length === dbOnce.appointments.length,
    `once=${dbOnce.users.length}/${dbOnce.barbers.length}/${dbOnce.customers.length}/${dbOnce.appointments.length} sonra=${dbSonra.users.length}/${dbSonra.barbers.length}/${dbSonra.customers.length}/${dbSonra.appointments.length}`);

  console.log("\nBOLUM B2 — Allowlist DISI endpoint'e karsi seed reddedilmeli");
  const sahteProd = runSeed({
    DATABASE_URL: "postgresql://kullanici:parola@ep-baska-bir-endpoint-pooler.eu-central-1.aws.neon.tech/neondb",
    SEED_ADMIN_EMAIL: TEST_EMAIL,
    SEED_ADMIN_PASSWORD: PASS_1,
  });
  check("Allowlist disi endpoint -> sifir olmayan cikis", sahteProd.code !== 0, `kod=${sahteProd.code}`);
  check("  ...gerekce belirtiliyor", /izinli|DURDURULDU/i.test(sahteProd.all), sahteProd.all.slice(0, 140));

  // ── BÖLÜM C — Env varsa admin oluşturma ve güncelleme ────────────────
  console.log("\nBOLUM C — Env varsa admin hesabi olusturuluyor/guncelleniyor");
  const gercekAdminOnce = await db.user.findFirst({
    where: { email: { not: TEST_EMAIL } },
    select: { id: true, email: true, passwordHash: true, name: true },
    orderBy: { id: "asc" },
  });
  const before = await snapshot();

  try {
    // 1. çalıştırma — hesap yok, oluşturulmalı
    const r1 = runSeed({ SEED_ADMIN_EMAIL: TEST_EMAIL, SEED_ADMIN_PASSWORD: PASS_1 });
    check("Env tamken seed basarili (cikis 0)", r1.code === 0, `kod=${r1.code} ${r1.all.split("\n").slice(-3).join(" ").slice(0, 140)}`);
    const u1 = await db.user.findUnique({ where: { email: TEST_EMAIL }, select: { id: true, passwordHash: true, name: true } });
    check("Admin hesabi olusturuldu", u1 !== null, "olusmadi");
    check("  ...sifre dogru hash'lendi", u1 ? bcrypt.compareSync(PASS_1, u1.passwordHash) : false, "hash eslesmedi");
    check("  ...bcrypt maliyeti 12", u1 ? /^\$2[aby]\$12\$/.test(u1.passwordHash) : false, u1?.passwordHash.slice(0, 7));
    check("  ...ciktida duz metin sifre YOK", !r1.all.includes(PASS_1), "sifre loglandi");
    check("  ...ciktida hash YOK", u1 ? !r1.all.includes(u1.passwordHash) : true, "hash loglandi");
    check("  ...ciktida e-posta maskeli", r1.all.includes("***") && !r1.all.includes(TEST_EMAIL), r1.all.split("\n").find((l) => l.includes("Admin")) ?? "");

    // 2. çalıştırma — aynı e-posta, farklı şifre: güncellenmeli
    const r2 = runSeed({ SEED_ADMIN_EMAIL: TEST_EMAIL, SEED_ADMIN_PASSWORD: PASS_2 });
    check("Ikinci calistirma basarili (cikis 0)", r2.code === 0, `kod=${r2.code}`);
    const u2 = await db.user.findUnique({ where: { email: TEST_EMAIL }, select: { id: true, passwordHash: true } });
    check("Ayni hesap korundu (yeni kayit acilmadi)", u2?.id === u1?.id, `once=${u1?.id} sonra=${u2?.id}`);
    check("  ...yeni sifre gecerli", u2 ? bcrypt.compareSync(PASS_2, u2.passwordHash) : false, "yeni sifre calismiyor");
    check("  ...eski sifre artik gecersiz", u2 ? !bcrypt.compareSync(PASS_1, u2.passwordHash) : false, "eski sifre hala calisiyor");

    // Mevcut gerçek admin hesabı etkilenmemeli
    if (gercekAdminOnce) {
      const gercekAdminSonra = await db.user.findUnique({
        where: { id: gercekAdminOnce.id },
        select: { email: true, passwordHash: true, name: true },
      });
      check("Mevcut gercek admin hesabi degismedi",
        gercekAdminSonra?.email === gercekAdminOnce.email &&
          gercekAdminSonra?.passwordHash === gercekAdminOnce.passwordHash &&
          gercekAdminSonra?.name === gercekAdminOnce.name,
        "degisti");
    } else {
      check("Mevcut gercek admin hesabi degismedi", true, "(baska admin yoktu)");
    }
  } finally {
    console.log("\nTEMIZLIK — seed'in olusturdugu kayitlar siliniyor...");
    const silinen = await restore(before);
    console.log(`  silinen: ${Object.entries(silinen).map(([k, v]) => `${k}=${v}`).join(", ") || "(yok)"}`);
    const kalan = await db.user.findUnique({ where: { email: TEST_EMAIL }, select: { id: true } });
    console.log(`  test admin kaydi kaldi mi: ${kalan ? "EVET (!!)" : "hayir"}`);
    const s = await snapshot();
    console.log(`  DB: ${s.users.length} kullanici, ${s.barbers.length} berber, ${s.services.length} hizmet, ` +
      `${s.customers.length} musteri, ${s.appointments.length} randevu, ${s.settings.length} ayar`);
  }

  console.log("\n" + "=".repeat(64));
  console.log(`TOPLAM: ${passed + failed}   GECEN: ${passed}   KALAN: ${failed}`);
  if (failed > 0) {
    console.log("\nBASARISIZ:");
    for (const f of failures) console.log("  - " + f);
  }
  console.log("=".repeat(64));
}

main()
  .then(() => db.$disconnect().then(() => process.exit(failed > 0 ? 1 : 0)))
  .catch(async (e) => {
    console.error("HATA:", e);
    await db.$disconnect();
    process.exit(1);
  });
