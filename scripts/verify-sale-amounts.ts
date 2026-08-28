/**
 * Kasa tutar senkronizasyonu — tahsilat ezme koruması (FAZ 3 · Sıra 3.7A).
 *
 * Çalıştırma (dev server GEREKMEZ — saf mantık testi):
 *   npx dotenv -e .env.local -- tsx scripts/verify-sale-amounts.ts
 *
 * ─── KANITLANMIŞ HATA ────────────────────────────────────────────────────
 * `SaleModal`, seçili hizmetler her değiştiğinde tahsilatı da toplama
 * eşitliyordu. Kullanıcının ELLE girdiği tahsilat bu sırada eziliyordu.
 * Gerçek arayüzde, production build üzerinde ölçüldü:
 *
 *   1) SAÇ+SAKAL (600) seçildi      → Satış 600  Ödenen 600  Kalan   0.00
 *   2) Ödenen ELLE 200 yapıldı      → Satış 600  Ödenen 200  Kalan 400.00
 *   3) İkinci hizmet (200) eklendi  → Satış 800  Ödenen 800  Kalan   0.00
 *
 * Üçüncü adımda 400 ₺'lik veresiye sessizce yok oldu. Hizmet ÇIKARILDIĞINDA
 * da aynısı oluyordu: elle girilen 200 ₺, 0 ₺'ye düşüyordu.
 *
 * Finansal etki: kaydedilirse müşterinin borcu HİÇ oluşmaz. `remainingAmount`
 * sıfır yazılır, veresiye listesinde görünmez, tahsil edilmesi gereken para
 * hiç istenmez. Sessiz gelir kaybı.
 *
 * ─── SINANAN DEĞİŞMEZLER ─────────────────────────────────────────────────
 *   • Elle girilen tahsilat, hizmet eklenince/çıkarılınca KORUNUR.
 *   • Korunan tahsilat satış tutarını AŞAMAZ (tahsilat > satış olamaz).
 *   • Hiçbir şey elle girilmediyse eski davranış aynen sürer.
 *   • Elle girilen satış tutarı da korunur (mevcut davranış bozulmadı).
 *   • Kural idempotenttir — effect döngüsüne yol açmaz.
 *   • `SaleModal` bu kuralı gerçekten kullanıyor ve tahsilat alanı elle
 *     girişi işaretliyor.
 */
import { readFileSync } from "node:fs";
import { senkronizeTutarlar } from "../lib/sale-amounts";

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

function main() {
  console.log("=".repeat(66));
  console.log("KASA TUTAR SENKRONIZASYONU — FAZ 3 · Sira 3.7A");
  console.log("=".repeat(66));

  // ── TEST 1 — Kanitlanan senaryo: hizmet EKLENDI ──────────────────────
  console.log("\nTEST 1 — Elle tahsilat girildi, sonra hizmet EKLENDI");
  {
    // Adim 1-2: 600'luk hizmet, tahsilat elle 200 (veresiye 400)
    // Adim 3: ikinci hizmet (200) eklendi -> toplam 800
    const s = senkronizeTutarlar({
      toplam: 800,
      tutarElleGirildi: false,
      tahsilatElleGirildi: true,
      mevcutTutar: 600,
      mevcutTahsilat: 200,
    });
    console.log(`      satis 600->${s.saleAmount}  tahsilat 200->${s.paidAmount}  veresiye ${s.saleAmount - s.paidAmount}`);
    check("Satis tutari yeni toplama guncellendi", s.saleAmount === 800, `${s.saleAmount}`);
    check("Elle girilen tahsilat KORUNDU (200)", s.paidAmount === 200, `${s.paidAmount} — ezildi`);
    check("  ...veresiye 600 olarak duruyor", s.saleAmount - s.paidAmount === 600, `${s.saleAmount - s.paidAmount}`);
  }

  // ── TEST 2 — Hizmet CIKARILDI ────────────────────────────────────────
  console.log("\nTEST 2 — Elle tahsilat girildi, sonra hizmet CIKARILDI");
  {
    // 800'lik satista 200 tahsilat; 200'luk hizmet cikarildi -> toplam 600
    const s = senkronizeTutarlar({
      toplam: 600,
      tutarElleGirildi: false,
      tahsilatElleGirildi: true,
      mevcutTutar: 800,
      mevcutTahsilat: 200,
    });
    console.log(`      satis 800->${s.saleAmount}  tahsilat 200->${s.paidAmount}`);
    check("Satis tutari dustu", s.saleAmount === 600, `${s.saleAmount}`);
    check("Elle girilen tahsilat KORUNDU (200)", s.paidAmount === 200, `${s.paidAmount} — ezildi`);
  }

  // ── TEST 3 — Tahsilat satis tutarini asamaz ──────────────────────────
  console.log("\nTEST 3 — Korunan tahsilat satis tutarini ASAMAZ");
  {
    // 600'luk satista 600 tahsilat elle girildi; tum hizmetler cikarildi
    const hepsiCikti = senkronizeTutarlar({
      toplam: 0,
      tutarElleGirildi: false,
      tahsilatElleGirildi: true,
      mevcutTutar: 600,
      mevcutTahsilat: 600,
    });
    check("Hizmet kalmayinca tahsilat 0'a cekildi", hepsiCikti.paidAmount === 0, `${hepsiCikti.paidAmount}`);

    // 800'luk satista 500 tahsilat; 200'luk hizmete dusuruldu -> toplam 200
    const kirpildi = senkronizeTutarlar({
      toplam: 200,
      tutarElleGirildi: false,
      tahsilatElleGirildi: true,
      mevcutTutar: 800,
      mevcutTahsilat: 500,
    });
    check("Tahsilat yeni tutara kirpildi (500 -> 200)", kirpildi.paidAmount === 200, `${kirpildi.paidAmount}`);
    check("  ...tahsilat > satis DURUMU OLUSMUYOR", kirpildi.paidAmount <= kirpildi.saleAmount);
  }

  // ── TEST 4 — Elle girilmediyse eski davranis surer ───────────────────
  console.log("\nTEST 4 — Hicbir sey elle girilmediyse eski davranis");
  {
    const s = senkronizeTutarlar({
      toplam: 800,
      tutarElleGirildi: false,
      tahsilatElleGirildi: false,
      mevcutTutar: 600,
      mevcutTahsilat: 600,
    });
    check("Satis toplama esitlendi", s.saleAmount === 800, `${s.saleAmount}`);
    check("Tahsilat da toplama esitlendi", s.paidAmount === 800, `${s.paidAmount}`);
    check("  ...veresiye yok", s.saleAmount - s.paidAmount === 0);
  }

  // ── TEST 5 — Elle girilen SATIS TUTARI korunuyor (mevcut davranis) ───
  console.log("\nTEST 5 — Elle girilen satis tutari korunuyor");
  {
    const s = senkronizeTutarlar({
      toplam: 800,
      tutarElleGirildi: true,
      tahsilatElleGirildi: false,
      mevcutTutar: 500,
      mevcutTahsilat: 500,
    });
    check("Satis tutari EZILMEDI (500)", s.saleAmount === 500, `${s.saleAmount}`);
    check("  ...tahsilat satis tutarini takip etti", s.paidAmount === 500, `${s.paidAmount}`);

    const ikisiDe = senkronizeTutarlar({
      toplam: 800,
      tutarElleGirildi: true,
      tahsilatElleGirildi: true,
      mevcutTutar: 500,
      mevcutTahsilat: 100,
    });
    check("Ikisi de elle girildiyse ikisi de korunur", ikisiDe.saleAmount === 500 && ikisiDe.paidAmount === 100,
      `${ikisiDe.saleAmount}/${ikisiDe.paidAmount}`);
  }

  // ── TEST 6 — Idempotent (effect dongusu olusturmaz) ──────────────────
  console.log("\nTEST 6 — Kural idempotent");
  {
    const girdi = {
      toplam: 800,
      tutarElleGirildi: false,
      tahsilatElleGirildi: true,
      mevcutTutar: 600,
      mevcutTahsilat: 200,
    };
    const ilk = senkronizeTutarlar(girdi);
    const ikinci = senkronizeTutarlar({ ...girdi, mevcutTutar: ilk.saleAmount, mevcutTahsilat: ilk.paidAmount });
    check(
      "Ikinci gecis ayni sonucu veriyor",
      ikinci.saleAmount === ilk.saleAmount && ikinci.paidAmount === ilk.paidAmount,
      `${ilk.saleAmount}/${ilk.paidAmount} -> ${ikinci.saleAmount}/${ikinci.paidAmount}`
    );
    const ucuncu = senkronizeTutarlar({ ...girdi, mevcutTutar: ikinci.saleAmount, mevcutTahsilat: ikinci.paidAmount });
    check("  ...ucuncu gecis de ayni", ucuncu.saleAmount === ikinci.saleAmount && ucuncu.paidAmount === ikinci.paidAmount);
  }

  // ── TEST 7 — SaleModal kurali GERCEKTEN kullaniyor ───────────────────
  console.log("\nTEST 7 — SaleModal kurali kullaniyor");
  {
    const src = readFileSync("app/(admin)/admin/(protected)/kasa/SaleModal.tsx", "utf8");
    check("`senkronizeTutarlar` cagriliyor", /senkronizeTutarlar\s*\(/.test(src), "cagri yok");
    check("`paidManuallySet` durumu var", /paidManuallySet/.test(src), "durum yok");
    check(
      "Odenen alani elle girisi ISARETLIYOR",
      /setPaidManuallySet\(true\)/.test(src),
      "isaretleme yok — tahsilat yine ezilebilir"
    );
    check(
      "Effect tahsilati KOSULSUZ toplama esitlemiyor",
      !/setPaidAmount\(total\)/.test(src),
      "eski ezen kod hala duruyor"
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

main();
process.exit(failed > 0 ? 1 : 0);
