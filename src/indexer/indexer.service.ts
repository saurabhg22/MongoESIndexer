import { Inject, Injectable } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { MongoClient } from 'mongodb';
import { IndicesCreateRequest, IndicesPutMappingRequest } from '@elastic/elasticsearch/lib/api/types';
import * as fs from 'fs/promises';
import path from 'path';

@Injectable()
export class IndexerService {
	constructor(
		@Inject('MongoClient') private readonly mongoClient: MongoClient,
		@Inject('ESClient') private readonly esClient: Client,
	) {
		this.init(path.join(__dirname, '../configs'));
	}

	async init(configDir: string) {
		const configFiles = await fs.readdir(configDir);
		for (const configFile of configFiles) {
			const config = JSON.parse(await fs.readFile(configDir + '/' + configFile, 'utf8'));
			await this.upsertIndex(config.index_params);
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
}
