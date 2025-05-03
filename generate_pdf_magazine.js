const fs = require('fs').promises; // Usar promesas para fs
const path = require('path');
const puppeteer = require('puppeteer');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

// --- Funciones Auxiliares (adaptadas a JS) ---

async function loadJsonData(filepath) {
  try {
    const absolutePath = path.resolve(filepath); // Asegurar ruta absoluta
    console.log(`Intentando cargar desde: ${absolutePath}`);
    const fileContent = await fs.readFile(absolutePath, 'utf-8');
    const data = JSON.parse(fileContent);
    if (!Array.isArray(data)) {
      console.warn(`Advertencia: Archivo JSON ${filepath} no contiene un array en el nivel superior.`);
      return null;
    }
    console.log(`Se cargaron ${data.length} publicaciones desde ${filepath}.`);
    return data;
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(`Error: Archivo no encontrado en ${filepath}`);
    } else if (error instanceof SyntaxError) {
      console.error(`Error: No se pudo decodificar JSON desde ${filepath}. Revisa el formato.`);
    } else {
      console.error(`Error inesperado al leer ${filepath}: ${error.message}`);
    }
    return null;
  }
}

function groupPubsByCategory(publications) {
  const grouped = {};

  if (!publications || publications.length === 0) {
    return grouped;
  }

  // Mapeo simple de slugs a nombres más amigables (¡Personaliza esto!)
   const categoryNames = {
     'inmuebles': 'Inmuebles',
     'vehiculos': 'Vehículos',
     'empleos': 'Empleos',
     'servicios': 'Servicios',
     'productos': 'Productos',
     'mascotas': 'Mascotas',
     'comunidad': 'Comunidad',
      // Añade más según tus categorías
   };

  publications.forEach(pub => {
    const categorySlug = pub.categorySlug || 'sin-categoria';
    const categoryDisplayName = categoryNames[categorySlug] || categorySlug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()); // Capitalize

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
  const negotiable = pub.negotiable || false; // Asume no negociable si no está

  let priceStr = "Consultar"; // Default si no hay amount

  if (amount === 0) {
    priceStr = "Gratis";
  } else if (amount !== null && amount !== undefined) {
    const currencySymbol = currency === 'PEN' ? 'S/' : currency === 'USD' ? '$' : '';
    // Formatear número (simple para MVP, puedes usar Intl.NumberFormat para algo más robusto)
    const formattedAmount = amount.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); // Ejemplo para Perú
    priceStr = `${currencySymbol} ${formattedAmount}`;
  }

  if (negotiable && amount !== null && amount !== undefined) {
    priceStr += " (Negociable)";
  }

  return priceStr;
}


function formatLocation(pub) {
  const loc = pub.location || {};
  const parts = [];
  // province es fijo 'Cusco', no lo añadimos
  if (loc.district) parts.push(loc.district);
  if (loc.address) parts.push(loc.address);
  if (loc.referencePoint) parts.push(`Ref: ${loc.referencePoint}`);
  return parts.filter(Boolean).join(', '); // Une las partes no vacías
}

function formatContact(pub) {
  const contact = pub.contact || {};
  const parts = [];
  if (contact.name) parts.push(`Contacto: ${contact.name}`);
  if (contact.phones && contact.phones.length > 0) {
    parts.push(`Tel: ${contact.phones.join(' / ')}`);
  }
  if (contact.email) parts.push(`Email: ${contact.email}`);
  return parts.filter(Boolean).join('<br>'); // Une con saltos de línea HTML
}

function formatAttributes(pub) {
    const attrs = pub.attributes;
    if (!attrs || typeof attrs !== 'object' || Object.keys(attrs).length === 0) {
        return "";
    }

    let html = '<ul class="attributes">\n';
    for (const [key, value] of Object.entries(attrs)) {
        if (value !== null && value !== undefined && value !== '') { // Solo muestra atributos con valor
            // Convierte keys como 'area_m2' a 'Area m2' (simplificado)
            const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            let valueStr;
             if (typeof value === 'boolean') {
                 valueStr = value ? 'Sí' : 'No';
             } else {
                 valueStr = String(value);
             }
            html += `          <li><strong>${label}:</strong> ${valueStr}</li>\n`;
        }
    }
    html += '        </ul>\n';
    return html;
}


function formatPublicationHtml(pub) {
  const title = pub.title || 'Publicación sin título';
  const description = pub.description || 'Sin descripción.';
  const images = pub.images || [];

  let imageHtml = "";
  if (images && Array.isArray(images) && images.length > 0 && images[0]) {
    // IMPORTANTE: Para Puppeteer, las rutas locales deben ser ABSOLUTAS y con protocolo file://
    // O mejor aún, URLs completas (http/https).
    // Si usas rutas relativas, necesitarás configurar una base URL o convertirlas a absolutas.
    // Ejemplo asumiendo que son URLs completas o ya están preparadas:
    const imageUrl = images[0];
     // Podrías necesitar convertir rutas locales a file:// URLs aquí si es necesario
     // const imageUrl = pathToFileURL(path.resolve(images[0])).href; // Ejemplo
    imageHtml = `<img src="${imageUrl}" alt="${title}" class="pub-image">\n`;
  }

  const priceHtml = `<div class="pub-price">${formatPrice(pub)}</div>`;
  const locationHtml = `<div class="pub-location">${formatLocation(pub)}</div>`;
  const contactHtml = `<div class="pub-contact">${formatContact(pub)}</div>`;
  const attributesHtml = formatAttributes(pub);

  let createdAtStr = "";
  if (pub.createdAt) {
    try {
      // Intenta formatear fecha (asume formato ISO o compatible con Date)
      const dtObject = new Date(pub.createdAt);
      // 'es-PE' para formato peruano dd/mm/yyyy
      createdAtStr = `<div class="pub-date">Publicado: ${dtObject.toLocaleDateString('es-PE')}</div>`;
    } catch (e) {
      createdAtStr = `<div class="pub-date">Publicado: ${pub.createdAt}</div>`; // Fallback
    }
  }

  const html = `
    <article class="publication">
      ${imageHtml}
      <h3>${title}</h3>
      ${priceHtml}
      <p class="pub-description">${description}</p>
      ${attributesHtml}
      ${locationHtml}
      ${contactHtml}
      ${createdAtStr}
    </article>
    `;
  return html;
}

function generateMagazineHtml(groupedPubs, magazineTitle) {
  // --- CSS (Idéntico al de Python, puedes mejorarlo) ---
  const cssStyles = `
        @page {
            size: A4;
            margin: 1.5cm; /* Márgenes para la página A4 */
             @bottom-center {
                 content: "Página " counter(page) " de " counter(pages);
                 font-size: 9pt;
                 color: #666;
            }
            @top-center {
                 content: element(header); /* Usa el header definido abajo */
                 font-size: 10pt;
                 color: #333;
                 border-bottom: 1px solid #ccc;
                 padding-bottom: 5px;
                 margin-bottom: 20pt; /* Espacio entre cabecera y contenido */
            }
        }
        body {
            font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
            line-height: 1.4;
            color: #333;
            font-size: 10pt;
        }
         .magazine-header {
            position: running(header); /* Define el contenido de la cabecera */
            text-align: center;
            font-weight: bold;
        }
        h1 {
            text-align: center;
            color: #003366;
            border-bottom: 2px solid #0056b3;
            padding-bottom: 8px;
            margin-bottom: 25px;
            font-size: 18pt;
        }
        .category-section h2 {
            background-color: #f0f0f0;
            color: #444;
            padding: 8px 12px;
            margin-top: 25px;
            margin-bottom: 15px;
            border-left: 4px solid #0056b3;
            font-size: 14pt;
            page-break-after: avoid;
        }
        .publication {
            border: 1px solid #ddd;
            background-color: #ffffff;
            padding: 12px;
            margin-bottom: 15px;
            border-radius: 3px;
            overflow: hidden;
            page-break-inside: avoid; /* Evitar cortes */
        }
         .publication:last-child { margin-bottom: 0; }
        .publication h3 {
            margin-top: 0; margin-bottom: 8px; color: #0056b3; font-size: 12pt; font-weight: bold;
        }
        .pub-image {
            max-width: 100px; max-height: 100px; float: right; margin-left: 12px; margin-bottom: 8px; border: 1px solid #eee; object-fit: cover;
        }
        .pub-description { margin-bottom: 10px; font-size: 9.5pt; text-align: justify; }
        .pub-price { font-weight: bold; color: #007bff; margin-bottom: 8px; font-size: 11pt; }
        .pub-location, .pub-contact, .pub-date { font-size: 9pt; color: #555; margin-bottom: 4px; line-height: 1.3; }
        .attributes { list-style: none; padding: 0; margin: 10px 0; font-size: 9pt; color: #444; border-top: 1px dashed #eee; padding-top: 8px; }
        .attributes li { margin-bottom: 3px; }
        .attributes strong { color: #333; min-width: 90px; display: inline-block; }
        footer { /* Footer se maneja via @page */ }
    `;

  let htmlContent = "";
  // Ordenar categorías alfabéticamente
  const sortedCategories = Object.keys(groupedPubs).sort();

  for (const categoryName of sortedCategories) {
    htmlContent += `    <section class="category-section">\n`;
    htmlContent += `      <h2>${categoryName}</h2>\n`;
    // Ordenar publicaciones dentro de la categoría (ej. por fecha) - MVP: sin ordenar
    const pubsInCategory = groupedPubs[categoryName];
    for (const pub of pubsInCategory) {
      htmlContent += formatPublicationHtml(pub);
    }
    htmlContent += '    </section>\n';
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
    <div class="magazine-header">${magazineTitle} - Buscadis.com</div>
    <h1>${magazineTitle}</h1>
    <main>
        ${htmlContent}
    </main>
    <footer></footer>
</body>
</html>`;

  console.log("Estructura HTML generada.");
  return fullHtml;
}


async function savePdf(htmlContent, outputFilePath) {
  let browser = null;
  try {
    console.log("Iniciando Puppeteer...");
    browser = await puppeteer.launch({
        headless: true, // Ejecutar en modo headless (sin interfaz gráfica)
        args: ['--no-sandbox', '--disable-setuid-sandbox'] // Argumentos comunes para entornos Linux/Docker
    });
    const page = await browser.newPage();

    console.log("Estableciendo contenido HTML en la página...");
    // Establecer el contenido HTML. Puppeteer manejará la carga de recursos (CSS, etc.)
    // Para imágenes locales, asegúrate que las rutas en `htmlContent` sean URLs `file://` absolutas o URLs web.
    await page.setContent(htmlContent, {
       waitUntil: 'networkidle0' // Esperar hasta que la red esté inactiva (útil si hay imágenes externas)
    });

    console.log(`Generando PDF en: ${outputFilePath}`);
    await page.pdf({
      path: outputFilePath,
      format: 'A4',
      printBackground: true, // Incluir fondos definidos en CSS
       displayHeaderFooter: true, // Usar cabecera/pie definidos en @page CSS
       headerTemplate: `<span/>`, // Vacío para usar el de @page CSS
       footerTemplate: `<span/>`, // Vacío para usar el de @page CSS
      margin: { // Redundante si ya se definió en @page, pero asegura márgenes
        top: '1.5cm',
        right: '1.5cm',
        bottom: '1.5cm', // Dejar espacio para el footer de @page
        left: '1.5cm'
      }
    });

    console.log(`¡PDF generado exitosamente!: ${outputFilePath}`);
    return true;

  } catch (error) {
    console.error("Error generando PDF con Puppeteer:", error);
    return false;
  } finally {
    if (browser) {
      console.log("Cerrando navegador Puppeteer...");
      await browser.close();
    }
  }
}

// --- Ejecución Principal con Yargs ---
async function main() {
    const argv = yargs(hideBin(process.argv))
        .usage('Uso: node $0 [opciones] <archivo_json...> ')
        .option('o', {
            alias: 'output',
            description: 'Ruta del archivo PDF de salida',
            type: 'string',
            default: 'buscadis_revista.pdf'
        })
         .option('t', {
             alias: 'title',
             description: 'Título para la revista PDF',
             type: 'string',
             default: 'Revista de Clasificados Buscadis'
         })
        .demandCommand(1, 'Debes proporcionar al menos un archivo JSON de entrada.')
        .help('h')
        .alias('h', 'help')
        .argv;

    const jsonFiles = argv._; // Los argumentos sin opción son los archivos JSON
    const outputFilePath = path.resolve(argv.output); // Asegurar ruta absoluta para salida
    const magazineTitle = argv.title;


    // --- Lógica del Script ---
    let allPublications = [];
    console.log("Iniciando generación de revista PDF con Node.js/Puppeteer...");

    for (const jsonFilePath of jsonFiles) {
        const pubsData = await loadJsonData(jsonFilePath);
        if (pubsData) {
            allPublications = allPublications.concat(pubsData); // Usar concat en lugar de extend
        }
    }

    if (allPublications.length === 0) {
        console.log("No se encontraron datos válidos de publicaciones en los archivos. Abortando.");
        return;
    }

    console.log(`Total de publicaciones cargadas: ${allPublications.length}`);
    const groupedPubs = groupPubsByCategory(allPublications);
    const htmlOutput = generateMagazineHtml(groupedPubs, magazineTitle);

    // Guardar el PDF
    const success = await savePdf(htmlOutput, outputFilePath);

    if (!success) {
         console.log("No se pudo generar el PDF. Revisa los errores anteriores.");
          // Opcional: guardar el HTML para revisión
         const htmlFilename = outputFilePath.replace(/\.pdf$/i, '.html');
         try {
             await fs.writeFile(htmlFilename, htmlOutput, 'utf-8');
             console.log(`Se guardó el HTML intermedio para revisión en: ${htmlFilename}`);
         } catch (writeError) {
             console.error(`Error al guardar el HTML intermedio: ${writeError.message}`);
         }
    }

    console.log("Proceso de generación de revista finalizado.");
}

// Ejecutar la función principal
main().catch(error => {
  console.error("Error inesperado en la ejecución principal:", error);
  process.exit(1); // Salir con código de error
});