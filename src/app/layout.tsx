import type { Metadata } from "next";
import "./globals.css";

import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toaster"
import { SessionProvider } from "@/components/providers/session-provider"
import { ColorThemeProvider } from "@/components/color-theme-provider"
import { auth } from "@/lib/auth"
import { COLOR_THEME_STORAGE_KEY, DEFAULT_COLOR_THEME } from "@/lib/color-theme"
import { resolveBranding } from "@/lib/branding"
import { getSystemSettingsOrDefaults } from "@/lib/system-settings"

export async function generateMetadata(): Promise<Metadata> {
  try {
    const settings = await getSystemSettingsOrDefaults();
    const branding = resolveBranding(settings);

    return {
      title: branding.brandName,
      description: "CRM oftalmologico para WhatsApp con IA",
      icons: {
        icon: branding.brandFaviconUrl,
        shortcut: branding.brandFaviconUrl,
        apple: branding.brandFaviconUrl,
      },
    };
  } catch {
    const branding = resolveBranding(null);

    return {
      title: branding.brandName,
      description: "CRM oftalmologico para WhatsApp con IA",
      icons: {
        icon: branding.brandFaviconUrl,
        shortcut: branding.brandFaviconUrl,
        apple: branding.brandFaviconUrl,
      },
    };
  }
}

const colorThemeInitScript = `
(() => {
  try {
    const stored = window.localStorage.getItem("${COLOR_THEME_STORAGE_KEY}");
    const nextTheme = stored === "black" || stored === "green" ? stored : "${DEFAULT_COLOR_THEME}";
    document.documentElement.setAttribute("data-color-theme", nextTheme);
  } catch {
    document.documentElement.setAttribute("data-color-theme", "${DEFAULT_COLOR_THEME}");
  }
})();
`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();

  return (
    <html lang="es" suppressHydrationWarning data-color-theme={DEFAULT_COLOR_THEME}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <script dangerouslySetInnerHTML={{ __html: colorThemeInitScript }} />
      </head>
      <body className="font-sans antialiased">
        <SessionProvider session={session}>
          <ThemeProvider
            attribute="class"
            defaultTheme="light"
            enableSystem={false}
            disableTransitionOnChange
          >
            <ColorThemeProvider>
              {children}
              <Toaster />
            </ColorThemeProvider>
          </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
