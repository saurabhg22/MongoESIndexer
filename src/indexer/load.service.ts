import { Inject, Injectable } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { IndicesCreateRequest, IndicesPutMappingRequest } from '@elastic/elasticsearch/lib/api/types';
import * as fs from 'fs/promises';
import path from 'path';
import { ExtractService } from './extract.service';
import { Configuration, ConfigurationSchema } from '../configuration';
import Bottleneck from 'bottleneck';
import cliProgress from 'cli-progress';
import { ObjectId } from 'mongodb';
import humanizeDuration from 'humanize-duration';
import { hasOnlyIndexingFields } from '@/utils/array-utils';
import { TransformService } from './transform.service';
@Injectable()
export class LoadService {
	configs: Configuration[] = [];
	constructor(
		private readonly extractService: ExtractService,
		private readonly transformService: TransformService,
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
					collection: { type: 'keyword' },
					created: {
						type: 'date',
					},
					index: {
						type: 'keyword',
					},
				},
			},
		});
		for (const configFile of configFiles) {
			const config = ConfigurationSchema.parse(
				JSON.parse(await fs.readFile(configDir + '/' + configFile, 'utf8')),
			);
			this.configs.push(config);
			if (config.force_delete) {
				console.log(`deleteIndex: ${config.index_name}`);
				await this.deleteIndex(config.index_name);
				await this.extractService.updateMany(
					config.collection,
					{},
					{ lastIndexedAt: null, lastIndexedResponse: null },
				);
			}

			await this.upsertIndex({ ...config.index_params, index: config.index_name } as IndicesCreateRequest);
		}
		await this.indexAll();
	}

	async indexAll() {
		const multiBar = new cliProgress.MultiBar(
			{
				clearOnComplete: false,
				hideCursor: true,
				format: `[{bar}] {index_name} Progress: {percentage}% | {value}/{total} | ETA: {humanized_eta} | Skipped: {skipped}, Total: {total_documents}`,
			},
			cliProgress.Presets.shades_grey,
		);
		const limiter = new Bottleneck({
			maxConcurrent: 3,
		});

		await Promise.all(
			this.configs.map(async (config) => {
				if (config.index_on_start) {
					await limiter.schedule(async () => {
						const bar = multiBar.create(200, 0, {
							index_name: config.index_name,
							humanized_eta: 0,
							total_documents: 0,
							skipped: 0,
						});
						await this.indexCollection(config, bar);
					});
				}
				this.handleChangeStream(config.collection, config.index_name);
			}),
		);
		multiBar.stop();
	}

	async getResumeToken(collectionName: string, index: string) {
		const response = await this.esClient.search({
			index: 'resume_tokens',
			query: {
				bool: {
					filter: [
						{
							term: {
								collection: collectionName,
							},
						},
						{
							term: {
								index,
							},
						},
					],
				},
			},
			sort: {
				created: 'desc',
			},
			size: 1,
		});
		const token = response.hits.hits[0];
		return token;
	}

	async listAllIndices() {
		return this.esClient.cat.indices({ format: 'json' });
	}

	async createIndex(params: IndicesCreateRequest) {
		return this.esClient.indices.create(params);
	}

	async deleteIndex(index: string) {
		try {
			await this.esClient.indices.delete({ index });
		} catch {
			console.warn(`Error deleting index ${index}`);
		}
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

	async bulkIndexDocuments(index: string, documents: any[]) {
		const bulkBody = await this.transformService.getBulkIndexBody(index, documents);
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
			const [document] = await this.extractService.getDocuments(config.collection, [
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
			const response = await this.bulkIndexDocuments(config.index_name, [document]);
			await this.extractService.updateOne(collection, id, {
				lastIndexedAt: new Date(),
				lastIndexedResponse: response.items.find((item) => item.index._id === id.toString())?.index?.result,
			});
		}
	}

	async deleteOne(collection: string, id: string) {
		const configs = this.configs.filter((config) => config.collection === collection);
		if (configs.length === 0) {
			throw new Error(`deleteOne: config for ${collection} not found`);
		}
		for (const config of configs) {
			await this.esClient.delete({
				index: config.index_name,
				id,
			});
		}
	}

	async indexCollection(config: Configuration, bar: cliProgress.SingleBar) {
		const skippedCount = await this.extractService.getIndexSkipCount(config);
		const totalDocuments = await this.extractService.getIndexCounts(config);
		const { pipeline, separateLookups } = this.extractService.processSeparateLookups(config);
		let documents = [];

		bar.start(totalDocuments, 0, {
			humanized_eta: 0,
			index_name: config.index_name,
			total_documents: totalDocuments + skippedCount,
			skipped: skippedCount,
		});
		let batchSize = config.batch_size;
		const startTime = new Date();

		for (let done = 0, completed = false; done < totalDocuments && !completed; ) {
			try {
				documents =
					batchSize <= 5
						? await this.extractService.getDocumentsWithNestedPagination(
								config.collection,
								pipeline,
								separateLookups,
							)
						: await this.extractService.getDocuments(config.collection, pipeline, batchSize);
			} catch (error: any) {
				if (error.codeName === 'BSONObjectTooLarge') {
					batchSize = Math.floor(batchSize / 2);
					console.log(`\nindexCollection: BSONObjectTooLarge, shrinking batch size to ${batchSize}`);

					if (batchSize < 1) {
						console.log(`indexCollection: BSONObjectTooLarge, batch size is too small, skipping documents`);
						batchSize = 1;
						done += batchSize;
						bar.update(done);
						return;
					}
					return;
				}
				console.error(`indexCollection: error getting documents: ${error}`);
				done += config.batch_size;
				bar.update(done);
				return;
			}
			if (batchSize < config.batch_size) {
				console.log(`indexCollection: resetting batch size to ${config.batch_size}`);
				batchSize = config.batch_size;
			}
			if (documents.length === 0) {
				console.log(`indexCollection: No more documents to index`);
				completed = true;
				return;
			}
			const response = await this.bulkIndexDocuments(config.index_name, documents);
			await this.extractService.bulkUpdate(
				config.collection,
				documents.map((doc) => ({
					filter: { _id: new ObjectId((doc._id || doc.id) as string) },
					update: {
						lastIndexedAt: new Date(),
						lastIndexedResponse: response.items.find(
							(item) => item.index._id === (doc._id || doc.id).toString(),
						)?.index?.result,
					},
				})),
			);
			done += documents.length;
			const timeElapsed = new Date().getTime() - startTime.getTime();
			const eta = (totalDocuments - done) * (timeElapsed / done);
			bar.update(done, { humanized_eta: humanizeDuration(eta, { round: true }) });
		}
		bar.stop();
	}

	async acknowledgeChangeEvent(collectionName: string, index: string, oldToken: any, newToken: any) {
		await this.bulkIndexDocuments('resume_tokens', [
			{
				_id: oldToken ? oldToken._id : new ObjectId(),
				token: newToken._id._data,
				collection: collectionName,
				index,
				created: new Date(),
			},
		]);
	}

	async handleChangeStream(collectionName: string, index: string) {
		const resumeToken = await this.getResumeToken(collectionName, index);
		const changeStream = await this.extractService.getChangeStream(collectionName, resumeToken?._source?.['token']);
		for await (const change of changeStream) {
			const updatedFields = Object.keys(change.updateDescription.updatedFields);
			if (hasOnlyIndexingFields(updatedFields)) {
				await this.acknowledgeChangeEvent(collectionName, index, resumeToken, change);
				continue;
			}

			console.log(`handleChangeStream: ${change.operationType} ${change.documentKey._id}`);
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
			await this.acknowledgeChangeEvent(collectionName, index, resumeToken, change);
		}
	}
}
