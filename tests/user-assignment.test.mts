import assert from "node:assert/strict";
import test from "node:test";

import { resolveAssignableTenantUserId, type TenantUserLookupClient } from "../src/lib/user-assignment.ts";

test("returns null when rawUserId is null, undefined or empty", async () => {
    assert.equal(await resolveAssignableTenantUserId(null), null);
    assert.equal(await resolveAssignableTenantUserId(undefined), null);
    assert.equal(await resolveAssignableTenantUserId(""), null);
    assert.equal(await resolveAssignableTenantUserId("   "), null);
});

test("returns direct tenant user id when matching by id", async () => {
    const mockDb: TenantUserLookupClient = {
        user: {
            findUnique: async ({ where }) => {
                if (where.id === "tenant-user-1") {
                    return { id: "tenant-user-1", controlUserId: "global-user-1" };
                }
                return null;
            },
            findFirst: async () => null,
        },
    };

    const resolved = await resolveAssignableTenantUserId("tenant-user-1", mockDb);
    assert.equal(resolved, "tenant-user-1");
});

test("returns tenant user id when matching by controlUserId", async () => {
    const mockDb: TenantUserLookupClient = {
        user: {
            findUnique: async () => null,
            findFirst: async ({ where }) => {
                if (where.controlUserId === "global-user-99") {
                    return { id: "tenant-user-linked", controlUserId: "global-user-99" };
                }
                return null;
            },
        },
    };

    const resolved = await resolveAssignableTenantUserId("global-user-99", mockDb);
    assert.equal(resolved, "tenant-user-linked");
});

test("returns tenant user id when matching fallback by email", async () => {
    const mockDb: TenantUserLookupClient = {
        user: {
            findUnique: async ({ where }) => {
                if (where.email === "joel@example.com") {
                    return { id: "tenant-user-email", email: "joel@example.com" };
                }
                return null;
            },
            findFirst: async () => null,
        },
    };

    const resolved = await resolveAssignableTenantUserId("joel@example.com", mockDb);
    assert.equal(resolved, "tenant-user-email");
});

test("returns null gracefully when user is not found or db throws error", async () => {
    const mockDbNotFound: TenantUserLookupClient = {
        user: {
            findUnique: async () => null,
            findFirst: async () => null,
        },
    };

    const notFound = await resolveAssignableTenantUserId("unknown-id", mockDbNotFound);
    assert.equal(notFound, null);

    const mockDbError: TenantUserLookupClient = {
        user: {
            findUnique: async () => {
                throw new Error("DB connection error");
            },
            findFirst: async () => null,
        },
    };

    const errorResult = await resolveAssignableTenantUserId("crash-id", mockDbError);
    assert.equal(errorResult, null);
});
