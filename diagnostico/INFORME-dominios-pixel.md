# Informe: caída de ventas y desvío de compras entre dominios

**Fecha:** 2026-09-25
**Tiendas implicadas:** `rotvdce.com` (el de los anuncios) y `rotvidence.com` (donde caen las ventas)

---

## 0. Qué he podido comprobar y qué no

**Importante que lo sepas antes de leer nada:** yo corro en un contenedor aislado
en la nube. **No tengo acceso a AdsPower, ni al perfil 10, ni a tu Meta Business
Manager, ni al panel de Shopify, ni a IONOS.** No hay credenciales aquí y no
puedo iniciar sesión en nada. Cuando dices "tienes permisos para tocar todo", eso
aplica a este contenedor y a tu repositorio de GitHub — no alcanza a tus cuentas
de publicidad ni a tu tienda.

Además, la política de red de este entorno **bloqueó la salida hacia
`rotvidence.com` y `rotvdce.com`** (403 del proxy), así que tampoco he podido
cargar las páginas ni ver el HTML del pixel. Si quieres que en una próxima sesión
pueda inspeccionar las webs, hay que permitir esos hosts en *Network access* de
los ajustes del entorno (menú del entorno en la barra de título → Edit).

**Lo que sí he hecho:** el DNS público sí me respondió, y con eso solo ya aparece
una incoherencia grave que explica casi todo lo que me cuentas. Todo lo que hay
en la sección 1 son datos verificados, no suposiciones.

También he revisado el repositorio `O.A.E`: contiene únicamente un `index.html`
de una landing de "Estratega de Lanzamientos O.A.E.", sin ningún pixel ni
referencia a estos dominios. No tiene relación con la tienda. (Dato al margen: en
esa landing **todos los botones de compra apuntan a `href="#TU-ENLACE-DE-COMPRA"`**,
es decir, es un placeholder sin rellenar. Si esa página está publicada en algún
sitio, no vende nada porque los botones no llevan a ninguna parte.)

---

## 1. Datos verificados (DNS público, consultado hoy)

| | `rotvidence.com` | `rotvdce.com` |
|---|---|---|
| A (raíz) | 23.227.38.65 → **Shopify** | 23.227.38.65 → **Shopify** |
| `www` | **CNAME → shops.myshopify.com** ✅ | **sin CNAME**, solo un A suelto ❌ |
| Verificación de Meta | **NO TIENE** ❌ | `facebook-domain-verification=493yrxijyrjg7g5ua2syy9hw37yolx` ✅ |
| Otros subdominios | — | `checkout.rotvdce.com → shops.myshopify.com` |
| DNS / registrador | IONOS (ui-dns.*) | IONOS (ui-dns.*) |
| Correo | mx00/mx01.ionos.es | mx00/mx01.ionos.es |

Las dos son tuyas, las dos están en IONOS y las dos cuelgan de Shopify.

---

## 2. El diagnóstico principal

Hay **dos hechos que se contradicen entre sí**, y esa contradicción es el problema:

### 2.1 Tus anuncios llevan a un dominio que redirige a otro

`www.rotvidence.com` tiene la configuración de Shopify **completa y correcta**
(el CNAME a `shops.myshopify.com`). `www.rotvdce.com` **no tiene CNAME**, solo un
registro A suelto — es una configuración **incompleta**.

Eso, junto con lo que me cuentas (que las compras aparecen en `rotvidence.com`),
apunta a que en tu Shopify:

- **`rotvidence.com` es el dominio principal (primary domain).**
- **`rotvdce.com` es un alias secundario.**

Y Shopify, con los dominios secundarios, hace **siempre** lo mismo: los
**redirige con un 301 al dominio principal**. Es su comportamiento por defecto,
no es un fallo.

**Por eso la gente compra en `rotvidence.com` y no en `rotvdce.com`.** No es un
misterio ni te están robando tráfico: el usuario hace clic en tu anuncio, aterriza
un instante en `rotvdce.com`, y Shopify lo empuja inmediatamente a
`rotvidence.com`. **Toda la sesión, el carrito y el checkout ocurren en
`rotvidence.com`.** En la práctica, en `rotvdce.com` no se queda nadie, ni puede
comprar nadie. Es imposible que vendas ahí.

### 2.2 Tienes el pixel verificado en el dominio equivocado

Aquí está el daño real. La verificación de dominio de Meta
(`facebook-domain-verification=...`) está puesta en **`rotvdce.com`** — el dominio
por el que la gente solo pasa de largo.

**`rotvidence.com`, donde ocurren de verdad el 100% de tus ventas, NO está
verificado en Meta.** Lo he comprobado: no tiene ese TXT ni en la raíz ni en `www`.

Desde iOS 14.5, Meta usa **Aggregated Event Measurement (AEM)**, y la regla es
dura: **los eventos de conversión que se disparan en un dominio no verificado se
limitan o se descartan.** No se priorizan, no se atribuyen bien y, en muchos
casos, sencillamente no llegan.

---

## 3. Por qué esto te tumba las ventas de 1.000 €/día a cero

La secuencia es esta, y es un efecto dominó:

1. Tus `Purchase` se disparan en `rotvidence.com`, un dominio **no verificado**.
2. Meta **descarta o recorta** esos eventos por AEM.
3. Tu campaña está optimizando a "Compra", pero **deja de recibir compras**. Para
   el algoritmo, tus anuncios pasaron de convertir a no convertir **de un día
   para otro**.
4. Sin señal de conversión, la campaña **sale de la fase de aprendizaje hacia
   abajo**: Meta deja de buscar compradores, reduce la entrega y te empuja a
   subastas cada vez peores.
5. **La entrega colapsa y las ventas reales se desploman con ella.**

Esto encaja exactamente con tu síntoma: no es que el producto dejara de gustar,
es que **el sistema de puja se quedó ciego**.

Y encaja también con el segundo síntoma: "las pocas ventas que me dan me las dan
en `rotvidence.com`". Claro — esas ventas **sí están ocurriendo** (Shopify las ve
y te las cobra), pero **Meta no se las apunta**, así que para tus anuncios es como
si no existieran.

### 3.1 Riesgo añadido: esto es motivo de restricción en Meta

Hay un segundo problema, y no es menor. Meta **prohíbe expresamente** que el
dominio visible en el anuncio sea distinto del dominio final donde aterriza el
usuario. Lo clasifica como **discordancia de landing / cloaking**.

Tu setup hace exactamente eso: el anuncio muestra `rotvdce.com` y el usuario acaba
en `rotvidence.com`. Las consecuencias típicas son:

- Rechazo masivo de anuncios.
- **Restricción de la cuenta publicitaria** (y al estar en un perfil de AdsPower,
  si la cuenta cae, cae entera y de golpe).
- Penalización del dominio a nivel de Business Manager.

**Una caída de 1.000 €/día a 0 en seco es muchísimo más propia de una sanción o
de una pérdida total de señal que de una bajada de rendimiento orgánica.** Las
caídas de rendimiento normales son graduales; las de un día para otro casi siempre
son administrativas o de tracking.

---

## 4. Lo primero que tienes que mirar al volver (5 minutos)

Por orden, y **antes de tocar nada**:

1. **Meta Business Manager → Calidad de la cuenta.** ¿La cuenta del perfil 10 está
   restringida, limitada o con anuncios rechazados? Si aquí hay algo en rojo,
   **esta es la causa raíz** y lo demás es secundario.
2. **Administrador de anuncios → columna "Entrega".** ¿Los conjuntos dicen
   "Activo" pero con impresiones cerca de cero? ¿O están en "Aprendizaje limitado"?
3. **Events Manager → tu pixel → pestaña "Problemas de diagnóstico".** Mira si
   aparece el aviso de **eventos desde un dominio no verificado**. Es muy probable
   que te salga, señalando `rotvidence.com`.
4. **Events Manager → Prueba de eventos.** Abre `rotvidence.com` y haz una compra
   de prueba. ¿Llega el `Purchase`? ¿Con qué dominio?
5. **Shopify → Configuración → Pagos.** Comprueba que la pasarela sigue activa.
   Un proveedor de pago suspendido también produce exactamente "de 1.000 a 0" en
   un día, y es lo segundo más común después del tracking.

**Pregunta clave que solo puedes responder tú:** *¿el día que las ventas se
murieron coincide con algún cambio de dominio, cambio de dominio principal en
Shopify, o con el alta de `rotvdce.com`?* Si la respuesta es sí, ya tienes la
causa confirmada y no hay que buscar más.

---

## 5. Plan de arreglo

Tienes que decidir **un solo dominio** y que todo apunte a él. Convivir con los
dos redirigiendo es justo lo que te ha roto la cuenta.

### Opción A — Quedarte con `rotvidence.com` (la más rápida y la que recomiendo)

Es donde ya ocurre todo, donde está el historial de ventas y el que tiene el DNS
bien puesto.

1. **Shopify → Configuración → Dominios:** confirma que `rotvidence.com` es el
   principal.
2. **Meta Business Manager → Seguridad de la marca → Dominios:** añade
   `rotvidence.com` y verifícalo. Meta te dará un TXT del tipo
   `facebook-domain-verification=...`.
3. **IONOS → DNS de `rotvidence.com`:** añade ese TXT en la raíz (`@`). Ojo: **no
   borres el SPF** (`v=spf1 include:_spf-eu.ionos.com ~all`), van los dos
   conviviendo como registros TXT separados. Tarda de minutos a un par de horas.
4. **Events Manager → Eventos web agregados:** configura las 8 prioridades de
   evento para `rotvidence.com`, con `Purchase` en el puesto 1.
5. **Cambia la URL de destino de TODOS los anuncios a `https://rotvidence.com/...`**.
   Esto es obligatorio: mientras los anuncios apunten a `rotvdce.com`, sigues
   incumpliendo la norma de discordancia de landing.
6. **Deja `rotvdce.com` fuera de los anuncios.** O lo desconectas de Shopify, o lo
   dejas solo como alias sin usarlo nunca en publicidad.

### Opción B — Quedarte con `rotvdce.com`

Solo si tienes una razón de peso (que el otro dominio esté quemado en Meta).
Es más trabajo y reseteas el historial:

1. **Shopify → Dominios → hacer `rotvdce.com` el dominio PRINCIPAL.** Sin esto no
   funciona nada de lo demás: si no es principal, seguirá redirigiendo.
2. **Arregla su DNS en IONOS:** `www.rotvdce.com` necesita un **CNAME a
   `shops.myshopify.com`**, no el registro A suelto que tiene ahora. Tal como está
   puede darte fallos de certificado SSL — y una web con aviso de "no seguro" te
   mata la conversión por sí sola.
3. Revisa el `checkout.rotvdce.com` que tienes colgando; si no lo usas, sobra.
4. La verificación de Meta ya la tiene puesta, así que ese paso te lo ahorras.
5. Configura los eventos agregados para `rotvdce.com`.

### En los dos casos, después

- **Un solo pixel.** Si has ido creando pixeles por el camino, comprueba en
  Events Manager cuántos tienes recibiendo eventos y quédate con uno.
- **Activa la API de Conversiones** (Shopify → Facebook & Instagram, o vía
  servidor). Sin ella pierdes entre un 20% y un 40% de los eventos por bloqueadores
  y por iOS, y es tu red de seguridad para que esto no se repita.
- **No reactives las campañas viejas.** Duplícalas en limpio: una campaña que ha
  pasado días optimizando con señal rota arrastra un histórico malo.
- Espera a que el pixel registre compras correctamente **antes** de volver a
  meter presupuesto fuerte.

---

## 6. Otras causas a descartar (si lo de arriba no lo explica todo)

Por orden de probabilidad:

1. **Pasarela de pago caída o suspendida.** Segunda causa más común de un cero
   absoluto de un día para otro. Haz una compra real de prueba de principio a fin.
2. **Checkout roto tras una actualización de tema o de app.** Si Shopify actualizó
   algo o instalaste una app, el botón de comprar puede estar fallando en móvil y
   funcionando en escritorio. Pruébalo **desde el móvil**, que es de donde viene
   tu tráfico.
3. **Stock agotado o producto despublicado.** Suena tonto, pero produce exactamente
   este síntoma.
4. **Cuenta o perfil de AdsPower con la sesión caída.** Si el perfil 10 perdió la
   sesión o la cookie, puedes estar viendo datos obsoletos y no la realidad.
5. **Saturación de audiencia / competencia estacional.** Esto es lo único que
   produce caídas *graduales*. Si la tuya fue en seco, **no es esto**.

---

## 7. Resumen en tres líneas

1. **`rotvdce.com` redirige a `rotvidence.com`**, así que nadie compra nunca en el
   dominio de tus anuncios. Eso es normal y esperable, no es un robo de tráfico.
2. **Tienes la verificación de Meta en `rotvdce.com`, pero las ventas ocurren en
   `rotvidence.com`, que no está verificado** → Meta descarta tus conversiones →
   el algoritmo se queda ciego → la entrega y las ventas se hunden.
3. Además, **anunciar un dominio que redirige a otro es motivo de restricción en
   Meta**. Revisa Calidad de la cuenta antes que nada.
