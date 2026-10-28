// The messages between the shell and an app's frame. The app never builds these by hand: app.ts and shell.ts do.
export const AC = 2;
export function isMessage(data) {
    return typeof data === 'object' && data !== null && data.ac === AC
        && typeof data.type === 'string';
}
