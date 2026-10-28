-- AlterTable
ALTER TABLE "simulation_run" ADD COLUMN     "cycle_id" UUID,
ADD COLUMN     "machine_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000002';

-- CreateTable
CREATE TABLE "property" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT,
    "last_received_at" TIMESTAMP(3),
    "last_observed_at" TIMESTAMP(3),

    CONSTRAINT "machine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_zone" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "zone_id" INTEGER NOT NULL,
    "area_m2" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "property_zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mowing_cycle" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "historical" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "mowing_cycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zone_progress" (
    "id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "machine_id" UUID NOT NULL,
    "zone_ref" UUID NOT NULL,
    "coverage_pct" DOUBLE PRECISION NOT NULL,
    "observed_at" TIMESTAMP(3),

    CONSTRAINT "zone_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_summary" (
    "machine_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "sample_count" INTEGER NOT NULL,
    "anomaly_count" INTEGER NOT NULL,
    "motor_current_sum" DOUBLE PRECISION NOT NULL,
    "motor_current_max" DOUBLE PRECISION NOT NULL,
    "temperature_max" DOUBLE PRECISION NOT NULL,
    "battery_sum" DOUBLE PRECISION NOT NULL,
    "battery_min" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "daily_summary_pkey" PRIMARY KEY ("machine_id","day")
);

-- CreateIndex
CREATE UNIQUE INDEX "machine_token_hash_key" ON "machine"("token_hash");

-- CreateIndex
CREATE INDEX "machine_property_id_id_idx" ON "machine"("property_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "property_zone_property_id_zone_id_key" ON "property_zone"("property_id", "zone_id");

-- CreateIndex
CREATE INDEX "mowing_cycle_property_id_started_at_idx" ON "mowing_cycle"("property_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "zone_progress_cycle_id_machine_id_zone_ref_key" ON "zone_progress"("cycle_id", "machine_id", "zone_ref");

-- CreateIndex
CREATE INDEX "simulation_run_machine_id_created_at_idx" ON "simulation_run"("machine_id", "created_at");

-- CreateIndex
CREATE INDEX "mowing_session_run_id_start_time_id_idx" ON "mowing_session"("run_id", "start_time", "id");

-- CreateIndex
CREATE INDEX "reading_session_ref_timestamp_id_idx" ON "reading"("session_ref", "timestamp", "id");

-- CreateIndex
CREATE INDEX "mower_event_session_ref_timestamp_id_idx" ON "mower_event"("session_ref", "timestamp", "id");

-- Preserve old runs under a historical demo cycle before adding foreign keys.
INSERT INTO "property" (id,name) VALUES ('00000000-0000-4000-8000-000000000001','JAMK garden');
INSERT INTO machine (id,property_id,name) VALUES ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','Demo mower');
INSERT INTO mowing_cycle (id,property_id,historical,completed_at) VALUES ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001',true,CURRENT_TIMESTAMP);
UPDATE simulation_run SET cycle_id = '00000000-0000-4000-8000-000000000003';
-- At most one active cycle per property, including concurrent control requests.
CREATE UNIQUE INDEX mowing_cycle_one_active ON mowing_cycle(property_id) WHERE completed_at IS NULL;

-- AddForeignKey
ALTER TABLE "simulation_run" ADD CONSTRAINT "simulation_run_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulation_run" ADD CONSTRAINT "simulation_run_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "mowing_cycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine" ADD CONSTRAINT "machine_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_zone" ADD CONSTRAINT "property_zone_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mowing_cycle" ADD CONSTRAINT "mowing_cycle_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zone_progress" ADD CONSTRAINT "zone_progress_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "mowing_cycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zone_progress" ADD CONSTRAINT "zone_progress_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zone_progress" ADD CONSTRAINT "zone_progress_zone_ref_fkey" FOREIGN KEY ("zone_ref") REFERENCES "property_zone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_summary" ADD CONSTRAINT "daily_summary_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

