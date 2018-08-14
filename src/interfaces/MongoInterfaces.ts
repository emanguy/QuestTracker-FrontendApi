export enum QuestType {
    MAIN = "main",
    SIDE = "side"
}

export interface Objective {
    id: string
    text: string
}

export interface Quest {
    _id?: string
    id: string
    visible: boolean
    sourceRegion: string
    questType: QuestType
    objectives: Objective[]
    description: string
}

export interface QuestUpdate {
    id: string
    sourceRegion?: string
    questType?: QuestType
    description?: string
}

export interface ObjectiveUpdate {
    questId: string
    objectiveId: string
    newDescription: string
}

