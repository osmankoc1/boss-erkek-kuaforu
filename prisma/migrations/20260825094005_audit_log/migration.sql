-- Merkezi denetim izi tablosu (FAZ 2 - Sira 10b)
--
-- Yalnizca YENI tablo + 4 index. Mevcut hicbir tablo/kolon degismiyor,
-- veri donusumu yok, backfill yok.
--
-- userId bilinçli olarak FK DEGILDIR: saklama suresi sinirsiz oldugu icin
-- kullanici silinse bile denetim izi ayakta kalmalidir.

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "userId" TEXT,
    "userEmail" TEXT,
    "changes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_createdAt_idx" ON "AuditLog"("entity", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entity_action_createdAt_idx" ON "AuditLog"("entity", "action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_source_createdAt_idx" ON "AuditLog"("source", "createdAt");

