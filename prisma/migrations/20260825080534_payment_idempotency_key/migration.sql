-- Kesin idempotency anahtarlari (FAZ 2 - Sira 9b)
--
-- Iki nullable kolon + iki unique index. Mevcut hicbir kolon degismiyor,
-- veri donusumu yok, backfill yok.
--
-- Nullable + UNIQUE bilinçli: Postgres unique index'inde NULL'lar birbiriyle
-- catismaz. Mevcut satirlarin tamami NULL kalir ve anahtar gondermeyen
-- istemciler bozulmaz; koruma yalnizca anahtar gonderen istekler icin
-- devreye girer.

-- AlterTable
ALTER TABLE "BarberPayout" ADD COLUMN     "idempotencyKey" TEXT;

-- AlterTable
ALTER TABLE "CustomerPayment" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "BarberPayout_idempotencyKey_key" ON "BarberPayout"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPayment_idempotencyKey_key" ON "CustomerPayment"("idempotencyKey");

