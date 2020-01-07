const { Client } = require('@elastic/elasticsearch');
const fs = require('fs').promises;
const path = require('path');
import ConfigI from './configI';



export default class MongoESIndexer {
    configDir: string;
    esHosts: string | Array<string>;
    mongoUri: string;
    indexPrefix: string;
    configs: Array<ConfigI>=[];

    constructor(configDir: string, esHosts: string | Array<string>, mongoUri: string, indexPrefix: string) {
        this.configDir = path.resolve(configDir);
        this.esHosts = esHosts;
        this.mongoUri = mongoUri;
        this.indexPrefix = indexPrefix;
    }

    async init() {
        const configFilePaths = await fs.readdir(this.configDir);
        for(let configFilePath of configFilePaths){
            const config = require(path.join(this.configDir, configFilePath));
            this.configs.push(config);
        }
        console.log(this.configs);
    }

}



