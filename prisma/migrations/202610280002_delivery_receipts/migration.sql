-- AlterTable
ALTER TABLE "reading" ADD COLUMN     "received_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "mower_event" ADD COLUMN     "received_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "delivery_receipt" (
    "machine_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "captured_at" TIMESTAMP(3),

    CONSTRAINT "delivery_receipt_pkey" PRIMARY KEY ("machine_id","message_id")
);

-- AddForeignKey
ALTER TABLE "delivery_receipt" ADD CONSTRAINT "delivery_receipt_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Historic receipt times are unknown; do not fabricate them at migration time.
ALTER TABLE reading ALTER COLUMN received_at SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE mower_event ALTER COLUMN received_at SET DEFAULT CURRENT_TIMESTAMP;
