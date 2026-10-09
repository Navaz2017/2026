-- Link WhatsApp with an 8-character code (no QR scan needed) as an alternative.
ALTER TABLE "WhatsAppSession" ADD COLUMN "pairPhone" TEXT, ADD COLUMN "pairingCode" TEXT;
ALTER TABLE "PlatformWhatsApp" ADD COLUMN "pairPhone" TEXT, ADD COLUMN "pairingCode" TEXT;
