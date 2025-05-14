import { Inject, Injectable } from "@nestjs/common";
import { Client } from '@elastic/elasticsearch';

@Injectable()
export class IndexerService {


    constructor(
		@Inject('ESClient') private readonly esClient: Client
    ) {
        this.listAllIndices().then((response) => {
            console.log(response);
        }).catch((error) => {
            console.error(error);
        });
    }

    async listAllIndices() {
        const response = await this.esClient.cat.indices({ format: 'json' });
        return response;
    }
}
