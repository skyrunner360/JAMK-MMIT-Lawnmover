import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDurableSink } from '../src/lib/sim/durable-sink.js';
const dirs: string[] = [];
const dir = () => {
	const d = mkdtempSync(join(tmpdir(), 'mower-outbox-'));
	dirs.push(d);
	return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const run = '00000000-0000-4000-8000-000000000099';
const accepted = (messageId: string | null) =>
	new Response(JSON.stringify({ accepted: true, run_id: run, message_id: messageId }));
test('transient failures retry in order and acknowledge only committed envelopes', async () => {
	let attempts = 0;
	const seen: number[] = [];
	const sink = createDurableSink({
		directory: dir(),
		url: 'http://local',
		machineId: run,
		token: 'secret',
		runId: run,
		sleep: async () => {},
		transport: async (_u: any, init: any) => {
			expect(new Headers(init.headers).get('x-run-id')).toBe(run);
			if (attempts++ === 0) throw new Error('offline');
			seen.push(JSON.parse(init.body).data);
			return accepted(new Headers(init.headers).get('x-message-id'));
		}
	});
	sink({ type: 'reading', data: 1 });
	sink({ type: 'reading', data: 2 });
	await sink.flush();
	await sink.close();
	expect(attempts).toBe(3);
	expect(seen).toEqual([1, 2]);
});
test('permanent rejection retains envelopes for restart with original run identity', async () => {
	const directory = dir();
	const first = createDurableSink({
		directory,
		url: 'http://local',
		machineId: run,
		token: 'secret',
		runId: run,
		transport: async () => new Response('', { status: 401 })
	});
	first({ type: 'reading', data: 7 });
	await expect(first.flush()).rejects.toThrow('401');
	await first.close();
	expect(readdirSync(directory).filter((f) => f.endsWith('.json')).length).toBe(1);
	const seen: string[] = [];
	const second = createDurableSink({
		directory,
		url: 'http://local',
		machineId: run,
		token: 'secret',
		runId: crypto.randomUUID(),
		transport: async (_u: any, init: any) => {
			seen.push(new Headers(init.headers).get('x-run-id')!);
			return accepted(new Headers(init.headers).get('x-message-id'));
		}
	});
	await second.flush();
	await second.close();
	expect(seen).toEqual([run]);
});
test('bounded storage stops producer explicitly and retains prior data; concurrent owners reject', async () => {
	const directory = dir();
	let stopped = false;
	const sink = createDurableSink({
		directory,
		url: 'http://local',
		machineId: run,
		token: 'x',
		runId: run,
		maxMessages: 1,
		onFailure: () => {
			stopped = true;
		},
		transport: async () => new Response('', { status: 401 })
	});
	expect(() =>
		createDurableSink({ directory, url: 'http://local', machineId: run, token: 'x', runId: run })
	).toThrow('in use');
	sink({ type: 'reading', data: 1 });
	expect(() => sink({ type: 'reading', data: 2 })).toThrow('capacity');
	expect(stopped).toBe(true);
	await sink.close();
	expect(readdirSync(directory).filter((f) => f.endsWith('.json')).length).toBe(1);
});

test('sudden process exit recovers persisted envelope and stale owner lock', async () => {
	const directory = dir();
	const modulePath = new URL('../src/lib/sim/durable-sink.js', import.meta.url).pathname;
	const script = `import {createDurableSink} from ${JSON.stringify(modulePath)};
 const sink=createDurableSink({directory:process.env.TEST_OUTBOX,url:'http://local',machineId:process.env.TEST_RUN,token:'x',runId:process.env.TEST_RUN,transport:async()=>new Promise(()=>{})});
 sink({type:'reading',data:99});process.exit(0);`;
	const child = Bun.spawn([process.execPath, '-e', script], {
		env: { ...process.env, TEST_OUTBOX: directory, TEST_RUN: run },
		stdout: 'pipe',
		stderr: 'pipe'
	});
	expect(await child.exited).toBe(0);
	const seen: number[] = [];
	const sink = createDurableSink({
		directory,
		url: 'http://local',
		machineId: run,
		token: 'x',
		runId: crypto.randomUUID(),
		transport: async (_u: any, init: any) => {
			seen.push(JSON.parse(init.body).data);
			return accepted(new Headers(init.headers).get('x-message-id'));
		}
	});
	await sink.flush();
	await sink.close();
	expect(seen).toEqual([99]);
});

test('lost acknowledgement retries the same persisted envelope', async () => {
	const seen: string[] = [];
	let calls = 0;
	const sink = createDurableSink({
		directory: dir(),
		url: 'http://local',
		machineId: run,
		token: 'x',
		runId: run,
		sleep: async () => {},
		transport: async (_u: any, init: any) => {
			seen.push(init.body);
			if (calls++ === 0) throw new Error('acknowledgement lost after commit');
			return accepted(new Headers(init.headers).get('x-message-id'));
		}
	});
	sink({ type: 'reading', data: 55 });
	await sink.flush();
	await sink.close();
	expect(seen.length).toBe(2);
	expect(seen[0]).toBe(seen[1]);
});

test('stable message IDs survive retries and identify the acknowledgement', async () => {
	const ids: string[] = [];
	const delays: number[] = [];
	let attempts = 0;
	const sink = createDurableSink({
		directory: dir(),
		url: 'http://local',
		machineId: run,
		token: 'x',
		runId: run,
		sleep: async (ms) => {
			delays.push(ms);
		},
		transport: async (_u: any, init: any) => {
			const id = new Headers(init.headers).get('x-message-id');
			ids.push(id!);
			if (attempts++ < 3) return new Response('', { status: 503 });
			return new Response(JSON.stringify({ accepted: true, run_id: run, message_id: id }));
		}
	});
	sink({ type: 'reading', data: 1 });
	await sink.flush();
	await sink.close();
	expect(ids[0]).toMatch(/^[\da-f-]{36}$/);
	expect(new Set(ids).size).toBe(1);
	expect(delays.length).toBe(3);
	expect(delays[1]).toBeGreaterThan(delays[0]);
	expect(delays[2]).toBeGreaterThan(delays[1]);
});

test('a mismatched message acknowledgement never deletes the queued record', async () => {
	const directory = dir();
	const sink = createDurableSink({
		directory,
		url: 'http://local',
		machineId: run,
		token: 'x',
		runId: run,
		transport: async () =>
			new Response(JSON.stringify({ accepted: true, run_id: run, message_id: crypto.randomUUID() }))
	});
	sink({ type: 'reading', data: 1 });
	await expect(sink.flush()).rejects.toThrow('Invalid ingestion acknowledgement');
	await sink.close();
	expect(readdirSync(directory).filter((n) => n.endsWith('.json'))).toHaveLength(1);
});
