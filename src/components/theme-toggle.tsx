"use client"

import * as React from "react"
import { Moon, Sun, Laptop } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

export function ThemeToggle() {
    const { setTheme, theme } = useTheme()
    const [mounted, setMounted] = React.useState(false)

    React.useEffect(() => {
        setMounted(true)
    }, [])

    if (!mounted) {
        return null
    }

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
                <div
                    className={cn(
                        "cursor-pointer rounded-lg border-2 p-1 hover:border-primary",
                        theme === "light" ? "border-primary" : "border-muted"
                    )}
                    onClick={() => setTheme("light")}
                >
                    <div className="space-y-2 rounded-md bg-[#ecedef] p-2">
                        <div className="space-y-2 rounded-md bg-white p-2 shadow-sm">
                            <div className="h-2 w-[80px] rounded-lg bg-[#ecedef]" />
                            <div className="h-2 w-[100px] rounded-lg bg-[#ecedef]" />
                        </div>
                        <div className="flex items-center space-x-2 rounded-md bg-white p-2 shadow-sm">
                            <div className="h-4 w-4 rounded-full bg-[#ecedef]" />
                            <div className="h-2 w-[100px] rounded-lg bg-[#ecedef]" />
                        </div>
                    </div>
                    <div className="p-2 text-center text-sm font-medium">Claro</div>
                </div>

                <div
                    className={cn(
                        "cursor-pointer rounded-lg border-2 p-1 hover:border-primary",
                        theme === "dark" ? "border-primary" : "border-muted"
                    )}
                    onClick={() => setTheme("dark")}
                >
                    <div className="space-y-2 rounded-md bg-slate-950 p-2">
                        <div className="space-y-2 rounded-md bg-slate-800 p-2 shadow-sm">
                            <div className="h-2 w-[80px] rounded-lg bg-slate-400" />
                            <div className="h-2 w-[100px] rounded-lg bg-slate-400" />
                        </div>
                        <div className="flex items-center space-x-2 rounded-md bg-slate-800 p-2 shadow-sm">
                            <div className="h-4 w-4 rounded-full bg-slate-400" />
                            <div className="h-2 w-[100px] rounded-lg bg-slate-400" />
                        </div>
                    </div>
                    <div className="p-2 text-center text-sm font-medium">Oscuro</div>
                </div>

                <div
                    className={cn(
                        "cursor-pointer rounded-lg border-2 p-1 hover:border-primary",
                        theme === "system" ? "border-primary" : "border-muted"
                    )}
                    onClick={() => setTheme("system")}
                >
                    <div className="flex h-full flex-col justify-center items-center space-y-2 rounded-md bg-slate-100 p-2 dark:bg-slate-950">
                        <Laptop className="h-10 w-10 text-muted-foreground" />
                    </div>
                    <div className="p-2 text-center text-sm font-medium">Sistema</div>
                </div>
            </div>
        </div>
    )
}
