"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    buildOperationContext,
    buildOperationPhoneExample,
    formatPhoneForDisplay,
    normalizePhoneForOperation,
} from "@/lib/operation-context";

export type ClientOperationContext = ReturnType<typeof buildOperationContext>;

const FALLBACK_OPERATION_CONTEXT = buildOperationContext();

export function useOperationContext() {
    const [context, setContext] = useState<ClientOperationContext>(FALLBACK_OPERATION_CONTEXT);

    useEffect(() => {
        let active = true;
        fetch("/api/operation-context", { cache: "no-store" })
            .then(async (response) => (response.ok ? response.json() : null))
            .then((payload) => {
                if (!active || !payload) return;
                setContext({
                    ...FALLBACK_OPERATION_CONTEXT,
                    ...payload,
                    currencies: Array.isArray(payload.currencies) && payload.currencies.length > 0
                        ? payload.currencies
                        : FALLBACK_OPERATION_CONTEXT.currencies,
                    countries: Array.isArray(payload.countries) && payload.countries.length > 0
                        ? payload.countries
                        : FALLBACK_OPERATION_CONTEXT.countries,
                });
            })
            .catch(() => undefined);

        return () => {
            active = false;
        };
    }, []);

    const formatMoney = useCallback(
        (amount?: number | null, currency = context.defaultCurrency, options?: Intl.NumberFormatOptions) =>
            new Intl.NumberFormat(context.locale, {
                style: "currency",
                currency,
                maximumFractionDigits: 2,
                ...options,
            }).format(amount || 0),
        [context.defaultCurrency, context.locale],
    );

    const formatPhone = useCallback(
        (value?: string | null) => formatPhoneForDisplay(value, context.phoneDefaultCountry),
        [context.phoneDefaultCountry],
    );

    const normalizePhone = useCallback(
        (value?: string | null) => normalizePhoneForOperation(value, context.phoneDefaultCountry),
        [context.phoneDefaultCountry],
    );

    return useMemo(
        () => ({
            ...context,
            phoneExample: buildOperationPhoneExample(context.phoneDefaultCountry),
            formatMoney,
            formatPhone,
            normalizePhone,
        }),
        [context, formatMoney, formatPhone, normalizePhone],
    );
}
