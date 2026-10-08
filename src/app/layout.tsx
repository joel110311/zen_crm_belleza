import type { Metadata } from "next";
import "./globals.css";

import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toaster"
import { SessionProvider } from "@/components/providers/session-provider"
import { ColorThemeProvider } from "@/components/color-theme-provider"
import { auth } from "@/lib/auth"
import { COLOR_THEME_STORAGE_KEY, DEFAULT_COLOR_THEME } from "@/lib/color-theme"
import { getBrandingIcons, resolveBranding, resolveTenantBranding } from "@/lib/branding"
import { getSystemSettingsOrDefaults } from "@/lib/system-settings"
import { getActiveTenantRuntimeContext } from "@/lib/active-tenant-context"
import { isMultitenantRuntimeEnabled } from "@/lib/multitenant-features"

export async function generateMetadata(): Promise<Metadata> {
  try {
    const tenant = await getActiveTenantRuntimeContext("read");
    const settings = isMultitenantRuntimeEnabled() && !tenant ? null : await getSystemSettingsOrDefaults();
    const branding = tenant ? resolveTenantBranding(settings, tenant.displayName) : resolveBranding(settings);

    return {
      title: branding.brandName,
      description: "CRM para negocios de cuidado personal con WhatsApp e IA",
      icons: getBrandingIcons(branding),
    };
  } catch {
    const branding = resolveBranding(null);

    return {
      title: branding.brandName,
      description: "CRM para negocios de cuidado personal con WhatsApp e IA",
      icons: getBrandingIcons(branding),
    };
  }
}

const colorThemeInitScript = `
(() => {
  try {
    const stored = window.localStorage.getItem("${COLOR_THEME_STORAGE_KEY}");
    const nextTheme = stored === "clinic" || stored === "green" || stored === "apple" ? stored : "${DEFAULT_COLOR_THEME}";
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
    <html
      lang="es"
      suppressHydrationWarning
      data-color-theme={DEFAULT_COLOR_THEME}
      data-scroll-behavior="smooth"
    >
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
