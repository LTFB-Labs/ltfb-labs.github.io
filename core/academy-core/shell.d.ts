import { type AppKey, type AppManifest, type Badge, type ChildProfile, type NewBadge, type Settings } from './types.js';
/** An app as the shell knows it: only apps that implement the contract are shown. */
export interface HostedApp {
    id: AppKey;
    /** Absolute address of the app's folder, ending with '/'. */
    url: string;
    manifest: AppManifest;
}
export type AppDataOp = 'get' | 'all' | 'put' | 'putMany' | 'remove' | 'clear';
/** What the shell does for the app; the shell's store sits behind these. */
export interface HostHandlers {
    getUser(): Promise<ChildProfile | null>;
    getSettings(): Promise<Settings>;
    grantUserBadge(app: AppKey, badge: NewBadge): Promise<Badge>;
    appData(app: AppKey, op: AppDataOp, params: Record<string, unknown>): Promise<unknown>;
    navigate(app: AppKey, route: string): void;
    onFail?(app: AppKey, message: string): void;
}
export interface MountedApp {
    /** Tell the app the child, the settings or the badges changed. */
    notifyChange(): void;
    destroy(): void;
}
export declare function mountApp(options: {
    container: HTMLElement;
    app: HostedApp;
    /** Absolute address of /core/frame.html. */
    frameUrl: string;
    route: string;
    handlers: HostHandlers;
}): MountedApp;
