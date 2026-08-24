# Política mínima de publicación de datasets

Esta política orienta el MVP y no sustituye asesoría jurídica. El publicador es responsable de tener derecho a divulgar cada archivo, metadato y ubicación.

## Licencia obligatoria

Un dataset no puede publicarse sin una licencia explícita declarada en sus metadatos. El modelo actual aplica esa licencia del dataset a sus versiones y no guarda una licencia independiente por versión. Las opciones recomendadas son:

- **CC0 1.0**, cuando el titular desea renunciar a derechos en la medida permitida.
- **CC BY 4.0**, cuando exige atribución.
- **ODC-BY 1.0** u **ODbL 1.0**, cuando corresponde proteger una base de datos y se entienden sus obligaciones.

“Público”, “open data”, la licencia del código de OpenIoTData o subir un archivo no conceden por sí solos permiso de reutilización. Una licencia personalizada debe incluir texto o enlace estable y será objeto de revisión. No se aceptará “sin licencia” para un dataset público.

## Declaraciones del publicador

Al publicar, el usuario declara que:

- controla los derechos o tiene autorización compatible con la licencia escogida;
- la descripción de fuente, transformaciones y cobertura no induce a error;
- retiró credenciales, secretos y datos personales no necesarios;
- evaluó el riesgo de coordenadas precisas y datos de infraestructura/personas;
- entiende que validación técnica no equivale a validación científica.

## Contenido no permitido

- malware, ejecutables disfrazados, bombas de descompresión o material destinado a degradar el servicio;
- contraseñas, tokens, claves privadas o credenciales de red/dispositivos;
- datos personales sensibles o identificadores directos sin base jurídica y salvaguardas;
- ubicaciones cuya divulgación crea un riesgo desproporcionado para personas, infraestructura crítica, especies u otros activos protegidos;
- contenido ilegal, obtenido sin autorización o incompatible con la licencia declarada;
- spam, descripciones engañosas o suplantación de autoría.

## Moderación y retiro

Cualquier visitante puede reportar un dataset. Los moderadores pueden poner un recurso en cuarentena, ocultarlo temporalmente o archivar el dataset mientras revisan procedencia, seguridad o derechos. El historial de auditoría debe conservar el actor, motivo y momento sin exponer públicamente datos del denunciante.

Solicitudes jurídicas o de privacidad deben enviarse por el canal privado indicado en [SECURITY.md](../SECURITY.md) hasta que exista un contacto institucional. No incluya datos personales en issues públicos.

## Calidad y cambios

- La plataforma muestra inferencia, completitud y errores técnicos; no certifica exactitud del sensor.
- Originales y versiones publicadas son inmutables. Una corrección crea una versión nueva con changelog.
- Un retiro no debe hacer pasar silenciosamente otro archivo por la versión anterior.
- Metadatos deben indicar zona horaria, unidades, CRS, frecuencia y transformaciones cuando se conozcan.
