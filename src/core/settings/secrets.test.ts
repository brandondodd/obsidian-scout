import { describe, expect, it } from "vitest";
import { adoptPlainSecrets, secretId, type SecretStore } from "./secrets";
import type { SettingDescriptor, SettingsScope } from "./types";

function fakeScope(initial: Record<string, unknown>) {
	const bucket = { ...initial };
	const scope: SettingsScope = {
		get: <T>(key: string, fallback: T) =>
			(bucket[key] === undefined ? fallback : bucket[key]) as T,
		set: async (key, value) => {
			if (value === undefined) delete bucket[key];
			else bucket[key] = value;
		},
		secret: () => "",
	};
	return { scope, bucket };
}

function fakeStore(): SecretStore & { values: Record<string, string> } {
	const values: Record<string, string> = {};
	return {
		values,
		getSecret: (id) => values[id] ?? null,
		setSecret: (id, value) => {
			values[id] = value;
		},
	};
}

const SCHEMA: SettingDescriptor[] = [
	{ type: "secret", key: "accessTokenSecret", legacyKey: "accessToken", name: "Token" },
];

describe("adoptPlainSecrets", () => {
	const id = secretId("tmdb", "accessTokenSecret");

	it("copies a plain token into secret storage and keeps the plain copy", async () => {
		const { scope, bucket } = fakeScope({ accessToken: " abc.def " });
		const store = fakeStore();
		await adoptPlainSecrets(store, "tmdb", scope, SCHEMA);

		expect(id).toBe("scout-tmdb-accesstokensecret");
		expect(store.values[id]).toBe("abc.def");
		expect(bucket).toEqual({ accessToken: " abc.def ", accessTokenSecret: id });
	});

	it("fills a second device's empty store from the synced plain copy", async () => {
		const { scope } = fakeScope({ accessToken: "abc", accessTokenSecret: id });
		const store = fakeStore();
		await adoptPlainSecrets(store, "tmdb", scope, SCHEMA);
		expect(store.values[id]).toBe("abc");
	});

	it("never overwrites a secret that is already stored", async () => {
		const { scope } = fakeScope({ accessToken: "old", accessTokenSecret: "mine" });
		const store = fakeStore();
		store.values.mine = "new";
		await adoptPlainSecrets(store, "tmdb", scope, SCHEMA);
		expect(store.values).toEqual({ mine: "new" });
	});

	it("keeps everything as it was when secret storage refuses", async () => {
		const { scope, bucket } = fakeScope({ accessToken: "abc" });
		const store = fakeStore();
		store.setSecret = () => {
			throw new Error("nope");
		};
		const warn = console.warn;
		console.warn = () => {};
		await adoptPlainSecrets(store, "tmdb", scope, SCHEMA);
		console.warn = warn;
		expect(bucket).toEqual({ accessToken: "abc" });
	});

	it("does nothing without secret storage", async () => {
		const { scope, bucket } = fakeScope({ accessToken: "abc" });
		await adoptPlainSecrets(undefined, "tmdb", scope, SCHEMA);
		expect(bucket).toEqual({ accessToken: "abc" });
	});
});
