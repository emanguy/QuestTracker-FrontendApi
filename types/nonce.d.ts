declare module "nonce" {
    function nonceConstructor(nonceLength?: number) : () => number;
    namespace nonceConstructor {}
    export = nonceConstructor;
}