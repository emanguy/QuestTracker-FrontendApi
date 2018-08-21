import {Collection, connect, Db, MongoClient, MongoClientOptions} from "mongodb";
import * as log from "winston";
import {Configuration} from "../config";
import {Objective, ObjectiveUpdate, Quest, QuestUpdate} from "../interfaces/QuestInterfaces";
import {User} from "../interfaces/AuthInterfaces";

let connectedClient: MongoClient|null = null;
let baseDb: Db|null = null;
let questConnectorInstance: QuestCollectionConnector|null = null;
let userConnectorInstance: UserCollectionConnector|null = null;

async function mongoConnectionSingleton(config:Configuration) : Promise<Db> {
    if (baseDb) return baseDb;

    // No try here, let's just throw an error if need be
    const mongoUrl = `mongodb://${config.mongo.hostname}:${config.mongo.port}/`;
    log.info(`Connecting to the database at ${mongoUrl}`);
    connectedClient = await connect(mongoUrl, <MongoClientOptions> {
        logger: log,
        auth: {
            user: config.mongo.credentials.username,
            password: config.mongo.credentials.password
        },
        reconnectTries: 300,
        reconnectInterval: 5000
    });

    log.info("Connection successful.");
    baseDb = connectedClient.db(config.mongo.baseDatabase);
    return baseDb;
}

export async function disconnectFromDb() {
    if (connectedClient) {
        await connectedClient.close();
        log.info("Disconnected from mongo.");
        connectedClient = null;
        baseDb = null;
    }

    if (questConnectorInstance) questConnectorInstance = null;
    if (userConnectorInstance) userConnectorInstance = null;
}

function scrubMongoId(mongoEntity: any|null) : any|null{
    if (mongoEntity) delete mongoEntity._id;
    return mongoEntity;
}

interface ObjectiveUpdateOperation {
    "objectives.$.text"?: string
    "objectives.$.completed"?: boolean
}

export class EmptyUpdateError extends Error {
    constructor(message: string) {
        super(message);
    }
}

export class QuestCollectionConnector {
    private backingCollection:Collection<Quest>;

    constructor(db:Db) {
        const collectionName = "quests";
        this.backingCollection = db.collection(collectionName);
    }

    async getQuests() : Promise<Quest[]> {
        return this.getQuestsFilteringVisibility(true);
    }

    async getQuestsFilteringVisibility(visibleOnly:boolean) : Promise<Quest[]> {
        const query = visibleOnly ? {visible: true} : {};
        const retVal = await this.backingCollection.find(query).toArray();
        return retVal.map(scrubMongoId);
    }

    async addQuest(q: Quest) : Promise<boolean> {
        const result = await this.backingCollection.insertOne(q);
        scrubMongoId(q);
        return result.insertedCount === 1;
    }

    async addObjective(id: string, objective: Objective) : Promise<boolean> {
        const result = await this.backingCollection.updateOne(
            {id},
            { $push: {"objectives": objective}}
        );

        return result.modifiedCount === 1 && result.result.ok === 1;
    }

    async updateQuest(update: QuestUpdate) : Promise<boolean> {
        const quest = await this.findQuestById(update.id);
        if (!quest) return false;

        if (!update.description && !update.questType && !update.sourceRegion)
            throw new EmptyUpdateError("Did not provide any fields for update.");

        if (update.description) quest.description = update.description;
        if (update.questType) quest.questType = update.questType;
        if (update.sourceRegion) quest.sourceRegion = update.sourceRegion;

        const result = await this.backingCollection.replaceOne({id: update.id}, quest);
        return result.result.ok === 1;
    }

    async updateObjective(update: ObjectiveUpdate) : Promise<boolean> {
        const dbTransaction: ObjectiveUpdateOperation = {};

        if (!update.newDescription && !update.completed)
            throw new EmptyUpdateError("Did not provide any fields for update.");

        if (update.newDescription) dbTransaction["objectives.$.text"] = update.newDescription;
        if (update.completed) dbTransaction["objectives.$.completed"] = update.completed;

        const result = await this.backingCollection.updateOne(
            {id: update.questId, "objectives.id": update.objectiveId},
            {$set: dbTransaction}
        );

        return result.modifiedCount === 1 && result.result.ok === 1;
    }

    async deleteQuest(id: String) : Promise<boolean> {
        const result = await this.backingCollection.deleteOne({id});
        return result.deletedCount === 1 && result.result.ok === 1;
    }

    async deleteObjective(questId: string, objectiveId: string) {
        const result = await this.backingCollection.updateOne(
            {id: questId },
            {$pull: { objectives: { id: objectiveId } }}
        );
        return result.modifiedCount === 1 && result.result.ok === 1;
    }

    async findQuestById(id: string) : Promise<Quest|null> {
        let foundQuest = await this.backingCollection.findOne({id});
        if (foundQuest) foundQuest = scrubMongoId(foundQuest);
        return foundQuest;
    }

}

export class UserCollectionConnector {
    private backingCollection: Collection<User>;

    constructor(db: Db) {
        const collectionName = "users";
        this.backingCollection = db.collection(collectionName);
    }

    async addUser(user: User) : Promise<boolean> {
        const result = await this.backingCollection.insertOne(user);
        scrubMongoId(user);
        return result.insertedCount === 1 && result.result.ok === 1;
    }

    async getUser(username: string) : Promise<User|null> {
        return scrubMongoId(await this.backingCollection.findOne({username}));
    }
}

export default {
    questCollectionConnectorInstance: async function(config: Configuration) : Promise<QuestCollectionConnector> {
        if (questConnectorInstance) return questConnectorInstance;

        const db = await mongoConnectionSingleton(config);
        questConnectorInstance = new QuestCollectionConnector(db);
        return questConnectorInstance;
    },
    userCollectionConnectorInstance: async function(config: Configuration) : Promise<UserCollectionConnector> {
        if (userConnectorInstance) return userConnectorInstance;

        const db = await mongoConnectionSingleton(config);
        userConnectorInstance = new UserCollectionConnector(db);
        return userConnectorInstance;
    }
}
