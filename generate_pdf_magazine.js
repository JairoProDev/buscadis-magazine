const fs = require('fs').promises;
const path = require('path');
const puppeteer = require('puppeteer');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { URL } = require('url'); // Para manejar file:// URLs

// --- Helper Functions ---

async function loadJsonData(filepath) {
  try {
    const absolutePath = path.resolve(filepath);
    console.log(`Cargando datos desde: ${absolutePath}`);
    const fileContent = await fs.readFile(absolutePath, 'utf-8');
    const data = JSON.parse(fileContent);
    if (!Array.isArray(data)) {
      console.warn(`Advertencia: JSON ${filepath} no es un array.`);
      return null;
    }
    console.log(`Se cargaron ${data.length} publicaciones desde ${filepath}.`);
    return data;
  } catch (error) {
    // ... (manejo de errores igual que antes) ...
    if (error.code === 'ENOENT') {
      console.error(`Error: Archivo no encontrado en ${filepath}`);
    } else if (error instanceof SyntaxError) {
      console.error(`Error: No se pudo decodificar JSON desde ${filepath}. Revisa el formato (no comentarios, no comas finales).`);
    } else {
      console.error(`Error inesperado al leer ${filepath}: ${error.message}`);
    }
    return null;
  }
}

// --- Formateo de Datos ---

function groupPubsByCategory(publications) {
  const grouped = {};
  if (!publications || publications.length === 0) return grouped;

  // Mapeo de slugs a nombres (Personalizar según sea necesario)
   const categoryNames = {
     'inmuebles': 'Inmuebles',
     'vehiculos': 'Vehículos',
     'empleos': 'Empleos',
     'servicios': 'Servicios',
     'productos': 'Productos',
     'mascotas': 'Mascotas',
     'comunidad': 'Comunidad',
     'negocios': 'Negocios',
     // ... añadir más ...
   };

  publications.forEach(pub => {
    const categorySlug = pub.categorySlug || 'sin-categoria';
    // Usar nombre amigable o capitalizar slug
    const categoryDisplayName = categoryNames[categorySlug] ||
      categorySlug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    if (!grouped[categoryDisplayName]) {
      grouped[categoryDisplayName] = [];
    }
    grouped[categoryDisplayName].push(pub);
  });

  console.log(`Publicaciones agrupadas en ${Object.keys(grouped).length} categorías.`);
  return grouped;
}

function formatPrice(pub) {
  const amount = pub.amount;
  const currency = pub.currency;
  const negotiable = pub.negotiable || false;

  let priceStr = "Consultar Precio"; // Mensaje por defecto más claro

  if (amount === 0) {
    priceStr = "Gratis";
  } else if (amount !== null && amount !== undefined) {
    const currencySymbol = currency === 'PEN' ? 'S/' : currency === 'USD' ? '$' : '';
    try {
      // Usar Intl para formateo localizado robusto
      priceStr = `${currencySymbol} ${new Intl.NumberFormat('es-PE', { style: 'decimal', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}`;
    } catch (e) {
      priceStr = `${currencySymbol} ${amount}`; // Fallback si no es número
    }
  }

  if (negotiable && amount !== null && amount !== undefined) {
    priceStr += " (Negociable)";
  }
  return priceStr;
}

function formatLocation(pub) {
  const loc = pub.location || {};
  const parts = [];
  // Podríamos añadir íconos aquí con HTML/CSS si quisiéramos
  if (loc.district) parts.push(`${loc.district}`);
  if (loc.address) parts.push(loc.address);
  if (loc.referencePoint) parts.push(`(Ref: ${loc.referencePoint})`);
  return parts.filter(Boolean).join(', ');
}

function formatContact(pub) {
  const contact = pub.contact || {};
  const parts = [];
  // Íconos podrían añadirse con clases y CSS ::before
  if (contact.name) parts.push(`<span class="contact-name">${contact.name}</span>`);
  if (contact.phones && contact.phones.length > 0) {
    parts.push(`<span class="contact-phone">Tel: ${contact.phones.join(' / ')}</span>`);
  }
  if (contact.email) {
    parts.push(`<span class="contact-email">Email: ${contact.email}</span>`);
  }
  return parts.filter(Boolean).join('<br>');
}

function formatAttributes(pub) {
  const attrs = pub.attributes;
  if (!attrs || typeof attrs !== 'object' || Object.keys(attrs).length === 0) {
    return "";
  }

  let html = '<ul class="attributes">\n';
  for (const [key, value] of Object.entries(attrs)) {
    // Omitir claves si el valor es null, undefined o string vacío
    if (value !== null && value !== undefined && value !== '') {
      // Mejorar formato de etiqueta: 'area_m2' -> 'Área m²', 'ano' -> 'Año'
      let label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      if (key === 'area_m2') label = 'Área m²';
      if (key === 'ano') label = 'Año';
      // Añadir más mapeos si es necesario

      let valueStr;
      if (typeof value === 'boolean') {
        valueStr = value ? 'Sí' : 'No';
      } else if (Array.isArray(value)) {
         // Formatear arrays de forma legible
         valueStr = value.map(item => String(item).replace(/_/g, ' ')).join(', ');
      }
      else {
        valueStr = String(value);
      }
      html += `  <li><span class="attr-label">${label}:</span> <span class="attr-value">${valueStr}</span></li>\n`;
    }
  }
  html += '</ul>\n';
  // Solo devolver si la lista tiene elementos
  return html.includes('<li>') ? html : '';
}

function formatPublicationHtml(pub) {
  const title = pub.title || 'Publicación sin título';
  const description = pub.description || ''; // Usar string vacío si no hay descripción
  const images = pub.images || [];

  let imageHtml = "";
  if (images && Array.isArray(images) && images.length > 0 && images[0]) {
    let imageUrl = images[0];
    // Convertir rutas locales a URLs file:// ABSOLUTAS si es necesario
    // Esto asume que las rutas en el JSON son relativas al CWD o ya son absolutas
    try {
        // Intentar resolver como ruta local absoluta
        const absolutePath = path.resolve(imageUrl);
        // Verificar si el archivo existe antes de crear la URL
        // await fs.access(absolutePath); // Esto haría la función async, complica un poco
        // Convertir a URL file:// (importante para Puppeteer)
        imageUrl = new URL(`file://${absolutePath}`).href;
        imageHtml = `<div class="pub-image-container"><img src="${imageUrl}" alt="${title}" class="pub-image"></div>\n`;
    } catch (err) {
        // Si no es una ruta local válida o da error, intentar usarla como URL directa
         if (imageUrl.startsWith('http:') || imageUrl.startsWith('https:')) {
             imageHtml = `<div class="pub-image-container"><img src="${imageUrl}" alt="${title}" class="pub-image"></div>\n`;
         } else {
              console.warn(`Advertencia: No se pudo resolver la ruta de imagen local o no es URL: ${images[0]}`);
              imageHtml = ""; // No incluir imagen si la ruta es inválida
         }
    }
  }

  const priceHtml = `<div class="pub-price">${formatPrice(pub)}</div>`;
  const locationHtml = `<div class="pub-location">${formatLocation(pub)}</div>`;
  const contactHtml = `<div class="pub-contact">${formatContact(pub)}</div>`;
  const attributesHtml = formatAttributes(pub);

  let createdAtStr = "";
  if (pub.createdAt) {
    try {
      const dtObject = new Date(pub.createdAt);
      createdAtStr = `<div class="pub-date">Publicado: ${dtObject.toLocaleDateString('es-PE')}</div>`;
    } catch (e) { /* Ignorar fecha inválida */ }
  }

  // Estructura más semántica y con clases para CSS
  return `
    <article class="publication">
      ${imageHtml}
      <div class="pub-content">
        <h3 class="pub-title">${title}</h3>
        ${priceHtml}
        ${description ? `<p class="pub-description">${description}</p>` : ''}
        ${attributesHtml}
        ${locationHtml}
        ${contactHtml}
        ${createdAtStr}
      </div>
    </article>
  `;
}

// --- Generación de HTML y CSS ---

function generateMagazineHtml(groupedPubs, magazineTitle) {

  // CSS Mejorado para Diseño Premium y 2 Columnas
  const cssStyles = `
    /* Importar Fuente (Ejemplo: Lato desde Google Fonts) */
    @import url('https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700&display=swap');

    /* Variables CSS para fácil personalización */
    :root {
      --font-family-sans: 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
      --primary-color: #0056b3; /* Azul Buscadis (ajustar) */
      --secondary-color: #f0f4f8; /* Gris azulado claro */
      --accent-color: #007bff; /* Azul más brillante para precios/links */
      --text-color: #333333;
      --text-color-light: #555555;
      --border-color: #dce4ec; /* Borde suave */
      --border-color-dark: #b0c4de;
      --column-gap: 1.2cm;
      --page-margin: 1.8cm; /* Margen general un poco más amplio */
    }

    @page {
      size: A4;
      margin: var(--page-margin);

      @bottom-center {
        content: "Página " counter(page) " de " counter(pages);
        font-family: var(--font-family-sans);
        font-size: 8pt; /* Más pequeño */
        color: #888;
        vertical-align: top; /* Alinear arriba del margen inferior */
        padding-top: 5pt;
      }

      @top-center {
        content: element(header);
        font-family: var(--font-family-sans);
        font-size: 9pt;
        color: var(--text-color-light);
        vertical-align: bottom; /* Alinear abajo del margen superior */
        padding-bottom: 10pt;
        border-bottom: 0.5pt solid var(--border-color);
      }
    } /* Fin @page */

    body {
      font-family: var(--font-family-sans);
      line-height: 1.5; /* Ligeramente más espaciado */
      color: var(--text-color);
      font-size: 9.5pt; /* Tamaño base */
      font-weight: 300; /* Fuente más ligera por defecto */
       /* Habilitar columnas para el cuerpo */
       column-count: 2;
       column-gap: var(--column-gap);
       column-fill: balance; /* Intentar balancear columnas */
    }

    .magazine-header {
      position: running(header);
      text-align: center;
      font-weight: 400;
    }

    /* Título Principal (Solo en la primera página idealmente, difícil con CSS puro) */
    h1.main-title {
      text-align: center;
      color: var(--primary-color);
      font-weight: 700; /* Más grueso */
      font-size: 24pt;
      margin-bottom: 1cm;
      border-bottom: 1pt solid var(--primary-color);
      padding-bottom: 0.3cm;
      /* Hacer que el H1 ocupe ambas columnas */
       column-span: all;
       page-break-after: avoid; /* No cortar justo después */
    }

     /* Contenedor principal para habilitar columnas si 'body' no funciona bien */
     main.content-wrapper {
       /* Descomentar si se usa wrapper en lugar de body para columnas */
       /* column-count: 2; */
       /* column-gap: var(--column-gap); */
       /* column-fill: balance; */
     }

    /* Títulos de Categoría */
    .category-section h2 {
      background-color: var(--secondary-color);
      color: var(--primary-color);
      padding: 0.3cm 0.5cm;
      margin: 0.8cm 0 0.5cm 0; /* Margen superior aumentado */
      border-left: 3pt solid var(--primary-color);
      font-size: 14pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      /* Ocupar ambas columnas */
       column-span: all;
       page-break-before: always; /* Empezar cada categoría en nueva columna/página si es posible */
       page-break-after: avoid; /* Evitar corte justo después */
       break-before: column; /* Preferir iniciar en nueva columna */
       break-after: avoid;
    }
     /* Evitar que la PRIMERA categoría tenga un salto de página/columna antes */
     section.category-section:first-of-type h2 {
         page-break-before: auto;
         break-before: auto;
     }


    /* Estilo de cada Publicación */
    .publication {
      border: 1pt solid var(--border-color);
      background-color: #ffffff;
      padding: 0.4cm; /* Espaciado interno */
      margin-bottom: 0.6cm; /* Espacio entre anuncios */
      border-radius: 4px; /* Bordes redondeados sutiles */
      overflow: hidden;
       /* ¡CLAVE! Evitar que el anuncio se rompa entre columnas/páginas */
       break-inside: avoid;
       page-break-inside: avoid;
       box-shadow: 0 1px 3px rgba(0,0,0,0.05); /* Sombra muy sutil */
       display: flex; /* Usar Flexbox para layout interno (imagen | contenido) */
       flex-direction: row;
       gap: 0.4cm;
    }

     .publication:last-child {
         margin-bottom: 0; /* Eliminar margen inferior del último anuncio en una sección */
     }

     /* Contenedor de Imagen */
     .pub-image-container {
       flex-shrink: 0; /* Evitar que la imagen se encoja */
       width: 80px; /* Ancho fijo para la imagen */
       /* max-height: 80px; /* Opcional: limitar altura */
       display: flex;
       align-items: flex-start; /* Alinear arriba */
     }
     .pub-image {
       width: 100%;
       height: auto;
       max-height: 80px; /* Limitar altura si es muy alta */
       object-fit: cover; /* Cubrir sin distorsionar */
       border-radius: 3px;
       border: 1pt solid var(--border-color);
     }

    /* Contenedor del Contenido Principal del Anuncio */
     .pub-content {
         flex-grow: 1; /* Ocupar el espacio restante */
         display: flex;
         flex-direction: column;
     }


    .pub-title {
      margin-top: 0;
      margin-bottom: 0.2cm;
      color: var(--primary-color);
      font-size: 11pt;
      font-weight: 700;
      line-height: 1.3;
    }

    .pub-price {
      font-weight: 700;
      color: var(--accent-color);
      margin-bottom: 0.25cm;
      font-size: 10.5pt;
    }

    .pub-description {
      margin-bottom: 0.35cm;
      font-size: 9pt;
      line-height: 1.45;
      font-weight: 400; /* Normal */
      color: var(--text-color-light);
      text-align: left; /* Justificado puede verse mal en columnas estrechas */
    }

    .pub-location, .pub-contact, .pub-date {
      font-size: 8.5pt; /* Más pequeño */
      color: var(--text-color-light);
      margin-bottom: 0.15cm;
      line-height: 1.4;
      font-weight: 400;
    }
     .pub-location::before, .pub-contact::before, .pub-date::before {
         /* Opcional: Añadir íconos con FontAwesome o SVGs */
         /* content: '\\f3c5 '; /* Ejemplo FontAwesome: map-marker-alt */
         /* font-family: 'Font Awesome 5 Free'; */
         /* font-weight: 900; */
         /* margin-right: 5px; */
         /* color: var(--primary-color); */
     }


    /* Lista de Atributos */
    .attributes {
      list-style: none;
      padding: 0.3cm 0 0.2cm 0; /* Espaciado vertical */
      margin: 0.35cm 0 0.3cm 0;
      font-size: 8.5pt;
      color: var(--text-color-light);
      border-top: 1pt dashed var(--border-color);
       /* Layout de 2 columnas para atributos si hay muchos */
       /* column-count: 2; */
       /* column-gap: 1cm; */
       /* break-inside: avoid; */
    }
    .attributes li {
      margin-bottom: 0.15cm;
       /* Evitar que un item de la lista se rompa */
       break-inside: avoid;
       page-break-inside: avoid;
       display: flex; /* Alinear etiqueta y valor */
       justify-content: space-between;
       gap: 5px;
    }
    .attributes .attr-label {
      color: var(--text-color);
      font-weight: 700; /* Negrita para la etiqueta */
      flex-shrink: 0; /* No encoger la etiqueta */
       /* min-width: 70px; */ /* Quitado para que flex maneje el espacio */
    }
     .attributes .attr-value {
         text-align: right; /* Alinear valor a la derecha */
         font-weight: 400;
     }

    footer {
      /* El footer se maneja principalmente con @page bottom-center */
      /* Puedes añadir estilos aquí si quieres un footer en el flujo normal (no recomendado con @page) */
    }
  `; // Fin de cssStyles

  let htmlPublicationsContent = "";
  const sortedCategories = Object.keys(groupedPubs).sort();

  for (const categoryName of sortedCategories) {
    htmlPublicationsContent += `    <section class="category-section">\n`;
    htmlPublicationsContent += `      <h2>${categoryName}</h2>\n`;
    const pubsInCategory = groupedPubs[categoryName]; // Asumiendo que ya está ordenado si se desea
    for (const pub of pubsInCategory) {
      htmlPublicationsContent += formatPublicationHtml(pub);
    }
    htmlPublicationsContent += '    </section>\n';
  }

  // HTML Completo
  const fullHtml = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>${magazineTitle}</title>
    <style>${cssStyles}</style>
</head>
<body>
    <div class="magazine-header">${magazineTitle} - Buscadis.com - Edición [FECHA]</div>

    <h1 class="main-title">${magazineTitle}</h1>

    <main class="content-wrapper">
        ${htmlPublicationsContent}
    </main>

    <footer></footer>
</body>
</html>`;

  console.log("Estructura HTML avanzada generada.");
  return fullHtml;
}


// --- Guardado de PDF ---

async function savePdf(htmlContent, outputFilePath) {
  let browser = null;
  try {
    console.log("Iniciando Puppeteer...");
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        // Optimización: Deshabilitar GPU si no es necesaria (puede ayudar en servidores)
         '--disable-gpu',
         '--font-render-hinting=none' // Puede mejorar renderizado de fuentes
      ]
    });
    const page = await browser.newPage();

    // Optimización: Interceptar requests innecesarios (ej. scripts, si los hubiera)
    // await page.setRequestInterception(true);
    // page.on('request', (req) => {
    //   if (['script', 'stylesheet_other_than_fonts'].includes(req.resourceType())) {
    //     req.abort();
    //   } else {
    //     req.continue();
    //   }
    // });

    console.log("Estableciendo contenido HTML...");
    // Usar waitUntil: 'networkidle0' es importante si se cargan fuentes externas o imágenes
    await page.setContent(htmlContent, { waitUntil: 'networkidle0', timeout: 60000 }); // Aumentar timeout si es necesario

    // Opcional: Emular media type 'print' explícitamente
    await page.emulateMediaType('print');

    console.log(`Generando PDF: ${outputFilePath}`);
    await page.pdf({
      path: outputFilePath,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true, // Necesario para que @page header/footer funcione
      headerTemplate: `<span></span>`, // Usar el de CSS @page
      footerTemplate: `<span></span>`, // Usar el de CSS @page
      margin: { // Puppeteer necesita esto aunque usemos @page margins, asegura espacio
        top: '0cm', // Márgenes controlados por @page en CSS
        right: '0cm',
        bottom: '0cm',
        left: '0cm'
      },
      // Opcional: Mejorar calidad de vectores/fuentes
      // preferCSSPageSize: true // Usar tamaño definido en @page
    });

    console.log(`PDF generado exitosamente: ${outputFilePath}`);
    return true;

  } catch (error) {
    console.error("Error generando PDF con Puppeteer:", error);
    return false;
  } finally {
    if (browser) {
      console.log("Cerrando Puppeteer...");
      await browser.close();
    }
  }
}

// --- Ejecución Principal ---
async function main() {
    const argv = yargs(hideBin(process.argv))
        .usage('Uso: node $0 [opciones] <archivo_json...> ')
        .option('o', { /* ... igual que antes ... */
            alias: 'output',
            description: 'Ruta del archivo PDF de salida',
            type: 'string',
            default: 'buscadis_revista_premium.pdf' // Nuevo nombre por defecto
        })
         .option('t', { /* ... igual que antes ... */
             alias: 'title',
             description: 'Título para la revista PDF',
             type: 'string',
             default: 'Revista de Clasificados Buscadis'
         })
        .demandCommand(1, 'Debes proporcionar al menos un archivo JSON de entrada.')
        .help('h')
        .alias('h', 'help')
        .argv;

    const jsonFiles = argv._;
    const outputFilePath = path.resolve(argv.output);
    const magazineTitle = argv.title;

    let allPublications = [];
    console.log("Iniciando generación de revista PDF Premium...");

    for (const jsonFilePath of jsonFiles) {
        const pubsData = await loadJsonData(jsonFilePath);
        if (pubsData) {
            allPublications = allPublications.concat(pubsData);
        }
    }

    if (allPublications.length === 0) {
        console.log("No se encontraron datos válidos. Abortando.");
        return;
    }

    console.log(`Total de publicaciones cargadas: ${allPublications.length}`);
    // Opcional: Ordenar publicaciones globalmente antes de agrupar (ej. por fecha si existe)
    // allPublications.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    const groupedPubs = groupPubsByCategory(allPublications);
    const htmlOutput = generateMagazineHtml(groupedPubs, magazineTitle);

    // Guardar el HTML intermedio (opcional, útil para depurar CSS)
    // const htmlDebugPath = outputFilePath.replace(/\.pdf$/i, '.html');
    // await fs.writeFile(htmlDebugPath, htmlOutput, 'utf-8');
    // console.log(`HTML intermedio guardado en: ${htmlDebugPath}`);

    const success = await savePdf(htmlOutput, outputFilePath);

    if (success) {
      console.log("\nProceso de generación de revista finalizado con éxito.");
    } else {
      console.error("\nNo se pudo generar el PDF. Revisa los logs.");
      // No guardar HTML si falla, ya se guardó arriba opcionalmente.
    }
}

// Ejecutar
main().catch(error => {
  console.error("Error fatal en la ejecución:", error);
  process.exit(1);
});