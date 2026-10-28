<script lang="ts">
	import { zonePosition, type Zone, type Reading } from '#lib/dashboard/data.ts';
	type MapZone = Pick<Zone, 'zone_id' | 'area_m2'> & {
		coverage_pct: number | null;
		observed_at?: string | null;
	};
	let { zones, reading }: { zones: MapZone[]; reading?: Reading } = $props();
	let selected = $state<number | null>(null);
	let detail = $derived(zones.find((z) => z.zone_id === (selected ?? reading?.zone_id)));
</script>

<article class="panel map-panel" id="zones">
	<div class="panel-heading">
		<div>
			<p class="eyebrow">MOWING AREA</p>
			<h2>Is every corner cut?</h2>
		</div>
		<span class="subtle-badge">{zones.length} zones</span>
	</div>
	<div class="map-surface">
		<div class="map-compass" aria-hidden="true">N<br />↑</div>
		<div class="zone-grid" aria-label="Mowing zones">
			{#each zones as zone (zone.zone_id)}
				{@const pos = zonePosition(zone.zone_id)}
				<button
					class="zone"
					class:current={reading?.zone_id === zone.zone_id}
					class:selected={selected === zone.zone_id}
					style:grid-column={pos.x + 1}
					style:grid-row={pos.y + 1}
					style:--coverage={`${Math.max(0.12, (zone.coverage_pct ?? 0) / 100)}`}
					class:unknown={zone.coverage_pct === null}
					onclick={() => (selected = zone.zone_id)}
					aria-label={`Zone ${zone.zone_id}, ${zone.coverage_pct === null ? 'coverage unknown' : zone.coverage_pct.toFixed(1) + ' percent estimated coverage'}${reading?.zone_id === zone.zone_id ? ', mower here' : ''}`}
					aria-pressed={selected === zone.zone_id}
				>
					<span>{zone.zone_id.toString().padStart(2, '0')}</span
					>{#if reading?.zone_id === zone.zone_id}<i aria-hidden="true">●</i>{/if}
				</button>
			{/each}
		</div>
		{#if !zones.length}<p class="map-empty">
				No zone definitions have been received for this property.
			</p>{/if}
		<span class="dock"><span aria-hidden="true">⌂</span> Charging dock</span>
	</div>
	<div class="map-legend">
		<span><i class="legend-active"></i>Mower location</span><span
			><i class="legend-covered"></i>Estimated coverage</span
		><span><i class="legend-unknown"></i>Unknown</span><span>Illustrative zone layout</span>
	</div>
	{#if detail}<div class="zone-detail">
			<strong>Zone {detail.zone_id.toString().padStart(2, '0')}</strong><span
				>{detail.coverage_pct === null
					? 'Coverage unknown'
					: detail.coverage_pct.toFixed(1) + '% estimated coverage'}</span
			><span>{detail.area_m2} m²</span><span
				>{detail.observed_at
					? 'Captured ' +
						new Date(detail.observed_at).toLocaleString('en-GB', { timeZone: 'UTC' }) +
						' UTC'
					: 'No observation in this cycle'}</span
			>
		</div>{/if}
</article>

<style>
	.map-surface {
		background: #f1f5ed;
		background-image: radial-gradient(#cbd7c6 0.7px, transparent 0.7px);
		background-size: 12px 12px;
		border: 1px solid #e0e7dc;
		border-radius: 12px;
		min-height: 400px;
		margin-top: 22px;
		position: relative;
		display: flex;
		align-items: center;
		padding: 40px 25px;
	}
	.zone-grid {
		display: grid;
		grid-template-columns: repeat(10, minmax(0, 1fr));
		gap: 5px;
		width: 100%;
		transform: skewY(-2deg);
		padding: 8px 0;
	}
	.zone {
		border: 1px solid #b8ceb4;
		border-radius: 5px;
		background: color-mix(in srgb, #438550 calc(var(--coverage) * 100%), #e6efdf);
		height: 43px;
		font-size: 10px;
		color: #41613f;
		cursor: pointer;
		position: relative;
		transition:
			background 0.2s,
			transform 0.2s;
		padding: 3px;
		min-width: 0;
	}
	.zone.unknown {
		background: repeating-linear-gradient(135deg, #edf0e8, #edf0e8 5px, #dce2d7 5px, #dce2d7 6px);
		color: #54614f;
	}
	.zone:hover,
	.zone.selected {
		outline: 2px solid #598156;
		outline-offset: 1px;
		transform: translateY(-3px);
	}
	.zone.current {
		background: #275d3d;
		color: #fff;
		border-color: #174328;
		box-shadow: 0 4px 9px #2f5d382f;
	}
	.zone i {
		display: block;
		font-size: 13px;
		font-style: normal;
	}
	.map-compass {
		position: absolute;
		right: 16px;
		top: 14px;
		text-align: center;
		font-size: 10px;
		color: #798875;
	}
	.dock {
		position: absolute;
		bottom: 15px;
		left: 20px;
		font-size: 10px;
		color: #647260;
	}
	.dock > span {
		font-size: 18px;
		padding-right: 5px;
	}
	.map-legend {
		display: flex;
		gap: 15px;
		flex-wrap: wrap;
		font-size: 10px;
		color: var(--muted);
		margin-top: 17px;
	}
	.map-legend > span:last-child {
		margin-left: auto;
	}
	.map-legend i {
		width: 8px;
		height: 8px;
		display: inline-block;
		margin-right: 5px;
		border-radius: 2px;
	}
	.legend-unknown {
		background: repeating-linear-gradient(135deg, #edf0e8, #edf0e8 2px, #9ba994 2px, #9ba994 3px);
	}
	.legend-active {
		background: #275d3d;
	}
	.legend-covered {
		background: #a9c79d;
	}
	.zone-detail {
		display: flex;
		gap: 14px;
		flex-wrap: wrap;
		margin-top: 15px;
		border-top: 1px solid var(--border);
		padding-top: 14px;
		font-size: 11px;
		color: var(--muted);
	}
	.zone-detail strong {
		color: var(--ink);
	}
	.map-empty {
		position: absolute;
		inset: 40px;
		display: grid;
		place-items: center;
		text-align: center;
		color: var(--muted);
		font-size: 13px;
	}
	@media (max-width: 480px) {
		.map-surface {
			padding: 40px 12px;
			min-height: 235px;
		}
		.zone-grid {
			gap: 3px;
		}
		.zone {
			height: 37px;
			font-size: 8px;
		}
		.map-legend > span:last-child {
			margin-left: 0;
		}
	}
</style>
