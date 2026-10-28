import { type AcademyApp, type AppManifest, type NewBadge } from './types.js';
/** Paths of the shell itself: an app may not take them. */
export declare const RESERVED_ROUTES: string[];
export declare class ContractError extends Error {
}
export declare function checkManifest(value: unknown): AppManifest;
export declare function checkApp(value: unknown): AcademyApp;
export declare function checkBadge(value: unknown): NewBadge;
/** Is the app on today: its own switch and its dates. */
export declare function isAvailable(app: Pick<AppManifest, 'enabled' | 'availableFrom' | 'availableUntil'>, now?: Date): boolean;
