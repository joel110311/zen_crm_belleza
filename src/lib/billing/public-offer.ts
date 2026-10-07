import "server-only";
import { getControlDb } from "@/lib/control-db";
import type { LandingOffer } from "@/lib/landing-offer";

/** Public presentation fields only: never expose credentials, tenant data or provider IDs. */
export async function getPublicLandingOffer(): Promise<LandingOffer> {
    try {
        const db = getControlDb();
        const [policy, plans] = await Promise.all([
            db.trialPolicy.findFirst({ where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }], select: { trialDays: true } }),
            db.plan.findMany({ where: { isActive: true }, orderBy: { monthlyAmountCents: "asc" }, select: { slug: true, name: true, description: true, currency: true, monthlyAmountCents: true } }),
        ]);
        return { trialDays: policy?.trialDays ?? null, plans };
    } catch {
        // Keep the site reachable without advertising a price or trial we couldn't verify.
        console.warn("[Landing] Commercial catalog unavailable; omitting unverified prices and trial duration.");
        return { trialDays: null, plans: [] };
    }
}
