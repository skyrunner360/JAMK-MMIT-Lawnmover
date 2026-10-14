import { expect, test } from 'bun:test';
import { mergeReadings, chartPoints, coverage, zonePosition } from '../src/lib/dashboard/data';

test('live history deduplicates, sorts and bounds samples', () => {
	const rows = [
		{ timestamp: '2026-01-01T00:00:20Z', session_id: 1 },
		{ timestamp: '2026-01-01T00:00:00Z', session_id: 1 }
	] as any;
	const result = mergeReadings(
		rows,
		[{ timestamp: '2026-01-01T00:00:10Z', session_id: 1 }, rows[0]],
		2
	);
	expect(result.map((r) => r.timestamp)).toEqual(['2026-01-01T00:00:10Z', '2026-01-01T00:00:20Z']);
});
test('chart values use elapsed time and stable zero-value bounds', () => {
	expect(
		chartPoints(
			[
				{ timestamp: '2026-01-01T00:00:00Z', battery_pct: 0 },
				{ timestamp: '2026-01-01T00:00:20Z', battery_pct: 100 }
			] as any,
			'battery_pct',
			0,
			100
		)
	).toBe('0,100 100,0');
	expect(chartPoints([], 'battery_pct', 0, 100)).toBe('');
});
test('coverage is area-weighted and empty coverage is zero', () => {
	expect(
		coverage([
			{ area_m2: 100, coverage_pct: 100 },
			{ area_m2: 300, coverage_pct: 0 }
		] as any)
	).toBe(25);
	expect(coverage([])).toBe(0);
	expect(zonePosition(11)).toEqual({ x: 0, y: 1 });
	expect(zonePosition(26)).toEqual({ x: 5, y: 2 });
});
