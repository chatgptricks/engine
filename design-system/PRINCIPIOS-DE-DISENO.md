# Principios de diseño — extraídos de Engine

Sistema visual y de interacción del estudio (`app/admin/(tool)/engine/engine.css`, ~4.200 líneas, y `components/engine/`). Este documento lo resume en reglas para usar en otros proyectos. La implementación lista para copiar está en [`design-system.css`](./design-system.css).

> **La idea en una frase:** una herramienta oscura y monocroma hecha de vidrio esmerilado, donde el único color viene del contenido (las imágenes), la profundidad se expresa con translucidez y desenfoque en vez de bordes, y los controles flotan sobre el lienzo en píldoras.

---

## 0. Los diez mandamientos (resumen)

1. **Oscuro nativo, sin modo claro.** El lienzo es casi negro (`#0c0c0c`), nunca negro puro, y no lee el tema del sistema.
2. **Monocromo.** El estado se expresa con contraste, brillo y opacidad, **nunca con un matiz**. El color es del contenido.
3. **Sin bordes.** La separación viene de la translucidez, el blur y el valor tonal.
4. **La profundidad son niveles de vidrio.** Lo más cercano es más claro y más desenfocado; lo más profundo, más oscuro.
5. **La tinta tiene 4 opacidades:** 92 %, 58 %, 38 % y 20 %. No hay grises inventados.
6. **Píldoras para los controles, radios pequeños para las superficies.** 999px para botones y 6–14px para paneles y tarjetas.
7. **Una sola curva de easing** para todo: `cubic-bezier(0.22, 0.61, 0.36, 1)`.
8. **El chrome flota.** Barra superior fija, dock contextual abajo al centro y paneles separados de los bordes.
9. **La acción primaria es una píldora blanca invertida.** Hay una por zona.
10. **Destruir cuesta dos clics, sin rojo.** El botón pasa a píldora invertida con «¿Eliminar?» y vuelve solo a los 3 s.

---

## 1. Filosofía de color

### 1.1 Lienzo y tinta
| Token | Valor | Uso |
|---|---|---|
| `--canvas` | `#0c0c0c` | Fondo de la app. Casi negro, **no** `#000`. |
| `--ink` | `rgba(255,255,255,.92)` | Texto principal y estado activo. |
| `--ink-soft` | `rgba(255,255,255,.58)` | Texto secundario, cuerpo de ayuda y hover de controles inactivos. |
| `--ink-faint` | `rgba(255,255,255,.38)` | Metadatos, controles en reposo e iconos. |
| `--ink-ghost` | `rgba(255,255,255,.20)` | Placeholders, etiquetas de grupo y contadores inactivos. |

**Regla:** todo el texto y los iconos son blanco con alfa. Como no hay grises sólidos, la tinta se adapta a cualquier vidrio que tenga detrás.

**Escalera de estados de un control** (se repite en todo el proyecto):
`faint` (reposo) → `soft` (hover) → `ink` (activo / seleccionado).

### 1.2 Blancos funcionales (rellenos sobre el oscuro)
| Alfa blanco | Rol |
|---|---|
| `.03–.05` | Pozos muy sutiles (textareas y fondos de tiles vacíos) |
| `.06–.08` | Botón fantasma, chips y separadores fuertes |
| `.10` | `--glass-hi`: «lift» de hover/activo sobre vidrio |
| `.12–.16` | Hover de botones de toolbar y pista de interruptor apagado |
| `.92–.95` | Relleno invertido: primario, segmento activo, badge y switch encendido |
| `#fff` | Hover del primario |

Texto sobre relleno invertido: `#0a0a0a`, `#141414` o `#1a1a1a`.

### 1.3 Dónde sí se permite el color (excepciones deliberadas)
- **Contenido:** imágenes y vídeo. Es el único color «real» del estudio.
- **Badges semánticos de categoría:** tonos pastel apagados, solo en texto y borde (el borde con alfa 32 %) y sin relleno:
  dorado `#e7c98a`, azul `#9ec3e6` y verde `#a9d8b0`.
- **Avatares de canal:** paleta pastel para distinguir identidades:
  `#8a8f98 #a78bfa #7dd3fc #86efac #fcd34d #f9a8d4 #fda4af #c4b5fd`.
- **Páginas públicas** (login y onboarding): sistema secundario en OKLCH con un único acento azul (ver §12).

**Nunca:** rojo para errores o eliminar, verde para «éxito» ni azul para «seleccionado». Un error se comunica con copy y con más brillo, no con matiz.

---

## 2. Superficies: vidrio esmerilado por niveles

| Nivel | Fondo | Blur | Uso |
|---|---|---|---|
| **glass-1** (el más cercano) | `rgba(34,34,36,.74)` | `blur(30px) saturate(150%)` | Dock, popovers, modales/composer, barra de caption y chat |
| **glass-2** (medio) | `rgba(24,24,26,.64)` | `blur(22px) saturate(135%)` | Paneles laterales, botones de nav, búsqueda, flechas y back |
| **glass-3** (el más profundo) | `rgba(17,17,19,.68)` | `blur(14px) saturate(120%)` | Controles segmentados, pozos de input y placeholders |
| **glass-hi** | `rgba(255,255,255,.10)` | – | Capa de hover o activo encima de cualquiera de los anteriores |

Reglas:
- **Más cerca = más claro, más opaco y más blur.** El brillo codifica la profundidad.
- **Siempre `backdrop-filter` + `-webkit-backdrop-filter`.**
- **Dentro de una superficie de vidrio no se anida otra.** Si una píldora vive dentro del dock, pierde su fondo y su blur (`.dock .seg { background: transparent; backdrop-filter: none }`), y el dock queda como único vidrio.
- Sobre imágenes (badges y overlays de tarjeta) se usa **vidrio oscuro**: `rgba(10,10,10,.5)` + blur-far, y en hover `.74`.
- Las cabeceras *sticky* dentro de un panel vuelven a aplicar el mismo vidrio para que lo que se desplaza debajo no se transparente.

## 3. Bordes y separadores

- **Por defecto no hay bordes.**
- Hay excepciones que funcionan como hairlines:
  - separadores internos: `1px solid rgba(255,255,255,.06–.08)`
  - divisor vertical del dock: `1px × 22px`, `rgba(255,255,255,.1)`
  - campos del inspector y selects: `1px rgba(255,255,255,.08–.10)`, que en focus sube a `.28`
  - **borde discontinuo = «añadir / nuevo»**: `1.5px dashed rgba(255,255,255,.16)`, en hover `.42`
  - tarjeta activa en una lista: el borde sube de `.06` a `.22`
- **La selección es un anillo monocromo:** `outline: 1.5px solid rgba(255,255,255,.85); outline-offset: 3px`. El hover es un contorno más tenue (`1px .28`).

## 4. Forma

| Token | Valor | Uso |
|---|---|---|
| `--radius-sm` | 6px | Scrollbar, detalles pequeños |
| `--radius` | 9px | Tiles, inputs, opciones de menú, thumbs |
| `--radius-lg` | 12px | Tarjetas, paneles, popovers, composer |
| `--radius-xl` | 14px | Burbujas de chat |
| píldora | 999px | **Todos** los botones, segmentados, badges, búsqueda y dock |
| círculo | 50% | Botones solo-icono (back, cerrar, flechas y enviar), avatares y puntos |

Los radios son **reducidos** a propósito (en el código se cita «Cosmos reference»). El contraste entre píldoras muy redondas y superficies casi rectas es parte de la firma visual.

## 5. Sombra y elevación

| Token | Valor | Uso |
|---|---|---|
| `--shadow-soft` | `0 6px 22px rgba(0,0,0,.4)` | Tarjetas en reposo y paneles |
| `--shadow-lift` | `0 16px 44px rgba(0,0,0,.55)` | Dock, popovers, modales y hover de tarjeta |

- **Hover de tarjeta:** pasa de `soft` a `lift` con `translateY(-3px)`, y la imagen interior hace `scale(1.035)` en 0.5 s.
- **Elementos sobre imagen:** `drop-shadow` o `text-shadow` generosos (`0 1px 18px rgba(0,0,0,.45)`) para legibilidad.
- **Anillo de «drag over»:** `box-shadow: 0 0 0 1.5px rgba(255,255,255,.35), var(--shadow-lift)`.

## 6. Tipografía

### 6.1 Familias
- **UI:** Geist Sans (`--font-sans`) con antialiasing.
- **Serif de acento:** Libre Baskerville. **Todo `em`/`i` se renderiza en serif itálica**, un detalle editorial que marca la identidad.
- **Mono:** Geist Mono.
- Fuentes **autoalojadas** (`next/font/local`). Nunca se depende del CDN de Google en build, y en las fuentes de uso ocasional va `preload: false`.

### 6.2 Escala (UI densa, base 13px)
Se usan medios píxeles para afinar la jerarquía (12.5, 13.5, 14.5).

| Rol | Tamaño | Peso | Tracking | Extra |
|---|---|---|---|---|
| Título de página | 24–26px | 600 | `-0.02em` | |
| Título de detalle | 23px | 600 | `-0.02em` | line-height 1.22 |
| Título en tarjeta | 14.5px | 500 | `-0.01em` | clamp a 2 líneas |
| Input principal / composer | 15px | 400 | – | lh 1.55 |
| Cuerpo / caption | 13–14px | 400 | `-0.005em` | lh 1.55–1.65 |
| Botón / nav | 13px | 500 | `0.01em` | |
| Botón pequeño / segmentado | 11.5–12px | 400 / 500 activo | `0.02em` | |
| Metadatos | 11–12px | 400 | `0.02–0.06em` | |
| **Eyebrow / etiqueta de grupo** | 10–11px | 400 | `0.16–0.18em` | **MAYÚSCULAS**, ink-faint/ghost |
| Micro-etiqueta de campo | 9.5–10.5px | 400 | `0.08–0.1em` | MAYÚSCULAS |

Reglas:
- **Solo pesos 400, 500 y 600.**
- **Tracking negativo en lo grande y positivo en lo pequeño.**
- **`font-variant-numeric: tabular-nums`** en todo número que cambia: contadores, tiempos, «3/10» y sliders.
- Truncado con `-webkit-line-clamp: 2` en títulos y subtítulos, y `text-overflow: ellipsis` en nombres.
- Cabecera de página = **eyebrow** (sección, en mayúsculas) + **título** (vista actual).

## 7. Movimiento

- **Easing único:** `--ease: cubic-bezier(0.22, 0.61, 0.36, 1)` (desaceleración suave).
- **Duraciones por intención:**

| Duración | Para |
|---|---|
| 0.12–0.15s | Micro: aparición de acciones al hover, press |
| 0.18–0.20s | Cambios de color o fondo en controles |
| 0.22–0.25s | Layout: colapsar panel, focus de búsqueda, switch |
| 0.30s | Elevación de tarjeta |
| 0.40–0.60s | Entradas de pantalla, carga de imagen, giro 3D |
| 1.4–1.8s (loop) | Pulso de «trabajando…» |

- **Keyframes canónicos:**
  - `fade-in`: `opacity 0 → 1` + `translateY(6px) → 0`, para pantallas y tarjetas.
  - `pop`: `translateY(10px) scale(.985) → none`, para popovers y modales.
  - `dock-in`: sube 14px, para docks y barras flotantes.
  - `img-swap`: `opacity .2 → 1`, al cambiar de imagen.
  - `pulse`: `opacity .35 ↔ .7`, para estados de carga («Gathering stories…»).
- **Press:** `transform: scale(.97)` en el primario y `.92` en los botones circulares pequeños.
- **Imágenes:** empiezan en `opacity:0` sobre el color del lienzo y hacen fundido a 1 en 0.55s al cargar (`.is-loaded`).
- **Mientras se arrastra no hay transición:** al redimensionar paneles se quita la transición (`.is-dragging { transition:none }`) para seguir al cursor 1:1, y la animación de colapso se activa con una clase temporal (`.is-animating`).
- **`prefers-reduced-motion`:** todas las duraciones pasan a `0.001ms`.

## 8. Layout y arquitectura de pantalla

### 8.1 Shell
- La app es `position: fixed; inset: 0; overflow: hidden; overscroll-behavior: none`. Es una **app**, no una página que hace scroll.
- El scroll vive en contenedores internos (`flex:1; min-height:0; overflow-y:auto; overscroll-behavior: contain`).
- **Scrollbars finas:** 9px, pulgar `rgba(255,255,255,.14)` y `.26` en hover, con pista transparente.

### 8.2 Chrome flotante
- **Barra superior:** a la izquierda el logo y una píldora de navegación (o el botón back dentro de un detalle); a la derecha las acciones globales (secundaria + primaria).
- **Dock contextual inferior:** **una sola píldora de vidrio**, centrada, a 18px del borde y con `max-width: calc(100vw - 28px)`. Cada pantalla lo llena con sus controles y los separa con divisores verticales de 1px.
- **Paneles laterales:** flotan despegados de los bordes (`padding: 12px 0 18px 18px`), son **redimensionables** (una barra de 3px que aparece en hover) y **colapsables** (se quedan en un chevron).
- Un panel de edición **flota encima del escenario** para no descentrar el contenido principal.
- **Pila inferior:** los elementos flotantes que conviven (caption y chat) se apilan en una columna para que no se tapen (`gap: 10px`, `bottom: 84px` para dejar libre el dock).
- **El contenido reserva espacio para el chrome:** `padding-bottom` de 120 a 280px para que la última fila no quede bajo el dock.

### 8.3 Espaciado
Múltiplos cercanos a 2px, con valores que se repiten:
- Gutter de página: **26px** (22–26).
- Gap de grid de tarjetas: **26px**. Masonry: **18px**.
- Padding interno de panel: 12–18px. Popover: 8px. Opción de menú: `8px 10px`.
- Botones: `7px 13px` (pequeño) y `9px 15–16px` (nav y primario). Dock: `6px`.
- Contenido de lectura: máximo **640–760px** centrado.

### 8.4 Grids
- **Tarjetas:** `repeat(auto-fill, minmax(260px, 1fr))` con **aspect-ratio uniforme 4:5**, para tener filas niveladas y alineadas arriba. En este caso se prefirió un grid estable al masonry. Breakpoints: 200px a partir de 760px de ancho, y una columna a partir de 460px.
- **Galería de imágenes:** masonry con `column-width: var(--col)`. El slider de tamaño escribe la variable CSS directamente y **no provoca re-render de React**.

## 9. Componentes (patrones)

### Botones
| Tipo | Aspecto |
|---|---|
| **Primario** | Píldora blanca `rgba(255,255,255,.94)`, texto `#1a1a1a`, peso 500. Hover `#fff`, active `scale(.97)` |
| **Secundario / nav** | Píldora `glass-2` + blur-far, texto `ink-soft`. En hover pasa a `glass-hi` y `ink` |
| **Fantasma** (`.btn`) | Píldora `rgba(255,255,255,.07)`, 11.5px, `ink-soft` |
| **Herramienta** | Transparente, `ink-faint`. El hover añade `glass-hi` |
| **Solo icono** | Círculo de 30–44px, `glass-2` o transparente |
| **Toggle encendido** | `.is-on` → `glass-hi` + `ink`. En un chip, se invierte a blanco |
| **Deshabilitado** | `opacity: .4`, `cursor: default`. **Nunca se oculta** |

### Control segmentado y píldora de navegación
- Contenedor en píldora (`glass-3`, padding 3–4px) con botones en píldora dentro.
- Activo en **segmentado:** relleno blanco `.92` + texto oscuro + peso 500.
- Activo en **navegación:** `glass-hi` + `ink`, un paso más sutil.
- Los contadores dentro de un segmento van al 60 % de opacidad y con cifras tabulares.

### Menú popover («liquid glass»)
- `glass-1` + blur-near + `shadow-lift` + `radius-lg`, ancho aproximado de 222px y padding de 8px, con animación `pop`.
- **Backdrop invisible a pantalla completa** que captura el clic fuera. **Esc** también lo cierra.
- Estructura: etiqueta de grupo (10px en MAYÚSCULAS con tracking 0.16em, `ghost`) → opciones → separador de 1px al 8 % → siguiente grupo.
- **La selección se marca con un check** y texto a opacidad completa, **sin píldora**. El contador va a la derecha en `ghost`.
- **Botón disparador «sucio»:** cuando hay un filtro distinto del predeterminado, lleva un punto blanco de 6px en la esquina.

### Tarjeta de contenido
- **La tarjeta ES la imagen:** 4:5, `radius-lg` y `shadow-soft`.
- **Scrim inferior** con degradado `rgba(0,0,0,.85) → .55 (40%) → 0`, que contiene el título (con clamp de 2 líneas) y la fecha.
- **Badge de estado** arriba a la izquierda: píldora de vidrio oscuro con punto de 6px (`currentColor`) y texto de 10px en mayúsculas. El punto pulsa mientras «trabaja».
- **Acciones secundarias ocultas hasta el hover** arriba a la derecha (estrella y eliminar): `opacity:0; pointer-events:none`, visibles con `:hover` **y** `:focus-within`, y siempre visibles si están activas.
- **Placeholder** para cuando todavía no hay imagen: rayas diagonales a 135° con blanco al 2.5 % y al 5 %, más texto en mayúsculas.
- La tile «Nuevo» va siempre primera: borde discontinuo, icono en un círculo, título y subtítulo.

### Tiles de selección (galería)
- En reposo, `opacity: .72`; en hover, `.95`; **seleccionado: `1` + `shadow-lift`**. La jerarquía se construye con opacidad, no con bordes.
- **Badge de orden:** disco blanco de 28px con el número en oscuro (tabular, peso 600). Sin seleccionar, muestra un «+» en vidrio oscuro que aparece al hover.

### Formularios
- **Inputs sin borde** y transparentes dentro de un pozo de vidrio. El placeholder va en `ghost`.
- **El foco se indica aclarando el fondo del pozo** (`glass-hi`), no con un anillo de color. En los campos del inspector, el borde sube de `.08` a `.28`.
- **Campos estilo Figma:** micro-etiqueta en mayúsculas de 9.5px + valor tabular, dos por fila, con los spinners nativos ocultos.
- **Slider «hairline»:** pista de 1px al 22 % y pulgar blanco de 12px con sombra, `cursor: ew-resize`.
- **Switch:** 44×26, pista `.16` que al encenderse pasa a blanca `.92`; perilla oscura `#0c0c0c` de 20px que se desplaza 18px.
- **Textareas que crecen solas** según el contenido, con `max-height`.
- **Etiqueta de campo** (11px en MAYÚSCULAS con tracking 0.16em) seguida de una ayuda en `ink-soft` de 12.5px.

### Modal y lightbox
- Backdrop `rgba(0,0,0,.78–.82)` + `blur(8–10px) saturate(115%)`, con fundido de 0.2s.
- **El modal no lleva contenedor exterior:** la única superficie es el propio composer, centrado (`min(640px, 92vw)`).
- El lightbox mantiene la grilla quieta detrás (así no salta el scroll), tiene flechas laterales en círculos de vidrio y un panel de detalles de 320px que en móvil pasa debajo de la imagen.

### Composer (estilo chat)
- Textarea grande y transparente (15px), con una fila de adjuntos (miniaturas de 54px y chips) y un pie con herramientas a la izquierda y botón de enviar circular blanco (36px) a la derecha.
- Mensajes de chat: los del usuario, en burbuja `glass-hi` alineada a la derecha y con radio de 14px; los de la IA, como texto plano en `ink-soft`, sin burbuja.

### Badges
- **Badge de tipo:** 10.5px, peso 600, mayúsculas con tracking 0.07em, fondo `glass-hi` y borde al 16 %.
- **Nivel de verificación:** en vez de color se usa brillo: completo = píldora blanca; parcial = `glass-hi`; sin verificar = `glass-3` + `faint`.

### Manejadores de edición (canvas)
- Esquinas en forma de «L» blanca de 2.5px, con radio de 3–4px y `drop-shadow(0 1px 3px rgba(0,0,0,.55))`, visibles al 70 % y al 100 % en hover.
- **La posición de la esquina codifica la función:** abajo a la derecha, redimensionar; abajo a la izquierda con un punto, desplazar; arriba a la izquierda con un punto, zoom.
- Los cursores también comunican: `grab`/`grabbing`, `ew-resize`, `nwse-resize`, `move` y `zoom-in`.

## 10. Patrones de interacción

- **Eliminación en dos pasos, en el mismo sitio:** el primer clic cambia el icono por el texto «¿Eliminar?» en una píldora invertida blanca; el segundo clic confirma. Si no hay segundo clic en **3 s**, se desarma solo. No hace falta modal.
- **«Apartar» en lugar de archivar o borrar:** para esconder algo sin destruirlo.
- **Edición en vivo en el preview:** no hace falta abrir un panel para arrastrar, redimensionar o editar el texto en el sitio.
- **Barra flotante al seleccionar texto** (enriquecido): una píldora de vidrio con botones de 26px y separadores de 1px.
- **Las preferencias de UI persisten** en `localStorage` dentro de `try/catch` (tamaño de grilla y paneles abiertos).
- **Las acciones cambian de etiqueta mientras trabajan:** «Uploading…», «Searching X…», «Opening checkout…». El botón queda deshabilitado, pero no desaparece.
- Al volver de un flujo externo, la app **lleva al usuario a la pantalla relevante** y limpia la URL.
- **Toda la navegación con teclado:** las tarjetas llevan `role="button"` + `tabIndex=0` y responden a Enter/Espacio; Esc cierra los popovers.

## 11. Iconografía

- Iconos de línea en viewBox 24×24, `stroke-width: 1.6`, con extremos y uniones redondeados y sin relleno.
- **Siempre `currentColor`:** el estado lo decide el padre (color y opacidad), nunca el icono.
- Tamaños: 12 (check), 13–15 (dentro de botones), 16–18 (independientes).
- Van con `aria-hidden` y la etiqueta la lleva el botón (`aria-label`).
- El logo es un punto: una esfera con gradiente radial blanco y un leve resplandor, dentro de un cuadrado redondeado de vidrio.

## 12. Sistema secundario: páginas públicas (claro/oscuro)

Fuera del estudio (login y onboarding), la filosofía cambia a propósito y se vuelve más convencional:
- Tokens **OKLCH neutros** (croma 0) con modo claro y oscuro vía `next-themes` (`attribute="class"`, predeterminado `system`).
  - Claro: bg `oklch(.948 0 0)`, fg `.28`, muted `.55`, card `.99`, border `.88`.
  - Oscuro: bg `#0f0f0f`, fg `.88`, muted `.62`, card `.22`, border `.27`.
- **Acento único:** `oklch(.62 .19 254)` (azul), solo para el CTA principal de login.
- **Píldora «pill»:** el color invertido de la tinta, para los CTA de flujo.
- **Aquí sí hay bordes:** tarjetas `rounded-2xl` con borde `card-border`; inputs `rounded-xl` cuyo borde en focus pasa a `fg/40`.
- Columna estrecha (`max-w-md`) centrada, eyebrow en mayúsculas (11px con tracking 0.18–0.2em), H1 de 24–28px semibold con tracking ajustado y cuerpo de 14px con lh 1.65.
- Pasos de flujo como píldoras con borde, donde el paso actual tiene el borde más fuerte.
- Los enlaces secundarios se subrayan con un color de subrayado propio (`decoration-link-underline`, `underline-offset-4`).

## 13. Diseño editorial del contenido (plantillas de slide)

Para piezas exportables (4:5, 1080×1350):
- **Tres capas:** fondo (color sólido o blur de la misma imagen) → media (desplazable y con zoom) → texto.
- **Texto blanco sobre la imagen** con `text-shadow: 0 1px 18px rgba(0,0,0,.45)`.
- **Legibilidad con degradados**, no con cajas: `rgba(0,0,0,.82) → .25 (45%) → transparente (75%)` desde el borde donde va el texto. Un oscurecido plano al 40–42 % para texto centrado.
- **Fondo de blur:** la misma imagen con `scale(1.25) blur(34px) saturate(1.3) brightness(.62)` más un tinte al 32 %.
- **Tarjetas de media flotantes:** radio de 12–18px y sombra `0 18–22px 48–60px rgba(0,0,0,.5–.55)`.
- **Cita:** fondo `#0d0d0f`, comilla de 54px al 85 % y cita a 12px con opacidad .68.
- **Portada editorial clara:** papel crema `#f3eee3` y tinta `#1c1a17`, con una imagen principal centrada y el resto asomando por los bordes.
- **Crédito de imagen:** siempre en sans pequeño (8.5px para la descripción y 7.5px en mayúsculas para la fuente), sin importar la fuente del slide.
- Tipografía editable a través de variables CSS: `--textscale`, `--lhx`, `--textweight` y `--lspace`.
- Paleta de fuentes para contenido: serif (Libre Baskerville, Playfair, DM Serif, Lora, Cormorant, Crimson), sans (Geist, Inter, Space Grotesk, Montserrat, GT Walsheim, Century Gothic), display (Bebas Neue, PP Kyoto), mono (IBM Plex Mono) y manuscrita (Caveat).

## 14. Voz y microcopy

- **Sentence case** en todos los botones y títulos (en la UI inglesa: «Set aside», «Retry research», «Most recent»).
- **Tipografía correcta:** comillas curvas (“ ” ’), puntos suspensivos reales (…), raya (—) y «A–Z» con semirraya.
- **Estados humanos y en gerundio:** «Gathering stories…», «Researching…», «Didn’t finish» (en vez de «Failed»).
- **Los estados vacíos dicen qué hacer:** «No stories in this view yet — hit Research up top to start one.»
- **Tooltips que explican la mecánica:** «Drag to zoom the image inside (up-left bigger, down-right smaller)».
- **Los errores tranquilizan y dan la salida:** «Checkout was canceled — pick up where you left off whenever you’re ready.»
- Las etiquetas de filtro son cortas, con conteo al lado y sin iconos.

## 15. Accesibilidad

- `aria-label` en todos los botones de solo icono; `aria-pressed` en los toggles; `aria-current="page"` en la navegación; `aria-expanded`/`aria-haspopup` en los disparadores.
- Menús con `role="menu"`, `menuitem` y `menuitemradio` + `aria-checked`. El dock lleva `role="toolbar"`. La vista se cambia con `tablist`/`tab`.
- Las acciones que aparecen al hover también aparecen con `:focus-within`.
- Movimiento reducido respetado globalmente.
- `-webkit-tap-highlight-color: transparent` y `viewport-fit: cover`, con `interactive-widget: resizes-content` para teclados móviles.

## 16. Principios de ingeniería al servicio del diseño

- **Estilos con namespace** (`.gf-*`) y la hoja **importada solo en la ruta** que la usa, para que no se filtre al resto del sitio.
- **Tokens como variables CSS en el root del ámbito**, no en `:root` global, cuando el sistema es de una sola área.
- **Las interacciones continuas (sliders y drags) mutan variables CSS**, no el estado de React.
- **Animar transformaciones en el compositor** (un solo elemento que rota, no 36) y memoizar la escena.
- **Fuentes autoalojadas**, con fallbacks definidos para las licenciadas.
- **Los estados se expresan con clases `is-*`** (`is-active`, `is-on`, `is-open`, `is-selected`, `is-dirty`, `is-confirming`, `is-collapsed`, `is-dragging`, `is-loaded`, `is-busy`) y los atributos `data-*` se usan para variantes (`data-level`, `data-align`).
