import { describe, expect, test } from 'bun:test';
import { parseMessage, parseQuery, utcTimestamp } from '../src/lib/server/mower/validation';

describe('telemetry validation', () => {
	test('normalizes CSV timestamps as UTC and rejects impossible dates', () => {
		expect(utcTimestamp.parse('2026-10-14 12:00:00').toISOString()).toBe(
			'2026-10-14T12:00:00.000Z'
		);
		for (const value of ['2026-02-30 12:00:00', '', 'yesterday', '2026-01-01T12:00:00'])
			expect(() => utcTimestamp.parse(value)).toThrow();
	});
	test('rejects coercion, missing fields and unknown message types', () => {
		for (const value of [
			null,
			{ type: 'reset', data: {} },
			{
				type: 'session_start',
				data: {
					session_id: '1',
					start_time: '2026-10-14 12:00:00',
					weather: 'sunny',
					bearing_wear: 0.1
				}
			}
		])
			expect(() => parseMessage(value)).toThrow();
	});
	test('validates active sessions without requiring completion fields', () => {
		const msg = parseMessage({
			type: 'session_start',
			data: {
				session_id: 1,
				start_time: '2026-10-14 12:00:00',
				weather: 'sunny',
				bearing_wear: 0.1
			}
		});
		expect(msg.type).toBe('session_start');
		expect(() => parseMessage({ type: 'session_end', data: msg.data })).toThrow();
	});
	test('bounds pages and rejects invalid or reversed query filters', () => {
		expect(parseQuery(new URLSearchParams()).limit).toBe(50);
		expect(parseQuery(new URLSearchParams('limit=200&offset=10&is_anomaly=false')).is_anomaly).toBe(
			false
		);
		for (const value of [
			'limit=201',
			'limit=0',
			'limit=2.5',
			'offset=-1',
			'zone_id=no',
			'is_anomaly=maybe',
			'mode=broken',
			'from=2026-10-15T00:00:00Z&to=2026-10-14T00:00:00Z'
		])
			expect(() => parseQuery(new URLSearchParams(value))).toThrow();
	});
});

test('rejects duplicate and endpoint-inapplicable query parameters', () => {
	expect(() => parseQuery(new URLSearchParams('limit=1&limit=2'))).toThrow();
	expect(() => parseQuery(new URLSearchParams('mode=mowing'), ['limit', 'offset'])).toThrow();
});
