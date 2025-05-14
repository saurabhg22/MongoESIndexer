import { Inject, Injectable } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { IndicesCreateRequest, IndicesPutMappingRequest } from '@elastic/elasticsearch/lib/api/types';
import * as fs from 'fs/promises';
import path from 'path';
import { MongoService } from './mongo.service';
import { Configuration, ConfigurationSchema } from './config';

@Injectable()
export class IndexerService {
	constructor(
		private readonly mongoService: MongoService,
		@Inject('ESClient') private readonly esClient: Client,
	) {
		this.init(path.join(__dirname, '../configs'));
	}

	async init(configDir: string) {
		const configFiles = await fs.readdir(configDir);
		for (const configFile of configFiles) {
			const config = ConfigurationSchema.parse(
				JSON.parse(await fs.readFile(configDir + '/' + configFile, 'utf8')),
			);
			await this.upsertIndex(config.index_params as IndicesCreateRequest);
			if (config.index_on_start) {
				await this.indexDocuments(config);
			}
		}
	}

	async listAllIndices() {
		return this.esClient.cat.indices({ format: 'json' });
	}

	async createIndex(params: IndicesCreateRequest) {
		return this.esClient.indices.create(params);
	}

	async updateMapping(params: IndicesCreateRequest) {
		const mappingRequest: IndicesPutMappingRequest = {
			...params.mappings,
			index: params.index,
		};
		await this.esClient.indices.putMapping(mappingRequest);
	}

	async upsertIndex(params: IndicesCreateRequest) {
		try {
			const exists = await this.esClient.indices.exists({
				index: params.index,
			});
			console.log('exists', exists);
			if (exists) {
				console.log('index already exists, updating mapping');
				return this.updateMapping(params);
			}
			console.log('index does not exist, creating');
			return this.esClient.indices.create(params);
		} catch (error) {
			console.error('upsertIndex: error', error);
		}
	}

	async indexDocuments(config: Configuration) {
		console.log('indexDocuments', config);
		const documents = await this.mongoService.getDocuments(
			config.collection,
			config.aggregation_pipeline,
			config.batch_size,
		);
		console.log('documents', documents);
	}
}
