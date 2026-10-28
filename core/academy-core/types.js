// The words of the domain. Every name in the contract between the shell (core) and the apps is defined here
// once; the shell, the apps and the checks use these types. A new common idea starts here.
export const DEFAULT_SETTINGS = {
    sound: true,
    readAloud: false,
    largeText: false,
    dyslexiaFont: false,
    reducedMotion: false,
};
export const PERMISSIONS = ['user', 'settings', 'storage', 'badges'];
