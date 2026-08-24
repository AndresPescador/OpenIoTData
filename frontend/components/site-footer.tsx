import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div><strong>OpenIoTData</strong><span>Catálogo abierto de datos IoT en Colombia</span></div>
        <nav aria-label="Legal">
          <Link href="/docs/api#terminos">Términos de uso</Link>
          <Link href="/docs/api#privacidad">Privacidad</Link>
          <Link href="/docs/api#licencias">Licencias</Link>
        </nav>
        <p>Datos abiertos para el bien común. <span className="version">v0.1.0</span></p>
      </div>
    </footer>
  );
}
