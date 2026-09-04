import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma, type PrismaClient } from "@prisma/client";
import { getActiveTenantPrisma } from "@/lib/active-tenant-context";
import type { TenantOperation } from "@/lib/tenant-context";

const WRITE_METHODS = new Set([
    "create",
    "createMany",
    "createManyAndReturn",
    "delete",
    "deleteMany",
    "update",
    "updateMany",
    "updateManyAndReturn",
    "upsert",
]);

const MODEL_DELEGATES = new Set(
    Object.values(Prisma.ModelName).map((name) => `${name.charAt(0).toLowerCase()}${name.slice(1)}`),
);

type RoutedPrismaGlobals = {
    tenantPrismaScope?: AsyncLocalStorage<PrismaClient>;
};

const globalForRoutedPrisma = globalThis as typeof globalThis & RoutedPrismaGlobals;
const tenantPrismaScope = globalForRoutedPrisma.tenantPrismaScope
    || new AsyncLocalStorage<PrismaClient>();

globalForRoutedPrisma.tenantPrismaScope = tenantPrismaScope;

function isNoRequestContextError(error: unknown) {
    return error instanceof Error && (
        error.message.includes("outside a request scope")
        || error.message.includes("was called outside a request")
    );
}

async function selectPrisma(legacy: PrismaClient, operation: TenantOperation): Promise<PrismaClient> {
    const explicitTenantClient = tenantPrismaScope.getStore();
    if (explicitTenantClient) return explicitTenantClient;

    try {
        return await getActiveTenantPrisma(operation) || legacy;
    } catch (error) {
        // CLI jobs and build-time utilities have no Next.js request store and intentionally
        // continue to use DATABASE_URL. A scoped HTTP request never falls back on access errors.
        if (isNoRequestContextError(error)) return legacy;
        throw error;
    }
}

/**
 * Gives scheduled/background work an explicit tenant database without relying on browser
 * cookies or request headers. The async scope is isolated even when multiple tenants run in
 * the same server process.
 */
export function runWithTenantPrisma<T>(client: PrismaClient, operation: () => T): T {
    return tenantPrismaScope.run(client, operation);
}

class RoutedPrismaPromise<T> implements PromiseLike<T> {
    readonly [Symbol.toStringTag] = "PrismaPromise";

    constructor(
        private readonly legacy: PrismaClient,
        private readonly operation: TenantOperation,
        private readonly invoke: (client: PrismaClient) => PromiseLike<T>,
    ) {}

    runWith(client: PrismaClient): PromiseLike<T> {
        return this.invoke(client);
    }

    private async run(): Promise<T> {
        const client = await selectPrisma(this.legacy, this.operation);
        return this.invoke(client);
    }

    then<TResult1 = T, TResult2 = never>(
        onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
        return this.run().then(onfulfilled, onrejected);
    }

    catch<TResult = never>(
        onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
    ): Promise<T | TResult> {
        return this.run().catch(onrejected);
    }

    finally(onfinally?: (() => void) | null): Promise<T> {
        return this.run().finally(onfinally || undefined);
    }
}

function modelDelegate(
    legacy: PrismaClient,
    modelName: string,
) {
    return new Proxy({}, {
        get(_target, methodProperty) {
            if (typeof methodProperty !== "string") return undefined;
            const operation: TenantOperation = WRITE_METHODS.has(methodProperty) ? "write" : "read";
            return (...args: unknown[]) => new RoutedPrismaPromise(
                legacy,
                operation,
                (client) => {
                    const delegate = Reflect.get(client, modelName) as Record<string, (...values: unknown[]) => PromiseLike<unknown>>;
                    const method = Reflect.get(delegate, methodProperty);
                    if (typeof method !== "function") {
                        throw new Error(`Prisma no expone ${modelName}.${methodProperty}.`);
                    }
                    return method.apply(delegate, args);
                },
            );
        },
    });
}

/**
 * Keeps the established CRM data layer usable while selecting a validated tenant database for
 * requests carrying the internal scope headers injected by the Next.js proxy.
 */
export function createRoutedPrismaClient(legacy: PrismaClient): PrismaClient {
    const delegates = new Map<string, object>();

    return new Proxy(legacy, {
        get(target, property, receiver) {
            if (typeof property === "string" && MODEL_DELEGATES.has(property)) {
                let delegate = delegates.get(property);
                if (!delegate) {
                    delegate = modelDelegate(legacy, property);
                    delegates.set(property, delegate);
                }
                return delegate;
            }

            if (property === "$transaction") {
                return async (
                    input: unknown[] | ((transaction: unknown) => unknown),
                    options?: unknown,
                ) => {
                    const client = await selectPrisma(legacy, "write");
                    if (Array.isArray(input)) {
                        const operations = input.map((operation) => operation instanceof RoutedPrismaPromise
                            ? operation.runWith(client)
                            : operation);
                        return client.$transaction(operations as never, options as never);
                    }
                    return client.$transaction(input as never, options as never);
                };
            }

            if (property === "$queryRaw" || property === "$queryRawUnsafe") {
                return (...args: unknown[]) => new RoutedPrismaPromise(
                    legacy,
                    "read",
                    (client) => (Reflect.get(client, property) as (...values: unknown[]) => PromiseLike<unknown>).apply(client, args),
                );
            }

            if (property === "$executeRaw" || property === "$executeRawUnsafe") {
                return (...args: unknown[]) => new RoutedPrismaPromise(
                    legacy,
                    "write",
                    (client) => (Reflect.get(client, property) as (...values: unknown[]) => PromiseLike<unknown>).apply(client, args),
                );
            }

            return Reflect.get(target, property, receiver);
        },
    });
}
