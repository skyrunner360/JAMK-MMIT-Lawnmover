import { json } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { api } from '#lib/server/mower/http.ts';
import { ensureDemoFleet, DEMO_PROPERTY } from '#lib/server/mower/fleet.ts';
import { diagnostic, freshness } from '#lib/dashboard/fleet.ts';
import { z } from 'zod';
import { healthThresholds } from '#lib/server/mower/thresholds.ts';
export const GET = api(async ({ url }) => {
	const q = z
		.object({
			property_id: z.uuid().default(DEMO_PROPERTY),
			limit: z.coerce.number().int().min(1).max(100).default(50),
			offset: z.coerce.number().int().min(0).max(1000000).default(0)
		})
		.strict()
		.parse(Object.fromEntries(url.searchParams));
	await ensureDemoFleet(db);
	const property = await db.property.findUniqueOrThrow({ where: { id: q.property_id } });
	const machines = await db.machine.findMany({
		where: { property_id: property.id },
		select: {
			id: true,
			name: true,
			property_id: true,
			last_received_at: true,
			last_observed_at: true,
			summaries: { orderBy: { day: 'desc' }, take: 1 },
			runs: {
				orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
				take: 1,
				select: { id: true, source: true }
			}
		},
		orderBy: { id: 'asc' },
		take: q.limit + 1,
		skip: q.offset
	});
	const cycle = await db.mowingCycle.findFirst({
		where: { property_id: property.id },
		orderBy: [{ started_at: 'desc' }, { id: 'desc' }]
	});
	const zones = await db.propertyZone.findMany({
		where: { property_id: property.id },
		orderBy: { zone_id: 'asc' },
		take: 1000,
		include: {
			progress: { where: { cycle_id: cycle?.id ?? '00000000-0000-4000-8000-000000000000' } }
		}
	});
	const thresholds = healthThresholds();
	const staleSeconds = Math.max(10, Number(process.env.MOWER_STALE_SECONDS) || 60);
	return json({
		property,
		cycle,
		thresholds,
		stale_seconds: staleSeconds,
		machines: machines.slice(0, q.limit).map(({ summaries, runs, ...m }) => ({
			...m,
			latest_run: runs[0] ?? null,
			summary: summaries[0] ?? null,
			diagnostic: diagnostic(summaries[0], thresholds),
			...freshness(
				m.last_received_at?.toISOString() ?? null,
				m.last_observed_at?.toISOString() ?? null,
				Date.now(),
				staleSeconds
			)
		})),
		zones: zones.map(({ progress, ...zone }) => ({
			...zone,
			coverage_pct: progress.length ? Math.max(...progress.map((p) => p.coverage_pct)) : null,
			observed_at: progress.reduce<Date | null>(
				(v, p) => (p.observed_at && (!v || p.observed_at > v) ? p.observed_at : v),
				null
			)
		})),
		pagination: { limit: q.limit, offset: q.offset, has_more: machines.length > q.limit }
	});
});
