# BioTech: migración a Supabase

La rama `supabase-migration` conserva la aplicación y su interfaz. Añade Supabase como persistencia compartida, un acceso administrativo con Auth/RLS, imágenes en Storage y un proceso explícito de respaldo e importación. La conexión permanece apagada hasta configurar el URL y la clave pública del proyecto.

Esta rama usa `supabase/migrations/202610070001_cloud_persistence.sql`. El archivo anterior `database/001_biotech_schema.sql` es un borrador normalizado de otra etapa y no conecta esta versión del frontend: no ejecutes ambos scripts como si fueran una sola migración. Si ya aplicaste el SQL anterior en tu proyecto, detente y revisa el esquema existente antes de ejecutar el nuevo.

## Auditoría del punto de partida

- El sitio es HTML/CSS/JavaScript estático. No se cambió el framework, diseño ni navegación.
- El repositorio no tenía cliente Supabase, autenticación propia ni conexión de datos. `/admin` abría el panel sin comprobar identidad.
- La app conserva los productos, pedidos, gastos, moneda, envío y promociones bajo claves `biotech_*` de `localStorage`. Los módulos añadían actividad administrativa, configuración, proveedores, compras, saldos, contactos, opiniones y reseñas en las mismas claves.
- Las fotos de producto se guardaban como `Blob` en IndexedDB (`biotech-product-media`), no en la nube. Las fotos de marca son archivos normales del proyecto.
- El catálogo inicial de `index.html` contiene productos de demostración. La importación no los copia si nunca se guardaron como datos del navegador.
- El código actual no tiene una colección independiente de clientes: nombre, teléfono y entrega forman parte de cada pedido. La migración conserva ese modelo tal como existe; no deduplica clientes ni inventa historial.
- `sessionStorage` se usa para descartar el anuncio durante la sesión y para una clave temporal idempotente del pedido. El carrito sigue siendo local al dispositivo.

## Datos y seguridad

`business_state` es una tabla PostgreSQL con una fila versionada por colección heredada. El contenido JSONB conserva el objeto completo y sus campos actuales sin convertir ni descartar atributos durante esta migración de compatibilidad. Sus claves cubren productos, categorías, pedidos, gastos, moneda, envío, promociones, bitácora, configuración, proveedores, compras, saldos, contactos/opiniones y reseñas. RLS permite consultar/escribir estas filas solo al rol administrativo. El guardado compara versiones y agrupa cambios relacionados para impedir que dispositivos con datos obsoletos se sobrescriban sin aviso. Es una capa de compatibilidad deliberada; no equivale a tablas relacionales independientes como `products`, `orders` e `inventory`.

La tienda pública no lee esas filas. Funciones SQL con acceso limitado devuelven únicamente campos públicos de productos/configuración/promociones y reseñas aprobadas. El RPC de pedido vuelve a validar productos, stock, encargos, promoción, envío y totales dentro de una transacción; incluye idempotencia y un límite sencillo por teléfono. Las opiniones nuevas quedan pendientes de moderación. Las galerías se suben a `product-images`; el bucket permite lectura pública y escritura solo a administradores.

`profiles` se relaciona con `auth.users`. No hay contraseña codificada ni clave `service_role` en JavaScript. El frontend usa solo la clave pública `publishable`/`anon`, restringida por RLS; la sesión la administra el SDK de Supabase. En una web estática el SDK conserva la sesión en el almacenamiento del navegador; por eso protege los permisos en la base, pero no ofrece cookies `HttpOnly` como lo haría un backend propio.

Con una URL pública de Supabase configurada, el sitio deja de escribir las colecciones empresariales en `localStorage`: las lecturas y escrituras activas usan la nube. Los datos antiguos del navegador se mantienen intactos como respaldo y no se borran automáticamente. `localStorage` sigue usándose para el carrito/preferencias y para un marcador técnico que solo indica qué colecciones ya se importaron.

## Activación

1. Crea un proyecto Supabase nuevo y configura una contraseña robusta para el usuario propietario del proyecto. Activa MFA para la cuenta propietaria. Si ya tienes un proyecto con tablas o datos, no ejecutes la migración hasta revisar qué existe.
2. En SQL Editor, ejecuta una sola vez `supabase/migrations/202610070001_cloud_persistence.sql`. Es una migración aditiva; no borra `localStorage`, IndexedDB ni archivos locales.
3. Desactiva los registros públicos de Auth. En Supabase Auth, crea el usuario administrativo con tu correo y define su contraseña allí. Luego ejecuta en SQL Editor el bloque comentado al final de la migración, reemplazando `TU_CORREO_DE_ADMIN` por ese correo. Ese paso asigna `role = 'admin'`; desde el navegador nadie puede asignarse ese rol.
4. En Supabase Project Settings → API, copia el Project URL y la clave pública `publishable` (o `anon` heredada). Colócalas en `cloud-config.js` en `url` y `publishableKey`. Nunca uses `service_role`, claves secretas ni contraseñas en ese archivo.
5. Publica el contenido de esta rama en GitHub Pages por HTTPS. La tienda cliente usa la URL normal; el panel se abre en `/admin/`. GitHub Pages solo sirve archivos estáticos; Supabase aporta base de datos, Auth y Storage.
6. Entra a `/admin/` con el usuario creado en Supabase. La primera vez, pulsa **Respaldo** y luego **Importar datos locales** desde el navegador que tenga los datos reales. La importación inserta únicamente colecciones que todavía no existen en la nube; no reemplaza filas existentes ni borra la copia local. También intenta subir las galerías heredadas de IndexedDB, después de pedir confirmación.
7. Abre la tienda en otro dispositivo y confirma catálogo, existencias, imágenes, promociones, pedido de prueba y lectura del pedido desde el panel. Elimina el pedido de prueba solo después de verificar su estado; no borres filas directamente como parte de la migración.

## Diferencias locales

Los datos de `localStorage` e IndexedDB pertenecen al navegador en que se crearon; GitHub no los contiene. Si la nube y el navegador ya tienen valores distintos, el panel conserva ambos: descarga un respaldo del navegador y te pide confirmar antes de cargar la copia de la nube en ese dispositivo. La importación local no fusiona ni reemplaza colecciones existentes. Para datos repartidos entre varios navegadores, respalda cada uno antes de decidir manualmente cuál es la copia correcta.

Fotos antiguas permanecen en IndexedDB hasta una importación autenticada. El respaldo JSON cubre colecciones de texto/datos, no incorpora binarios; las imágenes migradas quedan como archivos originales en Storage. No pegues imágenes base64 dentro de registros.

## Validación y límites

La migración de archivos no equivale a una conexión de producción. Este entorno no tiene URL/clave de un proyecto Supabase ni acceso para ejecutarla en una base real. Hasta completar los pasos de activación y probar RLS en tu proyecto, no uses pedidos reales. No se probó el envío de correo de Auth, configuración de dominio autorizado, restauración de copias ni despliegue de GitHub Pages desde este entorno.

La tabla JSONB es una capa de compatibilidad para preservar el formato y reducir el riesgo al migrar el sitio existente. Permite consultas desde el panel y sincronización entre dispositivos, pero no reemplaza una futura normalización de cada colección en tablas relacionales; esa fase debe incluir importación verificada y pruebas antes de retirar esta compatibilidad.



