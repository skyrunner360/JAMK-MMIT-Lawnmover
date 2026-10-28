<script lang="ts">
	import { chartPoints, formatNumber, type Reading } from '#lib/dashboard/data.ts';
	let {
		rows,
		title,
		metric,
		unit,
		color = '#267554',
		maximum = 100
	}: {
		rows: Reading[];
		title: string;
		metric: 'battery_pct' | 'motor_current_a' | 'speed_mps';
		unit: string;
		color?: string;
		maximum?: number;
	} = $props();
	const id = $props.id();
	function captureTime(value: string | undefined) {
		return value
			? new Date(value).toLocaleString('en-GB', { timeZone: 'UTC' }) + ' UTC'
			: 'Unknown';
	}
	let max = $derived(Math.max(maximum, ...rows.map((r) => r[metric])));
	let points = $derived(chartPoints(rows, metric, 0, max));
	let latest = $derived(rows.at(-1)?.[metric]);
	let peak = $derived(rows.length ? Math.max(...rows.map((r) => r[metric])) : null);
</script>

<article class="panel chart-panel">
	<div class="panel-heading">
		<div>
			<p class="eyebrow">CAPTURED TELEMETRY</p>
			<h2>{title}</h2>
		</div>
		<span class="chart-value" style:color
			><small>Last captured value</small><br />{formatNumber(latest)} <small>{unit}</small></span
		>
	</div>
	<div class="chart-body">
		<div class="y-axis">
			<span>{formatNumber(max, 0)}</span><span>{formatNumber(max / 2, 0)}</span><span>0</span>
		</div>
		<div class="plot">
			<svg
				viewBox="0 0 100 100"
				preserveAspectRatio="none"
				role="img"
				aria-label={`${title}: latest ${formatNumber(latest)} ${unit}, peak ${formatNumber(peak)} ${unit}. ${rows.length} samples.`}
			>
				<defs
					><linearGradient {id} x1="0" y1="0" x2="0" y2="1"
						><stop offset="0%" stop-color={color} stop-opacity="0.18" /><stop
							offset="100%"
							stop-color={color}
							stop-opacity="0.01"
						/></linearGradient
					></defs
				>
				{#each [0, 25, 50, 75, 100] as y (y)}<line
						x1="0"
						x2="100"
						y1={y}
						y2={y}
						stroke="#e5eae5"
						stroke-dasharray="3 4"
						vector-effect="non-scaling-stroke"
					/>{/each}
				{#if rows.length > 1}<polygon
						points={`0,100 ${points} 100,100`}
						fill={`url(#${id})`}
					/><polyline
						{points}
						fill="none"
						stroke={color}
						stroke-width="2.5"
						stroke-linejoin="round"
						vector-effect="non-scaling-stroke"
					/>{/if}
			</svg>
			{#if rows.length < 2}<div class="chart-empty">
					{rows.length ? 'Collecting the next sample…' : 'No captured readings in this page'}
				</div>{/if}
			<div class="x-axis">
				<span>{captureTime(rows[0]?.timestamp)}</span><span>Capture time · UTC</span><span
					>{captureTime(rows.at(-1)?.timestamp)}</span
				>
			</div>
		</div>
	</div>
	<div class="chart-footer">
		<span><i style:background={color}></i>{title}</span><span
			>Peak <strong>{formatNumber(peak)} {unit}</strong></span
		>
	</div>
</article>

<style>
	.chart-value {
		font-size: 1.55rem;
		font-weight: 650;
		white-space: nowrap;
	}
	.chart-value small {
		font-size: 0.8rem;
		font-weight: 400;
		color: var(--muted);
	}
	.chart-body {
		display: flex;
		gap: 12px;
		height: 200px;
		margin-top: 25px;
	}
	.y-axis {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		padding-bottom: 28px;
		font-size: 11px;
		color: var(--muted);
		min-width: 25px;
		text-align: right;
	}
	.plot {
		position: relative;
		min-width: 0;
		flex: 1;
	}
	.plot svg {
		width: 100%;
		height: calc(100% - 28px);
		overflow: visible;
	}
	.x-axis {
		display: flex;
		justify-content: space-between;
		font-size: 10px;
		color: var(--muted);
		padding-top: 8px;
		gap: 4px;
	}
	.chart-empty {
		position: absolute;
		inset: 0 0 28px;
		display: grid;
		place-items: center;
		color: var(--muted);
		font-size: 13px;
	}
	.chart-footer {
		display: flex;
		justify-content: space-between;
		font-size: 11px;
		color: var(--muted);
		border-top: 1px solid var(--border);
		padding-top: 15px;
		margin-top: 14px;
	}
	.chart-footer strong {
		color: var(--ink);
		font-weight: 500;
	}
	.chart-footer i {
		display: inline-block;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		margin-right: 7px;
	}
	@media (max-width: 480px) {
		.x-axis span:nth-child(2) {
			display: none;
		}
		.chart-body {
			height: 170px;
		}
	}
</style>
