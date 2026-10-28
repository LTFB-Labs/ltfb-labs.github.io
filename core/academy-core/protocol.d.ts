export declare const AC: 2;
export type Method = 'getUser' | 'getSettings' | 'grantUserBadge' | 'appData.get' | 'appData.all' | 'appData.put' | 'appData.putMany' | 'appData.remove' | 'appData.clear' | 'navigate';
/** Frame → shell: the frame is listening. */
export interface HelloMessage {
    ac: typeof AC;
    type: 'hello';
}
/** Shell → frame: start, with the path inside the app. */
export interface InitMessage {
    ac: typeof AC;
    type: 'init';
    route: string;
}
/** Shell → frame: the child, the settings or the badges changed. */
export interface ChangeMessage {
    ac: typeof AC;
    type: 'change';
}
/** Frame → shell: the app could not start. */
export interface FailMessage {
    ac: typeof AC;
    type: 'fail';
    message: string;
}
/** Frame → shell: a call. */
export interface RequestMessage {
    ac: typeof AC;
    type: 'request';
    id: number;
    method: Method;
    params?: unknown;
}
/** Shell → frame: the answer to a call. */
export interface ResponseMessage {
    ac: typeof AC;
    type: 'response';
    id: number;
    result?: unknown;
    error?: string;
}
export type Message = (HelloMessage | InitMessage | ChangeMessage | FailMessage | RequestMessage | ResponseMessage) & {
    /** The frame's secret from its own address (?t=): only the page the shell opened knows it, also after a reload. */
    t?: string;
};
export declare function isMessage(data: unknown): data is Message;
