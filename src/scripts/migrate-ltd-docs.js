const { MongoClient } = require('mongodb');

async function migrateLtdDocuments() {
	const sourceUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
	const sourceClient = new MongoClient(sourceUri);
	const targetClient = new MongoClient(sourceUri);
	const BATCH_SIZE = 100;

	const result = {
		totalProcessed: 0,
		inserted: 0,
		skipped: 0,
		errors: 0,
		startTime: new Date()
	};

	try {
		console.log('Starting migration process...');
		console.log('Connecting to databases...');
		
		await sourceClient.connect();
		await targetClient.connect();
		console.log('Successfully connected to databases');

		const sourceDb = sourceClient.db('ltd_new_old');
		const targetDb = targetClient.db('ltd_new');
		const sourceCollection = sourceDb.collection('LtdDoc');
		const targetCollection = targetDb.collection('LtdDoc');

		// Get total count for progress calculation
		const totalDocuments = await sourceCollection.countDocuments();
		console.log(`Total documents to process: ${totalDocuments}`);
		console.log('Index created successfully');

		let lastId = null;
		let hasMore = true;
		let batchNumber = 0;

		while (hasMore) {
			batchNumber++;
			const batchStartTime = new Date();
			
			// Build query for pagination
			const query = lastId ? { _id: { $gt: lastId } } : {};
			
			// Get batch of documents
			const batch = await sourceCollection
				.find(query)
				.sort({ _id: 1 })
				.limit(BATCH_SIZE)
				.toArray();

			if (batch.length === 0) {
				hasMore = false;
				continue;
			}

			// Get existing documents in batch
			const existingDocs = await targetCollection.find({
				_id: { $in: batch.map(doc => doc._id) }
			}).toArray();

			// Filter out documents that already exist
			const newDocs = batch.filter(doc => !existingDocs.some(
				existingDoc => existingDoc._id.toString() === doc._id.toString()
			));

			// Update counters
			result.totalProcessed += batch.length;
			result.skipped += (batch.length - newDocs.length);

			// Insert new documents if any
			if (newDocs.length > 0) {
				try {
					await targetCollection.insertMany(newDocs);
					result.inserted += newDocs.length;
				} catch (error) {
					console.error('Error inserting batch:', error);
					result.errors += newDocs.length;
				}
			}

			// Update lastId for next iteration
			lastId = batch[batch.length - 1]._id;

			// Calculate progress and timing
			const batchEndTime = new Date();
			const batchDuration = (batchEndTime - batchStartTime) / 1000;
			const progress = ((result.totalProcessed / totalDocuments) * 100).toFixed(2);
			const elapsedTime = (new Date() - result.startTime) / 1000;
			const avgTimePerDoc = (elapsedTime / result.totalProcessed).toFixed(2);
			const estimatedRemaining = ((totalDocuments - result.totalProcessed) * avgTimePerDoc).toFixed(0);

			// Log detailed progress
			console.log(`
Batch #${batchNumber} completed:
- Documents processed: ${result.totalProcessed}/${totalDocuments} (${progress}%)
- Batch size: ${batch.length}
- New documents: ${newDocs.length}
- Skipped documents: ${batch.length - newDocs.length}
- Batch duration: ${batchDuration}s
- Average time per document: ${avgTimePerDoc}s
- Total elapsed time: ${elapsedTime.toFixed(0)}s
- Estimated time remaining: ${estimatedRemaining}s
- Current status: ${result.inserted} inserted, ${result.skipped} skipped, ${result.errors} errors
----------------------------------------`);
		}

		const totalDuration = (new Date() - result.startTime) / 1000;
		console.log(`
Migration completed!
Final results:
- Total documents processed: ${result.totalProcessed}
- Documents inserted: ${result.inserted}
- Documents skipped: ${result.skipped}
- Errors encountered: ${result.errors}
- Total duration: ${totalDuration.toFixed(0)}s
- Average processing speed: ${(result.totalProcessed / totalDuration).toFixed(2)} docs/sec
----------------------------------------`);

		return result;
	} catch (error) {
		console.error('Migration failed:', error);
		throw error;
	} finally {
		await sourceClient.close();
		await targetClient.close();
		console.log('Database connections closed');
	}
}

// Execute the migration
migrateLtdDocuments()
	.then(() => {
		console.log('Migration script completed successfully');
		process.exit(0);
	})
	.catch((error) => {
		console.error('Migration script failed:', error);
		process.exit(1);
	}); 