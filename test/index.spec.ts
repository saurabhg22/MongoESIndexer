import MongoESIndexer from '../src/index';
import * as MongoQueryResolver from 'mongoqueryresolver';
import * as chai from 'chai';
import * as faker from 'faker';
import { Db, ObjectID } from 'mongodb';

import * as chaiAsPromised from 'chai-as-promised';

chai.use(chaiAsPromised);
chai.should();

const USERS_LENGTH = 500;

describe('init', function () {
    let db: Db;
    this.beforeAll(async () => {
        db = await MongoQueryResolver.init("mongodb://localhost:27017/testdb");
        let users = Array.from(new Array(USERS_LENGTH).keys()).map((index) => {
            let user = {
                firstName: faker.name.firstName(),
                lastName: faker.name.lastName(),
                _id: new ObjectID(),
                age: faker.random.number({ min: 5, max: 90 }),
                phone: faker.phone.phoneNumberFormat(2),
                email: faker.internet.email()
            }
            return user;
        });

        await db.collection("user").insertMany(users);
    });
    this.afterAll(async () => {
        db.dropDatabase();
    });

    it('should fail with invalid configDir', async function () {
        await new MongoESIndexer("./invalidpath", "http://localhost:9200/", "mongodb://localhost:27017/testdb", "testdb").init().should.be.rejected;
    });
    it('should pass with correct configDir', async function () {
        await new MongoESIndexer("./test/testconfigs", "http://localhost:9200/", "mongodb://localhost:27017/testdb", "testdb").init().should.be.fulfilled;
    });
});