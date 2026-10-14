import { getContact } from "@/app/actions/contacts";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";
import { normalizeBusinessHours } from "@/lib/calendar/business-hours";
import { ContactDetails } from "@/components/contacts/contact-details";
import { notFound } from "next/navigation";
export default async function ContactDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const contact = await getContact(id);
  if (!contact) notFound();
  const settings = await getSystemSettingsOrDefaults();
  return (
    <ContactDetails
      contact={contact}
      timeZone={normalizeBusinessHours(settings).timeZone}
    />
  );
}
