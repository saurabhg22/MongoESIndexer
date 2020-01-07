import { Filter } from 'mongoqueryresolver'

export default interface ConfigI {
    model: string,
    batchSize?: number,
    batchInterval?: number,
    indexOnStart?: boolean,
    forceDeleteOnStart?: boolean,
    dbQuery: Filter,
    indexSettings: {
        settings: Object,
        mappings: {
            doc: {
                properties: Object
            }
        }
    }
}