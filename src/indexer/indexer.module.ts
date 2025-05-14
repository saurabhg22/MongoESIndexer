import { Module } from '@nestjs/common';
import { IndexerService } from './indexer.service';
import { Client } from '@elastic/elasticsearch';
import { MongoClient } from 'mongodb';
import { MongoService } from './mongo.service';

@Module({
	imports: [],
	providers: [
		MongoService,
		IndexerService,
		{
			provide: 'ESClient',
			inject: [],
			useFactory() {
				return new Client({
					nodes: ['http://es01:9200', 'http://es02:9200', 'http://es03:9200'],
					auth: {
						username: 'elastic',
						password: 'elastic_password',
					},
				});
			},
		},
		{
			provide: 'MongoClient',
			inject: [],
			useFactory() {
				return new MongoClient('mongodb://host.docker.internal:27017/ltd_new');
			},
		},
	],
})
export class IndexerModule {}
