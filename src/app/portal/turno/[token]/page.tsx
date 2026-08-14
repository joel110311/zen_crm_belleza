import { notFound } from "next/navigation";
import { getAppointmentByPublicToken } from "@/app/actions/calendar";
import { AppointmentConfirmation } from "@/components/portal/appointment-confirmation";

export const dynamic = "force-dynamic";

export default async function PortalAppointmentPage({
    params,
}: {
    params: Promise<{ token: string }>;
}) {
    const { token } = await params;
    const appointment = await getAppointmentByPublicToken(token);

    if (!appointment) {
        notFound();
    }

    return <AppointmentConfirmation token={token} appointment={appointment} />;
}
