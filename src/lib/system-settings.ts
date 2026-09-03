import { prisma } from "@/lib/db";
import {
    withSettingsDefaults,
    type AppSystemSettings,
} from "@/lib/system-settings-defaults";

export {
    SYSTEM_SETTINGS_DEFAULTS,
    withSettingsDefaults,
    type AppSystemSettings,
} from "@/lib/system-settings-defaults";

export async function getSystemSettingsOrDefaults(): Promise<AppSystemSettings> {
    return withSettingsDefaults(await prisma.systemSettings.findFirst());
}
