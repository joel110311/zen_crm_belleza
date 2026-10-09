export const PLAN_CHANGE_CONSENT_VERSION = "monthly-plan-change-v1";

/** Integer-cent arithmetic over the actual paid calendar period, not an assumed 30-day month. */
export function proratedUpgradeCents(from: number, to: number, start: Date, end: Date, now: Date) {
    if (![from, to].every(value => Number.isSafeInteger(value) && value > 0) || to <= from
        || ![start, end, now].every(value => Number.isFinite(value.getTime())) || now < start || now >= end || end <= start) throw new Error("Periodo o importes no válidos para mejorar el plan.");
    const duration = BigInt(end.getTime() - start.getTime());
    const numerator = BigInt(to - from) * BigInt(end.getTime() - now.getTime());
    return Number((numerator + duration / BigInt(2)) / duration);
}
