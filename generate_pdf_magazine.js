const fs = require('fs').promises;
const path = require('path');
const puppeteer = require('puppeteer');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { URL } = require('url'); // Para manejar file:// URLs si es necesario

// --- Funciones Auxiliares ---

async function loadJsonData(filepath) {
  try {
    const absolutePath = path.resolve(filepath);
    // console.log(`Cargando datos desde: ${absolutePath}`); // Descomentar para debug
    const fileContent = await fs.readFile(absolutePath, 'utf-8');
    const data = JSON.parse(fileContent);
    if (!Array.isArray(data)) {
      console.warn(`Advertencia: JSON ${filepath} no es un array.`);
      return null;
    }
    console.log(`-> OK: Se cargaron ${data.length} publicaciones desde ${path.basename(filepath)}.`);
    return data;
  } catch (error) {
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
     'inmuebles': 'Inmuebles', 'vehiculos': 'Vehículos', 'empleos': 'Empleos',
     'servicios': 'Servicios', 'productos': 'Productos', 'mascotas': 'Mascotas',
     'comunidad': 'Comunidad', 'negocios': 'Negocios', /* ... añadir más ... */
   };
  publications.forEach(pub => {
    const categorySlug = pub.categorySlug || 'sin-categoria';
    const categoryDisplayName = categoryNames[categorySlug] || categorySlug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    if (!grouped[categoryDisplayName]) grouped[categoryDisplayName] = [];
    grouped[categoryDisplayName].push(pub);
  });
  console.log(`Publicaciones agrupadas en ${Object.keys(grouped).length} categorías.`);
  return grouped;
}

function formatPrice(pub) {
  const amount = pub.amount;
  const currency = pub.currency;
  const negotiable = pub.negotiable || false;
  let priceStr = "Consultar Precio";
  if (amount === 0) priceStr = "Gratis";
  else if (amount !== null && amount !== undefined) {
    const currencySymbol = currency === 'PEN' ? 'S/' : currency === 'USD' ? '$' : '';
    try { priceStr = `${currencySymbol} ${new Intl.NumberFormat('es-PE', { style: 'decimal', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}`; }
    catch (e) { priceStr = `${currencySymbol} ${amount}`; }
  }
  if (negotiable && amount !== null && amount !== undefined) priceStr += " (Negociable)";
  return priceStr;
}

function formatLocation(pub) {
  const loc = pub.location || {};
  const parts = [];
  if (loc.district) parts.push(`${loc.district}`);
  if (loc.address) parts.push(loc.address);
  if (loc.referencePoint) parts.push(`(Ref: ${loc.referencePoint})`);
  const locationString = parts.filter(Boolean).join(', ');
  // Añadir ícono usando HTML (simple)
  return locationString ? `<span class="icon-location">📍</span> ${locationString}` : '';
}

function formatContact(pub) {
  const contact = pub.contact || {};
  const parts = [];
  // Añadir íconos simples directamente
  if (contact.name) parts.push(`<span class="contact-name">👤 ${contact.name}</span>`);
  if (contact.phones && contact.phones.length > 0) parts.push(`<span class="contact-phone">📞 Tel: ${contact.phones.join(' / ')}</span>`);
  if (contact.email) parts.push(`<span class="contact-email">✉️ Email: ${contact.email}</span>`);
  return parts.filter(Boolean).join('<br>');
}

function formatAttributes(pub) {
    const attrs = pub.attributes;
    if (!attrs || typeof attrs !== 'object' || Object.keys(attrs).length === 0) return "";
    let html = '<ul class="attributes">\n';
    for (const [key, value] of Object.entries(attrs)) {
        // Omitir claves si el valor es null, undefined o string vacío
        if (value !== null && value !== undefined && value !== '') {
            // Mapeo de claves a etiquetas más legibles
            let label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            const mappings = {
                'area_m2': 'Área m²', 'ano': 'Año', 'kilometraje': 'Km.',
                'banos': 'Baños', 'dormitorios': 'Dorm.', 'cocheras': 'Coch.',
                'experiencia_requerida': 'Experiencia', 'servicios_incluidos': 'Incluye',
                'area_terreno_m2': 'Área Terreno m²', 'area_construida_m2': 'Área Const. m²',
                'publico_objetivo': 'Ideal para', 'requisitos': 'Req.',
                'conocimientos': 'Conocim.', 'puestos_requeridos': 'Puestos',
                'nivel_educacion': 'Educación', 'modalidad_trabajo': 'Modalidad',
                'tipo_contrato': 'Contrato', 'horario': 'Horario', 'estado': 'Estado',
                'condicion': 'Condición', 'marca': 'Marca', 'modelo': 'Modelo',
                // Añade más mapeos comunes aquí
            };
            label = mappings[key] || label;

            // Formateo del valor
            let valueStr;
            if (typeof value === 'boolean') {
                valueStr = value ? 'Sí' : 'No';
            } else if (Array.isArray(value)) {
                 // Formatear arrays de forma legible, reemplazando guiones bajos
                 valueStr = value.map(item => String(item).replace(/_/g, ' ')).join(', ');
            } else {
                valueStr = String(value);
                 // Acortar strings largos si es necesario
                 if (valueStr.length > 40 && ['lista_servicios', 'requisitos_generales', 'puestos_requeridos', 'infraestructura_existente'].includes(key)) {
                     valueStr = valueStr.substring(0, 37) + '...';
                 }
            }
            html += `  <li><span class="attr-label">${label}:</span> <span class="attr-value">${valueStr}</span></li>\n`;
        }
    }
    html += '</ul>\n';
    return html.includes('<li>') ? html : ''; // Solo devolver si la lista tiene elementos
}

function formatPublicationHtml(pub) {
    const title = pub.title || 'Publicación sin título';
    const description = pub.description || '';
    const images = pub.images || [];
    let imageHtml = "";

    // Procesamiento de imágenes
    if (images && Array.isArray(images) && images.length > 0 && images[0]) {
        let imageUrl = images[0];
        if (imageUrl.startsWith('http:') || imageUrl.startsWith('https:')) {
            imageHtml = `<div class="pub-image-container"><img src="${imageUrl}" alt="" class="pub-image"></div>\n`;
        } else {
            try {
                // Intenta resolver como ruta local absoluta y convertir a file:// URL
                const absolutePath = path.resolve(imageUrl);
                // Reemplaza backslashes por forward slashes para compatibilidad URL
                imageUrl = new URL(`file:///${absolutePath.replace(/\\/g, '/')}`).href;
                imageHtml = `<div class="pub-image-container"><img src="${imageUrl}" alt="" class="pub-image"></div>\n`;
            } catch (err) {
                console.warn(`! Img Warn: No se pudo resolver la ruta local: ${images[0]}`);
                imageHtml = ""; // No incluir imagen si falla
            }
        }
    }

    const priceHtml = `<div class="pub-price">${formatPrice(pub)}</div>`;
    // Asegurar que location y contact solo se añaden si tienen contenido
    const locationString = formatLocation(pub);
    const locationHtml = locationString ? `<div class="pub-location">${locationString}</div>` : '';
    const contactString = formatContact(pub);
    const contactHtml = contactString ? `<div class="pub-contact">${contactString}</div>` : '';
    const attributesHtml = formatAttributes(pub);

    let createdAtStr = "";
    if (pub.createdAt) { // Solo mostrar si existe createdAt
        try {
            createdAtStr = `<div class="pub-date">Pub: ${new Date(pub.createdAt).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: '2-digit' })}</div>`;
        } catch (e) { /* Ignorar fecha inválida */ }
    }

    const pubId = pub._id ? ` id="pub-${pub._id}"` : ''; // Añadir ID si existe

    // Estructura HTML mejorada
    return `
      <article class="publication"${pubId}>
        ${imageHtml}
        <div class="pub-content">
          <h3 class="pub-title">${title}</h3>
          ${priceHtml}
          <div class="pub-body">
              ${description ? `<p class="pub-description">${description}</p>` : ''}
              ${attributesHtml}
          </div>
          <div class="pub-footer">
              ${locationHtml}
              ${contactHtml}
              ${createdAtStr}
          </div>
        </div>
      </article>
    `;
}


// --- Generación de HTML y CSS ---

function generateMagazineHtml(groupedPubs, magazineTitle) {

    // **CSS COMPLETO Y MEJORADO**
    const cssStyles = `
      /* Importar Fuente (Ejemplo: Lato desde Google Fonts) */
      @import url('https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700&display=swap');

      /* Variables CSS para fácil personalización */
      :root {
        --font-family-sans: 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
        --primary-color: #004a8f; /* Azul Buscadis más oscuro */
        --secondary-color: #e8f0f7; /* Azul muy pálido para fondos */
        --accent-color: #007bff; /* Azul más brillante */
        --text-color: #212529; /* Casi negro */
        --text-color-light: #495057; /* Gris oscuro */
        --text-color-lighter: #6c757d; /* Gris */
        --border-color: #dee2e6; /* Borde gris claro */
        --column-gap: 1cm;
        --page-margin: 1.5cm;
      }

      @page {
        size: A4;
        margin: var(--page-margin);

        @bottom-center {
          content: "Página " counter(page) " de " counter(pages);
          font-family: var(--font-family-sans);
          font-size: 8pt;
          color: var(--text-color-lighter);
          vertical-align: top;
          padding-top: 5pt;
        }

        @top-center {
          content: element(header);
          font-family: var(--font-family-sans);
          font-size: 9pt;
          color: var(--text-color-light);
          vertical-align: bottom;
          padding-bottom: 8pt;
          border-bottom: 0.5pt solid var(--border-color);
          margin-bottom: 15pt;
        }
      } /* Fin @page */

      body {
        font-family: var(--font-family-sans);
        line-height: 1.45;
        color: var(--text-color);
        font-size: 9pt;
        font-weight: 400;
         /* Habilitar columnas */
         column-count: 2;
         column-gap: var(--column-gap);
         column-fill: auto; /* Permitir flujo natural, no forzar balance */
         widows: 3; /* Evitar líneas huérfanas */
         orphans: 3; /* Evitar líneas viudas */
      }

      .magazine-header {
        position: running(header);
        text-align: center;
        font-weight: 400;
      }

      /* Título Principal */
      h1.main-title {
        text-align: center;
        color: var(--primary-color);
        font-weight: 700;
        font-size: 22pt;
        margin-bottom: 0.8cm;
        border-bottom: 1pt solid var(--primary-color);
        padding-bottom: 0.2cm;
        /* Ocupar ambas columnas */
         column-span: all;
         /* Intentar que no quede solo en una página */
         page-break-after: avoid;
         break-after: column; /* Empezar contenido en columna nueva */
      }

       /* Contenedor principal */
       main.content-wrapper {
         /* No necesita columnas si body las tiene */
       }

      /* Títulos de Categoría */
      .category-section h2 {
        background-color: var(--secondary-color);
        color: var(--primary-color);
        padding: 0.25cm 0.4cm;
        margin: 0.8cm 0 0.4cm 0;
        border-left: 3pt solid var(--primary-color);
        font-size: 13pt;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
         /* Ocupar ambas columnas */
         column-span: all;
         /* Control de saltos */
         break-before: column; /* Preferible empezar en nueva columna */
         break-after: avoid; /* No cortar justo después */
         page-break-before: auto;
         page-break-after: avoid;
      }
       /* Evitar salto antes de la primera categoría */
       section.category-section:first-of-type h2 {
           break-before: avoid;
           page-break-before: avoid;
           margin-top: 0;
       }


      /* Estilo de cada Publicación */
      .publication {
        border: 1pt solid var(--border-color);
        background-color: #ffffff;
        padding: 0.35cm;
        margin-bottom: 0.5cm;
        border-radius: 3px;
        overflow: hidden; /* Evitar desbordamientos */
         /* ¡CLAVE! Evitar que el anuncio se rompa */
         break-inside: avoid;
         page-break-inside: avoid;
         /* Layout Flexbox */
         display: flex;
         flex-direction: row;
         gap: 0.35cm;
      }
       .publication:last-child { margin-bottom: 0; }

       /* Contenedor de Imagen */
       .pub-image-container {
         flex-shrink: 0;
         width: 70px;
         display: flex;
         align-items: center; /* Centrar imagen verticalmente */
         justify-content: center; /* Centrar imagen horizontalmente */
         overflow: hidden; /* Asegurar que no se salga */
       }
       .pub-image {
         display: block; /* Asegurar que es bloque */
         width: 100%;
         height: auto;
         max-height: 70px; /* Limitar altura */
         object-fit: cover; /* Cubrir espacio sin distorsionar */
         border-radius: 2px;
         border: 1pt solid #f0f0f0; /* Borde muy sutil en imagen */
       }

      /* Contenedor del Contenido Principal */
       .pub-content {
           flex-grow: 1;
           display: flex;
           flex-direction: column;
           /* No usar justify-content: space-between; para evitar mucho espacio */
       }

      /* Título del anuncio */
      .pub-title {
        margin-top: 0;
        margin-bottom: 0.15cm;
        color: var(--primary-color);
        font-size: 10.5pt;
        font-weight: 700;
        line-height: 1.25;
      }

      /* Precio */
      .pub-price {
        font-weight: 700;
        color: var(--accent-color);
        margin-bottom: 0.2cm;
        font-size: 10pt;
      }

      /* Cuerpo: Descripción y Atributos */
      .pub-body {
          margin-bottom: 0.25cm;
          flex-grow: 1; /* Ocupar espacio disponible */
      }

      /* Descripción */
      .pub-description {
        margin-bottom: 0.25cm;
        font-size: 8.5pt;
        line-height: 1.4;
        font-weight: 400;
        color: var(--text-color-light);
        text-align: left;
      }

      /* Footer del anuncio: Location, Contact, Date */
      .pub-footer {
          border-top: 0.5pt solid var(--border-color); /* Borde más visible */
          padding-top: 0.25cm;
          margin-top: 0.3cm; /* Espacio antes del footer */
      }

      /* Location, Contact, Date */
      .pub-location, .pub-contact, .pub-date {
        font-size: 8pt;
        color: var(--text-color-lighter);
        margin-bottom: 0.1cm;
        line-height: 1.3;
        font-weight: 400;
        display: flex;
        align-items: flex-start; /* Alinear al inicio para íconos */
        gap: 4px;
      }
      .pub-contact span { display: block; }
      .pub-contact span:not(:last-child) { margin-bottom: 2px; }
      .pub-date { margin-top: 2px; text-align: right; display: block;} /* Fecha al final y a la derecha */

       /* Iconos simples */
       .icon-location::before { content: '📍 '; vertical-align: middle;}
       .icon-user::before { content: '👤 '; vertical-align: middle;}
       .icon-phone::before { content: '📞 '; vertical-align: middle;}
       .icon-email::before { content: '✉️ '; vertical-align: middle;}


      /* Lista de Atributos */
      .attributes {
        list-style: none;
        padding: 0.2cm 0 0.1cm 0;
        margin: 0.25cm 0;
        font-size: 8pt;
        color: var(--text-color-light);
        /* Columnas para atributos */
         column-count: 2;
         column-gap: 0.8cm;
         break-inside: avoid;
         border-top: none; /* Sin borde superior */
      }
      .attributes li {
        margin-bottom: 0.15cm;
         break-inside: avoid;
         page-break-inside: avoid;
         display: block; /* Para layout de columnas */
         line-height: 1.3;
      }
      .attributes .attr-label {
        color: var(--text-color);
        font-weight: 700;
        margin-right: 4px;
      }
       .attributes .attr-value {
           font-weight: 400;
           color: var(--text-color-light);
           /* word-break: break-all; */ /* Opcional: romper palabras largas */
       }

      footer {
        /* Footer principal manejado por @page bottom-center */
      }
    `; // Fin de cssStyles

    let htmlPublicationsContent = "";
    const sortedCategories = Object.keys(groupedPubs).sort();

    for (const categoryName of sortedCategories) {
        htmlPublicationsContent += `    <section class="category-section">\n`;
        htmlPublicationsContent += `      <h2>${categoryName}</h2>\n`;
        const pubsInCategory = groupedPubs[categoryName];
        for (const pub of pubsInCategory) {
        htmlPublicationsContent += formatPublicationHtml(pub);
        }
        htmlPublicationsContent += '    </section>\n';
    }

    const generationDate = new Date().toLocaleDateString('es-PE', { year: 'numeric', month: 'long', day: 'numeric' });
    const fullHtml = `<!DOCTYPE html>
<html lang="es">
<head> <meta charset="UTF-8"> <title>${magazineTitle}</title> <style>${cssStyles}</style> </head>
<body>
    <div class="magazine-header">${magazineTitle} - Buscadis.com - ${generationDate}</div>
    <h1 class="main-title">${magazineTitle}</h1>
    <main class="content-wrapper"> ${htmlPublicationsContent} </main>
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
        browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--font-render-hinting=none'] });
        const page = await browser.newPage();
        console.log("Estableciendo contenido HTML...");
        await page.setContent(htmlContent, { waitUntil: 'networkidle0', timeout: 90000 });
        await page.emulateMediaType('print');
        console.log(`Generando PDF: ${outputFilePath}`);
        await page.pdf({ path: outputFilePath, format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: `<span></span>`, footerTemplate: `<span></span>`, margin: { top: '0cm', right: '0cm', bottom: '0cm', left: '0cm' }, preferCSSPageSize: true });
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
        .scriptName("generate_pdf_magazine.js")
        .usage('Uso: $0 [opciones] <directorio_con_json>')
        // Definir comando principal y su argumento posicional
        .command('$0 <inputDir>', 'Genera la revista PDF desde archivos JSON en un directorio', (yargs) => {
             yargs.positional('inputDir', {
                 describe: 'Directorio que contiene los archivos JSON',
                 type: 'string',
                 normalize: true // Normaliza la ruta (ej. / a \ en Windows)
             })
         })
        .option('o', {
            alias: 'output',
            description: 'Ruta del archivo PDF de salida',
            type: 'string',
            default: 'buscadis_revista_premium.pdf',
            normalize: true
        })
         .option('t', {
             alias: 'title',
             description: 'Título para la revista PDF',
             type: 'string',
             default: 'Revista de Clasificados Buscadis'
         })
        .help('h')
        .alias('h', 'help')
        .strict() // Ayuda a detectar errores en argumentos
        .fail((msg, err, yargs) => { // Manejo de errores de Yargs más informativo
            console.error("Error en los argumentos proporcionados:");
            console.error(msg);
            console.error("\nUso correcto:");
            console.error(yargs.help());
            process.exit(1);
        })
        .parse(); // Usar parse() para que funcione .command()

    // Acceder al argumento posicional por su nombre
    const inputDirectory = argv.inputDir; // Ya está normalizado por yargs
    const outputFilePath = argv.output; // Ya está normalizado por yargs
    const magazineTitle = argv.title;

    let allPublications = [];
    let jsonFilesToProcess = [];

    console.log(`Buscando archivos JSON en: ${inputDirectory}`);
    try {
        const directoryEntries = await fs.readdir(inputDirectory, { withFileTypes: true });
        jsonFilesToProcess = directoryEntries
            .filter(dirent => dirent.isFile() && path.extname(dirent.name).toLowerCase() === '.json')
            .map(dirent => path.join(inputDirectory, dirent.name))
            .sort((a, b) => { // Ordenamiento numérico
                 const numA = parseInt(path.basename(a).match(/(\d+)/)?.[1] || 0);
                 const numB = parseInt(path.basename(b).match(/(\d+)/)?.[1] || 0);
                 return numA - numB;
             });
        if (jsonFilesToProcess.length === 0) {
            console.error(`Error: No se encontraron archivos .json en ${inputDirectory}`);
            return;
        }
        console.log(`Se encontraron ${jsonFilesToProcess.length} archivos JSON.`);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.error(`Error: El directorio no existe o no es accesible: ${inputDirectory}`);
        } else {
            console.error(`Error al leer directorio ${inputDirectory}:`, error);
        }
        return;
    }

    console.log("Cargando y procesando publicaciones...");
    for (const jsonFilePath of jsonFilesToProcess) {
        const pubsData = await loadJsonData(jsonFilePath);
        if (pubsData) {
            allPublications = allPublications.concat(pubsData);
        } else {
             console.warn(`! Se omitieron datos del archivo ${path.basename(jsonFilePath)} por errores.`);
        }
    }
    if (allPublications.length === 0) {
      console.log("No se cargaron datos válidos. Abortando.");
      return;
    }
    console.log(`Total de publicaciones cargadas: ${allPublications.length}`);

    const groupedPubs = groupPubsByCategory(allPublications);
    const htmlOutput = generateMagazineHtml(groupedPubs, magazineTitle);

    // Guardar HTML para debug (opcional)
    // const htmlDebugPath = outputFilePath.replace(/\.pdf$/i, '_debug.html');
    // await fs.writeFile(htmlDebugPath, htmlOutput, 'utf-8');
    // console.log(`HTML guardado en: ${htmlDebugPath}`);

    const success = await savePdf(htmlOutput, outputFilePath);
    if (success) { console.log(`\nProceso finalizado. Revista generada en: ${outputFilePath}`); }
    else { console.error("\nFallo al generar PDF."); }
}

// Ejecutar script
main().catch(error => {
  console.error("Error fatal:", error);
  process.exit(1);
});