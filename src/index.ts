import * as MongoQueryResolver from 'mongoqueryresolver';
import { promises as fs } from 'fs';
import * as path from 'path';
import { Db, ObjectID } from 'mongodb';
import { Client } from '@elastic/elasticsearch';
import IConfig from './Iconfig';
import { promisify } from 'util';

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_BATCH_INTERVAL = 0;
const delay = promisify(setTimeout);

export default class MongoESIndexer {
    configDir: string;
    esHosts: Array<string>;
    mongoUri: string;
    indexPrefix: string = "";
    configs: Array<IConfig> = [];
    db: Db;
    client: Client;


    constructor(configDir: string, esHosts: string | Array<string>, mongoUri: string, indexPrefix?: string) {
        this.configDir = path.resolve(configDir);
        this.esHosts = typeof esHosts === 'string' ? esHosts.split(',') : esHosts;
        this.mongoUri = mongoUri;
        this.indexPrefix = indexPrefix;
        this.client = new Client({ nodes: esHosts });
    }

    private getConfigByIndexName(indexName: string): IConfig {
        const config = this.configs.find(config => config.indexName === indexName);
        if (!config) throw new Error(`No config found for ${indexName}`);
        return config;
    }

    async init() {
        this.db = await MongoQueryResolver.init(this.mongoUri);
        const configFilePaths = await fs.readdir(this.configDir);
        for (let configFilePath of configFilePaths) {
            const config: IConfig = require(path.join(this.configDir, configFilePath));
            config.indexName = config.indexName || (this.indexPrefix + config.model).toLowerCase();
            config.batchSize = Math.min(config.batchSize || DEFAULT_BATCH_SIZE, 1000);
            config.batchInterval = config.batchInterval || DEFAULT_BATCH_INTERVAL;
            this.configs.push(config);

            if (config.forceDeleteOnStart) {
                await this.deleteIndex(config.indexName);
            }
            await this.upsertIndex(config.indexName);

            if (config.indexSettings && config.indexSettings.settings && Object.keys(config.indexSettings.settings).length) {
                console.log("Object.keys(config.indexSettings.settings)", Object.keys(config.indexSettings.settings))
                await this.updateSettings(config.indexName, config.indexSettings);
            }
            if (config.indexSettings && config.indexSettings.mappings && Object.keys(config.indexSettings.mappings).length) {
                await this.updateMappings(config.indexName, config.indexSettings.mappings);
            }
            if (config.indexOnStart) {
                await this.indexAll(config);
            }
        }
    }


    async indexOne(model: string, _id: string) {

    }


    async doesIndexExists(indexName: string): Promise<boolean> {
        let existsResp = await this.client.indices.exists({ index: indexName });
        return existsResp && (existsResp.statusCode === 200 || existsResp.statusCode === 202);
    }


    async deleteIndex(indexName: string) {
        if (await this.doesIndexExists(indexName)) {
            console.info(`Deleting index: ${indexName}`);
            return this.client.indices.delete({
                index: indexName
            });
        }
    }


    async updateSettings(indexName: string | Array<string>, settings: Object) {
        return this.client.indices.putSettings({
            index: indexName,
            body: settings
        })
    }


    async upsertIndex(indexName: string) {
        if (await this.doesIndexExists(indexName)) return;
        console.info("Creating index:", indexName);
        return this.client.indices.create({ index: indexName });
    }


    async updateMappings(indexName: string | Array<string>, mappings: Object) {
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
        const bulkOperations: ({ [key: string]: any; _id: ObjectID; } | { index: { _index: string; _type: string; _id: string; }; })[] = [];
        docs.forEach(doc => {
            bulkOperations.push(...[
                {
                    index: {
                        _index: indexName,
                        _type: "doc",
                        _id: doc._id || doc.id
                    }
                },
                {
                    ...doc,
                    _id: undefined,
                    id: doc._id || doc.id
                }
            ]);
        });
        await this.client.bulk({
            index: indexName,
            type: "_doc",
            body: bulkOperations
        })

    }

    async indexAll(config: IConfig) {
        const total = await this.db.collection(config.model).countDocuments(config.dbQuery.where);
        console.info(`Starting index for ${total} ${config.model}`);
        let done = 0;
        const dbQuery = { ...config.dbQuery };
        while (done < total) {
            dbQuery.skip = done;
            await this.bulkIndex(config.indexName, { limit: config.batchSize, skip: done });
            done += config.batchSize;
            console.info(`${done}/${total} ${config.model} were indexed in ${config.indexName} index`);
            await delay(config.batchInterval);
        }
    }

}



// new MongoESIndexer("./test/testconfigs", "loclahost:9200,localhost:9300", "mongodb://localhost:27017/testdb", "testdb").init()