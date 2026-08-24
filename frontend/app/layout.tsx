import type { Metadata } from "next";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource-variable/manrope";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import { DirectionContractMarker } from "@/components/direction-contract-marker";
import { Providers } from "@/components/providers";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: { default: "OpenIoTData — Datos de sensores abiertos", template: "%s · OpenIoTData" },
  description: "Catálogo público para descubrir, comprender y reutilizar datasets heterogéneos de sensores IoT.",
  applicationName: "OpenIoTData",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>
        <DirectionContractMarker />
        <Providers>
          <a className="skip-link" href="#main-content">Saltar al contenido principal</a>
          <SiteHeader />
          {children}
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
