import {it, suite} from "mocha";
import * as chai from "chai";
import {expect} from "chai";
import * as Docker from "dockerode";
import {Container, ContainerCreateOptions} from "dockerode";
import {DEFAULT_ASYNC_TIMEOUT, DOCKER_STARTUP_TIME, holdUp} from "../testUtil";
import {Quest, QuestType} from "../../src/interfaces/MongoInterfaces";
import * as chaiAsPromised from "chai-as-promised";
import dbInjectors from "../../src/connectors/MongoConnector";
import TestConfig from "../TestConfig";
import * as log from "winston";
import uuid = require("uuid");

chai.use(chaiAsPromised);

interface HostPortBinding {
    HostPort: string
}

interface UpToDateCreateOptions extends ContainerCreateOptions {
    PortBindings?: {
        [key:string]: HostPortBinding[]
    },
    Binds?: string[]
}
suite("MongoConnector", function() {
    let container:Container;
    let docker = new Docker();
    let containersToDelete:Container[] = [];
    const quest: Quest = {
        id: uuid(),
        visible: true,
        questType: QuestType.MAIN,
        description: "A description",
        sourceRegion: "hortimony",
        objectives: [
            {id: uuid(), text: "An objective"},
            {id: uuid(), text: "Second objective"}
        ]
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

        it("performs expected ops", async function() {
            this.timeout(DEFAULT_ASYNC_TIMEOUT);

            const questConnector = await dbInjectors.questCollectionConnectorInstance(TestConfig);
            const transactionSuccess = await questConnector.addQuest({
                id: uuid(),
                visible: true,
                questType: QuestType.MAIN,
                description: "A description",
                sourceRegion: "hortimony",
                objectives: [
                    {id: uuid(), text: "An objective"},
                    {id: uuid(), text: "Second objective"}
                ]
            });
            log.info(`Successful add: ${transactionSuccess}`);

            let currentQuests = await questConnector.getQuests();
            log.info("Current quests.", {currentQuests});

            await questConnector.addObjective(currentQuests[0].id, {id: uuid(), text: "Objective update!"});
            currentQuests = await questConnector.getQuests();
            log.info("Updated current quests.", {currentQuests});

            await questConnector.updateQuest({id: currentQuests[0].id, sourceRegion: "pampenheim", questType: QuestType.SIDE});
            currentQuests = await questConnector.getQuests();
            log.info("Updated current quests.", {currentQuests});

            await questConnector.updateObjective({questId: currentQuests[0].id, objectiveId: currentQuests[0].objectives[0].id, newDescription: "Updated description"});
            currentQuests = await questConnector.getQuests();
            log.info("Updated current quests.", {currentQuests});

            await questConnector.deleteObjective(currentQuests[0].id, currentQuests[0].objectives[0].id);
            currentQuests = await questConnector.getQuests();
            log.info("Updated current quests.", {currentQuests});

            await questConnector.deleteQuest(currentQuests[0].id);
            currentQuests = await questConnector.getQuests();
            log.info("Updated current quests.", {currentQuests});
            // TODO make this test more rigorous
        });
    });
});