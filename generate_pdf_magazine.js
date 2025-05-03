// generate_pdf_magazine.js - Versión Completa y Corregida

const fs = require('fs').promises;
const path = require('path');
const puppeteer = require('puppeteer');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { URL } = require('url');

// --- Manejadores Globales de Errores (Para Depuración) ---
process.on('unhandledRejection', (reason, promise) => {
  console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  console.error('!!! ERROR: Promesa no manejada rechazada !!!');
  console.error('Razón:', reason);
  // console.error('Promesa:', promise); // Descomentar para más detalles
  console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  console.error('!!! ERROR: Excepción no capturada !!!');
  console.error(error);
  console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  process.exit(1);
});


// --- Funciones Auxiliares de Carga ---

async function loadJsonData(filepath) {
  try {
    const absolutePath = path.resolve(filepath);
    const fileContent = await fs.readFile(absolutePath, 'utf-8');
    const data = JSON.parse(fileContent);
    if (!Array.isArray(data)) {
      console.warn(`! Warn: JSON ${path.basename(filepath)} no es un array.`);
      return null;
    }
    // Log de éxito ahora se hace en el bucle principal
    return data;
  } catch (error) {
    // Loguear el error específico del archivo
    console.error(`!! Error procesando ${path.basename(filepath)}: ${error.message}`);
    // Decidimos retornar null para intentar continuar con otros archivos
    return null;
  }
}

// --- Agrupación de Datos ---

function groupPubsByCategory(publications) {
  const grouped = {};
  if (!publications || publications.length === 0) return grouped;
  // Mapeo de slugs a nombres (¡Personaliza y completa!)
   const categoryNames = {
     'inmuebles': 'Inmuebles', 'vehiculos': 'Vehículos', 'empleos': 'Empleos',
     'servicios': 'Servicios', 'productos': 'Productos', 'mascotas': 'Mascotas',
     'comunidad': 'Comunidad', 'negocios': 'Negocios',
     'sin-categoria': 'Sin Categoría' // Para los que no tengan slug
   };
  publications.forEach(pub => {
    const categorySlug = pub.categorySlug || 'sin-categoria';
    const categoryDisplayName = categoryNames[categorySlug] || categorySlug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    if (!grouped[categoryDisplayName]) grouped[categoryDisplayName] = [];
    grouped[categoryDisplayName].push(pub);
  });
  console.log(`\nPublicaciones agrupadas en ${Object.keys(grouped).length} categorías.`);
  return grouped;
}

// --- Funciones de Formateo de Datos para HTML ---

function cleanPhoneNumber(phone) {
    let cleaned = phone.replace(/[^0-9]/g, '');
    if (cleaned.length === 9 && !cleaned.startsWith('51')) {
        cleaned = '51' + cleaned;
    }
    return cleaned;
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
    return locationString ? `<span class="icon-location">📍</span> ${locationString}` : '';
}

function formatContact(pub) {
    const contact = pub.contact || {};
    const parts = [];
    // Mensaje predeterminado para WhatsApp (URL encoded)
    const defaultMessage = encodeURIComponent(`Hola, vi tu anuncio "${pub.title || '...'}" en Buscadis. Quisiera más información.`);

    if (contact.name) parts.push(`<span class="contact-name">👤 ${contact.name}</span>`);
    if (contact.phones && contact.phones.length > 0) {
        const phoneLinks = contact.phones.map(phone => {
        const cleanedPhone = cleanPhoneNumber(phone);
        // Solo genera link si el número es válido tras limpiar
        if (cleanedPhone && cleanedPhone.startsWith('51') && cleanedPhone.length >= 11) {
            return `<a href="https://wa.me/${cleanedPhone}?text=${defaultMessage}" class="whatsapp-link" target="_blank">${phone}</a>`;
        }
        return phone; // Mostrar como texto si no es válido para WA
        }).join(' / ');
        parts.push(`<span class="contact-phone">📞 Tel: ${phoneLinks}</span>`);
    }
    if (contact.email) parts.push(`<span class="contact-email">✉️ Email: <a href="mailto:${contact.email}">${contact.email}</a></span>`);
    return parts.filter(Boolean).join('<br>');
}

function formatAttributes(pub) {
    const attrs = pub.attributes;
    if (!attrs || typeof attrs !== 'object' || Object.keys(attrs).length === 0) return "";
    let html = '<ul class="attributes">\n';
    for (const [key, value] of Object.entries(attrs)) {
        if (value !== null && value !== undefined && value !== '') {
            let label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            const mappings = { /* ... tus mapeos ... */ 'area_m2': 'Área m²', 'ano': 'Año', 'kilometraje': 'Km.', 'banos': 'Baños', 'dormitorios': 'Dorm.', 'cocheras': 'Coch.', 'experiencia_requerida': 'Experiencia', 'servicios_incluidos': 'Incluye', 'area_terreno_m2': 'Área Terreno m²', 'area_construida_m2': 'Área Const. m²', 'publico_objetivo': 'Ideal para', 'requisitos': 'Req.', 'conocimientos': 'Conocim.', 'puestos_requeridos': 'Puestos', 'nivel_educacion': 'Educación', 'modalidad_trabajo': 'Modalidad', 'tipo_contrato': 'Contrato', 'horario': 'Horario', 'estado': 'Estado', 'condicion': 'Condición', 'marca': 'Marca', 'modelo': 'Modelo' };
            label = mappings[key] || label;
            let valueStr = typeof value === 'boolean' ? (value ? 'Sí' : 'No') : (Array.isArray(value) ? value.map(item => String(item).replace(/_/g, ' ')).join(', ') : String(value));
            if (valueStr.length > 40 && ['lista_servicios', 'requisitos_generales', 'puestos_requeridos', 'infraestructura_existente'].includes(key)) valueStr = valueStr.substring(0, 37) + '...';
            html += `  <li><span class="attr-label">${label}:</span> <span class="attr-value">${valueStr}</span></li>\n`;
        }
    }
    html += '</ul>\n';
    return html.includes('<li>') ? html : '';
}

function formatPublicationHtml(pub) {
    const title = pub.title || 'Publicación sin título';
    const description = pub.description || '';
    const images = pub.images || [];
    let imageHtml = "";
    if (images && Array.isArray(images) && images.length > 0 && images[0]) {
        let imageUrl = images[0];
        if (imageUrl.startsWith('http:') || imageUrl.startsWith('https:')) {
            imageHtml = `<div class="pub-image-container"><img src="${imageUrl}" alt="" class="pub-image"></div>\n`;
        } else {
            try {
                const absolutePath = path.resolve(imageUrl);
                imageUrl = new URL(`file:///${absolutePath.replace(/\\/g, '/')}`).href;
                imageHtml = `<div class="pub-image-container"><img src="${imageUrl}" alt="" class="pub-image"></div>\n`;
            } catch (err) { console.warn(`! Img Warn: No se pudo resolver ruta local: ${images[0]}`); imageHtml = ""; }
        }
    }
    const priceHtml = `<div class="pub-price">${formatPrice(pub)}</div>`;
    const locationString = formatLocation(pub);
    const locationHtml = locationString ? `<div class="pub-location">${locationString}</div>` : '';
    const contactString = formatContact(pub);
    const contactHtml = contactString ? `<div class="pub-contact">${contactString}</div>` : '';
    const attributesHtml = formatAttributes(pub);
    let createdAtStr = "";
    if (pub.createdAt) { try { createdAtStr = `<div class="pub-date">Pub: ${new Date(pub.createdAt).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: '2-digit' })}</div>`; } catch (e) {} }
    const pubId = pub._id ? ` id="pub-${pub._id}"` : '';
    return `
      <article class="publication"${pubId}> ${imageHtml} <div class="pub-content"> <h3 class="pub-title">${title}</h3> ${priceHtml}
          <div class="pub-body"> ${description ? `<p class="pub-description">${description}</p>` : ''} ${attributesHtml} </div>
          <div class="pub-footer"> ${locationHtml} ${contactHtml} ${createdAtStr} </div>
      </div> </article> `;
}

// --- Generación de HTML y CSS ---

function generateMagazineHtml(groupedPubs, magazineTitle, styleOverrides = {}) {
    // Define colores base y permite overrides
    const baseColors = { primary: '#004a8f', secondary: '#e8f0f7', accent: '#007bff', text: '#212529', textLight: '#495057', textLighter: '#6c757d', border: '#dee2e6' };
    const colors = { ...baseColors, ...styleOverrides };

    // **CSS COMPLETO Y MEJORADO** (Incluido aquí directamente)
    const cssStyles = `
      @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600;700&family=Roboto:wght@300;400;500&display=swap');
      :root {
        --font-family-headings: 'Poppins', sans-serif; --font-family-body: 'Roboto', sans-serif;
        --primary-color: ${colors.primary}; --secondary-color: ${colors.secondary}; --accent-color: ${colors.accent};
        --text-color: ${colors.text}; --text-color-light: ${colors.textLight}; --text-color-lighter: ${colors.textLighter};
        --border-color: ${colors.border}; --column-gap: 0.8cm; --page-margin: 1.5cm;
        --ad-bg-color: #ffffff; --ad-border-radius: 5px; --ad-shadow: 0 2px 5px rgba(0,0,0,0.08);
      }
      @page { size: A4; margin: var(--page-margin);
        @bottom-center { content: "Página " counter(page) " / " counter(pages); font-family: var(--font-family-body); font-size: 8pt; color: #aaa; padding-top: 5pt; vertical-align: top; }
        @top-center { content: element(header); font-family: var(--font-family-body); font-size: 9pt; color: var(--text-color-light); vertical-align: bottom; padding-bottom: 8pt; border-bottom: 0.5pt solid var(--border-color); margin-bottom: 15pt; }
      }
      body { font-family: var(--font-family-body); line-height: 1.45; color: var(--text-color); font-size: 8.5pt; font-weight: 300; column-count: 2; column-gap: var(--column-gap); column-fill: auto; background-color: #f8f9fa; -webkit-hyphens: auto; -moz-hyphens: auto; hyphens: auto; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; widows: 3; orphans: 3; }
      * { box-sizing: border-box; }
      .magazine-header { position: running(header); text-align: right; font-weight: 400; font-size: 8.5pt; color: var(--text-color-lighter); }
      h1.main-title { font-family: var(--font-family-headings); text-align: center; color: var(--primary-color); font-weight: 700; font-size: 20pt; margin-bottom: 0.8cm; border-bottom: 1pt solid var(--primary-color); padding-bottom: 0.2cm; column-span: all; break-after: column; page-break-after: avoid; }
      main.content-wrapper {}
      .category-section h2 { background: linear-gradient(135deg, var(--primary-color) 0%, ${colors.accent} 100%); color: white; text-shadow: 1px 1px 2px rgba(0,0,0,0.2); padding: 0.3cm 0.5cm; margin: 1cm 0 0.5cm 0; border-left: none; font-size: 14pt; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; border-radius: var(--ad-border-radius) var(--ad-border-radius) 0 0; column-span: all; break-before: column; break-after: avoid; page-break-before: auto; page-break-after: avoid; }
      section.category-section:first-of-type h2 { break-before: avoid; page-break-before: avoid; margin-top: 0; }
      .publication { background-color: var(--ad-bg-color); padding: 0.4cm; margin-bottom: 0.6cm; border-radius: var(--ad-border-radius); border: 1pt solid var(--border-color); box-shadow: var(--ad-shadow); overflow: hidden; break-inside: avoid; page-break-inside: avoid; display: flex; flex-direction: column; position: relative; }
      .publication:last-child { margin-bottom: 0; }
      .pub-header { display: flex; gap: 0.4cm; align-items: flex-start; margin-bottom: 0.25cm; }
      .pub-image-container { flex-shrink: 0; width: 75px; height: 75px; display: flex; align-items: center; justify-content: center; overflow: hidden; border-radius: 3px; border: 1pt solid var(--border-color); }
      .pub-image { display: block; width: 100%; height: 100%; object-fit: cover; }
      .pub-title-price { flex-grow: 1; }
      .pub-title { margin: 0 0 0.1cm 0; color: var(--primary-color); font-size: 11pt; font-weight: 600; line-height: 1.3; font-family: var(--font-family-headings); }
      .pub-price { font-weight: 700; color: var(--accent-color); margin-bottom: 0.2cm; font-size: 10.5pt; }
      .pub-body { padding-left: 0.1cm; margin-bottom: 0.3cm; flex-grow: 1; }
      .pub-description { margin-bottom: 0.3cm; font-size: 8.5pt; line-height: 1.5; color: var(--text-color-light); word-wrap: break-word; hyphens: auto; }
      .pub-footer { border-top: 0.5pt solid var(--border-color); padding-top: 0.25cm; margin-top: auto; }
      .pub-location, .pub-contact, .pub-date { font-size: 8pt; color: var(--text-color-lighter); margin-bottom: 0.15cm; line-height: 1.3; display: flex; align-items: flex-start; gap: 5px; }
      .pub-contact span, .pub-contact a { display: inline-block; margin-bottom: 2px; vertical-align: middle; word-break: break-all; } /* Permitir saltos en links largos */
      .pub-date { font-size: 7.5pt; text-align: right; margin-top: 2px; display: block; }
      .icon-location::before, .icon-user::before, .icon-phone::before, .icon-email::before { vertical-align: middle; display: inline-block; margin-right: 1px; } /* Estilos íconos */
      a.whatsapp-link { color: #128C7E; /* Verde WhatsApp más oscuro */ text-decoration: none; font-weight: 500; } a.whatsapp-link:hover { text-decoration: underline; }
      a[href^="mailto:"] { color: var(--accent-color); text-decoration: none; } a[href^="mailto:"]:hover { text-decoration: underline; }
      .attributes { list-style: none; padding: 0.2cm 0 0.1cm 0; margin: 0.25cm 0; font-size: 8pt; color: var(--text-color-light); column-count: 2; column-gap: 0.8cm; break-inside: avoid; border-top: none; }
      .attributes li { margin-bottom: 0.15cm; break-inside: avoid; page-break-inside: avoid; line-height: 1.3; }
      .attributes .attr-label { color: var(--text-color); font-weight: 600; margin-right: 4px; }
      .attributes .attr-value { color: var(--text-color-light); }
      footer { /* Footer manejado por @page */ }
    `;

    let htmlPublicationsContent = "";
    const categoriesInGroup = Object.keys(groupedPubs);
    const isSingleCategory = categoriesInGroup.length === 1;

    for (const categoryName of categoriesInGroup.sort()) { // Siempre ordenar por si acaso
        const pubsInCategory = groupedPubs[categoryName];
        // Solo añadir sección si hay pubs
        if (pubsInCategory && pubsInCategory.length > 0) {
             htmlPublicationsContent += `<section class="category-section ${isSingleCategory ? 'single-category' : ''}">\n`;
             // Añadir título de categoría siempre, da contexto
             htmlPublicationsContent += `  <h2>${categoryName}</h2>\n`;
             pubsInCategory.forEach(pub => { htmlPublicationsContent += formatPublicationHtml(pub); });
             htmlPublicationsContent += '</section>\n';
        }
    }

    const generationDate = new Date().toLocaleDateString('es-PE', { year: 'numeric', month: 'long', day: 'numeric' });
    const fullHtml = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>${magazineTitle}</title><style>${cssStyles}</style></head>
<body>
    <div class="magazine-header">${magazineTitle} - Buscadis.com - ${generationDate}</div>
    <h1 class="main-title">${magazineTitle}</h1>
    <main class="content-wrapper">${htmlPublicationsContent}</main>
    <footer></footer>
</body>
</html>`;
    // console.log("Estructura HTML avanzada generada."); // Log menos verboso
    return fullHtml;
}

// --- Guardado de PDF (Con log de errores detallado) ---
async function savePdf(htmlContent, outputFilePath) {
    let browser = null;
    const fileNameForLog = path.basename(outputFilePath);
    try {
        console.log(`... Iniciando Puppeteer para ${fileNameForLog}`);
        browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--font-render-hinting=none'] });
        const page = await browser.newPage();
        page.on('pageerror', error => console.error(`!! Page Error (${fileNameForLog}): ${error.message}`));
        page.on('requestfailed', request => console.error(`!! Request Failed (${fileNameForLog}): ${request.url()} - ${request.failure()?.errorText}`)); // Added null check for safety
        await page.setContent(htmlContent, { waitUntil: 'networkidle0', timeout: 90000 });
        await page.emulateMediaType('print');
        await page.pdf({ path: outputFilePath, format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: `<span></span>`, footerTemplate: `<span></span>`, margin: { top: '0cm', right: '0cm', bottom: '0cm', left: '0cm' }, preferCSSPageSize: true });
        console.log(`-> PDF Generado: ${fileNameForLog}`);
        return true;
    } catch (error) {
        console.error(`\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`);
        console.error(`!! ERROR generando PDF ${fileNameForLog}:`);
        console.error(`!! Mensaje: ${error.message}`);
        console.error(`!! Stack Trace:`);
        console.error(error.stack); // Imprimir stack trace completo
        console.error(`!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n`);
        return false;
    } finally {
        if (browser) { await browser.close(); }
    }
}

// --- Ejecución Principal (Carga Directorio, Genera por Categoría) ---
async function main() {
    const argv = yargs(hideBin(process.argv))
        .scriptName("generate_pdf_magazine.js")
        .usage('Uso: $0 [opciones] <directorio_con_json>')
        .command('$0 <inputDir>', 'Genera PDFs de revista (uno por categoría) desde archivos JSON en un directorio', (yargs) => {
             yargs.positional('inputDir', { describe: 'Directorio que contiene los archivos JSON', type: 'string', normalize: true })
         })
        .option('o', { alias: 'outputDir', description: 'Directorio donde se guardarán los PDFs', type: 'string', default: './revistas_generadas', normalize: true })
        .option('t', { alias: 'titlePrefix', description: 'Prefijo para el título de cada revista PDF', type: 'string', default: 'Buscadis Clasificados' })
        .help('h').alias('h', 'help').strict()
        .fail((msg, err, yargs) => { console.error("Error:", msg); console.error("\n", yargs.help()); process.exit(1); })
        .parse();

    const inputDirectory = argv.inputDir;
    const outputDirectory = argv.outputDir;
    const titlePrefix = argv.titlePrefix;

    let allPublications = [];
    let jsonFilesToProcess = [];
    let filesWithError = [];

    console.log(`Buscando archivos JSON en: ${inputDirectory}`);
    try {
        await fs.mkdir(outputDirectory, { recursive: true }); // Crear directorio de salida
        const directoryEntries = await fs.readdir(inputDirectory, { withFileTypes: true });
        jsonFilesToProcess = directoryEntries
            .filter(dirent => dirent.isFile() && path.extname(dirent.name).toLowerCase() === '.json')
            .map(dirent => path.join(inputDirectory, dirent.name))
            .sort((a, b) => { /* ... ordenamiento numérico ... */
                const numA = parseInt(path.basename(a).match(/(\d+)/)?.[1] || 0);
                const numB = parseInt(path.basename(b).match(/(\d+)/)?.[1] || 0);
                return numA - numB;
             });
        if (jsonFilesToProcess.length === 0) throw new Error(`No se encontraron archivos .json en ${inputDirectory}`);
        console.log(`Se encontraron ${jsonFilesToProcess.length} archivos JSON.`);
    } catch (error) {
        if (error.code === 'ENOENT') { console.error(`Error: El directorio no existe o no es accesible: ${inputDirectory}`); }
        else { console.error(`Error al leer directorio ${inputDirectory}:`, error); }
        return;
    }

    console.log("\n--- Cargando Publicaciones ---");
    for (const [index, jsonFilePath] of jsonFilesToProcess.entries()) {
        const fileName = path.basename(jsonFilePath);
        console.log(`[${index + 1}/${jsonFilesToProcess.length}] Procesando: ${fileName}...`);
        try {
            const pubsData = await loadJsonData(jsonFilePath);
            if (pubsData) {
                allPublications = allPublications.concat(pubsData);
                console.log(`   -> OK (${pubsData.length} pubs)`);
            } else {
                 console.warn(`   ! WARN: ${fileName} sin datos válidos o error al cargar.`);
                 filesWithError.push(fileName);
            }
        } catch (loadError) {
             console.error(`   !! FATAL ERROR cargando ${fileName}: ${loadError.message}`);
             filesWithError.push(fileName);
             // Considerar salir si la carga es crítica: // process.exit(1);
        }
    }

    if (allPublications.length === 0) { console.log("\nNo se cargaron publicaciones válidas. Abortando."); return; }
    console.log(`\n--- Carga Finalizada ---`);
    console.log(`Total de publicaciones válidas cargadas: ${allPublications.length}`);
    if (filesWithError.length > 0) console.warn(`Archivos con errores o sin datos: ${filesWithError.join(', ')}`);

    const groupedData = groupPubsByCategory(allPublications);

    console.log("\n--- Iniciando Generación de PDFs por Categoría ---");
    let successCount = 0;
    let errorCount = 0;
    const totalCategories = Object.keys(groupedData).length;
    const categoryColors = { // Paleta de colores por categoría (Ejemplo)
        'Inmuebles': { primary: '#2a9d8f', accent: '#264653' },
        'Vehículos': { primary: '#e76f51', accent: '#f4a261' },
        'Empleos':   { primary: '#0077b6', accent: '#00b4d8' },
        'Servicios': { primary: '#8e44ad', accent: '#9b59b6' },
        'Productos': { primary: '#34495e', accent: '#2c3e50' },
        'Mascotas':  { primary: '#e07a5f', accent: '#f2cc8f' },
        'Comunidad': { primary: '#577590', accent: '#43aa8b' },
        'Negocios':  { primary: '#4d908e', accent: '#f9c74f' },
        'default':   { primary: '#004a8f', accent: '#007bff' }
    };

    for (const [categoryName, pubsInCategory] of Object.entries(groupedData)) {
        const categoryIndex = successCount + errorCount + 1;
        console.log(`\n[${categoryIndex}/${totalCategories}] Procesando categoría: ${categoryName} (${pubsInCategory.length} pubs)`);
        const categoryTitle = `${titlePrefix} - ${categoryName}`;
        const safeCategoryName = categoryName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '');
        const categoryOutputFilename = path.join(outputDirectory, `revista_${safeCategoryName}.pdf`);
        const styleOverrides = categoryColors[categoryName] || categoryColors['default'];

        console.log(`   Generando HTML para ${categoryName}...`);
        const categoryHtml = generateMagazineHtml({ [categoryName]: pubsInCategory }, categoryTitle, styleOverrides);

        // Guardar HTML para debug (opcional)
        // const htmlDebugPath = categoryOutputFilename.replace(/\.pdf$/i, '_debug.html');
        // await fs.writeFile(htmlDebugPath, categoryHtml, 'utf-8');
        // console.log(`   HTML guardado para debug en: ${path.basename(htmlDebugPath)}`);

        const success = await savePdf(categoryHtml, categoryOutputFilename);
        if (success) { successCount++; } else { errorCount++; }
    }

    // Resumen final
    console.log("\n--- Resumen de Generación ---");
    console.log(` Directorio de Salida: ${outputDirectory}`);
    console.log(` PDFs Generados con Éxito: ${successCount}`);
    if (errorCount > 0) console.error(` PDFs con Errores: ${errorCount}`);
    console.log("----------------------------");
}

// Ejecutar script
main().catch(error => {
  console.error("!! Error fatal:", error);
  process.exit(1);
});