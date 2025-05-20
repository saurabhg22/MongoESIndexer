import { Module } from '@nestjs/common';
import { LoadService } from './load.service';
import { Client } from '@elastic/elasticsearch';
import { MongoClient } from 'mongodb';
import { ExtractService } from './extract.service';
import { TransformService } from './transform.service';

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
					nodes: process.env.ES_HOST?.split(',') || ['http://localhost:9200'],
					auth: {
						username: process.env.ES_USERNAME || 'elastic',
						password: process.env.ES_PASSWORD || 'elastic_password',
					},
				});
			},
		},
		{
			provide: 'MongoClient',
			inject: [],
			useFactory() {
				return new MongoClient(process.env.MONGO_URI || 'mongodb://localhost:27017/ltd_new');
			},
		},
	],
})
export class IndexerModule {}
