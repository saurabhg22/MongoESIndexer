import * as MongoQueryResolver from 'mongoqueryresolver';
import { promises as fs } from 'fs';
import * as path from 'path';
import { Db, ObjectId } from 'mongodb';
import { Client } from '@elastic/elasticsearch';
import IConfig from './Iconfig';
import { promisify } from 'util';
import * as merge from 'deepmerge';
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_BATCH_INTERVAL = 0;
const delay = promisify(setTimeout);

export default class MongoESIndexer {
    configDir: string;
    esHosts: Array<string>;
    mongoUri: string;
    indexPrefix: string = "";
    defaultConfig: Partial<IConfig>;
    defaultConfigPath?: string;
    configs: Array<IConfig> = [];
    db: Db;
    client: Client;


    constructor(configDir: string, esHosts: string | Array<string>, mongoUri: string, indexPrefix?: string, defaultConfigPath?: string) {
        this.configDir = path.resolve(configDir);
        this.esHosts = typeof esHosts === 'string' ? esHosts.split(',') : esHosts;
        this.mongoUri = mongoUri;
        this.indexPrefix = indexPrefix;
        if (defaultConfigPath) {
            this.defaultConfigPath = path.resolve(defaultConfigPath);
        }
        this.client = new Client({ nodes: this.esHosts });
    }

    private getConfigByIndexName(indexName: string): IConfig {
        const config = this.configs.find(config => config.indexName === indexName);
        if (!config) throw new Error(`No config found for ${indexName}`);
        return config;
    }

    async init() {
        this.db = await MongoQueryResolver.init(this.mongoUri);
        const configFilePaths = await fs.readdir(this.configDir);
        if (this.defaultConfigPath) {
            this.defaultConfig = require(this.defaultConfigPath);
        }
        for (let configFilePath of configFilePaths) {
            let config: IConfig = require(path.join(this.configDir, configFilePath));
            config = merge(this.defaultConfig, config);
            config.indexName = config.indexName || (this.indexPrefix + config.model).toLowerCase();
            config.batchSize = Math.min(config.batchSize || DEFAULT_BATCH_SIZE, 1000);
            config.batchInterval = config.batchInterval || DEFAULT_BATCH_INTERVAL;
            config.dbQuery.collection = config.dbQuery.collection || config.model;

            this.configs.push(config);

            if (config.forceDeleteOnStart) {
                await this.deleteIndex(config.indexName);
            }
            await this.upsertIndex(config.indexName);

            if (config.indexOnStart) {
                await this.indexAll(config.indexName);
            }
        }
    }


    async deleteOne(indexName: string, _id: string | ObjectId) {
        _id = typeof _id === 'string' ? new ObjectId(_id) : _id;
        try {
            await this.client.delete({
                index: indexName,
                id: _id.toString(),
                type: 'doc'
            });
        } catch (error) {
            return error;
        }
    }

    async deleteByIds(indexName: string, ids: Array<string | ObjectId>) {
        return this.deleteByQuery(indexName, {
            query: {
                bool: {
                    should: ids.map(id => ({
                        term: { id: id.toString() }
                    })),
                    minimum_should_match: 1
                }
            }
        });
    }

    async deleteByQuery(indexName: string, query: { [key: string]: any }) {
        try {
            await this.client.deleteByQuery({
                index: indexName,
                type: 'doc',
                body: query
            });
        } catch (error) {
            return error;
        }
    }

    async indexOne(indexName: string, _id: string | ObjectId, doc?: { [key: string]: any }) {
        const config = this.getConfigByIndexName(indexName);
        _id = typeof _id === 'string' ? new ObjectId(_id) : _id;
        if (!doc) {
            [doc] = await MongoQueryResolver.filter({
                ...config.dbQuery,
                limit: 1,
                skip: 0,
                where: {
                    _id
                }
            });
        }

        if (!doc) return;

        try {
            await this.client.index({
                index: indexName,
                type: 'doc',
                body: doc
            });
        } catch (error) {
            await this.db.collection(config.model).updateOne({ _id }, {
                $set: {
                    _elasticSearchErrorDate: new Date(),
                    _elasticSearchError: error
                }
            });
        }
    }

    async updateOne(indexName: string, _id: string | ObjectId, doc?: { [key: string]: any }) {
        const config = this.getConfigByIndexName(indexName);
        _id = typeof _id === 'string' ? new ObjectId(_id) : _id;
        if (!doc) {
            [doc] = await MongoQueryResolver.filter({
                ...config.dbQuery,
                limit: 1,
                skip: 0,
                where: {
                    _id
                }
            });
        }
        if (!doc) return;

        try {
            await this.client.update({
                id: _id.toString(),
                index: indexName,
                type: 'doc',
                body: {
                    doc: {
                        ...doc,
                        _id: undefined
                    }
                }
            });
        } catch (error) {
            await this.db.collection(config.model).updateOne({ _id }, {
                $set: {
                    _elasticSearchErrorDate: new Date(),
                    _elasticSearchError: error
                }
            });
        }


        await this.db.collection(config.model).updateOne({ _id }, {
            $set: {
                _elasticsearchLastIndex: new Date(),
                _elasticSearchError: false
            }
        });
    }

    async doesIndexExists(indexName: string): Promise<boolean> {
        let existsResp = await this.client.indices.exists({ index: indexName });
        return existsResp && (existsResp.statusCode === 200 || existsResp.statusCode === 202);
    }

    async deleteIndex(indexName: string) {
        const config = this.getConfigByIndexName(indexName);
        await this.db.collection(config.model).updateMany(config.dbQuery.where || {}, { $unset: { _elasticsearchLastIndex: 1 } });

        if (await this.doesIndexExists(indexName)) {
            console.info(`Deleting index: ${indexName}`);
            return this.client.indices.delete({
                index: indexName
            });
        }
    }

    async updateIndexSettings(indexName: string | Array<string>, settings: Object) {
        await this.client.indices.close({
            index: indexName
        });
        await this.client.indices.putSettings({
            index: indexName,
            body: settings
        });
        await this.client.indices.open({
            index: indexName
        });
    }

    async upsertIndex(indexName: string) {
        const config = this.getConfigByIndexName(indexName);
        if (await this.doesIndexExists(indexName)) {
            if (config.indexSettings && config.indexSettings.settings && Object.keys(config.indexSettings.settings).length) {
                await this.updateIndexSettings(indexName, config.indexSettings);
            }
            if (config.indexSettings && config.indexSettings.mappings && Object.keys(config.indexSettings.mappings).length) {
                await this.updateIndexMappings(indexName, config.indexSettings.mappings);
            }
        }
        console.info("Creating index:", indexName);
        return this.client.indices.create({ index: indexName, body: config.indexSettings });
    }

    async updateIndexMappings(indexName: string | Array<string>, mappings: Object) {
        console.log('Updating mappings:', indexName)
        return this.client.indices.putMapping({
            index: indexName,
            body: mappings,
            type: "doc"
        });
    }

    async bulkIndex(indexName: string, filter: Omit<MongoQueryResolver.Filter, "collection">) {
        const config = this.getConfigByIndexName(indexName);
        const dbQuery = { ...config.dbQuery, ...filter };
        const docs = await MongoQueryResolver.filter(dbQuery);
        const bulkOperations: any[] = [];

        docs.forEach(doc => {
            bulkOperations.push(...[
                {
                    index: {
                        _index: indexName,
                        _type: "doc",
                        _id: doc._id
                    }
                },
                {
                    ...doc,
                    _id: undefined,
                    id: doc._id
                }
            ]);
        });

        let bulkResp;
        try {
            bulkResp = await this.client.bulk({
                index: indexName,
                type: "_doc",
                body: bulkOperations
            });

        } catch (error) {
            const failureItemsIds = docs.map(doc => doc._id);
            await this.db.collection(config.model).updateMany({
                _id: {
                    $in: failureItemsIds
                }
            }, {
                $set: {
                    _elasticSearchErrorDate: new Date(),
                    _elasticSearchError: error
                }
            });
        } finally {
            await this.saveBulkResp(bulkResp, config);
        }
    }

    async bulkUpdate(indexName: string, filter: Omit<MongoQueryResolver.Filter, "collection">, updates?: { [key: string]: any }) {
        const config = this.getConfigByIndexName(indexName);
        const dbQuery = { ...config.dbQuery, ...filter };
        let docs = await MongoQueryResolver.filter(dbQuery);
        if (updates) {
            for (let index in docs) {
                docs[index] = {
                    ...updates,
                    _id: docs[index]._id
                }
            }
        }
        const bulkOperations: any[] = [];

        docs.forEach(doc => {
            bulkOperations.push(...[
                {
                    update: {
                        _index: indexName,
                        _type: "doc",
                        _id: doc._id,
                        retry_on_conflict: 3
                    }
                },
                {
                    doc: {
                        ...doc,
                        _id: undefined,
                        id: doc._id
                    },
                    doc_as_upsert: true
                }
            ]);
        });

        let bulkResp;
        try {
            bulkResp = await this.client.bulk({
                index: indexName,
                type: "_doc",
                body: bulkOperations
            });

        } catch (error) {
            console.log(error.meta.body.error);
            const failureItemsIds = docs.map(doc => doc._id);
            await this.db.collection(config.model).updateMany({
                _id: {
                    $in: failureItemsIds
                }
            }, {
                $set: {
                    _elasticSearchErrorDate: new Date(),
                    _elasticSearchError: error
                }
            });
        } finally {
            await this.saveBulkResp(bulkResp, config);
        }
    }

    private async saveBulkResp(bulkResp: { body: { items: any[]; }; }, config: IConfig) {
        const successItemsIds = bulkResp.body.items
            .filter((item: any) => item && item.index && item.index.status >= 200 && item.index.status < 300)
            .map((item: any) => item.index && item.index._id)
            .filter((_id: any) => _id);

        const indexErrors = bulkResp.body.items
            .filter((item: any) => item && item.index && (item.index.status < 200 || item.index.status >= 300))
            .map((item: any) => item.index)
            .filter((indexError: any) => indexError);
        console.log("indexErrors", indexErrors)

        await this.db.collection(config.model).updateMany({
            _id: {
                $in: successItemsIds.map((_id: string) => new ObjectId(_id))
            }
        }, {
            $set: {
                _elasticsearchLastIndex: new Date(),
                _elasticSearchError: false
            }
        });
        for (let indexError of indexErrors) {
            await this.db.collection(config.model).updateOne({
                _id: new ObjectId(indexError._id)
            }, {
                $set: {
                    _elasticSearchErrorDate: new Date(),
                    _elasticSearchError: indexError
                }
            });
        }
    }

    private async indexAll(indexName: string) {
        const config = this.getConfigByIndexName(indexName);
        if (!config.forceIndexOnStart && !config.forceDeleteOnStart) {
            config.dbQuery.where = {
                ...config.dbQuery.where || {},
                _elasticsearchLastIndex: { $exists: false }
            }
        }
        const total = await this.db.collection(config.model).countDocuments(config.dbQuery.where);
        console.info(`Starting index for ${total} ${config.model}`);
        let done = 0;
        const dbQuery = { ...config.dbQuery };
        while (done < total) {
            dbQuery.skip = done;
            await this.bulkIndex(config.indexName, {
                limit: config.batchSize,
                [config.forceIndexOnStart || config.forceDeleteOnStart ? 'skip' : 'where']: config.forceIndexOnStart || config.forceDeleteOnStart ? done : config.dbQuery.where
            });
            done += config.batchSize;
            console.info(`${Math.min(done, total)}/${total} ${config.model} were indexed in ${config.indexName} index`);
            await delay(config.batchInterval);
        }
    }

}



