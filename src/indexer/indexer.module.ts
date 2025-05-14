import { Module } from '@nestjs/common';
import { IndexerService } from './indexer.service';
import { Client } from '@elastic/elasticsearch';

@Module({
	imports: [],
	providers: [
		IndexerService,
		{
			provide: 'ESClient',
			inject: [],
			useFactory() {
				return new Client({
					nodes: ['http://es01:9200', 'http://es02:9201', 'http://es03:9202'],
					auth: {
						username: 'elastic',
						password: 'elastic_password',
					},
				});
			},
		},
	],
})
export class IndexerModule {}
