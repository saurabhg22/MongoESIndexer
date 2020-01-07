import MongoESIndexer from '../src/index';
import * as chai from 'chai';

import * as chaiAsPromised from 'chai-as-promised';

chai.use(chaiAsPromised);
chai.should();

describe('init', function () {
    it('should fail with invalid configDir', async function () {
        await new MongoESIndexer("./invalidpath", "loclahost:9200,localhost:9300", "mongodb://localhost:27017", "test").init().should.be.rejected;
    });
    it('should pass with correct configDir', async function () {
        await new MongoESIndexer("./test/testconfigs", "loclahost:9200,localhost:9300", "mongodb://localhost:27017", "test").init().should.be.fulfilled;
    });
});