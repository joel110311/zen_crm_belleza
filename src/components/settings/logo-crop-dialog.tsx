"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Loader2, Minus, Move, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";

type Point = { x: number; y: number };

type LogoCropDialogProps = {
    file: File | null;
    open: boolean;
    title?: string;
    isApplying?: boolean;
    onOpenChange: (open: boolean) => void;
    onApply: (file: File) => Promise<void>;
};

const OUTPUT_SIZE = 1024;

export function LogoCropDialog({
    file,
    open,
    title = "Ajustar logotipo",
    isApplying = false,
    onOpenChange,
    onApply,
}: LogoCropDialogProps) {
    const stageRef = useRef<HTMLDivElement>(null);
    const imageRef = useRef<HTMLImageElement>(null);
    const dragRef = useRef<{ pointerId: number; start: Point; origin: Point } | null>(null);
    const [sourceUrl, setSourceUrl] = useState("");
    const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
    const [zoom, setZoom] = useState(1);
    const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
    const [isProcessing, setIsProcessing] = useState(false);

    useEffect(() => {
        if (!file) {
            setSourceUrl("");
            return;
        }

        const nextUrl = URL.createObjectURL(file);
        setSourceUrl(nextUrl);
        setZoom(1);
        setOffset({ x: 0, y: 0 });
        setNaturalSize({ width: 0, height: 0 });
        return () => URL.revokeObjectURL(nextUrl);
    }, [file]);

    const getGeometry = (nextZoom = zoom) => {
        const stage = stageRef.current;
        if (!stage || !naturalSize.width || !naturalSize.height) return null;
        const stageWidth = stage.clientWidth;
        const stageHeight = stage.clientHeight;
        const baseScale = Math.max(stageWidth / naturalSize.width, stageHeight / naturalSize.height);
        const renderedWidth = naturalSize.width * baseScale * nextZoom;
        const renderedHeight = naturalSize.height * baseScale * nextZoom;
        return {
            stageWidth,
            stageHeight,
            baseScale,
            renderedWidth,
            renderedHeight,
            maxX: Math.max(0, (renderedWidth - stageWidth) / 2),
            maxY: Math.max(0, (renderedHeight - stageHeight) / 2),
        };
    };

    const clampOffset = (point: Point, nextZoom = zoom) => {
        const geometry = getGeometry(nextZoom);
        if (!geometry) return point;
        return {
            x: Math.max(-geometry.maxX, Math.min(geometry.maxX, point.x)),
            y: Math.max(-geometry.maxY, Math.min(geometry.maxY, point.y)),
        };
    };

    const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = {
            pointerId: event.pointerId,
            start: { x: event.clientX, y: event.clientY },
            origin: offset,
        };
    };

    const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        setOffset(clampOffset({
            x: drag.origin.x + event.clientX - drag.start.x,
            y: drag.origin.y + event.clientY - drag.start.y,
        }));
    };

    const stopDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
    };

    const handleZoomChange = (value: number[]) => {
        const nextZoom = value[0] ?? 1;
        setZoom(nextZoom);
        setOffset((current) => clampOffset(current, nextZoom));
    };

    const createCroppedFile = async () => {
        const image = imageRef.current;
        const geometry = getGeometry();
        if (!image || !geometry || !file) throw new Error("La imagen todavía no está lista.");

        const sourceX = ((geometry.renderedWidth - geometry.stageWidth) / 2 - offset.x)
            / geometry.renderedWidth * naturalSize.width;
        const sourceY = ((geometry.renderedHeight - geometry.stageHeight) / 2 - offset.y)
            / geometry.renderedHeight * naturalSize.height;
        const sourceWidth = geometry.stageWidth / geometry.renderedWidth * naturalSize.width;
        const sourceHeight = geometry.stageHeight / geometry.renderedHeight * naturalSize.height;
        const canvas = document.createElement("canvas");
        canvas.width = OUTPUT_SIZE;
        canvas.height = OUTPUT_SIZE;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("No se pudo preparar el recorte.");

        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(
            image,
            sourceX,
            sourceY,
            sourceWidth,
            sourceHeight,
            0,
            0,
            OUTPUT_SIZE,
            OUTPUT_SIZE,
        );

        const blob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((result) => result ? resolve(result) : reject(new Error("No se pudo generar el logotipo.")), "image/png", 0.95);
        });
        const cleanName = file.name.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-") || "logotipo";
        return new File([blob], `${cleanName}-recortado.png`, { type: "image/png" });
    };

    const handleApply = async () => {
        setIsProcessing(true);
        try {
            await onApply(await createCroppedFile());
        } finally {
            setIsProcessing(false);
        }
    };

    const busy = isApplying || isProcessing;
    const geometry = getGeometry();

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => !busy && onOpenChange(nextOpen)}>
            <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-0 sm:max-w-[650px]" showCloseButton={!busy}>
                <DialogHeader className="border-b px-5 py-4 pr-14 sm:px-6">
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>
                        Arrastra la imagen para centrarla y usa el zoom hasta que se vea como deseas.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-5 px-5 py-2 sm:px-6">
                    <div className="flex justify-center">
                        <div
                            ref={stageRef}
                            onPointerDown={handlePointerDown}
                            onPointerMove={handlePointerMove}
                            onPointerUp={stopDragging}
                            onPointerCancel={stopDragging}
                            className="relative aspect-square w-[min(100%,420px,48dvh)] touch-none cursor-grab select-none overflow-hidden rounded-[2rem] border bg-[#e9ebe8] shadow-inner active:cursor-grabbing"
                        >
                            {sourceUrl ? (
                                <img
                                    ref={imageRef}
                                    src={sourceUrl}
                                    alt="Vista previa del logotipo"
                                    draggable={false}
                                    onLoad={(event) => setNaturalSize({
                                        width: event.currentTarget.naturalWidth,
                                        height: event.currentTarget.naturalHeight,
                                    })}
                                    className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
                                    style={geometry ? {
                                        width: `${geometry.renderedWidth}px`,
                                        height: `${geometry.renderedHeight}px`,
                                        transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
                                    } : undefined}
                                />
                            ) : null}
                            <div className="pointer-events-none absolute inset-0 rounded-[2rem] border-2 border-white/90 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]" />
                            <div className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur">
                                <Move className="h-3.5 w-3.5" /> Arrastra para ajustar
                            </div>
                        </div>
                    </div>

                    <div className="mx-auto flex max-w-[460px] items-center gap-3">
                        <Minus className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <Slider
                            value={[zoom]}
                            min={1}
                            max={3}
                            step={0.02}
                            onValueChange={handleZoomChange}
                            aria-label="Zoom del logotipo"
                        />
                        <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
                    </div>

                    <div className="rounded-xl border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                        El área completa de la vista previa será el archivo final. Se generará en formato PNG cuadrado y alta resolución.
                    </div>
                </div>

                <DialogFooter className="border-t px-5 py-4 sm:px-6">
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                        Cancelar
                    </Button>
                    <Button type="button" onClick={() => void handleApply()} disabled={busy || !naturalSize.width}>
                        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Aplicar logotipo
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
