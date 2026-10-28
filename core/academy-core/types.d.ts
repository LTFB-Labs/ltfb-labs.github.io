/** The app's id in the registry: kebab-case, e.g. 'nvo-matematika'. */
export type AppKey = string;
export type Grade = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type PersonKind = 'child' | 'parent' | 'teacher';
interface PersonBase {
    id: string;
    kind: PersonKind;
    displayName: string;
}
export interface Child extends PersonBase {
    kind: 'child';
    grade: Grade;
    /** One of the ready pictures, 1..12. */
    avatar: number;
    /** Address of the ready picture in the shell. */
    avatarUrl: string;
}
/** Only inside the shell, never given to an app. */
export interface Parent extends PersonBase {
    kind: 'parent';
}
/** Kept for the future school roles (OpenSpec `school-roles`); not used yet. */
export interface Teacher extends PersonBase {
    kind: 'teacher';
}
export type Person = Child | Parent | Teacher;
/** An earned badge in the child's profile: a trophy with its story. */
export interface Badge {
    app: AppKey;
    code: string;
    name: string;
    description?: string;
    /** Why the child got it, e.g. „Реши първия си пробен тест“. */
    reason?: string;
    /** Address of the picture in the shell (`core:<name>` is resolved to it). */
    icon: string;
    earnedAt: string;
}
/** What an app sends to grant a badge. `icon` is `core:<name>` (the shell's library) or the app's own address. */
export interface NewBadge {
    code: string;
    name: string;
    icon: string;
    description?: string;
    reason?: string;
}
/** What `getUser()` gives an app: the whole child's profile with one call (never place, school or parents). */
export interface ChildProfile extends Child {
    badges: Badge[];
}
export interface Settings {
    sound: boolean;
    readAloud: boolean;
    largeText: boolean;
    dyslexiaFont: boolean;
    reducedMotion: boolean;
}
export declare const DEFAULT_SETTINGS: Settings;
/** What an app may ask for. Without `user`, `getUser()` gives only the id. */
export type Permission = 'user' | 'settings' | 'storage' | 'badges';
export declare const PERMISSIONS: readonly Permission[];
/** Browser devices an app may use inside the sandbox. */
export type Device = 'microphone' | 'camera';
/** The app's description (`levacademy.json`), the same fields as `defineApp` without the functions. */
export interface AppManifest {
    id: AppKey;
    name: string;
    description?: string;
    icon?: string;
    /** The path in the shell: 'nvo' → /app/#/nvo */
    route: string;
    grades?: Grade[];
    contract: 2;
    permissions: Permission[];
    devices?: Device[];
    /** The module with `export default defineApp({...})`, relative to the app's folder. */
    entry: string;
    enabled?: boolean;
    availableFrom?: string;
    availableUntil?: string;
}
/** The app's own data, kept by the shell per app and per child. */
export interface AppData {
    get<T = unknown>(collection: string, id: string): Promise<T | undefined>;
    all<T = unknown>(collection: string): Promise<T[]>;
    put<T extends {
        id: string;
    }>(collection: string, record: T): Promise<void>;
    /** Several records with one call: all are saved, or none. */
    putMany<T extends {
        id: string;
    }>(collection: string, records: T[]): Promise<void>;
    remove(collection: string, id: string): Promise<void>;
    clear(collection: string): Promise<void>;
}
/** What the app gets from the shell. */
export interface Core {
    /** The contract version the shell speaks. */
    contract: 2;
    /** True inside the shell, false when the app is opened alone. */
    embedded: boolean;
    /** The path inside the app the shell was opened with, e.g. 'test/3' for /app/#/nvo/test/3. */
    route: string;
    getUser(): Promise<ChildProfile | {
        id: string;
    } | null>;
    getSettings(): Promise<Settings>;
    /** Called when the child, the settings or the badges change. Returns a function that removes the listener. */
    onChange(listener: () => void): () => void;
    grantUserBadge(badge: NewBadge): Promise<Badge>;
    appData: AppData;
    /** Tells the shell the path inside the app changed, so the address and „назад“ follow it. */
    navigate(route: string): void;
}
/** An app: one module with `export default defineApp({...})`. */
export interface AcademyApp extends Omit<AppManifest, 'entry'> {
    /** Draws the app in `el`; may return a function that removes it. */
    mount(el: HTMLElement, core: Core): void | (() => void) | Promise<void | (() => void)>;
}
export {};
