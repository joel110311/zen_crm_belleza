/** A new paid month starts after any remaining trial or previously granted paid period. */
export function paidPeriodStart(paidAt: Date, existingEnds: Array<Date | null | undefined>): Date {
    return existingEnds.reduce<Date>((latest, end) => end && end > latest ? end : latest, paidAt);
}
