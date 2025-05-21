# MongoESIndexer

A NestJS-based application for indexing MongoDB data into Elasticsearch with high performance and reliability.

## Overview

MongoESIndexer is a robust data pipeline application that efficiently transfers and indexes data from MongoDB to Elasticsearch. It implements the ETL (Extract, Transform, Load) pattern with advanced features like rate limiting, progress tracking, and error handling.

## Features

- **Efficient Data Transfer**: Implements optimized data extraction from MongoDB
- **Rate Limiting**: Uses Bottleneck for controlled data processing
- **Progress Tracking**: Real-time progress monitoring with CLI progress bars
- **Resume**: Resume from last indexed documents. No need to reindex all documents in case of failure.
- **Real Time Updates**: It uses mongodb change events to keep the index sync in real time.
- **Configurable**: Flexible configuration through config files.

## Prerequisites

- Node.js (version specified in .nvmrc)
- MongoDB instance
- Elasticsearch instance
- Docker and Docker Compose [optional] (only for containerized deployment)

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd MongoESIndexer
```

2. Install dependencies:
```bash
yarn install
```

3. Configure environment variables:
Create a `.env` file in the root directory with the following variables:
```env
MONGODB_URI=your_mongodb_connection_string
ELASTICSEARCH_NODE=your_elasticsearch_url
CONFIGS_DIR=Directory path containing the configuration files (default: './configs')
```

## Development

```bash
# Start development server
yarn start:dev

# Run tests
yarn test

# Run linting
yarn lint

# Format code
yarn format
```

## Production Deployment

### Using Docker

1. Build the Docker image:
```bash
docker build -t mongo-es-indexer .
```

2. Run using Docker Compose:
```bash
docker-compose up -d
```

### Using PM2

```bash
# Start in production mode
yarn start:prod

# Or using PM2
pm2 start pm2.start-prod.json
```

## Project Structure

```
src/
├── configs/           # Configuration files
├── indexer/          # Main ETL implementation
│   ├── extract.service.ts    # MongoDB data extraction
│   ├── transform.service.ts  # Data transformation
│   ├── load.service.ts       # Elasticsearch data loading
│   └── indexer.module.ts     # Module configuration
├── utils/            # Utility functions
├── scripts/          # Helper scripts
└── main.ts          # Application entry point
```

## Architecture

The application follows a modular architecture with three main services:

1. **Extract Service**: Handles data extraction from MongoDB
   - Implements cursor-based pagination
   - Supports batch processing
   - Includes error handling and retry mechanisms

2. **Transform Service**: Processes and transforms data
   - Data validation
   - Schema mapping
   - Data enrichment

3. **Load Service**: Manages data loading into Elasticsearch
   - Bulk indexing
   - Rate limiting
   - Error handling and retry logic

### Configuration Schema

The application uses a Zod schema for configuration validation. Here's the complete configuration schema:

```typescript
{
  collection: string;        // The MongoDB collection to index
  index_name: string;        // The Elasticsearch index name
  batch_size: number;        // Number of documents to process in each batch
  index_on_start: boolean;   // Whether to index the collection on start
  force_delete: boolean;     // Whether to delete the index before indexing
  skip_after_seconds: number; // Time in seconds to skip after indexing (default: 0)
  aggregation_pipeline: any[]; // MongoDB aggregation pipeline for data transformation
  index_params: {
    settings: Record<string, any>; // Elasticsearch index settings
    mappings: Record<string, any>; // Elasticsearch index mappings
  }
}
```

#### Configuration Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `collection` | string | The MongoDB collection to be indexed |
| `index_name` | string | The target Elasticsearch index name |
| `batch_size` | number | Number of documents to process in each batch |
| `index_on_start` | boolean | If true, starts indexing immediately on application start |
| `force_delete` | boolean | If true, deletes the existing index before creating a new one |
| `skip_after_seconds` | number | Time window in seconds to skip re-indexing of recently indexed documents |
| `aggregation_pipeline` | array | MongoDB aggregation pipeline for data transformation |
| `index_params.settings` | object | Elasticsearch index settings (e.g., shards, replicas) |
| `index_params.mappings` | object | Elasticsearch index mappings (field definitions) |

Example configuration:
```json
{
  "collection": "users",
  "index_name": "users_index",
  "batch_size": 1000,
  "index_on_start": true,
  "force_delete": false,
  "skip_after_seconds": 3600,
  "aggregation_pipeline": [
    { "$match": { "status": "active" } }
  ],
  "index_params": {
    "settings": {
      "number_of_shards": 3,
      "number_of_replicas": 1
    },
    "mappings": {
      "properties": {
        "name": { "type": "text" },
        "age": { "type": "integer" }
      }
    }
  }
}
```

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is unlicensed. See the LICENSE file for details.

## Author

Saurabh Gupta
