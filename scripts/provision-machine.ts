import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { newCredential, DEMO_PROPERTY, ensureDemoFleet } from '../src/lib/server/mower/fleet';
const db = new PrismaClient();
try {
	const name = z.string().min(1).max(100).parse(process.argv[2]);
	const property_id = z.uuid().parse(process.argv[3] ?? DEMO_PROPERTY);
	await ensureDemoFleet(db);
	const { token, token_hash } = newCredential();
	const machine = await db.machine.create({ data: { name, property_id, token_hash } });
	console.log(JSON.stringify({ machine_id: machine.id, token }, null, 2));
} finally {
	await db.$disconnect();
}
