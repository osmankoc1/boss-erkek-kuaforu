/**
 * Müşteri etiketi (tag) doğrulama testi.
 *
 * Çalıştırma (dev server ayakta olmalı):
 *   npx dotenv -e .env.local -- tsx scripts/verify-customer-tag.ts
 *
 * UYARI: Dev veritabanına kendi test müşterisini yazar ve sonunda siler.
 * Gerçek müşterilere yalnızca OKUMA yapar. Production endpoint'ine karşı
 * çalışmayı reddeder.
 */
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { assertWritableTestDatabase } from "../lib/db-guard";
import { SignJWT } from "jose";
import { TAG_LABELS, CUSTOMER_TAGS, tagLabel } from "../lib/utils";

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

const MARK = "ZZTAGTEST";
const PHONE = "05559990001";
let cookie = "";
let testId = "";

async function patch(body: unknown, withAuth = true, raw = false, id?: string) {
  const res = await fetch(`${BASE}/api/customers/${id ?? testId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(withAuth ? { Cookie: cookie } : {}) },
    body: raw ? (body as string) : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

const readTest = () =>
  db.customer.findUnique({
    where: { id: testId },
    select: {
      id: true,
      fullName: true,
      phone: true,
      email: true,
      notes: true,
      tag: true,
      totalAppointments: true,
      completedCount: true,
      cancelledCount: true,
      mergedIntoCustomerId: true,
    },
  });

async function main() {
  const admin = await db.user.findFirst({ select: { id: true } });
  if (!admin) throw new Error("Admin yok.");
  const key = new TextEncoder().encode(process.env.SESSION_SECRET);
  cookie = `session=${await new SignJWT({ userId: admin.id, expiresAt: new Date(Date.now() + 7 * 864e5) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(key)}`;

  await db.customer.deleteMany({ where: { phone: PHONE } });
  const created = await db.customer.create({
    data: { fullName: `${MARK} Musteri`, phone: PHONE, email: "tagtest@example.invalid", notes: "ilk not" },
  });
  testId = created.id;
  console.log(`  (test musterisi olusturuldu, varsayilan tag: ${JSON.stringify(created.tag)})\n`);

  const realCustomersBefore = await db.customer.findMany({
    where: { phone: { not: PHONE } },
    select: { id: true, tag: true, notes: true, fullName: true },
  });

  try {
    // ── TEST 1 — Sistemin desteklediği tüm tag değerleri kabul edilmeli ──
    console.log("TEST 1 — Gecerli tag degerleri (TAG_LABELS ile birebir)");
    const VALID = Object.keys(TAG_LABELS);
    console.log(`      (TAG_LABELS: ${VALID.join(", ")})`);
    for (const t of VALID) {
      const r = await patch({ tag: t });
      const row = await readTest();
      check(`'${t}' -> 200 ve kaydedildi`, r.status === 200 && row?.tag === t, `status=${r.status} db=${row?.tag}`);
    }

    // ── TEST 2 — Rastgele / tanımsız string reddedilmeli ─────────────────
    console.log("\nTEST 2 — Tanimsiz tag degeri reddedilmeli");
    await patch({ tag: "normal" });
    const INVALID = [
      "hacker",
      "admin",
      "vip",
      "VIP ",
      " normal",
      "Düzenli",
      "premium",
      "normal,VIP",
      "<script>alert(1)</script>",
      "x".repeat(500),
      "",
    ];
    for (const t of INVALID) {
      const r = await patch({ tag: t });
      const row = await readTest();
      const label = t.length > 24 ? `${t.slice(0, 16)}...(${t.length} karakter)` : JSON.stringify(t);
      check(`${label} -> 400`, r.status === 400, `gelen ${r.status}`);
      check(`  ...ve DB degismedi (hala 'normal')`, row?.tag === "normal", `db=${JSON.stringify(row?.tag)}`);
    }

    // ── TEST 3 — Yanlış tip 500 değil 400 vermeli ────────────────────────
    console.log("\nTEST 3 — Yanlis tip -> 400 (500 degil)");
    const BAD_TYPES: [string, unknown][] = [
      ["tag number", { tag: 123 }],
      ["tag bool", { tag: true }],
      ["tag object", { tag: { toString: "VIP" } }],
      ["tag dizi", { tag: ["VIP"] }],
      ["tag null", { tag: null }],
      ["body dizi", ["VIP"]],
      ["body string", "VIP"],
      ["body null", null],
    ];
    for (const [label, b] of BAD_TYPES) {
      const r = await patch(b);
      check(`${label} -> 400`, r.status === 400, `gelen ${r.status}`);
    }
    const bozukJson = await patch("{bozuk-json", true, true);
    check("bozuk JSON govdesi -> 400 (500 degil)", bozukJson.status === 400, `gelen ${bozukJson.status}`);
    const afterBad = await readTest();
    check("Gecersiz isteklerin hicbiri tag'i degistirmedi", afterBad?.tag === "normal", `db=${afterBad?.tag}`);

    // ── TEST 4 — tag alanı gönderilmezse mevcut değer korunur ────────────
    console.log("\nTEST 4 — tag gonderilmezse mevcut deger korunur (mevcut is kurali)");
    await patch({ tag: "VIP" });
    const onlyNotes = await patch({ notes: "sadece not guncellemesi" });
    const rowN = await readTest();
    check("tag'siz istek -> 200", onlyNotes.status === 200, `gelen ${onlyNotes.status}`);
    check("tag korundu ('VIP')", rowN?.tag === "VIP", `db=${rowN?.tag}`);
    check("notes guncellendi", rowN?.notes === "sadece not guncellemesi", `db=${rowN?.notes}`);

    // ── TEST 5 — notes davranışı bozulmamalı ─────────────────────────────
    console.log("\nTEST 5 — notes mevcut davranisi korunuyor");
    const n1 = await patch({ tag: "normal", notes: "yeni not" });
    check("notes string -> 200 ve kaydedildi", n1.status === 200 && (await readTest())?.notes === "yeni not");
    const n2 = await patch({ notes: "" });
    check("notes '' -> 200 ve kaydedildi", n2.status === 200 && (await readTest())?.notes === "");
    const n3 = await patch({ notes: null });
    check("notes null -> 200 ve NULL kaydedildi", n3.status === 200 && (await readTest())?.notes === null, "null davranisi degisti");
    const uzun = "n".repeat(3000);
    const n4 = await patch({ notes: uzun });
    check("uzun notes -> 200 ve kaydedildi", n4.status === 200 && (await readTest())?.notes === uzun);
    const n5 = await patch({ tag: "VIP", notes: "birlikte" });
    const rowBoth = await readTest();
    check("tag + notes birlikte -> 200", n5.status === 200, `gelen ${n5.status}`);
    check("  ikisi de kaydedildi", rowBoth?.tag === "VIP" && rowBoth?.notes === "birlikte", `tag=${rowBoth?.tag} notes=${rowBoth?.notes}`);

    // ── TEST 6 — Başka alanlar yazılamamalı (mass assignment) ────────────
    console.log("\nTEST 6 — Ekstra body alanlari yok sayilmali");
    const before = await readTest();
    const evil = await patch({
      tag: "sorunlu",
      id: "sahte-id-12345",
      fullName: "ELE GECIRILDI",
      phone: "05550000000",
      email: "evil@example.invalid",
      totalAppointments: 9999,
      completedCount: 9999,
      cancelledCount: 9999,
      mergedIntoCustomerId: "baska-musteri",
      createdAt: "1990-01-01T00:00:00.000Z",
    });
    const after = await readTest();
    check("Istek islendi ya da reddedildi (500 degil)", evil.status !== 500, `gelen ${evil.status}`);
    check("tag guncellendi ('sorunlu')", after?.tag === "sorunlu", `db=${after?.tag}`);
    check("id degismedi", after?.id === before?.id, `db=${after?.id}`);
    check("fullName degismedi", after?.fullName === before?.fullName, `db=${after?.fullName}`);
    check("phone degismedi", after?.phone === before?.phone, `db=${after?.phone}`);
    check("email degismedi", after?.email === before?.email, `db=${after?.email}`);
    check("totalAppointments degismedi", after?.totalAppointments === before?.totalAppointments, `db=${after?.totalAppointments}`);
    check("completedCount degismedi", after?.completedCount === before?.completedCount, `db=${after?.completedCount}`);
    check("cancelledCount degismedi", after?.cancelledCount === before?.cancelledCount, `db=${after?.cancelledCount}`);
    check("mergedIntoCustomerId degismedi", after?.mergedIntoCustomerId === before?.mergedIntoCustomerId, `db=${after?.mergedIntoCustomerId}`);
    const sahte = await db.customer.findUnique({ where: { id: "sahte-id-12345" }, select: { id: true } });
    check("Sahte id ile yeni kayit olusmadi", sahte === null, "olustu");

    // ── TEST 7 — Yetkilendirme ──────────────────────────────────────────
    console.log("\nTEST 7 — Yetkilendirme");
    const noAuth = await patch({ tag: "VIP" }, false);
    check("Oturumsuz PATCH -> 401", noAuth.status === 401, `gelen ${noAuth.status}`);
    check("Oturumsuz istek DB'yi degistirmedi", (await readTest())?.tag === "sorunlu", "degisti");

    // ── TEST 8 — Admin ekranı akışı (dropdown ne gönderiyorsa) ───────────
    console.log("\nTEST 8 — Admin musteri ekranindaki dropdown akisi");
    for (const t of Object.keys(TAG_LABELS)) {
      const r = await patch({ tag: t, notes: "admin ekrani notu" });
      const row = await readTest();
      check(`Dropdown '${tagLabel(t)}' (${t}) kaydediliyor`, r.status === 200 && row?.tag === t && row?.notes === "admin ekrani notu",
        `status=${r.status} tag=${row?.tag}`);
    }

    // ── TEST 9 — Mevcut veritabanı değerleriyle uyum ─────────────────────
    console.log("\nTEST 9 — DB'deki mevcut tag degerleri semadan geciyor mu");
    const distinct = await db.customer.groupBy({ by: ["tag"], _count: { _all: true } });
    console.log(`      (DB'de ${distinct.length} farkli tag degeri var)`);
    for (const d of distinct) {
      console.log(`      ${JSON.stringify(d.tag)} -> ${d._count._all} musteri`);
      check(`  DB degeri ${JSON.stringify(d.tag)} sistemde tanimli`, (CUSTOMER_TAGS as readonly string[]).includes(d.tag),
        "TAG_LABELS'ta yok - mevcut veri semaya uymuyor");
    }
    for (const d of distinct) {
      const r = await patch({ tag: d.tag });
      check(`  DB degeri ${JSON.stringify(d.tag)} API'den yazilabiliyor`, r.status === 200, `gelen ${r.status}`);
    }

    // ── TEST 10 — Gerçek müşteriler etkilenmedi ──────────────────────────
    console.log("\nTEST 10 — Gercek musteri kayitlari etkilenmedi");
    const realAfter = await db.customer.findMany({
      where: { phone: { not: PHONE } },
      select: { id: true, tag: true, notes: true, fullName: true },
    });
    check("Gercek musteri sayisi ayni", realAfter.length === realCustomersBefore.length,
      `once=${realCustomersBefore.length} sonra=${realAfter.length}`);
    const degisen = realAfter.filter((a) => {
      const b = realCustomersBefore.find((x) => x.id === a.id);
      return !b || b.tag !== a.tag || b.notes !== a.notes || b.fullName !== a.fullName;
    });
    check("Hicbir gercek musterinin tag/notes degeri degismedi", degisen.length === 0,
      degisen.map((d) => d.fullName).join(", "));

    // ── TEST 11 — Var olmayan müşteri 404 vermeli (500 değil) ────────────
    console.log("\nTEST 11 — Var olmayan musteri -> 404");
    const SAHTE = ["yok-boyle-bir-id", "cmzzzzzzz000000000000000", "00000000-0000-0000-0000-000000000000"];
    for (const fake of SAHTE) {
      const r = await patch({ tag: "VIP" }, true, false, fake);
      check(`PATCH '${fake.slice(0, 24)}' -> 404 (500 degil)`, r.status === 404, `gelen ${r.status}`);
      check(`  ...hata mesaji anlamli`, typeof r.body.error === "string" && r.body.error.length > 0,
        `govde=${JSON.stringify(r.body).slice(0, 80)}`);
      const olustu = await db.customer.findUnique({ where: { id: fake }, select: { id: true } });
      check(`  ...ve yeni kayit olusmadi`, olustu === null, "olustu");
    }
    const fakeGet = await fetch(`${BASE}/api/customers/yok-boyle-bir-id`, { headers: { Cookie: cookie } });
    check("GET ile ayni id -> 404 (tutarli)", fakeGet.status === 404, `gelen ${fakeGet.status}`);
    const fakeNoAuth = await patch({ tag: "VIP" }, false, false, "yok-boyle-bir-id");
    check("Oturumsuz + sahte id -> 401 (varlik bilgisi sizmiyor)", fakeNoAuth.status === 401, `gelen ${fakeNoAuth.status}`);
    const fakeBadTag = await patch({ tag: "hacker" }, true, false, "yok-boyle-bir-id");
    check("Sahte id + gecersiz tag -> 400 (dogrulama once)", fakeBadTag.status === 400, `gelen ${fakeBadTag.status}`);
  } finally {
    console.log("\nTEMIZLIK...");
    const del = await db.customer.deleteMany({ where: { phone: PHONE } });
    const kalan = await db.customer.count({ where: { fullName: { startsWith: MARK } } });
    console.log(`  silinen test musterisi: ${del.count}`);
    console.log(`  kalan test kaydi      : ${kalan}`);
    console.log(`  DB'deki musteri sayisi: ${await db.customer.count()}`);
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
