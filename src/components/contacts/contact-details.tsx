"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  MessageCircle,
} from "lucide-react";
import type { getContact } from "@/app/actions/contacts";
import { AutoSaveInput } from "./auto-save-input";
import { ContactTags } from "./contact-tags";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { getContactFullName, getContactInitial } from "@/lib/contact-name";
import {
  uniqueAppointments,
  getClientMetrics,
  serviceLabel,
} from "@/lib/contacts-view";
import {
  tenantDashboardPath,
  tenantSlugFromPath,
} from "@/lib/tenant-request-routing";
import {
  formatDateInOperationZone,
  formatTimeInOperationZone,
  getOperationDateKey,
} from "@/lib/operation-dates";
import { hasPermission, type AccessSubject } from "@/lib/permissions";
import styles from "./contacts.module.css";

type DetailContact = NonNullable<Awaited<ReturnType<typeof getContact>>>;
const statuses: Record<string, string> = {
  scheduled: "Agendada",
  reserved: "Apartada",
  confirmed: "Confirmada",
  completed: "Atendida",
  cancelled: "Cancelada",
  no_show: "No asistió",
  waiting: "En espera",
  in_progress: "En atención",
};

export function ContactDetails({
  contact,
  timeZone,
}: {
  contact: DetailContact;
  timeZone: string;
}) {
  const [section, setSection] = useState("profile");
  const pathname = usePathname();
  const slug = tenantSlugFromPath(pathname);
  const route = (path: string) =>
    slug ? tenantDashboardPath(slug, path) : path;
  const { data: session } = useSession();
  const canReadChats = hasPermission(
    session?.user as AccessSubject | undefined,
    "chats.manage",
  );
  const canReadCalendar = hasPermission(
    session?.user as AccessSubject | undefined,
    "calendar.manage",
  );
  const fullName = getContactFullName(contact);
  const metrics = getClientMetrics(contact);
  const appointments = uniqueAppointments(contact).sort(
    (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
  );
  const date = (value: Date | string) =>
    formatDateInOperationZone(value, undefined, timeZone, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  const dealTags = contact.deals.flatMap((deal) =>
    deal.dealTags.map(({ tag }) => ({
      name: tag.name,
      color: tag.color,
      dealTitle: deal.title,
    })),
  );
  const chatHref = route(
    `/dashboard/inbox?contactId=${encodeURIComponent(contact.id)}`,
  );
  return (
    <div className={styles.detail}>
      <header className={styles.detailHeader}>
        <Button
          asChild
          variant="outline"
          size="icon"
          className="shrink-0 rounded-xl"
        >
          <Link
            href={route("/dashboard/contacts")}
            aria-label="Volver a clientes"
          >
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div>
          <h1>{fullName}</h1>
          <p>Cliente desde {date(contact.createdAt)}</p>
        </div>
        {canReadChats ? (
          <Button
            asChild
            variant="outline"
            size="icon"
            className="shrink-0 rounded-xl"
          >
            <Link
              href={chatHref}
              aria-label={`Abrir conversación de ${fullName}`}
            >
              <MessageCircle className="size-4" />
            </Link>
          </Button>
        ) : null}
      </header>
      <nav className={styles.detailTabs} aria-label="Secciones de la ficha">
        {[
          ["profile", "Resumen"],
          ["appointments", "Citas"],
          ["activity", "Actividad"],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            aria-pressed={section === id}
            aria-controls={`client-${id}`}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className={styles.detailScroll}>
        <div className={styles.detailGrid}>
          <section
            id="client-profile"
            className={`${styles.section} ${styles.profile}`}
            data-active={section === "profile"}
            aria-label="Resumen del cliente"
          >
            <div className={styles.profileTop}>
              <Avatar className="size-14 shrink-0">
                <AvatarImage
                  src={contact.whatsappAvatarUrl || undefined}
                  alt=""
                />
                <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                  {getContactInitial(contact)}
                </AvatarFallback>
              </Avatar>
              <div>
                <strong>Datos de contacto</strong>
                <p>
                  {contact.sourceType === "meta"
                    ? "WhatsApp API oficial"
                    : "WhatsApp QR"}
                </p>
              </div>
            </div>
            <div className={styles.summary}>
              <div>
                <strong>{metrics.attendedCount}</strong>
                <span>Visitas completadas</span>
              </div>
              <div>
                <strong>{appointments.length}</strong>
                <span>Citas registradas</span>
              </div>
            </div>
            <div className={styles.fields}>
              <AutoSaveInput
                id={contact.id}
                field="name"
                label="Nombre"
                initialValue={contact.name}
              />
              <AutoSaveInput
                id={contact.id}
                field="phone"
                label="Teléfono"
                initialValue={contact.phone}
              />
            </div>
            <ContactTags
              contactId={contact.id}
              contactTags={contact.tags}
              dealTags={dealTags}
            />
            <dl className={styles.profileMeta}>
              <div>
                <dt>Última visita completada</dt>
                <dd>
                  {metrics.lastVisit
                    ? date(metrics.lastVisit.startTime)
                    : "Sin visitas todavía"}
                </dd>
              </div>
              <div>
                <dt>Servicio más frecuente</dt>
                <dd>{metrics.favoriteService}</dd>
              </div>
              {contact.email ? (
                <div>
                  <dt>Correo</dt>
                  <dd>{contact.email}</dd>
                </div>
              ) : null}
              {contact.company ? (
                <div>
                  <dt>Empresa</dt>
                  <dd>{contact.company}</dd>
                </div>
              ) : null}
            </dl>
          </section>
          <section
            id="client-appointments"
            className={styles.section}
            data-active={section === "appointments"}
            aria-label="Citas del cliente"
          >
            <h2>
              Citas{" "}
              <span className="text-muted-foreground font-normal text-sm">
                · {appointments.length}
              </span>
            </h2>
            {appointments.length ? (
              <div className={styles.history}>
                {appointments.map((appointment) => {
                  const content = (
                    <>
                      <CalendarDays className="size-4 text-primary shrink-0" />
                      <div>
                        <strong>{serviceLabel(appointment)}</strong>
                        <p>
                          {date(appointment.startTime)} ·{" "}
                          {formatTimeInOperationZone(
                            appointment.startTime,
                            undefined,
                            timeZone,
                          )}
                        </p>
                        {appointment.notes ? (
                          <p className="whitespace-pre-wrap break-words">
                            {appointment.notes}
                          </p>
                        ) : null}
                      </div>
                      <span className={styles.status}>
                        {statuses[appointment.status] || appointment.status}
                      </span>
                      {canReadCalendar ? (
                        <ChevronRight className="size-4 shrink-0" />
                      ) : null}
                    </>
                  );
                  return canReadCalendar ? (
                    <Link
                      key={appointment.id}
                      className={styles.appointment}
                      href={route(
                        `/dashboard/calendar?date=${getOperationDateKey(appointment.startTime, timeZone)}&appointmentId=${encodeURIComponent(appointment.id)}`,
                      )}
                      aria-label={`Ver cita: ${serviceLabel(appointment)}, ${date(appointment.startTime)}`}
                    >
                      {content}
                    </Link>
                  ) : (
                    <article
                      key={appointment.id}
                      className={styles.appointment}
                    >
                      {content}
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className={styles.empty}>
                Este cliente todavía no tiene citas registradas.
              </p>
            )}
          </section>
          <section
            id="client-activity"
            className={styles.section}
            data-active={section === "activity"}
            aria-label="Actividad del cliente"
          >
            <h2>Actividad</h2>
            {contact.conversations.map((conversation) => (
              <div className={styles.event} key={conversation.id}>
                <strong>
                  Conversación · {conversation._count.messages} mensaje
                  {conversation._count.messages === 1 ? "" : "s"}
                </strong>
                <p>Actualizada el {date(conversation.updatedAt)}</p>
                {canReadChats ? (
                  <Link
                    className="inline-flex items-center gap-1 text-sm text-primary mt-2"
                    href={chatHref}
                  >
                    Ver conversación
                    <ChevronRight className="size-3" />
                  </Link>
                ) : null}
              </div>
            ))}
            <div className={styles.event}>
              <strong>Cliente registrado</strong>
              <p>{date(contact.createdAt)}</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
