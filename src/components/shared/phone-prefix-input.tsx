"use client";

import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    composePhoneNumber,
    getOperationCountry,
    getOrderedPhoneCountries,
    parsePhoneByCountry,
    type OperationCountry,
} from "@/lib/operation-context";
import { cn } from "@/lib/utils";

type PhonePrefixInputProps = {
    value: string;
    onChange: (value: string) => void;
    defaultCountry?: string | null;
    placeholder?: string;
    disabled?: boolean;
    required?: boolean;
    className?: string;
    inputClassName?: string;
};

export function PhonePrefixInput({
    value,
    onChange,
    defaultCountry,
    placeholder = "Telefono",
    disabled,
    required,
    className,
    inputClassName,
}: PhonePrefixInputProps) {
    const [resolvedDefaultCountry, setResolvedDefaultCountry] = useState(defaultCountry || "MX");
    const [selectedCountry, setSelectedCountry] = useState(() => getOperationCountry(defaultCountry || "MX").code);
    const [localNumber, setLocalNumber] = useState("");

    useEffect(() => {
        if (defaultCountry) {
            setResolvedDefaultCountry(defaultCountry);
            return;
        }

        let active = true;
        fetch("/api/operation-context", { cache: "no-store" })
            .then(async (response) => (response.ok ? response.json() : null))
            .then((context) => {
                if (!active || !context?.phoneDefaultCountry) return;
                setResolvedDefaultCountry(context.phoneDefaultCountry);
            })
            .catch(() => undefined);

        return () => {
            active = false;
        };
    }, [defaultCountry]);

    useEffect(() => {
        const parsed = parsePhoneByCountry(value, resolvedDefaultCountry);
        setSelectedCountry(parsed.country.code);
        setLocalNumber(parsed.nationalNumber);
    }, [resolvedDefaultCountry, value]);

    const orderedCountries = useMemo(
        () => getOrderedPhoneCountries(selectedCountry || resolvedDefaultCountry),
        [resolvedDefaultCountry, selectedCountry],
    );

    const activeCountry = getOperationCountry(selectedCountry);

    const emitChange = (country: OperationCountry, nextLocalNumber: string) => {
        setSelectedCountry(country.code);
        setLocalNumber(nextLocalNumber);
        onChange(composePhoneNumber(country.code, nextLocalNumber));
    };

    return (
        <div
            className={cn(
                "flex h-11 w-full overflow-hidden rounded-xl border bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
                disabled && "cursor-not-allowed opacity-50",
                className,
            )}
        >
            <Select
                value={selectedCountry}
                onValueChange={(countryCode) => emitChange(getOperationCountry(countryCode), localNumber)}
                disabled={disabled}
            >
                <SelectTrigger className="h-full w-[104px] shrink-0 rounded-none border-0 border-r bg-transparent px-3 shadow-none focus:ring-0 focus:ring-offset-0">
                    <SelectValue>
                        {activeCountry.code} {activeCountry.callingCode}
                    </SelectValue>
                </SelectTrigger>
                <SelectContent className="max-h-72">
                    {orderedCountries.map((country) => (
                        <SelectItem key={country.code} value={country.code}>
                            {country.code} {country.name} {country.callingCode}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <Input
                value={localNumber}
                onChange={(event) => emitChange(activeCountry, event.target.value)}
                placeholder={placeholder}
                disabled={disabled}
                required={required}
                inputMode="tel"
                autoComplete="tel-national"
                className={cn("h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-3 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0", inputClassName)}
            />
        </div>
    );
}
