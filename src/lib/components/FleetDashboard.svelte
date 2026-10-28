<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from './Icon.svelte';
	import ZoneMap from './ZoneMap.svelte';
	import TelemetryChart from './TelemetryChart.svelte';
	import { freshness } from '#lib/dashboard/fleet.ts';
	import { Dashboard } from '#lib/dashboard/dashboard.svelte.ts';
	import { formatNumber, formatTime, type Reading, type Session } from '#lib/dashboard/data.ts';
	import type {
		Fleet,
		SessionPage,
		ReadingPage,
		EventPage,
		TrendDay
	} from '#lib/dashboard/fleet-types.ts';
	const demo = new Dashboard();
	const DEMO = '00000000-0000-4000-8000-000000000002';
	let now = $state(Date.now());
	let ready = $state(false);
	let audience = $state<'customer' | 'engineer'>('customer');
	let fleet = $state<Fleet | null>(null),
		fleetError = $state(''),
		selected = $state(''),
		machineOffset = $state(0);
	let sessions = $state<SessionPage>({ data: [], pagination: { has_more: false } }),
		sessionOffset = $state(0),
		sessionId = $state('');
	let readings = $state<ReadingPage>({ data: [], pagination: { has_more: false } }),
		readingOffset = $state(0);
	let events = $state<EventPage>({ data: [], pagination: { has_more: false } }),
		eventOffset = $state(0);
	let detail = $state<Session | null>(null);
	let machineError = $state(''),
		detailError = $state(''),
		trendError = $state('');
	let machineBusy = $state(false),
		detailBusy = $state(false),
		trendBusy = $state(false),
		cycleBusy = $state(false);
	let view = $state<'session' | 'season'>('session'),
		windowSize = $state(100),
		eventFilter = $state('all');
	let trendFrom = $state(''),
		trendTo = $state('');
	const today = new Date().toISOString().slice(0, 10);
	let from = $state(new Date(Date.parse(today) - 179 * 86400000).toISOString().slice(0, 10)),
		to = $state(today);
	let trend = $state<TrendDay[]>([]),
		trendRange = $state('');
	function communication(m: NonNullable<Fleet>['machines'][number]) {
		return freshness(m.last_received_at, m.last_observed_at, now, fleet?.stale_seconds ?? 60);
	}
	let machine = $derived(fleet?.machines.find((m) => m.id === selected));
	let chartRows = $derived(
		(sessionId ? readings.data.toReversed() : selected === DEMO ? demo.readings : []).slice(
			-windowSize
		)
	);
	let shownEvents = $derived(events.data.filter((e) => eventFilter === 'all' || e.error_code));
	let known = $derived(fleet?.zones.filter((z) => z.coverage_pct !== null) ?? []);
	let estimatedArea = $derived(
		known.reduce((n, z) => n + (z.area_m2 * (z.coverage_pct ?? 0)) / 100, 0)
	);
	let complete = $derived(known.filter((z) => (z.coverage_pct ?? 0) >= 99).length);
	let trendMax = $derived(Math.max(1, ...trend.map((d) => d.motor_current_mean ?? 0)));
	let fleetRequest = 0,
		machineRequest = 0,
		detailRequest = 0,
		trendRequest = 0,
		alive = true;
	const abort = new AbortController();
	function stamp(v: string | null | undefined) {
		return v ? new Date(v).toLocaleString('en-GB', { timeZone: 'UTC' }) + ' UTC' : 'Not received';
	}
	async function request<T>(path: string, body?: unknown): Promise<T> {
		const response = await fetch(path, {
			signal: abort.signal,
			...(body
				? {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify(body)
					}
				: {})
		});
		const result = await response.json();
		if (!response.ok) throw new Error(result.error ?? 'Request failed');
		return result;
	}
	function message(e: unknown) {
		return e instanceof Error ? e.message : 'Unable to load data';
	}
	async function refreshFleet() {
		const seq = ++fleetRequest;
		try {
			const result = await request<Fleet>(`/api/fleet?offset=${machineOffset}`);
			if (!alive || seq !== fleetRequest) return;
			fleet = result;
			fleetError = '';
			if (!selected || !result.machines.some((m) => m.id === selected)) {
				await selectMachine(result.machines[0]?.id ?? '');
			}
		} catch (e) {
			if (alive && seq === fleetRequest) fleetError = message(e);
		}
	}
	async function selectMachine(id: string) {
		selected = id;
		sessionOffset = 0;
		sessionId = '';
		sessions = { data: [], pagination: { has_more: false } };
		detailBusy = false;
		trendBusy = false;
		readings = { data: [], pagination: { has_more: false } };
		events = { data: [], pagination: { has_more: false } };
		detail = null;
		trend = [];
		trendRange = '';
		detailError = '';
		trendError = '';
		++detailRequest;
		++trendRequest;
		await loadMachine();
		if (view === 'season') void loadTrends();
	}
	async function loadMachine() {
		const seq = ++machineRequest,
			id = selected;
		machineBusy = true;
		machineError = '';
		if (!id) {
			machineBusy = false;
			return;
		}
		try {
			const [state, page] = await Promise.all([
				request<{ data: { reading: Reading | null } }>(`/api/machines/${id}/state`),
				request<SessionPage>(`/api/sessions?machine_id=${id}&limit=10&offset=${sessionOffset}`)
			]);
			if (!alive || seq !== machineRequest || id !== selected) return;
			sessions = page;
		} catch (e) {
			if (alive && seq === machineRequest) machineError = message(e);
		} finally {
			if (seq === machineRequest) machineBusy = false;
		}
	}
	async function openSession(id: string) {
		sessionId = id;
		readingOffset = 0;
		eventOffset = 0;
		detail = null;
		await loadDetail();
	}
	async function loadDetail() {
		const seq = ++detailRequest,
			id = sessionId,
			m = selected;
		detailBusy = true;
		detailError = '';
		readings = { data: [], pagination: { has_more: false } };
		events = { data: [], pagination: { has_more: false } };
		if (!id) {
			detailBusy = false;
			return;
		}
		try {
			const [info, rows, activity] = await Promise.all([
				request<{ data: Session }>(`/api/sessions/${id}?machine_id=${m}`),
				request<ReadingPage>(
					`/api/readings?machine_id=${m}&session_id=${id}&limit=200&offset=${readingOffset}`
				),
				request<EventPage>(
					`/api/events?machine_id=${m}&session_id=${id}&limit=50&offset=${eventOffset}`
				)
			]);
			if (!alive || seq !== detailRequest || m !== selected || id !== sessionId) return;
			detail = info.data;
			readings = rows;
			events = activity;
		} catch (e) {
			if (alive && seq === detailRequest) detailError = message(e);
		} finally {
			if (seq === detailRequest) detailBusy = false;
		}
	}
	async function loadTrends() {
		const requestedFrom = from,
			requestedTo = to;
		const seq = ++trendRequest,
			id = selected;
		trendBusy = true;
		trendError = '';
		trend = [];
		trendRange = '';
		try {
			const data = await request<{ data: TrendDay[] }>(
				`/api/trends?machine_id=${id}&from=${requestedFrom}&to=${requestedTo}`
			);
			if (!alive || seq !== trendRequest || id !== selected) return;
			trend = data.data;
			trendRange = `${requestedFrom} – ${requestedTo}`;
			trendFrom = requestedFrom;
			trendTo = requestedTo;
		} catch (e) {
			if (alive && seq === trendRequest) trendError = message(e);
		} finally {
			if (seq === trendRequest) trendBusy = false;
		}
	}
	async function cycle(action: 'start' | 'complete') {
		if (!fleet) return;
		cycleBusy = true;
		try {
			await request('/api/cycles', { property_id: fleet.property.id, action });
			await refreshFleet();
			await demo.refresh();
		} catch (e) {
			fleetError = message(e);
		} finally {
			cycleBusy = false;
		}
	}
	function download() {
		const columns = [
			'timestamp',
			'session_id',
			'zone_id',
			'mode',
			'battery_pct',
			'motor_current_a',
			'speed_mps',
			'is_anomaly'
		] as const;
		const csv = [
			columns.join(','),
			...chartRows.map((r) => columns.map((k) => r[k]).join(','))
		].join('\n');
		const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
		const a = document.createElement('a');
		a.href = url;
		a.download = 'mower-telemetry.csv';
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
	onMount(() => {
		ready = true;
		alive = true;
		void demo.initialize();
		void refreshFleet();
		const timer = setInterval(() => {
			void refreshFleet();
		}, 5000);
		const freshnessTimer = setInterval(() => {
			now = Date.now();
		}, 1000);
		return () => {
			alive = false;
			abort.abort();
			clearInterval(timer);
			clearInterval(freshnessTimer);
			demo.dispose();
		};
	});
</script>

<div class="app-shell">
	<aside class="sidebar">
		<a class="brand" href="#overview"
			><span class="brand-mark"><Icon name="leaf" size={23} /></span>fieldwork<span
				class="brand-dot">.</span
			></a
		>
		<div class="workspace">
			<span class="workspace-avatar">J</span>
			<div>
				<strong>{fleet?.property.name ?? 'JAMK garden'}</strong><small>Property & fleet</small>
			</div>
		</div>
		<p class="nav-label">WORKSPACE</p>
		<nav aria-label="Main navigation">
			<a
				href="#zones"
				class:active={audience === 'customer'}
				onclick={() => (audience = 'customer')}><Icon name="map" />Property coverage</a
			><a
				href="#engineer"
				class:active={audience === 'engineer'}
				onclick={() => (audience = 'engineer')}><Icon name="chart" />Machine health</a
			>
		</nav>
		<div class="sidebar-bottom">
			<div class="demo-card">
				<strong>Every corner counts.</strong>
				<p>Sixty zones. A clearer picture of the work on the ground.</p>
				<span>Fieldwork · robotic lawn care</span>
			</div>
		</div>
	</aside>
	<div class="main-shell">
		<header class="topbar">
			<div class="breadcrumb">
				Workspace <span>/</span><strong
					>{audience === 'customer' ? 'Property coverage' : 'Machine health'}</strong
				>
			</div>
			<span class="demo-badge">DEMO WORKSPACE</span>
		</header>
		<main id="overview">
			<div class="page-heading">
				<div>
					<p class="eyebrow heading-eyebrow">
						{audience === 'customer'
							? 'YOUR PROPERTY, ZONE BY ZONE'
							: 'A CLOSER LOOK AT YOUR FLEET'}
					</p>
					<h1>
						{audience === 'customer'
							? 'A better view of every mow.'
							: 'Spot the signs. Plan the care.'}
					</h1>
					<p>
						{audience === 'customer'
							? 'See where work has reached, and which corners still need attention.'
							: 'Explore a single session or step back to see a season of machine health.'}
					</p>
				</div>
				<div class="audience-switch" aria-label="Dashboard audience">
					<button
						class:chosen={audience === 'customer'}
						disabled={!ready}
						aria-pressed={audience === 'customer'}
						onclick={() => (audience = 'customer')}>Customer</button
					><button
						class:chosen={audience === 'engineer'}
						disabled={!ready}
						aria-pressed={audience === 'engineer'}
						onclick={() => (audience = 'engineer')}>Engineer</button
					>
				</div>
			</div>
			{#if fleetError}<div class="error-banner" role="alert">
					{fleetError}<button class="button secondary" onclick={refreshFleet}>Retry property</button
					>
				</div>{/if}
			{#if audience === 'customer'}
				<p class="muted-note">
					{fleet?.machines.filter((m) => !communication(m).connected).length ?? 0} machines disconnected
					· {fleet?.machines.filter((m) => !communication(m).fresh).length ?? 0} machines without fresh
					observations. Coverage retains its observation time while a connection is unavailable.
				</p>
				<div class="property-summary">
					<article>
						<span class="eyebrow">ESTIMATED WORK</span><strong
							>{known.length ? estimatedArea.toFixed(0) : '—'} <small>m²</small></strong
						><span>Time and speed estimate · overlap may overstate coverage</span>
					</article>
					<article>
						<span class="eyebrow">ZONES AT ≥99% ESTIMATE</span><strong
							>{complete} <small>/ {fleet?.zones.length ?? 60}</small></strong
						><span>{known.length} zones observed in this cycle</span>
					</article>
					<article>
						<span class="eyebrow">PROPERTY STATUS</span><strong class="summary-label"
							>{fleet?.cycle?.historical
								? 'Historical'
								: fleet?.cycle?.completed_at
									? 'Cycle ended'
									: fleet?.cycle
										? 'Cycle active'
										: 'Awaiting a cycle'}</strong
						><span>{(fleet?.zones.length ?? 60) - known.length} zones have unknown coverage</span>
					</article>
				</div>
				<ZoneMap zones={fleet?.zones ?? []} />
				<div class="cycle-footer">
					<p>
						{fleet?.cycle?.historical
							? 'Historical cumulative coverage; start a cycle for fresh progress.'
							: 'Estimated coverage for this mowing cycle, not verified grass condition. Overlapping machines use their highest estimate.'}<br
						/>Started: {stamp(fleet?.cycle?.started_at)}
					</p>
					<div class="heading-actions">
						<button
							class="button secondary"
							disabled={cycleBusy || !fleet}
							onclick={() => cycle('start')}>Start new mowing cycle</button
						>{#if fleet?.cycle && !fleet.cycle.completed_at}<button
								class="button secondary"
								disabled={cycleBusy}
								onclick={() => cycle('complete')}>Complete cycle</button
							>{/if}
					</div>
				</div>
				<p class="muted-note">
					A new cycle starts fresh progress. External machines join it on their next run. Hatching
					means no observation; the map is an illustrative layout.
				</p>
			{:else}
				<section id="engineer" aria-label="Engineer workspace">
					<div class="section-heading">
						<h2>Fleet health</h2>
						<span class="history-caption"
							>Receiving buffered data does not mean the captured state is current</span
						>
					</div>
					<div class="fleet-cards">
						{#each fleet?.machines ?? [] as m (m.id)}<button
								class="machine-card"
								class:chosen={selected === m.id}
								aria-pressed={selected === m.id}
								onclick={() => selectMachine(m.id)}
								><strong>{m.name}</strong><span class:warning={m.diagnostic === 'Inspect machine'}
									>{m.diagnostic}</span
								><small
									>{communication(m).connected ? 'Receiving' : 'Disconnected'} · {communication(m)
										.fresh
										? 'Fresh observations'
										: 'Stale / missing / clock ahead'}</small
								><small>Last captured {stamp(m.last_observed_at)}</small><small
									>Last received {stamp(m.last_received_at)}</small
								>{#if m.summary}<small
										>Health sample: {String(m.summary.day).slice(0, 10)} · {m.summary.sample_count} readings</small
									>{/if}</button
							>{:else}<p>No machines provisioned.</p>{/each}
					</div>
					<div class="table-footer">
						<button
							class="text-button"
							disabled={machineOffset === 0}
							onclick={() => {
								machineOffset = Math.max(0, machineOffset - 50);
								void refreshFleet();
							}}>Previous machines</button
						><button
							class="text-button"
							disabled={!fleet?.pagination.has_more}
							onclick={() => {
								machineOffset += 50;
								void refreshFleet();
							}}>Next machines</button
						>
					</div>
					<p class="muted-note">
						Diagnostic heuristics, not failure predictions. Latest observed day requires ≥{fleet
							?.thresholds.minimum_samples ?? 30} readings; inspect at anomaly rate ≥{(
							(fleet?.thresholds.anomaly_rate ?? 0.05) * 100
						).toFixed(0)}%, mean motor current ≥{fleet?.thresholds.motor_current_a ?? 5} A, or battery
						temperature ≥{fleet?.thresholds.temperature_c ?? 50}°C. Freshness window: {fleet?.stale_seconds ??
							60}s.
					</p>
					{#if machineError}<p role="alert">{machineError}</p>{/if}
					<div class="section-heading">
						<h2>{machine?.name ?? 'Select a machine'}</h2>
						<div class="audience-switch">
							<button class:chosen={view === 'session'} onclick={() => (view = 'session')}
								>Session detail</button
							><button
								class:chosen={view === 'season'}
								onclick={() => {
									view = 'season';
									void loadTrends();
								}}>Seasonal trends</button
							>
						</div>
					</div>
					{#if view === 'season'}
						<section class="panel season-panel" aria-label="Seasonal trends">
							<div class="panel-heading">
								<div>
									<p class="eyebrow">DAILY SUMMARIES</p>
									<h2>A season in perspective</h2>
								</div>
							</div>
							<form
								class="trend-controls"
								onsubmit={(e) => {
									e.preventDefault();
									void loadTrends();
								}}
							>
								<label>From<input type="date" bind:value={from} required /></label><label
									>To<input type="date" bind:value={to} required /></label
								><button class="button primary" disabled={trendBusy || !selected}
									>Load trends</button
								>
							</form>
							{#if trendError}<p role="alert">{trendError}</p>{/if}
							{#if trendBusy}<p role="status">Loading daily summaries…</p>{:else if trend.length}<p
									class="muted-note"
								>
									{trendRange} · daily mean motor current · UTC · {trend.filter(
										(d) => d.sample_count !== null
									).length} days with observations
								</p>
								<div
									class="season-chart"
									role="img"
									aria-label="Daily mean motor current; hatched columns mark unknown days"
								>
									{#each trend as day (day.day)}<span
											class="day-bar"
											class:missing={day.sample_count === null}
											style:--height={`${day.motor_current_mean === null ? 100 : Math.max(2, (100 * day.motor_current_mean) / trendMax)}%`}
											title={`${day.day}: ${day.motor_current_mean === null ? 'No observations' : day.motor_current_mean.toFixed(2) + ' A'}`}
										></span>{/each}
								</div>
								<div class="season-axis">
									<span>{trendFrom}</span><span
										>0 – {trendMax.toFixed(1)} A · hatching = unknown</span
									><span>{trendTo}</span>
								</div>
								<details>
									<summary>Daily values and diagnostic signals</summary>
									<div class="table-scroll">
										<table>
											<thead
												><tr
													><th>UTC day</th><th>Readings</th><th>Motor mean</th><th>Anomaly rate</th
													><th>Peak battery temp</th></tr
												></thead
											><tbody
												>{#each trend as day (day.day)}<tr
														><td>{day.day}</td><td>{day.sample_count ?? 'Unknown'}</td><td
															>{formatNumber(day.motor_current_mean, 2)} A</td
														><td
															>{day.anomaly_rate === null
																? '—'
																: (day.anomaly_rate * 100).toFixed(1) + '%'}</td
														><td>{formatNumber(day.temperature_max)}°C</td></tr
													>{/each}</tbody
											>
										</table>
									</div>
								</details>
							{:else}<p>No trend loaded. Choose a range of up to 366 days.</p>{/if}
							<p class="muted-note">
								Missing days mean unknown, not zero. Seasonal queries use daily summaries and never
								load session telemetry.
							</p>
						</section>
					{:else}
						<section class="panel session-panel" id="sessions">
							<div class="panel-heading">
								<div>
									<p class="eyebrow">ONE SESSION AT A TIME</p>
									<h2>Session history</h2>
								</div>
								<button
									class="button secondary"
									disabled={machineBusy || !selected}
									onclick={loadMachine}>Refresh sessions</button
								>
							</div>
							<div class="table-scroll">
								<table>
									<thead
										><tr
											><th>Session</th><th>Started (UTC)</th><th>Duration</th><th>Area</th><th
												>Anomalies</th
											><th>Status</th></tr
										></thead
									><tbody
										>{#each sessions.data as s (s.id)}<tr
												><td
													><button
														class="session-link"
														aria-expanded={sessionId === s.id}
														onclick={() => s.id && openSession(s.id)}
														>#{s.session_id.toString().padStart(3, '0')} <span>→</span></button
													></td
												><td>{stamp(s.start_time)}</td><td>{s.duration_min ?? '—'} min</td><td
													>{formatNumber(s.area_covered_m2, 0)} m²</td
												><td>{s.anomaly_rows ?? '—'}</td><td
													>{s.ended_with_error ?? (s.end_time ? 'Completed' : 'Not completed')}</td
												></tr
											>{:else}<tr
												><td colspan="6"
													>{machineBusy ? 'Loading sessions…' : 'No sessions for this machine.'}</td
												></tr
											>{/each}</tbody
									>
								</table>
							</div>
							<div class="table-footer">
								<button
									class="text-button"
									disabled={!sessionOffset || machineBusy}
									onclick={() => {
										sessionOffset -= 10;
										void loadMachine();
									}}>Previous sessions</button
								><span>Page {sessionOffset / 10 + 1}</span><button
									class="text-button"
									disabled={!sessions.pagination.has_more || machineBusy}
									onclick={() => {
										sessionOffset += 10;
										void loadMachine();
									}}>Next sessions</button
								>
							</div>
						</section>
						{#if sessionId}<section class="panel selected-detail" aria-label="Selected session">
								<div class="panel-heading">
									<h2>Session details</h2>
									<button class="button secondary" onclick={loadDetail} disabled={detailBusy}
										>Refresh detail</button
									>
								</div>
								{#if detail}<p>
										Historical session #{detail.session_id} · {detail.weather} · started {stamp(
											detail.start_time
										)}
									</p>{/if}{#if detailError}<p role="alert">{detailError}</p>{/if}{#if detailBusy}<p
										role="status"
									>
										Loading session telemetry…
									</p>{/if}
								<div class="section-heading">
									<label class="select-label"
										>View <select bind:value={windowSize} aria-label="Chart sample window"
											><option value={30}>Last 30 page samples</option><option value={100}
												>Last 100 page samples</option
											><option value={200}>All 200 page samples</option></select
										></label
									><button class="button secondary" onclick={download} disabled={!chartRows.length}
										><Icon name="download" size={16} />Export CSV</button
									>
								</div>
								<div class="chart-grid">
									<TelemetryChart
										rows={chartRows}
										title="Battery charge"
										metric="battery_pct"
										unit="%"
									/><TelemetryChart
										rows={chartRows}
										title="Motor current"
										metric="motor_current_a"
										unit="A"
										color="#c38b3c"
										maximum={10}
									/>
								</div>
								<div class="table-footer">
									<button
										class="text-button"
										disabled={!readingOffset || detailBusy}
										onclick={() => {
											readingOffset -= 200;
											void loadDetail();
										}}>Newer readings</button
									><span
										>Newest first · readings {readingOffset + 1}–{readingOffset +
											readings.data.length}</span
									><button
										class="text-button"
										disabled={!readings.pagination.has_more || detailBusy}
										onclick={() => {
											readingOffset += 200;
											void loadDetail();
										}}>Older readings</button
									>
								</div>
								<div class="section-heading">
									<h2>Session activity</h2>
									<select bind:value={eventFilter} aria-label="Filter activity"
										><option value="all">All events</option><option value="warnings"
											>With error codes</option
										></select
									>
								</div>
								<div class="event-list">
									{#each shownEvents as e (`${e.timestamp}:${e.event_type}`)}<div class="event-row">
											<span class="event-icon"><Icon name="alert" /></span>
											<div>
												<strong>{e.event_type.replaceAll('_', ' ')}</strong>
												<p>Zone {e.zone_id} · {e.error_code ?? 'No error code'}</p>
											</div>
											<time
												title={`Captured ${stamp(e.timestamp)}; received ${stamp(e.received_at)}`}
												>{stamp(e.timestamp)}</time
											>
										</div>{:else}<p>No matching events on this page.</p>{/each}
								</div>
								<div class="table-footer">
									<button
										class="text-button"
										disabled={!eventOffset || detailBusy}
										onclick={() => {
											eventOffset -= 50;
											void loadDetail();
										}}>Newer events</button
									><button
										class="text-button"
										disabled={!events.pagination.has_more || detailBusy}
										onclick={() => {
											eventOffset += 50;
											void loadDetail();
										}}>Older events</button
									>
								</div>
							</section>{/if}
					{/if}
				</section>
			{/if}
			<section class="mower-strip" aria-label="Demo simulator controls">
				<div class="mower-identity">
					<div class="mower-symbol"><Icon name="leaf" size={28} /></div>
					<div>
						<div class="mower-title">Demo mower <span>10× speed</span></div>
						<p>
							{demo.readings.at(-1)
								? 'Last captured ' + stamp(demo.readings.at(-1)?.timestamp)
								: 'Waiting for demo telemetry'}
						</p>
					</div>
				</div>
				<span class="connection" class:offline={demo.connection !== 'live'}
					><i></i>{demo.connection === 'live'
						? 'Dashboard connected'
						: demo.connection === 'connecting'
							? 'Connecting'
							: 'Disconnected'}</span
				><button
					class="button primary"
					onclick={() => demo.control()}
					disabled={demo.busy || demo.loading || !demo.status.healthy}
					><Icon name={demo.status.running ? 'pause' : 'play'} size={16} />{demo.status.running
						? 'Pause simulation'
						: 'Start simulation'}</button
				>
			</section>
			{#if demo.error}<p role="alert">{demo.error}</p>{/if}
			<footer class="page-footer">
				<span><Icon name="leaf" size={14} />Made for a little more green.</span><span
					>Public demo · audience switch changes the view · times in UTC</span
				>
			</footer>
		</main>
	</div>
</div>

<style>
	.audience-switch {
		display: flex;
		background: #edf1e9;
		border: 1px solid var(--border);
		border-radius: 9px;
		padding: 4px;
		gap: 3px;
		flex-shrink: 0;
	}
	.audience-switch button {
		border: 0;
		background: transparent;
		padding: 9px 13px;
		border-radius: 6px;
		color: var(--muted);
		cursor: pointer;
		font: inherit;
		font-size: 12px;
	}
	.audience-switch button.chosen {
		background: white;
		box-shadow: 0 1px 4px #203a1614;
		color: var(--ink);
	}
	.property-summary {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 18px;
		margin-bottom: 24px;
	}
	.property-summary article {
		padding: 22px;
		background: white;
		border: 1px solid var(--border);
		border-radius: 12px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.property-summary strong {
		font-size: 32px;
		letter-spacing: -1px;
	}
	.property-summary small {
		font-size: 18px;
		font-weight: 400;
		color: var(--muted);
	}
	.property-summary article > span:last-child {
		font-size: 11px;
		color: var(--muted);
		line-height: 1.6;
	}
	.property-summary .summary-label {
		font-size: 24px;
		letter-spacing: -0.5px;
	}
	.cycle-footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 16px;
		margin-top: 16px;
	}
	.cycle-footer p,
	.muted-note {
		font-size: 12px;
		line-height: 1.8;
		color: var(--muted);
	}
	.fleet-cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 12px;
	}
	.machine-card {
		background: white;
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 20px;
		text-align: left;
		display: flex;
		flex-direction: column;
		gap: 10px;
		color: var(--ink);
		cursor: pointer;
	}
	.machine-card.chosen {
		outline: 2px solid #438550;
		outline-offset: 1px;
	}
	.machine-card small {
		font-size: 11px;
		color: var(--muted);
		overflow-wrap: anywhere;
	}
	.machine-card > span {
		font-size: 12px;
		color: #34744e;
	}
	.machine-card > span.warning {
		color: #ad6828;
	}
	.season-panel,
	.selected-detail,
	.session-panel {
		margin-top: 22px;
	}
	.trend-controls {
		display: flex;
		gap: 14px;
		flex-wrap: wrap;
		align-items: end;
		margin: 22px 0;
	}
	.trend-controls label {
		display: flex;
		flex-direction: column;
		gap: 7px;
		font-size: 12px;
	}
	.trend-controls input {
		border: 1px solid var(--border);
		border-radius: 7px;
		padding: 10px;
		background: #fff;
		font: inherit;
		max-width: 100%;
	}
	.season-chart {
		height: 190px;
		display: flex;
		align-items: end;
		gap: 1px;
		border-bottom: 1px solid var(--border);
		padding-top: 10px;
	}
	.day-bar {
		flex: 1;
		min-width: 0;
		height: var(--height);
		background: #438550;
		border-radius: 2px 2px 0 0;
	}
	.day-bar.missing {
		background: repeating-linear-gradient(135deg, #eef1e9, #eef1e9 4px, #d5ddce 4px, #d5ddce 5px);
	}
	.season-axis {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		font-size: 10px;
		color: var(--muted);
		margin: 12px 0 22px;
	}
	.season-panel details {
		font-size: 12px;
	}
	.season-panel summary {
		cursor: pointer;
		padding: 12px 0;
	}
	.selected-detail > .section-heading {
		margin-top: 24px;
	}
	.selected-detail .chart-grid {
		margin-top: 15px;
	}
	.mower-strip {
		margin-top: 30px;
	}
	@media (max-width: 760px) {
		.page-heading,
		.cycle-footer {
			align-items: stretch;
			flex-direction: column;
		}
		.audience-switch {
			align-self: start;
		}
		.property-summary {
			grid-template-columns: 1fr;
		}
		.property-summary article {
			padding: 18px;
		}
		.section-heading {
			flex-wrap: wrap;
			gap: 14px;
		}
		.season-axis {
			flex-wrap: wrap;
		}
		.selected-detail {
			padding: 15px;
		}
		.fleet-cards {
			grid-template-columns: 1fr;
		}
	}
</style>
