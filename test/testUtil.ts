export async function holdUp(ms:number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export const DOCKER_STARTUP_TIME = 3000;
export const DEFAULT_ASYNC_TIMEOUT = 10000;