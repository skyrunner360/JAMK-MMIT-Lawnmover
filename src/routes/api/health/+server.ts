import { json } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { getMowerService } from '#lib/server/mower/service.ts';
export async function GET() {
	try {
		await db.$queryRaw`SELECT 1`;
		const healthy = getMowerService().status().healthy;
		return json({ status: healthy ? 'ok' : 'unavailable' }, { status: healthy ? 200 : 503 });
	} catch {
		return json({ status: 'unavailable' }, { status: 503 });
	}
}
