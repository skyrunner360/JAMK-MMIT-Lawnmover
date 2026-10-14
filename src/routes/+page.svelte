<script lang="ts">
	import { onMount } from 'svelte';
	import { Dashboard } from '#lib/dashboard/dashboard.svelte.ts';
	import { coverage, formatNumber, formatTime } from '#lib/dashboard/data.ts';
	import Icon from '#lib/components/Icon.svelte';
	import TelemetryChart from '#lib/components/TelemetryChart.svelte';
	import ZoneMap from '#lib/components/ZoneMap.svelte';
	const dashboard = new Dashboard();
	let windowSize = $state(100);
	let eventFilter = $state('all');
	let showAllSessions = $state(false);
	let expanded = $state<string | undefined>(undefined);
	let latest = $derived(dashboard.readings.at(-1));
	let chartRows = $derived(dashboard.readings.slice(-windowSize));
	let covered = $derived(coverage(dashboard.zones));
	let coveredArea = $derived(
		dashboard.zones.reduce((n, z) => n + (z.area_m2 * z.coverage_pct) / 100, 0)
	);
	let eventRows = $derived(
		dashboard.events.filter((e) => eventFilter === 'all' || e.error_code).slice(0, 6)
	);
	let sessionRows = $derived(showAllSessions ? dashboard.sessions : dashboard.sessions.slice(0, 5));
	let mode = $derived(
		!dashboard.status.running
			? 'Paused'
			: latest?.mode === 'charging'
				? 'Charging'
				: latest?.mode === 'returning'
					? 'Returning to dock'
					: 'Mowing'
	);
	onMount(() => {
		void dashboard.initialize();
		return () => dashboard.dispose();
	});
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
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = 'mower-telemetry.csv';
		anchor.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
</script>

<svelte:head
	><title>Fieldwork — Mower dashboard</title><meta
		name="description"
		content="A live view of your robotic mower. Explore battery health, motor performance, mowing coverage, and session history."
	/></svelte:head
>

<div class="app-shell">
	<aside class="sidebar">
		<a class="brand" href="#overview"
			><span class="brand-mark"><Icon name="leaf" size={23} /></span>fieldwork<span
				class="brand-dot">.</span
			></a
		>
		<div class="workspace">
			<span class="workspace-avatar">J</span>
			<div><strong>JAMK garden</strong><small>Simulation workspace</small></div>
			<span class="workspace-chevron">⌄</span>
		</div>
		<p class="nav-label">WORKSPACE</p>
		<nav aria-label="Main navigation">
			<a href="#overview" class="active"><Icon name="grid" />Overview</a><a href="#telemetry"
				><Icon name="chart" />Telemetry</a
			><a href="#zones"><Icon name="map" />Mowing area</a><a href="#sessions"
				><Icon name="clock" />Session history</a
			>
		</nav>
		<div class="sidebar-bottom">
			<div class="demo-card">
				<span class="demo-indicator"></span><strong>A garden in motion.</strong>
				<p>Explore live mower data in your simulation workspace.</p>
				<span>10× simulation speed <Icon name="arrow" size={15} /></span>
			</div>
			<div class="sidebar-foot">
				<span class="workspace-avatar small">FW</span>
				<div><strong>Fieldwork demo</strong><small>Robotic lawn care</small></div>
			</div>
		</div>
	</aside>
	<div class="main-shell">
		<header class="topbar">
			<div class="breadcrumb">Workspace <span>/</span> <strong>Overview</strong></div>
			<span class="demo-badge">DEMO MODE</span><span class="topbar-avatar">J</span>
		</header>
		<main id="overview">
			<div class="page-heading">
				<div>
					<div class="eyebrow heading-eyebrow">YOUR GARDEN, AT A GLANCE</div>
					<h1>A better view of every mow.</h1>
					<p>Follow your mower’s progress, performance, and a little bit of green.</p>
				</div>
				<div class="heading-actions">
					<span class="connection" class:offline={dashboard.connection !== 'live'}
						><i></i>{dashboard.connection === 'live'
							? 'Live connection'
							: dashboard.connection === 'connecting'
								? 'Connecting'
								: 'Disconnected'}</span
					><button
						class="button secondary export-button"
						onclick={download}
						disabled={!chartRows.length}><Icon name="download" size={16} />Export CSV</button
					>
				</div>
			</div>
			{#if dashboard.error}<div class="error-banner" role="alert">
					<Icon name="alert" />
					<div>
						<strong>We couldn’t update the mower.</strong>
						<p>{dashboard.error}</p>
					</div>
					<button
						class="button secondary"
						onclick={() => dashboard.initialize()}
						disabled={dashboard.loading}>Reconnect</button
					>
				</div>{/if}
			<section class="mower-strip" aria-label="Mower status">
				<div class="mower-identity">
					<div class="mower-symbol"><Icon name="leaf" size={28} /></div>
					<div>
						<div class="mower-title">Garden mower <span>MR-01</span></div>
						<p>
							{dashboard.loading
								? 'Preparing your workspace…'
								: latest
									? `Last reading ${formatTime(latest.timestamp)} UTC`
									: 'Waiting for the first reading'}
						</p>
					</div>
				</div>
				<div class="mower-location">
					<span class="status-pill" class:paused={!dashboard.status.running}
						><i></i>{dashboard.loading ? 'Connecting' : mode}</span
					><span
						>{latest
							? `Zone ${latest.zone_id.toString().padStart(2, '0')}`
							: 'No active zone'}</span
					>
				</div>
				<div class="weather">
					<Icon name="sun" /><span
						>{formatNumber(latest?.ambient_temp_c)}°C
						<small>{latest?.rain ? 'Rain detected' : 'Ambient temperature'}</small></span
					>
				</div>
				<button
					class="button primary"
					onclick={() => dashboard.control()}
					disabled={dashboard.busy || dashboard.loading || !dashboard.status.healthy}
					><Icon name={dashboard.status.running ? 'pause' : 'play'} size={16} />{dashboard.busy
						? 'Updating…'
						: dashboard.status.running
							? 'Pause simulation'
							: 'Start simulation'}</button
				>
			</section>
			<section class="metrics" aria-label="Live measurements">
				<article class="metric-card">
					<div class="metric-title">Battery level <span><Icon name="battery" /></span></div>
					<div class="metric-value">{formatNumber(latest?.battery_pct)}<small>%</small></div>
					<div class="battery-track"><i style:width={`${latest?.battery_pct ?? 0}%`}></i></div>
					<p>{latest?.mode === 'charging' ? 'Recharging at the dock' : 'Live battery charge'}</p>
				</article>
				<article class="metric-card">
					<div class="metric-title">
						Motor current <span class="amber"><Icon name="bolt" /></span>
					</div>
					<div class="metric-value">{formatNumber(latest?.motor_current_a, 2)}<small>A</small></div>
					<p class:warning={latest?.is_anomaly}>
						<span class="metric-dot" class:amber-dot={latest?.is_anomaly}></span>{!latest
							? 'Waiting for telemetry'
							: latest.is_anomaly
								? 'Anomaly detected'
								: 'Operating normally'}
					</p>
					<div class="metric-note">{formatNumber(latest?.motor_rpm, 0)} RPM · blade motor</div>
				</article>
				<article class="metric-card">
					<div class="metric-title">
						Ground speed <span class="blue"><Icon name="speed" /></span>
					</div>
					<div class="metric-value">{formatNumber(latest?.speed_mps, 2)}<small>m/s</small></div>
					<p>Moving at its own pace</p>
					<div class="metric-note">
						{formatNumber(latest ? latest.speed_mps * 3.6 : undefined, 2)} km/h · current speed
					</div>
				</article>
				<article class="metric-card">
					<div class="metric-title">Area coverage <span><Icon name="map" /></span></div>
					<div class="metric-value">
						{dashboard.zones.length ? covered.toFixed(1) : '—'}<small>%</small>
					</div>
					<p>
						{coveredArea.toFixed(0)} m² of {dashboard.zones
							.reduce((n, z) => n + z.area_m2, 0)
							.toLocaleString()} m²
					</p>
					<div class="metric-note">Across {dashboard.zones.length} mowing zones</div>
				</article>
			</section>
			<section id="telemetry" aria-label="Telemetry charts">
				<div class="section-heading">
					<h2>Performance over time</h2>
					<label class="select-label"
						>View <select bind:value={windowSize} aria-label="Chart sample window"
							><option value={30}>Last 30 samples</option><option value={100}
								>Last 100 samples</option
							><option value={200}>Last 200 samples</option></select
						></label
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
			</section>
			<div class="detail-grid">
				<ZoneMap zones={dashboard.zones} reading={latest} />
				<article class="panel events-panel">
					<div class="panel-heading">
						<div>
							<p class="eyebrow">ON THE GROUND</p>
							<h2>Recent activity</h2>
						</div>
						<select bind:value={eventFilter} aria-label="Filter activity"
							><option value="all">All events</option><option value="warnings"
								>With error codes</option
							></select
						>
					</div>
					<div class="event-list">
						{#each eventRows as event (`${event.session_id}:${event.timestamp}:${event.event_type}`)}<div
								class="event-row"
							>
								<span class="event-icon" class:event-warning={!!event.error_code}
									><Icon name={event.error_code ? 'alert' : 'map'} size={17} /></span
								>
								<div>
									<strong>{event.event_type.replaceAll('_', ' ')}</strong>
									<p>
										Zone {event.zone_id.toString().padStart(2, '0')}{event.error_code
											? ` · ${event.error_code}`
											: ''}
									</p>
								</div>
								<time>{formatTime(event.timestamp)}</time>
							</div>{:else}<div class="empty-state">
								<Icon name="leaf" size={30} /><strong
									>{dashboard.loading
										? 'Connecting to your mower'
										: 'All quiet in the garden'}</strong
								>
								<p>
									{eventFilter === 'warnings'
										? 'No events with error codes in the recent activity.'
										: 'Mower events will appear here as they happen.'}
								</p>
							</div>{/each}
					</div>
					<div class="activity-footer">
						<span class="metric-dot"></span>Updates automatically · times in UTC
					</div>
				</article>
			</div>
			<section class="panel session-panel" id="sessions">
				<div class="panel-heading">
					<div>
						<p class="eyebrow">THE BIGGER PICTURE</p>
						<h2>Session history</h2>
					</div>
					<span class="history-caption">Latest 20 sessions · all runs</span>
				</div>
				<div class="table-scroll">
					<table>
						<thead
							><tr
								><th>Session</th><th>Started (UTC)</th><th>Duration</th><th>Area mowed</th><th
									>Anomalies</th
								><th>Status</th></tr
							></thead
						><tbody
							>{#each sessionRows as session (session.id)}<tr
									><td
										><button
											class="session-link"
											onclick={() => (expanded = expanded === session.id ? undefined : session.id)}
											aria-expanded={expanded === session.id}
											>#{session.session_id.toString().padStart(3, '0')}
											<span>{expanded === session.id ? '−' : '+'}</span></button
										></td
									><td
										>{new Date(session.start_time).toLocaleDateString('en-GB', {
											day: '2-digit',
											month: 'short',
											timeZone: 'UTC'
										})}<span class="table-time">{formatTime(session.start_time)}</span></td
									><td>{session.duration_min == null ? '—' : `${session.duration_min} min`}</td><td
										>{session.area_covered_m2 == null
											? '—'
											: `${session.area_covered_m2.toFixed(0)} m²`}</td
									><td>{session.anomaly_rows ?? '—'}</td><td
										><span class="table-status" class:failed={!!session.ended_with_error}
											>{session.ended_with_error
												? 'Ended with error'
												: session.end_time
													? 'Completed'
													: session.id === dashboard.session?.id ||
														  (session.session_id === dashboard.session?.session_id &&
																session.start_time === dashboard.session?.start_time)
														? dashboard.status.running
															? 'In progress'
															: 'Paused'
														: 'Incomplete'}</span
										></td
									></tr
								>{#if expanded === session.id}<tr class="session-detail"
										><td colspan="6"
											><strong>Session details</strong><span>Weather: {session.weather}</span><span
												>Bearing wear: {(session.bearing_wear * 100).toFixed(1)}%</span
											><span
												>End: {session.end_time
													? `${formatTime(session.end_time)} UTC`
													: 'Not completed'}</span
											>{#if session.ended_with_error}<span>Error: {session.ended_with_error}</span
												>{/if}</td
										></tr
									>{/if}{:else}<tr
									><td colspan="6" class="table-empty"
										>{dashboard.loading
											? 'Loading session history…'
											: 'Start a simulation to see your mowing sessions here.'}</td
									></tr
								>{/each}</tbody
						>
					</table>
				</div>
				<div class="table-footer">
					<span>Showing {sessionRows.length} of {dashboard.sessions.length} recent sessions</span
					>{#if dashboard.sessions.length > 5}<button
							class="text-button"
							onclick={() => (showAllSessions = !showAllSessions)}
							>{showAllSessions ? 'Show fewer' : 'Show all sessions'}<Icon
								name="arrow"
								size={14}
							/></button
						>{/if}
				</div>
			</section>
			<footer class="page-footer">
				<span><Icon name="leaf" size={14} />Made for a little more green.</span><span
					>Simulated telemetry · 10× speed · No sign-in required</span
				>
			</footer>
		</main>
	</div>
</div>
