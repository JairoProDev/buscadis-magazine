# Publication Uploader Tool

A standalone tool for uploading publication data from JSON files to the Buscadis MongoDB database.

## Overview

This tool allows you to bulk import publications from JSON files into your MongoDB database. It's designed to be run independently from the main application, making it easy to manage content uploads without going through the web interface.

## Setup

1. Copy this entire `publication-uploader` directory to where you want to run it.

2. Make sure you have a valid `.env.local` file in the same directory or a parent directory, containing your MongoDB connection information:
   ```
   MONGODB_URI=mongodb+srv://your-username:your-password@your-cluster.mongodb.net
   MONGODB_DB=buscadis
   ```

3. Install the dependencies:
   ```bash
   npm install
   ```

## Usage

### Basic Usage

To upload publications from a directory containing JSON files:

```bash
node uploader.js /path/to/json/files
```

For example:
```bash
node uploader.js C:/Users/Usuario/Desktop/buscadis-magazine/publications/R2621-ABRIL-24-25-26-27/
```

### Options

- `--dry-run`: Simulate the upload without actually inserting data into the database
- `--force`: Skip confirmation prompts

### Example

```bash
# Test the import without making changes
node uploader.js /path/to/json/files --dry-run

# Import all files without confirmation
node uploader.js /path/to/json/files --force
```

## JSON File Format

The tool expects JSON files containing publications in the following format:

```json
[
  {
    "title": "Publication Title",
    "description": "Detailed description of the publication",
    "category": "inmuebles",
    "subcategory": "casas",
    "subsubcategory": "casa-urbana",
    "price": 1500,
    "currency": "PEN",
    "contactPhone": "999123456",
    "contactEmail": "example@email.com",
    "location": {
      "city": "Cusco",
      "district": "San Sebastián"
    },
    "images": ["https://example.com/image1.jpg"]
  },
  {
    "title": "Another Publication",
    ...
  }
]
```

Each file can contain a single publication object or an array of publication objects.

## Required Fields

The following fields are required for each publication:

- `title`: The title of the publication
- `description`: A detailed description
- `category`: One of: empleos, inmuebles, vehiculos, servicios, productos, eventos, negocios, comunidad
- `location`: An object containing at least city or district
- Contact information: At least one of contactPhone, contactEmail, or contact object with phone, email, or whatsapp

## Categories

The tool supports the following categories, each with its corresponding MongoDB collection:

- `empleos`: publications_empleos
- `inmuebles`: publications_inmuebles
- `vehiculos`: publications_vehiculos
- `servicios`: publications_servicios
- `productos`: publications_productos
- `eventos`: publications_eventos
- `negocios`: publications_negocios
- `comunidad`: publications_comunidad

## Error Handling

The tool validates each publication before importing and generates a summary of successful imports and errors. Detailed error information is provided for troubleshooting. 