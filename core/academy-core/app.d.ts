import type { AcademyApp } from './types.js';
export type { AcademyApp, Core, ChildProfile, Badge, NewBadge, Settings } from './types.js';
/** Checks the app now (in the browser too) and returns it unchanged. */
export declare function defineApp<T extends AcademyApp>(app: T): T;
/** Runs inside /core/frame.html: loads the app's module from ?entry= and mounts it. */
export declare function startFrame(root: HTMLElement): Promise<void>;
