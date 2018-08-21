import {it, suite} from "mocha";
import * as chai from "chai";
import {expect} from "chai";
import * as Docker from "dockerode";
import {Container} from "dockerode";
import {DEFAULT_ASYNC_TIMEOUT, DOCKER_STARTUP_TIME, holdUp, UpToDateCreateOptions} from "../testUtil";
import {Quest, QuestType} from "../../src/interfaces/QuestInterfaces";
import * as chaiAsPromised from "chai-as-promised";
import dbInjectors, {disconnectFromDb, EmptyUpdateError} from "../../src/connectors/MongoConnector";
import TestConfig from "../TestConfig";
import {v4 as uuid} from "uuid";
import {User} from "../../src/interfaces/AuthInterfaces";

chai.use(chaiAsPromised);

suite("MongoConnector", function() {
    let container : Container;
    const docker = new Docker();
    const containersToDelete:Container[] = [];
    const quest: Quest = {
        id: uuid(),
        visible: true,
        questType: QuestType.MAIN,
        description: "A description",
        sourceRegion: "hortimony",
        objectives: [
            {id: uuid(), text: "An objective", completed: false},
            {id: uuid(), text: "Second objective", completed:false}
        ]
    };
    const user: User = {
        username: "sampleUser",
        passwordHash: "$2b$10$zG4SZGZZKsUBZm3d5PnWteg7mOwjhefIQqRQXDW9Wu92GjUlhOeD6",
        passwordSalt: "$2b$10$zG4SZGZZKsUBZm3d5PnWte"
    };

    before(async function() {
        this.timeout(30000);

        await docker.pull("mongo:4.0", {});
    });

    beforeEach(async function() {
        this.timeout(DEFAULT_ASYNC_TIMEOUT);
        const options: UpToDateCreateOptions = {
            Image: "mongo:4.0",
            Env: [
                `MONGO_INITDB_ROOT_USERNAME=${TestConfig.mongo.credentials.username}`,
                `MONGO_INITDB_ROOT_PASSWORD=${TestConfig.mongo.credentials.password}`,
                `MONGO_INITDB_DATABASE=${TestConfig.mongo.baseDatabase}`
            ],
            Binds: [
                `${process.cwd()}/dbInit/:/docker-entrypoint-initdb.d`
            ],
            PortBindings: {
                "27017/tcp": [{HostPort: "27017"}]
            }
        };
        container = await docker.createContainer(options);

        await container.start();
        await holdUp(DOCKER_STARTUP_TIME);
    });

    afterEach(async function() {
        this.timeout(DEFAULT_ASYNC_TIMEOUT);
        await disconnectFromDb();

        if (container) {
            await container.stop();
            containersToDelete.push(container);
        }
    });

    after(async function() {
        this.timeout(30000);
        const deleteJobs = containersToDelete.map(container => container.remove());
        await Promise.all(deleteJobs);
    });

    suite("Quest collection connector", function() {
        it("can add a new quest", async function() {
            this.timeout(DEFAULT_ASYNC_TIMEOUT);

            const connection = await dbInjectors.questCollectionConnectorInstance(TestConfig);

            expect(connection).to.not.be.null;

            const transactionSuccess = await connection.addQuest(quest);
            expect(transactionSuccess).to.be.a("boolean").and.equal(true);
            const returnedQuests = await connection.getQuests();
            expect(returnedQuests).to.be.an("array").and.deep.equal([quest]);
            expect(returnedQuests[0]).to.not.have.property("_id");
        });

        it("can update an existing quest", async function() {
           this.timeout(DEFAULT_ASYNC_TIMEOUT);

           const connection = await dbInjectors.questCollectionConnectorInstance(TestConfig);

           expect(connection).to.not.be.null;

           await connection.addQuest(quest);
           const transactionSuccess = await connection.updateQuest({id: quest.id, questType: QuestType.SIDE});
           expect(transactionSuccess).to.be.a("boolean").and.equal(true);

           const quests = await connection.getQuests();
           expect(quests).to.be.an("array").and.have.lengthOf(1);
           expect(quests[0].questType).to.equal(QuestType.SIDE);
        });

        it("throws an exception on empty quest updates", async function() {
            this.timeout(DEFAULT_ASYNC_TIMEOUT);

            const connection = await dbInjectors.questCollectionConnectorInstance(TestConfig);

            expect(connection).to.not.be.null;
            await connection.addQuest(quest);
            return expect(connection.updateQuest({id: quest.id})).to.eventually.be.rejectedWith(EmptyUpdateError);
        });

        it("can update individual objectives", async function() {
            this.timeout(DEFAULT_ASYNC_TIMEOUT);

            const connection = await dbInjectors.questCollectionConnectorInstance(TestConfig);
            const expectedUpdatedQuest: Quest = JSON.parse(JSON.stringify(quest));
            expectedUpdatedQuest.objectives[0].text = "New quest description";
            expectedUpdatedQuest.objectives[0].completed = true;

            expect(connection).to.not.be.null;

            await connection.addQuest(quest);
            const transactionSuccess = await connection.updateObjective({
                questId: quest.id,
                objectiveId: quest.objectives[0].id,
                newDescription: expectedUpdatedQuest.objectives[0].text,
                completed: expectedUpdatedQuest.objectives[0].completed
            });
            expect(transactionSuccess).to.be.true;

            return expect(connection.findQuestById(quest.id)).to.eventually.deep.equal(expectedUpdatedQuest);
        });

        it("throws an exception on empty objective updates", async function() {
            this.timeout(DEFAULT_ASYNC_TIMEOUT);

            const connection = await dbInjectors.questCollectionConnectorInstance(TestConfig);

            expect(connection).to.not.be.null;
            await connection.addQuest(quest);
            return expect(connection.updateObjective({questId: quest.id, objectiveId: quest.objectives[0].id})).to.eventually.be.rejectedWith(EmptyUpdateError);
        });

        it("can filter on quest visibility", async function() {
            this.timeout(DEFAULT_ASYNC_TIMEOUT);

            const connection = await dbInjectors.questCollectionConnectorInstance(TestConfig);
            const invisibleQuest: Quest = {
                id: uuid(),
                visible: false,
                questType: QuestType.MAIN,
                description: "A description",
                sourceRegion: "hortimony",
                objectives: []
            };
            expect(connection).to.not.be.null;

            await connection.addQuest(quest);
            await connection.addQuest(invisibleQuest);

            let returnedQuests = await connection.getQuestsFilteringVisibility(true);
            expect(returnedQuests).to.have.lengthOf(1).and.deep.equal([quest]);
            returnedQuests = await connection.getQuestsFilteringVisibility(false);
            expect(returnedQuests).to.have.lengthOf(2)
                .and.have.deep.members([quest, invisibleQuest]);
        });

        it("can delete a quest", async function() {
            this.timeout(DEFAULT_ASYNC_TIMEOUT);

            const connection = await dbInjectors.questCollectionConnectorInstance(TestConfig);
            expect(connection).to.not.be.null;

            await connection.addQuest(quest);
            await connection.deleteQuest(quest.id);
            return expect(connection.getQuests()).to.eventually.be.an("array").and.be.empty;
        });

        it("can delete an objective", async function() {
            this.timeout(DEFAULT_ASYNC_TIMEOUT);

            const expectedObject: Quest = JSON.parse(JSON.stringify(quest));
            expectedObject.objectives.splice(0, 1);
            const connection = await dbInjectors.questCollectionConnectorInstance(TestConfig);
            expect(connection).to.not.be.null;

            await connection.addQuest(quest);
            await connection.deleteObjective(quest.id, quest.objectives[0].id);
            return expect(connection.getQuests()).to.eventually.deep.equal([expectedObject]);
        });
    });

    suite("User collection connector", function() {
        it("can add and retrieve users", async function() {
            this.timeout(DEFAULT_ASYNC_TIMEOUT);

            const connection = await dbInjectors.userCollectionConnectorInstance(TestConfig);
            expect(connection).to.not.be.null;

            const expectedUser = JSON.parse(JSON.stringify(user));
            expect(await connection.addUser(user)).to.be.a("boolean").and.be.true;
            return expect(connection.getUser(expectedUser.username)).to.eventually.deep.equal(expectedUser);
        });
    })
});