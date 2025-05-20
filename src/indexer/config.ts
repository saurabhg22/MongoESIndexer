import { z } from 'zod';

export const ConfigurationSchema = z.object({
	collection: z.string().describe('The collection to index'),
	index_name: z.string().describe('The index to use'),
	doc_type: z.string().describe('The doc type to use'),
	batch_size: z.number().describe('The batch size to use'),
	index_on_start: z.boolean().describe('Whether to index the collection on start'),
	force_delete: z.boolean().describe('Whether to delete the index before indexing'),
	skip_after_seconds: z
		.number()
		.default(0)
		.describe(
			'The number of seconds to skip after indexing. Default is 0. ' +
				'This is used to avoid indexing the same documents twice. ' +
				'This is the time after which if the document is indexed, it will not be indexed again.',
		),
	aggregation_pipeline: z.array(z.any()).describe('The aggregation pipeline to use'),
	index_params: z.object({
		settings: z.record(z.any()).describe('The settings to use'),
		mappings: z.record(z.any()).describe('The mappings to use'),
	}),
});

export type Configuration = z.infer<typeof ConfigurationSchema>;
