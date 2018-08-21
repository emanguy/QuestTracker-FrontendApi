
export interface SavedNonce {
    id: string
    serverNonce: number
}

export interface User {
    _id?: string
    username: string
    passwordHash: string
    passwordSalt: string
}