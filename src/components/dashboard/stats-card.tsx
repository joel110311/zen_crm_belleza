
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { LucideIcon, TrendingUp, TrendingDown } from "lucide-react";

interface StatsCardProps {
    title: string;
    value: string | number;
    icon: LucideIcon;
    trend?: {
        value: number;
        label?: string;
        isPositive?: boolean;
    };
    description?: string;
    color?: string;
    className?: string;
}

export function StatsCard({
    title,
    value,
    icon: Icon,
    trend,
    description,
    color = "text-primary",
    className,
}: StatsCardProps) {
    return (
        <Card className={cn("border border-border/60 shadow-premium hover:shadow-premium-hover transition-all duration-300 rounded-xl", className)}>
            <CardContent className="p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0 flex-1">
                        <p className="text-xs sm:text-sm font-medium text-muted-foreground truncate">{title}</p>
                        <div className="text-xl sm:text-2xl 2xl:text-3xl font-bold tracking-tight text-foreground truncate">
                            {value}
                        </div>
                        {description && (
                            <p className="text-[11px] sm:text-xs text-muted-foreground/70 mt-0.5 truncate">{description}</p>
                        )}
                    </div>
                    <div
                        className="p-2.5 rounded-xl flex items-center justify-center shrink-0"
                        style={{
                            backgroundColor: color.startsWith("#") ? `${color}18` : undefined,
                            color: color.startsWith("#") ? color : undefined,
                        }}
                    >
                        <Icon className={cn("h-5 w-5 sm:h-5 sm:w-5", !color.startsWith("#") && color)} />
                    </div>
                </div>

                {trend && (
                    <div className="mt-3 flex items-center text-xs font-medium">
                        <span
                            className={cn(
                                "flex items-center gap-1 rounded-full px-2 py-0.5",
                                trend.isPositive
                                    ? "text-sky-400 bg-sky-500/10"
                                    : "text-rose-400 bg-rose-500/10"
                            )}
                        >
                            {trend.isPositive ? (
                                <TrendingUp className="h-3 w-3" />
                            ) : (
                                <TrendingDown className="h-3 w-3" />
                            )}
                            {trend.value}%
                        </span>
                        {trend.label && (
                            <span className="ml-2 text-muted-foreground">{trend.label}</span>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
