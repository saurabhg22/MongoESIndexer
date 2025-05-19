import { Inject, Injectable } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { IndicesCreateRequest, IndicesPutMappingRequest } from '@elastic/elasticsearch/lib/api/types';
import * as fs from 'fs/promises';
import path from 'path';
import { MongoService } from './mongo.service';
import { Configuration, ConfigurationSchema } from './config';
import Bottleneck from 'bottleneck';

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
				await this.indexCollection(config);
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
				console.log(`upsertIndex: index ${params.index} already exists, updating mapping`);
				return this.updateMapping(params);
			}
			console.log(`upsertIndex: index ${params.index} does not exist, creating`);
			return this.esClient.indices.create(params);
		} catch (error) {
			console.error(`upsertIndex: index ${params.index} error ${error}`);
		}
	}

	async getBulkIndexBody(index: string, documents: any[]) {
		return documents.flatMap((document) => [
			{
				index: {
					_index: index,
					_id: document._id || document.id,
				},
			},
			{ ...document, _id: undefined, id: document._id || document.id },
		]);
	}

	async bulkIndexDocuments(index: string, documents: any[]) {
		console.log(`bulkIndexDocuments: index ${index}`);
		const bulkBody = await this.getBulkIndexBody(index, documents);
		const response = await this.esClient.bulk({
			index,
			body: bulkBody,
		});
		console.log(`bulkIndexDocuments: ${bulkBody.length / 2} documents indexed`);
		return response;
	}

	async indexCollection(config: Configuration) {
		console.log(`indexCollection: index ${config.index_params.index}`);
		const totalDocuments = await this.mongoService.countDocuments(config.collection, config.aggregation_pipeline);
		console.log(`indexCollection: Total documents: ${totalDocuments}`);

		let done = 0;
		let documents = [];
		const limiter = new Bottleneck({
			maxConcurrent: 1,
			minTime: 100,
		});

		while (true) {
			documents = await limiter.schedule(() =>
				this.mongoService.getDocuments(config.collection, config.aggregation_pipeline, config.batch_size, done),
			);
			if (documents.length === 0) {
				console.log(`indexCollection: No more documents to index`);
				break;
			}
			await this.bulkIndexDocuments(config.index_params.index, documents);
			done += documents.length;
			console.log(`indexCollection: Completed ${done} documents`);
		}
	}
}
