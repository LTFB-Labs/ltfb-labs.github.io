// Checks that run in the browser: the TS types catch mistakes in TS apps, these catch them in JS apps too.
import { PERMISSIONS } from './types.js';
const KEBAB = /^[a-z0-9][a-z0-9-]{0,62}$/;
const DEVICES = ['microphone', 'camera'];
/** Paths of the shell itself: an app may not take them. */
export const RESERVED_ROUTES = ['login', 'register', 'app', 'apps', 'parents', 'privacy', 'terms', 'auth', 'backpack', 'dashboard', 'core', 'family', 'who'];
export class ContractError extends Error {
}
const fail = (message) => { throw new ContractError(`academy-core: ${message}`); };
const text = (value, field, max, required = true) => {
    if (value === undefined && !required)
        return;
    if (typeof value !== 'string' || !value.trim() || value.length > max)
        fail(`${field} трябва да е текст до ${max} знака.`);
};
function checkDescription(app) {
    if (typeof app.id !== 'string' || !KEBAB.test(app.id))
        fail('id трябва да е малки латински букви, цифри и тире.');
    text(app.name, 'name', 80);
    text(app.description, 'description', 300, false);
    if (typeof app.route !== 'string' || !KEBAB.test(app.route))
        fail('route трябва да е малки латински букви, цифри и тире.');
    if (RESERVED_ROUTES.includes(app.route))
        fail(`route „${app.route}“ е запазен за ядрото.`);
    if (app.contract !== 2)
        fail(`contract ${String(app.contract)} не се поддържа (поддържа се 2).`);
    if (!Array.isArray(app.permissions) || app.permissions.some((p) => !PERMISSIONS.includes(p))) {
        fail(`permissions трябва да е от ${PERMISSIONS.join(', ')}.`);
    }
    if (app.devices !== undefined && (!Array.isArray(app.devices) || app.devices.some((d) => !DEVICES.includes(d)))) {
        fail('devices трябва да е от microphone, camera.');
    }
}
export function checkManifest(value) {
    const manifest = value;
    checkDescription(manifest);
    text(manifest.entry, 'entry', 200);
    return manifest;
}
export function checkApp(value) {
    const app = value;
    if (!app || typeof app !== 'object')
        fail('defineApp очаква обект.');
    checkDescription(app);
    if (typeof app.mount !== 'function')
        fail('mount(el, core) липсва.');
    return app;
}
export function checkBadge(value) {
    const badge = value;
    if (!badge || typeof badge !== 'object')
        fail('grantUserBadge очаква обект.');
    if (typeof badge.code !== 'string' || !KEBAB.test(badge.code))
        fail('code на значката трябва да е малки латински букви, цифри и тире.');
    text(badge.name, 'name на значката', 80);
    text(badge.icon, 'icon на значката', 500);
    text(badge.description, 'description на значката', 300, false);
    text(badge.reason, 'reason на значката', 200, false);
    return badge;
}
/** Is the app on today: its own switch and its dates. */
export function isAvailable(app, now = new Date()) {
    if (app.enabled === false)
        return false;
    const today = now.toISOString().slice(0, 10);
    if (app.availableFrom && today < app.availableFrom)
        return false;
    if (app.availableUntil && today > app.availableUntil)
        return false;
    return true;
}
