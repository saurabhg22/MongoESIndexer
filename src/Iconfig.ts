import { Filter } from 'mongoqueryresolver'

export interface IIndexSettings {
    settings: Object,
    mappings: {
        doc: {
            properties: Object
        }
    }
}

export default interface IConfig {
    indexName:string,
    model: string,
    batchSize?: number,
    batchInterval?: number,
    indexOnStart?: boolean,
    forceDeleteOnStart?: boolean,
    dbQuery: Filter,
    indexSettings: IIndexSettings
}