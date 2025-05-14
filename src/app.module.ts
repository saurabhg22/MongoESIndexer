import { Module } from '@nestjs/common';
import { AppService } from './app.service';
import { IndexerModule } from './indexer/indexer.module';

@Module({
	imports: [IndexerModule],
	providers: [AppService],
})
export class AppModule {}
