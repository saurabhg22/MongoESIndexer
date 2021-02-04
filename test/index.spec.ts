import MongoESIndexer from '../src/index';
import * as MongoQueryResolver from 'mongoqueryresolver';
import * as chai from 'chai';
import * as faker from 'faker';
import { Db, ObjectID } from 'mongodb';
import { promisify } from 'util';
import * as chaiAsPromised from 'chai-as-promised';

const sleep = promisify(setTimeout);

chai.use(chaiAsPromised);
chai.should();

const USERS_LENGTH = 600;
const BOOKS_LENGTH = 1000;
let db: Db, users: Array<any> = [], books: Array<any> = [];
let mongoESIndexer: MongoESIndexer;

before(async () => {
    console.log("CREATING DATABASE");
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

after(async () => {
    console.log("DROPPING DATABASE");
    db.dropDatabase();
});

describe('setup', function () {
    it('should fail with invalid configDir', async function () {
        mongoESIndexer = new MongoESIndexer("./invalidpath", "http://localhost:9200/", "mongodb://localhost:27017/testdb", "testdb");
        await mongoESIndexer.setup().should.be.rejected;
    });
    it('should pass with correct configDir', async function () {
        mongoESIndexer = new MongoESIndexer("./test/testconfigs", "http://localhost:9200/", "mongodb://localhost:27017/testdb", "testdb");
        await mongoESIndexer.setup().should.be.fulfilled;
    });
});


describe.skip('indexOne', () => {
    it('should index single instance', async function () {
        await mongoESIndexer.indexOne('testdbuser', users[0]._id).should.be.fulfilled;
    });
});

describe('updateOne', () => {
    it('should update single instance', async function () {
        await mongoESIndexer.updateOne('testdbuser', users[0]._id).should.be.fulfilled;
    });
});

describe.skip('deleteOne', () => {
    it('should delete single instance', async function () {
        await mongoESIndexer.deleteOne('testdbuser', users[0]._id).should.be.fulfilled;
    });
    it('should reject delete single instance with invalid id', async function () {
        await mongoESIndexer.deleteOne('testdbuser', 'invalid id').should.be.rejected;
    });
});

describe.skip('bulkIndex', () => {
    it('should index 300 users', async function () {
        await mongoESIndexer.bulkIndex('testdbuser', { limit: 300 }).should.be.fulfilled;
    });
});

describe.skip('bulkUpdate', () => {
    it('should update age to 20 of all users', async function () {
        await mongoESIndexer.bulkUpdate('testdbuser', {}, { Age: 20 }).should.be.fulfilled;
    });
});

describe('deleteByQuery', () => {
    it('should delete all users aged below 18', async function () {
        await sleep(5000);
        await mongoESIndexer.deleteByQuery('testdbuser', {
            query: {
                bool: {
                    filter: {
                        range: {
                            Age: {
                                lt: 18
                            }
                        }
                    }
                }
            }
        }).should.be.fulfilled;
    });
});

