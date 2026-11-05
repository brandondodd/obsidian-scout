import { ALL_MEDIA_KINDS, type MediaKind } from "../../types";
import type { SectionContext } from "./types";

type KindsContext = Pick<SectionContext, "settings" | "registry">;

/** Kinds offered by an enabled source, in the order sources are registered. */
export function enabledSourceKinds({ settings, registry }: KindsContext): MediaKind[] {
	return [
		...new Set(
			registry
				.all()
				.filter((p) => settings.isProviderEnabled(p.id))
				.flatMap((p) => p.kinds),
		),
	];
}

/**
 * Kinds worth a settings row: offered by an enabled source, or already on a
 * note in the library. Keeps per-kind lists short in a vault that only tracks
 * films and books.
 */
export function kindsInUse(ctx: KindsContext & Pick<SectionContext, "library">): MediaKind[] {
	const used = new Set<MediaKind>(enabledSourceKinds(ctx));
	for (const entry of ctx.library.all()) used.add(entry.kind);
	return ALL_MEDIA_KINDS.filter((kind) => used.has(kind));
}
