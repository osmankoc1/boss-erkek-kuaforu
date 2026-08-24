-- Para ve oran alanlari Float (DOUBLE PRECISION) -> Decimal (NUMERIC)
--
-- FAZ 2 - Sira 9a. Yalnizca tip degisimi; hicbir kolon eklenmiyor/siliniyor,
-- veri donusumu veya backfill yok.
--
-- Production on taramasi (2026-08-24, salt okuma) once calistirildi:
--   2 haneden fazla ondalikli kayit : 0
--   hedef araligi asan kayit        : 0
-- Yani hicbir tutar cast sirasinda degismez ve 22003 overflow riski yoktur.
-- Bkz. scripts/report-money-precision.ts

-- AlterTable
ALTER TABLE "Appointment" ALTER COLUMN "appointmentPrice" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "AppointmentService" ALTER COLUMN "price" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "Barber" ALTER COLUMN "commissionRate" SET DATA TYPE DECIMAL(5,2);

-- AlterTable
ALTER TABLE "BarberPayout" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "CustomerPayment" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "Expense" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "Sale" ALTER COLUMN "listedPrice" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "saleAmount" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "paidAmount" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "remainingAmount" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "barberCommissionRate" SET DATA TYPE DECIMAL(5,2),
ALTER COLUMN "barberShare" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "businessShare" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "SaleItem" ALTER COLUMN "price" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "Service" ALTER COLUMN "price" SET DATA TYPE DECIMAL(12,2);

