import { z } from 'zod';

export const ConfigurationSchema = z.object({
	ENVIRONMENT: z
		.enum(['development', 'production', 'test'])
		.optional()
		.default('development')
		.describe('The environment the application is running in'),
	PORT: z.number().default(3000).describe('The port the application will listen to'),
	MONGODB_URI: z.string().describe('The MongoDB URI'),
	MONGODB_DB_NAME: z.string().describe('The MongoDB database name'),
	ELASTICSEARCH_URI: z.string().describe('The Elasticsearch URI'),
});
