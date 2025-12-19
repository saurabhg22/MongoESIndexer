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
				const nodes = process.env.ELASTICSEARCH_NODE?.split(',') || ['http://localhost:9200'];
				const isHttps = nodes.some((node) => node.startsWith('https://'));

				const clientConfig: any = {
					nodes,
				};

				// Add basic auth if provided (works for both HTTP and HTTPS)
				if (process.env.ELASTICSEARCH_USERNAME && process.env.ELASTICSEARCH_PASSWORD) {
					clientConfig.auth = {
						username: process.env.ELASTICSEARCH_USERNAME,
						password: process.env.ELASTICSEARCH_PASSWORD,
					};
				}

				// Only add SSL/TLS configuration for HTTPS connections
				if (isHttps) {
					// Add SSL options if needed
					if (process.env.ELASTICSEARCH_CA_CERT) {
						clientConfig.tls = {
							ca: fs.readFileSync(process.env.ELASTICSEARCH_CA_CERT, 'utf8'),
						};
					}
				}
				return new Client(clientConfig);
			},
		},
		{
			provide: 'MongoClient',
			inject: [],
			async useFactory() {
				const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://localhost:27017/ltd_new');
				await client.connect();
				console.log('MongoDB client connected successfully');
				return client;
			},
		},
	],
})
export class IndexerModule {}
