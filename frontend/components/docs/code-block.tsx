"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  return <div className="code-sample docs-code"><button type="button" aria-label="Copiar ejemplo de código" onClick={copy}>{copied ? <Check aria-hidden="true" size={16} /> : <Copy aria-hidden="true" size={16} />} {copied ? "Copiado" : "Copiar"}</button><pre><code>{code}</code></pre></div>;
}
