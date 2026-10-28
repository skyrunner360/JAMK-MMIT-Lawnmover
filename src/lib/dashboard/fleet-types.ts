import type { Summary } from './fleet';
import type { Reading, Session, MowerEvent } from './data';
export interface Machine {
	id: string;
	name: string;
	property_id: string;
	last_received_at: string | null;
	last_observed_at: string | null;
	connected: boolean;
	fresh: boolean;
	diagnostic: string;
	summary: Summary | null;
	latest_run: { id: string; source: string } | null;
}
export interface PropertyZone {
	zone_id: number;
	area_m2: number;
	coverage_pct: number | null;
	observed_at: string | null;
}
export interface Fleet {
	property: { id: string; name: string };
	cycle: {
		id: string;
		started_at: string;
		completed_at: string | null;
		historical: boolean;
	} | null;
	machines: Machine[];
	zones: PropertyZone[];
	pagination: { has_more: boolean };
	thresholds: {
		minimum_samples: number;
		anomaly_rate: number;
		motor_current_a: number;
		temperature_c: number;
	};
	stale_seconds: number;
}
export interface SessionPage {
	data: Session[];
	pagination: { has_more: boolean };
}
export interface ReadingPage {
	data: Reading[];
	pagination: { has_more: boolean };
}
export interface EventPage {
	data: MowerEvent[];
	pagination: { has_more: boolean };
}
export interface TrendDay {
	day: string;
	sample_count: number | null;
	anomaly_rate: number | null;
	motor_current_mean: number | null;
	temperature_max: number | null;
}
