import { getContacts } from "@/app/actions/contacts";
import { ContactsTable } from "@/components/contacts/contacts-table";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
    const contacts = await getContacts();

    return (
        <div className="h-full">
            <ContactsTable contacts={contacts} />
        </div>
    );
}
