/** Compare serializable inbox snapshots, including normalized Date values. */
export function sameInboxSnapshot(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) return true;
    if (left instanceof Date && right instanceof Date) return Object.is(left.getTime(), right.getTime());
    if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
    if (Array.isArray(left) !== Array.isArray(right)) return false;
    const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) =>
        Object.hasOwn(b, key) && sameInboxSnapshot(a[key], b[key]),
    );
}

export function mergeInboxSnapshots<T extends { id: string }>(
    existing: T[], incoming: T[], sortTime: (entry: T) => number, maximum: number,
): T[] {
    const byId = new Map(existing.map((entry) => [entry.id, entry]));
    for (const entry of incoming) {
        const previous = byId.get(entry.id);
        if (!previous || !sameInboxSnapshot(previous, entry)) byId.set(entry.id, entry);
    }
    const merged = [...byId.values()].sort((a, b) => sortTime(b) - sortTime(a)).slice(0, maximum);
    return merged.length === existing.length && merged.every((entry, index) => entry === existing[index]) ? existing : merged;
}
