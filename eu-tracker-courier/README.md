# EU TRACKER COURIER

App de Shopify que **prepara automáticamente todos los pedidos de tu tienda**
cada madrugada, a una hora distinta y aleatoria, les asigna un número de
seguimiento propio y ofrece a tus clientes una página donde consultarlo.

- Ventana aleatoria configurable (por defecto **02:00 – 07:00**, hora de la tienda).
- Números tipo **`EU776017541338896466`**: 2 letras + 6 dígitos de centro + 10 de serie + 2 de control.
- Panel moderno **dentro del admin de Shopify** (Polaris + App Bridge).
- Lee y prepara **también los pedidos antiguos** que ya tenías sin preparar.
- **Multitienda**: la misma app en todas tus tiendas, cada una con sus ajustes.
- Página pública de seguimiento **en el dominio de tu tienda** + bloque para el tema + API JSON.

---

## Índice

1. [Qué necesitas antes de empezar](#1-qué-necesitas-antes-de-empezar)
2. [Puesta en marcha paso a paso](#2-puesta-en-marcha-paso-a-paso)
3. [Primeros pasos dentro del panel](#3-primeros-pasos-dentro-del-panel)
4. [Poner el seguimiento en tu tienda](#4-poner-el-seguimiento-en-tu-tienda)
5. [Instalarla en tus otras tiendas](#5-instalarla-en-tus-otras-tiendas)
6. [Pasar a producción (tu host y tu dominio)](#6-pasar-a-producción-tu-host-y-tu-dominio)
7. [Los ajustes, uno a uno](#7-los-ajustes-uno-a-uno)
8. [Importante: pedidos de más de 60 días](#8-importante-pedidos-de-más-de-60-días)
9. [Si algo no funciona](#9-si-algo-no-funciona)
10. [Cómo está hecha](#10-cómo-está-hecha)

---

## 1. Qué necesitas antes de empezar

| Qué | Dónde se consigue | Coste |
|---|---|---|
| Cuenta de **Shopify Partners** | <https://partners.shopify.com> | Gratis |
| **Node.js 22.12 o superior** (o 20.19+) | <https://nodejs.org> | Gratis |
| **Shopify CLI** | `npm install -g @shopify/cli@latest` | Gratis |
| Una tienda de Shopify | La tuya, o una *development store* de pruebas | — |

> No necesitas comprar hosting ni dominio todavía. Para desarrollar, la CLI de
> Shopify crea un túnel público temporal por ti.

Comprueba tu versión de Node:

```bash
node --version    # debe decir v22.12.0 o superior (o v20.19+)
```

---

## 2. Puesta en marcha paso a paso

### Paso 1 — Entra en la carpeta e instala

```bash
cd eu-tracker-courier
npm install
```

### Paso 2 — Crea tu archivo de configuración

```bash
cp .env.example .env
```

No hace falta editarlo todavía: para desarrollar, la CLI de Shopify rellena
sola las credenciales. Lo único que necesita ahora mismo es `DATABASE_URL`,
que ya viene apuntando a SQLite.

### Paso 3 — Prepara la base de datos

```bash
npm run setup
```

Esto crea `prisma/dev.sqlite` con todas las tablas. Para desarrollo es
suficiente y no requiere instalar nada más.

### Paso 4 — Comprueba que todo está bien

```bash
npm run selftest
```

Debe terminar con **«Todo correcto»**. Esta prueba verifica más de 7.000
comprobaciones: que la hora sorteada cae siempre dentro de tu ventana (incluso
en las noches de cambio de horario), que los números de seguimiento son únicos
y con dígitos de control válidos, y que el recorrido de los envíos avanza en
orden y nunca retrocede.

### Paso 5 — Crea la app en tu cuenta de Shopify

```bash
npm run config:link
```

La CLI te pedirá iniciar sesión en el navegador y luego:

- **«Create this app as a new app on Shopify?»** → **Yes**
- **App name** → `EU TRACKER COURIER`

Al terminar, tu `shopify.app.toml` tendrá el `client_id` rellenado. **No borres
ese archivo ni lo compartas públicamente.**

### Paso 6 — Arranca la app

```bash
npm run dev
```

La primera vez te preguntará en qué tienda instalarla. Elige la tuya (o una de
pruebas). Después:

1. La CLI muestra una URL tipo `https://algo-aleatorio.trycloudflare.com`.
2. Pulsa la tecla **`p`** para abrir la app en tu admin de Shopify.
3. Acepta los permisos que pide (leer y preparar pedidos).

Ya deberías ver el panel de **EU TRACKER COURIER** dentro de Shopify.

### Paso 7 — Publica la extensión del tema

En otra terminal, con `npm run dev` corriendo:

```bash
npm run deploy
```

Esto sube el bloque de seguimiento para que aparezca en el editor de temas.

> ### ⚠️ Lo más importante de todo
>
> Mientras trabajes en local con `npm run dev`, **la app solo prepara pedidos
> si tu ordenador está encendido y el comando corriendo**. Si apagas el
> ordenador a las 23:00, a las 03:00 no pasará nada.
>
> Para que funcione sola de verdad, necesitas el hosting del
> [apartado 6](#6-pasar-a-producción-tu-host-y-tu-dominio). Mientras llegue ese
> momento, usa el botón **«Preparar pedidos ahora»** del panel.

---

## 3. Primeros pasos dentro del panel

El panel tiene cinco pestañas:

| Pestaña | Para qué sirve |
|---|---|
| **Panel** | Resumen, próxima ejecución, últimos envíos y el botón «Preparar pedidos ahora». |
| **Pedidos** | Los pedidos abiertos sin preparar que ya hay en la tienda. Puedes prepararlos todos o uno a uno. |
| **Envíos** | Todos los envíos con su número, estado y entrega estimada. Buscador y exportación a CSV. |
| **Ajustes** | Todo lo configurable (ver [apartado 7](#7-los-ajustes-uno-a-uno)). |
| **Historial** | Cada ejecución, con el detalle pedido a pedido y el motivo de cada omisión. |

### Recomendación para la primera vez

1. Ve a **Ajustes** y activa **«Modo simulación»**. Guarda.
2. Ve a **Pedidos** y pulsa **«Preparar los N pedidos»**.
3. Mira **Envíos**: verás los números generados marcados como `simulado`.
   **En Shopify no se ha tocado nada.**
4. Abre un enlace de seguimiento y comprueba que te gusta cómo queda.
5. Cuando estés conforme, vuelve a **Ajustes**, desactiva el modo simulación y
   guarda. A partir de ahí va en serio.

> Los envíos simulados se quedan en el historial. Si quieres empezar limpio,
> bórralos desde la base de datos (`npm run studio` → tabla `Shipment`).

---

## 4. Poner el seguimiento en tu tienda

Hay **tres formas** de que tus clientes consulten su envío. Puedes usar las que
quieras a la vez.

### A) Bloque en el tema (lo más recomendable)

1. En tu admin: **Tienda online → Temas → Personalizar**.
2. Crea una página nueva (por ejemplo `/pages/seguimiento`) o abre una existente.
3. **Añadir sección → Aplicaciones → Seguimiento de envíos**.
4. Ajusta el título, el color y el texto del botón desde el panel de la derecha.
5. Guarda.

El bloque busca el envío **sin salir de la página** y respeta el diseño de tu
tema. También acepta `?number=` en la URL, así que los enlaces son compartibles.

### B) Página en el dominio de tu tienda

Ya funciona sin tocar nada:

```
https://tu-tienda.com/apps/eu-tracker
https://tu-tienda.com/apps/eu-tracker?number=EU776017541338896466
```

Es la URL que la app pone en el email de confirmación de envío de Shopify
(mientras tengas activada la opción «Usar el dominio de mi tienda»).

### C) API JSON

Para montarte lo que quieras:

```bash
curl https://tu-app.com/api/track/EU776017541338896466
```

```json
{
  "found": true,
  "trackingNumber": "EU776017541338896466",
  "status": "in_transit",
  "statusLabel": "En tránsito",
  "progress": 50,
  "origin": "Madrid, ES",
  "destination": "Barcelona, ES",
  "estimatedDeliveryLabel": "viernes, 2 de octubre de 2026",
  "events": [{ "title": "En tránsito", "location": "Centro logístico Madrid", "…": "…" }]
}
```

Admite CORS y está limitado a 60 consultas por minuto y por IP.

> **Privacidad**: la página pública nunca muestra el email, el nombre completo
> ni la dirección exacta del cliente. Solo ciudad, país, número de artículos y
> fechas. Cualquiera con el número puede consultarla, así que conviene que sea
> así.

---

## 5. Instalarla en tus otras tiendas

La app está pensada para eso. Cada tienda tiene sus **propios ajustes, su propia
hora aleatoria y su propio historial**.

**Durante el desarrollo**, arranca apuntando a la otra tienda:

```bash
npm run dev -- --store=mi-otra-tienda.myshopify.com
```

O, con la app ya levantada, abre directamente:

```
https://TU-URL-DE-LA-APP/auth/login?shop=mi-otra-tienda.myshopify.com
```

**Cuando tengas la app desplegada**, tienes dos caminos:

1. **Distribución personalizada** (lo normal para tiendas propias):
   Partner Dashboard → tu app → **Distribution** → *Custom distribution* →
   genera el enlace de instalación y ábrelo con cada tienda.
2. **Shopify App Store**: solo si quieres venderla a terceros. Exige revisión de
   Shopify y cumplir los requisitos de privacidad (webhooks GDPR incluidos, que
   vienen comentados en `shopify.app.toml`).

---

## 6. Pasar a producción (tu host y tu dominio)

Cuando compres hosting y dominio, estos son los pasos. Elige un host que
mantenga el proceso **siempre encendido** (Railway, Render, Fly.io, Hetzner,
un VPS…) para que el planificador nocturno funcione solo.

### 6.1 Cambia SQLite por PostgreSQL

SQLite va bien en local, pero para producción usa PostgreSQL. Edita
`prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"   // antes: "sqlite"
  url      = env("DATABASE_URL")
}
```

Y genera la migración:

```bash
npx prisma migrate dev --name postgres
```

### 6.2 Configura las variables de entorno en tu host

Copia `.env.example` y rellena:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | La cadena de conexión de tu PostgreSQL |
| `SHOPIFY_API_KEY` | Partner Dashboard → tu app → *Client ID* |
| `SHOPIFY_API_SECRET` | Partner Dashboard → tu app → *Client secret* |
| `SHOPIFY_APP_URL` | `https://tracker.midominio.com` (sin barra final) |
| `SCOPES` | Cópialo tal cual de `.env.example` |
| `CRON_SECRET` | Solo si tu host apaga el proceso. `openssl rand -hex 32` |

### 6.3 Apunta la app a tu dominio

En `shopify.app.toml`, sustituye `https://example.com` por tu dominio en los
tres sitios (`application_url`, `redirect_urls` y `[app_proxy].url`), pon
`automatically_update_urls_on_dev = false` y despliega la configuración:

```bash
npm run deploy
```

### 6.4 Despliega

Con Docker (el `Dockerfile` ya está listo):

```bash
docker build -t eu-tracker-courier .
docker run -p 3000:3000 --env-file .env eu-tracker-courier
```

O directamente en el servidor:

```bash
npm ci
npx prisma migrate deploy
npm run build
npm start
```

Comprueba que responde:

```bash
curl https://tracker.midominio.com/healthz
# {"ok":true,"app":"EU TRACKER COURIER","database":"ok", ...}
```

### 6.5 Si tu host apaga el proceso (serverless)

En Vercel, Netlify o Cloud Run con escalado a cero, el temporizador interno no
sobrevive. Define `CRON_SECRET` y llama al endpoint cada 5-10 minutos desde un
cron externo (el de tu host, cron-job.org, GitHub Actions…):

```bash
curl -X POST https://tracker.midominio.com/api/cron \
     -H "x-eutc-cron-secret: TU_SECRETO"
```

La hora exacta de preparación **la sigue decidiendo la app**, no el cron: el
cron solo la despierta para que compruebe si ya toca.

También puedes poner `EUTC_DISABLE_SCHEDULER=1` para usar únicamente el cron
externo.

---

## 7. Los ajustes, uno a uno

### Automatización nocturna

| Ajuste | Qué hace |
|---|---|
| **Preparar pedidos automáticamente** | Interruptor maestro. Apagado = no se prepara nada solo. |
| **Desde las / Hasta las** | La ventana dentro de la cual se sortea la hora. Por defecto 02:00 → 07:00. Admite ventanas que cruzan la medianoche (22:00 → 06:00). |
| **Zona horaria** | Se detecta sola desde Shopify al instalar. |
| **Repartir la tanda durante** | Minutos durante los que se van preparando los pedidos, para que las marcas de tiempo no sean todas idénticas. `0` = todo de golpe. En hosts serverless, déjalo en 0. |

Cada día se sortea una hora nueva. El botón **«Sortear otra hora»** del panel
la cambia al momento.

### Número de seguimiento

| Ajuste | Qué hace |
|---|---|
| **Prefijo** | Las 2 letras iniciales. Por defecto `EU`. |
| **Código de centro** | Los 6 dígitos siguientes. Por defecto `776017`, igual que el número de referencia. |
| **Nombre del transportista** | Lo que ve el cliente en el email de Shopify. |

Los 10 dígitos de serie son aleatorios y los 2 últimos son dígitos de control
(mod 97). Eso hace que un número inventado al azar prácticamente nunca cuadre.

### Enlace de seguimiento

| Ajuste | Qué hace |
|---|---|
| **Usar el dominio de mi tienda** | Recomendado. El cliente ve `tu-tienda.com/apps/eu-tracker`. |
| **Plantilla de URL personalizada** | Si la rellenas, manda sobre todo lo demás. Usa `{{number}}` donde vaya el número. Útil si montas tu propio front de seguimiento. |

### Qué pedidos se preparan

| Ajuste | Qué hace |
|---|---|
| **Avisar al cliente por email** | Envía el correo de confirmación de envío de Shopify, con el enlace. |
| **Modo simulación** | Genera todo pero no toca Shopify. Para probar sin riesgo. |
| **Incluir pedidos antiguos** | Procesa también lo que ya tenías sin preparar. |
| **Solo pedidos pagados** | Se salta los que están pendientes de pago. |
| **Máximo de pedidos por ejecución** | Red de seguridad en tiendas grandes. Por defecto 250. |
| **Antigüedad mínima del pedido** | Deja margen para cancelaciones de última hora. |
| **Excluir / Incluir por etiquetas** | Por ejemplo, excluir `recogida-en-tienda` o `producto-digital`. |

### Recorrido del envío

Define cuántos días tarda la entrega (mínimo y máximo), si se cuentan fines de
semana y la ciudad de origen. Con esos datos la app calcula los hitos que ve el
cliente: registro, recogida, tránsito, aduanas (solo en envíos
internacionales), llegada, reparto y entrega.

El recorrido es **determinista**: se calcula a partir del número de
seguimiento, así que un mismo envío muestra siempre exactamente las mismas
fechas, por muchas veces que el cliente recargue.

---

## 8. Importante: pedidos de más de 60 días

El permiso `read_orders` de Shopify solo da acceso a los pedidos de los
**últimos 60 días**. Si tienes pedidos sin preparar más antiguos y quieres que
la app los procese, necesitas el permiso `read_all_orders`, que **Shopify tiene
que aprobar**:

1. Partner Dashboard → tu app → **API access** → solicita `read_all_orders`,
   explicando el caso de uso.
2. Cuando lo aprueben, añade `read_all_orders` a la lista `scopes` de
   `shopify.app.toml` y a `SCOPES` en tu `.env`.
3. `npm run deploy` y vuelve a abrir la app para aceptar el permiso nuevo.

Sin ese permiso todo lo demás funciona igual; simplemente los pedidos de más de
60 días no aparecerán en la pestaña **Pedidos**.

---

## 9. Si algo no funciona

**El panel sale en blanco o da error de sesión**
Cierra la pestaña, vuelve a **Aplicaciones** en tu admin y abre la app de nuevo.
Si persiste, para `npm run dev` y arráncalo otra vez.

**`/apps/eu-tracker` da 404**
El proxy de aplicación no está apuntando a tu app. Revisa `[app_proxy].url` en
`shopify.app.toml` (debe ser `TU-URL/proxy`) y ejecuta `npm run deploy`.
Mientras lo arreglas, desactiva «Usar el dominio de mi tienda» en Ajustes: los
enlaces pasarán a usar el dominio de la app, que siempre funciona.

**No se prepara nada a las 03:00**
Tres causas, por orden de probabilidad:
1. La app no estaba encendida (estás en local). Ver el aviso del apartado 2.
2. La automatización está desactivada en Ajustes.
3. Tu host apaga el proceso → configura `/api/cron` (apartado 6.5).

Mira la pestaña **Historial**: si no hay ninguna línea a esa hora, es el caso 1
o 3. Si hay una línea con «Omitida», te dirá el motivo.

**«Sin líneas pendientes de preparar»**
Ese pedido no tiene nada preparable: ya está enviado, está en una ubicación
gestionada por otro servicio de fulfillment, o requiere aprobación previa.

**Errores de permisos al preparar**
Faltan permisos de fulfillment. Comprueba que `scopes` en `shopify.app.toml`
coincide con el de `.env.example`, ejecuta `npm run deploy` y vuelve a abrir la
app para aceptarlos.

**Ver la base de datos por dentro**

```bash
npm run studio     # abre Prisma Studio en el navegador
```

---

## 10. Cómo está hecha

React Router 7 + Vite · Prisma · Polaris web components + App Bridge ·
API Admin GraphQL de Shopify `2025-10`. Sin dependencias añadidas sobre la
plantilla oficial de Shopify: el planificador y el cálculo de zonas horarias
son código propio.

```
app/
  lib/
    tracking.ts               Formato de los números (puro, servidor + navegador)
    tracking.server.ts        Generación de números únicos
    time.ts                   Zonas horarias y sorteo de la hora en la ventana
    settings.server.ts        Ajustes por tienda, con validación
    fulfillment.server.ts     Motor: busca pedidos y crea los fulfillments
    scheduler.server.ts       Temporizador y reserva atómica del turno
    transit.server.ts         Recorrido simulado del envío (determinista)
    tracking-lookup.server.ts Búsqueda pública + limitador de peticiones
    tracking-html.server.ts   Render del bloque de seguimiento
    shared.ts                 Etiquetas y formatos compartidos
    install.server.ts         Alta y baja de tiendas
  routes/
    app._index.tsx            Panel
    app.orders.tsx            Pedidos pendientes
    app.shipments.tsx         Envíos (+ exportación CSV)
    app.settings.tsx          Ajustes
    app.logs.tsx              Historial
    track.tsx                 Página pública (dominio de la app)
    proxy.tsx, proxy.$.tsx    Página pública (dominio de la tienda)
    api.track.$number.tsx     API JSON
    api.cron.tsx              Disparador externo del planificador
    healthz.tsx               Comprobación de estado
    webhooks.*.tsx            Webhooks de Shopify
extensions/
  eu-tracker-courier/         Bloque de seguimiento para el tema
scripts/
  selftest.ts                 Prueba de la lógica crítica
  seed-demo.ts                Envío de ejemplo para ver la página pública
```

### Comandos

```bash
npm run dev         # Desarrollo con túnel y recarga en caliente
npm run build       # Compilar para producción
npm start           # Servir la versión compilada
npm run deploy      # Subir configuración y extensiones a Shopify
npm run selftest    # Probar la lógica crítica
npm run seed:demo   # Crear un envío de ejemplo
npm run studio      # Ver la base de datos
npm run typecheck   # Comprobar tipos
npm run lint        # Estilo de código
```

### Detalles de implementación que importan

- **Idempotencia**: `Shipment` tiene una clave única `(shop, orderId)`. Un
  pedido no se puede preparar dos veces ni aunque se solapen ejecuciones.
- **Reserva del turno**: antes de ejecutar, el planificador reserva la hora con
  un `updateMany` condicionado a `nextRunAt`. Si tienes varias instancias del
  servidor, solo una prepara los pedidos.
- **Reintentos**: las llamadas a Shopify reintentan con espera creciente ante
  `THROTTLED`, 429 y errores 5xx.
- **Cambios de horario**: el inicio y el fin de la ventana se calculan como
  hora de pared, no sumando milisegundos. En la noche en que los relojes se
  adelantan y las 02:00 no existen, la hora sorteada sigue cayendo dentro del
  rango.
- **Al desinstalar** se borran las sesiones y se apaga la automatización, pero
  **los envíos se conservan**: los enlaces que ya tienen tus clientes siguen
  funcionando, y si reinstalas recuperas el historial.
