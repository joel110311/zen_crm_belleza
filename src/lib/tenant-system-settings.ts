import "server-only";
import type { PrismaClient } from "@prisma/client";
import {
    withSettingsDefaults,
    type AppSystemSettings,
} from "@/lib/system-settings-defaults";

/** Reads settings from the resolved tenant database, never from DATABASE_URL. */
export async function getTenantSystemSettingsOrDefaults(
    tenantDb: PrismaClient,
): Promise<AppSystemSettings> {
    return withSettingsDefaults(await tenantDb.systemSettings.findFirst());
}
