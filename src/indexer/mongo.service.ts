import { Inject, Injectable } from '@nestjs/common';
import { MongoClient, ObjectId } from 'mongodb';

@Injectable()
export class MongoService {
	constructor(@Inject('MongoClient') private readonly mongoClient: MongoClient) {}

	async getChangeStream(collectionName: string, resumeToken: any) {
		return this.mongoClient
			.db()
			.collection(collectionName)
			.aggregate([
				{
					$changeStream: {
						startAfter: resumeToken ? { _data: resumeToken } : undefined,
					},
				},
			]);
	}

	async getDocuments(collectionName: string, pipeline: any[], limit = 100, skip = 0) {
		const collection = this.mongoClient.db().collection(collectionName);
		return collection.aggregate([...pipeline, { $skip: skip }, { $limit: limit }]).toArray();
	}

	async countDocuments(collectionName: string, pipeline: any[]) {
		const collection = this.mongoClient.db().collection(collectionName);
		const matchPipelineIndex = pipeline.findIndex((p) => !!p.$match);
		const result = await collection
			.aggregate([...pipeline.slice(0, matchPipelineIndex + 1), { $count: 'total' }])
			.toArray();
		return result?.[0]?.total || 0;
	}

	async updateOne(collectionName: string, id: string, update: any) {
		const collection = this.mongoClient.db().collection(collectionName);
		await collection.updateOne({ _id: new ObjectId(id) }, { $set: update });
	}

	async updateMany(collectionName: string, filter: any, update: any) {
		const collection = this.mongoClient.db().collection(collectionName);
		await collection.updateMany(filter, { $set: update });
	}
}
