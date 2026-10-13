interface StreamSource {
	snapshot(): unknown;
	subscribe(listener: (message: any) => void): () => void;
}
/** SSE subscribers own only their listener and heartbeat, never the shared simulator. */
export function createEventStream(source: StreamSource, signal: AbortSignal): Response {
	const encoder = new TextEncoder();
	let off: (() => void) | undefined;
	let timer: ReturnType<typeof setInterval> | undefined;
	let closed = false;
	let abort: () => void = () => {};
	const cleanup = () => {
		if (closed) return;
		closed = true;
		off?.();
		if (timer) clearInterval(timer);
		signal.removeEventListener('abort', abort);
	};
	const stream = new ReadableStream<Uint8Array>(
		{
			start(controller) {
				abort = () => {
					cleanup();
					controller.close();
				};
				if (signal.aborted) {
					abort();
					return;
				}
				const send = (message: unknown) => {
					if (closed) return;
					if ((controller.desiredSize ?? 0) <= 0) {
						cleanup();
						controller.error(new Error('Slow stream consumer'));
						return;
					}
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(message)}\n\n`));
					if ((message as { type?: string })?.type === 'error') {
						cleanup();
						controller.close();
					}
				};
				// Synchronous snapshot and subscription: no asynchronous gap to lose messages.
				send({ type: 'snapshot', data: source.snapshot() });
				off = source.subscribe(send);
				signal.addEventListener('abort', abort, { once: true });
				timer = setInterval(() => {
					if (closed) return;
					if ((controller.desiredSize ?? 0) <= 0) {
						cleanup();
						controller.error(new Error('Slow stream consumer'));
						return;
					}
					controller.enqueue(encoder.encode(': heartbeat\n\n'));
				}, 15000);
				timer.unref?.();
			},
			cancel: cleanup
		},
		{ highWaterMark: 32 }
	);
	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream; charset=utf-8',
			'cache-control': 'no-cache, no-transform',
			'x-accel-buffering': 'no'
		}
	});
}
