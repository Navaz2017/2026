-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
