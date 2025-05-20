import { Injectable } from '@nestjs/common';
import { ObjectId } from 'mongodb';

@Injectable()
export class TransformService {
	async getBulkIndexBody(index: string, documents: any[]) {
		const fixIds = (doc: any) => {
			if (!doc) return doc;
			if (typeof doc !== 'object') return doc;
			if (Array.isArray(doc)) {
				doc.forEach(fixIds);
				return doc;
			}
			if (doc instanceof ObjectId) {
				return doc.toString();
			}
			if (doc._id) {
				doc.id = doc._id;
				delete doc._id;
			}
			for (const key in doc) {
				doc[key] = fixIds(doc[key]);
			}
			return doc;
		};
		documents.forEach(fixIds);
		return documents.flatMap((document) => [
			{
				index: {
					_index: index,
					_id: document._id || document.id,
				},
			},
			document,
		]);
	}
}
