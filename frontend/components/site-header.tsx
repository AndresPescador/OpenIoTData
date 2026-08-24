"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleHelp, Globe2, Menu, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";

const navigation = [
  { href: "/datasets", label: "Explorar" },
  { href: "/map", label: "Mapa" },
  { href: "/docs/api", label: "Documentación API" },
  { href: "/publish", label: "Publicar datos" },
];

function BrandMark() {
  return (
    <svg aria-hidden="true" className="brand-mark" viewBox="0 0 40 40" fill="none">
      <path d="M7 12c7-7 19-7 26 0M11 17c5-5 13-5 18 0M16 22c2-2 6-2 8 0" />
      <path d="M8 23l12 6 12-6M8 28l12 6 12-6M8 18v14l12 6 12-6V18" />
    </svg>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const auth = useAuth();

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link href="/" className="brand" aria-label="OpenIoTData, inicio" onClick={() => setOpen(false)}>
          <BrandMark />
          <span>OpenIoTData</span>
        </Link>

        <button
          className="nav-toggle"
          type="button"
          aria-expanded={open}
          aria-controls="primary-navigation"
          aria-label={open ? "Cerrar navegación" : "Abrir navegación"}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>

        <nav id="primary-navigation" className={cn("primary-navigation", open && "is-open")} aria-label="Principal">
          {navigation.map((item) => {
            const current = pathname === item.href || (item.href === "/datasets" && pathname.startsWith("/datasets"));
            return (
              <Link key={item.href} href={item.href} className={cn("nav-link", current && "is-current")} aria-current={current ? "page" : undefined} onClick={() => setOpen(false)}>
                {item.label}
              </Link>
            );
          })}
          <span className="nav-divider" aria-hidden="true" />
          <Link href="/docs/api#soporte" className="nav-utility" onClick={() => setOpen(false)}><CircleHelp aria-hidden="true" size={18} /> Ayuda</Link>
          <button type="button" className="nav-utility" aria-label="Idioma actual: Español"><Globe2 aria-hidden="true" size={18} /> ES</button>
          {auth.authenticated ? (
            <>
              <Link href="/my-datasets" className="account-link" aria-label={`Abrir espacio de ${auth.user?.displayName ?? "usuario"}`} title={auth.user?.displayName} onClick={() => setOpen(false)}>
                <span aria-hidden="true">{(auth.user?.displayName ?? "U").split(/[\s._-]+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span><span className="sr-only">Mi espacio</span>
              </Link>
              <button type="button" className="nav-utility nav-signout" onClick={() => auth.logout()}>Salir</button>
            </>
          ) : (
            <button type="button" className="nav-login" onClick={() => auth.login()} disabled={!auth.ready}>Ingresar</button>
          )}
        </nav>
      </div>
    </header>
  );
}
