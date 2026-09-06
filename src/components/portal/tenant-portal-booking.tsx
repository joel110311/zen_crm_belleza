"use client";

import { PortalBooking } from "@/components/portal/portal-booking";
import type { PortalSocialLink } from "@/lib/portal-social-links";

export type TenantPortalData = {
    slug: string;
    clinicName: string;
    subtitle: string;
    intro: string;
    primaryColor: string;
    socialLinks?: PortalSocialLink[];
    logoUrl: string | null;
    logoScale: number;
    address: string | null;
    operationContext: { locale: string; timeZone: string; phoneDefaultCountry: string; callingCode: string };
    scheduleSummary: string;
    specialists: Array<{
        id: string;
        name: string;
        displayName: string | null;
        specialty: string | null;
        color: string | null;
        room: string | null;
        bio: string | null;
    }>;
    services: Array<{
        id: string;
        name: string;
        description: string | null;
        price: number;
        currency: string;
        durationMinutes: number;
        imageUrl: string | null;
        showPrice: boolean;
        specialists: Array<{ specialistId: string }>;
    }>;
};

export function TenantPortalBooking({ data }: { data: TenantPortalData }) {
    return (
        <PortalBooking
            mode="tenant"
            data={{
                ...data,
                enabled: true,
                remindersEnabled: false,
            }}
        />
    );
}
