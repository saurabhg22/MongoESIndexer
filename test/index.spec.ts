import MongoESIndexer from '../src/index';
import * as MongoQueryResolver from 'mongoqueryresolver';
import * as chai from 'chai';
import * as faker from 'faker';
import { Db, ObjectID } from 'mongodb';

import * as chaiAsPromised from 'chai-as-promised';

chai.use(chaiAsPromised);
chai.should();

const USERS_LENGTH = 6000;
const BOOKS_LENGTH = 10000;

describe('init', function () {
    let db: Db, users:Array<any>=[], books:Array<any>=[];
    this.beforeAll(async () => {
        db = await MongoQueryResolver.init("mongodb://localhost:27017/testdb");
        users = Array.from(new Array(USERS_LENGTH).keys()).map((index) => {
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
        books = Array.from(new Array(BOOKS_LENGTH).keys()).map((index) => {
            let book = {
                title: faker.name.title(),
                _id: new ObjectID(),
                description: faker.lorem.paragraph(),
                rating: faker.random.number({ min: 1, max: 10 }),
                publishedDate: faker.date.past(),
                userId: users[faker.random.number({ min: 0, max: USERS_LENGTH - 1 })]._id
            }
            return book;
        });
        await db.collection("User").insertMany(users);
        await db.collection("Book").insertMany(books);
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
    it('should index single instance', async function () {
        let mongoESIndexer = new MongoESIndexer("./test/testconfigs", "http://localhost:9200/", "mongodb://localhost:27017/testdb", "testdb");
        await mongoESIndexer.init();
        await mongoESIndexer.indexOne('testdbuser', users[0]._id);
    });
});