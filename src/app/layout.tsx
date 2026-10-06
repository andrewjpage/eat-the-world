import type { Metadata, Viewport } from "next";
import { DM_Mono, DM_Sans, Fraunces } from "next/font/google";
import "flag-icons/css/flag-icons.min.css";
import "./globals.css";
import { APP_DESCRIPTION, APP_NAME, THEME_DARK, THEME_LIGHT } from "@/lib/app";
import { getMyProfile } from "@/components/auth/session";
import { BottomNav } from "@/components/nav/BottomNav";
import { IosInstallHint } from "@/components/nav/IosInstallHint";
import { TopBar } from "@/components/nav/TopBar";
import { ToastProvider } from "@/components/ui/Toast";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["SOFT", "WONK", "opsz"],
  display: "swap",
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  display: "swap",
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  // Invite-only and private (brief section 8): keep it out of search engines.
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default" },
  formatDetection: { telephone: false },
  referrer: "strict-origin-when-cross-origin",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_LIGHT },
    { media: "(prefers-color-scheme: dark)", color: THEME_DARK },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const profile = await getMyProfile();

  return (
    <html
      lang="en-GB"
      className={`${fraunces.variable} ${dmSans.variable} ${dmMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ToastProvider>
          {profile && <TopBar name={profile.display_name} avatarUrl={profile.avatar_url} />}
          {/* BottomNav renders its own spacer, so hidden-chrome screens get no gap. */}
          <main id="main" className="flex flex-1 flex-col">
            {children}
          </main>
          {profile && <BottomNav />}
          {profile && <IosInstallHint />}
        </ToastProvider>
      </body>
    </html>
  );
}
