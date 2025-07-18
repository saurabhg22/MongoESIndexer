import { Module } from '@nestjs/common';
import { IndexerModule } from './indexer/indexer.module';

@Module({
	imports: [IndexerModule],
	providers: [],
})
export class AppModule {}
