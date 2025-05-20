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
import humanizeDuration from 'humanize-duration';

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
				await this.mongoService.updateMany(
					config.collection,
					{},
					{ lastIndexedAt: null, lastIndexedResponse: null },
				);
			}

			await this.upsertIndex({ ...config.index_params, index: config.index_name } as IndicesCreateRequest);
			if (config.index_on_start) {
				await this.indexCollection(config);
			}
			this.handleChangeStream(config.collection, config.index_name);
		}
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
			console.log(`upsertIndex: index ${params.index} exists: ${exists}`);
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

	async getBulkIndexBody(index: string, documents: any[], doc_type?: string) {
		const fixIds = (doc: any) => {
			if (!doc) return doc;
			if (typeof doc !== 'object') return doc;
			if (Array.isArray(doc)) {
				doc.forEach(fixIds);
				return doc;
			}
			if (doc instanceof ObjectId) {
				return doc.toString();
			}
			if (doc._id) {
				doc.id = doc._id;
				delete doc._id;
			}
			for (const key in doc) {
				doc[key] = fixIds(doc[key]);
			}
			return doc;
		};
		documents.forEach(fixIds);
		return documents.flatMap((document) => [
			{
				index: {
					_index: index,
					_id: document._id || document.id,
				},
			},
			{ ...document, doc_type },
		]);
	}

	async bulkIndexDocuments(index: string, documents: any[], doc_type?: string) {
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
			const response = await this.bulkIndexDocuments(config.index_name, [document], config.doc_type);
			await this.mongoService.updateOne(collection, id, {
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

	async indexCollection(config: Configuration) {
		console.log(`indexCollection: index ${config.index_name}`);

		config.aggregation_pipeline.unshift({
			$match: {
				$expr: {
					$lt: [
						'$lastIndexedAt',
						{
							$dateSubtract: {
								startDate: '$$NOW',
								unit: 'second',
								amount: (!config.force_delete && config.skip_after_seconds) || 0,
							},
						},
					],
				},
			},
		});

		const separateLookups = [];

		for (const [index, pipelineStage] of config.aggregation_pipeline.entries()) {
			if (pipelineStage.$lookup?.fetchSeparate) {
				separateLookups.push(index);
				delete pipelineStage.$lookup.fetchSeparate;
			}
		}

		const totalDocuments = await this.mongoService.countDocuments(config.collection, config.aggregation_pipeline);
		let documents = [];
		const limiter = new Bottleneck({
			maxConcurrent: 1,
			// minTime: 50,
		});

		const bar = new cliProgress.SingleBar(
			{ format: `${config.index_name} [{bar}] {percentage}% | ETA: {humanized_eta} | {value}/{total}` },
			cliProgress.Presets.shades_classic,
		);
		bar.start(totalDocuments, 0, { humanized_eta: 0 });
		let batchSize = config.batch_size;
		const startTime = new Date();

		for (let done = 0, completed = false; done < totalDocuments && !completed; ) {
			await limiter.schedule(async () => {
				try {
					documents =
						batchSize <= 5
							? await this.mongoService.getDocumentsWithNestedPagination(
									config.collection,
									config.aggregation_pipeline,
									separateLookups,
								)
							: await this.mongoService.getDocuments(
									config.collection,
									config.aggregation_pipeline,
									batchSize,
								);
				} catch (error: any) {
					if (error.codeName === 'BSONObjectTooLarge') {
						batchSize = Math.floor(batchSize / 2);
						console.log(`\nindexCollection: BSONObjectTooLarge, shrinking batch size to ${batchSize}`);

						if (batchSize < 1) {
							console.log(
								`indexCollection: BSONObjectTooLarge, batch size is too small, skipping documents`,
							);
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
				await this.bulkIndexDocuments(config.index_name, documents, config.doc_type);
				await this.mongoService.updateMany(
					config.collection,
					{ _id: { $in: documents.map((doc) => new ObjectId((doc._id || doc.id) as string)) } },
					{
						lastIndexedAt: new Date(),
						lastIndexedResponse: 'success',
					},
				);
				done += documents.length;
				const timeElapsed = new Date().getTime() - startTime.getTime();
				const eta = (totalDocuments - done) * (timeElapsed / done);
				bar.update(done, { humanized_eta: humanizeDuration(eta, { round: true }) });
			});
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
		console.log(`handleChangeStream: ${collectionName}`);
		const resumeToken = await this.getResumeToken(collectionName, index);
		const changeStream = await this.mongoService.getChangeStream(collectionName, resumeToken?._source?.['token']);
		for await (const change of changeStream) {
			const updatedFields = Object.keys(change.updateDescription.updatedFields);
			const isElasticSearchUpdate =
				updatedFields.length === 2 &&
				updatedFields.includes('lastIndexedAt') &&
				updatedFields.includes('lastIndexedResponse');

			if (isElasticSearchUpdate) {
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
