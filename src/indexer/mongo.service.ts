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
		const result = await collection.aggregate([...pipeline, { $count: 'total' }]).toArray();
		return result[0].total;
	}

	async updateOne(collectionName: string, id: string, update: any) {
		const collection = this.mongoClient.db().collection(collectionName);
		await collection.updateOne({ _id: new ObjectId(id) }, { $set: update });
	}
}
