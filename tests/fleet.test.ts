import { expect, test } from 'bun:test';
import { dailyValues, diagnostic, freshness, trendDays } from '../src/lib/dashboard/fleet';
import { zonePosition } from '../src/lib/dashboard/data';

test('sixty zones occupy six independent rows', () => {
	expect(zonePosition(60)).toEqual({ x: 9, y: 5 });
	expect(
		new Set(Array.from({ length: 60 }, (_, i) => JSON.stringify(zonePosition(i + 1)))).size
	).toBe(60);
});
test('backlog receipt never implies fresh observations', () => {
	const now = Date.parse('2026-10-28T12:00:00Z');
	expect(freshness('2026-10-28T12:00:00Z', '2026-10-27T12:00:00Z', now)).toEqual({
		connected: true,
		fresh: false
	});
	expect(freshness(null, null, now)).toEqual({ connected: false, fresh: false });
});
test('daily projection uses original UTC day and weighted statistics', () => {
	const v = dailyValues({
		timestamp: new Date('2026-10-27T23:59:50Z'),
		motor_current_a: 3,
		battery_temp_c: 48,
		battery_pct: 65,
		is_anomaly: true
	});
	expect(v.day.toISOString()).toBe('2026-10-27T00:00:00.000Z');
	expect(v.anomaly_count).toBe(1);
	expect(v.motor_current_sum).toBe(3);
});
test('health indicators require data and disclose thresholds', () => {
	expect(
		diagnostic({ sample_count: 0, anomaly_count: 0, motor_current_sum: 0, temperature_max: 0 })
	).toBe('Insufficient data');
	expect(
		diagnostic({ sample_count: 30, anomaly_count: 6, motor_current_sum: 30, temperature_max: 20 })
	).toBe('Inspect machine');
});
test('trend gaps remain unknown rather than zero', () => {
	const days = trendDays([], '2026-10-01', '2026-10-03');
	expect(days.length).toBe(3);
	expect(days[1].sample_count).toBeNull();
});
