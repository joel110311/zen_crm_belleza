/** Calendar months in the business timezone, including month-end clamping. */
export function addBusinessMonths(value, months, timeZone = "America/Mexico_City") {
    const date = new Date(value);
    const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    const parts = (instant) => Object.fromEntries(formatter.formatToParts(instant).filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)]));
    const source = parts(date);
    const month = new Date(Date.UTC(source.year, source.month - 1 + months, 1));
    const day = Math.min(source.day, new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate());
    const target = Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), day, source.hour, source.minute, source.second, date.getUTCMilliseconds());
    let guess = target;
    let previousGuess;
    for (let i = 0; i < 4; i++) {
        const shown = parts(new Date(guess));
        const rendered = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute, shown.second, date.getUTCMilliseconds());
        const difference = target - rendered;
        if (!difference) break;
        const next = guess + difference;
        // A local wall time may not exist when clocks jump forward. Move to the later
        // instant rather than deleting an hour before the intended local deadline.
        if (next === previousGuess) return new Date(Math.max(guess, next));
        previousGuess = guess;
        guess = next;
    }
    return new Date(guess);
}

function validDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * @param {{status?: string, accessMode?: string, billingStatus?: string, timeZone?: string, trial?: {status: string, endsAt: Date|string}|null, subscriptions?: Array<{status: string, currentPeriodEndsAt?: Date|string|null, pastDueAt?: Date|string|null}>}} tenant
 * @param {Date} now
 */
export function workspaceBillingState(tenant, now = new Date()) {
    const originalMode = tenant.accessMode || "BILLING_ONLY";
    if (tenant.status !== "READY" || originalMode === "SUSPENDED") return { accessMode: originalMode, notice: null };
    const periods = (tenant.subscriptions || []).filter(item => ["ACTIVE", "TRIALING", "PAST_DUE", "UNPAID", "CANCELED", "PAUSED"].includes(item.status));
    const paidEnds = periods.map(item => {
        const end = validDate(item.currentPeriodEndsAt);
        const overdue = ["PAST_DUE", "UNPAID"].includes(item.status) ? validDate(item.pastDueAt) : null;
        // Stripe may report an unpaid future billing period. It must not buy access.
        return overdue && (!end || overdue < end) ? overdue : end;
    }).filter(Boolean);
    const indefinite = periods.some(item => ["ACTIVE", "TRIALING"].includes(item.status) && !item.currentPeriodEndsAt);
    const trialEnd = tenant.trial && validDate(tenant.trial.endsAt);
    const liveTrial = trialEnd && ["ACTIVE", "ENDING"].includes(tenant.trial.status) && trialEnd > now;
    if (indefinite || liveTrial || paidEnds.some(end => end > now)) return { accessMode: "FULL", notice: null };
    const ends = [...paidEnds, ...(trialEnd ? [trialEnd] : [])];
    if (!ends.length) return { accessMode: originalMode, notice: null };
    const expiredAt = new Date(Math.max(...ends.map(end => end.getTime())));
    if (expiredAt > now) return { accessMode: originalMode, notice: null };
    const timeZone = tenant.timeZone || "America/Mexico_City";
    const warningAt = addBusinessMonths(expiredAt, 1, timeZone);
    const deletionAt = addBusinessMonths(expiredAt, 3, timeZone);
    return {
        accessMode: now >= deletionAt ? "BILLING_ONLY" : "READ_ONLY",
        notice: {
            expiredAt: expiredAt.toISOString(), warningAt: warningAt.toISOString(), deletionAt: deletionAt.toISOString(), timeZone,
            source: paidEnds.length ? "subscription" : "trial",
            phase: now >= deletionAt ? "DELETION_DUE" : now >= warningAt ? "RETENTION_WARNING" : "EXPIRED",
        },
    };
}
