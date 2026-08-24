const contract =
  "impeccable:direction-contract seed=4c21459f; world=topographic-survey-sheet; thesis=open-sensor-data-surveyed-legible-reusable";

export function DirectionContractMarker() {
  const runtimeMarker = `(function(){var s=document.currentScript,p=s&&s.parentNode;if(!p)return;var f=p.firstChild;if(f&&f.nodeType===8&&String(f.data).indexOf('4c21459f')!==-1)return;p.insertBefore(document.createComment(${JSON.stringify(contract)}),s);}());`;

  // React omite comentarios JSX del HTML. Este marcador inserta el contrato antes
  // de la hidratación y el script de build también lo fija en las rutas estáticas.
  return <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: runtimeMarker }} />;
}
