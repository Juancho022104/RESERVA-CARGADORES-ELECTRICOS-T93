# Reserva de Cargadores Eléctricos

Sistema web de reserva de cargadores eléctricos residenciales (40 apartamentos), construido con **Google Apps Script** (backend) + **Google Sheets** (base de datos) + **Tailwind CSS / Lucide Icons** (frontend).

## Archivos

- `Code.gs` — lógica de backend: `doGet`, disponibilidad dinámica, reglas de equidad, `LockService`, envío de correos.
- `Index.html` — estructura de la página (se sirve vía `doGet`).
- `CSS.html` — estilos (incluido en `Index.html` con `include('CSS')`).
- `JS.html` — lógica de cliente, comunicación con `google.script.run` (incluido con `include('JS')`).
- `appsscript.json` — manifiesto del proyecto.

## Despliegue como Web App

1. **Crea el proyecto de Apps Script**
   - Abre tu Google Sheets (o crea uno nuevo) que servirá como base de datos.
   - Ve a `Extensiones → Apps Script`.
   - Borra el `Code.gs` de ejemplo y pega el contenido de este `Code.gs`.
   - Crea 3 archivos HTML nuevos (`Archivo → Nuevo → Archivo HTML`) llamados exactamente `Index`, `CSS` y `JS`, y pega el contenido correspondiente.

2. **Configura el correo de administración**
   - En `Code.gs`, edita `CONFIG.ADMIN_EMAIL` con el correo real de administración/celaduría.

3. **Autoriza el script**
   - Ejecuta una vez la función `getBootstrapData` desde el editor para disparar la pantalla de permisos y autorizar el acceso a Sheets y `MailApp`.

4. **Publica como aplicación web**
   - `Implementar → Nueva implementación`.
   - Tipo: **Aplicación web**.
   - Ejecutar como: **Usuario que accede a la aplicación web** (o "Yo" si prefieres centralizar permisos).
   - Quién tiene acceso: según tu preferencia (recomendado: **Cualquier usuario dentro de tu organización**, o **Cualquier usuario con el enlace** si no usas Google Workspace).
   - Haz clic en **Implementar** y copia la URL `/exec` generada — esa es la URL que comparten los residentes.

5. **Actualizaciones posteriores**
   - Cada vez que modifiques el código, debes ir a `Implementar → Gestionar implementaciones → editar (lápiz) → Versión: Nueva versión → Implementar` para que los cambios lleguen a la URL pública `/exec`. Guardar el archivo o hacer `clasp push` **no** actualiza automáticamente la implementación publicada.

## Reglas de negocio implementadas

- **Ventana de 48 horas**: no se puede reservar un bloque que empiece en más de 48 horas, ni uno que ya haya pasado.
- **Cuota semanal en bloques pico (D/E)**: máximo 2 reservas por apartamento por semana (lunes a domingo) en bloques de alta demanda.
- **Sin bloques consecutivos**: un apartamento no puede reservar dos bloques seguidos (A-B, B-C, C-D, D-E) el mismo día.
- **Concurrencia**: `LockService.getScriptLock()` + doble verificación de disponibilidad justo antes de escribir, para evitar reservas duplicadas ("fantasma") cuando dos vecinos reservan casi al mismo tiempo.
- **Notificaciones**: al confirmar, se envía correo automático al residente y a la administración con `MailApp.sendEmail()`.

## Hoja "Reservas"

Se crea automáticamente la primera vez que se usa el sistema, con las columnas:

```
ID_Reserva | Timestamp | Fecha | Bloque | Punto | Apartamento | Correo | Estado
```
