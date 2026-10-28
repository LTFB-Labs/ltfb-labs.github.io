// The shell's side: shows an app in a sandboxed frame and answers its calls by the app's key and permissions.
// The key is the frame the message came from, never a field in the message.
import { AC, isMessage } from './protocol.js';
import { checkBadge, ContractError } from './validate.js';
import { DEFAULT_SETTINGS } from './types.js';
const SANDBOX = 'allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock';
function need(permissions, permission) {
    if (!permissions.includes(permission))
        throw new ContractError(`Апът няма право „${permission}“.`);
}
export function mountApp(options) {
    const { container, app, frameUrl, route, handlers } = options;
    const permissions = app.manifest.permissions;
    const devices = app.manifest.devices ?? [];
    const frame = document.createElement('iframe');
    frame.className = 'app-frame';
    frame.title = app.manifest.name;
    frame.setAttribute('sandbox', SANDBOX);
    frame.setAttribute('allow', ['fullscreen', 'autoplay', ...devices].join('; '));
    const entry = new URL(app.manifest.entry, app.url).href;
    frame.src = `${frameUrl}?app=${encodeURIComponent(app.id)}&entry=${encodeURIComponent(entry)}`;
    const post = (message) => frame.contentWindow?.postMessage(message, '*');
    async function answer(request) {
        const params = (request.params ?? {});
        switch (request.method) {
            case 'getUser': {
                const user = await handlers.getUser();
                if (!user)
                    return null;
                return permissions.includes('user') ? user : { id: user.id };
            }
            case 'getSettings':
                return permissions.includes('settings') ? handlers.getSettings() : DEFAULT_SETTINGS;
            case 'grantUserBadge':
                need(permissions, 'badges');
                return handlers.grantUserBadge(app.id, checkBadge(params));
            case 'appData.get':
            case 'appData.all':
            case 'appData.put':
            case 'appData.putMany':
            case 'appData.remove':
            case 'appData.clear':
                need(permissions, 'storage');
                return handlers.appData(app.id, request.method.slice('appData.'.length), params);
            case 'navigate':
                handlers.navigate(app.id, String(params.route ?? ''));
                return null;
            default:
                throw new ContractError(`Непознато извикване „${String(request.method)}“.`);
        }
    }
    // The frame's window stays the same when it goes to another page: after the first page, nothing is answered.
    let loads = 0;
    let left = false;
    frame.addEventListener('load', () => {
        loads += 1;
        if (loads > 1 && !left) {
            left = true;
            console.warn(`${app.id}: рамката отиде на друга страница; тя не получава нищо от ядрото.`);
            handlers.onFail?.(app.id, 'navigated');
        }
    });
    function onMessage(event) {
        if (left || event.source !== frame.contentWindow || !isMessage(event.data))
            return;
        const message = event.data;
        if (message.type === 'hello')
            post({ ac: AC, type: 'init', route });
        else if (message.type === 'fail')
            handlers.onFail?.(app.id, message.message);
        else if (message.type === 'request') {
            answer(message).then((result) => post({ ac: AC, type: 'response', id: message.id, result }), (error) => {
                if (error instanceof ContractError)
                    console.warn(`${app.id}:`, error.message);
                post({ ac: AC, type: 'response', id: message.id, error: error instanceof Error ? error.message : String(error) });
            });
        }
        else
            console.warn(`${app.id}: непознато съобщение`, message);
    }
    addEventListener('message', onMessage);
    container.replaceChildren(frame);
    return {
        notifyChange: () => post({ ac: AC, type: 'change' }),
        destroy() {
            removeEventListener('message', onMessage);
            frame.remove();
        },
    };
}
