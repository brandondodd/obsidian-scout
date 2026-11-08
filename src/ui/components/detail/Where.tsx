import React, { useState } from "react";
import type { Availability, ServiceTile } from "../../../core/detail/types";
import { regionName } from "../../../core/region";
import { initials, openUrl, Section } from "./bits";
import { WhereSkeleton } from "./Skeleton";

/**
 * A service's logo, or its initials where the source has no artwork.
 *
 * TMDB and AniList supply real logos. Open Library, Apple, and IGDB's stores do
 * not, and a monogram is honest about that.
 */
export function ServiceLogo({
	tile,
}: {
	tile: ServiceTile;
}): React.ReactElement {
	const [failed, setFailed] = useState(false);
	if (tile.logoUrl && !failed) {
		return (
			<img
				className={`sd-logo${tile.logoBackground ? " sd-logo-pad" : ""}`}
				src={tile.logoUrl}
				alt=""
				style={
					tile.logoBackground
						? { background: tile.logoBackground }
						: undefined
				}
				onError={() => setFailed(true)}
			/>
		);
	}
	return (
		<span className="sd-logo sd-mono" aria-hidden="true">
			{initials(tile.name)}
		</span>
	);
}

function Tile({ tile }: { tile: ServiceTile }): React.ReactElement {
	const body = (
		<>
			<ServiceLogo tile={tile} />
			<span>
				{tile.name}
				{tile.price && <small>{tile.price}</small>}
			</span>
		</>
	);
	return tile.url ? (
		<button
			className="sd-tile"
			onClick={() => tile.url && openUrl(tile.url)}
		>
			{body}
		</button>
	) : (
		<span className="sd-tile">{body}</span>
	);
}

/**
 * Where to watch, read, play, or listen.
 *
 * "via JustWatch" is not decoration: TMDB's terms require that credit wherever
 * its watch-provider data appears, so it stays on film and TV.
 */
export function Where({
	availability,
	region,
	loading,
}: {
	availability: Availability | undefined;
	region: string;
	loading: boolean;
}): React.ReactElement | null {
	if (loading && !availability) return <WhereSkeleton />;
	const groups =
		availability?.groups.filter((one) => one.tiles.length > 0) ?? [];
	if (!availability || groups.length === 0) return null;
	const { link, justWatch, regional, title } = availability;

	return (
		<Section
			id="where"
			title={title}
			link={justWatch || regional ? regionName(region) : undefined}
			onLink={link ? () => openUrl(link) : undefined}
		>
			<div className="sd-wtw">
				{groups.map((group) => (
					<div key={group.id}>
						<span className="sd-wlab">{group.label}</span>
						<div className="sd-tiles">
							{group.tiles.map((tile, at) => (
								<Tile key={`${tile.name}:${at}`} tile={tile} />
							))}
						</div>
					</div>
				))}
				{justWatch && <span className="sd-wcred">via JustWatch</span>}
			</div>
		</Section>
	);
}
