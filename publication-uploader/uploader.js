/**
 * Publication Uploader Tool
 *
 * This standalone tool uploads publication data from JSON files to MongoDB.
 * It's designed to be run independently from the main application.
 *
 * Usage:
 * node scripts/publication-uploader/uploader.js <source-directory>
 *
 * Options:
 *   --dry-run: Shows what would be imported without making changes
 *   --force: Runs without asking for confirmation
 */

// Dependencies
const { MongoClient, ServerApiVersion } = require("mongodb");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");
const readline = require("readline");
const crypto = require("crypto");

// Load environment variables from .env.local file
const envPath = path.resolve(process.cwd(), ".env.local");
dotenv.config({ path: envPath });

// MongoDB connection settings
const uri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const dbName = process.env.MONGODB_DB || "buscadis";

// MongoDB client with optimal settings
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  maxPoolSize: 10,
  connectTimeoutMS: 30000,
  socketTimeoutMS: 45000,
});

// Collections based on categories
const CATEGORY_COLLECTIONS = {
  empleos: "publications_empleos",
  inmuebles: "publications_inmuebles",
  vehiculos: "publications_vehiculos",
  servicios: "publications_servicios",
  productos: "publications_productos",
  eventos: "publications_eventos",
  negocios: "publications_negocios",
  comunidad: "publications_comunidad",
};

// Set up readline interface for user interaction
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Helper function for asking questions with promises
function askUser(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

// Process command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const isForce = args.includes("--force");

// Get source directory from arguments
let sourceDir = null;
for (const arg of args) {
  if (!arg.startsWith("--")) {
    sourceDir = arg;
    break;
  }
}

// Validate source directory
if (!sourceDir) {
  console.error(
    "Error: Please provide a source directory containing JSON files."
  );
  console.error(
    "Usage: node scripts/publication-uploader/uploader.js <source-directory> [options]"
  );
  console.error("Options:");
  console.error("  --dry-run: Simulate import without making actual changes");
  console.error("  --force: Skip confirmation prompts");
  process.exit(1);
}

/**
 * Generate a unique ID for a publication
 */
function generateUniqueId(prefix) {
  const timestamp = Date.now();
  const randomStr = crypto.randomBytes(4).toString("hex");
  return `${prefix}_${timestamp}_${randomStr}`;
}

/**
 * Generate a short ID for a publication
 */
function generateShortId(category) {
  // Generate a random number between 1000 and 9999
  const counter = Math.floor(1000 + Math.random() * 9000);
  return counter.toString();
}

/**
 * Generate a URL-friendly slug from a title
 */
function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^\w\sáéíóúüñ]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[áàäâ]/g, "a")
    .replace(/[éèëê]/g, "e")
    .replace(/[íìïî]/g, "i")
    .replace(/[óòöô]/g, "o")
    .replace(/[úùüû]/g, "u")
    .replace(/ñ/g, "n")
    .replace(/-+/g, "-")
    .trim()
    .substring(0, 80);
}

/**
 * Detect category based on publication title keywords
 */
function detectCategory(title) {
  const lowerTitle = title.toLowerCase();

  // Inmuebles patterns
  if (
    lowerTitle.includes("alquilo") ||
    lowerTitle.includes("alquiler") ||
    lowerTitle.includes("vendo terreno") ||
    lowerTitle.includes("vendo lote") ||
    lowerTitle.includes("vendo casa") ||
    lowerTitle.includes("vendo departamento") ||
    lowerTitle.includes("anticresis") ||
    lowerTitle.includes("inmueble") ||
    lowerTitle.includes("habitación") ||
    lowerTitle.includes("oficina") ||
    lowerTitle.includes("local comercial")
  ) {
    return "inmuebles";
  }

  // Vehículos patterns
  if (
    lowerTitle.includes("auto") ||
    lowerTitle.includes("camioneta") ||
    lowerTitle.includes("vehículo") ||
    lowerTitle.includes("carro") ||
    lowerTitle.includes("moto") ||
    lowerTitle.includes("camión")
  ) {
    return "vehiculos";
  }

  // Empleos patterns
  if (
    lowerTitle.includes("necesito") ||
    lowerTitle.includes("se necesita") ||
    lowerTitle.includes("busco personal") ||
    lowerTitle.includes("oportunidad laboral") ||
    lowerTitle.includes("requiere personal") ||
    lowerTitle.includes("empleo")
  ) {
    return "empleos";
  }

  // Servicios patterns
  if (
    lowerTitle.includes("servicio") ||
    lowerTitle.includes("reparación") ||
    lowerTitle.includes("mantenimiento") ||
    lowerTitle.includes("clases") ||
    lowerTitle.includes("profesor") ||
    lowerTitle.includes("terapia") ||
    lowerTitle.includes("consultoría") ||
    lowerTitle.includes("asesoría")
  ) {
    return "servicios";
  }

  // Productos patterns
  if (
    lowerTitle.includes("vendo") &&
    !lowerTitle.includes("vendo terreno") &&
    !lowerTitle.includes("vendo casa") &&
    !lowerTitle.includes("vendo departamento") &&
    !lowerTitle.includes("vendo lote")
  ) {
    return "productos";
  }

  // Eventos patterns
  if (
    lowerTitle.includes("evento") ||
    lowerTitle.includes("fiesta") ||
    lowerTitle.includes("concierto") ||
    lowerTitle.includes("celebración")
  ) {
    return "eventos";
  }

  // Comunidad patterns
  if (
    lowerTitle.includes("comunidad") ||
    lowerTitle.includes("perdido") ||
    lowerTitle.includes("encontrado") ||
    lowerTitle.includes("donación")
  ) {
    return "comunidad";
  }

  // Negocios patterns
  if (
    lowerTitle.includes("negocio") ||
    lowerTitle.includes("traspaso") ||
    lowerTitle.includes("inversión")
  ) {
    return "negocios";
  }

  // Default to productos if no category detected
  return "productos";
}

/**
 * Validate publication data
 */
function validatePublication(publication) {
  // Map categorySlug to category if category is missing
  if (!publication.category && publication.categorySlug) {
    publication.category = publication.categorySlug;
    console.log(
      `  - Using categorySlug "${publication.categorySlug}" for "${publication.title}"`
    );
  }

  // Check required fields
  const requiredFields = ["title", "description"];
  const missingFields = requiredFields.filter((field) => !publication[field]);

  if (missingFields.length > 0) {
    return {
      valid: false,
      error: `Missing required fields: ${missingFields.join(", ")}`,
    };
  }

  // Validate category
  if (!CATEGORY_COLLECTIONS[publication.category]) {
    return {
      valid: false,
      error: `Invalid category: ${
        publication.category
      }. Valid categories: ${Object.keys(CATEGORY_COLLECTIONS).join(", ")}`,
    };
  }

  // Process subcategory and subsubcategory
  if (!publication.subcategory && publication.subcategorySlug) {
    publication.subcategory = publication.subcategorySlug;
  }

  if (!publication.subsubcategory && publication.subSubcategorySlug) {
    publication.subsubcategory = publication.subSubcategorySlug;
  }

  // Handle contact information
  if (publication.contact && publication.contact.phones) {
    const phone = publication.contact.phones[0] || "";
    publication.contact = {
      name: publication.contact.name || "Anunciante",
      phone: phone,
      whatsapp: phone,
      email: publication.contact.email || "contacto@buscadis.com",
    };
  } else if (!publication.contact) {
    publication.contact = {
      name: "Anunciante",
      phone: "999999999",
      whatsapp: "999999999",
      email: "contacto@buscadis.com",
    };
  }

  // Auto-create location if missing
  if (!publication.location) {
    publication.location = {
      city: "Cusco",
      district: "Cusco",
    };
    console.log(`  - Auto-created location for "${publication.title}"`);
  } else if (publication.location.district && !publication.location.city) {
    // If only district is provided, set city to Cusco
    publication.location.city = "Cusco";
  }

  // Validate price if present
  if (publication.price !== undefined) {
    const price = parseFloat(publication.price);
    if (isNaN(price) || price < 0) {
      return {
        valid: false,
        error: `Invalid price: ${publication.price}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Prepare publication data for insertion
 */
function preparePublicationForInsertion(publication) {
  const now = new Date().toISOString();
  const category = publication.category;

  // Generate short ID and slug
  const shortId = generateShortId(category);
  const slug = generateSlug(publication.title);

  // Map location fields if needed
  if (publication.location) {
    if (publication.location.province && !publication.location.city) {
      publication.location.city = publication.location.province;
    }
  }

  // Use subcategory from subcategorySlug
  const subcategory =
    publication.subcategory || publication.subcategorySlug || "general";
  const subsubcategory =
    publication.subsubcategory || publication.subSubcategorySlug || "";

  // Build URL path
  let urlPath = `/${category}/${subcategory}`;
  if (subsubcategory) {
    urlPath += `/${subsubcategory}`;
  }
  urlPath += `/${shortId}-${slug}`;

  // Use provided ID or generate a new one
  if (!publication.id || publication.id.includes("_")) {
    publication.id = shortId;
  }

  // Map price from amount if available
  if (publication.amount !== undefined && publication.price === undefined) {
    publication.price = parseFloat(publication.amount);
  }

  // Process contact information
  let contact = publication.contact || {};
  if (publication.contact && publication.contact.phones) {
    const phone = publication.contact.phones[0] || "";
    contact = {
      name: publication.contact.name || "Anunciante",
      phone: phone,
      whatsapp: phone,
      email: publication.contact.email || "contacto@buscadis.com",
    };
  }

  // Move attributes to features if needed
  let features = publication.features || {};
  if (publication.attributes) {
    features = { ...features, ...publication.attributes };
  }

  // Prepare final publication object
  const preparedPublication = {
    ...publication,
    status: publication.status || "active",
    created_at: publication.created_at || now,
    updated_at: publication.updated_at || now,
    id: String(publication.id),
    id_corto: shortId,
    slug: slug,
    url_path: urlPath,
    subcategory: subcategory,
    subsubcategory: subsubcategory || undefined,
    images: publication.images || [],
    user_id: publication.user_id || "admin", // Default user for imported publications
    contact: contact,
    features: features,
  };

  // Remove redundant fields
  delete preparedPublication.categorySlug;
  delete preparedPublication.subcategorySlug;
  delete preparedPublication.subSubcategorySlug;
  delete preparedPublication.attributes;
  delete preparedPublication.amount;

  // Ensure price exists
  if (preparedPublication.price === undefined) {
    preparedPublication.price = 0;
  }

  // Default currency
  if (!preparedPublication.currency) {
    preparedPublication.currency = "PEN";
  }

  return preparedPublication;
}

/**
 * Main function to upload publications
 */
async function uploadPublications() {
  console.log("=== PUBLICATION UPLOADER TOOL ===");
  console.log(`Source directory: ${sourceDir}`);
  console.log(`MongoDB URI: ${uri.substring(0, 15)}...`);
  console.log(`Database: ${dbName}`);
  console.log(`Mode: ${isDryRun ? "Dry run (no changes)" : "Import"}`);
  console.log("=================================");

  try {
    // Check if source directory exists
    if (!fs.existsSync(sourceDir)) {
      console.error(`Error: Directory "${sourceDir}" does not exist`);
      process.exit(1);
    }

    // Read all JSON files in the directory
    const files = fs
      .readdirSync(sourceDir)
      .filter((file) => file.endsWith(".json"));

    if (files.length === 0) {
      console.error(`Error: No JSON files found in "${sourceDir}"`);
      process.exit(1);
    }

    console.log(`Found ${files.length} JSON files: ${files.join(", ")}`);

    // Ask for confirmation unless forced
    if (!isForce && !isDryRun) {
      const answer = await askUser(
        `Do you want to import ${files.length} files? (yes/no): `
      );
      if (answer.toLowerCase() !== "yes" && answer.toLowerCase() !== "y") {
        console.log("Import canceled.");
        process.exit(0);
      }
    }

    // Connect to MongoDB
    if (!isDryRun) {
      console.log("Connecting to MongoDB...");
      await client.connect();
      console.log("Connected successfully");
    }

    // Process each file
    const results = {
      total: 0,
      success: 0,
      errors: [],
      skipped: 0,
    };

    for (const file of files) {
      const filePath = path.join(sourceDir, file);
      console.log(`\nProcessing file: ${file}`);

      try {
        // Read and parse the JSON file
        const fileContent = fs.readFileSync(filePath, "utf8");
        const publications = JSON.parse(fileContent);

        // Ensure we have an array of publications
        const publicationsArray = Array.isArray(publications)
          ? publications
          : [publications];

        console.log(`Found ${publicationsArray.length} publications in file`);
        results.total += publicationsArray.length;

        // Process each publication
        for (const publication of publicationsArray) {
          try {
            // Validate the publication
            const validation = validatePublication(publication);
            if (!validation.valid) {
              console.error(
                `  - Error validating publication "${
                  publication.title || "Untitled"
                }": ${validation.error}`
              );
              results.errors.push({
                file,
                title: publication.title || "Untitled",
                error: validation.error,
              });
              continue;
            }

            // Prepare the publication
            const preparedPublication =
              preparePublicationForInsertion(publication);
            const collectionName =
              CATEGORY_COLLECTIONS[preparedPublication.category];

            if (isDryRun) {
              console.log(
                `  - Would import: "${preparedPublication.title}" (ID: ${preparedPublication.id}) to ${collectionName}`
              );
            } else {
              // Insert into MongoDB
              const db = client.db(dbName);
              await db
                .collection(collectionName)
                .insertOne(preparedPublication);
              console.log(
                `  - Imported: "${preparedPublication.title}" (ID: ${preparedPublication.id}) to ${collectionName}`
              );
            }

            results.success++;
          } catch (pubError) {
            console.error(
              `  - Error processing publication: ${pubError.message}`
            );
            results.errors.push({
              file,
              title: publication.title || "Untitled",
              error: pubError.message,
            });
          }
        }
      } catch (fileError) {
        console.error(`Error processing file ${file}: ${fileError.message}`);
        results.errors.push({
          file,
          error: `File error: ${fileError.message}`,
        });
      }
    }

    // Print summary
    console.log("\n=== IMPORT SUMMARY ===");
    console.log(`Total publications: ${results.total}`);
    console.log(`Successfully processed: ${results.success}`);
    console.log(`Errors: ${results.errors.length}`);

    if (results.errors.length > 0) {
      console.log("\nError details:");
      results.errors.forEach((err, index) => {
        console.log(
          `  ${index + 1}. File: ${err.file}, Title: ${
            err.title || "N/A"
          }, Error: ${err.error}`
        );
      });
    }

    if (isDryRun) {
      console.log(
        "\nThis was a dry run. No changes were made to the database."
      );
    }
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  } finally {
    // Close connections
    rl.close();
    if (!isDryRun && client) {
      await client.close();
      console.log("Closed MongoDB connection");
    }
  }
}

// Run the upload process
uploadPublications().catch(console.error);
