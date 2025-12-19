import { Configuration } from '@/configuration';
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Db, MongoClient, ObjectId } from 'mongodb';
import _ from 'lodash';

/**
 * Service responsible for extracting data from MongoDB collections.
 * Provides functionality for change streams, document retrieval, pagination, and updates.
 * Handles complex aggregation pipelines and nested document lookups.
 */
@Injectable()
export class ExtractService implements OnModuleDestroy {
	private db: Db;
	constructor(@Inject('MongoClient') private readonly mongoClient: MongoClient) {
		this.db = this.mongoClient.db();
	}

	/**
	 * Cleanup when the module is destroyed
	 */
	async onModuleDestroy() {
		try {
			await this.mongoClient.close();
			console.log('MongoDB client closed successfully');
		} catch (error) {
			console.error('Error closing MongoDB client:', error);
		}
	}

	/**
	 * Creates a MongoDB change stream for real-time monitoring of collection changes.
	 *
	 * Implementation:
	 * 1. Uses MongoDB's aggregation pipeline with $changeStream stage
	 * 2. Optionally resumes from a specific point using resumeToken
	 * 3. Returns a cursor that can be used to iterate over changes
	 * 4. Uses updateDescription to detect field changes (avoids BSONObjectTooLarge errors)
	 *
	 * @param collectionName - Name of the collection to monitor
	 * @param resumeToken - Optional token to resume the change stream from a specific point
	 * @returns A MongoDB change stream cursor
	 */
	async getChangeStream(collectionName: string, resumeToken: any) {
		return this.db.collection(collectionName).aggregate([
			{
				$changeStream: {
					startAfter: resumeToken ? { _data: resumeToken } : undefined,
				},
			},
		]);
	}

	/**
	 * Retrieves documents from a collection using an aggregation pipeline with pagination.
	 *
	 * Implementation:
	 * 1. Applies the provided aggregation pipeline
	 * 2. Adds pagination using $skip and $limit stages
	 * 3. Returns documents as an array
	 *
	 * @param collectionName - Name of the collection to query
	 * @param pipeline - Array of aggregation pipeline stages
	 * @param limit - Maximum number of documents to return (default: 100)
	 * @param skip - Number of documents to skip (default: 0)
	 * @returns Array of documents matching the pipeline criteria
	 */
	async getDocuments(collectionName: string, pipeline: any[], limit = 100, skip = 0) {
		const collection = this.db.collection(collectionName);
		return collection.aggregate([...pipeline, { $skip: skip }, { $limit: limit }]).toArray();
	}

	/**
	 * Retrieves documents with support for nested pagination in lookup operations.
	 * Handles complex aggregation pipelines where certain lookups need separate processing.
	 *
	 * Implementation:
	 * 1. Splits the pipeline into main and nested parts
	 * 2. Processes main pipeline with pagination
	 * 3. Processes nested lookups separately for each document
	 * 4. Combines results into final documents
	 *
	 * @param collectionName - Name of the collection to query
	 * @param pipeline - Array of aggregation pipeline stages
	 * @param separateLookups - Array of indices indicating which lookups should be processed separately
	 * @param limit - Maximum number of documents to return (default: 1)
	 * @param skip - Number of documents to skip (default: 0)
	 * @returns Array of documents with nested lookup results
	 */
	async getDocumentsWithNestedPagination(
		collectionName: string,
		pipeline: any[],
		separateLookups: number[],
		limit = 1,
		skip = 0,
	) {
		try {
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
		} catch (error) {
			console.error(
				`getDocumentsWithNestedPagination: error getting documents with nested pagination for ${collectionName}: ${error}`,
			);
			console.error(error);
			return [];
		}
	}

	/**
	 * Counts the number of documents matching the aggregation pipeline criteria.
	 * Optimizes counting by only executing necessary pipeline stages.
	 *
	 * Implementation:
	 * 1. Finds the last $match stage in the pipeline
	 * 2. Executes pipeline up to the match stage
	 * 3. Adds $count stage to get total
	 *
	 * @param collectionName - Name of the collection to count documents from
	 * @param pipeline - Array of aggregation pipeline stages
	 * @returns The total count of matching documents
	 */
	async countDocuments(collectionName: string, pipeline: any[]): Promise<number> {
		const collection = this.db.collection(collectionName);
		const matchPipelineIndex = pipeline.findIndex((p) => !!p.$match);
		const result = await collection
			.aggregate([...pipeline.slice(0, matchPipelineIndex + 1), { $count: 'total' }])
			.toArray();
		return result?.[0]?.total || 0;
	}

	/**
	 * Checks if a document exists in the collection.
	 *
	 * @param collectionName - Name of the collection to check
	 * @param id - The _id of the document (string or ObjectId)
	 * @returns True if document exists, false otherwise
	 */
	async documentExists(collectionName: string, id: string | ObjectId): Promise<boolean> {
		const collection = this.db.collection(collectionName);
		const objectId = id instanceof ObjectId ? id : new ObjectId(id);
		const doc = await collection.findOne({ _id: objectId }, { projection: { _id: 1 } });
		return !!doc;
	}

	/**
	 * Updates a single document in the specified collection.
	 *
	 * Implementation:
	 * 1. Converts string ID to ObjectId
	 * 2. Applies update using $set operator
	 *
	 * @param collectionName - Name of the collection containing the document
	 * @param id - The _id of the document to update
	 * @param update - The update operations to apply
	 */
	async updateOne(collectionName: string, id: string, update: any) {
		const collection = this.db.collection(collectionName);
		await collection.updateOne({ _id: new ObjectId(id) }, { $set: update });
	}

	/**
	 * Updates multiple documents in the specified collection that match the filter criteria.
	 *
	 * Implementation:
	 * 1. Applies filter to match documents
	 * 2. Updates matched documents using $set operator
	 *
	 * @param collectionName - Name of the collection to update documents in
	 * @param filter - The filter criteria to match documents
	 * @param update - The update operations to apply
	 */
	async updateMany(collectionName: string, filter: any, update: any) {
		const collection = this.db.collection(collectionName);
		await collection.updateMany(filter, { $set: update });
	}

	/**
	 * Performs bulk update operations on multiple documents.
	 *
	 * Implementation:
	 * 1. Converts array of updates to bulkWrite operations
	 * 2. Uses updateOne operations with $set operator
	 * 3. Executes all updates in a single bulk operation
	 *
	 * @param collectionName - Name of the collection to update documents in
	 * @param documents - Array of objects containing filter and update operations
	 */
	async bulkUpdate(collectionName: string, documents: { filter: any; update: any }[]) {
		const collection = this.db.collection(collectionName);
		await collection.bulkWrite(
			documents.map((doc) => ({
				updateOne: { filter: doc.filter, update: { $set: doc.update } },
			})),
		);
	}

	/**
	 * Creates an expression for skipping documents based on lastESIndexedAt timestamp.
	 *
	 * Implementation:
	 * 1. Uses $dateSubtract to calculate skip threshold
	 * 2. Considers force_delete and skip_after_seconds settings
	 *
	 * @param config - Configuration object containing skip settings
	 * @returns Array containing the skip after expression
	 * @private
	 */
	private createSkipAfterExpression(config: Configuration): any[] {
		return [
			'$lastESIndexedAt',
			{
				$dateSubtract: {
					startDate: '$$NOW',
					unit: 'second',
					amount: (!config.force_delete && config.skip_after_seconds) || 60 * 60 * 24 * 365 * 10, // 10 years
				},
			},
		];
	}

	/**
	 * Creates a match stage for skipping documents based on the skip after expression.
	 *
	 * Implementation:
	 * 1. Creates $match stage with $expr
	 * 2. Uses provided operator for comparison
	 *
	 * @param skipAfter - Array containing the skip after expression
	 * @param operator - The comparison operator to use ('$lt' or '$gte')
	 * @returns Match stage object for the aggregation pipeline
	 * @private
	 */
	private createSkipMatchStage(skipAfter: any[], operator: '$lt' | '$gte'): any {
		return {
			$match: {
				$expr: {
					[operator]: skipAfter,
				},
			},
		};
	}

	/**
	 * Processes and identifies separate lookups in the aggregation pipeline.
	 *
	 * Implementation:
	 * 1. Identifies lookups marked for separate processing
	 * 2. Removes fetchSeparate flag from lookups
	 * 3. Returns indices and modified pipeline
	 *
	 * @param config - Configuration object containing the aggregation pipeline
	 * @returns Object containing separate lookup indices and modified pipeline
	 */
	processSeparateLookups(pipeline: any[]): { separateLookups: number[]; pipeline: any[] } {
		const separateLookups: number[] = [];

		const newPipeline = _.cloneDeep(pipeline);
		for (const [index, pipelineStage] of newPipeline.entries()) {
			if (pipelineStage.$lookup?.fetchSeparate) {
				separateLookups.push(index);
				delete pipelineStage.$lookup.fetchSeparate;
			}
		}

		return { separateLookups, pipeline: newPipeline };
	}

	/**
	 * Creates a pipeline with skip functionality based on configuration.
	 *
	 * Implementation:
	 * 1. Creates skip after expression
	 * 2. Adds skip match stage to pipeline
	 * 3. Appends original pipeline stages
	 *
	 * @param config - Configuration object containing the aggregation pipeline
	 * @returns Modified aggregation pipeline with skip functionality
	 */
	getSkippedPipeline(config: Configuration) {
		const skipAfter = this.createSkipAfterExpression(config);
		return [this.createSkipMatchStage(skipAfter, '$lt'), ..._.cloneDeep(config.aggregation_pipeline)];
	}

	/**
	 * Counts the number of documents that should be skipped based on configuration.
	 *
	 * Implementation:
	 * 1. Creates skip after expression
	 * 2. Creates pipeline with skip match stage
	 * 3. Counts matching documents
	 *
	 * @param config - Configuration object containing skip settings
	 * @returns Number of documents that should be skipped
	 */
	async getIndexSkipCount(config: Configuration): Promise<number> {
		const skipAfter = this.createSkipAfterExpression(config);
		const pipeline = [this.createSkipMatchStage(skipAfter, '$gte'), ...config.aggregation_pipeline];
		return await this.countDocuments(config.collection, pipeline);
	}

	/**
	 * Counts the total number of documents that should be indexed based on configuration.
	 *
	 * Implementation:
	 * 1. Gets skipped pipeline
	 * 2. Counts documents matching pipeline criteria
	 *
	 * @param config - Configuration object containing pipeline settings
	 * @returns Total number of documents to be indexed
	 */
	async getIndexCounts(config: Configuration) {
		const pipeline = this.getSkippedPipeline(config);
		return this.countDocuments(config.collection, pipeline);
	}
}
