"use client";

import React, { useCallback, useMemo, useState } from "react";
import { Calendar, dateFnsLocalizer, EventProps, View, Views } from "react-big-calendar";
import withDragAndDrop from "react-big-calendar/lib/addons/dragAndDrop";
import { format, getDay, parse, startOfWeek } from "date-fns";
import { es } from "date-fns/locale";
import "react-big-calendar/lib/css/react-big-calendar.css";
import "react-big-calendar/lib/addons/dragAndDrop/styles.css";

import { updateAppointment } from "@/app/actions/calendar";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import {
    buildLocalTime,
    getCalendarVisibleRange,
    type BusinessHoursConfig,
} from "@/lib/calendar/business-hours";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
    formatDateTimeInOperationZone,
    getLocalCalendarDateKey,
    getOperationTodayKey,
    localWallDateToOperationUtc,
    operationDateReference,
    operationInstantToLocalWallDate,
} from "@/lib/operation-dates";

const locales = {
    es,
};

const localizer = dateFnsLocalizer({
    format,
    parse,
    startOfWeek,
    getDay,
    locales,
});

// @ts-ignore react-big-calendar's DnD wrapper has incomplete generic typing.
const DragAndDropCalendar = withDragAndDrop(Calendar);

interface CalendarEvent {
    id: string;
    title: string;
    start: Date;
    end: Date;
    notes?: string;
    resource?: {
        contact?: unknown;
        patient?: unknown;
        user?: unknown;
        status?: string;
        confirmationStatus?: string;
        visitMode?: string;
        meetLink?: string;
        paymentStatus?: string;
        googleCalendarColor?: string;
        googleCalendarName?: string;
        specialistName?: string;
        googleCalendarId?: string;
    };
}

interface BigCalendarProps {
    initialEvents: CalendarEvent[];
    initialDate?: Date;
    businessHours: BusinessHoursConfig;
    onSelectSlot: (slot: { start: Date; end: Date }) => void;
    onSelectEvent: (event: CalendarEvent) => void;
    onAppointmentTimeChange?: (appointmentId: string, start: Date, end: Date) => void;
    onMutationSettled?: () => Promise<void> | void;
}

function normalizeEvents(initialEvents: CalendarEvent[], timeZone: string) {
    return initialEvents.map((event) => ({
        ...event,
        start: operationInstantToLocalWallDate(event.start, timeZone),
        end: operationInstantToLocalWallDate(event.end, timeZone),
    }));
}

export function BigCalendar({
    initialEvents,
    initialDate,
    businessHours,
    onSelectSlot,
    onSelectEvent,
    onAppointmentTimeChange,
    onMutationSettled,
}: BigCalendarProps) {
    const [events, setEvents] = useState<CalendarEvent[]>(() => normalizeEvents(initialEvents, businessHours.timeZone));
    const [view, setView] = useState<View>(Views.WEEK);
    const [date, setDate] = useState(() => initialDate || new Date());
    const { toast } = useToast();

    React.useEffect(() => {
        setEvents(normalizeEvents(initialEvents, businessHours.timeZone));
    }, [businessHours.timeZone, initialEvents]);

    React.useEffect(() => {
        if (initialDate) setDate(initialDate);
    }, [initialDate]);

    const visibleRange = useMemo(
        () => getCalendarVisibleRange(
            businessHours,
            operationDateReference(getLocalCalendarDateKey(date), businessHours.timeZone),
            view === Views.DAY ? "day" : "week",
        ),
        [businessHours, date, view],
    );

    const { min, max } = useMemo(
        () => ({
            min: buildLocalTime(date, visibleRange.start),
            max: buildLocalTime(date, visibleRange.end),
        }),
        [date, visibleRange.end, visibleRange.start],
    );

    const replaceEvent = useCallback((targetId: string, nextEvent: CalendarEvent) => {
        setEvents((prev) => {
            const filtered = prev.filter((event) => event.id !== targetId);
            return [...filtered, nextEvent];
        });
    }, []);

    const handleEventTimeChange = useCallback(
        async (event: CalendarEvent, start: Date, end: Date, successMessage: string) => {
            const originalEvent = {
                ...event,
                start: new Date(event.start),
                end: new Date(event.end),
            };
            const nextEvent = {
                ...event,
                start: new Date(start),
                end: new Date(end),
            };
            const nextStartUtc = localWallDateToOperationUtc(nextEvent.start, businessHours.timeZone);
            const nextEndUtc = localWallDateToOperationUtc(nextEvent.end, businessHours.timeZone);
            if (nextStartUtc <= new Date()) {
                toast({
                    title: "Horario no disponible",
                    description: "Solo puedes reprogramar citas desde este momento en adelante.",
                    variant: "destructive",
                });
                return;
            }

            replaceEvent(event.id, nextEvent);
            onAppointmentTimeChange?.(event.id, nextStartUtc, nextEndUtc);

            try {
                await updateAppointment(event.id, {
                    startTime: nextStartUtc,
                    endTime: nextEndUtc,
                });
                toast({
                    title: successMessage,
                    description: `Movida a ${formatDateTimeInOperationZone(nextStartUtc, "es-MX", businessHours.timeZone)}`,
                });
                await onMutationSettled?.();
            } catch {
                replaceEvent(event.id, originalEvent);
                onAppointmentTimeChange?.(
                    event.id,
                    localWallDateToOperationUtc(originalEvent.start, businessHours.timeZone),
                    localWallDateToOperationUtc(originalEvent.end, businessHours.timeZone),
                );
                toast({
                    title: "Error",
                    description: "No se pudo actualizar la cita.",
                    variant: "destructive",
                });
            }
        },
        [businessHours.timeZone, onAppointmentTimeChange, onMutationSettled, replaceEvent, toast],
    );

    const onEventResize: any = useCallback(
        async ({ event, start, end }: { event: CalendarEvent; start: Date; end: Date }) => {
            await handleEventTimeChange(event, start, end, "Cita actualizada");
        },
        [handleEventTimeChange],
    );

    const onEventDrop: any = useCallback(
        async ({ event, start, end }: { event: CalendarEvent; start: Date; end: Date }) => {
            await handleEventTimeChange(event, start, end, "Cita reprogramada");
        },
        [handleEventTimeChange],
    );

    const CustomEvent = ({ event }: EventProps<CalendarEvent>) => {
        const isPast = localWallDateToOperationUtc(event.end, businessHours.timeZone).getTime() < Date.now();
        const isCompleted = event.resource?.status === "completed";
        const isReserved = event.resource?.status === "scheduled" && event.resource?.confirmationStatus === "pending";
        const calendarColor = isReserved ? "#B58A2A" : event.resource?.googleCalendarColor || "#0EA5E9";
        const baseClasses =
            "flex h-full w-full items-start gap-2 overflow-hidden rounded-r-md border-l-[6px] px-1.5 py-0.5 leading-tight shadow-sm transition-all";
        const backgroundColor = isCompleted || isPast ? `${calendarColor}14` : `${calendarColor}1F`;
        const textColor = calendarColor;

        return (
            <div
                className={baseClasses}
                style={{
                    borderLeftColor: calendarColor,
                    backgroundColor,
                    color: textColor,
                    opacity: isCompleted || isPast ? 0.8 : 1,
                }}
            >
                <div
                    className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{
                        backgroundColor: calendarColor,
                        boxShadow: `0 0 6px ${calendarColor}`,
                    }}
                />
                <div className="flex min-w-0 flex-col justify-start overflow-hidden">
                    <div className="truncate text-xs font-semibold leading-snug">
                        {isReserved ? `Apartado · ${event.title}` : event.title}
                    </div>
                    <div className="truncate text-[10px] leading-tight opacity-85">
                        {format(event.start, "EEE d MMM h:mm a", { locale: es })}
                    </div>
                </div>
            </div>
        );
    };

    const CustomToolbar = (toolbar: any) => {
        const goToBack = () => toolbar.onNavigate("PREV");
        const goToNext = () => toolbar.onNavigate("NEXT");
        const goToToday = () => toolbar.onNavigate("TODAY");

        const labelDate = new Date(toolbar.date);
        const label =
            toolbar.view === "day"
                ? format(labelDate, "EEEE d 'de' MMMM yyyy", { locale: es })
                : format(labelDate, "MMMM yyyy", { locale: es });

        return (
            <div className="mb-3 flex flex-col gap-2 px-1 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center justify-between gap-2 sm:justify-start">
                    <span className="text-lg font-bold capitalize text-foreground">{label}</span>
                </div>

                <div className="flex items-center gap-2">
                    <div className="flex gap-1 rounded-md bg-muted p-1">
                        <Button variant="ghost" size="sm" onClick={goToBack} className="h-7 w-7 p-0 hover:bg-background">
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={goToToday} className="h-7 px-2 text-xs hover:bg-background">
                            Hoy
                        </Button>
                        <Button variant="ghost" size="sm" onClick={goToNext} className="h-7 w-7 p-0 hover:bg-background">
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>

                    <div className="flex gap-1 rounded-md bg-muted p-1">
                        <Button
                            variant={toolbar.view === "month" ? "default" : "ghost"}
                            size="sm"
                            onClick={() => toolbar.onView("month")}
                            className={`h-7 text-xs ${toolbar.view !== "month" ? "hover:bg-background" : ""}`}
                        >
                            Mes
                        </Button>
                        <Button
                            variant={toolbar.view === "week" ? "default" : "ghost"}
                            size="sm"
                            onClick={() => toolbar.onView("week")}
                            className={`h-7 text-xs ${toolbar.view !== "week" ? "hover:bg-background" : ""}`}
                        >
                            Semana
                        </Button>
                        <Button
                            variant={toolbar.view === "day" ? "default" : "ghost"}
                            size="sm"
                            onClick={() => toolbar.onView("day")}
                            className={`h-7 text-xs ${toolbar.view !== "day" ? "hover:bg-background" : ""}`}
                        >
                            Día
                        </Button>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="big-calendar-wrapper flex h-full flex-col">
            <DragAndDropCalendar
                localizer={localizer}
                events={events}
                startAccessor={(event: any) => event.start}
                endAccessor={(event: any) => event.end}
                style={{ height: "100%" }}
                views={[Views.MONTH, Views.WEEK, Views.DAY]}
                view={view}
                onView={setView}
                date={date}
                onNavigate={setDate}
                selectable
                resizable
                onEventDrop={onEventDrop}
                onEventResize={onEventResize}
                onSelectSlot={(slot: any) => {
                    const slotDateKey = getLocalCalendarDateKey(slot.start);
                    const todayKey = getOperationTodayKey(businessHours.timeZone);
                    const startUtc = localWallDateToOperationUtc(slot.start, businessHours.timeZone);
                    const isPastSelection = view === Views.MONTH
                        ? slotDateKey < todayKey
                        : startUtc <= new Date();
                    if (isPastSelection) {
                        toast({
                            title: "Horario no disponible",
                            description: "Solo puedes crear citas desde este momento en adelante.",
                            variant: "destructive",
                        });
                        return;
                    }
                    onSelectSlot(slot);
                }}
                onSelectEvent={(event: any) => onSelectEvent({
                    ...event,
                    start: localWallDateToOperationUtc(event.start, businessHours.timeZone),
                    end: localWallDateToOperationUtc(event.end, businessHours.timeZone),
                })}
                messages={{
                    next: "Siguiente",
                    previous: "Anterior",
                    today: "Hoy",
                    month: "Mes",
                    week: "Semana",
                    day: "Día",
                    noEventsInRange: "No hay citas en este rango",
                }}
                components={{
                    toolbar: CustomToolbar,
                    event: CustomEvent as any,
                }}
                culture="es"
                step={15}
                timeslots={4}
                min={min}
                max={max}
                scrollToTime={min}
            />
        </div>
    );
}
