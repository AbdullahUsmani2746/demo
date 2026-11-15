import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "./providers";
import { SettingsProvider } from "@/context/SettingsContext";
import Providers from './queryProvides';
import { Toaster } from "sonner";
import PwaRegister from "@/components/pwa/PwaRegister";

import { CurrencyProvider } from "@/context/CurrencyContext";
import { CompanyProvider } from "@/context/CompanyContext";
import { getCompany, companyShortName, DEFAULT_COMPANY_NAME } from "@/lib/company";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Pages that are prerendered at build time are regenerated at runtime at most
// hourly, so the title below comes from the live Company table even when the
// build (e.g. the Docker image) has no database access and baked in the
// neutral fallback.
export const revalidate = 3600;

// Installed app (app/manifest.js): maroon status bar, opens full screen on
// iPhone too — needed there for phone notifications (public/sw.js).
export const viewport = {
  themeColor: "#800000",
  width: "device-width",
  initialScale: 1,
};

const appleWebApp = (title) => ({ capable: true, title, statusBarStyle: "default" });

export async function generateMetadata() {
  // Title = short company name ("SMS"), description = full name, both from the
  // Company table. Neutral fallback if it is unset or the DB is unreachable.
  try {
    const company = await getCompany();
    const short = companyShortName(company.name);
    return {
      title: short,
      description: company.name,
      appleWebApp: appleWebApp(short),
    };
  } catch {
    return { title: DEFAULT_COMPANY_NAME, description: DEFAULT_COMPANY_NAME, appleWebApp: appleWebApp(DEFAULT_COMPANY_NAME) };
  }
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <SessionProvider>
          <Providers>
            <SettingsProvider>
              <CurrencyProvider>
                <CompanyProvider>
                  {children}
                  <Toaster position="top-right" richColors closeButton />
                  <PwaRegister />
                </CompanyProvider>
              </CurrencyProvider>
            </SettingsProvider>
          </Providers>
        </SessionProvider>
      </body>
    </html>
  );
}
