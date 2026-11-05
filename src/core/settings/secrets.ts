import type { SecretStorage } from "obsidian";
import type { SettingDescriptor, SettingsScope } from "./types";

/** The parts of Obsidian's secret storage Scout uses. */
export type SecretStore = Pick<SecretStorage, "getSecret" | "setSecret">;

/** A secret's id: lowercase letters, digits, and dashes, as the store requires. */
export function secretId(providerId: string, key: string): string {
	return `scout-${providerId}-${key}`
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-");
}

/**
 * Copies credentials an older build kept in data.json into secret storage.
 *
 * Copies, never moves: secret storage is per device, and data.json may be
 * synced to a phone that has not stored the secret yet, so the plain value
 * stays as a fallback until you remove it yourself. Run on every load, so
 * each device fills its own store. An existing secret is never overwritten.
 */
export async function adoptPlainSecrets(
	store: SecretStore | undefined,
	providerId: string,
	scope: SettingsScope,
	descriptors: readonly SettingDescriptor[],
): Promise<void> {
	if (!store) return;
	for (const descriptor of descriptors) {
		if (descriptor.type !== "secret" || !descriptor.legacyKey) continue;
		const plain = scope.get<unknown>(descriptor.legacyKey, "");
		const value = typeof plain === "string" ? plain.trim() : "";
		if (!value) continue;

		const chosen = scope.get(descriptor.key, "");
		const id = chosen || secretId(providerId, descriptor.key);
		try {
			if (store.getSecret(id) === null) store.setSecret(id, value);
		} catch (err) {
			console.warn("Scout: could not copy a token into secret storage", err);
			continue;
		}
		if (!chosen) await scope.set(descriptor.key, id);
	}
}
