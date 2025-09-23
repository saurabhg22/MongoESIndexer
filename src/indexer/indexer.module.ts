import { Module } from '@nestjs/common';
import { LoadService } from './load.service';
import { Client } from '@elastic/elasticsearch';
import { MongoClient } from 'mongodb';
import { ExtractService } from './extract.service';
import { TransformService } from './transform.service';
import * as fs from 'fs';

@Module({
	imports: [],
	providers: [
		ExtractService,
		TransformService,
		LoadService,
		{
			provide: 'ESClient',
			inject: [],
			useFactory() {
				return new Client({
					caFingerprint: process.env.ELASTICSEARCH_CA_FINGERPRINT
						? fs.readFileSync(process.env.ELASTICSEARCH_CA_FINGERPRINT, 'utf8')
						: undefined,
					nodes: process.env.ELASTICSEARCH_NODE?.split(',') || ['http://localhost:9200'],
				});
			},
		},
		{
			provide: 'MongoClient',
			inject: [],
			useFactory() {
				return new MongoClient(process.env.MONGODB_URI || 'mongodb://localhost:27017/ltd_new');
			},
		},
	],
})
export class IndexerModule {}
