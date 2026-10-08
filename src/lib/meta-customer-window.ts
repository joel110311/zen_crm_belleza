/** Only a customer message opens the Cloud API service window. */
export function metaCustomerWindowExpiry(occurredAt?: Date, now = Date.now()) {
    const timestamp = occurredAt?.getTime();
    return new Date(Math.min(timestamp !== undefined && Number.isFinite(timestamp) ? timestamp : now, now) + 24 * 60 * 60 * 1000);
}
