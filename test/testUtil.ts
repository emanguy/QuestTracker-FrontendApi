import {ContainerCreateOptions} from "dockerode";

export async function holdUp(ms:number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export const DOCKER_STARTUP_TIME = 3000;
export const DEFAULT_ASYNC_TIMEOUT = 10000;

export interface HostPortBinding {
    HostPort: string
}

export interface UpToDateCreateOptions extends ContainerCreateOptions {
    PortBindings?: {
        [key:string]: HostPortBinding[]
    },
    Binds?: string[]
}
