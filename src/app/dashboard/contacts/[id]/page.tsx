import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { getContact } from "@/app/actions/contacts";
import { notFound } from "next/navigation";
import { AutoSaveInput } from "@/components/contacts/auto-save-input";
import { ContactTags } from "@/components/contacts/contact-tags";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { getContactFullName, getContactInitial } from "@/lib/contact-name";

export default async function ContactDetailsPage(props: { params: Promise<{ id: string }> }) {
    const params = await props.params;
    const contact = await getContact(params.id);

    if (!contact) {
        notFound();
    }

    // Extract tags from deals
    const dealTags = contact.deals?.flatMap(deal =>
        deal.dealTags.map(dt => ({
            name: dt.tag.name,
            color: dt.tag.color,
            dealTitle: deal.title
        }))
    ) || [];
    const fullName = getContactFullName(contact);

    return (
        <div className="flex flex-col h-full gap-4">
            {/* Header */}
            <div className="flex items-center gap-4 border-b pb-4">
                <Link href="/dashboard/contacts">
                    <Button variant="ghost" size="icon">
                        <ArrowLeft className="h-5 w-5 text-gray-500" />
                    </Button>
                </Link>
                <div>
                    <h1 className="text-2xl font-bold Tracking-tight text-gray-900">{fullName}</h1>
                    <p className="text-sm text-gray-500">
                        Creado el {format(new Date(contact.createdAt), "PPP", { locale: es })}
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-6 h-full overflow-hidden">
                {/* Left Column: Profile & Fields (Auto-save) */}
                <div className="md:col-span-4 lg:col-span-3 flex flex-col gap-6 overflow-y-auto pr-2">
                    <Card>
                        <CardContent className="pt-6 flex flex-col items-center text-center">
                            <Avatar className="h-24 w-24 mb-4 ring-2 ring-offset-2 ring-blue-100">
                                <AvatarImage
                                    src={contact.whatsappAvatarUrl || undefined}
                                    alt={fullName}
                                />
                                <AvatarFallback className="text-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white">
                                    {getContactInitial(contact)}
                                </AvatarFallback>
                            </Avatar>

                            <div className="mt-2 mb-6 flex w-full justify-center">
                                {contact.phone ? (
                                    <Link href={`/dashboard/inbox?contactId=${encodeURIComponent(contact.id)}`}>
                                        <Button
                                            size="icon"
                                            variant="outline"
                                            className="h-10 w-10 rounded-full border-primary/30 text-primary hover:bg-primary/10"
                                            title="Ir al chat"
                                        >
                                            <WhatsAppIcon className="h-5 w-5" />
                                        </Button>
                                    </Link>
                                ) : (
                                    <Button
                                        size="icon"
                                        variant="outline"
                                        disabled
                                        className="h-10 w-10 rounded-full"
                                        title="Este cliente no tiene teléfono"
                                    >
                                        <WhatsAppIcon className="h-5 w-5 text-muted-foreground" />
                                    </Button>
                                )}
                            </div>

                            <div className="w-full space-y-4 text-left">
                                <AutoSaveInput
                                    id={contact.id}
                                    field="name"
                                    label="Nombre"
                                    initialValue={contact.name || ""}
                                    className="font-medium"
                                />
                                <AutoSaveInput
                                    id={contact.id}
                                    field="phone"
                                    label="Teléfono"
                                    initialValue={contact.phone}
                                />
                            </div>
                        </CardContent>
                    </Card>

                    {/* Tags */}
                    <Card>
                        <CardContent className="pt-6">
                            <ContactTags
                                contactId={contact.id}
                                contactTags={contact.tags}
                                dealTags={dealTags}
                            />
                        </CardContent>
                    </Card>
                </div>

                {/* Right Column: Timeline / History */}
                <div className="md:col-span-8 lg:col-span-9 flex flex-col bg-gray-50 rounded-xl border p-6">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-lg font-semibold">Actividad del cliente</h2>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" className="h-8">Notas</Button>
                            <Button variant="outline" size="sm" className="h-8">Tareas</Button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-6 pr-4">
                        {/* Example Timeline Items */}
                        <div className="flex gap-4">
                            <div className="flex flex-col items-center">
                                <div className="h-2 w-2 bg-blue-500 rounded-full" />
                                <div className="w-px h-full bg-gray-200 my-1" />
                            </div>
                            <div className="pb-8">
                                <p className="text-sm font-medium">Cliente creado</p>
                                <p className="text-xs text-gray-500 mt-1">
                                    {format(new Date(contact.createdAt), "PP p", { locale: es })}
                                </p>
                            </div>
                        </div>

                        <div className="flex gap-4 opacity-50">
                            <div className="flex flex-col items-center">
                                <div className="h-2 w-2 bg-gray-300 rounded-full" />
                            </div>
                            <div>
                                <p className="text-sm text-gray-500">Inicio de la conversación</p>
                            </div>
                        </div>
                    </div>

                    {/* Note Input */}
                    <div className="mt-4 pt-4 border-t">
                        <div className="bg-white border rounded-lg p-2 shadow-sm">
                            <textarea
                                className="w-full text-sm resize-none focus:outline-none p-2 min-h-[80px]"
                                placeholder="Escribe una nota..."
                            />
                            <div className="flex justify-end pt-2">
                                <Button size="sm">Guardar Nota</Button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
