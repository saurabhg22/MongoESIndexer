import { Configuration } from '@/configuration';
import { Inject, Injectable } from '@nestjs/common';
import { Db, MongoClient, ObjectId } from 'mongodb';

@Injectable()
export class ExtractService {
	private db: Db;
	constructor(@Inject('MongoClient') private readonly mongoClient: MongoClient) {
		this.db = this.mongoClient.db();
	}

	async getChangeStream(collectionName: string, resumeToken: any) {
		return this.db.collection(collectionName).aggregate([
			{
				$changeStream: {
					startAfter: resumeToken ? { _data: resumeToken } : undefined,
				},
			},
		]);
	}

	async getDocuments(collectionName: string, pipeline: any[], limit = 100, skip = 0) {
		const collection = this.db.collection(collectionName);
		return collection.aggregate([...pipeline, { $skip: skip }, { $limit: limit }]).toArray();
	}

	async getDocumentsWithNestedPagination(
		collectionName: string,
		pipeline: any[],
		separateLookups: number[],
		limit = 1,
		skip = 0,
	) {
		const collection = this.db.collection(collectionName);
		const strippedPipeline = [];
		const nestedPipeline = [];
		for (const [index, pipelineStage] of pipeline.entries()) {
			const nestedPaginationIndex = separateLookups.findIndex((p) => p === index);
			if (nestedPaginationIndex === -1) {
				strippedPipeline.push(pipelineStage);
			} else {
				nestedPipeline.push(pipelineStage);
			}
		}
		const documents = await collection
			.aggregate([...strippedPipeline, { $skip: skip }, { $limit: limit }])
			.toArray();
		for (const { $lookup } of nestedPipeline) {
			for (const document of documents) {
				const nestedDocuments = await this.db
					.collection($lookup.from)
					.aggregate([
						{ $match: { [$lookup.foreignField]: document[$lookup.localField] } },
						...($lookup.pipeline || []),
					])
					.toArray();
				document[$lookup.as] = nestedDocuments;
			}
		}
		return documents;
	}

	async countDocuments(collectionName: string, pipeline: any[]): Promise<number> {
		const collection = this.db.collection(collectionName);
		const matchPipelineIndex = pipeline.findIndex((p) => !!p.$match);
		const result = await collection
			.aggregate([...pipeline.slice(0, matchPipelineIndex + 1), { $count: 'total' }])
			.toArray();
		return result?.[0]?.total || 0;
	}

	async updateOne(collectionName: string, id: string, update: any) {
		const collection = this.db.collection(collectionName);
		await collection.updateOne({ _id: new ObjectId(id) }, { $set: update });
	}

	async updateMany(collectionName: string, filter: any, update: any) {
		const collection = this.db.collection(collectionName);
		await collection.updateMany(filter, { $set: update });
	}

	async bulkUpdate(collectionName: string, documents: { filter: any; update: any }[]) {
		const collection = this.db.collection(collectionName);
		await collection.bulkWrite(
			documents.map((doc) => ({
				updateOne: { filter: doc.filter, update: { $set: doc.update } },
			})),
		);
	}

	private createSkipAfterExpression(config: Configuration): any[] {
		return [
			'$lastIndexedAt',
			{
				$dateSubtract: {
					startDate: '$$NOW',
					unit: 'second',
					amount: (!config.force_delete && config.skip_after_seconds) || 0,
				},
			},
		];
	}

	private createSkipMatchStage(skipAfter: any[], operator: '$lt' | '$gte'): any {
		return {
			$match: {
				$expr: {
					[operator]: skipAfter,
				},
			},
		};
	}

	processSeparateLookups(config: Configuration): { separateLookups: number[]; pipeline: any[] } {
		const separateLookups: number[] = [];
		const modifiedPipeline = this.getSkippedPipeline(config);

		for (const [index, pipelineStage] of modifiedPipeline.entries()) {
			if (pipelineStage.$lookup?.fetchSeparate) {
				separateLookups.push(index);
				delete pipelineStage.$lookup.fetchSeparate;
			}
		}

		return { separateLookups, pipeline: modifiedPipeline };
	}

	getSkippedPipeline(config: Configuration) {
		const skipAfter = this.createSkipAfterExpression(config);
		return [this.createSkipMatchStage(skipAfter, '$lt'), ...config.aggregation_pipeline];
	}

	async getIndexSkipCount(config: Configuration): Promise<number> {
		const skipAfter = this.createSkipAfterExpression(config);
		const pipeline = [this.createSkipMatchStage(skipAfter, '$gte'), ...config.aggregation_pipeline];
		return await this.countDocuments(config.collection, pipeline);
	}

	async getIndexCounts(config: Configuration) {
		const pipeline = this.getSkippedPipeline(config);
		return this.countDocuments(config.collection, pipeline);
	}
}
