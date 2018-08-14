import {Collection, connect, Db, MongoClientOptions} from "mongodb";
import * as log from "winston";
import {Configuration} from "../config";
import {Objective, ObjectiveUpdate, Quest, QuestUpdate} from "../interfaces/MongoInterfaces";

let baseDb:Db|null = null;
let questConnectorInstance:QuestCollectionConnector|null = null;

async function mongoConnectionSingleton(config:Configuration) : Promise<Db> {
    if (baseDb) return baseDb;

    // No try here, let's just throw an error if need be
    const mongoUrl = `mongodb://${config.mongo.hostname}:${config.mongo.port}/`;
    log.info(`Connecting to the database at ${mongoUrl}`);
    const client = await connect(mongoUrl, <MongoClientOptions> {
        logger: log,
        auth: {
            user: config.mongo.credentials.username,
            password: config.mongo.credentials.password
        },
        reconnectTries: 300,
        reconnectInterval: 5000
    });

    log.info("Connection successful.");
    baseDb = client.db(config.mongo.baseDatabase);
    return baseDb;
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
        return retVal.map(QuestCollectionConnector.scrubMongoId);
    }

    async addQuest(q: Quest) : Promise<boolean> {
        const result = await this.backingCollection.insertOne(q);
        QuestCollectionConnector.scrubMongoId(q);
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

        if (update.description) quest.description = update.description;
        if (update.questType) quest.questType = update.questType;
        if (update.sourceRegion) quest.sourceRegion = update.sourceRegion;

        const result = await this.backingCollection.replaceOne({id: update.id}, quest);
        return result.result.ok === 1;
    }

    async updateObjective(update: ObjectiveUpdate) : Promise<boolean> {
        const result = await this.backingCollection.updateOne(
            {id: update.questId, "objectives.id": update.objectiveId},
            {$set: {"objectives.$.text": update.newDescription}}
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

    private async findQuestById(id: string) : Promise<Quest|null> {
        return this.backingCollection.findOne({id});
    }

    private static scrubMongoId(quest: Quest) : Quest{
        delete quest._id;
        return quest;
    }
}

export default {
    questCollectionConnectorInstance: async function(config: Configuration) {
        if (questConnectorInstance) return questConnectorInstance;

        const db = await mongoConnectionSingleton(config);
        questConnectorInstance = new QuestCollectionConnector(db);
        return questConnectorInstance;
    }
}
