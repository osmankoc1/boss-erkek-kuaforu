-- CreateTable
CREATE TABLE "BarberPayout" (
    "id" TEXT NOT NULL,
    "barberId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paymentMethod" TEXT NOT NULL DEFAULT 'CASH',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "payoutDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BarberPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BarberPayout_barberId_payoutDate_idx" ON "BarberPayout"("barberId", "payoutDate");

-- CreateIndex
CREATE INDEX "BarberPayout_payoutDate_idx" ON "BarberPayout"("payoutDate");

-- AddForeignKey
ALTER TABLE "BarberPayout" ADD CONSTRAINT "BarberPayout_barberId_fkey" FOREIGN KEY ("barberId") REFERENCES "Barber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
