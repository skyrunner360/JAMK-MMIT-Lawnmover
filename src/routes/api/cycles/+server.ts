import { json, error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { api, readJson } from '#lib/server/mower/http.ts';
import { getMowerService } from '#lib/server/mower/service.ts';
import { DEMO_PROPERTY } from '#lib/server/mower/fleet.ts';
import { cycleAction } from '#lib/server/mower/fleet-validation.ts';
export const POST = api(async ({ request }) => {
	const q = cycleAction.parse(await readJson(request));
	const data = await db.$transaction(async (tx) => {
		const property = await tx.$queryRaw<
			Array<{ id: string }>
		>`SELECT id FROM property WHERE id=${q.property_id}::uuid FOR UPDATE`;
		if (!property.length) error(404, 'Property not found');
		const active = await tx.mowingCycle.findFirst({
			where: { property_id: q.property_id, completed_at: null }
		});
		if (active)
			await tx.mowingCycle.update({ where: { id: active.id }, data: { completed_at: new Date() } });
		if (q.action === 'complete') return null;
		const cycle = await tx.mowingCycle.create({ data: { property_id: q.property_id } });
		// Ongoing runs stay on their original cycle. A new run is required to enter a new cycle.
		return cycle;
	});
	if (q.property_id === DEMO_PROPERTY) {
		const service = getMowerService();
		if (q.action === 'complete') await service.stop();
		else await service.rollover();
	}
	return json({ data });
});
