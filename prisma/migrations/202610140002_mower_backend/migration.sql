-- CreateEnum
CREATE TYPE "MowerMode" AS ENUM ('mowing', 'returning', 'charging');

-- CreateEnum
CREATE TYPE "MowerEventType" AS ENUM ('obstacle_detected', 'bump', 'high_load', 'stall', 'unexpected_stop', 'lift', 'tilt');

-- CreateTable
CREATE TABLE "simulation_run" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,

    CONSTRAINT "simulation_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mowing_session" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "session_id" INTEGER NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3),
    "weather" TEXT NOT NULL,
    "bearing_wear" DOUBLE PRECISION NOT NULL,
    "duration_min" INTEGER,
    "battery_start_pct" DOUBLE PRECISION,
    "battery_end_pct" DOUBLE PRECISION,
    "rows" INTEGER,
    "area_covered_m2" DOUBLE PRECISION,
    "mean_motor_current_a" DOUBLE PRECISION,
    "peak_motor_current_a" DOUBLE PRECISION,
    "anomaly_rows" INTEGER,
    "sessions_to_failure" INTEGER,
    "ended_with_error" TEXT,

    CONSTRAINT "mowing_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zone" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "zone_id" INTEGER NOT NULL,
    "area_m2" DOUBLE PRECISION NOT NULL,
    "grass_density" DOUBLE PRECISION NOT NULL,
    "avg_slope_deg" DOUBLE PRECISION NOT NULL,
    "avg_motor_current_a" DOUBLE PRECISION NOT NULL,
    "avg_speed_mps" DOUBLE PRECISION NOT NULL,
    "time_spent_s" INTEGER NOT NULL,
    "anomaly_count" INTEGER NOT NULL,
    "obstacle_events" INTEGER NOT NULL,
    "coverage_pct" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reading" (
    "id" UUID NOT NULL,
    "session_ref" UUID NOT NULL,
    "zone_ref" UUID NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "session_id" INTEGER NOT NULL,
    "zone_id" INTEGER NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "speed_mps" DOUBLE PRECISION NOT NULL,
    "heading_deg" DOUBLE PRECISION NOT NULL,
    "mode" "MowerMode" NOT NULL,
    "battery_pct" DOUBLE PRECISION NOT NULL,
    "voltage_v" DOUBLE PRECISION NOT NULL,
    "current_a" DOUBLE PRECISION NOT NULL,
    "battery_temp_c" DOUBLE PRECISION NOT NULL,
    "motor_current_a" DOUBLE PRECISION NOT NULL,
    "motor_rpm" INTEGER NOT NULL,
    "slope_deg" DOUBLE PRECISION NOT NULL,
    "grass_load" DOUBLE PRECISION NOT NULL,
    "ambient_temp_c" DOUBLE PRECISION NOT NULL,
    "humidity_pct" DOUBLE PRECISION NOT NULL,
    "rain" BOOLEAN NOT NULL,
    "is_anomaly" BOOLEAN NOT NULL,

    CONSTRAINT "reading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mower_event" (
    "id" UUID NOT NULL,
    "session_ref" UUID NOT NULL,
    "zone_ref" UUID NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "session_id" INTEGER NOT NULL,
    "zone_id" INTEGER NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "event_type" "MowerEventType" NOT NULL,
    "error_code" TEXT,

    CONSTRAINT "mower_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mowing_session_start_time_id_idx" ON "mowing_session"("start_time", "id");

-- CreateIndex
CREATE UNIQUE INDEX "mowing_session_run_id_session_id_key" ON "mowing_session"("run_id", "session_id");

-- CreateIndex
CREATE UNIQUE INDEX "zone_run_id_zone_id_key" ON "zone"("run_id", "zone_id");

-- CreateIndex
CREATE INDEX "reading_timestamp_id_idx" ON "reading"("timestamp", "id");

-- CreateIndex
CREATE INDEX "reading_zone_ref_timestamp_idx" ON "reading"("zone_ref", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "reading_session_ref_timestamp_key" ON "reading"("session_ref", "timestamp");

-- CreateIndex
CREATE INDEX "mower_event_timestamp_id_idx" ON "mower_event"("timestamp", "id");

-- CreateIndex
CREATE INDEX "mower_event_zone_ref_timestamp_idx" ON "mower_event"("zone_ref", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "mower_event_session_ref_timestamp_event_type_key" ON "mower_event"("session_ref", "timestamp", "event_type");

-- AddForeignKey
ALTER TABLE "mowing_session" ADD CONSTRAINT "mowing_session_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "simulation_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zone" ADD CONSTRAINT "zone_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "simulation_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reading" ADD CONSTRAINT "reading_session_ref_fkey" FOREIGN KEY ("session_ref") REFERENCES "mowing_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reading" ADD CONSTRAINT "reading_zone_ref_fkey" FOREIGN KEY ("zone_ref") REFERENCES "zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mower_event" ADD CONSTRAINT "mower_event_session_ref_fkey" FOREIGN KEY ("session_ref") REFERENCES "mowing_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mower_event" ADD CONSTRAINT "mower_event_zone_ref_fkey" FOREIGN KEY ("zone_ref") REFERENCES "zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

