import { Inject, Injectable } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { IndicesCreateRequest, IndicesPutMappingRequest } from '@elastic/elasticsearch/lib/api/types';
import * as fs from 'fs/promises';
import path from 'path';
import { MongoService } from './mongo.service';
import { Configuration, ConfigurationSchema } from './config';
import Bottleneck from 'bottleneck';
import cliProgress from 'cli-progress';
import { ObjectId } from 'mongodb';

@Injectable()
export class IndexerService {
	configs: Configuration[] = [];
	constructor(
		private readonly mongoService: MongoService,
		@Inject('ESClient') private readonly esClient: Client,
	) {
		setTimeout(() => {
			this.init(path.join(__dirname, '../configs'));
		}, 1000);
	}

	async init(configDir: string) {
		const configFiles = await fs.readdir(configDir);

		await this.upsertIndex({
			index: 'resume_tokens',
			mappings: {
				properties: {
					token: { type: 'keyword' },
					index: { type: 'keyword' },
					doc_type: { type: 'keyword' },
				},
			},
		});
		for (const configFile of configFiles) {
			const config = ConfigurationSchema.parse(
				JSON.parse(await fs.readFile(configDir + '/' + configFile, 'utf8')),
			);
			this.configs.push(config);
			if (config.force_delete) {
				await this.deleteIndex(config.index_params.index);
			}
			await this.upsertIndex(config.index_params as IndicesCreateRequest);
			if (config.index_on_start) {
				await this.indexCollection(config);
			}
			await this.handleChangeStream(config.collection);
		}
		const resumeTokens = await this.getResumeTokens();
		console.log('resumeTokens', resumeTokens);
	}

	async getResumeTokens() {
		const response = await this.esClient.search({
			index: 'resume_tokens',
			query: {
				match_all: {},
			},
		});
		return response.hits.hits;
	}

	async listAllIndices() {
		return this.esClient.cat.indices({ format: 'json' });
	}

	async createIndex(params: IndicesCreateRequest) {
		return this.esClient.indices.create(params);
	}

	async deleteIndex(index: string) {
		return this.esClient.indices.delete({ index });
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

	async getBulkIndexBody(index: string, documents: any[], doc_type: string) {
		return documents.flatMap((document) => [
			{
				index: {
					_index: index,
					_id: document._id || document.id,
				},
			},
			{ ...document, _id: undefined, id: document._id || document.id, doc_type },
		]);
	}

	async bulkIndexDocuments(index: string, documents: any[], doc_type: string) {
		const bulkBody = await this.getBulkIndexBody(index, documents, doc_type);
		const response = await this.esClient.bulk({
			index,
			body: bulkBody,
		});
		return response;
	}

	async indexOne(collection: string, id: string) {
		const configs = this.configs.filter((config) => config.collection === collection);
		if (configs.length === 0) {
			throw new Error(`indexOne: config for ${collection} not found`);
		}
		for (const config of configs) {
			const [document] = await this.mongoService.getDocuments(config.collection, [
				{
					$match: {
						_id: new ObjectId(id),
					},
				},
				...config.aggregation_pipeline,
			]);
			if (!document) {
				throw new Error(`indexOne: document for ${collection} with id ${id} not found`);
			}
			await this.bulkIndexDocuments(config.index_params.index, [document], config.doc_type);
		}
	}

	async deleteOne(collection: string, id: string) {
		const configs = this.configs.filter((config) => config.collection === collection);
		if (configs.length === 0) {
			throw new Error(`deleteOne: config for ${collection} not found`);
		}
		for (const config of configs) {
			await this.esClient.delete({
				index: config.index_params.index,
				id,
			});
		}
	}

	async indexCollection(config: Configuration) {
		console.log(`indexCollection: index ${config.index_params.index}`);
		const totalDocuments = await this.mongoService.countDocuments(config.collection, config.aggregation_pipeline);
		let documents = [];
		const limiter = new Bottleneck({
			maxConcurrent: 1,
			minTime: 100,
		});
		const esLimiter = new Bottleneck({
			maxConcurrent: 1,
			minTime: 100,
		});

		const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
		bar.start(totalDocuments, 0);

		for (let done = 0; done < totalDocuments; ) {
			await limiter.schedule(async () => {
				documents = await this.mongoService.getDocuments(
					config.collection,
					config.aggregation_pipeline,
					config.batch_size,
					done,
				);
				if (documents.length === 0) {
					console.log(`indexCollection: No more documents to index`);
					return;
				}
				await esLimiter.schedule(() =>
					this.bulkIndexDocuments(config.index_params.index, documents, config.doc_type),
				);
				done += documents.length;
				bar.update(done);
			});
		}
		bar.stop();
	}

	async handleChangeStream(collectionName: string) {
		console.log(`handleChangeStream: ${collectionName}`);
		const changeStream = await this.mongoService.getChangeStream(collectionName, null);
		for await (const change of changeStream) {
			switch (change.operationType) {
				case 'insert':
					await this.indexOne(collectionName, change.documentKey._id);
					break;
				case 'update':
					await this.indexOne(collectionName, change.documentKey._id);
					break;
				case 'delete':
					await this.deleteOne(collectionName, change.documentKey._id);
					break;
			}
		}
	}
}
